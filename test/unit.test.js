/* Unit tests – no database. node --test test/unit.test.js */
'use strict';
const test = require('node:test'), assert = require('assert'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), I = require('../lib/items');

test('the same name: capitals, spaces and signs do not count', () => {
  assert.strictEqual(I.keyOf(' Oil-Filter '), I.keyOf('OIL FILTER')); assert.strictEqual(I.keyOf('Oil Filter'), 'oilfilter');
  assert.notStrictEqual(I.keyOf('Bolt M10'), I.keyOf('Bolt M12'));
});
test('near names (asked first) and names that are NOT near (saved at once)', () => {
  const L = [{ code: 'A', name: 'Sugar' }, { code: 'B', name: 'Oil Filter' }, { code: 'C', name: 'Belt' }, { code: 'D', name: 'Bolt M10' }, { code: 'E', name: 'Hydraulic Hose 1/2 inch' }];
  const near = n => I.similar(n, L).map(x => x.code + ':' + x.why).join(',');
  // his example and its kind
  assert.strictEqual(near('Sugaar'), 'A:spelling'); assert.strictEqual(near('sugr'), 'A:spelling'); assert.strictEqual(near('Shugar'), 'A:spelling');
  assert.strictEqual(near('Filter Oil'), 'B:order'); assert.strictEqual(near('Oil Filters'), 'B:plural'); assert.strictEqual(near('Oil Fliter'), 'B:spelling'); assert.strictEqual(near('OilFiltr'), 'B:spelling');
  assert.strictEqual(near('Belts'), 'C:plural'); assert.strictEqual(near('Hydraulik hose 1/2 inch'), 'E:spelling');
  // NOT near: other words, other numbers, the same name (that is a duplicate, not a near name)
  for (const n of ['Air Filter', 'Fuel Filter', 'Bolt', 'Bolt M12', 'Tea', 'Salt', 'Sugar', 'OIL FILTER', 'Hydraulic Hose 3/4 inch']) assert.strictEqual(near(n), '', n);
  assert.deepStrictEqual(I.similar('Sugaar', L, 'A'), [], 'an item is never near itself (a change of its own name)');
});
test('a proper name is suggested: spelling of usual store words, capitals, a unit after a number; part numbers kept', () => {
  const p = n => I.properName(n, []).name;
  assert.strictEqual(p('hydrolic hose 10mm'), 'Hydraulic Hose 10 mm'); assert.strictEqual(p('  GI  pipe 2inch'), 'GI Pipe 2 inch');
  assert.strictEqual(p('bearing 6205zz'), 'Bearing 6205ZZ'); assert.strictEqual(p('m10 bolt'), 'M10 Bolt'); assert.strictEqual(p('engine oil 15w40 20ltr'), 'Engine Oil 15W40 20 ltr');
  assert.strictEqual(p('cemnt bag 50kg'), 'Cement Bag 50 kg'); assert.strictEqual(p('PVC  tape'), 'PVC Tape'); assert.strictEqual(p('oill filtr'), 'Oil Filter');
  assert.deepStrictEqual(I.properName('hydrolic hose', []).fixes, ['hydrolic → hydraulic']);
  assert.strictEqual(p('Sugaar'), 'Sugar', 'his example: the suggestion says Sugar');
  assert.strictEqual(I.properName('Kalpataru brand', ['Kalpataru Paint']).name, 'Kalpataru Brand', 'a word of the site\'s own items is not "corrected"');
  assert.strictEqual(I.properCategory('oil & lubricants'), 'Oil & Lubricants');
});
test('the fields: unit from the list, category needed, HSN 4/6/8 digits, GST 0–40, min stock 0 or more; a new item is Active', () => {
  const ok = I.check({ name: ' Grease ', unit: 'kg', category: 'oil', hsn: '3403 1900', gst: '18%', minStock: '5' });
  assert.deepStrictEqual(ok, { name: 'Grease', name_key: 'grease', unit: 'Kg', category: 'Oil', hsn: '34031900', gst_pct: 18, min_stock: 5, status: 'Active' });
  assert.strictEqual(I.check({ name: 'X1', unit: 'Nos', category: 'Ab', status: 'Inactive' }).status, 'Active', 'a new item cannot start Inactive');
  assert.strictEqual(I.check({ name: 'X1', unit: 'Nos', category: 'Ab', status: 'Inactive' }, { edit: true }).status, 'Inactive');
  for (const [x, re] of [[{ name: 'G', unit: 'Kg', category: 'Oil' }, /item name/], [{ name: 'Grease', unit: 'Kgs', category: 'Oil' }, /unit/], [{ name: 'Grease', unit: 'Kg', category: 'O' }, /category/],
    [{ name: 'Grease', unit: 'Kg', category: 'Oil', hsn: '12345' }, /HSN/], [{ name: 'Grease', unit: 'Kg', category: 'Oil', gst: '41' }, /GST/], [{ name: 'Grease', unit: 'Kg', category: 'Oil', gst: '5.555' }, /GST/],
    [{ name: 'Grease', unit: 'Kg', category: 'Oil', minStock: '-1' }, /Min stock/]]) assert.throws(() => I.check(x), e => e.user && re.test(e.message), JSON.stringify(x));
});
test('the page: its script parses; it signs in only through the Portal; Change site at the top of the dark menu; the Store group = the pages of menu.json; every address relative (one address)', () => {
  const h = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8'), js = [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
  js.split('\n</script>').forEach(t => new Function(t));
  assert.ok(h.indexOf('id="site_chg"') > -1 && h.indexOf('id="site_chg"') < h.indexOf('<nav'), 'Change site above the pages');
  const menu = JSON.parse(fs.readFileSync(path.join(root, 'public', 'menu.json'), 'utf8')), mk = h.slice(0, h.indexOf('<script'));
  assert.strictEqual(menu.module, 'store');
  assert.deepStrictEqual([...mk.matchAll(/data-page="([a-z]+)"/g)].map(m => m[1]), menu.pages.map(p => p.key), 'the menu of the page = menu.json (what other modules show)');
  assert.ok(!/type="password"/.test(h), 'no password box anywhere');
  assert.match(h, /\/api\/go\?module=store&site=/); assert.match(h, /'\/?signout=1'|\/\?signout=1/);
  assert.ok(!/(fetch|api)\(\s*'\/(api|vendor)|src="\/|href="\/(?!\/)|'\/vendor\//.test(h), 'no address from the root: the page works at /store/ too');
  assert.match(js, /const BASE = location\.pathname/);
});
test('a Portal ticket: a module address may carry a path (/store, /portal) – nothing else', () => {
  const P = require('../lib/portal'), old = process.env.PORTAL_URL;
  try {
    for (const [v, want] of [['https://a.example.app/portal/', 'https://a.example.app/portal'], ['https://a.example.app', 'https://a.example.app'], ['http://127.0.0.1:3030/portal', 'http://127.0.0.1:3030/portal'],
      ['https://a.example.app/x/y', ''], ['https://a.example.app/portal?x=1', ''], ['javascript:alert(1)', ''], ['ftp://a.example.app', '']]) { process.env.PORTAL_URL = v; assert.strictEqual(P.url(), want, v); }
  } finally { if (old === undefined) delete process.env.PORTAL_URL; else process.env.PORTAL_URL = old; }
});
test('the SQL only ADDS (nothing dropped, deleted or emptied outside its rollback note); every table closed to the public', () => {
  const q = fs.readFileSync(path.join(root, 'sql', 'store_step1_items.sql'), 'utf8'), code = q.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  assert.ok(!/\b(drop\s+table|truncate|delete\s+from|alter\s+table\s+\S+\s+drop)\b/i.test(code), 'no destructive statement');
  for (const t of ['items', 'store_sessions', 'store_tickets', 'store_activity']) assert.match(q, new RegExp('create table if not exists public\\.' + t + ' '));
  assert.match(q, /enable row level security/); assert.match(q, /revoke all on public\.%I from public, anon, authenticated/);
  assert.match(q, /create unique index if not exists items_name_key on public\.items \(name_key\)/, 'the database itself refuses the same name twice');
});
test('no secret is written in the project files; the safety headers are set', () => {
  const files = []; const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => { if (['.git', 'node_modules', 'vendor', 'shots'].indexOf(e.name) > -1) return; const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else files.push(f); });
  walk(root);
  files.filter(f => !/test[\\/]/.test(f)).forEach(f => { const t = fs.readFileSync(f, 'utf8'); assert.ok(!/sb_secret_[A-Za-z0-9_-]{20,}|eyJhbGciOi[A-Za-z0-9._-]{40,}|-----BEGIN [A-Z ]*PRIVATE KEY/.test(t), f); });
  const v = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')), hs = v.headers[0].headers.map(x => x.key);
  for (const k of ['X-Content-Type-Options', 'X-Frame-Options', 'Content-Security-Policy', 'Referrer-Policy']) assert.ok(hs.indexOf(k) > -1, k);
});
test('inside another module\'s screen (13-10-2026): no menu or top bar of its own, its sign-in by itself (json=1), shown only by a page of this address', () => {
  const h = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.match(h, /html\.embed \.side, html\.embed \.topbar \{ display: none !important; \}/);
  assert.match(h, /const EMBED = \/\[\?&\]embed=1\(&\|\$\)\/\.test\(location\.search\)/);
  assert.match(h, /PORTAL \+ '\/api\/go\?module=store&site=' \+ encodeURIComponent\(site\) \+ '&json=1', \{ credentials: 'same-origin', headers: \{ 'X-RCL': '1' \} \}/);
  assert.match(h, /if \(EMBED\) return embedStart\(\);/); assert.match(h, /&& EMBED\) \{ embedTicket\(/, 'a sign-in that ended: a new one by itself');
  assert.match(h, /'&page=store__' \+ \(page \|\| 'dashboard'\)/, 'opened on its own beside Mechanical: into Mechanical\'s screen');
  assert.match(h, /Date\.now\(\) - last > 30000/, 'never a circle');
  const v = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')), hs = v.headers[0].headers, get = k => (hs.find(x => x.key === k) || {}).value;
  assert.strictEqual(get('X-Frame-Options'), 'SAMEORIGIN'); assert.match(get('Content-Security-Policy'), /frame-ancestors 'self'/); assert.ok(!/frame-ancestors 'none'/.test(get('Content-Security-Policy')));
});
test('search from the screen around it (13-10-2026): window.rclModule search / open – the Item Master, a spelling mistake allowed', () => {
  const h = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  assert.match(h, /window\.rclModule = \{\n    key: 'store',\n    async search\(q\)/); assert.match(h, /open\(page, find\) \{ go\(/);
  assert.match(h, /\[t\.i\.code, t\.i\.name|\[i\.code, i\.name, i\.category, i\.hsn, i\.unit, i\.status\]/);
  // the spelling allowance, run as the page runs it
  const src = h.slice(h.indexOf('  function sDist('), h.indexOf('  function sFind('));
  const sDist = new Function(src + '; return sDist;')();
  assert.strictEqual(sDist('pmup', 'pump', 1), 1, 'two letters the other way round = one mistake'); assert.strictEqual(sDist('hydrolic', 'hydraulic', 2), 2); assert.ok(sDist('bolt', 'belt', 1) <= 1); assert.ok(sDist('sugar', 'cement', 1) > 1);
});

test('update-155: the page keeps the answers of its looks in memory and rebuilds them exactly – the same way as Mechanical', async () => {
  const d = require('../lib/delta'), { sendKept } = require('../lib/http'), vm = require('vm');
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  // the two functions in the page are lib/delta.js CLIENT word for word (indented)
  const lines = d.CLIENT.split('\n'), at = page.indexOf('  ' + lines[0]);
  assert.ok(at > -1 && lines.every((l, k) => page.slice(at).split('\n')[k] === '  ' + l), 'the page carries delta.CLIENT');

  // the server's answer: whole, "the same", only what changed; per person and site
  d.clearKept();
  const res = () => { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, end(t) { r.text = t; } }; return r; };
  const S = { site: 'S1', email: 'a@rcl.test' }, big = n => ({ items: Array.from({ length: n }, (_, i) => ({ code: 'ITM-' + String(i + 1).padStart(4, '0'), name: 'Part ' + i, unit: 'Nos' })) });
  let r = res(); sendKept(r, S, { action: 'list', m: 1 }, big(300)); const j1 = JSON.parse(r.text);
  assert.deepStrictEqual(Object.keys(j1), ['h', 'result']); assert.deepStrictEqual(j1.result, big(300));
  r = res(); sendKept(r, S, { action: 'list', m: 1, have: j1.h, dx: 1 }, big(300)); assert.deepStrictEqual(JSON.parse(r.text), { h: j1.h, same: 1 });
  r = res(); sendKept(r, S, { action: 'list', m: 1, have: j1.h, dx: 1 }, big(301)); const j3 = JSON.parse(r.text);
  assert.ok(j3.delta && j3.base === j1.h && r.text.length < 2000); assert.strictEqual(d.rclPatch(JSON.stringify(big(300)), j3.delta), JSON.stringify(big(301)));
  r = res(); sendKept(r, { site: 'S1', email: 'b@rcl.test' }, { action: 'list', m: 1, have: j3.h, dx: 1 }, big(5)); assert.ok('result' in JSON.parse(r.text), 'another person: never a change from someone else\'s answer');
  r = res(); sendKept(r, { site: 'T2', email: 'a@rcl.test' }, { action: 'list', m: 1, have: j3.h, dx: 1 }, big(5)); assert.ok('result' in JSON.parse(r.text), 'another site: the same');
  // the page's helper against these answers: always the server's answer of now
  const fns = page.slice(page.indexOf('  ' + lines[0]), page.indexOf('    return j.result;\n  }\n') + '    return j.result;\n  }\n'.length);
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(fns), 'nothing of it in the browser\'s storage');
  let list = big(200); const sent = [];
  const fetch = async (u, o) => { const b = JSON.parse(o.body); sent.push(b); const out = res(); const q = Object.assign({}, b); sendKept(out, S, q, list); return { ok: true, status: 200, text: async () => out.text }; };
  const ctx = { fetch, BASE: '', previewBand() {}, window: { crypto: globalThis.crypto, TextEncoder }, TextEncoder, Map, JSON, Object, Array, Uint8Array, String, Error, Promise };
  ctx.window.window = ctx.window; vm.createContext(ctx); vm.runInContext(fns + '; this.look = look; this.keptClear = keptClear;', ctx);
  d.clearKept();
  assert.deepStrictEqual(await ctx.look('api/x', { action: 'list' }), list); assert.ok(!('have' in sent[0]));
  assert.deepStrictEqual(await ctx.look('api/x', { action: 'list' }), list); assert.ok(sent[1].have && sent[1].dx === 1);
  for (let k = 0; k < 8; k++) { list = JSON.parse(JSON.stringify(list)); if (k % 2) list.items.unshift({ code: 'N' + k, name: 'New ' + k, unit: 'Nos' }); else list.items[k * 3].name = 'Changed ' + k; assert.deepStrictEqual(await ctx.look('api/x', { action: 'list' }), list, 'change ' + k); }
  ctx.keptClear(); await ctx.look('api/x', { action: 'list' }); assert.ok(!('have' in sent[sent.length - 1]), 'emptied: asked whole');
});

test('update-155: a new row is not sent twice after no answer; one that never left, a read, a change, a delete and an upsert are asked again', async () => {
  const S = require('../lib/sites');
  const DB = (m, p, b, pr) => S._rest({ url: 'http://db.test', key: 'k' }, m, p.replace('ROWS', 'items'), b, pr, 'site S1');
  const env = { VERCEL_ENV: process.env.VERCEL_ENV, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY }, f0 = global.fetch;
  let plan = [], calls = 0;
  const fault = code => { const e = new TypeError('fetch failed'); e.cause = Object.assign(new Error(code), { code: code }); return e; };
  global.fetch = async () => { calls++; const step = plan.shift();
    if (step === 'refused') throw fault('ECONNREFUSED');      // the request never left: no connection
    if (step === 'dropped') throw fault('UND_ERR_SOCKET');    // sent, and the answer was lost on the way back
    if (step === 500) return new Response('{"message":"boom"}', { status: 500 });
    if (step === 503) return new Response('{"message":"not reachable"}', { status: 503 });
    return new Response('[{"id":1}]', { status: 200 }); };
  const run = async (steps, ...args) => { plan = steps.slice(); calls = 0; try { return { r: await DB(...args), n: calls }; } catch (e) { return { e: e, n: calls }; } };
  try {
    process.env.SUPABASE_URL = 'http://db.test'; process.env.SUPABASE_SECRET_KEY = 'k'; process.env.VERCEL_ENV = 'production';
    let x = await run(['dropped', 'ok'], 'POST', 'ROWS', [{ a: 1 }], 'return=representation');
    assert.ok(x.e && x.e.status === 503 && /may or may not have been saved/.test(x.e.message) && x.n === 1, 'a new row whose answer was lost: not sent again – ' + (x.e && x.e.message) + ' / ' + x.n);
    x = await run([500, 'ok'], 'POST', 'ROWS', [{ a: 1 }], 'return=minimal');
    assert.ok(x.e && x.n === 1, 'a new row the database answered 500 to: not sent again');
    x = await run(['refused', 'ok'], 'POST', 'ROWS', [{ a: 1 }], 'return=minimal');
    assert.ok(!x.e && x.n === 2, 'a new row that never left (no connection): sent again');
    x = await run([503, 'ok'], 'POST', 'ROWS', [{ a: 1 }], 'return=minimal');
    assert.ok(!x.e && x.n === 2, 'a new row the database said it did not take (503): sent again');
    for (const [m, p, pr] of [['GET', 'ROWS?select=id', undefined], ['PATCH', 'ROWS?id=eq.1', 'return=minimal'], ['DELETE', 'ROWS?id=eq.1', 'return=minimal'], ['POST', 'ROWS?on_conflict=id', 'resolution=merge-duplicates,return=minimal']]) {
      x = await run(['dropped', 'ok'], m, p, m === 'GET' || m === 'DELETE' ? undefined : [{ a: 1 }], pr);
      assert.ok(!x.e && x.n === 2, m + ' ' + p + ': asked again as before (done twice it leaves the same)');
      x = await run([500, 'ok'], m, p, m === 'GET' || m === 'DELETE' ? undefined : [{ a: 1 }], pr);
      assert.ok(!x.e && x.n === 2, m + ' ' + p + ' after a 500: asked again as before');
    }
  } finally { global.fetch = f0; Object.keys(env).forEach(k => { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }); }
});
