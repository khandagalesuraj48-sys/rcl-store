/* THE STORE'S WORK – the rules of every paper (pure functions: no database here, so they are tested on their own).
 * Asked 13-10-2026 / 28-10-2026 ("sagle banwayla chalu kr"): Material Requirement → its approvals (levels the Super Admin gives in
 * the Portal) → Purchase Order (HO Purchase, for every site) → Inward (GRN, with its bill) → stock → Issue (Outward: site work /
 * location, sub-contractor, machinery – into its maintenance log book –, returnable) → Return; reports material / day / month /
 * period wise; Excel in and out. His six Store Excel files are the formats (columns), not data to load.
 * Every save is checked here again, whatever the page or the phone did. */
'use strict';
const I = require('./items');
const clean = I.clean;
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const r3 = n => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);      // (India time)
const err = m => { const e = new Error(m); e.user = true; throw e; };
const dmy = s => s ? String(s).slice(0, 10).split('-').reverse().join('-') : '';

/* ---------- the fields ---------- */
// a date: yyyy-mm-dd (dd-mm-yyyy and dd/mm/yyyy are taken too); not after today unless "future"
function dayOf(v, what, opt) {
  opt = opt || {};
  let s = clean(v, 20);
  if (!s) { if (opt.optional) return null; err('Enter the ' + what + '.'); }
  let m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) s = m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const ok = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString().slice(0, 10) === m[0];
  if (!ok) err('The ' + what + ' "' + clean(v, 20) + '" is not a date (dd-mm-yyyy).');
  s = m[0];
  if (s < '2000-01-01') err('The ' + what + ' ' + dmy(s) + ' is too old.');
  if (!opt.future && s > today()) err('The ' + what + ' ' + dmy(s) + ' is after today.');
  return s;
}
function numOf(v, what, opt) {
  opt = opt || {};
  const s = clean(v === undefined || v === null ? '' : String(v), 30).replace(/,/g, '').replace(/^₹\s*/, '');
  if (s === '') { if (opt.blank !== undefined) return opt.blank; err('Enter the ' + what + '.'); }
  const n = Number(s);
  if (!isFinite(n)) err('The ' + what + ' "' + s + '" is not a number.');
  if (opt.pos && n <= 0) err('The ' + what + ' must be more than 0.');
  if (n < 0) err('The ' + what + ' cannot be below 0.');
  if (n > (opt.max || 1e10)) err('The ' + what + ' ' + s + ' is too big.');
  return n;
}
const qtyOf = (v, what) => r3(numOf(v, what || 'quantity', { pos: true, max: 1e9 }));
const rateOf = (v, what) => r2(numOf(v, what || 'rate', { blank: 0, max: 1e9 }));
function pctOf(v, dflt) {
  const s = clean(v === undefined || v === null ? '' : String(v), 10).replace(/%$/, '');
  if (s === '') return dflt === undefined ? null : dflt;
  const n = Number(s);
  if (!isFinite(n) || n < 0 || n > 40) err('GST % "' + s + '" must be a number from 0 to 40 (e.g. 5 or 18).');
  return n;
}
const text = (v, n) => clean(v, n || 200) || null;
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const vehicleOf = v => { const s = clean(v, 20).toUpperCase().replace(/\s+/g, ''); return s || null; };

/* ---------- a name of a party (supplier, vendor, sub-contractor): written once, the same way ----------
 * The same name with other capitals / spaces / signs → the name as it is already written. A near name ("Surj" when "Suraj" is
 * there) is asked first – "is it the same?" (the same rule as the Item Master's). */
function partyOf(name, known, confirmNew) {
  const n = clean(name, 80);
  if (I.keyOf(n).length < 2) return { name: '', near: [] };
  const k = I.keyOf(n), list = [...new Set((known || []).map(x => clean(x, 80)).filter(Boolean))];
  const same = list.find(x => I.keyOf(x) === k);
  if (same) return { name: same, near: [] };
  const near = confirmNew ? [] : list.filter(x => I.near(n, x)).slice(0, 5);
  return { name: n, near: near };
}

