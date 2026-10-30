/* (29-10-2026) THE STORE'S WORKFLOW through its own doors, on the local test rig (never the live databases) – his words: "pratek
 * kamamadhe … entry krnarana to verification la pathawel … verification kel tr te auto jyanche kadhe approval aahe tyanche kade jail …
 * approval zal ki te direct head office la jail … he sagle kam super admin swatache portel madhun krel"; "pratek task approval nantr HO la
 * nahi janar – konte jail konte nahi jail te super admin tharau shakel"; "500 MT chi cement chi order … aaj 100 udya 100 … GRN … PO
 * balance … standard ERP".
 *   the Portal :3010 (Users & Access – "Verifies …", "Approves …"; Workflow – what goes to Head Office), the Store :3020, the site
 *   databases S1 (:3100, rcl) and T2 (:3102, rcl_s2). Test values only.
 *   PART=a node test/workflow.test.js – the Store's step 9 not run (only the requirements' verification; the rest as before)
 *   PART=b node test/workflow.test.js – step 9 run: requirement → verified → approved → HO Purchase → PO → verified → approved → GRN
 *     (the bill, checked with its PO) → verified → approved → Head Office checks it; the PO's balance; sent back; a site that buys itself */
'use strict';
const { execSync } = require('child_process'), path = require('path'), fs = require('fs');
const P = 'http://127.0.0.1:3010', ST = 'http://127.0.0.1:3020', PART = process.env.PART || 'b';
let pass = 0, fail = 0; const out = [], T0 = Date.now();
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 700) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
const sqlFile = (db, f) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -v ON_ERROR_STOP=1 -tA -q"', { input: fs.readFileSync(f) }).toString();
const wait = ms => new Promise(r => setTimeout(r, ms));
function client(base) {
  let cookie = '';
  const req = async (p, body) => {
    const h = { 'Content-Type': 'application/json', 'X-RCL': '1' }; if (cookie) h.Cookie = cookie;
    const r = await fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(90000) });
    const sc = r.headers.get('set-cookie'); if (sc) { const v = sc.split(';')[0]; cookie = /=$/.test(v) ? '' : v; }
    let j = {}; try { j = JSON.parse(await r.text()); } catch (e) { j = {}; }
    return { status: r.status, j: j, loc: r.headers.get('location') || '' };
  };
  return { req };
}
async function storeAs(email, pw, site) {
  const p = client(P), l = await p.req('/api/auth', { action: 'login', email: email, password: pw });
  if (l.status !== 200) throw new Error('Portal sign-in of ' + email + ': ' + JSON.stringify(l.j));
  const s = client(ST), r = await s.req('/api/sso', { ticket: ((await p.req('/api/go?module=store&site=' + site)).loc.split('#sso=')[1] || '') });
  if (r.status !== 200) throw new Error('Store sign-in of ' + email + ' at ' + site + ': ' + JSON.stringify(r.j));
  const w = (action, x) => s.req('/api/work', Object.assign({ action: action }, x || {}));
  return { p, s, r, w, me: async () => (await s.req('/api/me')).j };
}
const PW = 'Nashik#Road848!', VPW = 'Audit#PassView9!x', SAPW = 'Super#Admin2041';
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const root = path.join(__dirname, '..'), PORTAL_DIR = process.env.PORTAL_DIR || path.join(root, '..', 'rcl-portal');

