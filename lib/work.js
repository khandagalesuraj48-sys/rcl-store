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
    out.push({ line: i + 1, code: it.code, name: it.name, unit: it.unit, qty: qtyOf(y.qty, 'quantity of ' + it.name), brand: text(y.brand, 60), spec: text(y.spec, 200), note: text(y.note, 120) });      // (28-10-2026) its Brand and Material specification
  });
  // (29-10-2026) the contact of the requirement – the site's (Portal → Sites) comes in by itself, the person may change it
  const cName = text(x.contact_name, 80), cPhone = text(x.contact_phone, 40);
  if (cPhone && !/^[0-9+() ,/-]{6,40}$/.test(cPhone)) err('Contact number "' + cPhone + '": digits only (e.g. 98765 43210).');
  return { date: date, need_by: need, for_kind: kind, for_text: forText, remark: text(x.remark, 300), lines: out, contact_name: cName, contact_phone: cPhone };
}

/* PURCHASE ORDER (HO Purchase, for one site): date, vendor (+ GST no.), deliver by, terms; each item its quantity, rate, GST %.
 * A line of a requirement keeps its requirement and line (never more than asked – checked again in the database).
 * (28-10-2026, his format – "DIESEL PURCHASE ORDER": the Store's step 5) also its Credit Period (days), Site Contact, Shipping Address,
 * each line its HSN (the Item Master's when not typed) and Disc. %, the Total Freight Charges and Total Load / Unload Amount; the terms
 * line by line. Amount of a line = Qty × Rate less its Disc. %; GST on that; TOTAL = the lines + GST + freight + load / unload. */