/* ---------- the lines of a paper ---------- */
// each line's item from the site's Item Master; an Inactive item only on a paper that had it already
function itemOf(code, items, had) {
  const it = items[String(code || '')];
  if (!it) err('Item "' + clean(code, 20) + '" is not in the Item Master of this site – pick it from the list.');
  if (it.status === 'Inactive' && !(had && had.has(it.code))) err(it.code + ' ' + it.name + ' is Inactive in the Item Master – switch it on there first.');
  return it;
}
function linesOf(x, what, max) {
  const l = Array.isArray(x) ? x.filter(y => y && (clean(y.code) || clean(y.qty))) : [];
  if (!l.length) err('Add at least one item to the ' + what + '.');
  if (l.length > (max || 200)) err('At most ' + (max || 200) + ' items in one ' + what + '.');
  return l;
}
const twice = (out, it, n) => { const t = out.find(y => y.code === it.code); if (t) err(it.name + ' is twice in the list (lines ' + t.line + ' and ' + n + ') – put it once, with the whole quantity.'); };

const FOR_KINDS = ['Site work', 'Machinery', 'Office', 'Other'];
const TO_KINDS = ['Site work', 'Sub-contractor', 'Machinery', 'Office'];
const SIDES = ['LHS', 'RHS', 'Both'];

/* MATERIAL REQUIREMENT: date, needed by, for what (site work / a machinery / office / other – and which), the items and their
 * quantities. */
function checkReq(x, items, opt) {
  x = x || {}; opt = opt || {};
  const date = dayOf(x.date, 'date'), need = dayOf(x.need_by, 'needed-by date', { optional: true, future: true });
  if (need && need < date) err('The needed-by date ' + dmy(need) + ' is before the date ' + dmy(date) + '.');
  const kind = FOR_KINDS.find(k => k.toLowerCase() === clean(x.for_kind).toLowerCase());
  if (!kind) err('Pick what it is for (' + FOR_KINDS.join(', ') + ').');
  const forText = text(x.for_text, 120);
  if (kind === 'Machinery' && !forText) err('Pick the machinery it is for.');
  if (kind === 'Machinery' && opt.machinery && !opt.machinery.some(m => m.no === forText)) err('Machinery "' + forText + '" is not in the Asset Master of this site.');
  const out = [];
  linesOf(x.lines, 'requirement', 100).forEach((y, i) => {
    const it = itemOf(y.code, items, opt.had); twice(out, it, i + 1);
    out.push({ line: i + 1, code: it.code, name: it.name, unit: it.unit, qty: qtyOf(y.qty, 'quantity of ' + it.name), note: text(y.note, 120) });
  });
  return { date: date, need_by: need, for_kind: kind, for_text: forText, remark: text(x.remark, 300), lines: out };
}

/* PURCHASE ORDER (HO Purchase, for one site): date, vendor (+ GST no.), deliver by, terms; each item its quantity, rate, GST %.
 * A line of a requirement keeps its requirement and line (never more than asked – checked again in the database). */