(async () => {
  // ---- the start: every Store step in S1 and T2 (step 9 only in PART b), the tables empty; the Portal's step 6 ----
  for (const db of ['rcl', 'rcl_s2']) {
    for (const f of ['store_step1_items', 'store_step2_work', 'store_step3_grn_import', 'store_step4_grn_no', 'store_step5_po_format', 'store_step6_grn_discount', 'store_step7_req_photos', 'store_step8_req_indent']) sqlFile(db, path.join(root, 'sql', f + '.sql'));
    sql(db, 'truncate public.store_return_lines, public.store_return, public.store_issue_lines, public.store_issue, public.store_grn_lines, public.store_grn, public.store_opening, public.store_po, public.store_req, public.store_settings, public.items, public.store_sessions, public.store_tickets, public.store_activity cascade; ' +
      "alter sequence public.items_code_seq restart; update public.store_numbers set next_no = 1; delete from public.store_numbers where kind like 'IND %'; notify pgrst, 'reload schema';");
    if (PART === 'a') sql(db, "drop index if exists public.store_po_wf, public.store_grn_wf, public.store_issue_wf, public.store_return_wf; alter table public.store_po drop column if exists wf; alter table public.store_grn drop column if exists wf; alter table public.store_issue drop column if exists wf; alter table public.store_return drop column if exists wf; notify pgrst, 'reload schema';");
  }
  if (PART === 'b') {
    let twice = true; try { for (const db of ['rcl', 'rcl_s2']) { sqlFile(db, path.join(root, 'sql', 'store_step9_workflow.sql')); sqlFile(db, path.join(root, 'sql', 'store_step9_workflow.sql')); } } catch (e) { twice = String(e.message).slice(0, 200); }
    ok('the Store\'s step 9 runs twice in each site\'s database without a fault (it only adds)', twice === true, twice);
    ok('   it adds the column wf to the PO, the GRN, the issue and the return', sql('rcl', "select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'wf' and table_name in ('store_po','store_grn','store_issue','store_return')") === '4');
  }
  sqlFile('rcl_portal', path.join(PORTAL_DIR, 'sql', 'portal_step6_rules.sql'));
  sql('rcl_portal', "insert into modules (key, name, url, status, sort) values ('store', 'Store', 'http://127.0.0.1:3020', 'live', 2) on conflict (key) do update set url = excluded.url, status = 'live'; " +
    "delete from access where module = 'store'; update sites set rules = null; " +
    "insert into users (email, name, password_hash, active) select 'acct@rcl.test', 'Asha Accounts', password_hash, true from users where email = 'view@rcl.test' on conflict (email) do update set password_hash = excluded.password_hash, active = true; notify pgrst, 'reload schema';");
  await wait(1500);
  const SA = client(P); let r = await SA.req('/api/auth', { action: 'login', email: 'sa@rcl.test', password: SAPW });
  ok('the Super Admin signs in to the Portal', r.status === 200 && r.j.user && r.j.user.super, r.j);
  const acc = async (email, site, role) => (await SA.req('/api/admin', { action: 'accessSet', email: email, site: site, module: 'store', role: role })).j;
  for (const [e, s, ro] of [['sujit@rcl.test', 'S1', 'admin'], ['sujit@rcl.test', 'T2', 'user'], ['view@rcl.test', 'S1', 'user'], ['store@rcl.test', 'S1', 'user'], ['acct@rcl.test', 'S1', 'user']]) await acc(e, s, ro);
  const pages = async (email, site, pg) => (await SA.req('/api/admin', { action: 'storePagesSave', email: email, site: site, pages: pg })).j;
  // store – the store keeper makes the entries; view – verifies every work (and sees the pages); acct – approves (requirements level 1, POs, GRN,
  // issues), no page given to him; sujit – Store Admin at S1, HO Purchase at T2
  r = await pages('store@rcl.test', 'S1', { dashboard: 'View', items: 'Edit', req: 'Edit', grn: 'Edit', issue: 'Edit', reports: 'View', po: 'View' });
  ok('store (the store keeper): Requirements, Inward (GRN), Issue & Return Edit', r.ok && r.pages.grn === 'Edit', r);
  r = await pages('view@rcl.test', 'S1', { dashboard: 'View', items: 'View', req: 'View', grn: 'View', issue: 'View', po: 'View', vreq: 'Yes', vpo: 'Yes', vgrn: 'Yes', viss: 'Yes' });
  ok('view: "Verifies requirements / purchase orders / GRN / issues & returns" – Yes, kept with his pages', r.ok && r.pages.vreq === 'Yes' && r.pages.vpo === 'Yes' && r.pages.vgrn === 'Yes' && r.pages.viss === 'Yes' && r.pages.agrn === 'None', r);
  ok('   ' + (PART === 'a' ? 'the Store\'s step 9 not run at S1: the Super Admin is told (the rest is saved and told)' : 'step 9 run: nothing more to say'), PART === 'a' ? /store_step9_workflow\.sql/.test(String(r.warn)) && /Saved and told to the Store/.test(String(r.warn)) : !r.warn, r);
  r = await pages('acct@rcl.test', 'S1', { approve: 'L1', poapprove: 'Yes', agrn: 'Yes', aiss: 'Yes' });
  ok('acct: approves requirements (Level 1), purchase orders, GRN, issues & returns – no page given to him', r.ok && r.pages.approve === 'L1' && r.pages.agrn === 'Yes' && r.pages.req === 'None', r);
  r = await pages('sujit@rcl.test', 'T2', { dashboard: 'View', items: 'View', purchase: 'Edit' });
  ok('sujit at T2: Store Purchase – every site (HO Purchase)', r.ok && r.pages.purchase === 'Edit', r);
  r = await SA.req('/api/admin', { action: 'rulesSave', site: 'S1', ho: { req: true, grn: true, iss: false } });
  ok('Portal → Workflow: S1\'s requirements to HO Purchase, its GRNs (the bills) to Head Office, its issues not – saved and told to the Store', r.status === 200 && r.j.ok && JSON.stringify(r.j.ho) === '{"req":true,"grn":true,"iss":false}', r.j);
  const set = JSON.parse(sql('rcl', "select value::text from store_settings where id = 'approvers'") || '{}');
  const em = l => (l || []).map(p => p.email).sort().join(',');
  ok('   S1\'s database keeps the workflow (signed, once): who verifies each work, who approves the GRN / issues, what goes to Head Office',
    set.wf && em(set.wf.verify.req) === 'view@rcl.test' && em(set.wf.verify.po) === 'view@rcl.test' && em(set.wf.verify.grn) === 'view@rcl.test' && em(set.wf.verify.iss) === 'view@rcl.test' && em(set.wf.approve.grn) === 'acct@rcl.test' && em(set.wf.approve.iss) === 'acct@rcl.test' &&
    set.wf.ho.req === true && set.wf.ho.grn === true && set.wf.ho.iss === false && em(set.levels[0].people) === 'acct@rcl.test' && em(set.po) === 'acct@rcl.test', set);
  r = await SA.req('/api/admin', { action: 'overview' });
  ok('   the console shows the site\'s Head Office choices', JSON.stringify((r.j.sites.find(s => s.code === 'S1') || {}).ho) === '{"req":true,"grn":true,"iss":false}', r.j.sites);

  const K = await storeAs('store@rcl.test', VPW, 'S1'), V = await storeAs('view@rcl.test', VPW, 'S1'), AC = await storeAs('acct@rcl.test', VPW, 'S1'), A = await storeAs('sujit@rcl.test', PW, 'S1'), HO = await storeAs('sujit@rcl.test', PW, 'T2');
  const vm = await V.me(), am = await AC.me();
  ok('one who verifies / approves sees the pages of that work (View) – also when not given: acct sees Requirements, POs, GRN, Issue & Return',
    vm.pages.req === 'View' && vm.pages.grn === 'View' && am.pages.req === 'View' && am.pages.po === 'View' && am.pages.grn === 'View' && am.pages.issue === 'View' && am.pages.reports === 'None', [vm.pages, am.pages]);
  const item = async (name, unit, cat, gst) => ((await A.s.req('/api/items', { action: 'save', item: { name: name, unit: unit, category: cat, gst: gst } })).j.item || {}).code;
  const CEM = await item('Cement OPC 53', 'Ton', 'Cement', '28'), WIRE = await item('Binding Wire', 'Kg', 'Steel', '18');
  ok('the items made', /^ITM-/.test(CEM || '') && /^ITM-/.test(WIRE || ''), [CEM, WIRE]);

  // ---- the requirement: verified first (no SQL needed), then approved ----
  r = await K.w('reqSave', { req: { date: today, for_kind: 'Site work', for_text: 'Ch 540 culvert', lines: [{ code: CEM, qty: 500 }] } });
  const RQ = r.j.no;
  ok('a requirement made by the store keeper waits for its VERIFICATION (view) – not for level 1', r.status === 200 && r.j.status === 'Pending' && r.j.level === 0 && r.j.step === 'verify' && JSON.stringify(r.j.waitFor) === '["View User"]', r.j);
  let L = (await AC.w('reqList')).j.reqs.find(x => x.no === RQ);
  ok('   acct (level 1) sees it waiting for its verification – he cannot approve it yet', L && L.step === 'verify' && L.mayApprove === false && L.mayVerify === false && JSON.stringify(L.waitFor) === '["View User"]', L);
  r = await AC.w('reqDecide', { no: RQ, ok: true });
  ok('   refused to him: it waits for its verification', r.status === 409 && /waits for its verification – not yours/.test(r.j.error), r.j);
  r = await K.w('reqDecide', { no: RQ, ok: true });
  ok('   nobody verifies his own requirement', r.status === 409 && /your own requirement/.test(r.j.error), r.j);
  L = (await V.w('reqList')).j.reqs.find(x => x.no === RQ);
  ok('   view: "Verify" (an older app sees "Approve" – the same for him)', L && L.mayVerify === true && L.mayApprove === true && L.step === 'verify', L);
  r = await V.w('reqDecide', { no: RQ, ok: true });
  ok('   verified → it waits for level 1', r.status === 200 && r.j.done[0].status === 'Pending' && r.j.done[0].level === 1 && r.j.done[0].step === 'verify', r.j);
  r = await AC.w('reqDecide', { no: RQ, ok: true });
  L = (await K.w('reqList')).j.reqs.find(x => x.no === RQ);
  ok('   acct approves it (level 1) → Approved; its record: verified by View User, approved by Asha Accounts', r.status === 200 && L.status === 'Approved' && L.approvals.length === 2 && L.approvals[0].step === 'verify' && L.approvals[0].name === 'View User' && L.approvals[1].level === 1, L);
  // a second requirement, rejected at its verification
  r = await K.w('reqSave', { req: { date: today, for_kind: 'Site work', for_text: 'Toe wall', lines: [{ code: WIRE, qty: 10 }] } });
  const RQ2 = r.j.no; r = await V.w('reqDecide', { no: RQ2, ok: false });
  ok('   a rejection at the verification needs why', r.status === 400 && /Say why/.test(r.j.error), r.j);
  r = await V.w('reqDecide', { no: RQ2, ok: false, note: 'Not needed now' });
  ok('   rejected at its verification (why kept)', r.status === 200 && r.j.done[0].status === 'Rejected', r.j);

  // ---- HO Purchase: the approved requirement – who made it, since when it waits; its PO ----
  r = await HO.w('purPending');
  const s1 = (r.j.sites || []).find(s => s.site === 'S1'), q1 = s1 && s1.reqs.find(x => x.no === RQ);
  ok('HO Purchase sees S1\'s approved requirement – made by the store keeper, waiting since today', q1 && q1.made_by === 'Store Keeper' && q1.since === today && q1.lines[0].left === 500, s1);
  r = await A.w('poSave', { po: { date: today, vendor: 'Ultra Cement Depot', lines: [{ code: CEM, qty: 500, rate: 400 }] } });
  ok('S1\'s Store Admin cannot make a PO while its requirements go to HO Purchase', r.status === 403 && r.j.code === 'purchase', r.j);
  r = await HO.w('poSave', { site: 'S1', po: { date: today, vendor: 'Ultra Cement Depot', lines: [{ code: CEM, qty: 500, rate: 400, disc_pct: 5, gst_pct: 28, req_no: RQ, req_line: 1 }] } });
  const PO = r.j.no;
  ok('HO Purchase makes its PO (500 MT at 400 less 5 %) – ' + (PART === 'b' ? 'it waits for its VERIFICATION first' : 'before step 9: it waits for its approval (as before)'), r.status === 200 && r.j.appr === 'Waiting' && r.j.step === (PART === 'b' ? 'verify' : 'approve'), r.j);
  let pl = (await AC.w('poList')).j.pos.find(p => p.no === PO);
  if (PART === 'b') {
    ok('   acct (approves POs) cannot approve it before its verification', pl && pl.step === 'verify' && pl.mayApprove === false && JSON.stringify(pl.waitFor) === '["View User"]', pl);
    r = await AC.w('poDecide', { no: PO, ok: true });
    ok('   refused to him', r.status === 403 && /do not verify/.test(r.j.error), r.j);
    pl = (await V.w('poList')).j.pos.find(p => p.no === PO);
    ok('   view verifies it ("Verify"; an older app: "Approve")', pl && pl.mayVerify === true && pl.mayApprove === true, pl);
    r = await V.w('poDecide', { no: PO, ok: true });
    ok('   verified → waits for its approval', r.status === 200 && r.j.appr === 'Waiting' && r.j.step === 'approve', r.j);
    r = await K.w('grnSave', { grn: { date: today, supplier: 'Ultra Cement Depot', po_no: PO, lines: [{ code: CEM, qty: 100, rate: 400, po_line: 1 }] } });
    ok('   no GRN on it before its approval', r.status === 409 && r.j.code === 'notapproved', r.j);
  }
  r = await AC.w('poDecide', { no: PO, ok: true });
  ok('acct approves the PO', r.status === 200 && r.j.appr === 'Approved', r.j);
  r = await HO.w('poGet', { site: 'S1', no: PO });
  ok('   its paper: ' + (PART === 'b' ? 'Verified By – View User' : 'no verification'), r.status === 200 && r.j.po.verified_by === (PART === 'b' ? 'View User' : '') && r.j.po.appr_name === 'Asha Accounts', r.j.po && [r.j.po.verified_by, r.j.po.appr_name]);

  // ---- the GRNs (the bills) against the 500 MT PO: 100 today, 100 again … – each checked with the PO; the PO's balance ----
  const g1 = await K.w('grnSave', { grn: { date: today, supplier: 'Ultra Cement Depot', invoice_no: 'UC/101', po_no: PO, lines: [{ code: CEM, qty: 100, rate: 400, disc: '5%', disc_on: 'basic', gst_pct: 28, po_line: 1 }] } });
  ok('GRN 1: 100 MT as per the PO – ' + (PART === 'b' ? 'it waits for its verification' : 'saved as before (no workflow)'), g1.status === 200 && g1.j.wf === (PART === 'b' ? 'verify' : '') && !g1.j.note, g1.j);
  const g2 = await K.w('grnSave', { grn: { date: today, supplier: 'Ultra Cement Depot', invoice_no: 'UC/102', po_no: PO, lines: [{ code: CEM, qty: 100, rate: 400, gst_pct: 28, po_line: 1 }] } });
  ok('GRN 2: 100 MT billed at 400 (no discount – the PO\'s is 380)', g2.status === 200, g2.j);
  pl = (await K.w('poList')).j.pos.find(p => p.no === PO);
  ok('the PO at the site: ordered 500 · came 200 · balance 300 – Part received, 2 GRNs', pl && pl.lines[0].received === 200 && pl.lines[0].left === 300 && pl.state === 'Part received' && pl.grns === 2, pl);
  r = await HO.w('poList', { all: true });
  const pa = r.j.pos.find(p => p.site === 'S1' && p.no === PO);
  ok('   HO Purchase sees the same PO in full with its balance', pa && pa.lines[0].qty === 500 && pa.lines[0].left === 300 && pa.grns === 2, pa);
  r = await HO.w('poGrns', { site: 'S1', no: PO });
  ok('   its details: ordered 500 (₹1,90,000) · came 200 (₹76,000) · balance 300 (₹1,14,000) at 380',
    r.status === 200 && JSON.stringify(r.j.lines.map(l => [l.qty, l.came, l.left, l.rate, l.value, l.cameValue, l.leftValue])) === '[[500,200,300,380,190000,76000,114000]]', r.j.lines);
  const c1 = (r.j.grns || []).find(g => g.no === g1.j.no), c2 = (r.j.grns || []).find(g => g.no === g2.j.no);
  ok('   GRN 1 – as per PO; GRN 2 – its rate 400 above the PO\'s 380', c1 && c1.check.ok === true && c2 && c2.check.ok === false && JSON.stringify(c2.check.diffs) === JSON.stringify([{ kind: 'rate', name: 'Cement OPC 53', unit: 'Ton', po: 380, bill: 400 }]), [c1 && c1.check, c2 && c2.check]);
  r = await K.w('grnSave', { grn: { date: today, supplier: 'Ultra Cement Depot', po_no: PO, lines: [{ code: CEM, qty: 350, rate: 400, disc: '5%', gst_pct: 28, po_line: 1 }] } });
  ok('   350 more than the 300 still to come: asked first (as before)', r.status === 409 && r.j.code === 'over', r.j);
  r = await K.w('grnList', { from: today, to: today });
  const gl = r.j.grns.find(g => g.no === g2.j.no);
  ok('the GRN list: each with its bill checked with the PO', gl && gl.check && gl.check.ok === false && gl.check.diffs[0].kind === 'rate', gl);

  if (PART === 'a') {
    r = await V.w('wfDecide', { kind: 'grn', no: g1.j.no, ok: true });
    ok('before step 9: a GRN\'s verification says what to run', r.status === 400 && /store_step9_workflow\.sql/.test(r.j.error), r.j);
    r = await V.w('wfMine');
    ok('   nothing waits (as before)', r.status === 200 && r.j.step9 === false && !r.j.grns.length, r.j);
    r = await HO.w('hoInbox', { kind: 'grn' });
    ok('   Head Office\'s list says the step is missing at the site', r.status === 200 && r.j.sites.find(s => s.site === 'S1').step9 === false, r.j);
    r = await K.w('issueSave', { issue: { date: today, to_kind: 'Site work', use_for: 'Culvert', lines: [{ code: CEM, qty: 5 }] } });
    ok('   an issue saved as before', r.status === 200 && r.j.wf === '', r.j);
  } else {
    // ---- the GRN's verification, approval, Head Office ----
    r = await V.w('wfMine');
    ok('view – waiting for him: both GRNs (to verify)', r.status === 200 && r.j.grns.length === 2 && r.j.grns.every(g => g.step === 'verify' && g.mayDecide) && r.j.grns.some(g => g.check), r.j);
    r = await AC.w('wfDecide', { kind: 'grn', no: g1.j.no, ok: true });
    ok('   acct cannot approve a GRN before its verification', r.status === 403 && /do not verify/.test(r.j.error), r.j);
    r = await K.w('wfDecide', { kind: 'grn', no: g1.j.no, ok: true });
    ok('   the store keeper never his own', r.status === 403 && /his own entry/.test(r.j.error), r.j);
    r = await V.w('wfDecide', { kind: 'grn', no: g1.j.no, ok: true });
    ok('   view verifies GRN 1 → it waits for its approval', r.status === 200 && r.j.state === 'approve' && !r.j.ho, r.j);
    r = await V.w('wfDecide', { kind: 'grn', no: g1.j.no, ok: true });
    ok('   decided once only', r.status === 403 || r.status === 409, r.j);
    r = await AC.w('wfDecide', { kind: 'grn', no: g1.j.no, ok: true });
    ok('   acct approves it → done, to Head Office (S1\'s rule)', r.status === 200 && r.j.state === 'done' && r.j.ho === true, r.j);
    r = await V.w('wfDecide', { kind: 'grn', no: g2.j.no, ok: false });
    ok('   sending back needs why', r.status === 400, r.j);
    r = await V.w('wfDecide', { kind: 'grn', no: g2.j.no, ok: false, note: 'Rate as per PO is 380' });
    ok('   GRN 2 sent back (the rate) – for correction', r.status === 200 && r.j.state === 'returned', r.j);
    const w2 = JSON.parse(sql('rcl', 'select wf::text from store_grn where no = ' + g2.j.no) || '{}');
    ok('   kept: who sent it back and why', w2.state === 'returned' && w2.steps[0].name === 'View User' && w2.steps[0].note === 'Rate as per PO is 380', w2);
    r = await HO.w('hoInbox', { kind: 'grn' });
    const hs = r.j.sites.find(s => s.site === 'S1');
    ok('Head Office (HO Purchase) sees S1\'s approved bill – GRN 1 only, with its check', hs && hs.ho === true && hs.rows.length === 1 && hs.rows[0].no === g1.j.no && hs.rows[0].check.ok === true, hs);
    // the Store Admin corrects GRN 2 (the rate) – it starts again
    r = await A.w('grnSave', { no: g2.j.no, grn: { date: today, supplier: 'Ultra Cement Depot', invoice_no: 'UC/102', po_no: PO, lines: [{ code: CEM, qty: 100, rate: 380, gst_pct: 28, po_line: 1 }] } });
    ok('   the Store Admin corrects GRN 2 → it waits for its verification again', r.status === 200 && r.j.wf === 'verify', r.j);
    r = await HO.w('poGrns', { site: 'S1', no: PO });
    ok('   now as per PO', (r.j.grns.find(g => g.no === g2.j.no) || {}).check.ok === true, r.j.grns);
    r = await A.w('wfDecide', { kind: 'grn', no: g2.j.no, ok: true });
    ok('   the Store Admin who changed it does not verify it (his own entry now)', r.status === 403, r.j);
    const w3 = JSON.parse(sql('rcl', 'select wf::text from store_grn where no = ' + g2.j.no) || '{}');
    ok('   (the review) kept: who changed it AND who made it – neither of them verifies or approves it', w3.by === 'sujit@rcl.test' && w3.made === 'store@rcl.test' && w3.state === 'verify', w3);
    r = await K.w('wfDecide', { kind: 'grn', no: g2.j.no, ok: true });
    ok('   the store keeper who made it does not either', r.status === 403 && /his own entry/.test(r.j.error), r.j);
    r = await HO.w('hoCheck', { site: 'S1', kind: 'grn', no: g2.j.no });
    ok('   Head Office checks only what was sent to it', r.status === 409, r.j);
    r = await HO.w('hoCheck', { site: 'S1', kind: 'grn', no: g1.j.no, note: 'Bill passed' });
    ok('HO Purchase: ✓ Checked GRN 1', r.status === 200 && r.j.ok, r.j);
    r = await HO.w('hoCheck', { site: 'S1', kind: 'grn', no: g1.j.no });
    ok('   once only', r.status === 409, r.j);
    r = await HO.w('hoInbox', { kind: 'grn' }); const r2 = await HO.w('hoInbox', { kind: 'grn', done: true });
    ok('   gone from "to check", in "checked" (who, the note)', !r.j.sites.find(s => s.site === 'S1').rows.length && r2.j.sites.find(s => s.site === 'S1').rows[0].wf.hoOk.note === 'Bill passed', [r.j.sites, r2.j.sites]);
    r = await K.w('hoInbox', { kind: 'grn' });
    ok('   the store keeper has no Head Office list', r.status === 403, r.j);
    // ---- an issue: verified, approved – not to Head Office (S1's rule); a return ----
    r = await K.w('issueSave', { issue: { date: today, to_kind: 'Site work', use_for: 'Culvert', lines: [{ code: CEM, qty: 5, returnable: true }] } });
    const IS = r.j.no;
    ok('an issue waits for its verification (its stock counted at once, as always)', r.status === 200 && r.j.wf === 'verify' && sql('rcl', "select sum(q) from store_moves where code = '" + CEM + "'") === '195', [r.j, sql('rcl', "select sum(q) from store_moves where code = '" + CEM + "'")]);
    await V.w('wfDecide', { kind: 'issue', no: IS, ok: true }); r = await AC.w('wfDecide', { kind: 'issue', no: IS, ok: true });
    ok('   verified, approved – done, not to Head Office', r.status === 200 && r.j.state === 'done' && r.j.ho === false, r.j);
    r = await K.w('issueList', { from: today, to: today }); const il = r.j.issues.find(i => i.no === IS);
    ok('   the list shows it approved (by acct)', il && il.wf.state === 'done' && il.wf.steps.length === 2, il);
    r = await K.w('retSave', { ret: { issue_no: IS, date: today, lines: [{ issue_line: il.lines[0].id, qty: 2 }] } });
    ok('   a return waits for its verification too', r.status === 200 && r.j.wf === 'verify', r.j);
    r = await V.w('wfMine');
    ok('   view: the issue with its return waiting', r.j.issues.length === 1 && r.j.issues[0].returns[0].mayDecide === true && r.j.grns.length === 1, r.j);
    // ---- the dashboard; nobody verifies any more – its approval ----
    r = await V.w('dash');
    ok('the dashboard: what waits for view (1 GRN, 1 return)', r.j.wf && r.j.wf.grn === 1 && r.j.wf.ret === 1, r.j.wf);
    await pages('view@rcl.test', 'S1', { dashboard: 'View', items: 'View', req: 'View', grn: 'View', issue: 'View', po: 'View', vreq: 'Yes', vpo: 'Yes', vgrn: 'None', viss: 'Yes' });
    r = await AC.w('wfMine');
    ok('nobody verifies the GRNs any more: GRN 2 waits for its approval (acct)', r.j.grns.length === 1 && r.j.grns[0].step === 'approve' && r.j.grns[0].mayDecide, r.j);
    r = await AC.w('wfDecide', { kind: 'grn', no: g2.j.no, ok: true });
    ok('   acct approves it → to Head Office', r.status === 200 && r.j.state === 'done' && r.j.ho === true, r.j);
    // ---- a site that buys itself (the Portal → Workflow: its requirements not to Head Office) ----
    r = await SA.req('/api/admin', { action: 'rulesSave', site: 'S1', ho: { req: false, grn: true, iss: false } });
    ok('Workflow: S1\'s requirements not to Head Office – S1 buys them itself', r.status === 200, r.j);
    r = await K.w('reqSave', { req: { date: today, for_kind: 'Office', for_text: 'Site office', lines: [{ code: WIRE, qty: 4 }] } });
    const RQ3 = r.j.no; await V.w('reqDecide', { no: RQ3, ok: true }); await AC.w('reqDecide', { no: RQ3, ok: true });
    r = await HO.w('purPending');
    ok('   HO Purchase: S1 buys itself (its requirements not in his list)', (r.j.sites.find(s => s.site === 'S1') || {}).own === true, r.j.sites);
    r = await A.w('purPending', { mine: true });
    ok('   S1\'s Store Admin sees what is to order at S1', r.status === 200 && r.j.sites[0].reqs.some(x => x.no === RQ3), r.j);
    r = await K.w('purPending', { mine: true });
    ok('   a Store User does not', r.status === 403, r.j);
    r = await A.w('poSave', { po: { date: today, vendor: 'Local Hardware', lines: [{ code: WIRE, qty: 4, rate: 90, gst_pct: 18, req_no: RQ3, req_line: 1 }] } });
    ok('   S1\'s Store Admin makes its PO – it waits for its verification', r.status === 200 && r.j.step === 'verify', r.j);
    const PO3 = r.j.no; r = await A.w('poList'); ok('   and changes / cancels / deletes the POs of his site (buy)', r.j.buy === true, r.j.buy);
    r = await A.w('poDelete', { no: PO3 }); ok('   his PO deleted (nothing came)', r.status === 200, r.j);
    // the activity record
    const act = sql('rcl', "select string_agg(distinct action, '|') from store_activity");
    ok('the activity record: verified, approved, sent back, checked by Head Office', ['Requirement verified', 'PO verified', 'PO approved', 'GRN verified', 'GRN approved', 'GRN sent back (verify)', 'Checked by Head Office', 'Issue approved', 'Approvers set'].every(a => act.split('|').indexOf(a) > -1), act);
  }
  // nothing of the stock changed by the workflow: 200 MT came, 5 issued (part a: 5 issued) – as the moves say
  console.log(out.join('\n'));
  console.log('TOTAL ' + pass + ' passed, ' + fail + ' failed  (' + Math.round((Date.now() - T0) / 1000) + ' s)');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log(out.join('\n')); console.log('CRASH ' + (e && e.stack || e)); console.log('TOTAL ' + pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
