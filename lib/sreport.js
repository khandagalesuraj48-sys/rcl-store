/* THE STORE'S REPORTS – worked out from what the database gave (pure functions, tested on their own). Each report is one table:
 * { title, sub, cols: [{ h, n }], rows: [[…]], total } – the page shows it, prints it and gives its Excel; the phone app the same.
 * Columns follow his Store files (INWARD … GRN, OUTWORD, Steel / Tyre consumption, DAILY REPORT FILE). */
'use strict';
const W = require('./work');
const { r2, r3, dmy } = W;
const N = h => ({ h: h, n: true }), T = h => ({ h: h });
const num = v => v === null || v === undefined || v === '' ? 0 : Number(v);
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
const docName = { OPN: 'Opening', GRN: 'GRN', OUT: 'Outward', RET: 'Return' };

// STOCK on a date: every item with stock (or below its min stock); average basic rate and value
function stock(items, st, date, opt) {
  opt = opt || {};
  const by = new Map((st || []).map(r => [r.code, r]));
  const rows = [], tot = { value: 0 };
  items.slice().sort((a, b) => String(a.category).localeCompare(String(b.category)) || byName(a, b)).forEach(it => {
    if (opt.cat && it.category !== opt.cat) return;
    const r = by.get(it.code), q = r ? r3(num(r.qty)) : 0, avg = r && num(r.in_qty) > 0 ? num(r.in_value) / num(r.in_qty) : 0;
    const min = it.min_stock === null || it.min_stock === undefined ? null : Number(it.min_stock), below = min !== null && q < min;
    if (!q && !below && !opt.all) return;
    if (opt.below && !below) return;
    const value = r2(q * avg); tot.value = r2(tot.value + value);
    rows.push([it.code, it.name, it.category, it.unit, q, r2(avg), value, min === null ? '' : min, below ? 'Below min' : '']);
  });
  return { title: 'Stock', sub: 'As on ' + dmy(date), cols: [T('Code'), T('Item'), T('Category'), T('Unit'), N('Stock'), N('Avg basic rate'), N('Value ₹'), N('Min stock'), T('')],
    rows: rows, total: ['', 'Total (' + rows.length + ' items)', '', '', '', '', tot.value, '', ''] };
}

// STOCK STATEMENT of a period (a day, a month, any dates) – his daily report: opening, inward, return, issued, closing, rate, value
function statement(items, st, from, to) {
  const by = new Map((st || []).map(r => [r.code, r])), rows = [], t = { buy: 0, value: 0 };
  items.slice().sort((a, b) => String(a.category).localeCompare(String(b.category)) || byName(a, b)).forEach(it => {
    const r = by.get(it.code); if (!r) return;
    const o = r3(num(r.opening)), i = r3(num(r.inward)), ret = r3(num(r.returned)), out = r3(num(r.issued)), c = r3(num(r.closing));
    if (!o && !i && !ret && !out && !c) return;
    const avg = num(r.in_qty) > 0 ? num(r.in_value) / num(r.in_qty) : 0, value = r2(c * avg), buy = r2(num(r.buy_value));
    t.buy = r2(t.buy + buy); t.value = r2(t.value + value);
    rows.push([it.category, it.code, it.name, it.unit, o, i, ret, out, r3(out - ret), c, r2(avg), value, r3(num(r.buy_qty)), buy]);
  });
  return { title: 'Stock statement', sub: from === to ? dmy(from) : dmy(from) + ' to ' + dmy(to),
    cols: [T('Material type'), T('Code'), T('Material'), T('UOM'), N('Opening'), N('Inward'), N('Return'), N('Issued'), N('Consumed'), N('Closing'), N('Avg basic rate'), N('Stock amount ₹'), N('Purchase qty'), N('Purchase ₹')],
    rows: rows, total: ['', '', 'Total (' + rows.length + ' items)', '', '', '', '', '', '', '', '', t.value, '', t.buy] };
}

