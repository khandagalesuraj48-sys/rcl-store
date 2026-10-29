/* (29-10-2026, his words: "jr requirement machinery sathi aasel jewa vehicle number takla jail tewa tya vehicle che maintanace log book
 * auto requirement madhe attach hoil … confirmation madhe fkt show hoil ki te update kadhi paryant ahe … print madhe … maintanance
 * logbook pn attach asel") A MACHINERY'S MAINTENANCE LOG BOOK, for its requirement – as Mechanical keeps and draws it:
 *   – its bills: Mechanical's table "maintenance" of the same site's database (each bill, its lines kept as one text – Mechanical's
 *     update-165 … 183), and what the Store issued to it (Outward – Party "RCL Store", as Mechanical's maintStoreLines_);
 *   – drawn in his format (Sr No, Date, Party Name, Current Reading, Particulars, Qty, Uom, Basic Rate, Amount, the CGST and SGST of each
 *     GST rate, GST Amount, Amount With GST, Paid by, Insurance claim, Service, Total) – Mechanical's page mlogRender, its bills' table.
 * The parts below marked "Mechanical:" are Mechanical's own code, word for word but for its names (the unit test compares them with
 * rclerp/app/Code.gs and rclerp/app/App.html when that repository is next to this one). Nothing is written. */
'use strict';

