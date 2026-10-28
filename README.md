# RCL ERP – Store

The Store module of RCL ERP: the Item Master (step 1) and **the Store's work (step 2, 28-10-2026 – "sagle banwayla chalu kr")**:
Material Requirements and their approvals, Purchase (every site – HO Purchase), Purchase Orders, Inward (GRN), Issue & Return, Stock &
Reports, Opening stock & Numbers. The phone app has the same as its own screens (rcl-mobile 3.55.0).

* **Sign-in only through the Portal.** The Portal sends the person here with a one-minute signed ticket. Nobody signs in here.
* **A sign-in lasts 15 minutes** (23-10-2026; it was 12 hours): the open page asks the Portal for a fresh ticket every 10 minutes
  (`/api/go?…&json=1&renew=1` → `api/sso` with `renew`) and signs in again by itself. Whom the Super Admin removes in the Portal is
  out within 15 minutes ("You no longer have the Store on this site"); a new role (Admin / User, pages) shows at the next renewal.
  Rig test: `test/renew.test.js` (one-address mode).
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

## The Store's work (step 2 – `sql/store_step2_work.sql`, run once in EVERY site's Supabase)
* **Who may do what** – given by the Super Admin in the Portal (Users & Access → a user → Pages in the Store), per site:
  * **Material Requirements** (Edit = make, View = see), **Inward (GRN)** and **Issue & Return** (Edit / View), **Stock & Reports**
    and **Purchase Orders** (View). Not given = no access. A Store Admin has them all (and changes, deletes, imports, the opening
    stock and the numbers).
  * **Approves requirements – Level 1 … 5** (also for a Store Admin): any one person of the level a requirement waits for approves it
    (or rejects it, saying why), never his own; Level 1 first, then 2 … No approver at a site: a requirement is approved when made.
    One who approves sees the Requirements (View) even when that page is not given. The Portal tells the Store who approves (a
    signed ticket, `api/portal.js` → `store_settings` 'approvers') whenever pages or roles are saved; if the Store could not be told,
    the Portal says so – save again.
  * **Store Purchase – every site (HO)** (also for a Store Admin): the approved requirements of every site still to order → a
    purchase order of that site (kept in that site's own database), its Change / Cancel / Close, the POs of every site.
* **Material Requirement:** date, needed by, for (site work / a machinery / office / other), its items (with the stock now). Changed
  only while nobody has approved it; cancelled while nothing of it is ordered; an approved one is closed when the rest will not be bought.
* **Purchase Order:** vendor (a name nearly one written before is asked), GST no., delivery by, terms; its lines (from the
  requirements – never more than asked – or any item), rate, GST %. A PO's paper with its site's company on top.
* **Inward (GRN):** against a PO (its lines still to come; more than the PO still has is asked first) or direct (a bill); supplier,
  challan, invoice, vehicle, TCS. Its basic rate makes the item's average rate.
* **Issue (Outward):** to site work, a sub-contractor, a machinery (its reading – on the site on that date; it joins the machinery's
  maintenance log book in Mechanical, Party "RCL Store") or the office; location (chainage), side, use for, receiver; returnable and
  serial no; on debit (charged with GST). **Return:** what is still out comes back.
* **The stock never goes below zero on any date** (checked inside the database – one save at a time on a site).
* **Reports:** stock (on a date), stock statement (a day / month / period), item ledger, GRN register, issue register, consumption
  (by party / machinery / use / location / item), returnable out, requirements, purchase orders – shown, Excel, print.
* **Excel import (Store Admin):** his INWARD (GRN) and OUTWORD (Issue) registers in his columns – every row checked first, then all
  or nothing; the opening stock (Item, Qty, Rate, Date).
* **Numbers:** where the GRN and Outward numbers go on from (only higher than the last one used).
* Files: `api/work.js` (every action and its check), `lib/work.js` (the rules), `lib/sreport.js` (the reports),
  `public/work.js` (the pages), `api/portal.js` (who approves – from the Portal), `sql/store_step2_work.sql`.

## Parts
| Part | File |
|---|---|
| The page (dark menu, Item Master, Excel) | `public/index.html` (Excel tool: `public/vendor/`) |
| Sign-in with the Portal's ticket / who is signed in / sign out | `api/sso.js`, `api/me.js`, `api/logout.js` |
| Item Master (list, check, save, delete, import) | `api/items.js` |
| The rules of an item (names, near names, suggestions, fields) | `lib/items.js` |
| Which database is a site's | `lib/sites.js` (Mechanical's list of sites, `rcl_sites`) |
| Ticket check, sign-ins, activity record | `lib/portal.js`, `lib/session.js`, `lib/activity.js` |
| Database (run once in EVERY site's Supabase, in this order) | `sql/store_step1_items.sql`, `sql/store_step2_work.sql` |
| The Store's work (step 2) | `api/work.js`, `lib/work.js`, `lib/sreport.js`, `public/work.js`, `api/portal.js` |

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
timeout 300 node test/paging155.test.js       # rig: 2,500 items, an import, lost answers (starts its own Store on :3021; SRC=<tree>)
timeout 600 node test/work.test.js            # rig: the Store's work – requirements, approvals, POs, GRN, issues, returns, reports
timeout 600 node test/work.browser.test.js    # rig + Chromium: the work pages (also on a phone's width)
```

## Fewer reads, every item, no second copy (24-10-2026, with Mechanical's update-155)
* **Every item, page by page** (`lib/sites.js` `dbAll`): the database gives at most 1,000 rows to one question, so the list, the
  name check and the next Item Code stopped at 1,000 items without a word. Now pages of 1,000 in the order of the code.
* **An import** reads the codes of every site once (was: once for every row added).
* **The name check while typing** takes this server's copy of the site's short list when it is under 15 seconds old (emptied by its
  own saves). It only suggests: the save checks again with every row read afresh.
* **The list and the name check answer "the same" / only what changed** to the page (`lib/delta.js` – the same file as
  Mechanical's; `lib/http.js` `sendKept`; the page's `look`): kept in the page's memory only, checked against the server's
  fingerprint, emptied at every sign-in and sign-out.
* **A new item is not sent twice:** after no answer at all from the database it may have been saved – the person is told to look at
  the list (no false "DUPLICATE"); a change or a delete is asked again as before (done twice, they leave the same), and so is a
  new item that never left this server (no connection at all).
* **A tab in the background does not renew the sign-in** (it is renewed the moment it is looked at again).

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