const lines_ = (v, n) => { const t = String(v === undefined || v === null ? '' : v).split(/\r?\n/).map(l => clean(l, 400)).filter(Boolean).join('\n'); return t ? t.slice(0, n) : null; };
function discOf(v, what) {
  const s = clean(v === undefined || v === null ? '' : String(v), 10).replace(/%$/, '');
  if (s === '') return 0;
  const n = Number(s);
  if (!isFinite(n) || n < 0 || n >= 100) err('Disc. % of ' + what + ' "' + s + '" must be a number from 0 to 99.99.');
  return r2(n);
}
function checkPo(x, items, opt) {
  x = x || {}; opt = opt || {};
  const date = dayOf(x.date, 'PO date'), deliver = dayOf(x.deliver_by, 'delivery date', { optional: true, future: true });
  let credit = null;
  if (x.credit_days !== undefined && x.credit_days !== null && String(x.credit_days).trim() !== '') {
    credit = Number(String(x.credit_days).trim()); if (!Number.isInteger(credit) || credit < 0 || credit > 365) err('The Credit Period must be whole days from 0 to 365.');
  }
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
    const disc = discOf(y.disc_pct, it.name), gross = r2(qty * rate), taxable = r2(gross * (100 - disc) / 100), gst = r2(taxable * pct / 100);
    const hsn = clean(y.hsn === undefined || y.hsn === null || y.hsn === '' ? it.hsn || '' : y.hsn, 8).replace(/\s+/g, '');
    if (hsn && !/^\d{4}(\d{2}){0,2}$/.test(hsn)) err('HSN of ' + it.name + ' "' + hsn + '" must be 4, 6 or 8 digits.');
    // (28-10-2026) the Brand and Material specification: as typed in the PO, else the requirement line's
    const rq0 = rn === null ? null : ((reqs[rn] || {}).lines || []).find(l => Number(l.line) === rl) || null, has = v => v !== undefined && v !== null;
    out.push({ line: i + 1, code: it.code, name: it.name, unit: it.unit, qty: qty, rate: rate, gst_pct: pct, taxable: taxable, gst: gst, total: r2(taxable + gst), req_no: rn, req_line: rl,
      brand: text(has(y.brand) ? y.brand : rq0 ? rq0.brand : '', 60), spec: text(has(y.spec) ? y.spec : rq0 ? rq0.spec : '', 200), disc_pct: disc, disc: r2(gross - taxable), hsn: hsn || null });
  });
  const sum = k => r2(out.reduce((s, l) => s + l[k], 0));
  const freight = r2(numOf(x.freight, 'Total Freight Charges', { blank: 0, max: 1e9 })), load = r2(numOf(x.load_unload, 'Total Load / Unload Amount', { blank: 0, max: 1e9 }));
  return { date: date, vendor: vendor, vendor_gst: gstNo || null, deliver_by: deliver, terms: lines_(x.terms, 3000), remark: text(x.remark, 300), lines: out, taxable: sum('taxable'), gst: sum('gst'),
    total: r2(sum('total') + freight + load), credit_days: credit, site_contact: text(x.site_contact, 120), ship_to: lines_(x.ship_to, 300), freight: freight, load_unload: load, disc: sum('disc') };
}
// (28-10-2026, his papers' numbers: "RCL/VTR/PO/2026/0128", "RCL/VTR/PR/2026/0232") a paper's number as printed: the site's prefix
// (Store Settings; else the company's initials / the site), the kind, the year of its date, its number in 4 digits
const initialsOf = name => String(name || '').split(/\s+/).filter(w => /^[A-Za-z]/.test(w) && !/^(of|and|the|&)$/i.test(w)).map(w => w[0].toUpperCase()).join('').slice(0, 6);
function refOf(prefix, kind, date, no) { const p = String(prefix || '').trim().replace(/\/+$/, ''); return (p ? p + '/' : '') + kind + '/' + String(date || '').slice(0, 4) + '/' + String(no).padStart(4, '0'); }
/* (29-10-2026, his words: "company name RCL asel part site name VTR nantr current year jo chalu aahe financial year te asel nantr indent
 * mechanical cha aahe ki material purchase cha ahe tyacha ek short letter asel ok then 4 digit number asel jo 0001 pasun suru hoil")
 * THE INDENT NO. of a requirement: RCL/VTR/2026-27/M/0001 – the company's initials (Portal → Companies), the site (its code; the first
 * site's own code S1 is no name – the first word of its name: "VTR Site – NH 848" → VTR), the financial year of its date (April to
 * March), M = Mechanical (for a machinery) or P = Material Purchase (site work, office, other), and its number – from 0001 in each
 * financial year and each letter (the Store's step 8 keeps it; before the step: the requirement's own number). Nothing is typed. */
const fyOf = d => { const y = Number(String(d || '').slice(0, 4)), m = Number(String(d || '').slice(5, 7)); if (!y || !m) return ''; const a = m >= 4 ? y : y - 1; return a + '-' + String((a + 1) % 100).padStart(2, '0'); };
const indentKind = forKind => forKind === 'Machinery' ? 'M' : 'P';
const siteShort = (code, name) => { const c = String(code || '').toUpperCase(), w = (/^[A-Za-z0-9]+/.exec(String(name || '').trim()) || [''])[0].toUpperCase(); return /^S\d+$/.test(c) && w && w !== c ? w : c; };
function indentOf(r, h, site) {
  const fy = r.indent_fy || fyOf(r.date), k = r.indent_kind || indentKind(r.for_kind), n = r.indent_no || r.no;
  return [initialsOf(h && h.company), siteShort(site, h && h.site), fy, k, String(n).padStart(4, '0')].filter(Boolean).join('/');
}
// an amount in words, the Indian way ("Two Lakhs Twenty Five Thousand Six Hundred and Ninety Nine Only")
const ONES_ = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS_ = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two_ = n => n < 20 ? ONES_[n] : TENS_[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES_[n % 10] : '');
const three_ = n => { const h = Math.floor(n / 100), r = n % 100; return (h ? ONES_[h] + ' Hundred' + (r ? ' and ' : '') : '') + (r ? two_(r) : ''); };
function wordsOf_(n) {      // a whole number: … Crore, Lakhs, Thousand, Hundred
  if (!n) return '';
  const cr = Math.floor(n / 1e7); n %= 1e7; const lk = Math.floor(n / 1e5); n %= 1e5; const th = Math.floor(n / 1e3); n %= 1e3;
  return [cr ? wordsOf_(cr) + (cr > 1 ? ' Crores' : ' Crore') : '', lk ? two_(lk) + (lk > 1 ? ' Lakhs' : ' Lakh') : '', th ? two_(th) + ' Thousand' : '', three_(n)].filter(Boolean).join(' ');
}
function inWords(amount) {
  const v = Math.round(Math.abs(Number(amount) || 0) * 100), rupees = Math.floor(v / 100), paise = v % 100;
  return (wordsOf_(rupees) || 'Zero') + (paise ? ' and ' + two_(paise) + ' Paise' : '') + ' Only';
}

