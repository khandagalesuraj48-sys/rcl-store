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
* **Material Requirement:** date, needed by, for (site work / a machinery / office / other), its items (with the stock now) – each
  with its **Brand** and **Material specification** (28-10-2026; carried into the PO made from it – the PO form, its list, its paper
  and the Excel show them; HO Purchase can change them in the PO). Changed
  only while nobody has approved it; cancelled while nothing of it is ordered; an approved one is closed when the rest will not be bought.
* **Purchase Order:** vendor (a name nearly one written before is asked), GST no., delivery by, terms; its lines (from the
  requirements – never more than asked – or any item), rate, GST %. A PO's paper with its site's company on top.
* **Inward (GRN):** against a PO (its lines still to come; more than the PO still has is asked first) or direct (a bill); supplier,
  challan, invoice, vehicle, TCS. Its basic rate makes the item's average rate. **The form (28-10-2026, his picture):** two cards –
  *GRN Details* (Clear and the GRN Date at its top right; Against PO · Supplier · Challan No; Invoice No · Invoice Date · Vehicle No ·
  TCS ₹; the Remark box) and *Items* (+ Add Row; the item's search box, Received Qty, the Unit – the Item Master's, as the stock is
  counted in it –, Basic Rate, GST %, Taxable / GST / Gross worked out, the line's Remark, a bin on each row; the Total, the TCS on its
  own row); Save GRN · Cancel. Clear asks first: a new GRN empty again, a GRN being changed back as it is saved. **The GRN No**
  (28-10-2026, step 4 below) at the top right: the next number by itself, it can be changed by hand. **The list** comes when
  **Show** is pressed (**Hide list** takes it away again): each GRN a card – its GRN No, date, supplier, invoice, challan, vehicle, PO, TCS and gross at the top, its
  materials under it (Sr No, Material Description, Received Qty, UOM, Basic Rate, Taxable / GST / Gross Amount, Remark); the GRN
  register (Excel) has every column on each row.
* **Issue (Outward):** to site work, a sub-contractor, a machinery (its reading – on the site on that date; it joins the machinery's
  maintenance log book in Mechanical, Party "RCL Store") or the office; location (chainage), side, use for, receiver; returnable and
  serial no; on debit (charged with GST). **Return:** what is still out comes back.
* **The stock never goes below zero on any date** (checked inside the database – one save at a time on a site).
* **Reports:** stock (on a date), stock statement (a day / month / period), item ledger, GRN register, issue register, consumption
  (by party / machinery / use / location / item), returnable out, requirements, purchase orders – shown, Excel, print.
* **Excel import (Store Admin):** his OUTWORD (Issue) register in his columns – every row checked first, then all or nothing; the
  opening stock (Item, Qty, Rate, Date). His INWARD (GRN) register: the register's import (step 3, below).
* **Numbers:** where the GRN and Outward numbers go on from (only higher than the last one used).
* Files: `api/work.js` (every action and its check), `lib/work.js` (the rules), `lib/sreport.js` (the reports),
  `public/work.js` (the pages), `api/portal.js` (who approves – from the Portal), `sql/store_step2_work.sql`.

