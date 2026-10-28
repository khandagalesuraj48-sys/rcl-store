/* THE OLD INWARD REGISTER IMPORTED AS IT IS (28-10-2026, his file "INWARD UPTO GRN … .xlsx", sheet "MAIN SHEET INWARD1": 20,538 rows,
 * 6,982 GRNs, 1,200 suppliers; asked: "auto vendor and item banayla hawet … duplicate entry mala dakhaw mi swata delete krel … je GRN
 * number chalu aahet tech continue hotil … next GRN ata jo continue ahe tyach pudhcha auto yeil … ji excel diley tech column GRN /
 * inward madhe de"; his answers: the suppliers into the site's Vendor Master (Mechanical's) as "Material Supplier"; the file's GRN No
 * kept as it is – a supplier / date / invoice of a GRN No its own GRN, the number shown as in the file (342-A too); every name an
 * item – the names written in more than one way listed by the AI, he ticks; the GRNs counted in the stock (the Issue register next).
 * The rules here (pure – tested on their own): a unit as the Item Master writes it, a GRN of the file checked, the key that says a
 * GRN is already in the Store (never twice). The page reads the file; the server checks every part again. */
'use strict';
const I = require('./items');
const clean = I.clean;
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const r3 = n => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const err = m => { const e = new Error(m); e.user = true; throw e; };

/* ---------- a unit of the file → the Item Master's (his 147 ways of writing them: nos, no., Nos , each, pcs, kgs, rmtr, jab …) ---------- */
const UNIT_OF = {};
[['Nos', 'nos no nos. no. each ea pcs pc pis psc piece pieces nis nios noss unit units item items qty number numbers 1 pos os'],
  ['Kg', 'kg kgs kilo kilogram kilograms'], ['Gram', 'gm gms grm gram grams g'], ['Ltr', 'ltr ltrs l litre litres liter liters'], ['Ml', 'ml'],
  ['Mtr', 'mtr mtrs m meter meters metre metres rmtr rmtrs rmt rm'], ['Feet', 'feet ft fit foot rft'], ['Sqm', 'sqm sqmtr sqmt sq m2 sqmeter'], ['Sqft', 'sqft sqf saft'],
  ['Cum', 'cum m3 cbm cumtr'], ['Brass', 'brass'], ['Ton', 'mt ton tons tonne'], ['Box', 'box boxes'], ['Pkt', 'pkt pkts packet packets pak pack'],
  ['Set', 'set sets'], ['Kit', 'kit kits'], ['Pair', 'pair pairs pr paire piar'], ['Roll', 'roll rolls'], ['Bag', 'bag bags'], ['Bundle', 'bundle bundles bandal bdl bnd bunddle boundle bls bals'],
  ['Book', 'book books'], ['Ream', 'ream rim rims'], ['Job', 'job jobs jab'], ['Trip', 'trip trips'], ['Month', 'month months'], ['Day', 'day days'], ['Hrs', 'hrs hr hour hours'],
  ['Jar', 'jar jars'], ['Bottle', 'bottle bottles botle'], ['Can', 'can cans tin tins teen'], ['Drum', 'drum drums barrel'], ['Bucket', 'bucket buckets bkt'],
  ['Cylinder', 'cylinder cyl cly cyle cy'], ['Coil', 'coil coils'], ['Lot', 'lot lots'], ['Case', 'case cases cuse'], ['Sheet', 'sheet sheets'], ['Yard', 'yard yrd yards']]
  .forEach(([u, ws]) => ws.split(' ').forEach(w => { UNIT_OF[w] = u; }));
// a unit of the file as the Item Master writes it; one not known (a size, a word): Nos, said
function unitOf(raw) {
  const k = String(raw === undefined || raw === null ? '' : raw).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!k) return { unit: 'Nos', note: 'no unit in the file – Nos' };
  const u = UNIT_OF[k] || UNIT_OF[k.replace(/s$/, '')];
  return u ? { unit: u, note: '' } : { unit: 'Nos', note: 'unit "' + clean(raw, 12) + '" – taken as Nos' };
}

/* ---------- a GST % from its amount: a usual rate when it makes it to ₹1 (whole rupees in an old file), else the % itself ---------- */
function gstPctOf(taxable, gst) {
  const t = Number(taxable) || 0, g = Number(gst) || 0;
  if (!(t > 0) || !(g > 0)) return 0;
  for (const p of [5, 12, 18, 28, 3, 0.25]) if (Math.abs(r2(t * p / 100) - g) <= 1) return p;
  return r2(g / t * 100);
}