/* (29-10-2026 – "bill madh discount pn kadhi kdhi dettat mg to kadhi basic war asu shakto tr kadhi gst war all over logic use krun te pn
 * mala pefect hawa"; his answers: on a line AND on the whole bill, each on the Basic or after GST, % or ₹; the stock's rate with BOTH
 * deducted – what we really paid) A DISCOUNT as typed: "10%" (a share) or "500" (₹); its kind: 'basic' – before GST (GST on what is
 * left), 'gst' – after GST (the GST as billed, only the amount paid less). */
function discIn(v, what) {
  const s = clean(v === undefined || v === null ? '' : String(v), 14).replace(/,/g, '').replace(/^₹\s*/, '').replace(/\s+/g, '');
  if (s === '' || s === '0' || s === '0%') return null;
  const pct = /%$/.test(s), n = Number(s.replace(/%$/, ''));
  if (!isFinite(n) || n < 0) err('The discount of ' + what + ' "' + s + '" is not a number (e.g. 10% or 500).');
  if (pct && n >= 100) err('The discount of ' + what + ' ' + s + ' must be below 100 %.');
  return pct ? { pct: r2(n), amt: null } : { pct: null, amt: r2(n) };
}
const discOn = v => String(v || '').toLowerCase() === 'gst' ? 'gst' : 'basic';
const discText = d => !d ? '' : d.pct !== null ? d.pct + '%' : String(d.amt);
// an amount shared over lines in proportion to their bases (each to the paisa; what is left over goes to the biggest)
function shareOut(total, bases) {
  const sum = bases.reduce((a, b) => a + b, 0), out = bases.map(b => sum > 0 ? r2(total * b / sum) : 0);
  const left = r2(total - out.reduce((a, b) => a + b, 0));
  if (left && out.length) { let k = 0; bases.forEach((b, i) => { if (b > bases[k]) k = i; }); out[k] = r2(out[k] + left); }
  return out;
}
/* INWARD (GRN): date, supplier, challan no., invoice no. and date, vehicle no., its PO (if any); each item its quantity, basic
 * rate, GST %; the bill's TCS. Taxable = qty × rate; GST on it; Gross = taxable + GST (+ TCS on the bill).
 * (29-10-2026) A DISCOUNT on a line and / or on the whole bill (discIn): one on the Basic comes off the taxable before GST (a line's
 * first, then the bill's, shared by the lines' taxable); one after GST comes off what is paid (a line's on its own amount, then the
 * bill's shared by the lines' amounts) – the GST stays as billed. Each line keeps its Basic (qty × rate), its own discount, its part of
 * the bill's, and its NET RATE – (taxable − its after-GST discounts) ÷ qty: the stock's rate (what we really paid, without GST). */
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
    const basic = r2(qty * rate), d = discIn(y.disc, it.name), on = discOn(y.disc_on);
    let ld = 0;
    if (d && on === 'basic') { ld = d.pct !== null ? r2(basic * d.pct / 100) : d.amt; if (ld > basic) err('The discount of ' + it.name + ' (' + ld + ') is more than its Basic amount (' + basic + ').'); }
    out.push({ line: i + 1, code: it.code, name: it.name, unit: it.unit, qty: qty, rate: rate, basic: basic, taxable: r2(basic - ld), gst_pct: pct, gst: 0, gross: 0, po_line: pl, remark: text(y.remark, 120),
      disc_on: d ? on : null, disc_pct: d ? d.pct : null, disc: ld, bill_disc: 0, _d: d });
  });
  // the bill's discount on the Basic: shared by the lines' taxable
  const bd = discIn(x.bill_disc, 'the bill'), bon = discOn(x.bill_disc_on), base1 = r2(out.reduce((a, l) => a + l.taxable, 0));
  let billDisc = 0;
  if (bd && bon === 'basic') {
    billDisc = bd.pct !== null ? r2(base1 * bd.pct / 100) : bd.amt;
    if (billDisc > base1) err('The discount of the bill (' + billDisc + ') is more than its taxable amount (' + base1 + ').');
    shareOut(billDisc, out.map(l => l.taxable)).forEach((v, i) => { out[i].taxable = r2(out[i].taxable - v); out[i].bill_disc = v; });
  }
  out.forEach(l => { l.gst = r2(l.taxable * l.gst_pct / 100); l.gross = r2(l.taxable + l.gst); });
  // a line's discount after GST: off its own amount; then the bill's after GST: shared by the lines' amounts
  out.forEach(l => { if (!l._d || l.disc_on !== 'gst') return; const v = l._d.pct !== null ? r2(l.gross * l._d.pct / 100) : l._d.amt;
    if (v > l.gross) err('The discount of ' + l.name + ' (' + v + ') is more than its amount with GST (' + l.gross + ').'); l.disc = v; l.gross = r2(l.gross - v); });
  if (bd && bon === 'gst') {
    const base2 = r2(out.reduce((a, l) => a + l.gross, 0));
    billDisc = bd.pct !== null ? r2(base2 * bd.pct / 100) : bd.amt;
    if (billDisc > base2) err('The discount of the bill (' + billDisc + ') is more than its amount with GST (' + base2 + ').');
    shareOut(billDisc, out.map(l => l.gross)).forEach((v, i) => { out[i].gross = r2(out[i].gross - v); out[i].bill_disc = v; });
  }
  // (a line with no discount at all keeps its basic rate as its net rate – the stock's rate exactly as before)
  out.forEach(l => { const after = (l.disc_on === 'gst' ? l.disc : 0) + (bd && bon === 'gst' ? l.bill_disc : 0);
    l.net_rate = l.disc > 0 || l.bill_disc > 0 ? Math.round(Math.max(0, l.taxable - after) / l.qty * 10000) / 10000 : l.rate; delete l._d; });
  const tcs = r2(numOf(x.tcs, 'TCS', { blank: 0, max: 1e9 })), sum = k => r2(out.reduce((s, l) => s + l[k], 0));
  // (28-10-2026) the GRN No of a new GRN as typed in its form (blank = the next number)
  const ref = clean(x.ref, 20) || null;
  if (ref && !/^[A-Za-z0-9][A-Za-z0-9 \-\/.]*$/.test(ref)) err('The GRN No "' + ref + '": letters, digits, "-", "/" and "." only.');
  return { head: { ref: ref, date: date, supplier: supplier, challan_no: text(x.challan_no, 40), invoice_no: text(x.invoice_no, 40), invoice_date: inv, vehicle_no: vehicleOf(x.vehicle_no),
    po_no: po ? po.no : null, taxable: sum('taxable'), gst: sum('gst'), tcs: tcs, gross: r2(sum('gross') + tcs), remark: text(x.remark, 300),
    basic: sum('basic'), disc: r2(sum('disc') + billDisc), bill_disc: billDisc, bill_disc_on: bd ? bon : null, bill_disc_pct: bd ? bd.pct : null }, lines: out };
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