/* ---------- Mechanical: app/Code.gs (maintAllLinesOf_, maintLinesOf_, maintInsOf_, maintWorth_) ---------- */
const str_ = v => v === null || v === undefined ? '' : String(v).trim();
const clean_ = v => str_(v).replace(/\s+/g, ' ');
const r2_ = n => Math.round(n * 100) / 100;
const numOrBlank_ = v => { if (v === '' || v === null || v === undefined) return ''; const n = Number(v); return isNaN(n) ? '' : n; };
const num0_ = v => { const n = numOrBlank_(v); return n === '' ? 0 : n; };
const noKey_ = v => str_(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
const MNT_TYPES_ = ['Paid', 'By Insurance', 'Warranty', 'FOC', 'Service Plan'], MNT_INS_ = 'Insurance';
const MNT_CHARGED_ = t => t === 'Paid' || t === 'By Insurance';
const maintAllLinesOf_ = v => { let a = null; try { a = typeof v === 'string' ? JSON.parse(v || '[]') : v; } catch (e) { a = null; }
  return Array.isArray(a) ? a.filter(l => l && clean_(l.work)).map(l => {
    const ty = clean_(l.type), type = ty === MNT_INS_ ? MNT_INS_ : (MNT_TYPES_.find(t => t.toUpperCase() === ty.toUpperCase()) || 'Paid');
    const o = { work: clean_(l.work).slice(0, 120), type: type, amount: r2_(num0_(l.amount)) };
    ['qty', 'rate', 'disc', 'gst', 'gstAmt'].forEach(k => { const n = numOrBlank_(l[k]); if (n !== '') o[k] = n; });
    if (clean_(l.uom)) o.uom = clean_(l.uom).slice(0, 12);
    if (type === MNT_INS_ && clean_(l.claim)) o.claim = clean_(l.claim).slice(0, 40);
    return o;
  }) : []; };
const maintLinesOf_ = v => maintAllLinesOf_(v).filter(l => l.type !== MNT_INS_);
const maintInsOf_ = v => { const l = maintAllLinesOf_(v).find(x => x.type === MNT_INS_); return l ? { company: l.work, claimNo: l.claim || '', paid: r2_(-l.amount) } : null; };
const maintWorth_ = l => MNT_CHARGED_(l.type) || l.type === MNT_INS_ ? 0 : r2_((l.qty === undefined || l.qty === '' ? 1 : num0_(l.qty)) * num0_(l.rate));

/* ---------- the bills of one machinery (to a date) ---------- */
const dk = v => String(v || '').slice(0, 10);
// the maintenance bills (Mechanical) and the Store's issues of a machinery, up to a date (none: all), by date – as maintLog_ orders them
async function billsOf(dbAll, site, no, upto) {
  const enc = encodeURIComponent, K = noKey_(no), to = upto ? '&date=lte.' + upto : '';
  let rows = [];
  try {
    rows = await dbAll(site, 'maintenance?select=id,date,machinery,garage,bill_no,km_reading,amount,lines,service,remark,created_at&machinery=eq.' + enc(no) + to, 'id');
    if (!rows.length) {      // (a number written another way – MH25AJ5506 / MH-25-AJ-5506: Mechanical matches them as one)
      const names = [...new Set((await dbAll(site, 'maintenance?select=id,machinery', 'id')).map(r => str_(r.machinery)).filter(m => noKey_(m) === K))];
      if (names.length) rows = await dbAll(site, 'maintenance?select=id,date,machinery,garage,bill_no,km_reading,amount,lines,service,remark,created_at&machinery=in.(' + names.map(n => '"' + n.replace(/"/g, '') + '"').join(',') + ')' + to, 'id');
    }
  } catch (e) { if (!/PGRST205|42P01|does not exist|Could not find the table|notinstalled/i.test(String((e && e.message) || '') + ' ' + String((e && e.code) || ''))) throw e; rows = []; }      // (no step 1zi at this site: no bills)
  const bills = rows.filter(r => dk(r.date)).map(r => {
    const lines = maintLinesOf_(r.lines), ins = maintInsOf_(r.lines);
    return { kind: 'Maintenance', id: str_(r.id), date: dk(r.date), garage: str_(r.garage), party: str_(r.garage), billNo: str_(r.bill_no), km: numOrBlank_(r.km_reading),
      amount: num0_(r.amount), total: num0_(r.amount), lines: lines, insurance: ins, free: r2_(lines.reduce((s, l) => s + maintWorth_(l), 0)), service: /^yes$/i.test(str_(r.service)), ord: Date.parse(r.created_at) || 0 };
  });
  // Mechanical: maintStoreLines_ – the Store's outward to this machinery (an issue on debit to its owner: ₹ 0, not our cost)
  let iss = [];
  try { iss = await dbAll(site, 'store_issue?select=no,date,reading,party,debit,use_for,store_issue_lines(line,name,qty,unit,rate,amount,gst_pct)&machinery=eq.' + enc(no) + to, 'no'); } catch (e) { iss = []; }
  iss.forEach(r => {
    const debit = r.debit === true, ls = (r.store_issue_lines || []).slice().sort((a, b) => a.line - b.line).map(l => ({ work: str_(l.name), type: debit ? 'Debit' : 'Paid', qty: num0_(l.qty), uom: str_(l.unit),
      rate: r2_(num0_(l.rate)), amount: r2_(num0_(l.amount)), gst: debit && num0_(l.gst_pct) > 0 ? num0_(l.gst_pct) : 0 }));
    const total = debit ? 0 : r2_(ls.reduce((a, l) => a + l.amount, 0));
    bills.push({ kind: 'Store', id: 'OUT-' + r.no, date: dk(r.date), billNo: 'Outward ' + r.no, party: 'RCL Store' + (debit && r.party ? ' – debit to ' + str_(r.party) : ''), garage: 'RCL Store',
      km: r.reading === null || r.reading === undefined ? '' : num0_(r.reading), lines: ls, amount: total, total: total, insurance: null, free: 0, service: false, ord: 0 });
  });
  bills.sort((a, b) => a.date.localeCompare(b.date) || a.ord - b.ord);
  return bills;
}
// what the form shows when the machinery is picked: up to which date its log book is written, and how many bills
async function infoOf(dbAll, site, no) {
  const b = await billsOf(dbAll, site, no, '');
  return { no: no, bills: b.length, upto: b.length ? b[b.length - 1].date : '', amount: r2_(b.reduce((s, x) => s + num0_(x.total), 0)) };
}

/* ---------- Mechanical: app/App.html (mtPaidBy, mtCharged, mtHasGa, MT_TAX, mtTaxPct, mlogSpread, mlogRender – its bills' table) ---------- */
const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const r2 = n => Math.round(n * 100) / 100;
const fmt = v => (v === '' || v === null || v === undefined) ? '' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const money = v => (v === '' || v === null || v === undefined) ? '' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function showDate(d) { if (!d) return ''; const p = String(d).split('-'); return esc(p[2] + '-' + p[1] + '-' + p[0]); }
const MT_PAIDBY = { 'Paid': 'RCL', 'By Insurance': 'Insurance' }, mtPaidBy = t => MT_PAIDBY[t || 'Paid'] || t;
const mtCharged = t => !t || t === 'Paid' || t === 'By Insurance';
const mtHasGa = l => !!l && l.gstAmt !== undefined && l.gstAmt !== null && l.gstAmt !== '' && !(Number(l.gst) > 0);
const MT_TAX = /^\s*(?:maharashtra\s+)?(?:cgst|sgst|igst|utgst|gst|cess|tax|vat)\b/i;
const mtTaxPct = w => { const m = /(\d+(?:\.\d+)?)\s*%/.exec(w || ''); return m ? Number(m[1]) : 0; };
function mlogSpread(lines) {
  const ls = (lines || []).map(l => Object.assign({}, l)), isTax = l => mtCharged(l.type) && !(Number(l.gst) > 0) && !mtHasGa(l) && MT_TAX.test(l.work || '');
  const kind = w => /^\s*(?:maharashtra\s+)?cgst\b/i.test(w) ? 'c' : /^\s*(?:maharashtra\s+)?sgst\b/i.test(w) ? 's' : /^\s*(?:maharashtra\s+)?igst\b/i.test(w) ? 'i' : /^\s*(?:maharashtra\s+)?gst\b/i.test(w) ? 'g' : '';
  const tx = ls.filter(isTax), full = t => (/[ig]/.test(kind(t.work)) ? 1 : 2) * mtTaxPct(t.work);
  if (!tx.length || tx.some(t => !kind(t.work) || !(mtTaxPct(t.work) > 0)) || new Set(tx.map(full)).size > 1) return ls;
  const items = ls.filter(l => !isTax(l) && mtCharged(l.type) && !(Number(l.gst) > 0) && !mtHasGa(l) && Number(l.amount) > 0 && !/round|adjust/i.test(l.work || ''));
  if (!items.length) return ls;
  const A = items.reduce((t, l) => t + Number(l.amount), 0), big = items.reduce((b, l) => Number(l.amount) > Number(b.amount) ? l : b, items[0]);
  items.forEach(l => { l.tax = { c: 0, s: 0, i: 0 }; l.taxRate = full(tx[0]); });
  tx.forEach(t => {
    const T = Number(t.amount) || 0, p = mtTaxPct(t.work), k = kind(t.work);
    let sh = items.map(l => r2(Number(l.amount) * p / 100));
    if (Math.abs(sh.reduce((a, v) => a + v, 0) - T) > 1) sh = items.map(l => r2(T * Number(l.amount) / A));
    const left = r2(T - sh.reduce((a, v) => a + v, 0));
    items.forEach((l, i) => { const v = r2(sh[i] + (l === big ? left : 0)), h = r2(v / 2);
      if (k === 'g') { l.tax.c = r2(l.tax.c + h); l.tax.s = r2(l.tax.s + v - h); } else l.tax[k] = r2(l.tax[k] + v); });
  });
  return ls.filter(l => !isTax(l));
}
// the bills' table of the log book (Mechanical's mlogRender, without its buttons of the screen); free = what the free lines were worth
function tableOf(bills) {
  const has = v => v !== '' && v !== null && v !== undefined;
  const taxPct = mtTaxPct, rset = new Set(), spread = bills.map(x => mlogSpread(x.lines));
  let asIs = false;
  spread.forEach(ls => ls.forEach(l => { if (mtCharged(l.type) && mtHasGa(l)) asIs = true; else if (mtCharged(l.type) && Number(l.gst) > 0) rset.add(Number(l.gst)); else if (l.tax && (l.tax.c || l.tax.s)) rset.add(l.taxRate); else if (mtCharged(l.type) && /^\s*(?:maharashtra\s+)?[cs]gst\b/i.test(l.work || '') && taxPct(l.work)) rset.add(2 * taxPct(l.work)); }));
  const rates = [...rset].sort((p, q) => p - q), nc = 15 + 2 * rates.length;
  let sr = 0, sa = 0, sg = 0, sw = 0, st = 0;
  const sc = rates.map(() => [0, 0]), free = r2(bills.reduce((s, x) => s + (Number(x.free) || 0), 0));
  const rows = bills.map((x, bi) => {
    const ls = spread[bi].map(l => {
      const paid = mtCharged(l.type), tax = paid && !(Number(l.gst) > 0) && !mtHasGa(l) && MT_TAX.test(l.work || ''), amt = paid ? Number(l.amount) || 0 : 0, cg = rates.map(() => ['', '']);
      let gst = '';
      if (paid && mtHasGa(l)) gst = r2(Number(l.gstAmt) || 0);
      else if (tax) { gst = amt; const p = taxPct(l.work), side = /^\s*(?:maharashtra\s+)?sgst\b/i.test(l.work) ? 1 : /^\s*(?:maharashtra\s+)?cgst\b/i.test(l.work) ? 0 : -1, ri = rates.indexOf(2 * p); if (side > -1 && ri > -1) cg[ri][side] = amt; }
      else if (paid && Number(l.gst) > 0) { const half = r2(amt * Number(l.gst) / 200), ri = rates.indexOf(Number(l.gst)); gst = 2 * half; if (ri > -1) cg[ri] = [half, half]; }
      else if (l.tax) { const ri = rates.indexOf(l.taxRate); gst = r2(l.tax.c + l.tax.s + l.tax.i); if (ri > -1) cg[ri] = [l.tax.c || '', l.tax.s || '']; }
      return { part: l.work || '', qty: l.qty, uom: l.uom || '', rate: l.rate, amount: tax ? '' : amt, cg: cg, gst: gst, withGst: r2(amt + (tax ? 0 : Number(gst) || 0)), by: mtPaidBy(l.type) };
    });
    if (x.insurance && x.insurance.paid > 0) ls.push({ part: 'Paid by the insurance' + (x.insurance.company ? ' – ' + x.insurance.company : '') + (x.insurance.claimNo ? ' (claim no. ' + x.insurance.claimNo + ')' : ''), uom: '', amount: '', cg: rates.map(() => ['', '']), gst: '', withGst: -x.insurance.paid, by: 'Insurance', ins: true });
    if (!ls.length) ls.push({ part: '', uom: '', amount: '', cg: rates.map(() => ['', '']), gst: '', withGst: Number(x.amount) || 0, by: '' });
    const n = ls.length, party = esc(x.party || x.garage || '') + (x.billNo ? '<br><small class="muted">Bill ' + esc(x.billNo) + '</small>' : ''), claim = x.insurance ? 'Yes' : 'No', svc = x.service ? 'Yes' : 'No';
    return ls.map((l, j) => { sr++; if (l.amount !== '') sa += l.amount; if (l.gst !== '') sg += l.gst; sw += l.withGst; st += l.withGst; l.cg.forEach((c, i) => { if (c[0] !== '') sc[i][0] += c[0]; if (c[1] !== '') sc[i][1] += c[1]; });
      return '<tr' + (l.ins ? ' class="mt-insrow"' : '') + '><td>' + sr + '</td>' +
        (j ? '' : '<td rowspan="' + n + '">' + esc(showDate(x.date)) + '</td><td rowspan="' + n + '" class="mc">' + party + '</td><td rowspan="' + n + '" class="n">' + (has(x.km) ? fmt(x.km) : '') + '</td>') +
        '<td class="mc">' + esc(l.part) + '</td><td class="n">' + (has(l.qty) ? fmt(l.qty) : '') + '</td><td>' + esc(l.uom) + '</td><td class="n">' + (has(l.rate) ? money(l.rate) : '') + '</td>' +
        '<td class="n">' + (l.amount === '' ? '' : money(l.amount)) + '</td>' + l.cg.map(c => '<td class="n">' + (c[0] === '' ? '' : money(c[0])) + '</td><td class="n">' + (c[1] === '' ? '' : money(c[1])) + '</td>').join('') +
        '<td class="n">' + (l.gst === '' ? '' : money(l.gst)) + '</td><td class="n">' + money(l.withGst) + '</td><td>' + esc(l.by) + '</td><td>' + claim + '</td><td>' + svc + '</td><td class="n">' + money(l.withGst) + '</td></tr>'; }).join('');
  }).join('');
  return '<table class="mlb"><thead><tr><th style="white-space:nowrap;min-width:46px">Sr No</th><th>Date</th><th>Party Name</th><th class="n">Current Reading</th><th>Particulars</th><th class="n">Qty</th><th>Uom</th><th class="n">Basic Rate</th><th class="n">Amount</th>' +
    rates.map(r => '<th class="n">CGST ' + fmt(r / 2) + '%</th><th class="n">SGST ' + fmt(r / 2) + '%</th>').join('') + '<th class="n">' + (rates.length === 1 && !asIs ? 'GST ' + fmt(rates[0]) + '%' : 'GST Amount') + '</th><th class="n">Amount With GST</th><th>Paid by</th><th>Insurance claim</th><th>Service</th><th class="n">Total</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="' + nc + '" class="none">No maintenance bill of this machinery in these dates.</td></tr>') + '</tbody><tfoot>' +
    '<tr class="grand"><td colspan="8">Total – ' + bills.length + ' bill(s)</td><td class="n">' + money(r2(sa)) + '</td>' + sc.map(c => '<td class="n">' + money(r2(c[0])) + '</td><td class="n">' + money(r2(c[1])) + '</td>').join('') +
    '<td class="n">' + money(r2(sg)) + '</td><td class="n">' + money(r2(sw)) + '</td><td></td><td></td><td></td><td class="n">' + money(r2(st)) + '</td></tr>' +
    (free > 0 ? '<tr class="sub"><td colspan="' + (nc - 1) + '">Free lines (warranty / FOC / service plan) – not paid, worth</td><td class="n">' + money(free) + '</td></tr>' : '') + '</tfoot></table>';
}
// the log book attached to a requirement: its title, up to which date, the table – one piece of HTML the web page and the app print as it is
function htmlOf(m, bills, upto) {
  const last = bills.filter(x => x.service).slice(-1)[0];
  return '<div class="mlbw"><div class="mlbt">Maintenance Log Book – ' + esc(m.no) + (m.name ? ' · ' + esc(m.name) : '') + (m.type ? ' · ' + esc(m.type) : '') + '</div>' +
    '<div class="mlbs">Up to ' + esc(showDate(upto)) + ' · ' + bills.length + ' bill(s)' + (last ? ' · Last service ' + esc(showDate(last.date)) + (last.km !== '' ? ' (' + fmt(last.km) + ')' : '') : '') + '</div>' + tableOf(bills) + '</div>';
}
// its look on the paper (A4 – small letters, every column on the page)
// (each cell its own letters: a print page without a doctype gives a table no letters of its page; every column on the A4 page)
const CSS = '.mlbw{font:8px Arial,sans-serif}.mlbt{font:700 13px Arial,sans-serif;text-align:center;margin:0 0 2px}.mlbs{font:10px Arial,sans-serif;text-align:center;margin:0 0 6px}' +
  '.mlb{border-collapse:collapse;width:100%}.mlb th,.mlb td{font:7.5px/1.25 Arial,sans-serif;border:1px solid #000;padding:1px 2px;vertical-align:top}.mlb th{background:#f1f1f1;font-weight:700}' +
  '.mlb .n{text-align:right;white-space:nowrap}.mlb td:nth-child(2){white-space:nowrap}.mlb small{font-size:7px}.mlb tfoot td{font-weight:700}.mlb .muted{color:#555}.mlb .none{text-align:center;padding:8px}';

module.exports = { billsOf, infoOf, tableOf, htmlOf, CSS, mlogSpread, maintAllLinesOf_, maintLinesOf_, maintInsOf_, noKey_ };
