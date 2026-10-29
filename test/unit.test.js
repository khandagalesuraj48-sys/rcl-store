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

/* ---------------- step 2 (28-10-2026): the Store's work – the rules of every paper, the approvals, the stock and the reports ---------------- */
const W = require('../lib/work'), R = require('../lib/sreport');
const ITEMS = { 'ITM-0001': { code: 'ITM-0001', name: 'Cement', unit: 'Bag', category: 'Cement', gst_pct: 28, min_stock: 50, status: 'Active' },
  'ITM-0002': { code: 'ITM-0002', name: 'Bamboo', unit: 'Nos', category: 'Shuttering', gst_pct: null, min_stock: null, status: 'Active' },
  'ITM-0003': { code: 'ITM-0003', name: 'Old Hose', unit: 'Mtr', category: 'Spare Parts', gst_pct: 18, min_stock: null, status: 'Inactive' } };
const day0 = W.today(), back = n => { const d = new Date(day0 + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const throwsMsg = (f, re) => assert.throws(f, e => e.user && re.test(e.message), String(re));
test('step 2 – a requirement: its items from the Item Master, once each; for a machinery: which one; an Inactive item only if it was there', () => {
  const r = W.checkReq({ date: back(1), need_by: back(-3), for_kind: 'site work', for_text: 'Ch 540+450 toe wall', lines: [{ code: 'ITM-0001', qty: '100' }, { code: 'ITM-0002', qty: 40, note: 'for shuttering' }] }, ITEMS);
  assert.strictEqual(r.for_kind, 'Site work'); assert.deepStrictEqual(r.lines.map(l => [l.line, l.code, l.qty, l.unit]), [[1, 'ITM-0001', 100, 'Bag'], [2, 'ITM-0002', 40, 'Nos']]);
  throwsMsg(() => W.checkReq({ date: back(1), for_kind: 'Site work', lines: [{ code: 'ITM-0001', qty: 1 }, { code: 'ITM-0001', qty: 2 }] }, ITEMS), /twice in the list/);
  throwsMsg(() => W.checkReq({ date: back(1), for_kind: 'Machinery', lines: [{ code: 'ITM-0001', qty: 1 }] }, ITEMS), /Pick the machinery/);
  throwsMsg(() => W.checkReq({ date: back(1), for_kind: 'Machinery', for_text: 'X1', lines: [{ code: 'ITM-0001', qty: 1 }] }, ITEMS, { machinery: [{ no: 'MH12' }] }), /not in the Asset Master/);
  throwsMsg(() => W.checkReq({ date: back(1), for_kind: 'Site work', lines: [{ code: 'ITM-0003', qty: 1 }] }, ITEMS), /Inactive/);
  assert.ok(W.checkReq({ date: back(1), for_kind: 'Site work', lines: [{ code: 'ITM-0003', qty: 1 }] }, ITEMS, { had: new Set(['ITM-0003']) }));
  throwsMsg(() => W.checkReq({ date: back(-1), for_kind: 'Site work', lines: [{ code: 'ITM-0001', qty: 1 }] }, ITEMS), /after today/);
  throwsMsg(() => W.checkReq({ date: back(1), for_kind: 'Site work', lines: [{ code: 'ITM-0001', qty: 0 }] }, ITEMS), /more than 0/);
  assert.strictEqual(W.dayOf('5/3/2026', 'date'), '2026-03-05');
});
test('step 2 – a GRN: taxable = qty × basic rate, GST on it (the item\'s GST % unless typed), gross; TCS on the bill; a PO line must be its item', () => {
  const g = W.checkGrn({ date: back(0), supplier: ' Bedrok Chem Infra ', invoice_no: 'B/45', vehicle_no: 'mh 12 ab 1234', tcs: '12.5', lines: [{ code: 'ITM-0001', qty: 10, rate: '350.5' }, { code: 'ITM-0002', qty: 100, rate: 90, gst_pct: 0 }] }, ITEMS);
  assert.deepStrictEqual(g.lines.map(l => [l.taxable, l.gst_pct, l.gst, l.gross]), [[3505, 28, 981.4, 4486.4], [9000, 0, 0, 9000]]);
  assert.deepStrictEqual([g.head.taxable, g.head.gst, g.head.tcs, g.head.gross, g.head.vehicle_no, g.head.supplier], [12505, 981.4, 12.5, 13498.9, 'MH12AB1234', 'Bedrok Chem Infra']);
  const po = { no: 7, lines: [{ line: 1, code: 'ITM-0001', name: 'Cement', qty: 100 }] };
  assert.strictEqual(W.checkGrn({ date: back(0), supplier: 'AB Traders', lines: [{ code: 'ITM-0001', qty: 5, rate: 1, po_line: 1 }] }, ITEMS, { po: po }).head.po_no, 7);
  throwsMsg(() => W.checkGrn({ date: back(0), supplier: 'AB Traders', lines: [{ code: 'ITM-0002', qty: 5, rate: 1, po_line: 1 }] }, ITEMS, { po: po }), /is for Cement, not Bamboo/);
  throwsMsg(() => W.checkGrn({ date: back(0), supplier: '', lines: [{ code: 'ITM-0001', qty: 5 }] }, ITEMS), /supplier/);
});
test('step 2 – an issue: whom (site work / sub-contractor / machinery / office), what for; its value at the average basic rate; a debit with its rate and GST', () => {
  const rateFor = (c, d) => (c === 'ITM-0001' ? 352.25 : 90);
  const a = W.checkIssue({ date: back(0), to_kind: 'Sub-contractor', party: 'Tushar Mandal', location: '539+623', side: 'lhs', use_for: 'BC', receiver: 'Kishor', lines: [{ code: 'ITM-0001', qty: 4 }, { code: 'ITM-0002', qty: 50, returnable: true }] }, ITEMS, { rateFor: rateFor });
  assert.deepStrictEqual(a.lines.map(l => [l.rate, l.amount, l.gst, l.returnable]), [[352.25, 1409, 0, false], [90, 4500, 0, true]]);
  assert.deepStrictEqual([a.head.side, a.head.amount, a.head.debit, a.head.party], ['LHS', 5909, false, 'Tushar Mandal']);
  throwsMsg(() => W.checkIssue({ date: back(0), to_kind: 'Site work', lines: [{ code: 'ITM-0001', qty: 1 }] }, ITEMS), /used for/);
  throwsMsg(() => W.checkIssue({ date: back(0), to_kind: 'Sub-contractor', use_for: 'x', lines: [{ code: 'ITM-0001', qty: 1 }] }, ITEMS), /sub-contractor/);
  throwsMsg(() => W.checkIssue({ date: back(0), to_kind: 'Machinery', machinery: 'MH25', lines: [{ code: 'ITM-0001', qty: 1 }] }, ITEMS, { machinery: [{ no: 'MH12' }] }), /not in the Asset Master/);
  const m = W.checkIssue({ date: back(0), to_kind: 'Machinery', machinery: 'MH12', reading: '7857.1', debit: true, lines: [{ code: 'ITM-0001', qty: 2, rate: 400 }, { code: 'ITM-0002', qty: 1 }] }, ITEMS, { machinery: [{ no: 'MH12', owner: 'AK Roadways' }], rateFor: rateFor });
  assert.deepStrictEqual([m.head.party, m.head.reading, m.lines[0].amount, m.lines[0].gst, m.lines[1].rate, m.head.amount], ['AK Roadways', 7857.1, 800, 224, 90, 1114]);
  throwsMsg(() => W.checkIssue({ date: back(0), to_kind: 'Office', debit: true, lines: [{ code: 'ITM-0001', qty: 1 }] }, ITEMS), /debit is to a sub-contractor/);
  throwsMsg(() => W.checkIssue({ date: back(0), to_kind: 'Office', side: 'up', lines: [{ code: 'ITM-0001', qty: 1 }] }, ITEMS), /LHS, RHS or Both/);
});
test('step 2 – a return: never more than is still out on the line; not before the issue', () => {
  const iss = { no: 12, date: back(5), party: 'Tushar Mandal', lines: [{ id: 91, code: 'ITM-0002', name: 'Bamboo', unit: 'Nos', qty: 50 }] };
  assert.deepStrictEqual(W.checkReturn({ date: back(1), lines: [{ issue_line: 91, qty: 20 }] }, iss, { back: { 91: 25 } }).lines, [{ line: 1, issue_line: 91, qty: 20, remark: null }]);
  throwsMsg(() => W.checkReturn({ date: back(1), lines: [{ issue_line: 91, qty: 30 }] }, iss, { back: { 91: 25 } }), /more than is out \(25 Nos of 50\)/);
  throwsMsg(() => W.checkReturn({ date: back(6), lines: [{ issue_line: 91, qty: 1 }] }, iss), /before the issue date/);
  throwsMsg(() => W.checkReturn({ date: back(1), lines: [{ issue_line: 92, qty: 1 }] }, iss), /not a line of outward 12/);
});
test('step 2 – approvals: any one person of the level; the next level; nobody approves his own (a level of only him is passed); no level = approved at once', () => {
  const lv = W.levelsOf({ levels: [{ level: 2, people: [{ email: 'PM@x.in', name: 'PM' }] }, { level: 1, people: [{ email: 'se@x.in', name: 'SE' }, { email: 'se2@x.in', name: 'SE2' }] }, { level: 3, people: [] }] });
  assert.deepStrictEqual(lv.map(l => l.level), [1, 2]);
  assert.strictEqual(W.nextLevel(lv, 0, 'store@x.in'), 1); assert.strictEqual(W.nextLevel(lv, 1, 'store@x.in'), 2); assert.strictEqual(W.nextLevel(lv, 2, 'store@x.in'), 0);
  assert.strictEqual(W.nextLevel(lv, 1, 'pm@x.in'), 0, 'the PM\'s own requirement: level 2 has only him – passed');
  assert.ok(W.canApprove(lv, 1, 'SE2@x.in', 'store@x.in')); assert.ok(!W.canApprove(lv, 2, 'se@x.in', 'store@x.in')); assert.ok(!W.canApprove(lv, 1, 'se@x.in', 'se@x.in'));
  assert.strictEqual(W.nextLevel(W.levelsOf(null), 0, 'a@x.in'), 0);
});
test('step 2 – a party\'s name: the same name as written before (capitals, spaces); a near one asked; "a different one" saved as typed', () => {
  assert.deepStrictEqual(W.partyOf('tushar  MANDAL', ['Tushar Mandal']), { name: 'Tushar Mandal', near: [] });
  assert.deepStrictEqual(W.partyOf('Tushar Mandall', ['Tushar Mandal']).near, ['Tushar Mandal']);
  assert.deepStrictEqual(W.partyOf('Tushar Mandall', ['Tushar Mandal'], true), { name: 'Tushar Mandall', near: [] });
});
test('step 2 – the stock: average basic rate (opening + GRNs up to the date); stock on a date', () => {
  const mv = [{ code: 'A', date: '2026-10-01', q: 10, kind: 'OPN', rate: 100 }, { code: 'A', date: '2026-10-05', q: 30, kind: 'GRN', rate: 120 }, { code: 'A', date: '2026-10-06', q: -15, kind: 'OUT', rate: 115 }, { code: 'A', date: '2026-10-07', q: 5, kind: 'RET' }];
  assert.strictEqual(W.avgRate(mv, 'A', '2026-10-04'), 100); assert.strictEqual(W.avgRate(mv, 'A', '2026-10-31'), 115); assert.strictEqual(W.rateFinder(mv)('A', '2026-10-31'), 115);
  assert.deepStrictEqual(W.stockOn(mv, '2026-10-06'), { A: 25 }); assert.deepStrictEqual(W.stockOn(mv), { A: 30 });
});
test('step 2 – reports: the stock statement (his daily report), the item ledger, consumption without the returns, returnable still out', () => {
  const items = Object.values(ITEMS);
  const st = R.statement(items, [{ code: 'ITM-0001', opening: 10, inward: 30, returned: 0, issued: 15, closing: 25, in_qty: 40, in_value: 4600, buy_qty: 30, buy_value: 3600 }], '2026-10-01', '2026-10-31');
  assert.deepStrictEqual(st.rows[0].slice(4), [10, 30, 0, 15, 15, 25, 115, 2875, 30, 3600]); assert.strictEqual(st.total[13], 3600);
  const lg = R.ledger(ITEMS['ITM-0001'], [{ code: 'ITM-0001', date: '2026-09-30', q: 10, kind: 'OPN', no: 0, rate: 100, id: 'a' }, { code: 'ITM-0001', date: '2026-10-05', q: 30, kind: 'GRN', no: 3, rate: 120, id: 'b' }, { code: 'ITM-0001', date: '2026-10-06', q: -15, kind: 'OUT', no: 9, rate: 115, id: 'c' }], { 'GRN:3': 'Bedrok', 'OUT:9': 'Tushar Mandal' }, '2026-10-01', '2026-10-31');
  assert.deepStrictEqual(lg.rows.map(r => [r[1], r[2], r[3], r[4], r[5]]), [['Opening', '', '', '', 10], ['GRN 3', 'Bedrok', 30, '', 40], ['Outward 9', 'Tushar Mandal', '', 15, 25]]);
  const iss = [{ no: 9, date: '2026-10-06', to_kind: 'Sub-contractor', party: 'Tushar Mandal', lines: [{ id: 1, line: 1, code: 'ITM-0002', name: 'Bamboo', unit: 'Nos', qty: 50, rate: 90, amount: 4500, gst: 0, returnable: true }] }];
  const c = R.consumption(iss, { 1: 20 }, '2026-10-01', '2026-10-31', 'party');
  assert.deepStrictEqual(c.rows, [['Tushar Mandal', 'Bamboo', 'Nos', 30, 2700]]);
  assert.deepStrictEqual(R.returnable(iss, { 1: 20 }).rows.map(r => r.slice(5, 8)), [[50, 20, 30]]);
  assert.strictEqual(R.issueRegister(iss, { 1: 20 }, '2026-10-01', '2026-10-31', {}).rows[0][16], 20);
});
test('step 2 – pages: the new pages only when the Super Admin gives them (a Store Admin has them all); Store Purchase only when given – also to an Admin', () => {
  const ses = require('../lib/session');
  assert.deepStrictEqual(ses.pagesOf(false, null), { dashboard: 'View', items: 'Edit', req: 'None', grn: 'None', issue: 'None', reports: 'None', po: 'None', purchase: 'None' });
  assert.deepStrictEqual(ses.pagesOf(true, {}), { dashboard: 'View', items: 'Edit', req: 'Edit', grn: 'Edit', issue: 'Edit', reports: 'View', po: 'View', purchase: 'None' });
  assert.strictEqual(ses.pagesOf(false, { approve: 'L2' }).req, 'View', 'one who approves sees the requirements');
  assert.strictEqual(ses.pagesOf(false, { approve: 'L1', req: 'Edit' }).req, 'Edit'); assert.strictEqual(ses.pagesOf(false, { approve: 'None' }).req, 'None');
  assert.strictEqual(ses.pagesOf(true, { purchase: 'Edit' }).purchase, 'Edit'); assert.strictEqual(ses.pagesOf(false, { req: 'View', grn: 'Edit' }).grn, 'Edit');
});
test('step 2 – the database step: only adds; every table locked to the server; the saves check the stock', () => {
  const sql = fs.readFileSync(path.join(root, 'sql', 'store_step2_work.sql'), 'utf8');
  assert.ok(!/\b(drop\s+table|truncate|delete\s+from\s+public\.(items|master|vendors))\b/i.test(sql.replace(/^--.*$/gm, '')), 'no table dropped, nothing of Mechanical deleted');
  for (const t of ['store_req', 'store_po', 'store_grn', 'store_issue', 'store_return', 'store_opening']) assert.ok(new RegExp("'" + t + "'").test(sql), t + ' locked to the server');
  assert.ok(/perform public\.store_short\(v_old \|\| v_new\)/.test(sql) && /raise exception 'STORE_SHORT/.test(sql));
});

/* ---------- (28-10-2026) THE OLD INWARD REGISTER: the page's reading (public/grnreg.js) and the server's check (lib/grnimport.js) ---------- */
const RG = require('../public/grnreg'), GI = require('../lib/grnimport');
// a register as his file has it: a Summary sheet first, the heading on row 4 written on two lines, a GRN's details on its first row only
const REG_HEAD = ['Sr No ', 'GRN\r\n No', 'GRN Date ', 'Challan No ', 'Invoice No.', 'Invoice Date', 'Vehicle No', 'Supplier Name ', 'Material Description', 'Received\r\nQty', 'UOM', 'Basic\r\nRate ', 'Taxable \r\nAmount', 'GST\r\n Amount', 'TCS', 'Gross \r\nAmount', 'Remark'];
const regSheet = rows => ({ name: 'MAIN SHEET INWARD1', aoa: [['INWARD REGISTER'], [], [], REG_HEAD].concat(rows) });
test('register – the sheet with the register\'s heading is taken (not the Summary), its columns found, a GRN\'s details carried to its rows', () => {
  const summary = { name: 'Summary', aoa: [['Material', 'Qty'], ['Cement', 10]] };
  const sh = RG.pickSheet([summary, regSheet([[1, 7, 44864, '', 'INV/1', 44863, 'MH-04-AB-1234', 'Shree Traders', 'Cement OPC 53', 10, 'bags', 350, 3500, 980, '', 4480, 'Cement'], [2, 7, '', '', '', '', '', '', 'Binding Wire', 25, 'kgs', 80, 2000, 360, '', 2360, 'Hardware']])]);
  assert.strictEqual(sh.name, 'MAIN SHEET INWARD1'); assert.deepStrictEqual(sh.others, ['Summary']); assert.strictEqual(sh.hi, 3);
  assert.deepStrictEqual([sh.col.ref, sh.col.date, sh.col.party, sh.col.item, sh.col.qty, sh.col.uom, sh.col.rate, sh.col.taxable, sh.col.gst, sh.col.tcs, sh.col.gross, sh.col.remark], [1, 2, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const rows = RG.readRows(sh);
  assert.deepStrictEqual(rows.map(r => [r.line, r.ref, r.date, r.party, r.invoice_no, r.vehicle_no]), [[5, '7', '2022-10-30', 'Shree Traders', 'INV/1', 'MH-04-AB-1234'], [6, '7', '2022-10-30', 'Shree Traders', 'INV/1', 'MH-04-AB-1234']]);
  assert.strictEqual(RG.pickSheet([summary]), null, 'no register heading – none');
});
test('register – dates, numbers and GRN Nos as his file writes them', () => {
  assert.strictEqual(RG.dayIn(44864), '2022-10-30'); assert.strictEqual(RG.dayIn(44864.75), '2022-10-30'); assert.strictEqual(RG.dayIn('30-Nov-2022'), '2022-11-30'); assert.strictEqual(RG.dayIn('30/11/2022'), '2022-11-30');
  assert.strictEqual(RG.dayIn('2022-11-30'), '2022-11-30'); assert.strictEqual(RG.dayIn('14-04-205'), ''); assert.strictEqual(RG.dayIn('31-02-2023'), ''); assert.strictEqual(RG.dayIn(''), '');
  assert.strictEqual(RG.refIn(8029), '8029'); assert.strictEqual(RG.refIn('8029`'), '8029'); assert.strictEqual(RG.refIn('342 B'), '342 B'); assert.strictEqual(RG.refIn('`'), ''); assert.strictEqual(RG.refIn('x'), '');
  assert.strictEqual(RG.numIn('1,180.00'), 1180); assert.strictEqual(RG.numIn('₹ 650'), 650); assert.strictEqual(RG.numIn('4 nos'), null); assert.strictEqual(RG.numIn(''), null);
});
test('register – the page and the server read a unit, a GST % and a GRN\'s key the same way', () => {
  for (const w of ['nos', 'No.', 'Nos ', 'pcs', 'kgs', 'rmtr', 'jab', 'Ltrs', 'bkt', 'Sq.M', 'cum', 'Brass', 'MT', '5x5', '']) assert.deepStrictEqual(RG.unitOf(w), GI.unitOf(w), w);
  assert.deepStrictEqual([GI.unitOf('nos').unit, GI.unitOf('kgs').unit, GI.unitOf('rmtr').unit, GI.unitOf('jab').unit, GI.unitOf('5x5').unit], ['Nos', 'Kg', 'Mtr', 'Job', 'Nos']);
  assert.ok(/taken as Nos/.test(GI.unitOf('5x5').note));
  for (const [t, g] of [[3500, 980], [1000, 180], [999, 50], [1000, 133]]) assert.strictEqual(RG.gstPctOf(t, g), GI.gstPctOf(t, g));
  assert.deepStrictEqual([GI.gstPctOf(3500, 980), GI.gstPctOf(999, 50), GI.gstPctOf(1000, 133)], [28, 5, 13.3]);
  assert.strictEqual(RG.docKey('342-a', '2022-12-24', 'Shree Traders', 'INV/1'), GI.docKey('342-a', '2022-12-24', 'SHREE TRADERS ', 'inv-1'));
  const I2 = require('../lib/items'); Object.values(GI.UNIT_OF).forEach(u => assert.ok(I2.UNITS.includes(u), u + ' is a unit of the Item Master'));
});
test('register – the check: one GRN per GRN No + date + supplier + invoice; the same row twice shown (kept unless deleted); rows to look at; what he typed', () => {
  const R0 = [[1, 10, 44864, '', 'A1', '', '', 'Shree Traders', 'Cement OPC 53', 10, 'bags', 350, 3500, 980, '', 4480, ''],
    [2, 10, 44864, '', 'A1', '', '', 'Shree Traders', 'Cement OPC 53', 10, 'bags', 350, 3500, 980, '', 4480, ''],            // the same row again
    [3, 10, 44865, '', 'B7', '', '', 'Om Hardware', 'Binding Wire', 25, 'kgs', 80, '', '', '', '', 'Hardware'],              // GRN No 10 again – another supplier, day, invoice: its own GRN
    [4, 11, 44865, '', 'C2', '', '', 'Om Hardware', 'Bolt M16', '', 'nos', '', '', '', '', '', ''],                         // no quantity, no amount: to look at
    [5, 12, '14-04-205', '', 'C3', '', '', 'Om Hardware', 'Nut M16', 4, 'nos', 10, 40, 7.2, '', 47.2, ''],                  // not a date
    [6, '', 44866, '', 'D1', '', '', 'TCI Express', 'Transporting', 1, 'trip', 900, 900, 162, '', 1062, ''],                 // no GRN No: the next number
    [7, 13, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']];                                                   // only a GRN No: nothing
  const rows = RG.readRows(RG.pickSheet([regSheet(R0)])), info = { items: [['ITM-0001', 'Cement OPC-53', 'Bag', 'Cement']], vendors: ['SHREE TRADERS'], grns: [], next: 1 };
  let p = RG.plan(rows, info, {}, '2026-10-28');
  assert.deepStrictEqual(p.docs.map(d => [d.ref, d.date, d.supplier, d.lines.length]), [['10', '2022-10-30', 'SHREE TRADERS', 2], ['10', '2022-10-31', 'Om Hardware', 1], ['', '2022-11-01', 'TCI Express', 1]]);
  assert.strictEqual(p.docs[0].lines[0].item, 'Cement OPC-53', 'an item already in the Item Master: its name there');
  assert.deepStrictEqual(p.dups.map(d => [d.line, d.first, d.gone]), [[6, 5, false]]);
  assert.deepStrictEqual(p.look.map(l => [l.line, l.why]), [[8, ['no quantity']], [9, ['GRN date "14-04-205" is not a date']]]);
  assert.deepStrictEqual(p.empty, [11]);
  assert.deepStrictEqual(p.newSup.map(s => s.name), ['Om Hardware', 'TCI Express']);
  assert.deepStrictEqual(p.newItems.map(i => [i.name, i.unit, i.gst]), [['Binding Wire', 'Kg', ''], ['Transporting', 'Trip', 18]]);
  assert.deepStrictEqual([p.maxRef, p.first, p.next, p.noRef], [10, 11, 12, 1]);
  const bw = p.docs[1].lines[0]; assert.deepStrictEqual([bw.taxable, bw.gst], [2000, 0], 'no Taxable Amount in the file: Qty × Rate');
  // he deletes the duplicate, types the quantity and the date: the rows go in
  p = RG.plan(rows, info, { gone: { 6: true }, edit: { 8: { qty: '6' }, 9: { date: '2023-04-14' } } }, '2026-10-28');
  assert.deepStrictEqual([p.docs[0].lines.length, p.look.length, p.dups[0].gone], [1, 0, true]);
  assert.deepStrictEqual(p.docs.map(d => d.ref), ['10', '10', '11', '12', '']);
  // a GRN already in the Store (its key) is left out – never twice; one without a GRN No: its date, supplier and invoice
  p = RG.plan(rows, Object.assign({}, info, { grns: [[RG.docKey('10', '2022-10-31', 'Om Hardware', 'B7'), '10', 10, '2022-10-31', 'Om Hardware'], [RG.docKey('14', '2022-11-01', 'TCI Express', 'D1'), '14', 14, '2022-11-01', 'TCI Express']] }), {}, '2026-10-28');
  assert.deepStrictEqual([p.docs.length, p.already.length], [1, 2]);
});
test('register – a date far from the GRNs around it, the names he ticked (the AI\'s) followed, a heading or a number for a material', () => {
  const R0 = [];
  for (let n = 1; n <= 12; n++) R0.push([n, n, 45800 + n, '', 'I' + n, '', '', 'Shree Traders', 'Item ' + String.fromCharCode(64 + n), 1, 'nos', 100, 100, 18, '', 118, '']);
  R0[5][2] = 38558 + 6;      // 2005 for 2025
  R0.push([13, 13, 45813, '', 'I13', '', '', 'Shree Traderss', 'Description', 1, 'nos', 10, 10, 0, '', 10, '']);
  R0.push([14, 14, 45814, '', 'I14', '', '', 'Shree Traderss', '45706', 1, 'nos', 10, 10, 0, '', 10, '']);
  const rows = RG.readRows(RG.pickSheet([regSheet(R0)]));
  let p = RG.plan(rows, {}, {}, '2026-10-28');
  assert.deepStrictEqual(p.look.map(l => [l.ref, l.why[0].replace(/ –.*/, '')]), [['6', 'GRN date 31-07-2005'], ['13', 'material "Description" is not a name'], ['14', 'material "45706" is not a name']]);
  p = RG.plan(rows, {}, { edit: { 10: { date: '2025-05-31' } }, fix: { party: { 'Shree Traderss': 'Shree Trader', 'Shree Trader': 'Shree Traders' } } }, '2026-10-28');
  assert.ok(!p.look.some(l => l.ref === '6'), 'the date he typed is his');
  assert.deepStrictEqual(p.newSup.map(s => s.name), ['Shree Traders'], 'a name ticked to a name ticked again: the last one');
});
test('register – the server checks each GRN again: its items in the Item Master, its amounts, its TCS; a mistake said with its GRN No', () => {
  const byKey = { cementopc53: { code: 'ITM-0001', name: 'Cement OPC 53' }, bindingwire: { code: 'ITM-0002', name: 'Binding Wire' } };
  const g = GI.checkDoc({ ref: '342-A', date: '2022-12-24', supplier: ' Shree  Traders ', invoice_no: 'A1', vehicle_no: 'mh 04 ab 1234', lines: [{ line: 5, item: 'CEMENT OPC-53', qty: 10, unit: 'bags', rate: 350, taxable: 3500, gst: 980, tcs: 4.5 },
    { line: 6, item: 'Binding Wire', qty: '25', unit: 'kgs', rate: 80, gst_pct: 18 }] }, byKey, '2026-10-28');
  assert.deepStrictEqual(g.head, { ref: '342-A', date: '2022-12-24', supplier: 'Shree Traders', challan_no: null, invoice_no: 'A1', invoice_date: null, vehicle_no: 'MH04AB1234', po_no: null, taxable: 5500, gst: 1340, tcs: 4.5, gross: 6844.5, remark: null });
  assert.deepStrictEqual(g.lines.map(l => [l.line, l.code, l.unit, l.qty, l.rate, l.taxable, l.gst_pct, l.gst, l.gross]), [[1, 'ITM-0001', 'Bag', 10, 350, 3500, 28, 980, 4480], [2, 'ITM-0002', 'Kg', 25, 80, 2000, 18, 360, 2360]]);
  assert.strictEqual(g.key, GI.docKey('342-A', '2022-12-24', 'Shree Traders', 'A1'));
  assert.throws(() => GI.checkDoc({ ref: '9', date: '2022-12-24', supplier: 'Om', lines: [{ item: 'Bolt', qty: 1 }] }, byKey, '2026-10-28'), /GRN 9 \(2022-12-24\), row 1: "Bolt" is not in the Item Master/);
  assert.throws(() => GI.checkDoc({ ref: '9', date: '2027-01-01', supplier: 'Om', lines: [{ item: 'Binding Wire', qty: 1 }] }, byKey, '2026-10-28'), /after today/);
  assert.throws(() => GI.checkDoc({ ref: '9', date: '2022-12-24', supplier: 'Om', lines: [{ item: 'Binding Wire', qty: 0 }] }, byKey, '2026-10-28'), /no quantity/);
});
test('register – the database step 3 only adds (a column, an index, a function); the GRN save keeps its number as its GRN No', () => {
  const sql = fs.readFileSync(path.join(root, 'sql', 'store_step3_grn_import.sql'), 'utf8').replace(/^--.*$/gm, '');
  assert.ok(!/\b(drop\s+table|truncate|drop\s+column)\b/i.test(sql) && !/delete\s+from\s+public\.(store_grn|items|vendors)\b/i.test(sql), 'nothing dropped or deleted');
  assert.ok(/add column if not exists ref text/.test(sql) && /grant execute on function public\.store_grn_import\(jsonb, text, text\) to service_role/.test(sql) && /revoke all on function public\.store_grn_import/.test(sql));
  assert.ok(/values \(v_no, v_no::text,/.test(sql), 'a new GRN: its GRN No is its number');
  assert.ok(/update public\.store_numbers set next_no = greatest\(next_no, v_max \+ 1\)/.test(sql), 'the next GRN goes on after the file\'s highest GRN No');
});

test('(28-10-2026) the assistant\'s Store look-ups: a report as the AI reads it (its columns by name, the words asked kept, short); the item named; only these look-ups, through the report (its access)', async () => {
  const AL = require('../lib/ailook'), R = require('../lib/sreport');
  assert.deepStrictEqual(AL.NAMES, ['store_stock', 'store_statement', 'store_item_ledger', 'store_inward', 'store_outward', 'store_consumption', 'store_returnable', 'store_requirements', 'store_purchase_orders']);
  const items = [{ code: 'I-1', name: 'Hydraulic Hose 1/2 inch', category: 'Spare Parts', unit: 'Nos', min_stock: 5, status: 'Active' }, { code: 'I-2', name: 'Engine Oil 15W40', category: 'Oil', unit: 'Ltr', min_stock: null, status: 'Active' }, { code: 'I-3', name: 'Hydraulic Oil 68', category: 'Oil', unit: 'Ltr', min_stock: null, status: 'Active' }];
  const st = R.stock(items, [{ code: 'I-1', qty: 2, in_qty: 10, in_value: 4500 }, { code: 'I-2', qty: 40, in_qty: 100, in_value: 30000 }], '2026-10-28', {});
  const t = AL.table(st);
  assert.deepStrictEqual([t.report, t.count, t.rows.find(r => r.Code === 'I-1'), t.total], ['Stock', 2, { Code: 'I-1', Item: 'Hydraulic Hose 1/2 inch', Category: 'Spare Parts', Unit: 'Nos', Stock: 2, 'Avg basic rate': 450, 'Value ₹': 900, 'Min stock': 5, Note: 'Below min' }, { Item: 'Total (2 items)', 'Value ₹': 12900 }]);
  const q = AL.table(st, 'engine oil');
  assert.deepStrictEqual([q.count, q.rows[0].Code, q.totalOfTheWholeReport['Value ₹'], q.total], [1, 'I-2', 12900, undefined], 'the words: only their rows – the total said to be of the whole report');
  // the look-ups run the Store's report (with its access) – a person without it gets its refusal; the item by part of its name
  const asked = [], h = { items: async () => Object.fromEntries(items.map(i => [i.code, i])), report: async (k, y) => { asked.push([k, y]); if (k === 'ledger') return R.stock(items, [], '2026-10-28', {}); return { title: 'T', sub: '', cols: [], rows: [] }; } };
  await AL.look({ name: 'store_item_ledger', args: { item: 'hose' } }, h);
  assert.deepStrictEqual(asked.pop(), ['ledger', { from: '', to: '', code: 'I-1' }]);
  await assert.rejects(AL.look({ name: 'store_item_ledger', args: { item: 'hydraulic' } }, h), /^Error: "hydraulic" fits 2 items \(Hydraulic Hose 1\/2 inch, Hydraulic Oil 68\) – say which one\.$/);
  await assert.rejects(AL.look({ name: 'store_item_ledger', args: { item: 'cement' } }, h), /is not an item of this site's Store\./);
  await assert.rejects(AL.look({ name: 'store_stock', args: { date: '28-10-2026' } }, h), /Give the date as yyyy-mm-dd\./);
  await assert.rejects(AL.look({ name: 'grnDelete', args: {} }, h), /There is no such look-up of the Store\./);
  await AL.look({ name: 'store_requirements', args: { status: 'DROP' } }, h); assert.deepStrictEqual(asked.pop(), ['req', { status: '', from: '', to: '' }]);
  await AL.look({ name: 'store_consumption', args: { by: 'machinery', from: '2026-10-01', to: '2026-10-28' } }, h); assert.deepStrictEqual(asked.pop(), ['consumption', { from: '2026-10-01', to: '2026-10-28', by: 'machinery' }]);
  const big = AL.table({ title: 'B', sub: '', cols: [{ h: 'X' }], rows: Array.from({ length: 80 }, () => ['x'.repeat(400)]) });
  assert.ok(JSON.stringify(big).length <= 14000 && big.count === 80 && /^Only the first \d+ of 80 rows/.test(big.note));
  // the action: read only, through the report
  const src = fs.readFileSync(path.join(root, 'api', 'work.js'), 'utf8');
  assert.match(src, /async aiLook\(s, x\) \{\n    try \{ return await AL\.look\(x \|\| \{\}, \{ report: \(kind, y\) => ACTIONS\.report\(s, Object\.assign\(\{\}, y, \{ kind: kind \}\)\), items: \(\) => itemsOf\(s\.site\) \}\); \}/);
});

test('(28-10-2026, his formats) the PO in the company\'s format: Disc. %, HSN, Credit Period, Site Contact, Shipping Address, Freight, Load / Unload, the terms line by line; the numbers RCL/VTR/PO/2026/0128; the amount in words; who approves a PO', () => {
  const W = require('../lib/work');
  const items = { 'ITM-0001': { code: 'ITM-0001', name: 'Diesel', unit: 'LTR', hsn: '27101910', gst_pct: 0, status: 'Active' }, 'ITM-0002': { code: 'ITM-0002', name: 'Tyre 11.00 R20', unit: 'NOS', hsn: '', gst_pct: 18, status: 'Active' } };
  // his Diesel PO: 2,300 L × 98.13, no discount, GST 0 → 2,25,699.00; the HSN from the Item Master
  let p = W.checkPo({ date: '2026-10-17', vendor: 'New Popular Service Station', credit_days: '0', site_contact: 'Site office : 9000000000', ship_to: 'VTR site office\nBhiwandi', terms: '1. Payment : 100 % Advance\n\n2. Delivery: Immediate',
    lines: [{ code: 'ITM-0001', qty: 2300, rate: 98.13, spec: 'H S Diesel' }] }, items);
  assert.deepStrictEqual([p.lines[0].taxable, p.lines[0].hsn, p.lines[0].disc_pct, p.disc, p.total, p.credit_days, p.ship_to, p.terms], [225699, '27101910', 0, 0, 225699, 0, 'VTR site office\nBhiwandi', '1. Payment : 100 % Advance\n2. Delivery: Immediate']);
  assert.strictEqual(W.inWords(p.total), 'Two Lakhs Twenty Five Thousand Six Hundred and Ninety Nine Only', 'as his PO says it');
  // a discount, GST, freight and load / unload: Amount = Qty × Rate less Disc. %; GST on it; TOTAL = lines + GST + freight + load
  p = W.checkPo({ date: '2026-10-27', vendor: 'Shree Sai Tyres', freight: '500', load_unload: '250', lines: [{ code: 'ITM-0002', qty: 4, rate: 24203.5, disc_pct: '2', hsn: '4011 10' }] }, items);
  assert.deepStrictEqual([p.lines[0].taxable, p.lines[0].disc, p.lines[0].gst, p.lines[0].hsn, p.freight, p.load_unload, p.total], [94877.72, 1936.28, 17077.99, '401110', 500, 250, 112705.71]);
  const bad = (x, re) => assert.throws(() => W.checkPo(Object.assign({ date: '2026-10-27', vendor: 'Shree Sai Tyres', lines: [{ code: 'ITM-0002', qty: 1, rate: 10 }] }, x), items), re);
  bad({ credit_days: '7.5' }, /^Error: The Credit Period must be whole days from 0 to 365\.$/);
  bad({ lines: [{ code: 'ITM-0002', qty: 1, rate: 10, disc_pct: 100 }] }, /Disc\. % of Tyre 11\.00 R20 "100" must be a number from 0 to 99\.99\./);
  bad({ lines: [{ code: 'ITM-0002', qty: 1, rate: 10, hsn: '40A' }] }, /HSN of Tyre 11\.00 R20 "40A" must be 4, 6 or 8 digits\./);
  bad({ freight: '-5' }, /Total Freight Charges cannot be below 0/);
  // a PO of before (none of the new fields): the same figures as before
  p = W.checkPo({ date: '2026-10-27', vendor: 'Shree Sai Tyres', terms: 'Payment against delivery', lines: [{ code: 'ITM-0002', qty: 2, rate: 100 }] }, items);
  assert.deepStrictEqual([p.taxable, p.gst, p.total, p.credit_days, p.site_contact, p.ship_to, p.freight, p.load_unload, p.terms], [200, 36, 236, null, null, null, 0, 0, 'Payment against delivery']);
  // the numbers of his papers
  assert.strictEqual(W.refOf('RCL/VTR', 'PO', '2026-10-17', 128), 'RCL/VTR/PO/2026/0128');
  assert.strictEqual(W.refOf('RCL/VTR/', 'PR', '2026-10-24', 232), 'RCL/VTR/PR/2026/0232');
  assert.strictEqual(W.initialsOf('Rachana Construction Limited'), 'RCL'); assert.strictEqual(W.initialsOf('Sketchline Industries'), 'SI');
  assert.strictEqual(W.inWords(141390), 'One Lakh Forty One Thousand Three Hundred and Ninety Only');
  assert.strictEqual(W.inWords(12345678.5), 'One Crore Twenty Three Lakhs Forty Five Thousand Six Hundred and Seventy Eight and Fifty Paise Only');
  // who approves a PO: the people the Portal told; never his own
  const people = W.poApprovers({ levels: [], po: [{ email: 'Ajinkya@X.test', name: 'Ajinkya' }, { email: '', name: 'x' }] });
  assert.deepStrictEqual(people, [{ email: 'ajinkya@x.test', name: 'Ajinkya' }]);
  assert.strictEqual(W.mayApprovePo(people, 'ajinkya@x.test', 'buyer@x.test'), true);
  assert.strictEqual(W.mayApprovePo(people, 'ajinkya@x.test', 'ajinkya@x.test'), false, 'not his own');
  assert.strictEqual(W.mayApprovePo(people, 'other@x.test', 'buyer@x.test'), false);
  assert.deepStrictEqual(W.poApprovers({ levels: [] }), [], 'a Portal of before (no po): nobody – a PO is approved when made');
  // step 5 only adds (no row changed, nothing dropped or deleted – but in its rollback note)
  const sql = fs.readFileSync(path.join(root, 'sql', 'store_step5_po_format.sql'), 'utf8'), code = sql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  assert.ok(!/\b(drop|truncate|delete\s+from|update\s+public\.store_po\s+set)\b/i.test(code.replace(/update public\.store_po set date = /, '')), 'nothing dropped, deleted or changed by the step itself');
  assert.strictEqual((code.match(/alter table public\.store_po add column if not exists /g) || []).length, 11);
  assert.match(code, /grant execute on function public\.store_po_put\(bigint, jsonb, text, text\) to service_role/);
  // the server: a PO not approved is not taken in; poDecide – only one who approves, never his own, only a PO waiting
  const src = fs.readFileSync(path.join(root, 'api', 'work.js'), 'utf8');
  assert.match(src, /if \(apprOf\(po\) !== 'Approved' && !\(cur && Number\(cur\.po_no\) === poNo\)\) throw fail\(409/);
  assert.match(src, /filter\(p => \(p\.state !== 'Received' && p\.appr === 'Approved'\) \|\| Number\(p\.no\) === ownPo\)/);      // (29-10-2026: a GRN being changed – its own PO too)
  assert.match(src, /'store_po\?no=eq\.' \+ no \+ '&status=eq\.Open&appr=eq\.Waiting'/);
});

test('(29-10-2026) a Store User makes an entry only of today – the Store Admin and the Super Admin any day; a changed requirement / PO keeps its own date; the page fixes his dates', () => {
  const { todayOnly } = require('../api/work.js'), W = require('../lib/work.js'), t = W.today();
  const back = n => { const d = new Date(t + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  const tryIt = f => { try { f(); return 'ok'; } catch (e) { return e; } };
  const USER = { admin: false, super: false }, ADMIN = { admin: true, super: false }, SUPER = { admin: false, super: true };
  assert.strictEqual(tryIt(() => todayOnly(USER, t, 'GRN')), 'ok', 'today');
  const e = tryIt(() => todayOnly(USER, back(1), 'GRN'));
  assert.strictEqual(e.status, 400); assert.strictEqual(e.code, 'date');
  assert.strictEqual(e.message, 'GRN of ' + W.dmy(back(1)) + ': a Store User enters only today\'s entries – an entry of an earlier day is made only by the Store Admin or the Super Admin. Ask the Store Admin.');
  for (const w of ['Requirement', 'Purchase order', 'Issue', 'Return']) assert.match(tryIt(() => todayOnly(USER, back(3), w)).message, new RegExp('^' + w + ' of '));
  assert.strictEqual(tryIt(() => todayOnly(ADMIN, back(30), 'GRN')), 'ok', 'the Store Admin');
  assert.strictEqual(tryIt(() => todayOnly(SUPER, back(30), 'GRN')), 'ok', 'the Super Admin');
  assert.strictEqual(tryIt(() => todayOnly(USER, back(2), 'Purchase order', back(2))), 'ok', 'a PO changed (sent back by its approval) keeps its own date');
  assert.strictEqual(tryIt(() => todayOnly(USER, back(3), 'Purchase order', back(2))).code, 'date', '…moved to another earlier day: refused');
  // every save of an entry checks it; the page gives a Store User today's date, fixed
  const src = fs.readFileSync(path.join(root, 'api', 'work.js'), 'utf8'), page = fs.readFileSync(path.join(root, 'public', 'work.js'), 'utf8');
  for (const c of ["todayOnly(s, r.date, 'Requirement', cur ? String(cur.date).slice(0, 10) : '');", "todayOnly(s, p.date, 'Purchase order', cur ? String(cur.date).slice(0, 10) : '');", "todayOnly(s, g.head.date, 'GRN');", "todayOnly(s, date, 'Issue');", "todayOnly(s, g.head.date, 'Return');"]) assert.ok(src.includes(c), c);
  assert.match(page, /const entryDate = \(\) => ' type="date"' \+ \(backOk\(\) \? '' : ' min="' \+ today\(\) \+ '" max="' \+ today\(\) \+ '" readonly/);
  for (const id of ['rq_date', 'pu_date', 'gr_date', 'is_date', 'rt_date']) assert.match(page, new RegExp("inp\\('" + id + "', [^)]*today\\(\\), entryDate\\(\\)\\)"), id);
});

test('(29-10-2026, the review) the rig\'s switch never on Vercel; a page left open past midnight reads its lists and "today" again', () => {
  const { todayOnly } = require('../api/work.js'), W = require('../lib/work.js'), t = W.today();
  const back = new Date(t + 'T00:00:00Z'); back.setUTCDate(back.getUTCDate() - 2); const d2 = back.toISOString().slice(0, 10);
  const was = [process.env.STORE_TODAY_RULE, process.env.VERCEL], put = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  try {
    put('STORE_TODAY_RULE', 'off'); put('VERCEL', undefined);
    assert.doesNotThrow(() => todayOnly({ admin: false, super: false }, d2, 'GRN'), 'the local rig: off');
    put('VERCEL', '1');
    assert.throws(() => todayOnly({ admin: false, super: false }, d2, 'GRN'), /a Store User enters only today's entries/, 'on Vercel: never off');
  } finally { put('STORE_TODAY_RULE', was[0]); put('VERCEL', was[1]); }
  const page = fs.readFileSync(path.join(root, 'public', 'work.js'), 'utf8');
  assert.match(page, /const today = \(\) => \(B && B\.today && B\._day === dayNow\(\) && B\.today\) \|\| dayNow\(\);/);
  assert.match(page, /async function boot\(force\) \{ if \(!B \|\| force \|\| B\._day !== dayNow\(\)\) \{ B = await W\('boot'\); B\._day = dayNow\(\); lists\(\); \} return B; \}/);
});

test('(29-10-2026, "bill madh discount … kadhi basic war … kadhi gst war") a GRN\'s discount on a line and on the whole bill, each on the Basic or after GST, % or ₹; the stock\'s net rate with both deducted; the page works it out as the server', () => {
  const G = (lines, x) => W.checkGrn(Object.assign({ date: back(0), supplier: 'AB Traders', lines: lines }, x || {}), ITEMS);
  const L1 = { code: 'ITM-0001', qty: 10, rate: 100, gst_pct: 18 }, L2 = { code: 'ITM-0002', qty: 30, rate: 100, gst_pct: 5 };
  const pick = l => [l.basic, l.disc, l.bill_disc, l.taxable, l.gst, l.gross, l.net_rate];
  // a line's 10% on its Basic: off the taxable, GST on what is left
  let g = G([Object.assign({}, L1, { disc: '10%' })]);
  assert.deepStrictEqual(pick(g.lines[0]), [1000, 100, 0, 900, 162, 1062, 90]);
  assert.deepStrictEqual([g.lines[0].disc_pct, g.lines[0].disc_on, g.head.basic, g.head.disc, g.head.gross], [10, 'basic', 1000, 100, 1062]);
  // a line's ₹500 after GST: the GST as billed, only what is paid less; its net rate (1000 − 500) ÷ 10
  g = G([Object.assign({}, L1, { disc: '500', disc_on: 'gst' })]);
  assert.deepStrictEqual(pick(g.lines[0]), [1000, 500, 0, 1000, 180, 680, 50]);
  assert.deepStrictEqual([g.lines[0].disc_pct, g.lines[0].disc_on], [null, 'gst']);
  // the bill's 10% on the Basic: shared by the lines' taxable (100 + 300), GST on each line's rest
  g = G([L1, L2], { bill_disc: '10%' });
  assert.deepStrictEqual(g.lines.map(pick), [[1000, 0, 100, 900, 162, 1062, 90], [3000, 0, 300, 2700, 135, 2835, 90]]);
  assert.deepStrictEqual([g.head.basic, g.head.disc, g.head.bill_disc, g.head.bill_disc_pct, g.head.bill_disc_on, g.head.taxable, g.head.gst, g.head.gross], [4000, 400, 400, 10, 'basic', 3600, 297, 3897]);
  // the bill's ₹100 after GST: shared by the lines' amounts (1180 : 3150), to the paisa – all of it
  g = G([L1, L2], { bill_disc: '₹ 100', bill_disc_on: 'gst' });
  assert.deepStrictEqual(g.lines.map(l => [l.bill_disc, l.gross, l.net_rate]), [[27.25, 1152.75, 97.275], [72.75, 3077.25, 97.575]]);
  assert.deepStrictEqual([g.head.taxable, g.head.gst, g.head.gross, g.head.disc, g.head.bill_disc_pct], [4000, 330, 4230, 100, null]);
  // no discount: every figure as before – the net rate IS the basic rate
  g = G([{ code: 'ITM-0001', qty: '2.345', rate: '12.37', gst_pct: 18 }]);      // (29.01 ÷ 2.345 would be 12.371 – the rate stays 12.37)
  assert.deepStrictEqual([g.lines[0].taxable, g.lines[0].disc, g.lines[0].bill_disc, g.lines[0].net_rate, g.lines[0].disc_on, g.head.disc, g.head.bill_disc_on], [29.01, 0, 0, 12.37, null, 0, null]);
  // what is refused
  throwsMsg(() => G([Object.assign({}, L1, { disc: '100%' })]), /must be below 100 %/);
  throwsMsg(() => G([Object.assign({}, L1, { disc: 'ten' })]), /is not a number \(e\.g\. 10% or 500\)/);
  throwsMsg(() => G([Object.assign({}, L1, { disc: '1500' })]), /is more than its Basic amount/);
  throwsMsg(() => G([L1], { bill_disc: '5000', bill_disc_on: 'gst' }), /The discount of the bill .* is more than its amount with GST/);
  // the page's money (public/work.js grnMoney) = the server's, case by case (a line's and the bill's, each kind)
  const page = fs.readFileSync(path.join(root, 'public', 'work.js'), 'utf8'), at = page.indexOf('  function grnMoney(rows, bill) {'), end = page.indexOf('  // (grnMoney:end)');
  assert.ok(at > 0 && end > at, 'grnMoney on the page');
  const grnMoney = new Function(page.slice(at, end) + '\nreturn grnMoney;')();
  const cases = [[[Object.assign({}, L1, { disc: '10%' })], {}], [[Object.assign({}, L1, { disc: '500', disc_on: 'gst' })], {}], [[L1, L2], { bill_disc: '10%' }], [[L1, L2], { bill_disc: '100', bill_disc_on: 'gst' }],
    [[Object.assign({}, L1, { disc: '5%' }), Object.assign({}, L2, { disc: '250', disc_on: 'gst' })], { bill_disc: '2%', bill_disc_on: 'gst' }], [[Object.assign({}, L1, { disc: '7.5%', disc_on: 'gst' }), { code: 'ITM-0002', qty: '7.25', rate: '12.35', gst_pct: 28 }], { bill_disc: '33.33' }]];
  for (const [ls, b] of cases) {
    const sv = G(ls, b), pg = grnMoney(ls, { disc: b.bill_disc, on: b.bill_disc_on });
    assert.deepStrictEqual([pg.basic, pg.disc, pg.bill_disc, pg.taxable, pg.gst, pg.gross], [sv.head.basic, sv.head.disc, sv.head.bill_disc, sv.head.taxable, sv.head.gst, W.r2(sv.head.gross - sv.head.tcs)], JSON.stringify(b));
    assert.deepStrictEqual(pg.lines.map(l => [l.basic, l.disc, l.bill_disc, l.taxable, l.gst, l.gross]), sv.lines.map(l => [l.basic, l.disc, l.bill_disc, l.taxable, l.gst, l.gross]), JSON.stringify(b));
  }
});

test('(29-10-2026) the GRN\'s discounts need the database\'s step 6 – it only adds; the form: a line\'s discount and the bill\'s, the PO\'s Qty / received before / shortage, the code in its own column; the register\'s new columns', () => {
  const sql = fs.readFileSync(path.join(root, 'sql', 'store_step6_grn_discount.sql'), 'utf8'), body = sql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  assert.ok(!/\bdrop\s+(table|column|function|view)\b|\btruncate\b/i.test(body), 'nothing dropped');
  assert.strictEqual((body.match(/alter table public\.store_grn(_lines)? add column if not exists /g) || []).length, 11);
  assert.match(body, /'GRN', g\.no, coalesce\(l\.net_rate, l\.rate\), 'GRN:' \|\| l\.id/);
  assert.strictEqual((body.match(/delete from public\.store_grn_lines where grn_no = v_no;/g) || []).length, 1, 'only the lines of the GRN being changed – as step 3');
  for (const f of ['store_grn_put(bigint, jsonb, jsonb, text, text)', 'store_grn_new(jsonb, jsonb, text, text, text)']) assert.ok(body.includes('grant execute on function public.' + f + ' to service_role;'), f);
  const step3 = fs.readFileSync(path.join(root, 'sql', 'store_step3_grn_import.sql'), 'utf8');
  assert.ok(step3.includes('delete from public.store_grn_lines where grn_no = v_no;'), 'the same as step 3');
  const src = fs.readFileSync(path.join(root, 'api', 'work.js'), 'utf8'), page = fs.readFileSync(path.join(root, 'public', 'work.js'), 'utf8');
  assert.match(src, /if \(\(g\.head\.disc > 0 \|\| g\.lines\.some\(l => l\.disc > 0\)\) && !\(await step6On\(s\.site\)\)\) throw fail\(400, STEP6, 'sql'\);/);
  assert.match(src, /return \{ next: next, step4: on, step6: s6 \};/);
  assert.match(src, /const rec = await receivedOf\(s\.site, pos\.map\(p => p\.no\), gno \|\| undefined\);/, 'a GRN changed: what came on its PO before it');
  // the form
  assert.match(page, /const s6 = !!\(nx && nx\.step6\);/);
  assert.ok(page.includes("{ k: 'disc', h: 'Disc. (% or ₹)', type: 'text', ph: '10% / 500' }, { k: 'disc_on', h: 'Disc. on', type: 'sel', opts: [['basic', 'Basic'], ['gst', 'After GST']] }"));
  for (const h of ["h: 'PO Qty'", "h: 'Received before'", "h: 'Shortage'"]) assert.ok(page.includes(h), h);
  assert.ok(page.includes("bill_disc: s6 && String(bill.disc).trim() ? String(bill.disc).trim() : undefined, bill_disc_on: s6 && String(bill.disc).trim() ? bill.on : undefined,"));
  assert.ok(page.includes("s6 && String(l.disc || '').trim() ? { disc: String(l.disc).trim(), disc_on: l.disc_on === 'gst' ? 'gst' : 'basic' } : {}"));
  assert.match(page, /disc: s6 && Number\(l\.disc_pct\) \? Number\(l\.disc_pct\) \+ '%' : ''/, "a PO line's Disc. % comes with it");
  assert.match(page, /codeCol \? \(bx \? '<td><div class="rob ic">'/, 'the code in its own column (every form)');
  // the register: his columns, then the code, the discount, the net rate
  const R = require('../lib/sreport.js');
  const reg = R.grnRegister([{ no: 5, ref: '5', date: back(0), supplier: 'AB', tcs: 0, lines: [{ line: 1, code: 'ITM-0001', name: 'Cement', qty: 10, unit: 'Bag', rate: 100, taxable: 900, gst: 162, gross: 1062, disc: 100, bill_disc: 0, net_rate: 90 }] }], back(1), back(0));
  assert.deepStrictEqual(reg.cols.slice(-4).map(c => c.h), ['PO No', 'Item Code', 'Discount ₹', 'Net Rate']);
  assert.deepStrictEqual(reg.rows[0].slice(-3), ['ITM-0001', 100, 90]);
});

test('(29-10-2026, "print war rachana address nahi site address nahi ani rachana logo nahiye") the requirement\'s paper as the PO\'s heading: the company\'s address and details, the Site Address; the print waits for its pictures; a papers\' box not sent keeps what it has', () => {
  const page = fs.readFileSync(path.join(root, 'public', 'work.js'), 'utf8'), src = fs.readFileSync(path.join(root, 'api', 'work.js'), 'utf8');
  const rp = page.slice(page.indexOf('  function reqPrint(x, h, ph) {'), page.indexOf('  function reqPrint(x, h, ph) {') + 4000);
  for (const k of ["(h.address ? '<div class=\"c\">' + nl(h.address) + '</div>' : '')", '<b>Email ID.</b>', '<b>GST No</b>', '<b>PAN No</b>', "'<tr><td>Site Address :</td><td colspan=\"3\">' + nl(h.site_address || '') + '</td></tr>'", 'logoOf(h)']) assert.ok(rp.includes(k), k);
  assert.match(page, /lim = Math\.min\(25000, 8000 \+ 2000 \* Math\.max\(0, imgs\.length - 1\)\);/, '(29-10-2026) 8 s, 2 s more a photo');
  assert.match(page, /const wait = \(\) => \(imgs\.every\(i => i\.complete\) \|\| Date\.now\(\) - t0 > lim\) \? setTimeout\(go, 150\) : setTimeout\(wait, 150\);/, 'the logo loaded before the print box');
  assert.ok(src.includes("'terms', 'site_address'];"));
  assert.ok(src.includes('if (x[k] === undefined && cur[k] !== undefined) { v[k] = cur[k]; return; }'));
  assert.ok(src.includes("site_address: pp.site_address || pp.ship_to || ''"), 'else the Shipping Address');
  assert.ok(page.includes("site_address: val('pp_saddr') });"));
});

test('(29-10-2026, "requirement madhe attachment … material photo … multiple photos … app madhun photo kadhla tri laptop web madhe yeil") a requirement\'s photos: step 7 only adds; the save takes a photo it has or one this person sent to this site (its proof), at most 10, each once; the page and the print', () => {
  const sql = fs.readFileSync(path.join(root, 'sql', 'store_step7_req_photos.sql'), 'utf8'), body = sql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  assert.ok(!/\bdrop\s+(table|column|function|view|policy|trigger)\b|\btruncate\b|\bdelete\s+from\b|\bupdate\s+(public|storage)\./i.test(body), 'nothing dropped, deleted or changed');
  assert.ok(body.includes("alter table public.store_req add column if not exists photos jsonb not null default '[]'::jsonb;"));
  assert.match(body, /on conflict \(id\) do nothing;/, "the bucket of Mechanical's step 1ze is kept as it is");
  assert.match(body, /values \('erp-files', 'erp-files', false,/, 'a bucket made here is private');
  const W = require('../api/work.js'), H = W._ph;
  process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'unit-test-key';
  const s = { site: 'S1', email: 'view@rcl.test', name: 'View User' }, h1 = 'a'.repeat(64), h2 = 'b'.repeat(64), h3 = 'c'.repeat(64);
  const mine = (h, n) => ({ sha: h, size: n, t: H.phTok('S1', 'view@rcl.test', h, n) });
  assert.strictEqual(H.phOf(s, undefined, []), null, 'no list sent (an older page): as they are');
  assert.deepStrictEqual(H.phOf(s, [], [{ sha: h1 }]), [], 'an empty list: none');
  const got = H.phOf(s, [mine(h1, 1000), mine(h2, 2000)], []);
  assert.deepStrictEqual(got.map(p => [p.sha, p.size, p.by]), [[h1, 1000, 'View User'], [h2, 2000, 'View User']]);
  const had = [{ sha: h3, size: 5, by: 'Store Keeper', at: '2026-10-28T10:00:00.000Z' }];
  assert.deepStrictEqual(H.phOf(s, [{ sha: h3 }], had), had, 'a photo it has: kept as it is (who, when) – no proof needed');
  const bad = (list, re, why) => assert.throws(() => H.phOf(s, list, had), e => re.test(e.message) && e.status === 400, why);
  bad([{ sha: h1, size: 1000, t: 'x'.repeat(40) }], /not added from this page/, 'a made-up proof');
  bad([{ sha: h1, size: 1000, t: H.phTok('S1', 'sujit@rcl.test', h1, 1000) }], /not added from this page \(or by you\)/, "another person's photo");
  bad([{ sha: h1, size: 1000, t: H.phTok('T2', 'view@rcl.test', h1, 1000) }], /not added/, "another site's");
  bad([{ sha: h1, size: 999, t: H.phTok('S1', 'view@rcl.test', h1, 1000) }], /not added/, 'its size changed');
  bad([mine(h1, 1), mine(h1, 1)], /twice/, 'the same photo twice');
  bad(Array.from({ length: 11 }, (_, i) => mine(String(i).padStart(64, 'd'), 1)), /at most 10 photos/, 'at most 10');
  bad([{ sha: 'zz', t: 'x' }], /not sent right/, 'not a fingerprint');
  assert.strictEqual(H.phPath(h1), 'store/req/aa/' + h1 + '.jpg');
  assert.deepStrictEqual(H.phList([{ sha: h1, size: '12', by: 'A' }, { sha: 'nope' }, null]), [{ sha: h1, size: 12, by: 'A', at: '' }], 'only proper ones');
  // the server: before step 7 a photo is refused with what to run; the upload only a real JPG of 2 MB at most
  const src = fs.readFileSync(path.join(root, 'api', 'work.js'), 'utf8');
  assert.ok(src.includes("if (!(await step7On(s.site))) { if (!Array.isArray(x.photos) || x.photos.length) throw fail(400, STEP7, 'sql'); }"), 'before step 7: a photo sent is refused with what to run (an empty list: as before)');
  assert.ok(src.includes("if (b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8 || b[2] !== 0xFF) throw fail(400, 'This file is not a real JPG photo – add a photo.', 'field');"));
  assert.ok(src.includes("const r = await files(s.site, 'POST', 'object/' + PH.bucket + '/' + phPath(sha), b, 'image/jpeg');"));
  assert.ok(src.includes("if (['Pending', 'Approved'].indexOf(cur.status) === -1) throw fail(409, 'Requirement ' + no + ' is ' + String(cur.status).toLowerCase() + ' – photos are added only while it waits or is approved.', 'decided');"));
  assert.ok(src.includes("const site = await siteFor(s, x), no = noOf(x.no);"), "another site's photos: HO Purchase only (siteFor)");
  const sites = fs.readFileSync(path.join(root, 'lib', 'sites.js'), 'utf8');
  assert.ok(sites.includes("const c = await conf(site); await guard(c);"), 'the file store: the same Preview guard as the database');
  // the page
  const page = fs.readFileSync(path.join(root, 'public', 'work.js'), 'utf8');
  for (const k of ["const sc = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight))", "'<label class=\"btn small phadd\">📷 Add photos<input type=\"file\" accept=\"image/*\" multiple hidden></label>'",
    "const photos = PB ? PB.get() : undefined;", "lines.map(l => ({ code: l.code, qty: l.qty, brand: l.brand, spec: l.spec, note: l.note })) }, photos: photos,",
    "const r = await W('reqPhotoAdd', { no: x.no, photos: sent });", "Photos of the material – ", "page-break-before:always", "W('reqPhotos', { site: ph.dataset.site, no: Number(ph.dataset.req) })"]) assert.ok(page.includes(k), k);
  // (the review) the live security rule lets a picture come from data: (not blob:) – the page reads a photo as data:
  const csp = (JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).headers || []).flatMap(h => h.headers || []).find(h => h.key === 'Content-Security-Policy').value;
  assert.match(csp, /img-src 'self' data: https:/);
  assert.ok(!/createObjectURL/.test(page), 'no blob: picture (refused by the live security rule)');
  assert.ok(page.includes('fr.readAsDataURL(file);'));
  // (the review) a Change keeps the photos added since its form opened; the print never waits on the file store; a day's limit
  assert.ok(src.includes('const knew = new Set(x.photosWas.map(h => String(h || \'\').toLowerCase())), more = phList(cur.photos).filter(p => !knew.has(p.sha) && !ph.some(q => q.sha === p.sha));'));
  assert.ok(page.includes("photosWas: PB && x ? (x.photos || []).map(p => p.sha) : undefined"));
  assert.ok(page.includes("toast('The photos could not be opened now (' + e.message + ') – printed without them.', true);"));
  assert.ok(src.includes("const PH = { bucket: 'erp-files', max: 10, raw: 2 * 1024 * 1024, day: 200 };"));
  assert.ok(src.includes("if (e && e.code !== 'notinstalled' && /42703|does not exist/.test(String(e.message))) return false; throw e;"), 'a step "not run" only when the column is missing');
  for (const k of ['step5', 'step6', 'step7']) assert.ok(src.includes("const " + k + "On = site => kept(site, '" + k + "', () => colOn(site, "), k);
  assert.ok(!/esc\(p\.by\) : ''\) \+ \(p\.at \? ' · ' \+ dmyAt/.test(page), 'a date put in escaped');
});

test('(29-10-2026, "jithe jithe type krun entry hotat … voice mick … hindi english marathi"; words and numbers) speak into a box: the page has voice.js; a number said in words → the number; the site lets its own pages use the microphone (nothing else)', () => {
  const V = require('../public/voice.js');
  const cases = [["12", "12"], ["12.5", "12.5"], ["१२.५", "12.5"], ["1,200", "1200"], ["₹500", "500"], ["twelve", "12"], ["twelve point five", "12.5"], ["zero point five", "0.5"], ["point two five", "0.25"], ["one hundred twenty", "120"], ["two thousand five hundred", "2500"], ["twenty five thousand", "25000"], ["two and a half", "2.5"], ["1 lakh 20 thousand", "120000"], ["a hundred", "100"], ["बारा", "12"], ["बारा पॉइंट पाच", "12.5"], ["बारा लिटर", "12"], ["लिटर बारा", "12"], ["साडे तीन हजार", "3500"], ["साडेतीन", "3.5"], ["साडेतीनशे", "350"], ["दीडशे", "150"], ["दोनशे", "200"], ["सव्वाशे", "125"], ["पावणे दोन", "1.75"], ["दीड हजार", "1500"], ["अडीच लाख", "250000"], ["एक लाख वीस हजार", "120000"], ["पंधरा हजार पाचशे", "15500"], ["एकशेवीस", "120"], ["शंभर", "100"], ["अर्धा", "0.5"], ["चौऱ्याहत्तर", "74"], ["नव्व्याण्णव", "99"], ["पंचाहत्तर बॅग", "75"], ["बारा पंधरा", "12"], ["दो सौ", "200"], ["डेढ़ सौ", "150"], ["ढाई हज़ार", "2500"], ["एक सौ बीस", "120"], ["साढ़े चार", "4.5"], ["सवा दो", "2.25"], ["पौने तीन", "2.75"], ["अड़तीस", "38"], ["पचहत्तर", "75"], ["दो करोड़ पचास लाख", "25000000"], ["निन्यानवे", "99"], ["पाँच", "5"], ["सात सौ पचास रुपये", "750"], ["cement", ""], ["", ""], ["twenty twenty", "20"], ["twenty five", "25"], ["12 kg", "12"], ["12kg", "12"], ["50 bag", "50"], ["three point one four", "3.14"], ["एक हजार दोनशे पन्नास", "1250"], ["दोन हजार", "2000"], ["शून्य", "0"], ["सहाशे", "600"], ["पाचशे पन्नास", "550"]];
  cases.forEach(([said, want]) => assert.strictEqual(V.toNumber(said), want, said));
  assert.strictEqual(V.toNumber('नऊ आठ दोन शून्य एक', 'digits'), '98201', 'a phone number said digit by digit');
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(page.includes('<script src="voice.js"></script>'), 'the page loads it');
  const pp = (JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8')).headers || []).flatMap(h => h.headers || []).find(h => h.key === 'Permissions-Policy').value;
  assert.strictEqual(pp, 'camera=(), microphone=(self), geolocation=()', 'the microphone for its own pages only; the camera and the place still off');
});