/* (28-10-2026) who approves a PURCHASE ORDER of this site: the people the Super Admin ticked in the Portal ("Approves purchase
 * orders"), kept with the requirement approvers (settings.po). Anyone of them approves (or rejects, saying why), never his own PO; nobody
 * (other than its maker) – approved when it is made. */
function poApprovers(set) { return (set && Array.isArray(set.po) ? set.po : []).filter(p => p && p.email).map(p => ({ email: String(p.email).toLowerCase(), name: String(p.name || p.email) })); }
// (29-10-2026, the review) maker: who made it – or [who made it, who changed it last]: neither approves it
const mayApprovePo = (people, email, maker) => { const e = String(email || '').toLowerCase(); return !!e && !makersOf(maker).includes(e) && people.some(p => p.email === e); };

/* ---------- (29-10-2026) THE WORKFLOW OF A SITE'S STORE – set by the Super Admin in the Portal ----------
 * His words: "pratek kamamadhe … entry krnarana to verification la pathawel … verification wale ni … verification kel tr te auto jyanche
 * kadhe approval aahe tyanche kade jail … site warun kahi approval zal ki te direct head office la jail … he sagle kam super admin
 * swatache portel madhun krel"; "pratek task approval nantr HO la nahi janar – konte jail konte nahi jail te super admin tharau shakel".
 * For each work of the Store – req (Material Requirements), po (Purchase Orders), grn (Inward – GRN, the supplier's bill), iss (Issue &
 * Return) – who VERIFIES it (people ticked in the Portal: "Verifies …"), who APPROVES it (requirements: their levels 1 – 5; POs:
 * "Approves purchase orders"; GRN, Issue & Return: "Approves …"), and whether, approved, it goes to HEAD OFFICE (the site's rule in the
 * Portal → Workflow: requirements – to HO Purchase, else the site buys them itself; GRN – its bill to HO, who checks it; Issue & Return
 * – to HO). Kept with the approvers (store_settings 'approvers' → wf). Nothing set: as before – nobody verifies, requirements go to HO
 * Purchase, nothing else goes to HO. Nobody verifies or approves his own entry. */
