/* (24-10-2026, Mechanical's update-155 – the audit's R3 and R4) on the local test rig only (never a live database):
 *   – a site with 2,500 items: the list has all of them, the name check finds an item past the first 1,000, a new item gets the
 *     next code after the highest (the database gives at most 1,000 rows to one question – "limit=100000" stopped there);
 *   – an import reads the codes of every site once (not once per row) and gives each row its own code;
 *   – a write whose answer is lost (the database DID it) is not sent a second time: one item, and the person is told to look;
 *   – the name check is answered from this server's memory for 15 seconds, a save of its own empties it.
 * It starts a Store of its own (the tree in SRC, default this one) on :3021 against the rig (Portal :3010, site S1 on :3100).
 *   SRC=<store tree> node test/paging155.test.js */
'use strict';
const { execSync, spawn } = require('child_process'), path = require('path');
const SRC = process.env.SRC || path.join(__dirname, '..');
const P = 'http://127.0.0.1:3010', ST = 'http://127.0.0.1:3021', DOOR = 'http://127.0.0.1:3100';
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 500) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
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
const fault = b => fetch(DOOR + '/__fault', { method: 'POST', body: JSON.stringify(b) });
(async () => {
  const srv = spawn('node', ['dev.js'], { cwd: SRC, env: Object.assign({}, process.env, { SUPABASE_URL: DOOR, SUPABASE_SECRET_KEY: 'sb_secret_rigkey', RCL_SITES_KEY: 'rig-sites-key-0123456789-abcdefghij', PORTAL_URL: P, PORT: '3021' }), stdio: 'ignore' });
  try {
    for (let i = 0; i < 40; i++) { try { if ((await fetch(ST + '/', { signal: AbortSignal.timeout(2000) })).status === 200) break; } catch (e) { /* starting */ } await wait(300); }
    // the start: Store access, the Store's tables of S1 and T2 emptied, 2,500 items at S1 (codes ITM-0001 … ITM-2500)
    sql('rcl_portal', "insert into modules (key, name, url, status, sort) values ('store', 'Store', 'http://127.0.0.1:3021', 'live', 2) on conflict (key) do update set url = excluded.url, status = 'live'; " +
      "delete from access where module = 'store'; insert into access (email, site, module, role, granted_by) values ('sujit@rcl.test', 'S1', 'store', 'admin', 'test'), ('sujit@rcl.test', 'T2', 'store', 'admin', 'test');");
    for (const db of ['rcl', 'rcl_s2']) sql(db, 'truncate public.items, public.store_sessions, public.store_tickets, public.store_activity; alter sequence public.items_code_seq restart;');
    sql('rcl', "insert into public.items (code, name, name_key, unit, category) select 'ITM-' || lpad(g::text, 4, '0'), 'Rig Part ' || g, 'RIG PART ' || g, 'Nos', 'Spare Parts' from generate_series(1, 2500) g; select setval('public.items_code_seq', 2500);");
    const p = client(P), l = await p.req('/api/auth', { action: 'login', email: 'sujit@rcl.test', password: 'Nashik#Road848!' });
    const S = client(ST), t = ((await p.req('/api/go?module=store&site=S1')).loc.split('#sso=')[1] || ''), r = await S.req('/api/sso', { ticket: t });
    ok('signed in on the Store of S1 (through the Portal)', l.status === 200 && r.status === 200 && r.j.site === 'S1', r.j);
    const L = await S.req('/api/items', { action: 'list' });
    ok('the list has every item of the site: 2,500 (not the first 1,000)', L.status === 200 && (L.j.items || []).length === 2500 && L.j.items[2499].code === 'ITM-2500', { status: L.status, n: (L.j.items || []).length, last: ((L.j.items || []).slice(-1)[0] || {}).code });
    const C = await S.req('/api/items', { action: 'check', name: 'rig part 2400', category: 'Spare Parts' });
    ok('the name check finds an item past the first 1,000 ("Rig Part 2400" is there)', C.j.exact && C.j.exact.code === 'ITM-2400', C.j);
    const N = await S.req('/api/items', { action: 'save', item: { name: 'Hydraulic Hose 155', unit: 'Nos', category: 'Spare Parts' } });
    ok('a new item gets the next code after the highest: ITM-2501', N.status === 200 && N.j.item && N.j.item.code === 'ITM-2501', N.j);
    const C2 = await S.req('/api/items', { action: 'check', name: 'hydraulic hose 155', category: 'Spare Parts' });
    ok('   the name check right after it knows it (this server\'s own save empties its short memory)', C2.j.exact && C2.j.exact.code === 'ITM-2501', C2.j);
    // an import of 40 rows: the codes of every site are read once, every row gets its own code
    await fetch(DOOR + '/__meter', { method: 'POST' });
    const rows = Array.from({ length: 40 }, (_, k) => ({ line: k + 2, name: 'Imported Valve ' + (k + 1) + ' Z', unit: 'Nos', category: 'Spare Parts' }));
    const I = await S.req('/api/items', { action: 'import', rows: rows });
    const m = await (await fetch(DOOR + '/__meter')).json(), codeReads = m.rows.filter(x => /GET other items select&order&limit/.test(x.kind)).reduce((s, x) => s + x.calls, 0);
    const codes = sql('rcl', "select count(distinct code) || '/' || count(*) from public.items where name like 'Imported Valve %'");
    ok('an import of 40 rows: 40 items, 40 different codes, after ITM-2501', I.status === 200 && I.j.added === 40 && codes === '40/40' && sql('rcl', "select min(code) from public.items where name like 'Imported Valve %'") === 'ITM-2502', { status: I.status, added: I.j.added, codes });
    ok('   the database was asked for the codes a few times – not once for every row', codeReads > 0 && codeReads < 20, { reads: codeReads, top: m.rows.slice(0, 6).map(x => x.kind + ' ' + x.calls) });
    // a write whose answer is lost: the database DID it – the Store must not send it again
    await fault({ match: '^POST /rest/v1/items', after: true, drop: true, n: 1 });
    const W = await S.req('/api/items', { action: 'save', item: { name: 'Lost Answer Filter 155', unit: 'Nos', category: 'Spare Parts' } });
    await fault({});
    const n = Number(sql('rcl', "select count(*) from public.items where name = 'Lost Answer Filter 155'"));
    ok('a new item whose answer was lost on the way back (it WAS saved): saved once, and he is told to look before trying again – no false "DUPLICATE"', n === 1 && W.status === 503 && /may or may not have been saved/.test(String(W.j.error || '')), { rows: n, status: W.status, said: W.j.error });
    // a read whose answer is lost: asked again by itself
    await fault({ match: '^GET /rest/v1/items', drop: true, n: 1 });
    const L2 = await S.req('/api/items', { action: 'list' }); await fault({});
    ok('a list whose first answer was lost: asked again by itself, complete', L2.status === 200 && (L2.j.items || []).length === 2543, { status: L2.status, n: (L2.j.items || []).length });
  } catch (e) { ok('no crash', false, String(e && e.stack || e)); }
  finally { try { srv.kill(); } catch (e) {} try { await fault({}); } catch (e) {} }
  for (const db of ['rcl', 'rcl_s2']) { try { sql(db, 'truncate public.items, public.store_sessions, public.store_tickets, public.store_activity; alter sequence public.items_code_seq restart;'); } catch (e) {} }
  try { sql('rcl_portal', "update modules set url = 'http://127.0.0.1:3020' where key = 'store'"); } catch (e) {}
  out.forEach(x => console.log(x)); console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
