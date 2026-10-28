/* THE ASSISTANT'S STORE LOOK-UPS (28-10-2026, "AI la app cha main brain" – Mechanical's Ask answers about the Store too).
 * Mechanical's page (and the phone app) passes a look-up's name and what the AI asked for (action aiLook of api/work.js); it is
 * answered here from the Store's own reports – ACTIONS.report, with every check of the person's Store access that the Stock &
 * Reports page has – and made SHORT for the AI: each row its columns by name, the words asked for kept, at most 80 rows, ~14,000
 * characters. It only READS. */
'use strict';
const MAX = 14000;
const userErr = m => { const e = new Error(m); e.user = true; return e; };
const day = (v, what) => { const s = String(v || '').trim(); if (!s) return ''; if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw userErr('Give the ' + what + ' as yyyy-mm-dd.'); return s; };
const per = a => ({ from: day(a.from, 'From date'), to: day(a.to, 'To date') });
const words = q => String(q || '').replace(/\s+/g, ' ').trim().slice(0, 80);
// the answer made to fit: while too long, its rows are halved – and it says so
function fit(o) {
  for (let i = 0; i < 12 && JSON.stringify(o).length > MAX && o.rows && o.rows.length > 1; i++) {
    o.rows = o.rows.slice(0, Math.floor(o.rows.length / 2)); o.note = 'Only the first ' + o.rows.length + ' of ' + o.count + ' rows are given here (the answer was too long).';
  }
  return o;
}
// a report of the Store ({ title, sub, cols: [{ h }], rows: [[…]], total }) as the AI reads it; q: only the rows that hold these words
function table(r, q, max) {
  const cols = (r.cols || []).map((c, i) => String(c.h || '').trim() || (i === r.cols.length - 1 ? 'Note' : 'Column ' + (i + 1)));
  const obj = row => { const o = {}; (row || []).forEach((v, i) => { if (v === '' || v === null || v === undefined) return; o[cols[i] || 'Column ' + (i + 1)] = v; }); return o; };
  let rows = (r.rows || []).map(obj); const w = words(q).toUpperCase();
  if (w) rows = rows.filter(o => w.split(' ').every(x => Object.values(o).some(v => String(v).toUpperCase().indexOf(x) > -1)));
  const out = { report: r.title, of: r.sub, words: words(q) || undefined, count: rows.length, rows: rows.slice(0, max || 80) };
  if (Array.isArray(r.total) && r.total.some(v => v !== '' && v !== null)) out[w ? 'totalOfTheWholeReport' : 'total'] = obj(r.total);
  if (rows.length > out.rows.length) out.note = 'Only the first ' + out.rows.length + ' of ' + rows.length + ' rows are given here.';
  return fit(out);
}
// an item the AI named: its code, its name, or the one item whose name holds the words
async function item(q, h) {
  const w = words(q); if (!w) throw userErr('Say which item.');
  const all = Object.values(await h.items()), U = w.toUpperCase();
  const same = all.find(i => String(i.code).toUpperCase() === U || String(i.name).toUpperCase() === U); if (same) return same;
  const hit = all.filter(i => U.split(' ').every(x => String(i.name).toUpperCase().indexOf(x) > -1));
  if (hit.length === 1) return hit[0];
  if (hit.length > 1) throw userErr('"' + w + '" fits ' + hit.length + ' items (' + hit.slice(0, 8).map(i => i.name).join(', ') + (hit.length > 8 ? ' …' : '') + ') – say which one.');
  throw userErr('"' + w + '" is not an item of this site\'s Store.');
}
const LOOK = {
  store_stock: async (a, h) => table(await h.report('stock', { date: day(a.date, 'date'), below: a.below_min === true }), a.query),
  store_statement: async (a, h) => table(await h.report('statement', per(a)), a.query),
  store_item_ledger: async (a, h) => { const it = await item(a.item, h); return table(await h.report('ledger', Object.assign(per(a), { code: it.code }))); },
  store_inward: async (a, h) => table(await h.report('grn', per(a)), a.query),
  store_outward: async (a, h) => table(await h.report('issue', per(a)), a.query),
  store_consumption: async (a, h) => table(await h.report('consumption', Object.assign(per(a), { by: ['party', 'machinery', 'use_for', 'location', 'item'].indexOf(a.by) > -1 ? a.by : 'item' })), a.query),
  store_returnable: async (a, h) => table(await h.report('returnable', {}), a.query),
  store_requirements: async (a, h) => table(await h.report('req', { status: ['Pending', 'Approved', 'Rejected', 'Cancelled', 'Closed', 'To order'].indexOf(a.status) > -1 ? a.status : '', from: day(a.from, 'From date'), to: day(a.to, 'To date') }), a.query),
  store_purchase_orders: async (a, h) => table(await h.report('po', { from: day(a.from, 'From date'), to: day(a.to, 'To date'), pending: a.pending === true }), a.query),
};
async function look(x, h) {
  const name = String(x.name || ''), a = x.args && typeof x.args === 'object' && !Array.isArray(x.args) ? x.args : {};
  if (!Object.prototype.hasOwnProperty.call(LOOK, name)) throw userErr('There is no such look-up of the Store.');
  return LOOK[name](a, h);
}
module.exports = { look, table, NAMES: Object.keys(LOOK) };
