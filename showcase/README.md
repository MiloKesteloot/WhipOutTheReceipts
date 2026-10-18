# Showcase screenshots

Takes the screenshots for the portfolio page, against a local copy of the app
filled with made-up data. Same data and settings in, same images out.

```
npm run screenshots                  # reset the local database, seed it, take every shot
npm run screenshots -- phone-todo    # only the shots with these names
npm run screenshots -- --no-reset    # keep the current local data (when only shots.json changed)
npm run screenshots -- --force-reset # reset even if the database has data that isn't from this script
```

Needs Docker running. It starts the local Supabase if it isn't already up
(`npx supabase@2.121.0 start`), and refuses to run against anything that isn't
local. Takes about two minutes. It won't reset a database that has accounts or
receipts it didn't create, unless you pass `--force-reset`.

## demo-data.json

- `today`: what the app thinks the date is. Receipts are placed relative to it.
- `viewer`: whose account the screenshots are taken from.
- `people`: everyone in the group. Each gets an account (`<first>@example.com`, password `demo-password-123`).
- `receipts`: the hand-written receipts the shots focus on. `key` is how `shots.json` refers to one.
  - `daysAgo`, `store`, `category`, `paidBy`, `tax`, `tip`, `fees`
  - `members`: who's on the receipt (default: everyone)
  - `items`: `claimedBy` is who had it (default: every member who has checked in). `alwaysSplit` splits it with everyone.
  - `meals`: groups of items, like one order per person at a restaurant
  - `notCheckedIn`: people who haven't gone through the receipt yet
  - `settled`: people who have already paid the payer back
- `history`: older receipts generated from a seed, to fill out Stats and Balances.
  Each store is visited every `everyDays`, picking `itemsPerTrip` items from its list
  (`[name, price]`, or `[name, price, true]` to always split).

## shots.json

- `outDir`: where the images go (the portfolio's `project-assets/receipts`).
- `appAssets`: copies of some shots for the app's own landing page. `outDir` is
  where they go (`public/landing`); `files` maps each file name to the width it's
  resized to (`null` keeps it as is).
- `devices`: viewport size and pixel density for `phone` and `desktop`.
- Each shot: `name` (file name), `device`, `path` (an app route; `{tj}` becomes that receipt's id), and optionally:
  - `sessionStorage` / `localStorage`: values set before the page loads, e.g. `"home-view": "calendar"`
  - `steps`: `{ "click": selector }`, `{ "fill": [selector, text] }`, `{ "scrollTo": selector }`, `{ "scrollBy": pixels }`, `{ "wait": ms }`
  - `fullPage`, `element` (screenshot just that element), `viewport` (override the device size), `settle` (ms to wait before the shot)
