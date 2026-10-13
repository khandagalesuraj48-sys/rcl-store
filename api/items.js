/* POST /api/items { action, … } – the Item Master of the site the person is signed in on (never another site's).
 * Add: Admin and User. Change, delete, import from Excel: the Store Admin (as the Portal gave). Everybody signed in sees the
 * list and can export it. Every save is checked again here, whatever the page did. */
'use strict';
const { handler, readBody, send, sameSite, fail } = require('../lib/http');
const ses = require('../lib/session');
const { db } = require('../lib/sites');
const { activity } = require('../lib/activity');
const I = require('../lib/items');
const enc = encodeURIComponent;

const all = site => db(site, 'GET', 'items?select=code,name,name_key,unit,category,hsn,gst_pct,min_stock,status,similar_note,created_by,updated_by,created_at,updated_at&order=code.asc&limit=100000').then(r => r || []);
const cats = list => [...new Set(list.map(x => x.category).filter(Boolean))].sort();
const brief = x => ({ code: x.code, name: x.name, unit: x.unit, category: x.category });
const userErr = e => { if (e && e.user) throw fail(400, e.message, 'field'); throw e; };
// the category as the list already writes it ("spare parts" → "Spare Parts" when that is there), and near ones
function catOf(cat, list) {
  const have = cats(list), same = have.find(c => c.toLowerCase() === cat.toLowerCase());
  return { category: same || cat, near: same ? [] : have.filter(c => I.near(cat, c)) };
}
// everything about one name before it is saved: the proper spelling suggested, an exact twin, near ones
function look(x, list, skip) {
  const p = I.properName(x.name, list.map(i => i.name)), key = I.keyOf(x.name);
  const exact = list.find(i => i.name_key === key && i.code !== skip) || null;
  return { proper: p, exact: exact ? brief(exact) : null, similar: exact ? [] : I.similar(x.name, list, skip), cat: catOf(I.properCategory(x.category), list) };
}

