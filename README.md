# බෝඩිම — Bodime

A shared-expense app for a Sri Lankan boarding house. Everyone in the house
logs in with the same house name and password, adds what they spent, and the
app works out who owes whom. Sinhala and English, installable, and usable with
no connection.

It is one HTML file. Open it, host it, or email it to your housemates — there
is no build step, no bundler and no server to run.

## Features

- **Expenses** split equally, by exact amounts, or by shares. Totals always
  land on whole rupees, with no stray cents that can never be settled.
- **Balances** simplified to the fewest payments that clear the house, with a
  per-person breakdown and per-expense payment ticks.
- **Recurring monthly expenses** for rent, wifi and the gas bill.
- **"Money I owe"** — debts to people outside the house, with part payments
  and due dates, shared with the rest of the house.
- **Reports** by day, week or month, with a where-it-went donut, a per-person
  spend chart, a trend, a private personal budget, and CSV export for a
  spreadsheet. A House / Mine switch shows either the whole house's figures
  or just your own.
- **Personal expenses** — what you spent on yourself, kept on your phone and
  never synced to the house, counted in your own report and budget.
- **Month close** that files everything into an archive and starts fresh.
- **Search and filters** over the history by text, person and period.
- **Offline** — the app opens and works with no connection; changes sync when
  it comes back.
- **Sinhala and English**, switchable at any time, including on the login
  screen.

## Running it

Any static host will do. Locally:

```sh
npm run serve        # http://localhost:8099
```

A service worker only registers over http/https, so opening `index.html`
straight off the disk works but will not install as an app.

### GitHub Pages

Settings → Pages → Deploy from a branch → `main` / root. The app is then at
`https://<user>.github.io/<repo>/`. Everything is relative, so it needs no
configuration for the subdirectory.

## Pointing it at your own Firebase

The app syncs through Firebase Realtime Database. A project is already baked
into `index.html`; to use your own:

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. Add a **Realtime Database**.
3. Project Settings → Your apps → add a **Web app**, and copy `firebaseConfig`.
4. Paste it over `BUILTIN_FB_CFG` near the top of the script in `index.html`.
5. Apply the rules in [`database.rules.json`](database.rules.json) — paste them
   into the Rules tab, or run `npm run deploy:rules` (needs the Firebase CLI
   and `firebase login`; `.firebaserc` already names the project).

Everyone you then send the file to shares that database; they only ever type
the house name and password.

Leaving `BUILTIN_FB_CFG` empty makes the app local-only, with a place in
Settings → Cloud for a user to paste their own config.

## How private is it?

Be clear-eyed about this. The app has no server and does not use Firebase
Auth, so the database cannot tell one visitor from another. What it does:

- The house password is **never stored or transmitted in the clear**. Only a
  salted, 2000-round SHA-256 of it is kept, on the device and in the database.
- A house lives at `h/<hash of house name + password>`. Knowing the house name
  is not enough to find, read or write its data.
- No node is listable. `names/<house>` exists so Register can warn about a
  duplicate name and Login can tell a wrong password apart from a house that
  was never created; it holds nothing but a timestamp.
- A house node cannot be deleted wholesale, and the rules reject any attempt
  to write a plaintext password.

What that does **not** give you: anyone who learns a house's path — by being
told the password, or by having once been in the house — can read it forever.
For a database that is private in a stronger sense, add Firebase Anonymous
Auth and gate reads on `request.auth != null`. That needs a change to both the
rules and the app.

Houses created by an older build, which stored the password in the clear at
`houses/<name>`, still log in with that password and are migrated on the way
through: the data is copied to the private path first, and only once that copy
has landed is the old node replaced with a tombstone.

### Applying the rules is the last step, not the first

The rules make `houses/<name>` accept nothing but a tombstone. A phone still
running an older build writes its expenses there, so applying the rules before
every phone has moved across will stop those phones saving anything.

In order:

1. Ship the new build and let every phone open it once.
2. Any phone showing *"Not syncing"* — tap **Connect** and enter the house
   password.
3. Check the database: the house should be under `h/<hash>`, and
   `houses/<name>` should read `{"moved": 1}`.
4. Only then apply the rules.

## Updates

`sw.js` caches the app shell. **Bump `VERSION` in it whenever you ship**, or a
phone with the app installed is never offered the new build — it only reaches
someone who happens to navigate. The new worker installs alongside the running
one and waits; the page notices, offers an update bar, and swaps only when the
user taps it, never mid-expense.

### If a phone stops syncing after an update

A house's cloud location is derived from its password, and the password is
only ever held for the moment it takes to hash it. A phone that was already
logged in when the private-path change first landed came back from it with no
location, and quietly went local-only.

Such a phone now says so: a bar above the nav reads *"Not syncing — changes
stay on this phone"*, with a **Connect** button that asks for the house
password once. It then finds the existing house — including one still on the
old path — merges anything recorded while it was alone, and syncs from then
on. Nothing is lost and no second copy of the house is created. Each phone in
the house needs this once, if it is affected.

The same bar appears whenever a phone is logged in but not syncing for any
other reason — usually a connection that was down when the app opened. There
the button reads **Retry**, and the app retries on its own anyway: with a
backoff up to a minute, and immediately when the device reports it is back
online or the app returns to the foreground.

## Tests

```sh
npm install
npm test                       # all suites
node tests/run.js auth csv     # just those
```

The suites drive the real app in Chromium against an in-memory stand-in for
the Realtime Database, and block every request off localhost — `index.html`
carries a live Firebase config and no test may reach it.

| Suite | |
|---|---|
| `auth` | registering, logging in, migrating a house off the old path |
| `sync` | connection state, offline edits, edits made in place |
| `rejoin` | a phone that updated mid-session finding its way back |
| `history` | search and filters |
| `recurring` | monthly rules, the date maths, catching up |
| `report` | the category donut, and Sinhala labels rendering as text |
| `personal` | private expenses and the House / Mine scope |
| `debts` | the debt row and sheet laying out, and CSS class collisions |
| `csv` | spreadsheet output |
| `service-worker` | installing offline and the update handshake |

## Layout

| File | |
|---|---|
| `index.html` | the whole app — styles, markup, logic, and the Firebase SDK bundled in |
| `sw.js` | service worker: offline shell and the update handshake |
| `manifest.json` | PWA manifest |
| `database.rules.json` | Realtime Database rules |
| `tests/` | browser tests |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | what is stored, where, and how it syncs |

### Why one file

Because the distribution method is "send it to your housemates". A single file
opens from a WhatsApp download, a USB stick or a web host with equal success,
and the Firebase SDK is bundled in so it works with no connection on first
run. Splitting it into modules would need a build step and would break that.