## The old inward register (step 3 – `sql/store_step3_grn_import.sql`, run once in EVERY site's Supabase; 28-10-2026)
His "INWARD UPTO GRN … .xlsx" (or any file with the register's headings) – Inward (GRN) → **Import from Excel** (Store Admin):
* **The sheet:** every sheet of the file is read; the register's is the one with GRN No / GRN Date, Supplier Name, Material
  Description, Received Qty … and the most rows (the Summary and the material sheets are left). A heading of two lines in a cell is
  read as one. A GRN's date, supplier, invoice, challan and vehicle are on its first row only – the rows under it of the same GRN No
  take them. Dates as Excel writes them or typed (30-11-2022, 30-Nov-2022).
* **The check (nothing saved):** the GRNs to import (a GRN No + date + supplier + invoice is one GRN; the same GRN No of another
  supplier / day / invoice is a GRN of its own), those already in the Store (left out – never twice), the new suppliers, the new items,
  the next new GRN.
  * **Duplicate rows** (every column the same as an earlier row): shown; he deletes what is a mistake; what he does not delete is
    imported as it is.
  * **Rows to look at** (no material, no quantity, not a date, after today, a date far from the GRNs around it): corrected on the page
    (date, supplier, material, qty), else left out.
  * **Names written in more than one way:** the AI (Claude – `ANTHROPIC_API_KEY` of this project) reads the suppliers, items and
    categories in parts and lists the same name written differently; he ticks what is the same – saved with the right spelling.
    Without the key the names stay as in the file (the same letters – "Oil-Filter", "OIL FILTER" – are one name always).
  * **Notes** (imported as the file has them): an amount that does not add up, a unit not known (Nos), a row in another unit than its
    item's, an amount above ₹1 crore (check the qty and rate), a row without a GRN No joined to its GRN.
  * What he chose is kept in this browser for this file until the import is done. **Excel of the check** – every list.
* **Import** – a part at a time, each part whole or not at all: the suppliers (into the site's Vendor Master – Mechanical's – as
  "Material Supplier", GST / PAN / Aadhaar to be filled later), the items (Item Master codes; unit – the one most rows have; category –
  the Remark when 20 rows or more have it, else General; GST % – the usual one of its rows), then the GRNs (150 or 3,000 lines a part).
  A stop is said – Import again goes on (what is saved is never saved twice).
* **GRN No as in the file** ("342-A" too): a whole number not used yet is the GRN's number; else the GRN has a number of its own beyond
  1,000,000,000 and shows the file's GRN No. A GRN without a GRN No gets the next numbers. **The next new GRN goes on after the file's
  highest GRN No.** Counted in the stock (the Issue register next).
* **The GRN page** shows his register's columns (Sr No, GRN No, GRN Date, Challan No, Invoice No., Invoice Date, Vehicle No, Supplier
  Name, Material Description, Received Qty, UOM, Basic Rate, Taxable Amount, GST Amount, TCS, Gross Amount, Remark, PO No); the
  GRN register (Excel), the print, the ledger and the Dashboard show the GRN No. A line has its Remark.
## A new GRN with its GRN No (step 4 – `sql/store_step4_grn_no.sql`, run once in EVERY site's Supabase after step 3; 28-10-2026)
"new grn kartana new grn number auto yeil ok ani manually pn edit krta yeil": the new GRN's form shows the next number (`grnNext`);
it can be changed. Saved with the GRN in one go (`store_grn_new`): a whole number not used yet is the GRN's number and the next new
GRN goes on after it (when higher); another GRN No ("342-B") is kept as typed (a number of its own beyond 1,000,000,000); a GRN No
already used is refused – nothing saved, the next free one said; nothing typed – the next number. Before step 4 at a site: the number
as it came saves as before, a number typed by hand is refused with what to run. A saved GRN's GRN No is not changed. Only adds a
function. Rollback: `drop function public.store_grn_new(jsonb, jsonb, text, text, text);`.

* Files: `public/grnreg.js` (the page's reading and check – pure), `lib/grnimport.js` (the server's check of each GRN – pure),
  `lib/ai.js`, `lib/itemcodes.js`, `api/work.js` (`regInfo`, `regNames`, `regVendors`, `regItems`, `regGrns`), `public/work.js`.

## The assistant (Mechanical's Ask) reads the Store (28-10-2026, with Mechanical's update-185)
* Mechanical's Ask (the robot, web and phone app) answers about this site's Store too: the stock (now / on a date / below min), the
  stock statement, an item's ledger, the Inward (GRN) and Issue (Outward) registers, consumption, returnable items, requirements and
  purchase orders. It asks the Store itself – action `aiLook` of `api/work.js` (`lib/ailook.js`) – with the person's own Store sign-in:
  every look-up goes through the Store's own report (`ACTIONS.report`) and its access checks. It only reads. No database step, no new
  setting.

## The PO and the requirement in the company's own format; the PO's approval (step 5 – `sql/store_step5_po_format.sql`, run once in EVERY site's Supabase after step 4; 28-10-2026)
"he amche company che format ahet mala je po bantil requiremet bantil te same ya format amddhe hawet" (with his Diesel PO, Tyres PO
and the Exhaust Fans requirement): the PO's print is the Diesel PO's format, the requirement's print the Purchase Requisition Form.
* **Numbers as on his papers:** PO `RCL/VTR/PO/2026/0128`, requirement `RCL/VTR/PR/2026/0232` – the start (`RCL/VTR`) is the site's
  in Store Settings → **Papers** (by itself: `RCL/<site code>`), then PO / PR, the year of its date and the Store's own number. Only the
  print and the lists show it; the numbers themselves are as before.
