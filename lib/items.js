/* ITEM MASTER – the rules of an item (pure functions: no database here, so they are tested on their own).
 * Asked 13-10-2026: "while an item is made, duplicates must be stopped – if Sugar is there and someone makes Sugaar, the
 * system stops, says Sugar is already there and asks; if the user says they are different, it is saved. Give the user a
 * correction suggestion for a proper name." Fields: name, unit, category, HSN, GST %, min stock (+ the code, the status). */
'use strict';
const UNITS = ['Nos', 'Kg', 'Ltr', 'Mtr', 'Set', 'Box', 'Pair', 'Bag', 'Ton', 'Roll', 'Pkt', 'Sqm', 'Cum'];
const clean = (v, n) => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n || 200);
// the key two names are THE SAME by: small letters, letters and digits only ("Oil-Filter" = "oil filter" = "OILFILTER")
const keyOf = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const digitsOf = s => (String(s || '').match(/\d+(?:\.\d+)?/g) || []).join('|');
const wordsOf = s => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// edit distance with a swap of two letters counted as one (Damerau–Levenshtein, the restricted form)
function dist(a, b) {
  const n = a.length, m = b.length; if (!n) return m; if (!m) return n;
  const d = []; for (let i = 0; i <= n; i++) { d[i] = [i]; } for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[n][m];
}
const squeeze = s => s.replace(/(.)\1+/g, '$1');            // "sugaar" → "sugar", "bolltt" → "bolt"
const single = w => w.replace(/(ies)$/, 'y').replace(/(ses|xes|zes|ches|shes)$/, m => m.slice(0, -2)).replace(/([^s])s$/, '$1');      // "filters" → "filter"
const allowed = len => len <= 4 ? 0 : len <= 8 ? 1 : len <= 15 ? 2 : 3;
/* is name B nearly name A (one of them a misspelling of the other)? Not when they are the same (that is a duplicate), and
 * never when their numbers differ ("Bolt M10" and "Bolt M12" are two items). Why it is near is said. */
function near(a, b) {
  const ka = keyOf(a), kb = keyOf(b);
  if (!ka || !kb || ka === kb) return '';
  if (digitsOf(a) !== digitsOf(b)) return '';
  if (squeeze(ka) === squeeze(kb)) return 'spelling';
  const wa = wordsOf(a).map(single), wb = wordsOf(b).map(single);
  if (wa.join('') === wb.join('')) return 'plural';
  if (wa.slice().sort().join(' ') === wb.slice().sort().join(' ')) return 'order';
  // word by word: every word that differs must be a misspelling of the other ("Oil Fliter" ~ "Oil Filter"), never another
  // word ("Air Filter" is not "Oil Filter")
  if (wa.length === wb.length) {
    let diff = 0;
    for (let i = 0; i < wa.length; i++) { if (wa[i] === wb[i]) continue; const lim = allowed(Math.max(wa[i].length, wb[i].length)); if (!lim || dist(wa[i], wb[i]) > lim) return ''; diff++; }
    return diff ? 'spelling' : '';
  }
  return Math.min(ka.length, kb.length) > 4 && dist(ka, kb) <= 1 ? 'spelling' : '';      // a space more or less AND a letter ("Oil Filtr" ~ "OilFilter")
}
// the items whose names are near this name (at most 5, the nearest first)
function similar(name, list, skipCode) {
  return (list || []).filter(x => x.code !== skipCode).map(x => ({ x: x, why: near(name, x.name), d: dist(keyOf(name), keyOf(x.name)) }))
    .filter(y => y.why).sort((p, q) => p.d - q.d).slice(0, 5).map(y => ({ code: y.x.code, name: y.x.name, unit: y.x.unit, category: y.x.category, why: y.why }));
}

/* ---------- a proper name: suggested, never forced ---------- */
// words of a store (spares, oils, tools, safety, site material, canteen) – a word typed close to one of these is suggested
const WORDS = ('absorber adapter adblue admixture aggregate air alternator angle anti antifreeze arm assembly axle bag ball barricade battery bearing belt binding bit bitumen blade block bolt bonnet boot bracket brake breaker brick brush bucket bulb bush bushing button '
  + 'cabin cable cap carbide cement chain chalk chisel clamp cleaner clip clutch coil compound compressor condenser cone connector coolant copper cord coupling cover crankshaft cup curing cutter cutting cylinder '
  + 'diesel differential disc distilled door drill drum dust elbow electrode element emulsion engine extinguisher fan filler filter fitting flange float fuel fuse gasket gauge gear gearbox geotextile glass gloves glue goggles grease grinder guard '
  + 'hammer handle head helmet hinge holder hook horn hose housing hub hydraulic idler indicator injector insulation iron jack jacket joint kerb kerosene key kit lamp lever light lime liner link lock lubricant '
  + 'manifold mask meter mirror motor mounting nail nozzle nut oil paint panel pedal petrol pin pipe piston plate pliers plug plywood primer pulley pump radiator reflector regulator relay rim ring rivet rod roller rope rubber '
  + 'safety sand screw seal sealant sensor shaft shim shoe shoes shuttering socket solenoid spanner spark spray spring sprocket starter steel sticker strainer strap switch tank tape tarpaulin tee thermostat tile timer tip tooth tube tyre '
  + 'valve washer water weld welding wheel wiper wire wrench sugar salt tea coffee milk rice wheat dal oil soap detergent broom bucket mug tissue water bottle stationery paper register pen pencil marker file').split(' ');