/* ---------- a number of the file: 1,180.00 · ₹ 650 · "4.000" – what is not one: null ---------- */
function numIn(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).replace(/[,₹\s]/g, '').replace(/^rs\.?/i, '');
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : null;
}

/* ---------- the key that says a GRN of the file is already in the Store: its GRN No, date, supplier and invoice ---------- */
const docKey = (ref, date, supplier, invoice) => [clean(ref, 30).toUpperCase(), String(date || '').slice(0, 10), I.keyOf(supplier), I.keyOf(invoice)].join('|');

/* ---------- one GRN of the file, checked: its items must be in the Item Master (made first), every value as the file has it ----------
 * d: { ref, date, supplier, challan_no, invoice_no, invoice_date, vehicle_no, remark, lines: [{ line, item, qty, unit, rate, taxable,
 *      gst, gst_pct, tcs, remark }] } · byKey: the site's items by their name's key · today: yyyy-mm-dd
 * A line's amounts: its Taxable Amount (else Qty × Rate), its Basic Rate (else Taxable ÷ Qty), its GST Amount (else from its GST %),
 * its GST % (else from its amount). TCS: the lines' added, on the GRN. The same item twice in one GRN is kept as two lines (as the file). */
function checkDoc(d, byKey, today) {
  d = d || {};
  const ref = clean(d.ref, 30), date = String(d.date || '').slice(0, 10);
  const where = (ref ? 'GRN ' + ref : 'A GRN without its number') + ' (' + (date || 'no date') + ')';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date + 'T00:00:00Z'))) err(where + ': its GRN date is not a date.');
  if (date < '2000-01-01' || date > today) err(where + ': its GRN date ' + date.split('-').reverse().join('-') + ' is ' + (date > today ? 'after today' : 'too old') + '.');
  const supplier = clean(d.supplier, 80); if (I.keyOf(supplier).length < 2) err(where + ': no supplier.');
  let inv = clean(d.invoice_date, 10); if (inv && (!/^\d{4}-\d{2}-\d{2}$/.test(inv) || isNaN(Date.parse(inv + 'T00:00:00Z')))) inv = '';
  const rows = Array.isArray(d.lines) ? d.lines : [];
  if (!rows.length) err(where + ': no line.');
  if (rows.length > 400) err(where + ': more than 400 lines.');
  let tcs = 0;
  const lines = rows.map((y, i) => {
    const at = where + ', row ' + (y && y.line ? y.line : i + 1);
    const it = byKey[I.keyOf(y && y.item)];
    if (!it) err(at + ': "' + clean(y && y.item, 60) + '" is not in the Item Master.');
    const qty = numIn(y.qty); if (qty === null || !(qty > 0)) err(at + ': no quantity.');
    let rate = numIn(y.rate), taxable = numIn(y.taxable), gst = numIn(y.gst), pct = numIn(y.gst_pct);
    if (taxable === null) taxable = r2(qty * (rate || 0));
    if (rate === null) rate = qty > 0 ? r2(taxable / qty) : 0;
    if (rate < 0) err(at + ': its rate is below 0.');
    if (gst === null) gst = pct !== null && pct > 0 ? r2(taxable * pct / 100) : 0;
    if (pct === null) pct = gstPctOf(taxable, gst);
    const t = numIn(y.tcs); if (t !== null) tcs += t;
    const u = unitOf(y.unit);
    return { line: i + 1, code: it.code, name: it.name, unit: u.unit, qty: r3(qty), rate: r2(rate), taxable: r2(taxable), gst_pct: r2(pct), gst: r2(gst), gross: r2(taxable + gst), po_line: null,
      remark: clean(y.remark, 120) || null };
  });
  const sum = k => r2(lines.reduce((s, l) => s + l[k], 0));
  return { key: docKey(ref, date, supplier, d.invoice_no),
    head: { ref: ref || null, date: date, supplier: supplier, challan_no: clean(d.challan_no, 40) || null, invoice_no: clean(d.invoice_no, 40) || null, invoice_date: inv || null,
      vehicle_no: clean(d.vehicle_no, 20).toUpperCase().replace(/\s+/g, '') || null, po_no: null, taxable: sum('taxable'), gst: sum('gst'), tcs: r2(tcs), gross: r2(sum('gross') + tcs),
      remark: clean(d.remark, 300) || null }, lines: lines };
}

module.exports = { UNIT_OF, unitOf, gstPctOf, numIn, docKey, checkDoc };
