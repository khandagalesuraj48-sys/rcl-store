/* THE OLD INWARD REGISTER, READ ON THE PAGE (28-10-2026, his "INWARD UPTO GRN … .xlsx": "ata auto vendor and item banayla hawet …
 * duplicate entry mala dakhaw mi swata delete krel … je GRN number chalu aahet tech continue hotil … ji excel diley tech column GRN /
 * inward madhe de"). Pure – no page, no network (the page draws it, the unit test runs it on a copy of his file):
 *   pickSheet  – the sheet with the inward register's heading (GRN No · Material · Qty …) and the most rows; the other sheets (Summary,
 *                a material's own record) are not the register
 *   readRows   – every row in his columns (Sr No · GRN No · GRN Date · Challan No · Invoice No. · Invoice Date · Vehicle No · Supplier
 *                Name · Material Description · Received Qty · UOM · Basic Rate · Taxable Amount · GST Amount · TCS · Gross Amount ·
 *                Remark); a GRN's date, supplier, invoice, challan, vehicle on its first row only: the rows under it of the same GRN No
 *   plan       – with the names he ticked, the rows he deleted and what he typed into a row: the GRNs (a GRN No + date + supplier +
 *                invoice = one GRN), the rows to look at (left out until corrected), the same row twice in the file (shown – he deletes
 *                what he wants), the GRNs already in the Store (never twice), the new suppliers and items, the notes.
 * The server checks every part again (lib/grnimport.js) – the same units and amounts. */