function checkPo(x, items, opt) {
  x = x || {}; opt = opt || {};
  const date = dayOf(x.date, 'PO date'), deliver = dayOf(x.deliver_by, 'delivery date', { optional: true, future: true });
  if (deliver && deliver < date) err('The delivery date ' + dmy(deliver) + ' is before the PO date ' + dmy(date) + '.');
  const vendor = clean(x.vendor, 80); if (I.keyOf(vendor).length < 2) err('Enter the vendor (supplier).');
  const gstNo = clean(x.vendor_gst, 15).toUpperCase().replace(/\s+/g, '');
  if (gstNo && !GSTIN.test(gstNo)) err('The vendor\'s GST no. "' + gstNo + '" is not a proper GSTIN (15 letters and digits).');
  const reqs = opt.reqs || {}, out = [];
  linesOf(x.lines, 'PO', 200).forEach((y, i) => {
    const it = itemOf(y.code, items, opt.had);
    const qty = qtyOf(y.qty, 'quantity of ' + it.name), rate = r2(numOf(y.rate, 'rate of ' + it.name, { pos: true, max: 1e9 }));
    const pct = pctOf(y.gst_pct, it.gst_pct === null || it.gst_pct === undefined ? 0 : Number(it.gst_pct));
    let rn = null, rl = null;
    if (y.req_no !== undefined && y.req_no !== null && y.req_no !== '') {
      rn = Number(y.req_no); rl = Number(y.req_line);
      const rq = reqs[rn], rline = rq && (rq.lines || []).find(l => Number(l.line) === rl);
      if (!rq || !rline) err('Requirement ' + y.req_no + ' (line ' + y.req_line + ') is not there any more – refresh.');
      if (rline.code !== it.code) err('Line ' + (i + 1) + ': requirement ' + rn + ' line ' + rl + ' is for ' + rline.name + ', not ' + it.name + '.');
    }
    if (rn === null) twice(out.filter(z => z.req_no === null), it, i + 1);
    const taxable = r2(qty * rate), gst = r2(taxable * pct / 100);
    out.push({ line: i + 1, code: it.code, name: it.name, unit: it.unit, qty: qty, rate: rate, gst_pct: pct, taxable: taxable, gst: gst, total: r2(taxable + gst), req_no: rn, req_line: rl });
  });
  const sum = k => r2(out.reduce((s, l) => s + l[k], 0));
  return { date: date, vendor: vendor, vendor_gst: gstNo || null, deliver_by: deliver, terms: text(x.terms, 500), remark: text(x.remark, 300), lines: out, taxable: sum('taxable'), gst: sum('gst'), total: sum('total') };
}

/* INWARD (GRN): date, supplier, challan no., invoice no. and date, vehicle no., its PO (if any); each item its quantity, basic
 * rate, GST %; the bill's TCS. Taxable = qty × rate; GST on it; Gross = taxable + GST (+ TCS on the bill). */
function checkGrn(x, items, opt) {
  x = x || {}; opt = opt || {};
  const date = dayOf(x.date, 'GRN date'), inv = dayOf(x.invoice_date, 'invoice date', { optional: true });
  const supplier = clean(x.supplier, 80); if (I.keyOf(supplier).length < 2) err('Enter the supplier.');
  const po = opt.po || null, out = [];
  linesOf(x.lines, 'GRN', 200).forEach((y, i) => {
    const it = itemOf(y.code, items, opt.had);
    const qty = qtyOf(y.qty, 'received quantity of ' + it.name), rate = rateOf(y.rate, 'basic rate of ' + it.name);
    const pct = pctOf(y.gst_pct, it.gst_pct === null || it.gst_pct === undefined ? 0 : Number(it.gst_pct));
    let pl = null;
    if (po && y.po_line !== undefined && y.po_line !== null && y.po_line !== '') {
      pl = Number(y.po_line); const l = (po.lines || []).find(z => Number(z.line) === pl);
      if (!l) err('Line ' + (i + 1) + ': PO ' + po.no + ' has no line ' + y.po_line + '.');
      if (l.code !== it.code) err('Line ' + (i + 1) + ': PO ' + po.no + ' line ' + pl + ' is for ' + l.name + ', not ' + it.name + '.');
    }
    if (pl === null) twice(out.filter(z => z.po_line === null), it, i + 1);
    const taxable = r2(qty * rate), gst = r2(taxable * pct / 100);
    out.push({ line: i + 1, code: it.code, name: it.name, unit: it.unit, qty: qty, rate: rate, taxable: taxable, gst_pct: pct, gst: gst, gross: r2(taxable + gst), po_line: pl, remark: text(y.remark, 120) });
  });
  const tcs = r2(numOf(x.tcs, 'TCS', { blank: 0, max: 1e9 })), sum = k => r2(out.reduce((s, l) => s + l[k], 0));
  return { head: { date: date, supplier: supplier, challan_no: text(x.challan_no, 40), invoice_no: text(x.invoice_no, 40), invoice_date: inv, vehicle_no: vehicleOf(x.vehicle_no),
    po_no: po ? po.no : null, taxable: sum('taxable'), gst: sum('gst'), tcs: tcs, gross: r2(sum('gross') + tcs), remark: text(x.remark, 300) }, lines: out };
}