* **The PO form** has his PO Details too: Credit Period (days), Site Contact, Shipping Address, Total Freight Charges, Total Load /
  Unload Amount; each line a **Disc. %** and its **HSN** (the item's own, or typed – 4, 6 or 8 digits). Taxable = Qty × Rate less the
  Disc. %; TOTAL AMOUNT = the lines + freight + load / unload; "Amount in word" in lakhs ("Two Lakhs … Only"). Site Contact, Shipping
  Address and the Terms & Conditions come filled from Papers – they can be changed on each PO.
* **The print** (A4): the logo and the company's heading (name, address, Email ID, Contact, CIN No, Web, GST No, PAN No – the company
  record and Papers); Supplier Details (name, address, mobile, e-mail, contact person, GSTIN – from the Vendor Master) beside PO Details
  (PO No., PO Date, Credit Period, Project Name, Site Contact) and the Shipping Address; the lines (S.N., Item Description- Specification,
  Brand, HSN, GST %, Qty, Unit, Rate, Disc. %, Amount); Total Disc. Amount, Gross Amount, Total GST Amount, Total Freight Charges,
  Total Load / Unload Amount, TOTAL AMOUNT (Rs.), Amount in word; Remark; Terms And Conditions; Prepared By / Approved By; "This
  Purchase Order is computer generated it does not require signature." **The requirement's print** – Purchase Requisition Form:
  Project Name, Sub Project (what it is for), Indent No., Date; Sr No, Item Code, Item Description, Item Specification, Unit,
  Quantity, Required Date; Remark; Prepared By / Checked By (the levels before the last) / Approved By.
* **The PO's approval:** the Super Admin ticks **"Approves purchase orders"** for a person in the Portal (Store pages of that site).
  A PO made there then **waits** ("Waiting approval", for whom); the ticked one sees **Approve** / **Reject** (a reason) in the PO list – never
  his own PO. A rejected PO is changed and saved – it waits again. **A GRN is taken in only on an approved PO.** Nobody ticked at a
  site: a PO is approved when made (as before). A PO made before step 5 counts as approved.
* **Before step 5 at a site:** the PO saves and prints as before (with the new numbers and heading); the new fields are refused with
  what to run. Only ADDS columns to `store_po` and puts in `store_po_put` again – no row is changed. **Note:** running step 2 again
  puts in step 2's `store_po_put` – run step 5 again after it.
* Actions: `poDecide` (approve / reject), `papersSave` (Store Admin); `poGet` gives the print's supplier, words and heading. The
  Portal's console (`rcl-portal`, "Approves purchase orders") signs the list into the Store's approvers ticket (`po`).

