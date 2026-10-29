/* (29-10-2026) A STORE USER ONLY TODAY – through the Store's own doors (copied from work.test.js), on the local test rig (never the live databases):
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


// (29-10-2026) a Store User only today – run on the rig with the rule ON (after work.test.js, which leaves its items and people)
(async () => {
  const A = await storeAs('sujit@rcl.test', PW, 'S1'), K = await storeAs('store@rcl.test', VPW, 'S1'), V = await storeAs('view@rcl.test', VPW, 'S1');
  const items = (await A.w('boot')).j.items || [], CEM = (items.find(i => /cement/i.test(i.name)) || items[0] || {}).code;
  ok('the items of the story are there', !!CEM, items.length);
  const RULE = /a Store User enters only today's entries – an entry of an earlier day is made only by the Store Admin or the Super Admin/;
  const grn = d => ({ grn: { date: d, supplier: 'Bedrok Chem Infra', lines: [{ code: CEM, qty: 1, rate: 340 }] }, confirmParty: true });
  let r = await K.w('grnSave', grn(D1));
  ok('a Store User: a GRN of yesterday refused – said why', r.status === 400 && RULE.test(r.j.error || '') && r.j.code === 'date', r.j);
  r = await K.w('grnSave', grn(today));
  ok('a Store User: a GRN of today saved', r.status === 200 && r.j.ok, r.j);
  r = await K.w('issueSave', { issue: { date: D1, to_kind: 'Site work', location: 'Ch 1', use_for: 'Rig', lines: [{ code: CEM, qty: 1 }] } });
  ok('a Store User: an issue of yesterday refused', r.status === 400 && RULE.test(r.j.error || ''), r.j);
  r = await V.w('reqSave', { req: { date: D2, for_kind: 'Site work', for_text: 'Rig', lines: [{ code: CEM, qty: 1 }] } });
  ok('a Store User: a requirement of 2 days back refused', r.status === 400 && RULE.test(r.j.error || ''), r.j);
  r = await A.w('grnSave', grn(D3));
  ok('the Store Admin / Super Admin: a GRN of 3 days back saved', r.status === 200 && r.j.ok, r.j);
  const no = r.j.no; if (no) await A.w('grnDelete', { no: no });
  console.log(out.join('\n')); console.log('TOTAL ' + pass + ' passed, ' + fail + ' failed  (' + Math.round((Date.now() - T0) / 1000) + ' s)');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e && e.stack); process.exit(1); });