const WF_WORKS = ['req', 'po', 'grn', 'iss'];
const peopleOf = l => (Array.isArray(l) ? l : []).filter(p => p && p.email).map(p => ({ email: String(p.email).toLowerCase(), name: String(p.name || p.email) }));
function wfOf(set) {
  const w = set && set.wf && typeof set.wf === 'object' ? set.wf : {}, v = w.verify || {}, a = w.approve || {}, h = w.ho || {};
  return { verify: { req: peopleOf(v.req), po: peopleOf(v.po), grn: peopleOf(v.grn), iss: peopleOf(v.iss) }, approve: { grn: peopleOf(a.grn), iss: peopleOf(a.iss) },
    ho: { req: h.req !== false, grn: h.grn === true, iss: h.iss === true } };
}
function lowerOf(e) { return String(e || '').trim().toLowerCase(); }
/* (29-10-2026, the review) WHO MADE A PAPER – the one who made it and the one who changed it last (a Store Admin's correction): neither
 * of them verifies or approves it. maker: one email or a list of them. */
function makersOf(...e) { return [...new Set(e.flat(2).map(lowerOf).filter(Boolean))]; }
const othersOf = (people, maker) => { const ex = makersOf(maker); return (people || []).filter(p => !ex.includes(p.email)); };
const exOf = cur => makersOf(cur && cur.by, cur && cur.made);
const isIn = (people, email) => !!lowerOf(email) && (people || []).some(p => p.email === lowerOf(email));
/* A GRN's, an issue's or a return's workflow when it is saved (made, or changed by the Store Admin – then it starts again): to
 * verification when someone other than who saved it verifies; else to approval; else done – and done, to Head Office when the site's
 * rule says so. null = nothing to do (as before). Its stock counts at once, as always: the workflow is the papers' sign-off. */
