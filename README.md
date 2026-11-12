# دفترة كاشير — Daftara Cashier

Offline-first point of sale, inventory, invoicing and reporting for small shops in Gaza
(groceries, clothing, fabrics, phone accessories, pharmacies, stationery). Arabic, RTL,
Western numerals, one-hand use. Made by **MakeFlow**.

Same stack and conventions as Daftara (the debt ledger app):

- Vanilla HTML / CSS / ES modules — no framework, no bundler. Light on cheap Android phones.
- [Dexie.js](https://dexie.org/) over IndexedDB as the on-device database (`vendor/dexie.min.js`).
- [Capacitor 8](https://capacitorjs.com/) wraps the same web files as an Android app (minSdk 26 = Android 8).
- Self-hosted Supabase (the same instance as Daftara) for sync, with this app's own `cashier_*` tables.

## Layout

```
index.html, styles/app.css     app shell and the whole design system (tokens, components, dark mode)
src/main.js                    boot: opens the device DB, first-run setup or home
src/core/                      app context, DB schema (db.js), the single write path (store.js), router, queries
src/domain/                    PURE business logic — no DOM, no DB, fully unit-tested
  money.js currency.js         integer money (minor units), parsing/formatting, exchange rates (×1,000,000)
  units.js                     quantities ×1000 (fractional meters/kg), pack conversions
  stock.js                     stock = sum of movements, weighted average cost
  numbering.js                 offline-safe invoice numbers (device letter + sequence: A-0042)
  features.js                  shop types → enabled features, defaults
  merge.js                     sync conflict rules (last-write-wins / append-only)
src/sync/                      tables registry, tiny Supabase client (fetch only), sync engine, scheduler
src/ui/                        DOM helper, icons (inline SVG), components, sheets, undo toasts, scan feedback
src/features/<module>/         one folder per feature module; register routes in src/features/index.js
supabase/migrations/           server schema (RLS on every table); supabase/tests/ runs it on real Postgres
tests/                         node --test: domain, store, two-device sync, schema ↔ app column match
android/                       Capacitor project, flavors `direct` and `play`
```

Adding a module = a new folder in `src/features/` + one entry in `src/features/index.js`.
Nothing else needs to change.

## Data rules (non-negotiable)

- **Money** is an integer in the smallest unit (agorot for ₪). **Quantities** are integers ×1000.
  No floating point anywhere in a calculation.
- **Stock is never a stored number.** Every change is an `inventory_movements` row
  (sale, purchase, return, adjustment, damage…); stock is their sum. The local `stock` table is a
  cache rebuilt from movements.
- Every record has a client-generated UUID and a `shop_id`. Deleting = `deleted: true`.
- Movements, payments, invoice lines, customer/supplier entries and price history are **append-only**.
  Products, customers, settings… are **last-write-wins** by `updated_at`.
- Everything goes through `store.write(...)`: one transaction writes the rows, queues them in
  `outbox` and updates the stock cache.

## Sync

The device database is the source of truth for the UI; the app never waits for the network.
`src/sync/engine.js` pushes the outbox (oldest first, parents before children, bad rows isolated)
and pulls only the tables whose `cashier_shop_heads` counter moved — one small request when nothing
changed. The server stamps every write with `server_seq` under a per-shop lock, so a pull can never
miss a row, and rejects edits older than what it has.

Auth: the device signs in **anonymously** the first time it is online (no form to fill). Linking a
phone number + password to move to another phone comes in a later milestone.

### Server setup (once)

1. Supabase Studio → SQL Editor → paste `supabase/migrations/0001_init.sql` → Run (safe to re-run).
2. Auth settings: enable **anonymous sign-ins** (`GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=true`).
3. GitHub → Settings → Secrets and variables → Actions: add `SUPABASE_URL` and `SUPABASE_ANON_KEY`.
   Without them the app builds and works fully on the device, with sync off.

Licenses live in `cashier_licenses` (`is_active`, `plan`, `expires_at`); only MakeFlow edits them.

## Build, test, release

Every push runs `.github/workflows/android.yml`: unit tests, schema tests on Postgres, the APKs
and AAB, a size report (in the run summary), a smoke test on an Android emulator, and publishes the
APK as the rolling **preview** pre-release:
`https://github.com/makeflow-LLC/Daftara-Cashier/releases/download/preview/daftara-cashier.apk`

Preview builds are signed with `android/app/preview.keystore` (testing only, so each preview installs
over the previous one). Real releases use the key from the `ANDROID_KEYSTORE_*` secrets — always the
same key for every release.

Local: `npm ci && npm test && bash supabase/tests/run.sh`; try it in a browser with `npm run serve`.
