/* The Store through its own doors, on the local test rig (never the live databases):
 *   the Portal :3010 gives the tickets (as a person opens the Store from it), the Store :3020, the site databases S1 (:3100)
 *   and T2 (:3102) of Mechanical's rig. Test passwords only.      node test/api.test.js
 * The test sets its own start: Store access given in the Portal, the Store's tables of S1 and T2 emptied. */
'use strict';
const { execSync } = require('child_process');
const P = 'http://127.0.0.1:3010', ST = 'http://127.0.0.1:3020';
let pass = 0, fail = 0; const out = [], T0 = Date.now();
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 400) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
function client(base) {
  let cookie = '';
  const req = async (p, body, opt) => {
    opt = opt || {}; const h = { 'Content-Type': 'application/json' }; if (!opt.noHeader) h['X-RCL'] = '1'; if (cookie) h.Cookie = cookie;
    const r = await fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(60000) });
    const sc = r.headers.get('set-cookie'); if (sc) { const v = sc.split(';')[0]; cookie = /=$/.test(v) ? '' : v; }
    let j = {}; try { j = JSON.parse(await r.text()); } catch (e) { j = {}; }
    return { status: r.status, j: j, loc: r.headers.get('location') || '' };
  };
  return { req, get cookie() { return cookie; }, set cookie(v) { cookie = v; } };
}
// a person signed in on the Portal opens the Store on a site: the ticket the Portal hands over
async function ticketFor(portal, mod, site) { const r = await portal.req('/api/go?module=' + mod + '&site=' + site); return (r.loc.split('#sso=')[1] || ''); }
async function storeAs(email, pw, site) {
  const p = client(P); const l = await p.req('/api/auth', { action: 'login', email: email, password: pw });
  if (l.status !== 200) throw new Error('Portal sign-in of ' + email + ': ' + JSON.stringify(l.j));
  const s = client(ST), t = await ticketFor(p, 'store', site), r = await s.req('/api/sso', { ticket: t });
  return { p, s, t, r };
}
const PW = 'Nashik#Road848!', VPW = 'Audit#PassView9!x';