// (29-10-2026, the review) made: who made it, when someone else (the Store Admin) saves a change – kept too: neither of them decides it
function wfStart(wf, kind, maker, now, made) {
  const by = lowerOf(maker), mk = lowerOf(made) || by, ex = makersOf(by, mk), state = othersOf(wf.verify[kind], ex).length ? 'verify' : othersOf(wf.approve[kind], ex).length ? 'approve' : 'done';
  if (state === 'done' && !wf.ho[kind]) return null;
  return Object.assign({ state: state, by: by, at: now || new Date().toISOString(), steps: [] }, mk !== by ? { made: mk } : {}, state === 'done' ? { ho: true, doneAt: now || new Date().toISOString() } : {});
}
// the step it waits for NOW: its verification – when nobody verifies any more, its approval; its approval – when nobody approves any more: none
function wfStepNow(wf, kind, cur) {
  if (!cur || (cur.state !== 'verify' && cur.state !== 'approve')) return '';
  if (cur.state === 'verify' && othersOf(wf.verify[kind], exOf(cur)).length) return 'verify';
  return othersOf(wf.approve[kind], exOf(cur)).length ? 'approve' : '';
}
const wfPeople = (wf, kind, step) => step === 'verify' ? wf.verify[kind] : step === 'approve' ? (wf.approve[kind] || []) : [];
// may this person decide it now (never his own)?
function wfMay(wf, kind, cur, email) { const st = wfStepNow(wf, kind, cur); return !!st && !exOf(cur).includes(lowerOf(email)) && isIn(wfPeople(wf, kind, st), email); }
const wfWaitFor = (wf, kind, cur) => { const st = wfStepNow(wf, kind, cur); return othersOf(wfPeople(wf, kind, st), exOf(cur)).map(p => p.name); };
// decided: verified → its approval (when someone approves) or done; approved → done (to Head Office by the rule); not → returned (for correction)
function wfNext(wf, kind, cur, who, ok, note, now) {
  const st = wfStepNow(wf, kind, cur), at = now || new Date().toISOString();
  const steps = (cur.steps || []).concat([{ step: st, ok: !!ok, email: lowerOf(who.email), name: who.name || who.email, at: at, note: note || null }]);
  if (!ok) return Object.assign({}, cur, { state: 'returned', steps: steps });
  if (st === 'verify' && othersOf(wf.approve[kind], exOf(cur)).length) return Object.assign({}, cur, { state: 'approve', steps: steps });
  return Object.assign({}, cur, { state: 'done', steps: steps, doneAt: at }, wf.ho[kind] ? { ho: true } : {});
}

// the bill's rate above its PO line's: taxable (after its discounts, before GST) for q against the PO's rate after its Disc. % (the page and the app the same)
function rateOver(taxable, q, p) {
  const exact = Number(p.rate || 0) * (100 - Number(p.disc_pct || 0)) / 100;
  return q > 0 && r2(taxable / q) > r2(exact) + 0.009 && taxable > r2(q * exact) + 0.02;
}
/* (29-10-2026, "standard ERP level je universal aste": a GRN against a PO is the supplier's bill against that PO) THE BILL CHECKED WITH
 * ITS PO – the three of them: what was ORDERED (the PO's quantity, its rate after its Disc. %, its GST %), what CAME (the GRN's received
 * quantity, with what came before on the PO) and what is BILLED (the GRN's rate after its discounts on the Basic, its GST %). A rate
 * above the PO's, another GST %, more than the PO still had, an item that is not on the PO – each a difference; a rate below the PO's is
 * fine. lines: the GRN's; po: its PO; before: 'po:line' → what came on it before this GRN. */
