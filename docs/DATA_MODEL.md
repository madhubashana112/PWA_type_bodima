# Data model

Everything the app knows lives in one object, `S`, mirrored to
`localStorage` and — when cloud sync is on — to a Firebase Realtime Database
node. This describes both sides and how they are kept in step.

## `S` — the house

```js
{
  house:    "Wellawatte",      // display name
  passHash: "<64 hex>",        // salted, stretched SHA-256 of the password
  passSalt: "<24 hex>",
  lang:     "si" | "en",
  members:   [Member],
  expenses:  [Expense],
  settles:   [Settle],
  archives:  [Archive],
  activity:  [Activity],       // newest first, capped at 80
  debts:     [Debt],
  recurring: [Rule],

  _auth:   true,               // local only: is someone logged in on this device
  _rupees: 1,                  // local only: whole-rupee migration has run
  cpath:   "h/<40 hex>"        // local only: where this house lives in the cloud
}
```

`_auth`, `_rupees` and `cpath` never sync — they describe this device, not the
house. `cpath` is kept because the cloud path is derived from the password,
which the app does not retain after login.

Stored under `bodime_data_v2`.

### Member

```js
{ id, name, color }            // color from AVCOLORS, by join order
```

### Expense

```js
{
  id, desc, amount,            // amount is whole rupees
  payer:  memberId,
  parts:  [memberId],          // who it is split between
  date:   ms,
  split:  { mode: "exact" | "shares", values: { memberId: n } },   // absent = equal
  ruleId: ruleId               // present if a recurring rule produced it
}
```

`shareMap(e)` turns this into `{ memberId: rupees }`. An equal or share-based
split is distributed by largest remainder so the parts add up to the total
**exactly** — no fractional cents, which used to surface as a stray `+Rs.2`
nobody could settle.

### Settle

A payment from one member to another. A settle carrying `expId` is a
per-expense tick; one without is a free-standing payment.

```js
{ id, from: memberId, to: memberId, amount, date, expId?, memberId? }
```

### Rule (recurring)

```js
{ id, createdAt, desc, amount, payer, parts, split, day: 1-31, lastYm: "2026-09" }
```

A rule is not an expense. Closing a month empties `S.expenses` into an
archive, and a flagged expense would take the series with it.

`rollRecurring()` walks each rule from `lastYm` to the current month and
creates one expense per month passed, at `r<ruleId>-<YYYY-MM>`. That id is
derived, not random, so two phones opening the app on the 1st compute the same
id and the second write lands on the first instead of adding a duplicate. A
month already archived is skipped, and a rule whose payer or housemates have
been removed pauses rather than producing an expense nobody owns. Day 31
clamps to the length of the month.

It runs at boot, after a sync, and when the app returns to the foreground — an
installed PWA can sit resumed across a month boundary without reloading.

### Archive

A closed month: `{ id, label, closedAt, total, members, expenses, settles }`,
with copies of the members as they were, so an archive still reads correctly
after someone leaves.

### Debt

Money owed to someone outside the house, shared with the rest of it.

```js
{ id, owner: memberId, ownerName,   // the housemate who owes it
  person,                           // who they owe it to
  total, reason, date, due,         // due is null when open-ended
  payments: [{ id, amount, date }] }
```

`debtRemaining` is `total` minus the payments; a debt reads as pending,
partial or paid from that, and as overdue once `due` has passed with
something still owing.

## Per-device keys

These are deliberately outside `S` and never sync.

| Key | |
|---|---|
| `bodime_me` | which member this device is, for "you owe" framing |
| `bodime_budget_v1` | a private monthly budget, per identity |
| `bodime_lang` | language chosen before logging in |
| `bodime_fb_cfg` | a user-supplied Firebase config, when none is built in |
| `bodime_debts_v1` | legacy private debts, migrated once then left alone |

History search and filter state is in-memory only, so how one person is
browsing never reaches anyone else.

## Cloud layout

```
h/<hash of house name + password>
  meta/        { house, passHash, passSalt, lang }
  members/<id>      expenses/<id>     settles/<id>
  archives/<id>     activity/<id>     debts/<id>     recurring/<id>

names/<house name>   { at }          public marker, holds no data
houses/<house name>  { moved: 1 }    tombstone left by a migrated house
```

Each record sits at its own child path. An earlier version wrote the whole
house as one blob, so two people editing at once overwrote each other.

### Passwords and paths

`hashPass(salt, pass)` is SHA-256 over `bodime:pw:v1:<salt>:<pass>`, then 2000
further rounds of `sha256(hash + salt)`. SHA-256 is implemented inline rather
than via `crypto.subtle`, which needs a secure context a `file://` or WebView
build may not have, and which would have made login asynchronous.

`housePath(house, pass)` is the first 40 hex characters of SHA-256 over
`bodime:path:v1:<keyed house name>:<pass>`. The house name alone does not
reach the data.

See the privacy section of the [README](../README.md) for what this does and
does not protect against.

## How syncing works

`save()` writes `localStorage` and, if connected, calls `cloudFlush()`.

`cloudFlush()` diffs the current state against `cloud.mirror` — what the cloud
is believed to hold — and sends one `ref.update()` containing only the changed
child paths, with a deleted record written as `null`. Concurrent additions to
different ids therefore never clobber one another.

`cloud.mirror` is a **detached copy**. It used to hold references to the same
objects as `S`, so editing an expense in place mutated both sides of the diff
at once: the diff saw no change, and a corrected amount silently never reached
anyone else.

Incoming snapshots go through `applyCloud()`, which sets `cloud.applying` so
the echo of the app's own writes is ignored, and compares a signature first so
an unchanged snapshot does not trigger a re-render.

`cloud.online` comes from Firebase's own `.info/connected`, and `cloud.pending`
counts writes handed over but not yet acknowledged. `cloudState()` derives
`off / connecting / syncing / synced / offline / error` from those. A write
made with no connection is queued by Firebase and resolves on reconnect, so a
pending promise means "not saved yet", not "failed".

## Migrations

Each runs once and is idempotent.

| | |
|---|---|
| `migrateWholeRupees` | rounds pre-existing fractional amounts to whole rupees |
| `migrateStoredPass` | replaces a plaintext `pass` with a salted hash |
| `migrateLocalDebts` | folds once-private debts into the shared list |
| `migrateCloudFormat` | rewrites an old whole-house blob as child records |
| `moveHouseToPrivatePath` | copies a house off `houses/<name>`, then tombstones it |
