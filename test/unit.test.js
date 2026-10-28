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