// ITEM LEDGER: every movement of one item in the dates, with its balance (the balance before the first date as the opening)
function ledger(it, moves, who, from, to, refs) {      // refs: a GRN's GRN No as shown (28-10-2026)
  const l = (moves || []).filter(m => m.code === it.code).sort((a, b) => a.date.localeCompare(b.date) || (num(b.q) - num(a.q)) || String(a.id).localeCompare(String(b.id)));
  let bal = 0; const rows = [];
  l.forEach(m => { if (m.date < from) bal = r3(bal + num(m.q)); });
  rows.push([dmy(from), 'Opening', '', '', '', bal, '']);
  let tin = 0, tout = 0;
  l.forEach(m => {
    if (m.date < from || m.date > to) return;
    const q = num(m.q); bal = r3(bal + q); if (q > 0) tin = r3(tin + q); else tout = r3(tout - q);
    rows.push([dmy(m.date), docName[m.kind] + (m.kind === 'OPN' ? '' : ' ' + ((refs && refs[m.kind + ':' + m.no]) || m.no)), (who && who[m.kind + ':' + m.no]) || '', q > 0 ? r3(q) : '', q < 0 ? r3(-q) : '', bal, m.rate === null || m.rate === undefined ? '' : r2(m.rate)]);
  });
  return { title: 'Item ledger – ' + it.code + ' ' + it.name, sub: dmy(from) + ' to ' + dmy(to) + ' · ' + it.unit,
    cols: [T('Date'), T('Paper'), T('From / to'), N('In'), N('Out'), N('Balance'), N('Rate')], rows: rows, total: ['', 'Total', '', tin, tout, bal, ''] };
}

// GRN REGISTER (his INWARD sheet): a row an item
/* (28-10-2026, "ji excel diley tech column GRN / inward madhe de") HIS INWARD REGISTER'S COLUMNS, in his order: Sr No · GRN No · GRN Date ·
 * Challan No · Invoice No. · Invoice Date · Vehicle No · Supplier Name · Material Description · Received Qty · UOM · Basic Rate · Taxable
 * Amount · GST Amount · TCS · Gross Amount · Remark (then the PO No of a GRN against a PO). The GRN No as shown (ref: "342-A" too – a
 * whole number as a number, as his file has it). (29-10-2026) After them: Item Code · Discount ₹ · Net Rate. */
const refOf = g => String(g.ref === null || g.ref === undefined || g.ref === '' ? g.no : g.ref);
const refCmp = (a, b) => { const x = refOf(a), y = refOf(b), nx = parseInt(x, 10), ny = parseInt(y, 10); return (isNaN(nx) || isNaN(ny) || nx === ny ? 0 : nx - ny) || x.localeCompare(y) || a.no - b.no; };
function grnRows(grns, from, to, opt) {
  opt = opt || {};
  return (grns || []).filter(g => g.date >= from && g.date <= to && (!opt.supplier || g.supplier === opt.supplier)).sort((a, b) => a.date.localeCompare(b.date) || refCmp(a, b));
}
function grnRegister(grns, from, to, opt) {
  opt = opt || {};
  const rows = [], t = { taxable: 0, gst: 0, tcs: 0, gross: 0, disc: 0 };
  let sr = 0;
  grnRows(grns, from, to, opt).forEach(g => {
    (g.lines || []).sort((a, b) => a.line - b.line).forEach((l, i) => {
      const tcs = i === 0 ? num(g.tcs) : 0, gross = r2(num(l.gross) + tcs);
      t.taxable = r2(t.taxable + num(l.taxable)); t.gst = r2(t.gst + num(l.gst)); t.tcs = r2(t.tcs + tcs); t.gross = r2(t.gross + gross);
      const disc = r2(num(l.disc) + num(l.bill_disc)); t.disc = r2(t.disc + disc);      // (29-10-2026) its discount (its own and its part of the bill's) and its net rate
      rows.push([++sr, /^\d{1,15}$/.test(refOf(g)) ? Number(refOf(g)) : refOf(g), dmy(g.date), g.challan_no || '', g.invoice_no || '', dmy(g.invoice_date), g.vehicle_no || '', g.supplier, l.name, num(l.qty), l.unit, num(l.rate), num(l.taxable), num(l.gst), tcs || '', gross, l.remark || g.remark || '', g.po_no || '',
        l.code || '', disc || '', l.net_rate !== null && l.net_rate !== undefined && l.net_rate !== '' ? num(l.net_rate) : num(l.rate)]);
    });
  });
  return { title: 'Inward (GRN) register', sub: dmy(from) + ' to ' + dmy(to) + (opt.supplier ? ' · ' + opt.supplier : ''),
    cols: [N('Sr No'), T('GRN No'), T('GRN Date'), T('Challan No'), T('Invoice No.'), T('Invoice Date'), T('Vehicle No'), T('Supplier Name'), T('Material Description'), N('Received Qty'), T('UOM'), N('Basic Rate'), N('Taxable Amount'), N('GST Amount'), N('TCS'), N('Gross Amount'), T('Remark'), N('PO No'),
      T('Item Code'), N('Discount ₹'), N('Net Rate')],      // (29-10-2026) after his columns: the item's code, the discount, the net rate (the stock's)
    rows: rows, total: ['', '', '', '', '', '', '', '', 'Total', '', '', '', t.taxable, t.gst, t.tcs, t.gross, '', '', '', t.disc || '', ''] };
}