(async () => {
  // ---- the start ----
  sql('rcl_portal', "insert into modules (key, name, url, status, sort) values ('store', 'Store', 'http://127.0.0.1:3020', 'live', 2) on conflict (key) do update set url = excluded.url, status = 'live'; " +
    "delete from access where module = 'store'; insert into access (email, site, module, role, granted_by) values ('sujit@rcl.test', 'S1', 'store', 'admin', 'test'), ('sujit@rcl.test', 'T2', 'store', 'user', 'test'), ('view@rcl.test', 'S1', 'store', 'user', 'test'); delete from counters;");
  for (const db of ['rcl', 'rcl_s2']) sql(db, 'truncate public.items, public.store_sessions, public.store_tickets, public.store_activity; alter sequence public.items_code_seq restart;');

  // ---- sign-in through the Portal ----
  const A = await storeAs('sujit@rcl.test', PW, 'S1'), S = A.s;
  ok('sujit opens the Store on S1 from the Portal: signed in as Store Admin, a cookie that page scripts cannot read', A.r.status === 200 && A.r.j.user.admin === true && A.r.j.site === 'S1' && /^rcl_store=S1\./.test(S.cookie), A.r.j);
  ok('   the ticket names his other modules on S1 (Mechanical) and his Store sites (S1, T2)', (A.r.j.mods || []).some(m => m.key === 'mechanical') && (A.r.j.sites || []).map(x => x.code).sort().join() === 'S1,T2', A.r.j);
  ok('   only a fingerprint of the sign-in is kept in S1\'s database', sql('rcl', "select count(*) from store_sessions where email = 'sujit@rcl.test' and length(id_hash) = 64") === '1');
  let r = await client(ST).req('/api/sso', { ticket: A.t });
  ok('the same ticket again: refused (a ticket opens the Store once)', r.status === 401 && /already used/.test(r.j.error), r.j);
  const mt = await ticketFor(A.p, 'mechanical', 'S1'); r = await client(ST).req('/api/sso', { ticket: mt });
  ok('a ticket made for Mechanical: refused', r.status === 401 && /another module/.test(r.j.error), r.j);
  r = await client(ST).req('/api/sso', { ticket: A.t.slice(0, -4) + 'AAAA' });
  ok('a ticket with a broken signature: refused', r.status === 401 && /signature|already used/.test(r.j.error), r.j);
  r = await client(ST).req('/api/sso', { ticket: await ticketFor(A.p, 'store', 'S1') }, { noHeader: true });
  ok('a request not from the Store page (no header): refused', r.status === 403, r.j);
  r = await S.req('/api/me');
  ok('/api/me: who, which site, Admin', r.j.signedIn && r.j.site === 'S1' && r.j.user.admin && r.j.portal === P, r.j);
  r = await client(ST).req('/api/me');
  ok('   nobody signed in: says so and gives the Portal\'s address (the page goes there)', r.j.signedIn === false && r.j.portal === P, r.j);

  // ---- Item Master: add, duplicates, near names ----
  const save = (c, item, extra) => c.req('/api/items', Object.assign({ action: 'save', item: item }, extra || {}));
  r = await save(S, { name: 'Sugar', unit: 'Kg', category: 'grocery', hsn: '1701', gst: '5', minStock: '10' });
  ok('an item is added: code ITM-0001 given by the database, the category written properly', r.status === 200 && r.j.item.code === 'ITM-0001' && r.j.item.category === 'Grocery' && Number(r.j.item.gst_pct) === 5 && r.j.item.created_by === 'sujit@rcl.test', r.j);
  r = await save(S, { name: '  SUGAR ', unit: 'Kg', category: 'Grocery' });
  ok('the same name again (capitals, spaces): DUPLICATE – not saved', r.status === 409 && r.j.code === 'exact' && /already there \(ITM-0001\)/.test(r.j.error), r.j);
  r = await save(S, { name: 'Sugaar', unit: 'Kg', category: 'Grocery' });
  ok('a near name (Sugaar, Sugar is there): stopped – asked "is it a different item?", Sugar named', r.status === 409 && r.j.code === 'similar' && r.j.similar[0].code === 'ITM-0001', r.j);
  ok('   nothing was saved', sql('rcl', 'select count(*) from items') === '1');
  r = await save(S, { name: 'Sugaar', unit: 'Kg', category: 'Grocery' }, { confirm: ['ITM-0001'] });
  ok('   the user says it is different: saved, and who said so is kept with it', r.status === 200 && r.j.item.code === 'ITM-0002' && /not the same as ITM-0001 Sugar – said by sujit@rcl\.test/.test(r.j.item.similar_note), r.j);
  r = await S.req('/api/items', { action: 'check', name: 'hydrolic hose 10mm', category: 'spare' });
  ok('a proper name is suggested: "hydrolic hose 10mm" → "Hydraulic Hose 10 mm" (spelling named)', r.j.proper && r.j.proper.name === 'Hydraulic Hose 10 mm' && r.j.proper.fixes.join() === 'hydrolic → hydraulic', r.j);
  await save(S, { name: 'Oil Filter', unit: 'Nos', category: 'Spare Parts' });
  for (const [n, why] of [['Filter Oil', 'order'], ['Oil Filters', 'plural'], ['Oil Fliter', 'spelling']]) { r = await save(S, { name: n, unit: 'Nos', category: 'Spare Parts' }); ok('   "' + n + '" is near "Oil Filter" (' + why + ')', r.status === 409 && r.j.similar[0].name === 'Oil Filter' && r.j.similar[0].why === why, r.j); }
  await save(S, { name: 'Bolt M10', unit: 'Nos', category: 'Spare Parts' });
  r = await save(S, { name: 'Bolt M12', unit: 'Nos', category: 'Spare Parts' });
  ok('different numbers are different items: "Bolt M12" saved beside "Bolt M10"', r.status === 200, r.j);
  r = await save(S, { name: 'Engine Oil 15W40', unit: 'Ltr', category: 'Spare Part' });
  ok('a near category ("Spare Part", "Spare Parts" is there): asked first', r.status === 409 && r.j.code === 'cat' && r.j.categories[0] === 'Spare Parts', r.j);
  r = await save(S, { name: 'Engine Oil 15W40', unit: 'Ltr', category: 'Oil & lubricants' });
  ok('   another category: saved as typed (written properly)', r.status === 200 && r.j.item.category === 'Oil & Lubricants', r.j);
  for (const [item, re, what] of [[{ name: 'Grease', unit: 'Kgs', category: 'Oil' }, /Pick the unit/, 'a unit not in the list'], [{ name: 'Grease', unit: 'Kg', category: 'Oil', hsn: '34031' }, /4, 6 or 8 digits/, 'HSN of 5 digits'],
    [{ name: 'Grease', unit: 'Kg', category: 'Oil', gst: '50' }, /from 0 to 40/, 'GST 50 %'], [{ name: 'Grease', unit: 'Kg', category: 'Oil', minStock: '-2' }, /0 or more/, 'a minus min stock'], [{ name: ' ', unit: 'Kg', category: 'Oil' }, /item name/, 'no name'], [{ name: 'Grease', unit: 'Kg', category: '' }, /category/, 'no category']]) {
    r = await save(S, item); ok('refused: ' + what, r.status === 400 && re.test(r.j.error), r.j); }
  // ---- who may do what ----
  const V = (await storeAs('view@rcl.test', VPW, 'S1')).s;
  r = await save(V, { name: 'Tea', unit: 'Kg', category: 'Grocery' });
  ok('a Store User adds an item', r.status === 200 && r.j.item.created_by === 'view@rcl.test', r.j);
  const teaCode = r.j.item && r.j.item.code;
  r = await V.req('/api/items', { action: 'save', code: teaCode, item: { name: 'Tea Leaves', unit: 'Kg', category: 'Grocery' } });
  ok('   but cannot change one', r.status === 403, r.j);
  r = await V.req('/api/items', { action: 'remove', code: teaCode });
  ok('   nor delete one', r.status === 403, r.j);
  r = await V.req('/api/items', { action: 'import', check: true, rows: [{ line: 2, name: 'X1', unit: 'Nos', category: 'Y' }] });
  ok('   nor import', r.status === 403, r.j);
  r = await S.req('/api/items', { action: 'save', code: teaCode, item: { name: 'Sugar', unit: 'Kg', category: 'Grocery', status: 'Active' } });
  ok('the Admin renames an item to a name that is there: DUPLICATE', r.status === 409 && r.j.code === 'exact', r.j);
  r = await S.req('/api/items', { action: 'save', code: teaCode, item: { name: 'Tea', unit: 'Pkt', category: 'Grocery', status: 'Inactive' } });
  ok('   the Admin changes the unit and switches it off (its own name is no duplicate of itself)', r.status === 200 && r.j.item.unit === 'Pkt' && r.j.item.status === 'Inactive', r.j);
  // ---- ONE Item Master for every site (14-10-2026): seen at all sites, changed only at the site that made it ----
  const T = client(ST); r = await T.req('/api/sso', { ticket: await ticketFor(A.p, 'store', 'T2') });
  ok('sujit opens the Store on T2 (User there)', r.status === 200 && r.j.site === 'T2' && r.j.user.admin === false, r.j);
  r = await T.req('/api/items', { action: 'list' });
  const s1n = Number(sql('rcl', 'select count(*) from items'));
  ok('   T2 sees S1\'s items too, each with its site (S1)', r.status === 200 && r.j.items.length === s1n && s1n > 0 && r.j.items.every(i => i.site === 'S1') && r.j.site === 'T2', r.j);
  r = await save(T, { name: 'Sugar', unit: 'Kg', category: 'Grocery' });
  ok('   "Sugar" at T2: DUPLICATE of S1\'s (one list for all sites)', r.status === 409 && r.j.code === 'exact' && sql('rcl_s2', 'select count(*) from items') === '0', r.j);
  const top = sql('rcl', "select max(substring(code from 5)::int) from items");
  r = await save(T, { name: 'Jaggery', unit: 'Kg', category: 'Grocery' });
  const jag = r.j.item && r.j.item.code;
  ok('   a new item at T2: kept in T2\'s database, its code the next of the one numbering (after S1\'s highest)', r.status === 200 && jag === 'ITM-' + String(Number(top) + 1).padStart(4, '0') && sql('rcl_s2', "select count(*) from items where name = 'Jaggery'") === '1' && sql('rcl', "select count(*) from items where name = 'Jaggery'") === '0', r.j);
  r = await S.req('/api/items', { action: 'list' });
  ok('   S1 sees it, made at T2', r.j.items.some(i => i.code === jag && i.site === 'T2' && i.created_by === 'sujit@rcl.test'), r.j);
  r = await S.req('/api/items', { action: 'save', code: jag, item: { name: 'Jaggery Cubes', unit: 'Kg', category: 'Grocery', status: 'Active' } });
  ok('   S1\'s Store Admin cannot change T2\'s item: told where and who', r.status === 403 && r.j.code === 'othersite' && /made at site .*by sujit@rcl\.test.*only there/.test(r.j.error) && sql('rcl_s2', "select name from items where code = '" + jag + "'") === 'Jaggery', r.j);
  r = await S.req('/api/items', { action: 'remove', code: jag });
  ok('   nor delete it', r.status === 403 && r.j.code === 'othersite' && sql('rcl_s2', 'select count(*) from items') === '1', r.j);
  r = await T.req('/api/items', { action: 'save', code: 'ITM-0001', item: { name: 'Sugar', unit: 'Kg', category: 'Grocery', status: 'Inactive' } });
  ok('   at T2, S1\'s item: "made at site S1" (not changed)', r.status === 403 && r.j.code === 'othersite' && sql('rcl', "select status from items where code = 'ITM-0001'") === 'Active', r.j);
  r = await T.req('/api/items', { action: 'remove', code: jag });
  ok('   the same person is a User on T2: no delete of T2\'s own item there', r.status === 403 && r.j.code === 'admin', r.j);
  // ---- import from Excel (Admin): checked row by row; all or nothing ----
  const rows = [{ line: 2, name: 'Sugar', unit: 'Kg', category: 'Grocery' }, { line: 3, name: 'Air Filter', unit: 'Nos', category: 'Spare Parts', hsn: '84213100', gst: '18' }, { line: 4, name: 'Air Filters', unit: 'Nos', category: 'Spare Parts' },
    { line: 5, name: 'Coolant', unit: 'Litre', category: 'Oil & Lubricants' }, { line: 6, name: 'air filter', unit: 'Nos', category: 'Spare Parts' }];
  r = await S.req('/api/items', { action: 'import', check: true, rows: rows });
  const st = r.j.rows ? r.j.rows.map(x => x.line + ':' + x.status).join(' ') : '';
  ok('import check: Sugar already there, Air Filter new, Air Filters near (in the file), a wrong unit and the same name twice are mistakes', st === '2:exists 3:new 4:similar 5:error 6:error' && r.j.errors === 2, r.j);
  const n0 = sql('rcl', 'select count(*) from items');
  r = await S.req('/api/items', { action: 'import', rows: rows });
  ok('   with mistakes left: nothing imported', r.status === 400 && sql('rcl', 'select count(*) from items') === n0, r.j);
  const fixed = rows.slice(0, 4).map(x => x.line === 5 ? Object.assign({}, x, { unit: 'Ltr' }) : x);
  r = await S.req('/api/items', { action: 'import', rows: fixed });
  ok('   corrected, the near name not ticked: nothing imported', r.status === 409 && r.j.code === 'similar' && sql('rcl', 'select count(*) from items') === n0, r.j);
  r = await S.req('/api/items', { action: 'import', rows: fixed, confirm: { 4: ['line 3'] } });
  ok('   ticked "different": 3 imported (Air Filter, Air Filters, Coolant), Sugar left out', r.status === 200 && r.j.added === 3 && r.j.exists === 1 && Number(sql('rcl', 'select count(*) from items')) === Number(n0) + 3, r.j);
  // ---- delete; the record; the database closed to the public ----
  r = await S.req('/api/items', { action: 'remove', code: 'ITM-0002' });
  ok('the Admin deletes an item', r.status === 200 && sql('rcl', "select count(*) from items where code = 'ITM-0002'") === '0', r.j);
  const acts = sql('rcl', "select string_agg(distinct action, ',' order by action) from store_activity");
  ok('the Store\'s activity record (S1): sign-ins, added, changed, deleted, imported', ['Sign-in', 'Item added', 'Item changed', 'Item deleted', 'Items imported'].every(a => acts.indexOf(a) > -1), acts);
  const anon = await fetch('http://127.0.0.1:3100/rest/v1/items?select=code', { signal: AbortSignal.timeout(10000) });
  ok('the items table is closed to the public (no key: refused)', anon.status === 401 || anon.status === 403, anon.status);
  r = await S.req('/api/logout', {}); const after = await S.req('/api/me');
  ok('Logout: the sign-in ends here (the page then signs out of the Portal)', r.status === 200 && after.j.signedIn === false && sql('rcl', "select count(*) from store_sessions where email = 'sujit@rcl.test'") === '0', after.j);
  r = await client(ST).req('/api/items', { action: 'list' });
  ok('nobody signed in: the items are not given', r.status === 401, r.status);

  sql('rcl_portal', "delete from access where module = 'store' and granted_by = 'test';");
  console.log(out.join('\n')); console.log('\nTOTAL ' + pass + ' passed, ' + fail + ' failed  (' + Math.round((Date.now() - T0) / 1000) + ' s)');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log(out.join('\n')); console.log('CRASH ' + (e.stack || e)); process.exit(2); });