const KEEP = /^(?:[A-Z]{2,5}|[A-Z]+\d[A-Z0-9-]*|\d[\dA-Z-]*[A-Z][\dA-Z-]*)$/;      // PVC, HSD, GI, MS, M10, 3PH, 6205ZZ: kept as typed
const UNIT_FIX = { mm: 'mm', cm: 'cm', m: 'm', mtr: 'mtr', kg: 'kg', g: 'g', gm: 'gm', ltr: 'ltr', l: 'ltr', ml: 'ml', inch: 'inch', in: 'inch', ft: 'ft', hp: 'HP', kw: 'kW', kva: 'kVA', v: 'V', a: 'A', w: 'W', amp: 'A', sqmm: 'sq mm' };
function properName(name, known) {
  let s = clean(name, 120);
  // a number and its unit: "10mm" → "10 mm", "2.5SQMM" → "2.5 sq mm", "5L" → "5 ltr"
  s = s.replace(/(\d)\s*(sqmm|kva|mtr|ltr|inch|amp|mm|cm|kg|gm|ml|hp|kw|ft|in|m|g|l|v|a|w)\b/gi, (x, d, u) => d + ' ' + UNIT_FIX[u.toLowerCase()]);
  const vocab = new Set(WORDS.concat(...(known || []).map(n => wordsOf(n))));
  const fixes = [];
  s = s.split(' ').map(w => {
    if (KEEP.test(w) || Object.values(UNIT_FIX).indexOf(w) > -1) return w;
    if (/\d/.test(w)) return /[a-z]/i.test(w) ? w.toUpperCase() : w;      // a size or a part number: "m10" → "M10", "15w40" → "15W40"
    const lw = w.toLowerCase(), core = lw.replace(/[^a-z]/g, '');
    let out = lw;
    if (core.length >= 4 && !vocab.has(core)) {
      const lim = core.length <= 6 ? 1 : 2; let best = null, bd = 99;
      for (const v of vocab) { if (Math.abs(v.length - core.length) > lim) continue; const d = dist(core, v); if (d < bd && d <= lim) { best = v; bd = d; } }
      if (best) { out = lw.replace(core, best); fixes.push(core + ' → ' + best); }
    }
    return out.replace(/(^|[-/(])([a-z])/g, (x, p, c) => p + c.toUpperCase());
  }).join(' ');
  return { name: s, fixes: fixes };
}
const properCategory = c => clean(c, 40).toLowerCase().replace(/(^|[\s\-/&(])([a-z])/g, (x, p, ch) => p + ch.toUpperCase());

/* ---------- the fields ---------- */
// what was typed for one item, checked: { item } or throws a message for the person
function check(x, opt) {
  x = x || {};
  const name = clean(x.name, 120), unit = UNITS.find(u => u.toLowerCase() === clean(x.unit).toLowerCase()), category = properCategory(x.category);
  const err = m => { const e = new Error(m); e.user = true; throw e; };
  if (keyOf(name).length < 2) err('Enter the item name.');
  if (!unit) err('Pick the unit (' + UNITS.join(', ') + ').');
  if (category.length < 2) err('Enter the category (e.g. Spare Parts, Oil & Lubricants, Tools).');
  const hsn = clean(x.hsn).replace(/\s+/g, '');
  if (hsn && !/^(\d{4}|\d{6}|\d{8})$/.test(hsn)) err('HSN code "' + hsn + '" must be 4, 6 or 8 digits.');
  const gs = clean(x.gst); let gst = null;
  if (gs !== '') { gst = Number(gs.replace(/%$/, '')); if (!isFinite(gst) || gst < 0 || gst > 40 || Math.round(gst * 100) !== gst * 100) err('GST % "' + gs + '" must be a number from 0 to 40 (e.g. 5 or 18).'); }
  const ms = clean(x.minStock); let minStock = null;
  if (ms !== '') { minStock = Number(ms); if (!isFinite(minStock) || minStock < 0 || minStock > 1e9) err('Min stock "' + ms + '" must be 0 or more.'); }
  const status = (opt && opt.edit) ? (clean(x.status) === 'Inactive' ? 'Inactive' : 'Active') : 'Active';
  return { name: name, name_key: keyOf(name), unit: unit, category: category, hsn: hsn || null, gst_pct: gst, min_stock: minStock, status: status };
}
module.exports = { UNITS, keyOf, near, similar, properName, properCategory, check, dist, clean };