const ACTIONS = {
  async list(s) { const list = await all(s.site); return { items: list, units: I.UNITS, categories: cats(list), admin: s.admin }; },
  async check(s, x) { return look(x, await all(s.site), x.code ? String(x.code) : null); },
  async save(s, x) {
    const edit = !!x.code;
    if (edit && !s.admin) throw fail(403, 'Only the Store Admin can change an item.', 'admin');
    let it; try { it = I.check(x.item, { edit: edit }); } catch (e) { userErr(e); }
    const list = await all(s.site), cur = edit ? list.find(i => i.code === x.code) : null;
    if (edit && !cur) throw fail(404, 'This item is not in the list (it may have been deleted). Refresh the list.', 'gone');
    const L = look(it, list, edit ? cur.code : null);
    if (L.exact) throw fail(409, 'DUPLICATE – "' + L.exact.name + '" is already there (' + L.exact.code + '). Not saved.', 'exact', { exact: L.exact });
    const sure = Array.isArray(x.confirm) ? x.confirm.map(String) : [];
    const nameChanged = !edit || I.keyOf(cur.name) !== it.name_key;
    if (nameChanged && L.similar.length && !L.similar.every(y => sure.indexOf(y.code) > -1))
      throw fail(409, 'Please confirm: ' + L.similar.map(y => '"' + y.name + '" (' + y.code + ')').join(', ') + ' is already there – is "' + it.name + '" a different item?', 'similar', { similar: L.similar });
    if (L.cat.near.length && !x.confirmCat) throw fail(409, 'Please confirm the category: "' + L.cat.near.join('", "') + '" is already there – is "' + it.category + '" a different category?', 'cat', { categories: L.cat.near });
    it.category = L.cat.category;
    if (nameChanged && L.similar.length) it.similar_note = (it.name + ': not the same as ' + L.similar.map(y => y.code + ' ' + y.name).join(', ') + ' – said by ' + s.email + ' on ' + new Date().toISOString().slice(0, 10)).slice(0, 500);
    let out;
    try {
      if (edit) { it.updated_by = s.email; out = ((await db(s.site, 'PATCH', 'items?code=eq.' + enc(cur.code), it, 'return=representation')) || [])[0]; }
      else { it.created_by = s.email; out = ((await db(s.site, 'POST', 'items', [it], 'return=representation')) || [])[0]; }
    } catch (e) { if (e && e.code === 'duplicate') throw fail(409, 'DUPLICATE – an item with this name was just saved by someone else. Not saved.', 'exact'); throw e; }
    const what = edit ? ['name', 'unit', 'category', 'hsn', 'gst_pct', 'min_stock', 'status'].filter(k => String(cur[k] === null ? '' : cur[k]) !== String(it[k] === null ? '' : it[k])).map(k => k + ': ' + (cur[k] === null ? '' : cur[k]) + ' → ' + (it[k] === null ? '' : it[k])) : null;
    await activity(s.site, s.email, edit ? 'Item changed' : 'Item added', out.code + ' ' + out.name, edit ? { changes: what } : { item: it, similarConfirmed: sure.length ? sure : undefined });
    return { ok: true, item: out };
  },
  async remove(s, x) {
    if (!s.admin) throw fail(403, 'Only the Store Admin can delete an item.', 'admin');
    const cur = ((await db(s.site, 'GET', 'items?select=code,name,unit,category&code=eq.' + enc(String(x.code || '')))) || [])[0];
    if (!cur) throw fail(404, 'This item is not in the list (it may have been deleted). Refresh the list.', 'gone');
    await db(s.site, 'DELETE', 'items?code=eq.' + enc(cur.code), undefined, 'return=minimal');
    await activity(s.site, s.email, 'Item deleted', cur.code + ' ' + cur.name, { item: cur });
    return { ok: true };
  },
  /* IMPORT FROM EXCEL (Admin): rows: [{ line, name, unit, category, hsn, gst, minStock }]. Every row is looked at first:
   *   new      – added
   *   exists   – the same name is already there → left out (nothing changes)
   *   similar  – a near name is there (or above it in the file) → added only when ticked "different" (confirm: { line: [codes] })
   *   error    – a field is wrong, or the same name twice in the file → nothing is imported until it is corrected
   * check: true only reports. The import is ONE write: all of it or nothing. */
  async import(s, x) {
    if (!s.admin) throw fail(403, 'Only the Store Admin can import items.', 'admin');
    const rows = Array.isArray(x.rows) ? x.rows.slice(0, 3001) : [];
    if (!rows.length) throw fail(400, 'The file has no item rows.', 'field');
    if (rows.length > 3000) throw fail(400, 'At most 3000 items in one file.', 'field');
    const list = await all(s.site), confirm = x.confirm && typeof x.confirm === 'object' ? x.confirm : {};
    const inFile = [], out = [];
    rows.forEach((r, n) => {
      const line = Number(r && r.line) || n + 2, res = { line: line, name: String((r && r.name) || '').slice(0, 120) };
      try {
        const it = I.check({ name: r.name, unit: r.unit, category: r.category, hsn: r.hsn, gst: r.gst, minStock: r.minStock });
        res.item = it; res.name = it.name;
        const L = look(it, list, null);
        it.category = L.cat.category;
        const twin = inFile.find(y => y.item.name_key === it.name_key);
        if (twin) { res.status = 'error'; res.msg = 'The same name as line ' + twin.line + ' of the file.'; }
        else if (L.exact) { res.status = 'exists'; res.msg = 'Already there: ' + L.exact.code + ' ' + L.exact.name; }
        else {
          const near = L.similar.concat(inFile.filter(y => I.near(it.name, y.item.name)).map(y => ({ code: 'line ' + y.line, name: y.item.name, why: 'in this file' })));
          if (near.length) { res.status = 'similar'; res.similar = near; const ok = Array.isArray(confirm[line]) ? confirm[line].map(String) : []; res.confirmed = near.every(y => ok.indexOf(y.code) > -1); }
          else res.status = 'new';
          inFile.push(res);
        }
        if (res.status === 'new' && L.cat.near.length) res.catNote = 'Category "' + it.category + '" – near "' + L.cat.near.join('", "') + '"';
      } catch (e) { if (!(e && e.user)) throw e; res.status = 'error'; res.msg = e.message; }
      out.push(res);
    });
    const count = k => out.filter(r => r.status === k).length;
    const report = { rows: out.map(r => ({ line: r.line, name: r.name, status: r.status, msg: r.msg || '', similar: r.similar || [], confirmed: !!r.confirmed, catNote: r.catNote || '' })),
      fresh: count('new'), exists: count('exists'), similar: count('similar'), errors: count('error') };
    if (x.check) return report;
    if (report.errors) throw fail(400, report.errors + ' row(s) of the file have a mistake – correct them in the file and import again. Nothing was imported.', 'rows', { report: report });
    const take = out.filter(r => r.status === 'new' || (r.status === 'similar' && r.confirmed));
    const left = out.filter(r => r.status === 'similar' && !r.confirmed);
    if (left.length) throw fail(409, left.length + ' row(s) have a near name – tick each as a different item (or remove it from the file). Nothing was imported.', 'similar', { report: report });
    if (!take.length) return Object.assign(report, { ok: true, added: 0 });
    const day = new Date().toISOString().slice(0, 10);
    // (every row with the same fields – one write for all of them)
    const ins = take.map(r => Object.assign({}, r.item, { created_by: s.email, similar_note: r.status === 'similar' ? (r.item.name + ': not the same as ' + r.similar.map(y => y.code + ' ' + y.name).join(', ') + ' – said by ' + s.email + ' on ' + day + ' (import)').slice(0, 500) : null }));
    let added;
    try { added = (await db(s.site, 'POST', 'items', ins, 'return=representation')) || []; }
    catch (e) { if (e && e.code === 'duplicate') throw fail(409, 'DUPLICATE – an item of the file was saved by someone else meanwhile. Nothing was imported – check the file again.', 'exact'); throw e; }
    await activity(s.site, s.email, 'Items imported', added.length + ' items', { added: added.map(i => i.code + ' ' + i.name).slice(0, 300), leftOut: report.exists });
    return Object.assign(report, { ok: true, added: added.length });
  },
};

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
  sameSite(req);
  const s = await ses.need(req), x = await readBody(req), a = String(x.action || '');
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, a)) return send(res, 404, { error: 'Unknown action.' });
  try { send(res, 200, await ACTIONS[a](s, x)); }
  catch (e) { if (e && e.code === 'notinstalled') throw fail(500, 'The Store is not set up in the database of site ' + s.site + ' yet: run sql/store_step1_items.sql once in that site\'s Supabase → SQL Editor.', 'notinstalled'); throw e; }
});
