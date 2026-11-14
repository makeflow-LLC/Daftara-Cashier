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
index.html, styles/app.css     app shell and the whole design system (tokens, components; always light)
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

## Products, images, scanning (milestone 1)

- `src/features/products/` — list (Arabic-normalized search, category chips, chunked rendering, lazy
  thumbnails), product form (prices, opening stock as a movement, packs, expiry, quick-item, images),
  rapid-add (continuous scanning, minimal sheet for unknown barcodes), categories. `repo.js` holds the data logic.
- Scanner: `@capacitor-mlkit/barcode-scanning`, with Gradle substituting the **unbundled** Play-services
  ML Kit model (`android/build.gradle`) so the APK stays small; manual entry is always available.
- Images: compressed on device to WebP ≤800px (~100KB) + 160px thumbnail (`src/core/media.js`), kept in
  the device DB for offline viewing, uploaded to Storage `cashier-media/<shop_id>/products/` after sync
  (`src/sync/media.js`). Other devices download thumbnails only when a row is visible.
- Shared barcode catalog: naming a real barcode queues `{barcode, name}`; it is sent after sync, and
  unknown scans get a suggested name. Internal barcodes (EAN-13 starting with 2) are never shared.

## Sale screen and payments (milestone 2)

- `src/domain/cart.js` — pure: lines (pieces, packs, fractional units), line and invoice discounts,
  totals and profit after transfer fees, split payments, cash change, credit validation, `buildSale`
  and `buildReturn` (refund share of the invoice discount, never more than sold). Fully unit-tested.
- `src/features/sale/` — POS screen (inline camera window over the native preview, search, quick items,
  steppers, line editor, discount, customer, hold/resume, crash-safe current cart), pay sheet
  (cash with change and foreign currency, transfer methods with fee %, credit, split), returns.
- A sale is one transaction: invoice + lines + payments + stock movements + customer credit entry.
  Invoice numbers come from a per-device counter (`A-0001`, returns `A-R0001`).
- Migration `0002` adds `cashier_invoice_lines.position` (run it if you already ran `0001`).

## Customers and debts (milestone 3)

- `src/domain/ledger.js` — pure: balance and running statement, oldest unpaid debt, phone → WhatsApp
  number, reminder and statement texts, Daftara backup parser (decimals → agorot).
- `src/features/customers/` — list (largest debt first, total owed), customer page (two big buttons:
  payment received / new debt), statement with invoice receipts, WhatsApp reminder and statement,
  call, edit/delete with undo, and **Import from Daftara** (pick the Daftara backup JSON; re-importing
  never duplicates).
- The scanner counts a barcode once while it stays in view; move away and scan again (or use +) for more.

## Inventory (milestone 4)

- `src/domain/inventory.js` — pure: purchase invoices (packs → base units, per-unit cost), alerts
  (out, low, expiring ≤30 days, dead ≥60 days), suggested reorder quantity and WhatsApp text, stock count diffs.
- `src/features/inventory/` — hub (actions, stock value, alerts, reorder to supplier), purchase screen
  (scan/search, qty + cost, new product inline, paper-invoice photo, cash or on account), suppliers
  (balances, pay, statement), stock count (scan → actual → adjustments + difference value), damage.
- A purchase sets each product's cost to the new weighted average and logs it in price history.

## Invoices and sharing (milestone 5)

- `src/domain/invoice.js` — pure: one receipt model (no cost/profit) for screen, image, text and PDF;
  WhatsApp text; invoice history filter (number, party, product, type, date); `pdfFromJpeg` (no library).
- `src/features/invoices/` — canvas renderer (device shapes the Arabic), share (image / PDF / text),
  history screen. The receipt sheet has an optional one-tap «أرسل واتساب».
- Android: `InvoiceSharePlugin` opens WhatsApp (or WhatsApp Business) on the customer's chat with the
  file attached; falls back to the system share sheet.

## Cash closing (milestone 6)

- `src/domain/cash.js` — pure: expected drawer (opening + cash in − cash out), totals per transfer
  method and credit, closing result (match / over / short), WhatsApp summary text.
