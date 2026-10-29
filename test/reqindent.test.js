/* (29-10-2026) The Store's step 8 and the Portal's step 5, through their own doors, on the local test rig (never the live databases):
 *   the Indent No. (RCL/VTR/2026-27/M/0001 – each financial year and letter from 0001); the papers' heading from the Portal (no save in
 *   the Store); the site's address and contact (Portal → Sites) → a requirement's and a PO's start; a machinery's maintenance log book
 *   attached (Mechanical's table "maintenance" of the same database), printed; a requirement changed after its approval (approved
 *   again), never while a PO has it; deleted; a photo taken out; the log book attached / taken out; a PO deleted (never one whose
 *   material came).
 *   node test/reqindent.test.js   – after test/work.test.js (its items, access and papers), the Store server started afresh
 * It puts back the rig's company and site as they were; the requirements it made stay deleted. */
'use strict';
const { execSync } = require('child_process'), path = require('path'), fs = require('fs');
const P = 'http://127.0.0.1:3010', ST = 'http://127.0.0.1:3020';
let pass = 0, fail = 0; const out = [], T0 = Date.now();
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 600) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
const sqlFile = (db, f) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -v ON_ERROR_STOP=1 -tA -q"', { input: fs.readFileSync(f), stdio: ['pipe', 'pipe', 'ignore'] }).toString();
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
  const t = await p.req('/api/go?module=store&site=' + site + '&json=1');
  const s = client(ST), r = await s.req('/api/sso', { ticket: t.j.ticket });
  if (r.status !== 200) throw new Error('Store sign-in of ' + email + ' at ' + site + ': ' + JSON.stringify(r.j));
  return { s, r, w: (action, x) => s.req('/api/work', Object.assign({ action: action }, x || {})) };
}
const PW = 'Nashik#Road848!', VPW = 'Audit#PassView9!x', SAPW = 'Super#Admin2041';
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const FY = (() => { const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)), a = m >= 4 ? y : y - 1; return a + '-' + String((a + 1) % 100).padStart(2, '0'); })();

