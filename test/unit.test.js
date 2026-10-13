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
test('the page: its script parses; it signs in only through the Portal; Change site at the top of the dark menu; nothing else in the menu but Item Master', () => {
  const h = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach(m => new Function(m[1]));
  assert.ok(h.indexOf('id="site_chg"') > -1 && h.indexOf('id="site_chg"') < h.indexOf('<nav'), 'Change site above the pages');
  assert.strictEqual((h.slice(0, h.indexOf('<script>')).match(/class="navbtn"/g) || []).length, 1, 'one page now: Item Master'); assert.ok(!/type="password"/.test(h), 'no password box anywhere');
  assert.match(h, /\/api\/go\?module=store&site=/); assert.match(h, /'\/?signout=1'|\/\?signout=1/);
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
