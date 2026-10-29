/* The Store's WORK (step 2, 28-10-2026) through its own doors, on the local test rig (never the live databases):
 *   the Portal :3010 (tickets, the Super Admin's console – who approves, Store Purchase), the Store :3020, the site databases S1 (:3100,
 *   rcl) and T2 (:3102, rcl_s2), Mechanical :3001 (the maintenance log book of a machinery – the Store's outward in it). Test values only.
 *   node test/work.test.js
 * The test sets its own start: the Store's steps 1 and 2 run in S1 and T2, the Store's tables emptied, the access given in the Portal. */
'use strict';
const { execSync } = require('child_process'), path = require('path');
const P = 'http://127.0.0.1:3010', ST = 'http://127.0.0.1:3020', MECH = 'http://127.0.0.1:3001';
let pass = 0, fail = 0; const out = [], T0 = Date.now();
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 600) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
const sqlFile = (db, f) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -v ON_ERROR_STOP=1 -tA -q"', { input: require('fs').readFileSync(f) }).toString();
const wait = ms => new Promise(r => setTimeout(r, ms));
function client(base) {
  let cookie = '';
  const req = async (p, body, opt) => {
    opt = opt || {}; const h = { 'Content-Type': 'application/json' }; if (!opt.noHeader) h['X-RCL'] = '1'; if (cookie) h.Cookie = cookie;
    const r = await fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(90000) });
    const sc = r.headers.get('set-cookie'); if (sc) { const v = sc.split(';')[0]; cookie = /=$/.test(v) ? '' : v; }
    let j = {}; try { j = JSON.parse(await r.text()); } catch (e) { j = {}; }
    return { status: r.status, j: j, loc: r.headers.get('location') || '' };
  };
  return { req };
}
const ticketFor = async (portal, mod, site) => ((await portal.req('/api/go?module=' + mod + '&site=' + site)).loc.split('#sso=')[1] || '');
async function storeAs(email, pw, site) {
  const p = client(P), l = await p.req('/api/auth', { action: 'login', email: email, password: pw });
  if (l.status !== 200) throw new Error('Portal sign-in of ' + email + ': ' + JSON.stringify(l.j));
  const s = client(ST), r = await s.req('/api/sso', { ticket: await ticketFor(p, 'store', site) });
  if (r.status !== 200) throw new Error('Store sign-in of ' + email + ' at ' + site + ': ' + JSON.stringify(r.j));
  const w = (action, x) => s.req('/api/work', Object.assign({ action: action }, x || {}));
  return { p, s, r, w };
}
const mech = async (fn, ...args) => (await (await fetch(MECH + '/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn, args }), signal: AbortSignal.timeout(90000) })).json());
const PW = 'Nashik#Road848!', VPW = 'Audit#PassView9!x', SAPW = 'Super#Admin2041'      // (the Portal's own test – run first on the rig – leaves his password so);
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10), day = n => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const D10 = day(10), D8 = day(8), D6 = day(6), D5 = day(5), D3 = day(3), D2 = day(2), D1 = day(1);

(async () => {
  // ---- the start: the Store's steps in S1 and T2, its tables empty ----
  const root = path.join(__dirname, '..');
  for (const db of ['rcl', 'rcl_s2']) {
    sqlFile(db, path.join(root, 'sql', 'store_step1_items.sql')); sqlFile(db, path.join(root, 'sql', 'store_step2_work.sql')); sqlFile(db, path.join(root, 'sql', 'store_step3_grn_import.sql'));      // (step 3: as every site after 28-10-2026)
    sql(db, 'truncate public.store_return_lines, public.store_return, public.store_issue_lines, public.store_issue, public.store_grn_lines, public.store_grn, public.store_opening, public.store_po, public.store_req, public.store_settings, public.items, public.store_sessions, public.store_tickets, public.store_activity cascade; ' +
      "alter sequence public.items_code_seq restart; update public.store_numbers set next_no = 1; notify pgrst, 'reload schema';");
  }
  sql('rcl', "delete from public.master where id = 'RL-STORE-1'");      // (the rig's: the machinery this test made in a run before)
  ok('the Store\'s step 2 runs twice in a site\'s database without a fault (it only adds)', (() => { try { sqlFile('rcl', path.join(root, 'sql', 'store_step2_work.sql')); return true; } catch (e) { return false; } })());
  await wait(1500);
  sql('rcl_portal', "insert into modules (key, name, url, status, sort) values ('store', 'Store', 'http://127.0.0.1:3020', 'live', 2) on conflict (key) do update set url = excluded.url, status = 'live'; " +
    "alter table public.access add column if not exists pages jsonb; delete from access where module = 'store'; delete from counters; notify pgrst, 'reload schema';");
  await wait(800);
  // the Super Admin gives the Store in the Portal: sujit – Store Admin at S1 (approves at level 2), a User at T2 with Store Purchase; view –
  // a User at S1 (requirements Edit, approves at level 1); store – a User at S1 (GRN, Issue Edit; approves at level 1)
  const SA = client(P); let r = await SA.req('/api/auth', { action: 'login', email: 'sa@rcl.test', password: SAPW });
  ok('the Super Admin signs in to the Portal', r.status === 200 && r.j.user && r.j.user.super, r.j);
  const acc = async (email, site, role) => (await SA.req('/api/admin', { action: 'accessSet', email: email, site: site, module: 'store', role: role })).j;
  for (const [e, s, ro] of [['sujit@rcl.test', 'S1', 'admin'], ['sujit@rcl.test', 'T2', 'user'], ['view@rcl.test', 'S1', 'user'], ['store@rcl.test', 'S1', 'user']]) await acc(e, s, ro);
  const pages = async (email, site, pg) => (await SA.req('/api/admin', { action: 'storePagesSave', email: email, site: site, pages: pg })).j;
  r = await pages('view@rcl.test', 'S1', { dashboard: 'View', items: 'View', req: 'Edit', grn: 'View', issue: 'View', reports: 'View', po: 'View', approve: 'L1', purchase: 'None' });
  ok('the Super Admin gives view the Store\'s pages at S1 (Requirements Edit, the rest View) and "Approves requirements: Level 1" – the Store told who approves', r.ok && r.pages.req === 'Edit' && r.pages.approve === 'L1' && !r.warn, r);
  r = await pages('store@rcl.test', 'S1', { dashboard: 'View', items: 'Edit', req: 'View', grn: 'Edit', issue: 'Edit', reports: 'View', po: 'View', approve: 'L1' });
  ok('   store: Inward (GRN) and Issue & Return Edit, approves at Level 1 too', r.ok && r.pages.grn === 'Edit' && r.pages.approve === 'L1' && !r.warn, r);
  r = await pages('sujit@rcl.test', 'S1', { approve: 'L2', req: 'None' });
  ok('   sujit (Store Admin at S1): only "Approves requirements" (Level 2) and "Store Purchase" are given to an Admin – his pages stay every page', r.ok && r.pages.approve === 'L2' && r.pages.req === undefined && r.pages.purchase === 'None', r);
  r = await pages('sujit@rcl.test', 'T2', { dashboard: 'View', items: 'View', purchase: 'Edit' });
  ok('   sujit at T2 (a User): Store Purchase – every site (HO Purchase)', r.ok && r.pages.purchase === 'Edit' && r.pages.req === 'None', r);
  const apv = JSON.parse(sql('rcl', "select value::text from store_settings where id = 'approvers'") || '{}');
  ok('   S1\'s database keeps who approves: Level 1 – View User, Store Keeper; Level 2 – sujit (from the Portal, signed – used once)',
    JSON.stringify((apv.levels || []).map(l => [l.level, l.people.map(p => p.email).sort()])) === JSON.stringify([[1, ['store@rcl.test', 'view@rcl.test']], [2, ['sujit@rcl.test']]]) && apv.by === 'sa@rcl.test', apv);
  r = await client(ST).req('/api/portal', { ticket: 'a.b.c' });
  ok('   the Store\'s door for the console refuses what is not a signed ticket of the Portal', r.status === 401 && r.j.code === 'ticket', r.j);

  const A = await storeAs('sujit@rcl.test', PW, 'S1'), V = await storeAs('view@rcl.test', VPW, 'S1'), K = await storeAs('store@rcl.test', VPW, 'S1'), B = await storeAs('sujit@rcl.test', PW, 'T2');
  ok('the pages come with each sign-in: Store Admin – every page; view – Requirements Edit; store – GRN / Issue Edit; sujit at T2 – Store Purchase',
    A.r.j.pages.req === 'Edit' && A.r.j.pages.grn === 'Edit' && A.r.j.pages.purchase === 'None' && V.r.j.pages.req === 'Edit' && V.r.j.pages.grn === 'View' && K.r.j.pages.issue === 'Edit' && K.r.j.pages.req === 'View' && B.r.j.pages.purchase === 'Edit' && B.r.j.pages.req === 'None',
    [A.r.j.pages, V.r.j.pages, K.r.j.pages, B.r.j.pages]);
  // ---- the items (Item Master) and a machinery of S1 (Mechanical's Asset Master – the same database) ----
  const item = async (name, unit, cat, gst, min) => ((await A.s.req('/api/items', { action: 'save', item: { name: name, unit: unit, category: cat, gst: gst, minStock: min } })).j.item || {}).code;
  const CEM = await item('Cement OPC 53', 'Bag', 'Cement', '28', '50'), BAM = await item('Bamboo 16 Ft', 'Nos', 'Shuttering', '', ''), OIL = await item('Engine Oil 15W40', 'Ltr', 'Oil & Lubricants', '18', '10');
  ok('three items in S1\'s Item Master', !!(CEM && BAM && OIL), [CEM, BAM, OIL]);
  const lg = await mech('login', 'sujit@rcl.test', PW), tok = lg.result && lg.result.token;
  const sm = await mech('api', tok, 'saveMaster', [{ no: 'RL-STORE-1', name: 'Roller', type: 'Roller', unit: 'Hrs', worksOn: ['Hrs'], hrStd: 6, owner: 'Rachana Construction Limited', ownership: 'Own', status: 'Active', activeFrom: day(60) }, 'add']);
  ok('a machinery of S1 in Mechanical\'s Asset Master (RL-STORE-1, Own)', !!tok && !sm.error, sm.error || lg);

  // ---- OPENING STOCK (the Store Admin) ----
  r = await K.w('openingSave', { date: D10, rows: [{ code: CEM, qty: 100, rate: 350 }] });
  ok('a User cannot set the opening stock', r.status === 403 && r.j.code === 'admin', r.j);
  r = await A.w('openingSave', { date: D10, rows: [{ code: CEM, qty: 100, rate: 350 }, { code: OIL, qty: 20, rate: 300 }] });
  ok('the Store Admin sets the opening stock (as on a date): Cement 100 @ ₹350, Engine Oil 20 @ ₹300', r.status === 200 && r.j.rows === 2 && sql('rcl', 'select count(*) from store_opening') === '2', r.j);
  r = await A.w('boot');
  ok('   the stock: Cement 100, Engine Oil 20; the average basic rate', r.status === 200 && r.j.stock[CEM] === 100 && r.j.stock[OIL] === 20 && r.j.avg[CEM] === 350 && r.j.machinery.some(m => m.no === 'RL-STORE-1'), [r.j.stock, r.j.avg, (r.j.machinery || []).length]);

  // ---- MATERIAL REQUIREMENT and its approvals ----
  r = await K.w('reqSave', { req: { date: D8, for_kind: 'Site work', for_text: 'Ch 540+450 toe wall', lines: [{ code: CEM, qty: 200 }] } });
  ok('store (Requirements View) cannot make a requirement – said why', r.status === 403 && r.j.code === 'page' && /View/.test(r.j.error), r.j);
  r = await V.w('reqSave', { req: { date: D8, need_by: D3, for_kind: 'Site work', for_text: 'Ch 540+450 toe wall', lines: [{ code: CEM, qty: 200, brand: ' UltraTech ', spec: 'OPC 53 grade,  50 kg bag' }, { code: BAM, qty: 100, note: 'shuttering' }] } });
  const RQ1 = r.j.no;
  ok('view makes requirement 1 (Cement 200, Bamboo 100): it waits for Level 1', r.status === 200 && RQ1 === 1 && r.j.status === 'Pending' && r.j.level === 1, r.j);
  ok('   (28-10-2026) a line\'s Brand and Material specification kept (as typed, the spaces tidied); a line without them: none', sql('rcl', "select (lines->0->>'brand') || '|' || (lines->0->>'spec') || '|' || coalesce(lines->1->>'brand', '-') from store_req where no = 1") === 'UltraTech|OPC 53 grade, 50 kg bag|-',
    sql('rcl', 'select lines from store_req where no = 1'));
  r = await V.w('reqDecide', { no: RQ1, ok: true });
  ok('   view cannot approve his own (he is at Level 1) – said', r.status === 409 && /your own requirement/.test(r.j.error), r.j);
  r = await A.w('reqDecide', { no: RQ1, ok: true });
  ok('   sujit (Level 2) cannot approve it before Level 1', r.status === 409 && /level 1 – not yours/.test(r.j.error), r.j);
  r = await K.w('reqList');
  const w1 = (r.j.reqs || []).find(x => x.no === RQ1);
  ok('   store sees it waits for him ("Store Keeper" – the others of Level 1, not the maker)', w1 && w1.mayApprove === true && JSON.stringify(w1.waitFor) === JSON.stringify(['Store Keeper']), w1);
  r = await K.w('reqDecide', { no: RQ1, ok: true, note: 'ok' });
  ok('   store approves (Level 1) → it waits for Level 2', r.status === 200 && r.j.done[0].status === 'Pending' && r.j.done[0].level === 2, r.j);
  r = await A.w('reqDecide', { no: RQ1, ok: true });
  ok('   sujit approves (Level 2) → Approved; each level\'s approval kept (who, when)', r.status === 200 && r.j.done[0].status === 'Approved' && sql('rcl', 'select jsonb_array_length(approvals) || status from store_req where no = 1') === '2Approved', r.j);
  r = await V.w('reqSave', { req: { date: D8, for_kind: 'Machinery', for_text: 'RL-STORE-1', lines: [{ code: OIL, qty: 5 }] } });
  const RQ2 = r.j.no;
  r = await K.w('reqDecide', { no: RQ2, ok: false });
  ok('a reject needs its why', r.status === 400 && /why it is rejected/.test(r.j.error), r.j);
  r = await K.w('reqDecide', { no: RQ2, ok: false, note: 'Oil is in stock' });
  ok('   rejected with its why – the requirement ends', r.status === 200 && r.j.done[0].status === 'Rejected' && sql('rcl', 'select status from store_req where no = ' + RQ2) === 'Rejected', r.j);
  r = await V.w('reqSave', { req: { date: D8, for_kind: 'Machinery', for_text: 'NO-SUCH', lines: [{ code: OIL, qty: 5 }] } });
  ok('a requirement for a machinery not in the Asset Master: refused', r.status === 400 && /not in the Asset Master/.test(r.j.error), r.j);

  // ---- PURCHASE ORDER: HO Purchase (sujit at T2 – Store Purchase) for S1 ----
  r = await A.w('purPending');
  ok('the Store Admin of S1 is no HO Purchase: no purchase list', r.status === 403 && r.j.code === 'purchase', r.j);
  r = await B.w('purPending');
  const ps1 = (r.j.sites || []).find(x => x.site === 'S1');
  ok('HO Purchase (signed in at T2) sees every site: S1\'s approved requirement 1 to order (Cement 200, Bamboo 100 left)', r.status === 200 && ps1 && ps1.reqs.length === 1 && ps1.reqs[0].no === RQ1 && JSON.stringify(ps1.reqs[0].lines.map(l => l.left)) === JSON.stringify([200, 100]) && (r.j.sites || []).some(x => x.site === 'T2'), r.j);
  const po1 = { date: D6, vendor: 'Bedrok Chem Infra', deliver_by: D2, terms: 'Delivery at site', lines: [{ code: CEM, qty: 150, rate: 340, req_no: RQ1, req_line: 1 }, { code: BAM, qty: 100, rate: 90, gst_pct: 0, req_no: RQ1, req_line: 2 }] };
  r = await B.w('poSave', { site: 'S1', po: po1 });
  const PO1 = r.j.no;
  ok('   (28-10-2026) the PO\'s line of requirement 1 line 1 has its Brand and Material specification (not typed in the PO: the requirement\'s)', sql('rcl', "select (lines->0->>'brand') || '|' || (lines->0->>'spec') from store_po where no = 1") === 'UltraTech|OPC 53 grade, 50 kg bag', sql('rcl', 'select lines from store_po where no = 1'));
  ok('   PO 1 made for S1 (kept in S1\'s database): Cement 150 @ ₹340 + 28 % GST, Bamboo 100 @ ₹90 – total ₹74,280', r.status === 200 && PO1 === 1 && r.j.total === 74280 && sql('rcl', 'select count(*) from store_po') === '1' && sql('rcl_s2', 'select count(*) from store_po') === '0', r.j);
  r = await B.w('poSave', { site: 'S1', po: { date: D6, vendor: 'Bedrok Chem Infra', lines: [{ code: CEM, qty: 60, rate: 340, req_no: RQ1, req_line: 1 }] } });
  ok('   a second PO of 60 more Cement of requirement 1 (150 + 60 > 200): refused – never more than asked', r.status === 409 && r.j.code === 'overorder' && /ordered 210, asked 200/.test(r.j.error), r.j);
  r = await B.w('poSave', { site: 'S1', po: { date: D6, vendor: 'Bedrock Chem Infra', lines: [{ code: OIL, qty: 10, rate: 310 }] } });
  ok('   a vendor written nearly as one there ("Bedrock" / "Bedrok"): asked first', r.status === 409 && r.j.code === 'party' && r.j.near.indexOf('Bedrok Chem Infra') > -1, r.j);
  r = await B.w('poSave', { site: 'S1', po: { date: D6, vendor: 'BEDROK  CHEM INFRA', lines: [{ code: OIL, qty: 10, rate: 310, req_no: RQ2, req_line: 1 }] } });
  ok('   a rejected requirement is not ordered', r.status === 409 && r.j.code === 'notapproved', r.j);
  r = await V.w('poList');
  ok('view (Purchase Orders View) sees S1\'s PO 1 – Open, nothing received', r.status === 200 && r.j.pos.length === 1 && r.j.pos[0].state === 'Open' && r.j.pos[0].lines[0].left === 150, r.j);
  r = await A.w('poGet', { no: PO1 });
  ok('   its paper: the site\'s company heading', r.status === 200 && r.j.po.no === PO1 && r.j.heading && typeof r.j.heading.company === 'string', r.j.heading);

  // ---- INWARD (GRN) ----
  r = await V.w('grnSave', { grn: { date: D5, supplier: 'Bedrok Chem Infra', lines: [{ code: CEM, qty: 10, rate: 340 }] } });
  ok('view (GRN View) cannot take material in', r.status === 403 && r.j.code === 'page', r.j);
  r = await K.w('poOpen');
  ok('store sees the open POs of S1 with what is still to come', r.status === 200 && r.j.pos.length === 1 && r.j.pos[0].lines.map(l => l.left).join() === '150,100', r.j);
  r = await K.w('grnSave', { grn: { date: D5, supplier: 'bedrok chem infra', challan_no: '02', invoice_no: 'B/45', invoice_date: D5, vehicle_no: 'mh 25 aj 8511', po_no: PO1, tcs: 10, lines: [{ code: CEM, qty: 100, rate: 340, po_line: 1 }, { code: BAM, qty: 100, rate: 90, gst_pct: 0, po_line: 2 }] } });
  const G1 = r.j.no;
  ok('GRN 1 against PO 1: Cement 100, Bamboo 100; the supplier as written before ("Bedrok Chem Infra"); vehicle MH25AJ8511; gross with GST and TCS ₹52,530',
    r.status === 200 && G1 === 1 && r.j.gross === 52530 && sql('rcl', 'select supplier || vehicle_no || po_no from store_grn where no = 1') === 'Bedrok Chem InfraMH25AJ85111', r.j);
  r = await K.w('grnSave', { grn: { date: D5, supplier: 'Bedrok Chem Infra', po_no: PO1, lines: [{ code: CEM, qty: 60, rate: 340, po_line: 1 }] } });
  ok('   60 more Cement on PO 1 (only 50 still to come): asked first', r.status === 409 && r.j.code === 'over' && /PO still has 50/.test(r.j.error), r.j);
  r = await K.w('grnSave', { confirmOver: true, grn: { date: D5, supplier: 'Bedrok Chem Infra', po_no: PO1, lines: [{ code: CEM, qty: 60, rate: 340, po_line: 1 }] } });
  ok('   taken in anyway after "yes" – GRN 2', r.status === 200 && r.j.no === 2, r.j);
  r = await V.w('poList');
  ok('   PO 1: all came (Cement 160 of 150, Bamboo 100) – Received', r.status === 200 && r.j.pos[0].state === 'Received' && r.j.pos[0].lines[0].received === 160, r.j.pos && r.j.pos[0]);
  r = await K.w('grnSave', { grn: { date: D5, supplier: 'Shree Auto Spares', invoice_no: 'SA-9', lines: [{ code: OIL, qty: 10, rate: 330 }] } });
  ok('a direct GRN (no PO): Engine Oil 10 @ ₹330 – GRN 3', r.status === 200 && r.j.no === 3, r.j);
  r = await K.w('grnSave', { grn: { date: D5, supplier: 'Shree Auto Spares', lines: [{ code: 'ITM-9999', qty: 1 }] } });
  ok('   an item not in the Item Master: refused', r.status === 400 && /not in the Item Master/.test(r.j.error), r.j);
  r = await A.w('boot');
  const cavg = Math.round((100 * 350 + 160 * 340) / 260 * 100) / 100;
  ok('the stock now: Cement 260 (average basic rate ' + cavg + '), Bamboo 100, Engine Oil 30', r.j.stock[CEM] === 260 && r.j.stock[BAM] === 100 && r.j.stock[OIL] === 30 && r.j.avg[CEM] === cavg, [r.j.stock, r.j.avg]);

  // ---- ISSUE (OUTWARD) ----
  r = await K.w('issueSave', { issue: { date: D3, to_kind: 'Sub-contractor', party: 'Tushar Mandal', location: '539+623', side: 'LHS', use_for: 'BC', receiver: 'Kishor', lines: [{ code: CEM, qty: 1000 }] } });
  ok('an issue of more than the stock: refused, said in words – nothing saved', r.status === 409 && r.j.code === 'short' && /Not enough stock of Cement OPC 53 on/.test(r.j.error) && sql('rcl', 'select count(*) from store_issue') === '0', r.j);
  r = await K.w('issueSave', { issue: { date: day(9), to_kind: 'Site work', use_for: 'Toe wall', lines: [{ code: BAM, qty: 10 }] } });
  ok('   an issue dated before the material came in (the stock below zero on that date): refused', r.status === 409 && r.j.code === 'short', r.j);
  r = await K.w('issueSave', { issue: { date: D3, to_kind: 'Sub-contractor', party: 'Tushar Mandal', location: '539+623', side: 'lhs', use_for: 'BC', receiver: 'Kishor', lines: [{ code: CEM, qty: 40 }, { code: BAM, qty: 50, returnable: true }] } });
  const O1 = r.j.no;
  const ia = Math.round((40 * cavg + 50 * 90) * 100) / 100;
  ok('outward 1 to the sub-contractor Tushar Mandal: Cement 40 at the average rate, Bamboo 50 returnable – ₹' + ia, r.status === 200 && O1 === 1 && r.j.amount === ia, r.j);
  r = await K.w('issueSave', { issue: { date: D3, to_kind: 'Sub-contractor', party: 'Tushar Mandall', use_for: 'BC', lines: [{ code: CEM, qty: 1 }] } });
  ok('   a sub-contractor written nearly as one there: asked first ("Tushar Mandal")', r.status === 409 && r.j.code === 'party' && r.j.near[0] === 'Tushar Mandal', r.j);
  r = await K.w('issueSave', { issue: { date: D2, to_kind: 'Machinery', machinery: 'RL-STORE-1', reading: 1234.5, receiver: 'Operator Ram', lines: [{ code: OIL, qty: 5 }] } });
  const O2 = r.j.no;
  ok('outward 2 to the machinery RL-STORE-1 (its reading 1234.5): Engine Oil 5 Ltr', r.status === 200 && O2 === 2, r.j);
  r = await K.w('issueSave', { issue: { date: D2, to_kind: 'Machinery', machinery: 'NOT-HERE', lines: [{ code: OIL, qty: 1 }] } });
  ok('   a machinery not in the Asset Master: refused', r.status === 400 && /not in the Asset Master/.test(r.j.error), r.j);
  r = await K.w('issueSave', { issue: { date: D2, to_kind: 'Site work', lines: [{ code: OIL, qty: 1 }] } });
  ok('   site work without what it is for: refused', r.status === 400 && /used for/.test(r.j.error), r.j);
  // the maintenance log book of the machinery in Mechanical: the Store's outward in it (Party "RCL Store")
  const ml = await mech('api', tok, 'maintLog', [{ no: 'RL-STORE-1', all: true }]);
  const st = ml.result && (ml.result.lines || []).filter(l => l.kind === 'Store');
  ok('Mechanical: the maintenance log book of RL-STORE-1 has outward 2 – Party "RCL Store", Engine Oil 5 Ltr at the Store\'s rate, reading 1234.5; "Fetch outward" on',
    !!ml.result && ml.result.store && ml.result.store.on === true && st.length === 1 && st[0].party === 'RCL Store' && st[0].billNo === 'Outward ' + O2 && st[0].km === 1234.5 && st[0].lines[0].work === 'Engine Oil 15W40' && st[0].lines[0].qty === 5 && st[0].lines[0].type === 'Paid',
    ml.error || (ml.result && { store: ml.result.store, st: st }));

  // ---- RETURN ----
  const iss = (await K.w('issueGet', { no: O1 })).j.issue, bl = iss.lines.find(l => l.code === BAM);
  r = await K.w('retSave', { ret: { date: D2, issue_no: O1, lines: [{ issue_line: bl.id, qty: 20, remark: 'good' }] } });
  ok('return 1 of outward 1: Bamboo 20 back to the store', r.status === 200 && r.j.no === 1, r.j);
  r = await K.w('retSave', { ret: { date: D1, issue_no: O1, lines: [{ issue_line: bl.id, qty: 40 }] } });
  ok('   40 more back (only 30 still out): refused', r.status === 400 && /more than is out \(30 Nos of 50\)/.test(r.j.error), r.j);
  r = await K.w('retSave', { ret: { date: day(4), issue_no: O1, lines: [{ issue_line: bl.id, qty: 1 }] } });
  ok('   a return dated before the issue: refused', r.status === 400 && /before the issue date/.test(r.j.error), r.j);
  r = await K.w('issueDelete', { no: O1 });
  ok('a User cannot delete an issue', r.status === 403 && r.j.code === 'admin', r.j);
  r = await A.w('issueDelete', { no: O1 });
  ok('   the Store Admin: an issue with a return – the return first (said)', r.status === 409 && r.j.code === 'hasreturn', r.j);
  r = await A.w('grnDelete', { no: G1 });
  ok('   deleting GRN 1 would take the stock below zero (its Bamboo is issued): refused – nothing deleted', r.status === 409 && r.j.code === 'short' && sql('rcl', 'select count(*) from store_grn') === '3', r.j);

  // ---- REPORTS ----
  const rep = (who, x) => who.w('report', x).then(z => z.j);
  let t = await rep(A, { kind: 'stock' });
  const srow = code => (t.rows || []).find(x => x[0] === code);
  ok('Stock: Cement 220, Bamboo 70 (50 out, 20 back), Engine Oil 25 – with value', srow(CEM) && srow(CEM)[4] === 220 && srow(BAM)[4] === 70 && srow(OIL)[4] === 25 && t.total[6] > 0, t.rows);
  t = await rep(A, { kind: 'statement', from: D10, to: today });
  const sr = (t.rows || []).find(x => x[1] === CEM);
  ok('Stock statement (his daily report) of the period: Cement opening 0, inward 260 (opening stock + GRN), issued 40, closing 220; purchase ₹54,400', sr && sr[4] === 0 && sr[5] === 260 && sr[7] === 40 && sr[9] === 220 && sr[13] === 54400, sr);
  t = await rep(A, { kind: 'statement', from: D3, to: D3 });
  const sd = (t.rows || []).find(x => x[1] === CEM);
  ok('   one day: opening 260, issued 40, closing 220', sd && sd[4] === 260 && sd[7] === 40 && sd[9] === 220, sd);
  t = await rep(A, { kind: 'ledger', code: BAM, from: D10, to: today });
  ok('Item ledger of Bamboo: GRN 1 +100, Outward 1 −50 (Tushar Mandal · 539+623 · BC), Return 1 +20 – balance 70', JSON.stringify((t.rows || []).slice(1).map(x => [x[1], x[3], x[4], x[5]])) === JSON.stringify([['GRN 1', 100, '', 100], ['Outward 1', '', 50, 50], ['Return 1', 20, '', 70]]) && /Tushar Mandal · 539\+623 · BC/.test(t.rows[2][2]), t.rows);
  t = await rep(K, { kind: 'grn', from: D10, to: today });
  ok('GRN register (his INWARD columns – Sr No, GRN No …): 4 rows, PO No and TCS on the bill\'s first row', (t.rows || []).length === 4 && t.cols[0].h === 'Sr No' && t.cols[1].h === 'GRN No' && t.rows[0][0] === 1 && t.rows[0][17] === PO1 && t.rows[0][14] === 10, t.rows);
  t = await rep(K, { kind: 'issue', from: D10, to: today, party: 'Tushar Mandal' });
  ok('Issue register of Tushar Mandal: 2 rows, Bamboo returnable 20 returned', (t.rows || []).length === 2 && t.rows[1][15] === 'Yes' && t.rows[1][16] === 20, t.rows);
  t = await rep(K, { kind: 'consumption', from: D10, to: today, by: 'party' });
  ok('Consumption by party: Tushar Mandal – Bamboo 30 (50 − 20 back), Cement 40; RCL\'s machinery issue under "Machinery"', JSON.stringify((t.rows || []).filter(x => x[0] === 'Tushar Mandal').map(x => [x[1], x[3]])) === JSON.stringify([['Bamboo 16 Ft', 30], ['Cement OPC 53', 40]]), t.rows);
  t = await rep(K, { kind: 'returnable' });
  ok('Returnable still out: Bamboo 30 with Tushar Mandal', (t.rows || []).length === 1 && t.rows[0][7] === 30 && t.rows[0][2] === 'Tushar Mandal', t.rows);
  t = await rep(V, { kind: 'req', status: 'To order' });
  ok('Requirements to order: Cement of requirement 1 – 200 asked, 150 ordered: 50 left (Bamboo all ordered – not listed)', (t.rows || []).length === 1 && t.rows[0][4] === 'Cement OPC 53' && t.rows[0][10] === 50 && t.rows[0][5] === 'UltraTech' && t.rows[0][6] === 'OPC 53 grade, 50 kg bag' && t.cols[5].h === 'Brand' && t.cols[6].h === 'Material specification', t.rows);      // (28-10-2026: its Brand and Material specification)
  t = await rep(B, { kind: 'po', all: true });
  ok('HO Purchase: the purchase orders of every site (each line its Brand and Material specification)', (t.rows || []).length === 2 && t.rows.every(x => x[15] === 'S1') && t.rows[0][4] === 'UltraTech' && t.cols[4].h === 'Brand', t.rows);

  // ---- SETTINGS: where the GRN and Outward numbers go on from (the old registers) ----
  r = await A.w('numbersSave', { GRN: 2 });
  ok('the next GRN number cannot be one already used', r.status === 400 && /more than 3/.test(r.j.error), r.j);
  r = await A.w('numbersSave', { GRN: 653, OUT: 20224 });
  ok('   the Store Admin sets them: next GRN 653, next Outward 20224', r.status === 200 && r.j.next.GRN === 653 && r.j.next.OUT === 20224, r.j);
  r = await K.w('grnSave', { grn: { date: D1, supplier: 'Shree Auto Spares', lines: [{ code: OIL, qty: 2, rate: 330 }] } });
  ok('   the next GRN is 653', r.status === 200 && r.j.no === 653, r.j);

  // ---- EXCEL IMPORT (the Store Admin): checked first, then all or none ----
  const rows = [{ line: 2, ref: '900', date: D1, party: 'Bedrok Chem Infra', invoice_no: 'B/77', item: 'Cement OPC 53', qty: 10, rate: 345 }, { line: 3, ref: '900', date: D1, party: 'Bedrok Chem Infra', invoice_no: 'B/77', item: 'Bamboo 16 Ft', qty: 5, rate: 90 },
    { line: 4, ref: '901', date: D1, party: 'Shree Auto Spares', item: 'Engine Oil 15w40', qty: 4, rate: 330 }, { line: 5, ref: '902', date: D1, party: 'X Traders', item: 'Cemnt OPC 53', qty: 1, rate: 1 }];
  r = await K.w('importDocs', { kind: 'grn', check: true, rows: rows });
  ok('a User cannot import', r.status === 403, r.j);
  r = await A.w('importDocs', { kind: 'grn', check: true, rows: rows });
  ok('GRN import – Check: rows of one GRN No together (900: 2 items), an item written nearly as one there – a mistake ("write it as there")', r.status === 200 && r.j.docs === 2 && r.j.errors === 1 && /near: Cement OPC 53/.test(r.j.rows[3].msg), r.j);
  r = await A.w('importDocs', { kind: 'grn', rows: rows });
  ok('   Import with a mistake: nothing imported', r.status === 400 && sql('rcl', 'select count(*) from store_grn') === '4', r.j);
  r = await A.w('importDocs', { kind: 'grn', rows: rows.slice(0, 3) });
  ok('   corrected: 2 GRNs saved in one go (654, 655), the file\'s number kept in the remark', r.status === 200 && r.j.saved === 2 && JSON.stringify(r.j.nos) === JSON.stringify([654, 655]) && sql('rcl', "select remark from store_grn where no = 654") === 'File GRN no. 900', r.j);
  const irows = [{ line: 2, ref: '7', date: D1, party: 'Tushar Mandal', item: 'Cement OPC 53', qty: 5, location: '541+045', use_for: 'BC' }, { line: 3, ref: '8', date: D1, party: 'RCL', item: 'Engine Oil 15W40', qty: 500, use_for: 'Consumable' }];
  r = await A.w('importDocs', { kind: 'issue', rows: irows });
  ok('Issue import: one paper short of stock – nothing imported (all or none)', r.status === 409 && r.j.code === 'short' && sql('rcl', 'select count(*) from store_issue') === '2', r.j);

  // ---- (28-10-2026) the assistant's look-ups (Mechanical's Ask): through the Store's own reports, with the person's own access ----
  const stockNow = (await A.w('boot')).j.stock;
  r = await A.w('aiLook', { name: 'store_stock', args: { query: 'cement' } });
  const crow = (r.j.rows || [])[0] || {};
  ok('aiLook store_stock "cement" (the Store Admin): the Stock report made short – its row by column names (Cement OPC 53, its stock)', r.status === 200 && r.j.report === 'Stock' && r.j.count === 1 && crow.Item === 'Cement OPC 53' && crow.Code === CEM && crow.Stock === stockNow[CEM] && r.j.totalOfTheWholeReport, r.j);
  r = await A.w('aiLook', { name: 'store_item_ledger', args: { item: 'engine oil', from: D10, to: today } });
  ok('   store_item_ledger "engine oil": that item\'s ledger', r.status === 200 && r.j.report === 'Item ledger – ' + OIL + ' Engine Oil 15W40' && r.j.count >= 1, r.j);
  r = await A.w('aiLook', { name: 'store_inward', args: { from: D10, to: today } });
  ok('   store_inward: the GRN register of the dates', r.status === 200 && r.j.report === 'Inward (GRN) register' && r.j.count >= 1, r.j);
  r = await A.w('aiLook', { name: 'store_outward', args: { from: D10, to: today } });
  ok('   store_outward: the Issue (Outward) register', r.status === 200 && r.j.report === 'Issue (Outward) register' && r.j.count >= 1, r.j);
  r = await V.w('aiLook', { name: 'store_requirements', args: {} });
  ok('   a User with the reports (view): the requirements', r.status === 200 && /^Material requirements/.test(r.j.report) && r.j.count >= 1, r.j);
  r = await B.w('aiLook', { name: 'store_stock', args: {} });
  ok('   sujit at T2 (no Stock & Reports there): refused as the page is ("You have no access to Stock & Reports on this site …")', r.status === 403 && /^You have no access to Stock & Reports on this site/.test(r.j.error), r.j);
  r = await A.w('aiLook', { name: 'grnDelete', args: { no: 1 } });
  ok('   anything else: "There is no such look-up of the Store." (nothing deleted)', r.status === 400 && r.j.error === 'There is no such look-up of the Store.' && Number(sql('rcl', 'select count(*) from store_grn')) === 6, r.j);

  // ---- every site its own data: T2 ----
  r = await B.w('reqList');
  ok('sujit at T2 (Store Purchase): T2\'s requirements only – none of S1\'s', r.status === 200 && r.j.reqs.length === 0, r.j);
  r = await B.w('boot');
  ok('   T2\'s stock has nothing of S1', r.status === 200 && Object.keys(r.j.stock).length === 0, r.j.stock);
  ok('S1\'s papers stay in S1\'s database', sql('rcl_s2', 'select count(*) from store_grn') === '0' && sql('rcl_s2', 'select count(*) from store_issue') === '0' && Number(sql('rcl', 'select count(*) from store_grn')) === 6);
  ok('who did what is kept (the Store\'s activity record)', Number(sql('rcl', "select count(*) from store_activity where action in ('GRN made', 'Issue made', 'Requirement approved', 'PO made', 'Return made', 'Approvers set')")) >= 8);

  // ---- (28-10-2026, his formats: "DIESEL PURCHASE ORDER", "REQUIREMENT OF EXHAUST FANS") the Store's step 5: the PO's own fields,
  // its approval; the papers' settings; the numbers RCL/VTR/PO/…, RCL/VTR/PR/… ----
  const po5 = x => Object.assign({ date: D1, vendor: 'Bedrok Chem Infra', lines: [{ code: OIL, qty: 5, rate: 300, disc_pct: 2, hsn: '2710' }] }, x || {});
  r = await B.w('poSave', { site: 'S1', po: po5({ freight: 100 }) });
  ok('before step 5: a PO with Freight (a field of step 5) is refused – it says what to run', r.status === 400 && /sql\/store_step5_po_format\.sql/.test(r.j.error), r.j);
  let s5 = ''; try { s5 = sqlFile('rcl', path.join(root, 'sql', 'store_step5_po_format.sql')) + sqlFile('rcl', path.join(root, 'sql', 'store_step5_po_format.sql')); } catch (e) { s5 = 'FAULT ' + e.message; }
  ok('step 5 runs twice without a fault (it only adds; the POs of before are kept as they are)', (s5.match(/Store step 5 done · POs \d+ · new columns 11 of 11/g) || []).length === 2 && sql('rcl', "select count(*) from store_po where appr is not null or freight <> 0") === '0', s5);
  await wait(1200);
  r = await A.w('papersSave', { prefix: 'RCL/VTR', email: 'purchase@rcl.test', phone: '022 0000 0000', cin: 'U00000MH0000PLC000000', web: 'https://rcl.test', ship_to: 'VTR site office\nBhiwandi', site_contact: 'Site office : 9000000000', terms: '1. Payment : 100 % Advance\n2. Delivery: Immediate' });
  ok('Store Settings → Papers (the Store Admin): the numbers\' prefix, the heading\'s e-mail / contact / CIN / web, a new PO\'s address, contact, terms', r.status === 200 && r.j.papers.prefix === 'RCL/VTR' && r.j.papers.ship_to === 'VTR site office\nBhiwandi' && r.j.step5 === true, r.j);
  r = await K.w('papersSave', { prefix: 'X' });
  ok('   a User cannot set them', r.status === 403, r.j);
  // (29-10-2026, "print war … site address nahi") the site's address on the papers; a box not sent (an older app) keeps what it has
  r = await A.w('papersSave', Object.assign({}, r.j.papers || {}, { prefix: 'RCL/VTR', email: 'purchase@rcl.test', phone: '022 0000 0000', cin: 'U00000MH0000PLC000000', web: 'https://rcl.test', ship_to: 'VTR site office\nBhiwandi', site_contact: 'Site office : 9000000000', terms: '1. Payment : 100 % Advance\n2. Delivery: Immediate', site_address: 'Site office at Valshind\nBhiwandi 421302' }));
  ok('   the Site Address kept (two lines)', r.status === 200 && r.j.papers.site_address === 'Site office at Valshind\nBhiwandi 421302', r.j.papers);
  r = await A.w('papersSave', { prefix: 'RCL/VTR', email: 'purchase@rcl.test', phone: '022 0000 0000', cin: 'U00000MH0000PLC000000', web: 'https://rcl.test', ship_to: 'VTR site office\nBhiwandi', site_contact: 'Site office : 9000000000', terms: '1. Payment : 100 % Advance\n2. Delivery: Immediate' });
  ok('   …a save without it (an older app) keeps it', r.status === 200 && r.j.papers.site_address === 'Site office at Valshind\nBhiwandi 421302', r.j.papers);
  r = await A.w('reqList');
  ok('   the requirement\'s paper gets it (heading.site_address)', r.status === 200 && r.j.heading.site_address === 'Site office at Valshind\nBhiwandi 421302', r.j.heading);
  r = await B.w('purItems', { site: 'S1' });
  ok('   a new PO of S1 starts with them (HO Purchase\'s form)', r.status === 200 && r.j.step5 === true && r.j.papers.terms === '1. Payment : 100 % Advance\n2. Delivery: Immediate' && r.j.papers.site_contact === 'Site office : 9000000000', r.j.papers);
  // nobody approves POs at S1 yet: a PO is approved when made
  r = await B.w('poSave', { site: 'S1', po: po5({ credit_days: 0, site_contact: 'Raj : 9000000001', ship_to: 'VTR site office', freight: 100, load_unload: 50, terms: '1. Payment : advance\n2. Delivery : immediate' }) });
  const P5a = r.j.no;
  ok('step 5, nobody approves POs at S1: the PO with its new fields is approved when made – Amount 5 × 300 less 2 % = 1,470, GST 18 % 264.60, + freight 100 + load 50 = 1,884.60',
    r.status === 200 && r.j.appr === 'Approved' && r.j.total === 1884.6 && sql('rcl', "select appr || '|' || credit_days || '|' || freight || '|' || load_unload || '|' || disc || '|' || site_contact from store_po where no = " + P5a) === 'Approved|0|100|50|30|Raj : 9000000001', r.j);
  // the Super Admin ticks view "Approves purchase orders" at S1: the Store is told
  r = await SA.req('/api/admin', { action: 'storePagesSave', email: 'view@rcl.test', site: 'S1', pages: { dashboard: 'View', items: 'View', req: 'Edit', grn: 'View', issue: 'View', reports: 'View', po: 'View', approve: 'L1', purchase: 'None', poapprove: 'Yes' } }).then(x => x.j);
  const apv5 = JSON.parse(sql('rcl', "select value::text from store_settings where id = 'approvers'") || '{}');
  ok('the Portal: view "Approves purchase orders" at S1 – the Store keeps it (po), the requirement levels as they were', r.ok && !r.warn && r.pages.poapprove === 'Yes' && JSON.stringify((apv5.po || []).map(p => p.email)) === '["view@rcl.test"]' && (apv5.levels || []).length === 2, [r, apv5]);
  r = await B.w('poSave', { site: 'S1', po: po5({ credit_days: 30 }) });
  const P5 = r.j.no;
  ok('   now a new PO waits for its approval', r.status === 200 && r.j.appr === 'Waiting' && sql('rcl', 'select appr from store_po where no = ' + P5) === 'Waiting', r.j);
  r = await K.w('poOpen');
  ok('   a PO not approved: not offered for a GRN', r.status === 200 && !r.j.pos.some(p => p.no === P5) && r.j.pos.some(p => p.no === P5a), r.j.pos.map(p => p.no));
  r = await K.w('grnSave', { grn: { date: D1, supplier: 'Bedrok Chem Infra', po_no: P5, lines: [{ code: OIL, qty: 5, rate: 294, po_line: 1 }] } });
  ok('   a GRN against it is refused ("…not approved yet – its material is taken in on it only after it is approved.")', r.status === 409 && /PO \d+ is not approved yet – its material is taken in on it only after it is approved\./.test(r.j.error), r.j);
  r = await V.w('poList');
  const v5 = (r.j.pos || []).find(p => p.no === P5) || {};
  ok('   view (who approves) sees it with Approve – the PO "waits for" him', r.status === 200 && v5.mayApprove === true && JSON.stringify(v5.waitFor) === JSON.stringify([sql('rcl_portal', "select name from users where email = 'view@rcl.test'")]), v5);
  r = await K.w('poDecide', { no: P5, ok: true });
  ok('   one not ticked (the store keeper) cannot approve it', r.status === 403 && /You do not approve the purchase orders of this site/.test(r.j.error), r.j);
  r = await A.w('poDecide', { no: P5, ok: true });
  ok('   nor sujit, who made it (as HO Purchase): "Nobody approves his own purchase order."', r.status === 403 && r.j.error === 'Nobody approves his own purchase order.', r.j);
  r = await V.w('poDecide', { no: P5, ok: false });
  ok('   a rejection needs its reason', r.status === 400 && r.j.error === 'Say why the PO is rejected (the one who made it sees it).', r.j);
  r = await V.w('poDecide', { no: P5, ok: false, note: 'Rate too high' });
  ok('   rejected – with why; the one who made it changes it: it waits again', r.status === 200 && sql('rcl', "select appr || '|' || appr_note from store_po where no = " + P5) === 'Rejected|Rate too high' &&
    (await B.w('poSave', { site: 'S1', no: P5, po: po5({ credit_days: 30, lines: [{ code: OIL, qty: 5, rate: 290, disc_pct: 2, hsn: '2710' }] }) })).status === 200 && sql('rcl', 'select appr from store_po where no = ' + P5) === 'Waiting', r.j);
  r = await V.w('poDecide', { no: P5, ok: true });
  ok('   approved by view – his name on it; the GRN against it now taken in', r.status === 200 && sql('rcl', "select appr || '|' || appr_by from store_po where no = " + P5) === 'Approved|view@rcl.test' &&
    (await K.w('grnSave', { grn: { date: D1, supplier: 'Bedrok Chem Infra', po_no: P5, lines: [{ code: OIL, qty: 5, rate: 284.2, po_line: 1 }] } })).status === 200, r.j);
  r = await V.w('poDecide', { no: P5, ok: true });
  ok('   once only ("…is not waiting for its approval any more")', r.status === 409 && /is not waiting for its approval any more/.test(r.j.error), r.j);
  // the paper: its number, words, supplier, heading
  r = await A.w('poGet', { no: P5 });
  ok('the PO paper: PO No RCL/VTR/PO/' + D1.slice(0, 4) + '/' + String(P5).padStart(4, '0') + ', the amount in words, the HSN, Approved By, the heading\'s e-mail and CIN',
    r.status === 200 && r.j.po.ref === 'RCL/VTR/PO/' + D1.slice(0, 4) + '/' + String(P5).padStart(4, '0') && /Only$/.test(r.j.po.words) && r.j.po.lines[0].hsn === '2710' && r.j.po.appr_name && r.j.heading.email === 'purchase@rcl.test' && r.j.heading.cin === 'U00000MH0000PLC000000' && r.j.supplier.name === 'Bedrok Chem Infra', r.j);
  r = await V.w('reqList');
  ok('   a requirement\'s Indent No (29-10-2026): <company>/VTR/<financial year>/<M | P>/<4 digits> – the papers\' prefix is not used for it', r.status === 200 && r.j.reqs.length && r.j.reqs.every(x => /^(?:[A-Z]{1,6}\/)?VTR\/\d{4}-\d{2}\/[MP]\/\d{4,}$/.test(x.ref) && (x.for_kind === 'Machinery') === /\/M\//.test(x.ref)) && r.j.heading, r.j.reqs && r.j.reqs.map(x => x.ref));

  console.log(out.join('\n'));
  console.log('TOTAL ' + pass + ' passed, ' + fail + ' failed  (' + Math.round((Date.now() - T0) / 1000) + ' s)');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log(out.join('\n')); console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
