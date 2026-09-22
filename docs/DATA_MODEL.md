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

### Categories

There is no category field. Asking someone to pick one for a Rs.200 packet of
rice is a field too many, so a description is matched against the patterns in
`CATEGORIES` — the same match that has always chosen the row emoji. The first
pattern to match wins, and anything unmatched is `other`. The report's donut
groups spend this way; nothing is stored, so re-classifying is only ever a
change to that table.

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

`owner` is picked explicitly in the form, from the house's member list — it
used to default silently to whichever member the device was logged in as,
and a device with no identity chosen (the "Not me" option on the who-am-I
sheet) baked the localised word for "someone" into `ownerName` as if it were
a name. That value was then trusted forever: `debtOwnerName` returned it
ahead of a live lookup, so no amount of setting up an identity afterwards
could fix a debt already saved that way. `debtOwnerName` now takes the
current member list as the source of truth whenever `owner` resolves, and
only falls back to a stored `ownerName` — never to a placeholder — when it
does not; editing a debt lets `owner` be reassigned, which is how an already
broken record gets repaired.

## Per-device keys

These are deliberately outside `S` and never sync.

| Key | |
|---|---|
| `bodime_me` | which member this device is, for "you owe" framing |
| `bodime_budget_v1` | a private budget per identity — a monthly and a weekly target, kept separately |
| `bodime_personal_v1` | personal expenses, per identity |
| `bodime_lang` | language chosen before logging in |
| `bodime_fb_cfg` | a user-supplied Firebase config, when none is built in |
| `bodime_debts_v1` | legacy private debts, migrated once then left alone |

History search and filter state is in-memory only, so how one person is
browsing never reaches anyone else.

### Personal expenses

A haircut, your own lunch, clothes — things that settle nothing and are
nobody else's business. They are keyed by `privateOwner()`, the same
per-identity key the budget uses, so two housemates sharing a phone do not
see each other's:

```js
{ id, desc, amount, date }
```

They are deliberately not in `S`, so they never reach the cloud and never
appear in the house's totals, history or balances. They do count towards the
report's **Mine** scope and towards whichever budget (monthly or weekly)
matches the period being looked at, which is what "my spending" was always
meant to be.

Home's recent-activity card also mixes this device's own personal entries in
with `S.expenses` for display, newest first — the two house-wide tiles above
it stay computed from `S.expenses` alone. This is display only: nothing
about what is in `S`, the cloud, or another device's view of Home changes,
and a device signed in as someone else sees only its own identity's entries
there, same as everywhere else personal expenses appear.

Because they live outside `S`, the JSON backup carries them explicitly under
`personal` (and the budgets under `budget` and `budgetWeek`) — otherwise a
reinstall would lose them. That does mean the backup file contains private
entries, which the backup sheet warns about before you export.

`mineAsExpenses(period)` is what the Mine scope charts: one row per house
expense holding only your share, plus your personal entries at face value. It
filters shares through the same valid-member map `consumedByMember` uses, so
the rows and the "my share" tile cannot disagree once someone has left.

## Cloud layout

```
h/<hash of house name + password>
  meta/        { house, passHash, passSalt, lang }
  members/<id>      expenses/<id>     settles/<id>
  archives/<id>     activity/<id>     debts/<id>     recurring/<id>
  tombs/<collection>/<id>   when that record was deleted

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

`migrateStoredPass` also derives `cpath` while the plaintext is still in hand:
that is the only moment it can, and without it a phone that was already
logged in came back from the update with no path and stopped syncing.

`connectHouse(path)` is how both boot and a manual reconnect attach. It takes
the private path when that holds something, and otherwise looks for the house
on the old `houses/<name>` path and moves it. Writing to the private path
without that check would upload a second copy of the house beside the one
everyone else is still using.

Rejoining merges rather than replaces: `mergeCloudInto` takes everything the
cloud has that this device lacks and keeps everything it already had, then
`cloudFlush()` sends the difference up. `applyCloud` replaces state wholesale,
which is right for a live update and wrong for a device rejoining after a
spell on its own — it would drop whatever was recorded while it was alone.

## Deletions

A merge is a union, and a union cannot tell *"I have never seen this record"*
from *"I deleted this record"*. Absence alone therefore brought deleted
expenses back: a phone that had been offline still held the record, the merge
on rejoining treated it as news, and `cloudFlush()` then pushed it up to
everyone. The same happened whenever a device rejoined an older snapshot, or
restored a backup taken before the delete.

So a deletion is *recorded*, not merely allowed to happen. `S.tombs` holds,
per collection, when each removed id was removed, and it syncs like any other
child path. The nesting is not decoration: a Realtime Database key cannot
contain a slash, so a flat `"expenses/<id>"` key is rejected outright — and it
lets `cloudFlush()` send one marker at a time, so two phones deleting at once
do not overwrite each other's markers.

| | |
|---|---|
| `noteDeletions()` | diffs each save against the last and marks what vanished |
| `isTombed(c, id)` | whether a record is known to be deleted |
| `applyTombs()` | drops any tombed record that has crept back into `S` |
| `mergeTombs(t)` | unions an incoming set, latest timestamp winning |
| `pruneTombs(d)` | forgets markers older than `TOMB_TTL` (90 days) |

Deletions are spotted centrally rather than at each call site: `save()` calls
`noteDeletions()` first, so every path that removes something is covered —
deleting an expense, removing a member, undoing a settle, closing a month,
deleting an archive — with no need for each of them to remember. A record
that reappears as a genuine re-creation, which recurring expenses do because
they derive their ids, clears its own marker.

`mergeCloudInto` and `applyCloud` both merge the incoming markers **before**
merging records, skip anything tombed, and then `applyTombs()`. A device that
has been away therefore learns about the deletion in the same snapshot that
carries the record, and never re-uploads it. Markers are pruned after 90 days
— longer than any phone is plausibly stale — so `tombs` cannot grow forever.

### Starting over

Settings → Backup → **Erase everything** clears the house for the whole
group. It tombstones every record before emptying the collections, so the
deletion reaches other devices as a deletion rather than as an empty state
they would helpfully refill. It then waits for that flush to land and wipes
the device: every `localStorage` key above, the service worker's caches, the
registration itself, and finally a reload. Two confirmations guard it, and
the second says plainly that it is for everyone.