(async () => {
  const root = path.join(__dirname, '..'), portalSql = path.join(root, '..', 'rcl-portal', 'sql', 'portal_step5_site_papers.sql');
  // ---- the start: the Portal's step 5 and the Store's step 8 (twice – it only adds), a machinery's two maintenance bills ----
  for (let k = 0; k < 2; k++) { sqlFile('rcl_portal', portalSql); for (const db of ['rcl', 'rcl_s2']) sqlFile(db, path.join(root, 'sql', 'store_step8_req_indent.sql')); }
  ok('the Portal\'s step 5 and the Store\'s step 8 run twice without a fault', sql('rcl', "select count(*) from information_schema.columns where table_name = 'store_req' and column_name in ('indent_fy','indent_kind','indent_no','contact_name','contact_phone','logbook')") === '6' &&
    sql('rcl_portal', "select count(*) from information_schema.columns where table_name = 'sites' and column_name in ('address','contact_name','contact_phone')") === '3');
  const before = sql('rcl', "select string_agg(indent_kind || indent_no || '|' || for_kind, ',' order by no) from store_req");
  ok('   the requirements of before got their Indent No. – in their order, each letter from 1 (M: a machinery)', !!before && before.split(',').every(x => (x[0] === 'M') === /\|Machinery$/.test(x)) &&
    ['M', 'P'].every(k => { const n = before.split(',').filter(x => x[0] === k).map(x => parseInt(x.slice(1), 10)); return n.every((v, i) => v === i + 1); }), before);
  sql('rcl', "delete from maintenance where id like 'MT-RQI-%'; insert into maintenance (id, date, machinery, garage, bill_no, km_reading, amount, lines, service) values " +
    "('MT-RQI-1', '" + today.slice(0, 8) + "01', 'RL-STORE-1', 'Sai Hydraulics', 'SH-45', 1200, 1180, '[{\"work\":\"Hydraulic oil\",\"type\":\"Paid\",\"qty\":5,\"uom\":\"Ltr\",\"rate\":200,\"amount\":1000,\"gst\":18}]', 'Yes')," +
    "('MT-RQI-2', '" + today.slice(0, 8) + "02', 'RL-STORE-1', 'Om Tyres', '', 1250, 500, '[{\"work\":\"Puncture\",\"amount\":500}]', '');");
  await wait(1200);
  const was = { co: sql('rcl_portal', "select coalesce(address,'') || '|' || coalesce(gstin,'') || '|' || coalesce(pan,'') from companies where id = 'RACHANATEST'").split('|'), s1: sql('rcl_portal', "select name || '|' || coalesce(company_id,'') || '|' || status from sites where code = 'S1'").split('|') };
  // ---- the Portal: the company's details and the site's company, address and contact – where he gives them ----
  const SA = client(P); let r = await SA.req('/api/auth', { action: 'login', email: 'sa@rcl.test', password: SAPW });
  ok('the Super Admin signs in to the Portal', r.status === 200 && r.j.user && r.j.user.super, r.j);
  r = await SA.req('/api/admin', { action: 'companySave', id: 'RACHANATEST', name: 'Rachana Test Co', address: 'Plot 5, MIDC Ambad, Nashik 422010', gstin: '27ABCDE1234F1Z5', pan: 'ABCDE1234F', logo: '' });
  ok('   Companies → Rachana Test Co → its address, GSTIN, PAN → Save', r.status === 200 && r.j.ok, r.j);
  r = await SA.req('/api/admin', { action: 'siteSave', code: 'S1', name: was.s1[0], company: 'RACHANATEST', status: was.s1[2], address: 'Site office, Valshind, NH 848', contact_name: 'Ramesh Patil', contact_phone: '98765 43210' });
  ok('   Sites → S1: its company, its address and contact → Save (step 5)', r.status === 200 && r.j.ok && sql('rcl_portal', "select address || '|' || contact_name || '|' || contact_phone from sites where code = 'S1'") === 'Site office, Valshind, NH 848|Ramesh Patil|98765 43210', r.j);
  r = await SA.req('/api/admin', { action: 'siteSave', code: 'S1', name: was.s1[0], company: 'RACHANATEST', status: was.s1[2], contact_phone: 'call me' });
  ok('   a contact number that is not a number: refused', r.status === 400 && /digits only/.test(r.j.error), r.j);
  r = await SA.req('/api/admin', { action: 'overview' });
  ok('   the console shows them under the site', (r.j.sites || []).some(s => s.code === 'S1' && s.address === 'Site office, Valshind, NH 848' && s.contact_name === 'Ramesh Patil' && s.step5 === true), (r.j.sites || []).find(s => s.code === 'S1'));
  // ---- the Store: nothing saved there – the heading and the start come with the sign-in ----
  const A = await storeAs('sujit@rcl.test', PW, 'S1'), V = await storeAs('view@rcl.test', VPW, 'S1'), K = await storeAs('store@rcl.test', VPW, 'S1'), B = await storeAs('sujit@rcl.test', PW, 'T2');
  r = await V.w('boot');
  ok('a new requirement starts with the site\'s contact (Portal → Sites); step 8 at the site', r.status === 200 && r.j.step8 === true && r.j.start.contact_name === 'Ramesh Patil' && r.j.start.contact_phone === '98765 43210' && r.j.start.ship_to === 'Site office, Valshind, NH 848', r.j.start);
  const pp = JSON.parse(sql('rcl', "select value::text from store_settings where id = 'portal_paper'") || '{}');
  ok('   the Portal\'s heading kept in the site\'s settings at the sign-in (for HO Purchase\'s papers of this site)', pp.company && pp.company.name === 'Rachana Test Co' && pp.site.address === 'Site office, Valshind, NH 848', pp);
  r = await V.w('reqList');
  ok('the requirement\'s paper: the company\'s name, address, GSTIN; the Site Address – from the Portal', r.status === 200 && r.j.heading.company === 'Rachana Test Co' && r.j.heading.address === 'Plot 5, MIDC Ambad, Nashik 422010' && r.j.heading.gstin === '27ABCDE1234F1Z5' && r.j.heading.site_address === 'Site office, Valshind, NH 848', r.j.heading);
  ok('   each requirement of before: RTC/VTR/' + FY + '/<M|P>/<0001…>', r.j.reqs.length > 0 && r.j.reqs.every(x => new RegExp('^RTC/VTR/\\d{4}-\\d{2}/' + (x.for_kind === 'Machinery' ? 'M' : 'P') + '/\\d{4}$').test(x.ref)), r.j.reqs.map(x => x.ref));
  const OIL = sql('rcl', "select code from items where name = 'Engine Oil 15W40'"), CEM = sql('rcl', "select code from items where name = 'Cement OPC 53'");
  // ---- a machinery's maintenance log book ----
  r = await V.w('mlogInfo', { no: 'RL-STORE-1' });
  const lbN = Number(r.j.bills);
  ok('a machinery picked: its maintenance log book – up to which date it is written, how many bills (its bills and the Store\'s issues to it)', r.status === 200 && lbN >= 2 && r.j.upto >= today.slice(0, 8) + '02', r.j);
  r = await V.w('mlogInfo', { no: 'NO-SUCH' });
  ok('   a machinery not in the Asset Master: said', r.status === 400 && /not in the Asset Master/.test(r.j.error), r.j);
  const nP0 = Number(sql('rcl', "select coalesce(max(indent_no), 0) from store_req where indent_fy = '" + FY + "' and indent_kind = 'P'")), nM0 = Number(sql('rcl', "select coalesce(max(indent_no), 0) from store_req where indent_fy = '" + FY + "' and indent_kind = 'M'"));
  r = await V.w('reqSave', { req: { date: today, for_kind: 'Machinery', for_text: 'RL-STORE-1', lines: [{ code: OIL, qty: 2 }], contact_name: 'Ramesh Patil', contact_phone: '98765 43210' } });
  const R1 = r.j.no;
  ok('a requirement for a machinery: its Indent No. RTC/VTR/' + FY + '/M/' + String(nM0 + 1).padStart(4, '0') + ' – the next of M', r.status === 200 && r.j.ref === 'RTC/VTR/' + FY + '/M/' + String(nM0 + 1).padStart(4, '0'), r.j);
  const lb1 = JSON.parse(sql('rcl', 'select logbook::text from store_req where no = ' + R1) || 'null');
  ok('   its log book attached by itself (up to its last bill), its contact kept', lb1 && lb1.no === 'RL-STORE-1' && lb1.bills === lbN && sql('rcl', "select contact_name || '|' || contact_phone from store_req where no = " + R1) === 'Ramesh Patil|98765 43210', lb1);
  r = await V.w('reqLogbookHtml', { no: R1 });
  ok('   its print: the log book as Mechanical draws it – the bills, the GST, the last service', r.status === 200 && /Maintenance Log Book – RL-STORE-1/.test(r.j.html) && /Sai Hydraulics/.test(r.j.html) && /Hydraulic oil/.test(r.j.html) && /CGST 9%/.test(r.j.html) && /Last service/.test(r.j.html) && /\.mlb\{/.test(r.j.css), (r.j.html || '').slice(0, 300));
  r = await V.w('reqSave', { req: { date: today, for_kind: 'Machinery', for_text: 'RL-STORE-1', lines: [{ code: OIL, qty: 1 }] }, logbook: false });
  const R2 = r.j.no;
  ok('   the tick off: no log book; the next M number', r.status === 200 && r.j.ref === 'RTC/VTR/' + FY + '/M/' + String(nM0 + 2).padStart(4, '0') && sql('rcl', 'select logbook is null from store_req where no = ' + R2) === 't', r.j);
  r = await V.w('reqLogbook', { no: R2, attach: true });
  ok('   attached afterwards (Log book → Attach), and taken out again', r.status === 200 && r.j.logbook && r.j.logbook.no === 'RL-STORE-1' && (await V.w('reqLogbook', { no: R2, attach: false })).j.logbook === null && sql('rcl', 'select logbook is null from store_req where no = ' + R2) === 't', r.j);
  r = await V.w('reqSave', { req: { date: today, for_kind: 'Site work', for_text: 'Ch 548+200 drain', lines: [{ code: CEM, qty: 10 }] } });
  const R3 = r.j.no;
  ok('a requirement for site work: P – its own numbers', r.status === 200 && r.j.ref === 'RTC/VTR/' + FY + '/P/' + String(nP0 + 1).padStart(4, '0'), r.j);
  r = await V.w('reqList');
  const x2 = r.j.reqs.find(x => x.no === R2);
  r = await V.w('reqSave', { no: R2, req: { date: today, for_kind: 'Site work', for_text: 'Camp', lines: [{ code: CEM, qty: 3 }] } });
  ok('   changed from a machinery to site work: the next P number (the M one is not given again)', r.status === 200 && sql('rcl', "select indent_kind || indent_no from store_req where no = " + R2) === 'P' + (nP0 + 2) && !!x2, r.j);
  // ---- approved, then changed: it waits for its approval again ----
  await K.w('reqDecide', { no: R1, ok: true }); r = await A.w('reqDecide', { no: R1, ok: true });
  ok('requirement ' + R1 + ' approved (level 1, level 2)', sql('rcl', 'select status from store_req where no = ' + R1) === 'Approved', r.j);
  r = await V.w('reqSave', { no: R1, req: { date: today, for_kind: 'Machinery', for_text: 'RL-STORE-1', lines: [{ code: OIL, qty: 3 }], contact_name: 'Ramesh Patil', contact_phone: '98765 43210' }, logbook: true });
  ok('   changed after its approval: saved – it waits for its approval again (level 1); its log book kept', r.status === 200 && r.j.again === true && r.j.status === 'Pending' && r.j.level === 1 &&
    sql('rcl', "select status || '|' || jsonb_array_length(approvals) || '|' || (logbook->>'no') from store_req where no = " + R1) === 'Pending|0|RL-STORE-1', r.j);
  ok('   the activity record keeps who approved it before', /approvedAgain/.test(sql('rcl', "select detail::text from store_activity where action = 'Requirement changed' and target = 'REQ " + R1 + "' order by id desc limit 1")));
  await K.w('reqDecide', { no: R1, ok: true }); await A.w('reqDecide', { no: R1, ok: true });
  // ---- in a PO: neither changed nor deleted – the PO first ----
  r = await B.w('poSave', { site: 'S1', po: { date: today, vendor: 'Bedrok Chem Infra', lines: [{ code: OIL, qty: 3, rate: 300, gst_pct: 18, req_no: R1, req_line: 1 }] } });
  const PO = r.j.no;
  ok('HO Purchase makes PO ' + PO + ' of requirement ' + R1, r.status === 200 && PO > 0, r.j);
  r = await V.w('reqList');
  const x1 = r.j.reqs.find(x => x.no === R1);
  ok('   the list: "In PO ' + PO + '" – no Change, no Delete', x1 && x1.pos.indexOf(PO) > -1 && x1.edit === false && x1.del === false, x1 && { pos: x1.pos, edit: x1.edit, del: x1.del });
  r = await V.w('reqSave', { no: R1, req: { date: today, for_kind: 'Machinery', for_text: 'RL-STORE-1', lines: [{ code: OIL, qty: 4 }] } });
  ok('   a change: refused – "delete PO ' + PO + ' first"', r.status === 409 && r.j.code === 'ordered' && new RegExp('in PO ' + PO + ' – delete PO ' + PO + ' first').test(r.j.error), r.j);
  r = await V.w('reqDelete', { no: R1 });
  ok('   a delete: refused (in the database too)', r.status === 409 && r.j.code === 'ordered' && sql('rcl', 'select count(*) from store_req where no = ' + R1) === '1', r.j);
  r = await B.w('poList', { site: 'S1' });
  ok('   the PO\'s line names its requirement by its Indent No.', (r.j.pos || []).some(p => p.no === PO && p.lines[0].req_ref === 'RTC/VTR/' + FY + '/M/' + String(nM0 + 1).padStart(4, '0')), (r.j.pos || []).find(p => p.no === PO));
  const grnPo = sql('rcl', 'select po_no from store_grn where po_no is not null order by no limit 1');
  if (grnPo) { r = await B.w('poDelete', { site: 'S1', no: Number(grnPo) }); ok('a PO whose material came: not deleted', r.status === 409 && r.j.code === 'received' && sql('rcl', 'select count(*) from store_po where no = ' + grnPo) === '1', r.j); }
  r = await V.w('poDelete', { site: 'S1', no: PO });
  ok('   not HO Purchase: no PO deleted', r.status === 403, r.j);
  r = await B.w('poDelete', { site: 'S1', no: PO });
  ok('HO Purchase deletes PO ' + PO + ' (nothing came)', r.status === 200 && sql('rcl', 'select count(*) from store_po where no = ' + PO) === '0', r.j);
  r = await V.w('reqList');
  const x1b = r.j.reqs.find(x => x.no === R1);
  ok('   now requirement ' + R1 + ' may be changed and deleted', x1b && x1b.pos.length === 0 && x1b.edit === true && x1b.del === true, x1b && { pos: x1b.pos, edit: x1b.edit, del: x1b.del });
  // ---- a photo taken out one by one ----
  const sha1 = 'a'.repeat(64), sha2 = 'b'.repeat(64);
  sql('rcl', "update store_req set photos = '[{\"sha\":\"" + sha1 + "\",\"size\":10,\"by\":\"View User\",\"at\":\"2026-10-29T05:00:00Z\"},{\"sha\":\"" + sha2 + "\",\"size\":10,\"by\":\"View User\",\"at\":\"2026-10-29T05:00:00Z\"}]' where no = " + R3);
  r = await K.w('reqPhotoDel', { no: R3, sha: sha1 });
  ok('a photo: not taken out by another person (a User)', r.status === 403 || r.status === 400, r.j);
  r = await V.w('reqPhotoDel', { no: R3, sha: sha1 });
  ok('   taken out by who made it – the other stays', r.status === 200 && r.j.photos === 1 && sql('rcl', "select photos->0->>'sha' from store_req where no = " + R3) === sha2, r.j);
  // ---- deleted ----
  r = await K.w('reqDelete', { no: R3 });
  ok('a requirement: not deleted by another User', r.status === 403, r.j);
  for (const n of [R1, R2, R3]) r = await V.w('reqDelete', { no: n });
  ok('   deleted by who made it – gone; each in the activity record', r.status === 200 && sql('rcl', 'select count(*) from store_req where no in (' + [R1, R2, R3].join(',') + ')') === '0' &&
    sql('rcl', "select count(*) from store_activity where action = 'Requirement deleted' and target in ('REQ " + [R1, R2, R3].join("','REQ ") + "')") === '3');
  r = await V.w('reqSave', { req: { date: today, for_kind: 'Site work', for_text: 'Camp', lines: [{ code: CEM, qty: 1 }] } });
  ok('   a number is never given again (the next after the deleted ones)', r.status === 200 && r.j.ref === 'RTC/VTR/' + FY + '/P/' + String(nP0 + 3).padStart(4, '0'), r.j);
  await V.w('reqDelete', { no: r.j.no });
  // ---- HO Purchase and the PO's start: the Portal's site address and contact ----
  r = await B.w('purItems', { site: 'S1' });
  ok('a new PO of S1 starts with its Shipping Address and Site Contact from the Portal', r.status === 200 && r.j.papers.ship_to === 'Site office, Valshind, NH 848' && r.j.papers.site_contact === 'Ramesh Patil – 98765 43210', r.j.papers);
  r = await B.w('purPending');
  const s1 = (r.j.sites || []).find(s => s.site === 'S1');
  ok('   the approved requirements of S1 by their Indent No.', !!s1 && s1.reqs.every(x => /^RTC\/VTR\/\d{4}-\d{2}\/[MP]\/\d{4}$/.test(x.ref)), s1 && s1.reqs.map(x => x.ref));
  r = await A.w('report', { kind: 'req' });
  ok('the requirements\' Excel: the Indent No. column', r.status === 200 && r.j.cols[0].h === 'Indent No.' && r.j.rows.every(x => /\/VTR\//.test(x[0])), r.j.cols && r.j.cols[0]);
  // ---- put back (the rig) ----
  sql('rcl', "delete from maintenance where id like 'MT-RQI-%'");
  await SA.req('/api/admin', { action: 'siteSave', code: 'S1', name: was.s1[0], company: was.s1[1], status: was.s1[2], address: '', contact_name: '', contact_phone: '' });
  await SA.req('/api/admin', { action: 'companySave', id: 'RACHANATEST', name: 'Rachana Test Co', address: was.co[0], gstin: was.co[1], pan: was.co[2], logo: '' });
  out.push('TOTAL ' + pass + ' passed, ' + fail + ' failed  (' + Math.round((Date.now() - T0) / 1000) + ' s)');
  console.log(out.join('\n')); process.exit(fail ? 1 : 0);
})().catch(e => { console.log(out.join('\n')); console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