- `src/features/cash/` — drawer screen: live expected cash, close with one number (counted cash),
  optional start-of-day opening cash (suggested from the last closing), closings history.
  Selling never depends on opening the drawer.

## Reports (milestone 7)

- `src/domain/reports.js` — pure: period ranges, `buildReport` (sales, returns, profit, per day, best and
  least sellers, by category, by payment method), `reportSections` (one model for screen, PDF and Excel;
  hides profit/cost for non-owners), `reportSheets`.
- `src/features/reports/` — one page with period chips, daily bars, tables, and PDF / Excel export
  (`vendor/xlsx.js` is Daftara's library-free xlsx writer, loaded only on export).

## Tools (milestone 8)

- `src/domain/files.js` — pure, no libraries: inflate (RFC 1951), zip reader, xlsx reader (first sheet),
  CSV parser. `src/domain/tools.js` — import column guessing and row conversion, bulk price changes with
  rounding, EAN-13/EAN-8 module encoding for labels, backup validation.
- `src/features/tools/` — Excel/CSV import with a column-mapping screen, products export, bulk price
  update with preview and undo (price history batch), A4 label sheets (3×8) as multi-page PDF,
  backup and restore (`src/core/backup.js`; images are not included).

## Usability pass

- Navigation: «المزيد» is a hub of large colored tiles (reports, invoices, drawer, inventory, suppliers,
  tools, settings, help, feedback); settings holds shop configuration only.
- Home: colored header with today's sales, tappable pills, a three-step "start here" guide for new
  shops, and a beta banner that opens the feedback sheet.
- `src/features/help/` — FAQ with search and deep links, and feedback (bug / feature request / note)
  sent to MakeFlow on WhatsApp with app version and shop name.
- Product form shows only the essentials; the rest is under «خيارات إضافية». Sale screen buttons carry
  visible labels. Tajawal font (two weights, 18 KB) and light page transitions.

## Licensing (milestone 9)

30-day free trial from install, then 30 ₪/month or 300 ₪/year. After expiry (plus 3 grace days for paid
plans) the app is **read-only**: selling, purchasing and product edits are locked; reading, reports, debt
payments and backup stay open.

- `src/domain/license.js` — pure: state machine (trial / active / grace / expired / blocked), device code,
  activation code format (`DCS-<payload>.<Ed25519 signature>`, payload = device | expiry | plan).
- `src/core/license.js` — service: trusted clock (never goes back), stored code re-verified on every start,
  `guard()` used by `store.js` (locked tables throw), `gate()` used by the sync engine (asks the server).
- `src/features/subscribe/` — status, plans, WhatsApp request with the device code, paste-the-code activation.
- Why editing the code no longer unlocks it (the Daftara crack):
  1. Activation codes are **signed by MakeFlow's private key** for one device; the app only holds the public key.
  2. `Integrity.java` compares the installed APK's signing certificate with the one recorded at build time
     (`BuildConfig.CERT_SHA256`): a modified, re-signed APK refuses to start (the emulator test checks this).
  3. The **server** enforces it too (`0003_licensing.sql`): RLS rejects writes from a shop without a valid
     trial/subscription, verifies codes with Ed25519 in SQL, and ties the trial to the device so reinstalling
     or creating a new shop does not restart it.
- Owner tool: `tools/license-generator.html` (one offline file, built by `node scripts/build-generator.mjs`).
  Paste the private key (the same Ed25519 key as Daftara), the customer's WhatsApp request, pick the plan → code.
- Manual activation without a code (Supabase SQL editor): see the header of `0003_licensing.sql`.
- `play` flavor: `BillingPlugin.java` (Google Play subscriptions `cashier_monthly`, `cashier_yearly`).
  Server-side verification of Play purchases (Play Developer API) is not done yet.

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

1. Supabase Studio → SQL Editor → run `supabase/migrations/0001_init.sql`, then `0002…`, then `0003_licensing.sql` (each safe to re-run).
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