/* ISSUE (OUTWARD): date; to site work (RCL's own work) / a sub-contractor / a machinery / office; the location (chainage), the
 * side, what it is used for, who received it; each item its quantity, returnable or not, its serial no. (a tyre, a battery).
 * Its value: the item's average basic rate on that date (rates of the inward up to then). On DEBIT (to a sub-contractor or a
 * machinery's owner) a rate can be typed and GST is added. */
function checkIssue(x, items, opt) {
  x = x || {}; opt = opt || {};
  const date = dayOf(x.date, 'issue date');
  const kind = TO_KINDS.find(k => k.toLowerCase() === clean(x.to_kind).toLowerCase());
  if (!kind) err('Pick whom it is issued to (' + TO_KINDS.join(', ') + ').');
  const party = clean(x.party, 80), mach = clean(x.machinery, 30);
  if (kind === 'Sub-contractor' && I.keyOf(party).length < 2) err('Enter the sub-contractor.');
  let machine = null;
  if (kind === 'Machinery') {
    if (!mach) err('Pick the machinery.');
    machine = (opt.machinery || []).find(m => m.no === mach) || null;
    if (opt.machinery && !machine) err('Machinery "' + mach + '" is not in the Asset Master of this site.');
  }
  const side = clean(x.side) ? SIDES.find(s => s.toLowerCase() === clean(x.side).toLowerCase()) : '';
  if (side === undefined) err('The side is LHS, RHS or Both.');
  const useFor = text(x.use_for, 120);
  if ((kind === 'Site work' || kind === 'Sub-contractor') && !useFor) err('Enter what it is used for (the work).');
  const reading = kind === 'Machinery' ? numOf(x.reading, 'reading', { blank: null, max: 1e8 }) : null;
  const debit = x.debit === true || x.debit === 'true' || x.debit === 'Yes';
  if (debit && kind !== 'Sub-contractor' && kind !== 'Machinery') err('A debit is to a sub-contractor or a machinery\'s owner.');
  const out = [], rateFor = opt.rateFor || (() => 0);
  linesOf(x.lines, 'issue', 200).forEach((y, i) => {
    const it = itemOf(y.code, items, opt.had); twice(out, it, i + 1);
    const qty = qtyOf(y.qty, 'quantity of ' + it.name);
    const avg = r2(rateFor(it.code, date)), typed = debit && clean(y.rate) !== '' ? rateOf(y.rate, 'debit rate of ' + it.name) : null;
    const rate = typed !== null ? typed : avg, amount = r2(qty * rate);
    const pct = debit ? pctOf(y.gst_pct, it.gst_pct === null || it.gst_pct === undefined ? 0 : Number(it.gst_pct)) : null;
    const gst = debit ? r2(amount * pct / 100) : 0;
    out.push({ line: i + 1, code: it.code, name: it.name, unit: it.unit, qty: qty, rate: rate, amount: amount, gst_pct: pct, gst: gst,
      returnable: y.returnable === true || y.returnable === 'true' || y.returnable === 'Yes', serial: text(y.serial, 60), remark: text(y.remark, 120) });
  });
  const amount = r2(out.reduce((s, l) => s + l.amount + l.gst, 0));
  return { head: { date: date, to_kind: kind, party: kind === 'Machinery' ? (party || (machine && machine.owner) || null) : party || null, machinery: kind === 'Machinery' ? mach : null,
    reading: reading, location: text(x.location, 120), side: side || null, use_for: useFor, receiver: text(x.receiver, 80), debit: debit, amount: amount, remark: text(x.remark, 300) }, lines: out };
}

/* RETURN of an issue's items: date (not before the issue, not after today); each line of the issue its quantity back – never
 * more than is still out on that line (issued − returned before). */
