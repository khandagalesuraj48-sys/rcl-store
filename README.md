# RCL ERP – Store

The Store module of RCL ERP. **Now:** the Item Master. **Later (each its own step):** Inward, Outward, Purchase Requisition.

* **Sign-in only through the Portal.** The Portal sends the person here with a one-minute signed ticket. Nobody signs in here.
  The Portal gives Store access per site, as Admin or User.
* **One site = one database.** The Store writes to the database of the site the person opened, the same Supabase project
  as Mechanical. **Change site** at the top of the dark menu goes to another of his sites through the Portal.
* **Every site its own Item Master (15-10-2026, asked by the owner: "vtr che item vtr la, 18 b che 18 b la – mix nko").** It
  replaces the one Item Master for every site of 14-10-2026. A site sees, checks and uses only its own items; the same name may
  be at two sites. An item of another site is not shown, changed or deleted.
  * The Item Code stays ONE numbering for all sites (ITM-0001 …: the next after the highest of every site) – no code is given
    twice and the codes already given never change.
  * No SQL step: nothing new is stored, nothing is deleted.
* **Item Master** fields: Item Code (given by the database: ITM-0001 …), Item Name, Unit, Category, HSN Code, GST %, Min Stock, Status.
  * **Add:** Admin and User. **Change, delete, import:** Store Admin. **List and export:** everybody signed in.
  * **Duplicates:**
    * The same name (capitals, spaces and signs do not count) is never saved twice.
    * A **near** name ("Sugaar" when "Sugar" is there; "Filter Oil" vs "Oil Filter"; "Belts" vs "Belt") is asked first:
      it is saved only when the person says it is a different item. Who said so is kept with the item.
    * Different numbers are different items ("Bolt M10" / "Bolt M12").
    * A near category is asked the same way.
  * **A proper name is suggested, never forced:** spelling of usual store words, capitals, and a unit after a number ("10mm" → "10 mm").
  * **Excel:**
    * Export: all items.
    * Import (Admin): every row is checked first.
      * Already there → left out.
      * Near name → must be ticked "different item".
      * A mistake or the same name twice in the file → nothing is imported until the file is corrected.
    * The import is one write: all of it or nothing.
    * Item Codes of another site's file are not used; this site gives its own.

## Parts
| Part | File |
|---|---|
| The page (dark menu, Item Master, Excel) | `public/index.html` (Excel tool: `public/vendor/`) |
| Sign-in with the Portal's ticket / who is signed in / sign out | `api/sso.js`, `api/me.js`, `api/logout.js` |
| Item Master (list, check, save, delete, import) | `api/items.js` |
| The rules of an item (names, near names, suggestions, fields) | `lib/items.js` |
| Which database is a site's | `lib/sites.js` (Mechanical's list of sites, `rcl_sites`) |
| Ticket check, sign-ins, activity record | `lib/portal.js`, `lib/session.js`, `lib/activity.js` |
| Database (run once in EVERY site's Supabase) | `sql/store_step1_items.sql` |

## Settings (Vercel → the Store project → Settings → Environment Variables – never in a file)
| Name | What |
|---|---|
| `PORTAL_URL` | the Portal's address, e.g. `https://rcl-portal-flame.vercel.app` |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | the FIRST site's (VTR) – the same values as in the Mechanical project |
| `SITE_<CODE>_KEY` | each other site's secret key, e.g. `SITE_18B_KEY` – the same as in the Mechanical project |
| `RCL_SITES_KEY` | only if a site's key is kept locked in Mechanical's list (update-90 sites) |

## Tests (local test rig only – never the live databases)
```
timeout 120 node --test test/unit.test.js     # no database
timeout 300 node test/api.test.js             # rig: Portal :3010, Store :3020, site databases :3100 / :3102
timeout 400 node test/browser.test.js         # rig + Chromium; pictures in test/shots/
```

## One address (13-10-2026)
The Store is also served under the main address, `https://oneclicksolution-erp.vercel.app/store/`. Mechanical's `vercel.json`
rewrites `/store/:path*` to this project, so the installed app never opens a second window. Because of that:
* Every address the page uses is **relative** (`api/…`, `vendor/…`), so the page works at its own address and under `/store/`.
* `PUBLIC_URL` (Vercel setting, an address, not a secret) is set to `https://oneclicksolution-erp.vercel.app/store`. Changes
  sent from the page at that address pass the origin check (`lib/http.js`).
* `PORTAL_URL` may be the Portal under the main address: `https://oneclicksolution-erp.vercel.app/portal`.
* `public/menu.json` lists the Store's pages. The other modules show them in their dark menus, and a click opens
  `<store address>/#site=S1&page=items`.
* The page reads `#sso=…`, `#site=…` and `#page=…`:
  * another site goes through the Portal, which carries the page;
  * `#page` stays in the address, so a reload keeps the page.
* The other modules of the site are groups of the dark menu, each with its pages read from `<its address>/menu.json`.
  * A module whose menu cannot be read shows one line, "Open …", through the Portal.

## A Preview = the staging (TEST) copy (20-10-2026)
* On a Vercel **Preview** (`VERCEL_ENV=preview`), `lib/preview.js` asks the database first: it must have the row
  `app_settings.THIS_IS_A_TEST_DATABASE = 'yes'`. Only the staging database `rcl-staging` has it.
* A database without it (any live one) is refused with 503, "This is a Preview …". Nothing is read or written.
* The page shows an orange TEST band on a Preview.
* Live (`production`) asks nothing.
* The staging copy is the Preview of the branch `staging`. Its set-up (one SQL for Mechanical + Portal + Store, the Vercel
  Preview settings): `rclerp/staging/STAGING_SETUP.md`.

## Search from Mechanical's screen (13-10-2026)
Ctrl K in Mechanical also searches the modules shown inside it. Every module page gives:
```js
window.rclModule = { key, search(q) /* → [{ group, kind, title, sub, page, find }] */, open(page, find) };
```
The Store searches its Item Master: code, name, category, HSN, unit and status. All words must be found; when nothing is
found, a spelling mistake is allowed. `open('items', code)` shows Item Master filtered to that item. A new module that gives
these two is searched with no change in Mechanical.