// ISSUE REGISTER (his OUTWORD sheet): a row an item; filters: whom (kind), the party, the machinery, an item, the location
function issueRegister(issues, back, from, to, opt) {
  opt = opt || {};
  const rows = [], t = { amount: 0 };
  issueRows(issues, from, to, opt).forEach(({ i, l }) => {
    const amt = r2(num(l.amount) + num(l.gst)); t.amount = r2(t.amount + amt);
    rows.push([dmy(i.date), i.no, i.to_kind, i.party || (i.to_kind === 'Site work' ? 'RCL' : ''), l.name, num(l.qty), l.unit, num(l.rate), amt, i.machinery || '', i.reading === null || i.reading === undefined ? '' : num(i.reading),
      i.location || '', i.side || '', i.use_for || '', i.receiver || '', l.returnable ? 'Yes' : '', (back && back[l.id]) ? r3(back[l.id]) : '', l.serial || '', i.debit ? 'Debit' : '', l.remark || i.remark || '']);
  });
  return { title: 'Issue (Outward) register', sub: dmy(from) + ' to ' + dmy(to) + subOf(opt),
    cols: [T('Date'), N('Outward No'), T('Issued to'), T('Party / Sub-contractor'), T('Material'), N('Qty'), T('UOM'), N('Rate'), N('Amount ₹'), T('Machinery'), N('Reading'), T('Location'), T('Side'), T('Use for'), T('Receiver'), T('Returnable'), N('Returned'), T('Serial No'), T('Debit'), T('Remark')],
    rows: rows, total: ['', '', '', '', 'Total', '', '', '', t.amount, '', '', '', '', '', '', '', '', '', '', ''] };
}
const subOf = opt => (opt.kind ? ' · ' + opt.kind : '') + (opt.party ? ' · ' + opt.party : '') + (opt.machinery ? ' · ' + opt.machinery : '') + (opt.item ? ' · ' + opt.itemName : '') + (opt.location ? ' · ' + opt.location : '');
function issueRows(issues, from, to, opt) {
  const out = [], loc = String(opt.location || '').toLowerCase();
  (issues || []).filter(i => i.date >= from && i.date <= to && (!opt.kind || i.to_kind === opt.kind) && (!opt.party || i.party === opt.party) && (!opt.machinery || i.machinery === opt.machinery)
    && (!loc || String(i.location || '').toLowerCase().indexOf(loc) > -1)).sort((a, b) => a.date.localeCompare(b.date) || a.no - b.no)
    .forEach(i => (i.lines || []).slice().sort((a, b) => a.line - b.line).forEach(l => { if (!opt.item || l.code === opt.item) out.push({ i: i, l: l }); }));
  return out;
}

// CONSUMPTION by sub-contractor / machinery / use for / location / item: the quantity and value of each item (returns taken off)
const GROUPS = { party: 'Party / Sub-contractor', machinery: 'Machinery', use_for: 'Use for', location: 'Location', item: 'Item' };
function consumption(issues, back, from, to, by, opt) {
  by = GROUPS[by] ? by : 'party'; opt = opt || {};
  const g = new Map();
  issueRows(issues, from, to, opt).forEach(({ i, l }) => {
    const key = by === 'item' ? '' : (by === 'party' ? (i.party || (i.to_kind === 'Site work' ? 'RCL' : i.to_kind)) : (i[by] || '–'));
    const k = key + '\u0000' + l.code, rate = num(l.rate), q = r3(num(l.qty) - num(back && back[l.id]));
    const x = g.get(k) || { key: key, name: l.name, unit: l.unit, qty: 0, value: 0 };
    x.qty = r3(x.qty + q); x.value = r2(x.value + q * rate); g.set(k, x);
  });
  const rows = [], t = { value: 0 };
  [...g.values()].sort((a, b) => a.key.localeCompare(b.key) || a.name.localeCompare(b.name)).forEach(x => { t.value = r2(t.value + x.value); rows.push(by === 'item' ? [x.name, x.unit, x.qty, x.value] : [x.key, x.name, x.unit, x.qty, x.value]); });
  const cols = by === 'item' ? [T('Material'), T('UOM'), N('Consumed'), N('Value ₹')] : [T(GROUPS[by]), T('Material'), T('UOM'), N('Consumed'), N('Value ₹')];
  return { title: 'Consumption by ' + GROUPS[by].toLowerCase(), sub: dmy(from) + ' to ' + dmy(to) + subOf(opt), cols: cols, rows: rows,
    total: by === 'item' ? ['Total', '', '', t.value] : ['Total', '', '', '', t.value] };
}