(function (root) {
  'use strict';
  const keyOf = s => String(s === undefined || s === null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const clean = (v, n) => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 200);
  const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  // the columns of his register (a heading of two lines – "Received\nQty" – read as one)
  const COLS = [['sr', /^(sr|s)\.?\s*no\b/], ['ref', /^grn\s*\.?\s*no/], ['date', /^grn\s*date|^date$/], ['challan_no', /challan/], ['invoice_no', /^(invoice|inv|bill)\.?\s*no/],
    ['invoice_date', /^(invoice|inv|bill)\.?\s*date|^invoive/], ['vehicle_no', /vehicle/], ['party', /supplier|party|vendor/], ['item', /material|^item|particular|description/],
    ['qty', /received\s*qty|^qty|quantity|inw(a|o)rd\s*qty/], ['uom', /^uom$|^unit$/], ['rate', /basic\s*rate|^rate/], ['taxable', /taxable|basic\s*amount/],
    ['gst', /gst\s*(amount|amt)|^gst$/], ['gst_pct', /gst\s*%|gst\s*rate/], ['tcs', /^tcs/], ['gross', /gross|total\s*amount|net\s*amount/], ['remark', /remark/]];
  const HEAD = ['Sr No', 'GRN No', 'GRN Date', 'Challan No', 'Invoice No.', 'Invoice Date', 'Vehicle No', 'Supplier Name', 'Material Description', 'Received Qty', 'UOM', 'Basic Rate',
    'Taxable Amount', 'GST Amount', 'TCS', 'Gross Amount', 'Remark'];
  const normH = h => String(h === undefined || h === null ? '' : h).replace(/\s+/g, ' ').trim().toLowerCase();
  function headOf(aoa) {
    for (let i = 0; i < Math.min(25, aoa.length); i++) {
      const h = (aoa[i] || []).map(normH), col = {};
      COLS.forEach(([k, re]) => { const j = h.findIndex((c, n) => c && re.test(c) && !Object.values(col).includes(n)); if (j > -1) col[k] = j; });
      if (col.item !== undefined && col.qty !== undefined && (col.ref !== undefined || col.date !== undefined)) return { hi: i, col: col };
    }
    return null;
  }
  // the sheet that is the register: its heading, the most rows with a material
  function pickSheet(sheets) {
    let best = null; const others = [];
    (sheets || []).forEach(s => {
      const h = headOf(s.aoa || []);
      const n = h ? (s.aoa || []).slice(h.hi + 1).filter(r => r && clean(r[h.col.item])).length : 0;
      if (h && (!best || n > best.n)) { if (best) others.push(best.name); best = { name: s.name, aoa: s.aoa, r0: s.r0 || 0, hi: h.hi, col: h.col, n: n }; } else others.push(s.name);
    });
    return best ? Object.assign(best, { others: others }) : null;
  }
  // a number of the file: 1,180.00 · ₹ 650 · "4.000" – what is not one: null (as the server's)
  function numIn(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const s = String(v).replace(/[,₹\s]/g, '').replace(/^rs\.?/i, '');
    return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : null;
  }
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  // a date of the file: Excel's day number, 30-Nov-2022, 30-11-2022, 30/11/2022, 2022-11-30 – what is not one: '' (its text kept to show)
  function dayIn(v) {
    if (v === null || v === undefined || v === '') return '';
    const ok = (y, m, d) => { if (y < 100) y += 2000; const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : ''; };
    if (v instanceof Date) return isNaN(v) ? '' : ok(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number') { if (!(v > 0 && v < 2958466)) return ''; const t = new Date(Math.round((v - 25569) * 86400000)); return t.toISOString().slice(0, 10); }
    const s = String(v).trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s); if (m) return ok(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/. ,]*(\d{2,4})$/.exec(s); if (m && MON[m[2].toLowerCase().slice(0, m[2].length > 4 ? 4 : 3)] || (m && MON[m[2].toLowerCase().slice(0, 3)])) return ok(+m[3], MON[m[2].toLowerCase().slice(0, 3)], +m[1]);
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s); if (m && (m[3].length === 4 || m[3].length === 2)) return ok(+m[3], +m[2], +m[1]);
    return '';
  }
  // a GRN No of the file: 1 → "1", "8029`" → "8029", "342 B" → "342 B"; one with no digit in it ("x", "`", "dcx"): none
  function refIn(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return isFinite(v) ? String(Math.round(v * 1000) / 1000) : '';
    const s = clean(v, 30).replace(/^[^0-9A-Za-z]+|[^0-9A-Za-z]+$/g, '');
    return /\d/.test(s) ? s : '';
  }
  // every row of the register in his columns (line = its row in Excel); a GRN's details on its first row only – the rows under it of the same GRN No
  function readRows(sheet) {
    const c = sheet.col, out = [], last = {};
    const g = (r, k) => c[k] === undefined ? '' : r[c[k]];
    (sheet.aoa || []).slice(sheet.hi + 1).forEach((r, n) => {
      if (!r) return;
      const o = { line: (sheet.r0 || 0) + sheet.hi + n + 2 };
      COLS.forEach(([k]) => { o[k] = g(r, k); });
      if (!['ref', 'date', 'party', 'item', 'qty', 'taxable', 'gross', 'invoice_no'].some(k => clean(o[k]))) return;      // an empty row
      o.refText = clean(o.ref, 30); o.ref = refIn(o.ref); o.dateText = clean(o.date instanceof Date ? '' : o.date, 20); o.date = dayIn(o.date); o.invoice_date = dayIn(o.invoice_date);
      ['challan_no', 'invoice_no', 'vehicle_no', 'party', 'item', 'uom', 'remark'].forEach(k => { o[k] = clean(o[k], k === 'item' ? 120 : 80); });
      if (o.ref) {
        const L = last[o.ref];
        if (L) ['date', 'party', 'invoice_no', 'invoice_date', 'challan_no', 'vehicle_no'].forEach(k => { if (!o[k] && L[k] && !(k === 'date' && o.dateText)) o[k] = L[k]; });
        last[o.ref] = Object.assign(last[o.ref] || {}, ...['date', 'party', 'invoice_no', 'invoice_date', 'challan_no', 'vehicle_no'].filter(k => o[k]).map(k => ({ [k]: o[k] })));
      }
      out.push(o);
    });
    return out;
  }
  // (as the server's lib/grnimport.js) a unit of the file → the Item Master's; a GST % from its amount
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
  function unitOf(raw) {
    const k = String(raw === undefined || raw === null ? '' : raw).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!k) return { unit: 'Nos', note: 'no unit in the file – Nos' };
    const u = UNIT_OF[k] || UNIT_OF[k.replace(/s$/, '')];
    return u ? { unit: u, note: '' } : { unit: 'Nos', note: 'unit "' + clean(raw, 12) + '" – taken as Nos' };
  }
  function gstPctOf(taxable, gst) {
    const t = Number(taxable) || 0, g = Number(gst) || 0;
    if (!(t > 0) || !(g > 0)) return 0;
    for (const p of [5, 12, 18, 28, 3, 0.25]) if (Math.abs(r2(t * p / 100) - g) <= 1) return p;
    return r2(g / t * 100);
  }
  // a material written as a number only ("45706", "3100 - 02") or as a heading ("Description"): not a name – the row to look at
  const NOT_NAME = /^\s*(description|material|material description|item|items|item name|particulars|name)\s*$/i;
  const STD_GST = [0.25, 3, 5, 12, 18, 28];
  const inr = v => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // the GRN Nos whose date is more than 6 months from the dates of the 5 GRN Nos before and after it (a date he typed is his)
  function farDates(list, today) {
    const at = {};
    list.forEach(x => { if (/^\d{1,9}$/.test(x.ref) && x.date && x.date >= '2000-01-01' && x.date <= today && !at[x.ref]) at[x.ref] = x; });      // (a date after today or too old is said on its own)
    const refs = Object.keys(at).map(Number).sort((a, b) => a - b), out = {}, dn = d => Date.parse(d + 'T00:00:00Z') / 864e5;
    refs.forEach((n, i) => {
      const x = at[n]; if (x.typed) return;
      const around = refs.slice(Math.max(0, i - 5), i).concat(refs.slice(i + 1, i + 6)).map(m => at[m].date).sort();
      if (around.length < 4) return;
      const mid = around[Math.floor(around.length / 2)];
      if (Math.abs(dn(x.date) - dn(mid)) > 183) out[n] = { date: x.date, near: MONTHS[Number(mid.slice(5, 7)) - 1] + ' ' + mid.slice(0, 4) };
    });
    return out;
  }
  const docKey = (ref, date, supplier, invoice) => [clean(ref, 30).toUpperCase(), String(date || '').slice(0, 10), keyOf(supplier), keyOf(invoice)].join('|');
  const title = s => clean(s, 40).toLowerCase().replace(/(^|[\s\-/&(])([a-z])/g, (x, p, c) => p + c.toUpperCase());
  const most = m => { let b = '', n = -1; Object.keys(m).forEach(k => { if (m[k] > n) { b = k; n = m[k]; } }); return b; };

  /* THE PLAN – what the Import will do, from the rows and what he chose:
   *   info: the server's regInfo (items [[code, name, unit, category]], vendors [names], grns [[key, ref, no, date, supplier]], next, today)
   *   ch:   { fix: { party: { from: to }, item: {…}, category: {…} } (the names ticked), gone: { line: true } (rows deleted),
   *           edit: { line: { date, qty, party, item } } (typed into a row to look at) } */
  function plan(rows, info, ch, today) {
    ch = ch || {}; info = info || {};
    const fix = ch.fix || {}, gone = ch.gone || {}, edit = ch.edit || {};
    // a name ticked: its right spelling (a right spelling ticked again as another's: followed)
    const F = (k, v) => { let x = v; for (let i = 0; i < 5; i++) { const y = fix[k] && fix[k][x]; if (!y || y === x) break; x = y; } return x; };
    const look = [], notes = [], dups = [], seenRow = {}, empty = [];
    const t = today || new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    const remarkN = {}; rows.forEach(r => { const k = keyOf(r.remark); if (k) remarkN[k] = (remarkN[k] || 0) + 1; });
    const ok = [];
    // a GRN date far from the GRNs around it (GRN No before and after it – the register goes on by date): "38558" for 2025 typed as 2005
    const far = farDates(rows.map(r0 => { const e = edit[r0.line] || {}; return { ref: r0.ref, date: e.date ? dayIn(e.date) : r0.date, typed: !!e.date }; }), t);
    rows.forEach(r0 => {
      const e = edit[r0.line] || {}, r = Object.assign({}, r0);
      if (e.date) r.date = dayIn(e.date) || ''; if (e.qty !== undefined && e.qty !== '') r.qty = e.qty; if (e.party) r.party = clean(e.party, 80); if (e.item) r.item = clean(e.item, 120);
      r.party = F('party', r.party); r.item = F('item', r.item);
      // the same row twice in the file (every column the same, not its Sr No): shown – he deletes what he wants, the rest is imported as it is
      const dk = JSON.stringify(['ref', 'date', 'challan_no', 'invoice_no', 'invoice_date', 'vehicle_no', 'party', 'item', 'qty', 'uom', 'rate', 'taxable', 'gst', 'gst_pct', 'tcs', 'gross', 'remark'].map(k => String(r0[k] === undefined || r0[k] === null ? '' : r0[k])));
      if (seenRow[dk]) dups.push({ line: r.line, first: seenRow[dk], row: r0, gone: !!gone[r.line] }); else seenRow[dk] = r.line;
      if (gone[r.line]) return;
      // a row with only its GRN No, date or supplier (no material, no quantity, no amount): nothing to import – counted
      if (!clean(r.item) && !clean(r.qty) && ![r.rate, r.taxable, r.gst, r.gross].some(v => numIn(v))) { empty.push(r.line); return; }
      const why = [];
      if (keyOf(r.item).length < 2 || !/[a-z]/i.test(r.item) || NOT_NAME.test(r.item)) why.push(r.item ? 'material "' + r.item + '" is not a name' : 'no material');
      if (!r.date) why.push(r.dateText ? 'GRN date "' + r.dateText + '" is not a date' : 'no GRN date');
      else if (r.date > t) why.push('GRN date ' + r.date.split('-').reverse().join('-') + ' is after today');
      else if (r.date < '2000-01-01') why.push('GRN date ' + r.date.split('-').reverse().join('-') + ' is too old');
      else if (far[r.ref] && !e.date && far[r.ref].date === r.date) why.push('GRN date ' + r.date.split('-').reverse().join('-') + ' – the GRNs around GRN No ' + r.ref + ' are of ' + far[r.ref].near);
      if (keyOf(r.party).length < 2) why.push('no supplier');
      let q = numIn(r.qty);
      const amt = numIn(r.taxable) || numIn(r.gross) || 0;
      if ((q === null || q === 0) && clean(r.qty) && numIn(r.qty) === null) why.push('quantity "' + clean(r.qty, 20) + '" is not a number');
      else if (q === null || q <= 0) { if (amt > 0 && (q === null || q === 0)) { q = 1; notes.push({ line: r.line, ref: r.ref, msg: 'no quantity – Qty 1 for its amount ₹' + amt }); } else why.push('no quantity'); }
      if (why.length) { look.push({ line: r.line, ref: r.ref || r.refText, date: r.date, party: r.party, item: r.item, qty: clean(r.qty, 20), why: why }); return; }
      r.qtyN = q;
      ok.push(r);
    });
    // the GRNs: a GRN No + date + supplier + invoice is one GRN (the same GRN No of another supplier / date / invoice: a GRN of its own)
    // (a GRN without a GRN No got a number at its import: the same GRN when its date, supplier and invoice are – as the server's)
    const there = {}, refThere = {}, noRef = k => '*' + k.replace(/^[^|]*/, '');
    (info.grns || []).forEach(g => { there[g[0]] = g; there[noRef(g[0])] = g; refThere[String(g[1]).toUpperCase()] = g; });
    const byKey = {}, docs = [], already = [];
    const items = {}, sup = {}, itemsHave = {}, supHave = {};
    (info.items || []).forEach(i => { itemsHave[keyOf(i[1])] = i; });
    (info.vendors || []).forEach(v => { supHave[keyOf(v)] = v; });
    // a row without a GRN No with the date, supplier and invoice (or none) of a GRN No of the file: a line of that GRN (its GRN No left
    // blank – the server takes them as the same GRN too)
    const numbered = {}; ok.forEach(r => { if (r.ref) { const k2 = noRef(docKey(r.ref, r.date, r.party, r.invoice_no)); if (!numbered[k2]) numbered[k2] = r.ref; } });
    ok.forEach(r => {
      if (!r.ref) { const to = numbered[noRef(docKey('', r.date, r.party, r.invoice_no))]; if (to) { r.ref = to; notes.push({ line: r.line, ref: to, msg: 'no GRN No – the date, supplier and invoice of GRN No ' + to + ': one of its lines' }); } }
      const k = docKey(r.ref, r.date, r.party, r.invoice_no);
      let d = byKey[k];
      if (!d) { d = byKey[k] = { key: k, ref: r.ref, date: r.date, supplier: r.party, challan_no: r.challan_no, invoice_no: r.invoice_no, invoice_date: r.invoice_date, vehicle_no: r.vehicle_no, lines: [], first: r.line };
        const was = r.ref ? there[k] : there[noRef(k)];
        if (was) { d.there = was; already.push(d); } else docs.push(d); }
      const u = unitOf(r.uom); if (u.note) notes.push({ line: r.line, ref: r.ref, msg: u.note });
      const rate = numIn(r.rate), tx = numIn(r.taxable), gs = numIn(r.gst), tc = numIn(r.tcs), gr = numIn(r.gross);
      const taxable = tx !== null ? tx : r2(r.qtyN * (rate || 0)), gst = gs !== null ? gs : (numIn(r.gst_pct) > 0 ? r2(taxable * numIn(r.gst_pct) / 100) : 0);
      if (rate !== null && tx !== null && rate > 0 && Math.abs(r2(r.qtyN * rate) - tx) > 1) notes.push({ line: r.line, ref: r.ref, msg: 'Qty × Rate = ₹' + r2(r.qtyN * rate) + ', Taxable Amount ₹' + tx + ' (imported as the file)' });
      if (gr !== null && Math.abs(r2(taxable + gst + (tc || 0)) - gr) > 1) notes.push({ line: r.line, ref: r.ref, msg: 'Taxable + GST' + (tc ? ' + TCS' : '') + ' = ₹' + r2(taxable + gst + (tc || 0)) + ', Gross Amount ₹' + gr + ' (imported as the file)' });
      if (taxable + gst > 1e7) notes.push({ line: r.line, ref: r.ref, big: true, msg: 'Taxable ₹' + inr(taxable) + ' (' + r.qtyN + ' ' + (r.uom || '') + ' × ₹' + inr(rate || 0) + ') – above ₹1 crore: check the Qty, its unit and the Rate (imported as the file)' });
      d.lines.push({ line: r.line, item: r.item, qty: r.qtyN, unit: r.uom, rate: rate, taxable: taxable, gst: gst, gst_pct: numIn(r.gst_pct), tcs: tc, remark: r.remark });
      if (!d.there) {
        const ik = keyOf(r.item), it = items[ik] = items[ik] || { names: {}, units: {}, cats: {}, pct: {}, n: 0 };
        it.n++; it.names[r.item] = (it.names[r.item] || 0) + 1; it.units[u.unit] = (it.units[u.unit] || 0) + 1;
        const ck = keyOf(r.remark); if (ck && remarkN[ck] >= 20) { const c = title(F('category', title(r.remark))); it.cats[c] = (it.cats[c] || 0) + 1; }
        const p = gstPctOf(taxable, gst); if (STD_GST.includes(p)) it.pct[p] = (it.pct[p] || 0) + 1;
        const sk = keyOf(r.party), s = sup[sk] = sup[sk] || { names: {}, n: 0 }; s.n++; s.names[r.party] = (s.names[r.party] || 0) + 1;
      }
    });
    // a GRN No used already by another GRN of the Store (made there, or another supplier): imported too, said
    docs.forEach(d => { const g = d.ref && refThere[d.ref.toUpperCase()]; if (g && g[0] !== d.key) notes.push({ line: d.first, ref: d.ref, msg: 'GRN No ' + d.ref + ' is also the GRN No of the Store\'s GRN of ' + String(g[3]).split('-').reverse().join('-') + ' (' + g[4] + ')' }); });
    // each line its item's name as most rows write it (the same key = the same item)
    const nameOf = {}; Object.keys(items).forEach(k => { nameOf[k] = itemsHave[k] ? itemsHave[k][1] : most(items[k].names); });
    docs.forEach(d => d.lines.forEach(l => { l.item = nameOf[keyOf(l.item)] || l.item; }));
    // a row in another unit than its item's (the item's: the unit most of its rows have) – its quantity is counted as it is written
    const unitAt = {}; Object.keys(items).forEach(k => { unitAt[k] = itemsHave[k] ? itemsHave[k][2] : most(items[k].units); });
    docs.forEach(d => d.lines.forEach(l => { const u = unitOf(l.unit).unit, w = unitAt[keyOf(l.item)]; if (w && u !== w) notes.push({ line: l.line, ref: d.ref, msg: 'unit ' + u + ' – the item\'s unit is ' + w + ' (its quantity counted as written)' }); }));
    notes.sort((a, b) => (b.big ? 1 : 0) - (a.big ? 1 : 0) || a.line - b.line);
    const supName = {}; Object.keys(sup).forEach(k => { supName[k] = supHave[k] || most(sup[k].names); });
    docs.forEach(d => { d.supplier = supName[keyOf(d.supplier)] || d.supplier; });
    const newItems = Object.keys(items).filter(k => !itemsHave[k]).map(k => { const it = items[k], p = most(it.pct);
      return { name: nameOf[k], unit: most(it.units) || 'Nos', category: most(it.cats) || 'General', gst: p === '' ? '' : Number(p), rows: it.n }; });
    const newSup = Object.keys(sup).filter(k => !supHave[k]).map(k => ({ name: supName[k], rows: sup[k].n }));
    // numbered GRNs first (by their GRN No), then the GRNs without a GRN No (they get the next numbers after the file's last)
    const refN = d => { const n = parseInt(d.ref, 10); return d.ref && /^\d+$/.test(d.ref) ? n : d.ref ? (isNaN(n) ? 1e12 : n + 0.5) : 2e12; };
    docs.sort((a, b) => refN(a) - refN(b) || a.date.localeCompare(b.date) || a.first - b.first);
    const nums = docs.map(d => d.ref).filter(x => /^\d{1,9}$/.test(x)).map(Number), maxRef = nums.length ? Math.max(...nums) : 0;
    const gross = docs.reduce((a, d) => a + d.lines.reduce((s, l) => s + Number(l.taxable || 0) + Number(l.gst || 0) + Number(l.tcs || 0), 0), 0);
    const days = docs.map(d => d.date).sort(), nr = docs.filter(d => !d.ref).length;
    return { docs: docs, already: already, look: look, dups: dups, notes: notes, empty: empty, newItems: newItems, newSup: newSup, lines: docs.reduce((a, d) => a + d.lines.length, 0),
      gross: r2(gross), from: days[0] || '', to: days[days.length - 1] || '', maxRef: maxRef, first: Math.max(Number(info.next || 1), maxRef + 1), noRef: nr,
      next: Math.max(Number(info.next || 1), maxRef + 1) + nr };
  }
  // the names of the file with their rows – for the AI's list: suppliers, items, categories (a remark of 20 rows or more)
  function namesOf(rows) {
    const o = { party: {}, item: {}, category: {} }, remN = {};
    rows.forEach(r => { const k = keyOf(r.remark); if (k) remN[k] = (remN[k] || 0) + 1; });
    rows.forEach(r => { if (r.party) o.party[r.party] = (o.party[r.party] || 0) + 1; if (r.item) o.item[r.item] = (o.item[r.item] || 0) + 1;
      if (r.remark && remN[keyOf(r.remark)] >= 20) { const c = title(r.remark); o.category[c] = (o.category[c] || 0) + 1; } });
    return o;
  }
  const RG = { COLS, HEAD, headOf, pickSheet, numIn, dayIn, refIn, readRows, unitOf, gstPctOf, docKey, farDates, plan, namesOf, keyOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = RG; else root.RSG = RG;
})(this);