## A Store User enters only today's entries (29-10-2026 – urgent; no database step)
Asked: "admin ani super admin fkt back dated entry kru shakto baki konich nahi … jo entry user karayla jail tyala auto aajchi date select
aasel tyala date change krta yenar nahi … modual wise". **A Store User** (not the Store Admin of the site, not the Super Admin) makes a
requirement, a purchase order, a GRN, an issue or a return only of **today** – the date comes by itself and is not changed on the page
(`entryDate()`); any other day is refused by the server (`todayOnly` in `api/work.js`): "GRN of 28-10-2026: a Store User enters only
today's entries – an entry of an earlier day is made only by the Store Admin or the Super Admin. Ask the Store Admin." A requirement or a
PO he changes (the PO's approval sends it back to him) keeps its own date. The Store Admin and the Super Admin: any day, as before.
With Mechanical update-187 and the phone app. Tests: unit (32/32); rig `test/today.test.js` (the rule on) 6/6; `test/work.test.js` 105/105
and `test/work.browser.test.js` 33/33 with `STORE_TODAY_RULE=off` (only the rig sets it – its story is dated over ten days).
**Put right the same day (the review; with Mechanical update-188):** a page left open past midnight reads its lists and "today" again on
the new day (`boot()` / `dayNow()`), so a Store User's date is the new day's (before: yesterday's, refused); `STORE_TODAY_RULE=off` is never
obeyed on Vercel (`process.env.VERCEL`).

## A GRN's discounts, the PO's shortage, the item's code in its own column (step 6 – `sql/store_step6_grn_discount.sql`, run once in EVERY site's Supabase after step 5; 29-10-2026)
Asked (his GRN picture): "iteam code ani name weg wegle de … bill madh discount pn kadhi kdhi dettat mg to kadhi basic war asu shakto tr
kadhi gst war … mala pefect hawa … material ch shortage pn yet re mhanje po qty ste 10 ania ahe 5". His answers: the code apart in every
form; a discount on a line AND on the whole bill; the stock's rate with both deducted; "PO Qty, आलेले, Shortage दिसावे" (the PO stays open).
* **The item's code** in its own column before the item's name – every form's lines (requirement, PO, GRN, issue, return), the GRN's card,
  its print and the GRN register (Excel: after his columns – Item Code, Discount ₹, Net Rate).
* **A discount** typed "10%" or "500" (₹): on a line (its own column and "Disc. on": Basic / After GST) and on the whole bill (below the
  items, the same choice). **On the Basic** – off the taxable before GST (a line's first, then the bill's shared by the lines' taxable);
  **after GST** – the GST stays as billed, only what is paid is less (a line's on its own amount, then the bill's shared by the lines'
  amounts; to the paisa – what is left goes to the biggest). The form shows Basic, Discount (of it on the bill), Taxable, GST, TCS, Gross –
  worked out as the server does (`grnMoney` = `checkGrn`; the unit test compares them).
* **The stock's rate** of a GRN line is its **net rate**: (taxable − its after-GST discounts) ÷ qty – what was really paid, without GST
  (`store_moves`); a line without a discount keeps its basic rate exactly. A PO line's Disc. % comes into the GRN with it.
* **Against a PO:** each line shows the PO's Qty, what was received before (a GRN being changed: before it) and the **Shortage** after
  this GRN (red; more than the PO: "+…", asked as before). The PO stays open for the rest.
* **Without step 6** a discount is not offered (a note says what to run) and one sent is refused – a GRN as before is saved as before.
* **Step 6 last:** it puts in again the GRN's two saves (`store_grn_put`, `store_grn_new`) and the view `store_moves`. If step 2, 3 or 4
  is ever run again after it, run step 6 again after that.
Tests: unit (the money case by case, the page = the server, the SQL only adds, the register's columns); rig `test/grndisc.test.js`
(PART=a without step 6, PART=b with it – the database, the stock's rate, the form in a browser, its card and the PO's columns).

## The requirement's print: the company's logo, name, address and the Site Address (29-10-2026; no database step)
Asked: "requirement jewa mi banwato print gheto n ji print yetey tya war rachana address nahi site address nahiye ani rachana logo
nahiye". **The requirement's print** now has the PO's heading: the **logo** and the company's **name and address** (the site's company
in the Portal → Companies; the site → its company in Portal → Sites), Email ID, Contact, CIN No, Web, GST No, PAN No (Papers and the
company record), then Purchase Requisition Form, Project Name / Sub Project, **Site Address**, Indent No. / Date. **Site Address** is a
new box in Store Settings → **Papers** (Store Admin; several lines; on the requirement's and the PO's heading data – `site_address`,
kept in `store_settings` 'papers' as the other Papers fields; saving Papers from an older page keeps it). Empty: the row is printed
blank. The print waits for the logo to load before it opens (8 s at most). With the phone app 3.65.0 (the same paper and the box).
Tests: unit 36/36; rig `test/work.test.js` 108/108 (site_address saved, kept, in the heading), `test/work.browser.test.js` 34/34
(the paper shows the company's details and the Site Address; with a rig company with an address and a logo: both printed).

## A requirement's photos (step 7 – `sql/store_step7_req_photos.sql`, run once in EVERY site's Supabase after step 6; 29-10-2026)
Asked: "requirement madhe attachment cha option add karaycha aahe attachment madhe material photo je aahet te user add kru shakel multiple
photos ani ha laptop warun or asel jo app madhe open hoi ani app madhun photo kadhla tri laptop web madhe yeil photo". His answers: for the
whole requirement, many photos; in the print too.
* **The form** (new / Change): **Photos of the material** – up to 10; **📷 Add photos** opens the computer's files (a phone's browser offers
  its camera). Each photo is made smaller on the page (at most 1600 px, a JPEG of a few hundred KB) and sent at once (`reqPhotoUp`); a
  tile opens it big, ✕ takes it out. The save sends the list (`reqSave` … `photos`).
* **The list:** "📷 n photos" under the items; **Photos (n)** opens them under the row (each big, with who added it and when) and – for
  who made it or the Store Admin, while it waits or is approved – **Add photos** (`reqPhotoAdd`): a requirement made on the laptop gets
  its photos from the phone (the app, or the phone's browser) and the other way round – the same site's file store. A photo is taken
  out only while nobody has approved it (Change).
* **The print:** after the Purchase Requisition Form, "Photos of the material – <Indent No.> (n)": two a row, "Photo 1 · who · date".
* **HO Purchase:** an approved requirement's 📷 in Purchase – every site (another site's too: `reqPhotos` with its site).
* **Kept:** each photo ONCE in the site's private file store – the bucket `erp-files` (Mechanical's, step 1ze; made here only if it is
  missing) under its fingerprint: `store/req/<2>/<sha256>.jpg`, never overwritten or deleted. `store_req.photos` keeps the list
  (`[{ sha, size, by, at }]`). A photo opens only through a link of 15 minutes (`reqPhotos`). A save takes a photo the requirement has,
  or one THIS person sent to THIS site (the server's proof – an HMAC of site, person, fingerprint and size – given by `reqPhotoUp`); at
  most 10, each once; only a real JPG of 2 MB at most is kept; at most 200 photos a person in a day (each one sent is noted in the
  activity: "Requirement photo sent").
* **(the independent review, 29-10-2026)** the page reads a photo as `data:` (the live security rule refuses `blob:` pictures); a Change
  keeps a photo added since its form was opened (`photosWas` – the phone, the Store Admin); the print opens without the photos (and
  says so) when their links cannot be made; a step is taken as "not run" only when the database says its column is missing (before: a
  moment's fault was kept for 2 minutes as "run step N" – steps 5, 6, 7 alike). The rig test runs the page under vercel.json's headers
  (`dev.js` with `LIVE_HEADERS=1`).
* **Before step 7 at a site:** no photo box (as before); a photo sent is refused with what to run. Step 7 only ADDS the column (and the
  bucket if it is missing) – no row, function or rule is changed. The Store finds it within 2 minutes of being run.
* With the phone app 3.66.0 (its own screens: the form's photos, Photos of a requirement, the print, HO Purchase).
Tests: unit (step 7 only adds; the proof: another person's / site's / a made-up one refused; at most 10; each once); rig
`test/reqphoto.test.js` PART=a (before step 7) 7/7, PART=b (the store's file, the links, Change, added after approval, HO
Purchase, a cancelled one; in the browser: the form, the list, seen big, added, the print, a phone's width) – 52/52 after the review;
`test/work.test.js` and
`test/work.browser.test.js` as before, with and without step 7.

## 🎙 Speak into a box (29-10-2026; no database step)
Asked: "jithe jithe type krun entry hotat … tithe voice mick banaw user apla voice madhe bolel … text madhe add krel ok hindi english
marathi"; his answers: the app AND the website; words and numbers. `public/voice.js` (the same file in Engineering; inside the page in
the Portal and Mechanical): a box where an entry is typed (text, number, phone, a note) shows a 🎙 at its right end while it is in use.
Pressed, the browser's own speech recognition (Chrome / Edge) listens in **मराठी / हिंदी / English** (chips; the one chosen is kept in
the browser). What was said goes in as if typed (the page's input / change – a form's lines, totals and checks react as for typing): a
number box gets the **number** – "साडे तीन हजार" → 3500, "बारा पॉइंट पाच" → 12.5, "डेढ़ सौ" → 150, "twenty five" → 25; a phone box the
digits; a text box the words at the cursor. Never in a password box or where a page says `data-novoice`. Inside Mechanical's screen
(the same address, /store/) it listens with the screen's own speech. `vercel.json`: `microphone=(self)` (the camera and the place stay
off). Tests: unit (the number cases, the page loads it, the rule); `test/voice.browser.test.js` 21/21; the rig's work / photo / today
tests as before with it on the page.

## Live: another person's save shows by itself (29-10-2026; no database step)
Asked: "supabase 2 second cha vishay he bgh ata aapi ERP mothi hotey ok so saving mahtwachi aahe but data real time disne user laa he pn
mahtwach aahe tya pramne niyojan tu kar pratek gosti madhe logic use kr". As Mechanical's pages (the standard of 24-10-2026): a page asks
only **"what changed at this site?"** (`live` – the newest row of the site's activity: every save of the Store notes one, the unit test
checks it; about 40 bytes) and reads its list again **only when it changed**.
* **The rhythm:** every 2 s on a page with others' entries (Dashboard, Requirements, Purchase – every site, Purchase Orders, Inward, Issue
  & Return) while it is used; every 15 s after 5 minutes nobody touched it; **nothing** while the tab is hidden; at once when it is seen
  again. Stock & Reports, Opening stock & Numbers: nothing asked.
* **The cost:** the server reads that one row **once in 2 s for every open page of the site** on it (kept in memory, never for a save);
  its own save reads it again at once. Many people on one site ≈ one small read every 2 s per server – not one per page.
* **What stays:** a form being typed is never touched (only the list under it is drawn again); a row's details / photos open, a
  question open: the change is drawn when they are closed.
* With the phone app 3.68.0 (its Store lists and the Dashboard the same way). Tests: unit (every save notes activity; the rhythm); rig
  `test/live.test.js` 10/10 (another's save on the page within 4 s, details held, hidden tab, Stock & Reports nothing, two pages → one
  read every 2 s); `work.test.js` 108/108, `work.browser.test.js` 34/34, `reqphoto.test.js` 7/7 + 52/52, `today.test.js` 6/6 with it.

## Parts
| Part | File |
|---|---|
| The page (dark menu, Item Master, Excel) | `public/index.html` (Excel tool: `public/vendor/`) |
| Sign-in with the Portal's ticket / who is signed in / sign out | `api/sso.js`, `api/me.js`, `api/logout.js` |
| Item Master (list, check, save, delete, import) | `api/items.js` |
| The rules of an item (names, near names, suggestions, fields) | `lib/items.js` |
| Which database is a site's | `lib/sites.js` (Mechanical's list of sites, `rcl_sites`) |
| Ticket check, sign-ins, activity record | `lib/portal.js`, `lib/session.js`, `lib/activity.js` |
| Database (run once in EVERY site's Supabase, in this order) | `sql/store_step1_items.sql`, `sql/store_step2_work.sql`, `sql/store_step3_grn_import.sql`, `sql/store_step4_grn_no.sql`, `sql/store_step5_po_format.sql`, `sql/store_step6_grn_discount.sql`, `sql/store_step7_req_photos.sql` |
| The Store's work (step 2) | `api/work.js`, `lib/work.js`, `lib/sreport.js`, `public/work.js`, `api/portal.js` |

## Settings (Vercel → the Store project → Settings → Environment Variables – never in a file)
| Name | What |
|---|---|
| `PORTAL_URL` | the Portal's address, e.g. `https://rcl-portal-flame.vercel.app` |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | the FIRST site's (VTR) – the same values as in the Mechanical project |
| `SITE_<CODE>_KEY` | each other site's secret key, e.g. `SITE_18B_KEY` – the same as in the Mechanical project |
| `RCL_SITES_KEY` | only if a site's key is kept locked in Mechanical's list (update-90 sites) |
| `ANTHROPIC_API_KEY` | the AI of the old inward register's import (the same key as Mechanical's); `ANTHROPIC_MODEL` only to fix the model |

## Tests (local test rig only – never the live databases)
```
timeout 120 node --test test/unit.test.js     # no database
timeout 300 node test/api.test.js             # rig: Portal :3010, Store :3020, site databases :3100 / :3102
timeout 400 node test/browser.test.js         # rig + Chromium; pictures in test/shots/
timeout 300 node test/paging155.test.js       # rig: 2,500 items, an import, lost answers (starts its own Store on :3021; SRC=<tree>)
timeout 600 node test/work.test.js            # rig: the Store's work – requirements, approvals, POs, GRN, issues, returns, reports
timeout 600 node test/work.browser.test.js    # rig + Chromium: the work pages (also on a phone's width)
timeout 900 node test/grnreg.test.js          # rig: the old inward register (a made one; REG_FILE=<his file> for his own) – the
                                              # Store started with ANTHROPIC_API_KEY=test-key-s ANTHROPIC_API_BASE=http://127.0.0.1:3996
timeout 600 node test/grnreg.browser.test.js  # rig + Chromium: the register's check and import on the page
timeout 300 node test/grnno.test.js           # rig: a new GRN with its GRN No – before and after step 4 (run after grnreg.test.js)
timeout 300 node test/today.test.js           # rig (29-10-2026): a Store User only today (run after work.test.js, the Store without the switch)
```
The rig's stories are dated over ten days by Store Users: the Store on the rig is started with `STORE_TODAY_RULE=off` for them
(`STORE_TODAY_RULE=off bash /home/claude/rig/store_srv.sh`); never set in Vercel.

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