/* (29-10-2026, the review) the rate: more than the PO's at 2 decimals AND the bill's amount more than the PO's for that quantity (beyond 2
 * paise of rounding) – a bill at the PO's rate and discount is never flagged for a paisa of rounding. Two lines of one GRN on one PO line:
 * the second one checked with what the first left. */
function billCheck(lines, po, before) {
  const out = [], b = before || {}, used = {};
  (lines || []).forEach(l => {
    if (l.po_line === null || l.po_line === undefined || l.po_line === '') { out.push({ kind: 'extra', name: l.name, unit: l.unit, bill: Number(l.qty) }); return; }
    const p = (po.lines || []).find(z => Number(z.line) === Number(l.po_line)); if (!p) { out.push({ kind: 'extra', name: l.name, unit: l.unit, bill: Number(l.qty) }); return; }
    const exact = Number(p.rate || 0) * (100 - Number(p.disc_pct || 0)) / 100, poRate = r2(exact), q = Number(l.qty) || 0, billRate = q > 0 ? r2(Number(l.taxable || 0) / q) : 0;
    if (rateOver(Number(l.taxable || 0), q, p)) out.push({ kind: 'rate', name: l.name, unit: l.unit, po: poRate, bill: billRate });
    if (Number(l.gst_pct || 0) !== Number(p.gst_pct || 0)) out.push({ kind: 'gst', name: l.name, po: Number(p.gst_pct || 0), bill: Number(l.gst_pct || 0) });
    const k = po.no + ':' + l.po_line, left = r3(Number(p.qty) - Number(b[k] || 0) - (used[k] || 0));
    used[k] = r3((used[k] || 0) + q);
    if (q > left + 0.0005) out.push({ kind: 'qty', name: l.name, unit: l.unit, po: Math.max(0, left), bill: q });
  });
  return { ok: !out.length, diffs: out };
}
// the check told in words (the lists, the app, the print)
const billWords = c => !c ? '' : c.ok ? 'As per PO' : c.diffs.map(d => d.kind === 'rate' ? d.name + ': rate ₹' + d.bill + ' – PO ₹' + d.po : d.kind === 'gst' ? d.name + ': GST ' + d.bill + '% – PO ' + d.po + '%'
  : d.kind === 'qty' ? d.name + ': ' + d.bill + ' ' + (d.unit || '') + ' – PO still had ' + d.po : d.name + ': not on the PO').join('; ');
/* a PO's lines as ordered, as came and as still to come – quantity and value (its rate after its Disc. %, before GST) */
function poBalance(po, rec) {
  return (po.lines || []).slice().sort((a, b) => a.line - b.line).map(l => {
    const rate = r2(Number(l.rate || 0) * (100 - Number(l.disc_pct || 0)) / 100), came = r3(Number(rec[po.no + ':' + l.line] || 0)), left = Math.max(0, r3(Number(l.qty) - came));
    return { line: l.line, code: l.code, name: l.name, unit: l.unit, qty: Number(l.qty), rate: rate, came: came, left: left, value: r2(Number(l.qty) * rate), cameValue: r2(Math.min(came, Number(l.qty)) * rate), leftValue: r2(left * rate) };
  });
}

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

module.exports = { discIn, discText, shareOut, r2, r3, today, dmy, dayOf, numOf, qtyOf, rateOf, pctOf, partyOf, checkReq, checkPo, checkGrn, checkIssue, checkReturn, checkOpening,
  levelsOf, nextLevel, canApprove, avgRate, rateFinder, stockOn, FOR_KINDS, TO_KINDS, SIDES, GSTIN, refOf, initialsOf, inWords, poApprovers, mayApprovePo,
  fyOf, indentKind, siteShort, indentOf, WF_WORKS, wfOf, wfStart, wfStepNow, wfMay, wfWaitFor, wfNext, othersOf, makersOf, isIn, billCheck, rateOver, billWords, poBalance };