function checkReturn(x, issue, opt) {
  x = x || {}; opt = opt || {};
  if (!issue) err('This issue is not there any more – refresh.');
  const date = dayOf(x.date, 'return date');
  if (date < issue.date) err('The return date ' + dmy(date) + ' is before the issue date ' + dmy(issue.date) + '.');
  const back = opt.back || {}, out = [];
  linesOf(x.lines, 'return', 200).forEach((y, i) => {
    const l = (issue.lines || []).find(z => String(z.id) === String(y.issue_line));
    if (!l) err('Line ' + (i + 1) + ': not a line of outward ' + issue.no + '.');
    if (out.some(z => z.issue_line === l.id)) err(l.name + ' is twice in the return.');
    const qty = qtyOf(y.qty, 'returned quantity of ' + l.name), left = r3(Number(l.qty) - (back[l.id] || 0));
    if (qty > left + 0.0005) err(l.name + ': ' + qty + ' ' + l.unit + ' back is more than is out (' + left + ' ' + l.unit + ' of ' + Number(l.qty) + ').');
    out.push({ line: i + 1, issue_line: l.id, qty: qty, remark: text(y.remark, 120) });
  });
  return { head: { date: date, issue_no: issue.no, party: issue.party || null, remark: text(x.remark, 300) }, lines: out };
}

/* OPENING STOCK of items: as on a date, each item its quantity and rate (0 quantity takes it out). */
function checkOpening(rows, items, date0) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) err('No item in the opening stock.');
  if (list.length > 5000) err('At most 5000 items at a time.');
  const out = [];
  list.forEach((y, i) => {
    const it = items[String(y.code || '')]; if (!it) err('Line ' + (i + 1) + ': item "' + clean(y.code, 20) + '" is not in the Item Master of this site.');
    if (out.some(z => z.code === it.code)) err(it.name + ' is twice in the opening stock.');
    out.push({ code: it.code, date: dayOf(y.date || date0, 'opening date'), qty: r3(numOf(y.qty, 'opening quantity of ' + it.name, { blank: 0, max: 1e9 })), rate: rateOf(y.rate, 'rate of ' + it.name), remark: text(y.remark, 120) });
  });
  return out;
}

/* ---------- approvals of a requirement (the levels the Super Admin gave in the Portal) ----------
 * settings: { levels: [{ level, people: [{ email, name }] }] }. Any one person of a level approves; then the next level. Nobody
 * approves his own requirement: a level that has nobody else is passed. No level at all → approved when it is made. */
function levelsOf(set) {
  const l = set && Array.isArray(set.levels) ? set.levels : [];
  return l.map(x => ({ level: Number(x.level), people: (Array.isArray(x.people) ? x.people : []).filter(p => p && p.email).map(p => ({ email: String(p.email).toLowerCase(), name: String(p.name || p.email) })) }))
    .filter(x => x.level >= 1 && x.level <= 5 && x.people.length).sort((a, b) => a.level - b.level);
}
function nextLevel(levels, after, maker) {
  const m = String(maker || '').toLowerCase();
  const n = levels.find(x => x.level > after && x.people.some(p => p.email !== m));
  return n ? n.level : 0;
}
const canApprove = (levels, level, email, maker) => { const e = String(email || '').toLowerCase(); if (!e || e === String(maker || '').toLowerCase()) return false; const l = levels.find(x => x.level === level); return !!l && l.people.some(p => p.email === e); };

/* ---------- the stock ---------- */
// the average BASIC rate of an item on a date: the opening and every GRN up to that date (quantity-weighted); none → 0
function avgRate(moves, code, date) {
  let q = 0, v = 0;
  for (const m of moves) { if (m.code !== code || (m.kind !== 'GRN' && m.kind !== 'OPN') || (date && m.date > date)) continue; const n = Number(m.q); q += n; v += n * Number(m.rate || 0); }
  return q > 0 ? v / q : 0;
}
function rateFinder(moves) {
  const by = new Map();
  moves.forEach(m => { if (m.kind !== 'GRN' && m.kind !== 'OPN') return; const l = by.get(m.code) || []; l.push(m); by.set(m.code, l); });
  return (code, date) => avgRate(by.get(code) || [], code, date);
}
function stockOn(moves, date) {
  const s = {};
  moves.forEach(m => { if (date && m.date > date) return; s[m.code] = r3((s[m.code] || 0) + Number(m.q)); });
  return s;
}

module.exports = { r2, r3, today, dmy, dayOf, numOf, qtyOf, rateOf, pctOf, partyOf, checkReq, checkPo, checkGrn, checkIssue, checkReturn, checkOpening,
  levelsOf, nextLevel, canApprove, avgRate, rateFinder, stockOn, FOR_KINDS, TO_KINDS, SIDES, GSTIN };