// RETURNABLE items still out (issued returnable − returned)
function returnable(issues, back, opt) {
  opt = opt || {};
  const rows = [];
  (issues || []).filter(i => !opt.party || i.party === opt.party).sort((a, b) => a.date.localeCompare(b.date) || a.no - b.no).forEach(i => (i.lines || []).forEach(l => {
    if (!l.returnable) return;
    const b = r3(num(back && back[l.id])), left = r3(num(l.qty) - b); if (left <= 0.0005) return;
    rows.push([dmy(i.date), i.no, i.party || (i.to_kind === 'Site work' ? 'RCL' : i.to_kind), l.name, l.unit, num(l.qty), b, left, i.location || '', i.receiver || '', l.serial || '']);
  }));
  return { title: 'Returnable items not returned', sub: opt.party || 'Every party', cols: [T('Date'), N('Outward No'), T('Party'), T('Material'), T('UOM'), N('Issued'), N('Returned'), N('Still out'), T('Location'), T('Receiver'), T('Serial No')], rows: rows, total: null };
}

// REQUIREMENTS – each item: asked, ordered (POs not cancelled), still to order; the state and the level it waits for
function requirements(reqs, ordered, opt) {
  opt = opt || {};
  const rows = [];
  (reqs || []).filter(r => (!opt.status || r.status === opt.status || (opt.status === 'To order' && r.status === 'Approved')) && (!opt.from || r.date >= opt.from) && (!opt.to || r.date <= opt.to))
    .sort((a, b) => a.date.localeCompare(b.date) || a.no - b.no).forEach(r => (r.lines || []).forEach(l => {
      const o = r3(num(ordered && ordered[r.no + ':' + l.line])), left = r.status === 'Approved' ? Math.max(0, r3(num(l.qty) - o)) : 0;
      if (opt.status === 'To order' && left <= 0.0005) return;
      rows.push([r.no, dmy(r.date), dmy(r.need_by), r.for_kind + (r.for_text ? ' – ' + r.for_text : ''), l.name, l.brand || '', l.spec || '', l.unit, num(l.qty), o || '', left || '', r.status + (r.status === 'Pending' && r.level ? ' (level ' + r.level + ')' : ''), r.created_name || r.created_by || '']);
    }));
  return { title: 'Material requirements' + (opt.status ? ' – ' + opt.status : ''), sub: opt.from ? dmy(opt.from) + ' to ' + dmy(opt.to) : 'All dates',
    cols: [N('Req No'), T('Date'), T('Needed by'), T('For'), T('Material'), T('Brand'), T('Material specification'), T('UOM'), N('Asked'), N('Ordered'), N('To order'), T('State'), T('Asked by')], rows: rows, total: null };
}

// PURCHASE ORDERS – each item: ordered, received (GRN), still to come
function purchaseOrders(pos, received, opt) {
  opt = opt || {};
  const rows = [], t = { total: 0 };
  (pos || []).filter(p => (!opt.from || p.date >= opt.from) && (!opt.to || p.date <= opt.to) && (!opt.vendor || p.vendor === opt.vendor)).sort((a, b) => a.date.localeCompare(b.date) || a.no - b.no).forEach(p => (p.lines || []).forEach(l => {
    const rc = r3(num(received && received[p.no + ':' + l.line])), left = p.status === 'Open' ? Math.max(0, r3(num(l.qty) - rc)) : 0;
    if (opt.pending && left <= 0.0005) return;
    t.total = r2(t.total + num(l.total));
    rows.push([p.no, dmy(p.date), p.vendor, l.name, l.brand || '', l.spec || '', l.unit, num(l.qty), num(l.rate), num(l.gst_pct), num(l.total), rc || '', left || '', p.status, l.req_no || '', (p.site || '')]);
  }));
  return { title: 'Purchase orders' + (opt.pending ? ' – to come' : ''), sub: opt.from ? dmy(opt.from) + ' to ' + dmy(opt.to) : 'All dates',
    cols: [N('PO No'), T('Date'), T('Vendor'), T('Material'), T('Brand'), T('Material specification'), T('UOM'), N('Ordered'), N('Rate'), N('GST %'), N('Total ₹'), N('Received'), N('To come'), T('State'), N('Req No'), T('Site')], rows: rows,
    total: ['', '', '', 'Total', '', '', '', '', '', '', t.total, '', '', '', '', ''] };
}

module.exports = { refOf, refCmp, grnRows,  stock, statement, ledger, grnRegister, issueRegister, consumption, returnable, requirements, purchaseOrders, GROUPS };
