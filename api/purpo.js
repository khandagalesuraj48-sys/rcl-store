/* POST /api/purpo – (10-11-2026, Purchase Phase 2) PURCHASE'S PURCHASE ORDERS AT A SITE. The owner's decisions: D-2 – the PO's master
 * copy is kept in Purchase; the site keeps a COPY in its own Store, written only here (the Store's own server); an older revision never
 * overwrites a newer one. G-6 – no extra approval after the comparative statement's final approval: the copy comes approved and Open
 * (the site's PO approval and verification do not stop it). The site's GRNs and bills use the copy as any PO; it carries each line's
 * requirement and line (orderedOf counts it: what is still to order falls by itself). The site cannot change or delete it (api/work.js
 * refuses every change of a PO with pur_no). It answers ONLY Purchase's server (rcl-purchase lib/storelink.js), never a browser:
 *   { v: 1, op, ts, nonce, data, sig }   data: the question as JSON text; sig = HMAC-SHA256 with PUR_STORE_SECRET (the same long secret
 *   word as in the Purchase project, never in a file) of "rcl-pur-po|v1|<op>|<ts>|<nonce>|<data>"; ts – Purchase's clock, at most 5
 *   minutes off; nonce – 32 hex, used ONCE (noted with Purchase's Inbox questions in the first site's store_tickets, "pur-<nonce>").
 *   Not set: 503 and nothing else.
 *   op 'papers' { sites }            → { sites: [{ site, name, heading, start }] }  the site's heading and what a PO starts with (its
 *                                       shipping address, site contact, terms) – as the Store's own PO form and paper have them
 *   op 'put'    { site, po }         → { site, no, ref, rev, result: made | same | older | cancelled }   the copy written (step 10)
 *   op 'cancel' { site, po, why }    → { site, no, result: cancelled | same | none }   only while no GRN is made against it
 *   op 'state'  { q: [{ site, nos }], full } → { sites: [{ site, name, error?, heading?, pos: [{ pur_no, rev, no, ref, status, state,
 *                                       appr, lines: [{ line, code, name, unit, hsn, qty, rate, came, left, value, cameValue, leftValue }],
 *                                       grn_count, grns? }] }] }   each copy with every GRN made against it and its balance (read only)
 * Every write notes the site's activity ("PO from Purchase", "… (the same copy again)", "PO cancelled by Purchase"). Written fresh for RCL. */
'use strict';
const crypto = require('crypto');
const { handler, readBody, send, fail } = require('../lib/http');
const { db, dbAll, registry } = require('../lib/sites');
const { activity } = require('../lib/activity');
const W = require('../lib/work');
const R = require('../lib/sreport');
const inbox = require('./purinbox.js');

const WINDOW = 5 * 60 * 1000;
const OPS = ['papers', 'put', 'cancel', 'state'];
const secret = () => String(process.env.PUR_STORE_SECRET || '').trim();      // (a newline pasted with the value in Vercel is not part of it)
const NOT_SET = 'Purchase\'s link to the Store is not set up here (PUR_STORE_SECRET in Vercel – the same as in the Purchase project).';
const STEP10 = site => 'The Store\'s database step 10 is not run at site ' + site + ' yet: the Admin runs sql/store_step10_purchase_po.sql once in that site\'s Supabase → SQL Editor. Until then the PO stays in Purchase (Send again after it).';
const textOf = (op, ts, nonce, data) => ['rcl-pur-po', 'v1', op, ts, nonce, data].join('|');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const num = v => v === null || v === undefined || v === '' ? 0 : Number(v);
const site_ = v => { const c = String(v || '').toUpperCase(); if (!/^[A-Z0-9]{1,12}$/.test(c)) throw fail(400, 'No proper site.', 'shape'); return c; };
/* the question checked (no database): the secret set, its parts, its signature, its time → { op, ts, nonce, data } */
function check(x, key, now) {
  if (String(key || '').length < 24) throw fail(503, NOT_SET, 'setup');
  x = x || {};
  const ts = Number(x.ts), nonce = String(x.nonce || ''), op = String(x.op || ''), data = typeof x.data === 'string' ? x.data : null;
  if (x.v !== 1 || OPS.indexOf(op) === -1 || !Number.isSafeInteger(ts) || !/^[0-9a-f]{32}$/.test(nonce) || data === null || data.length > 2000000 || !/^[0-9a-f]{64}$/.test(String(x.sig || ''))) throw fail(400, 'Not a proper question.', 'shape');
  const want = crypto.createHmac('sha256', String(key)).update(textOf(op, ts, nonce, data)).digest('hex');
  if (!same(x.sig, want)) throw fail(401, 'Refused (the signature does not match).', 'sig');
  if (Math.abs((now || Date.now()) - ts) > WINDOW) throw fail(401, 'Refused (its time is more than 5 minutes off – check the clock).', 'time');
  let d; try { d = JSON.parse(data); } catch (e) { throw fail(400, 'Not a proper question.', 'shape'); }
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw fail(400, 'Not a proper question.', 'shape');
  return { op: op, ts: ts, nonce: nonce, data: d };
}
const work = () => require('./work.js')._po;      // (the Store's own reading of a site's papers and POs – api/work.js, used as it is)
async function readySite(code) {
  const st = (await registry()).find(y => y.code === code && y.status === 'ready');
  if (!st) throw fail(400, 'No Store at site ' + code + '.', 'site');
  return { code: st.code, name: st.name || st.code };
}
const step10On = site => work().colOn(site, 'store_po?select=pur_no&limit=1');

/* ---------- the copy as the Store keeps it: the same check as every PO (lib/work.js checkPo – the site's Item Master, the requirement's
 * line and item), its figures worked out here and compared with Purchase's (a paisa of rounding at most) ---------- */
async function rowOf(site, po) {
  po = po && typeof po === 'object' ? po : {};
  const pur = Number(po.pur_no), rev = Number(po.rev || 1);
  if (!Number.isInteger(pur) || pur < 1 || !Number.isInteger(rev) || rev < 1) throw fail(400, 'Not a proper PO (its number).', 'shape');
  const lines = Array.isArray(po.lines) ? po.lines : [];
  if (!lines.length) throw fail(400, 'A PO without lines.', 'shape');
  if (lines.some(l => !l || !Number.isInteger(Number(l.req_no)) || Number(l.req_no) < 1 || !Number.isInteger(Number(l.req_line)) || Number(l.req_line) < 1)) throw fail(400, 'Each line of a Purchase PO is a line of a requirement of the site.', 'shape');
  const [items, reqs] = await Promise.all([work().itemsOf(site), (async () => { const o = {}, rn = [...new Set(lines.map(l => Number(l.req_no)))];
    for (let i = 0; i < rn.length; i += 150) (await dbAll(site, 'store_req?select=no,status,lines&no=in.(' + rn.slice(i, i + 150).join(',') + ')', 'no')).forEach(r => { o[r.no] = r; });
    return o; })()]);
  const v = po.vendor && typeof po.vendor === 'object' ? po.vendor : {};
  let p;
  try {
    p = W.checkPo({ date: po.date, deliver_by: po.deliver_by, vendor: v.name, vendor_gst: v.gstin, terms: po.terms, remark: po.remark, site_contact: po.site_contact, ship_to: po.ship_to,
      freight: po.freight, load_unload: po.loading, lines: lines.map(l => ({ code: l.code, qty: l.qty, rate: l.rate, disc_pct: l.disc_pct, gst_pct: l.gst_pct === null || l.gst_pct === undefined ? '' : l.gst_pct, hsn: l.hsn || '',
        req_no: l.req_no, req_line: l.req_line, brand: l.brand || '', spec: l.spec || '' })) }, items, { reqs: reqs, had: new Set(lines.map(l => String(l.code || ''))) });
  } catch (e) { if (e && e.user) throw fail(400, e.message, 'field'); throw e; }
  const t = po.totals || {}, off = k => Math.abs(num(t[k]) - num(p[k])) > 0.011;
  if (['taxable', 'gst', 'total'].some(off)) throw fail(409, 'The PO\'s figures at the Store (taxable ' + p.taxable + ', GST ' + p.gst + ', total ' + p.total + ') are not Purchase\'s (' + [t.taxable, t.gst, t.total].join(', ') + ') – nothing kept.', 'figures');
  const by = po.by || {}, cs = po.cs || {};
  return Object.assign(p, { pur_no: pur, pur_rev: rev, appr_by: String(cs.approved_by || '').slice(0, 120), appr_name: String(cs.approved_name || '').slice(0, 120),
    appr_note: String(('From Purchase – ' + (po.ref || '') + ' · ' + (cs.ref ? cs.ref + ' approved' + (cs.approved_name ? ' by ' + cs.approved_name : '') : '')).trim()).slice(0, 300),
    pur: { ref: String(po.ref || '').slice(0, 30), cs: { no: Number(cs.no) || null, ref: String(cs.ref || '').slice(0, 30), approved_name: String(cs.approved_name || '').slice(0, 120), approved_at: cs.approved_at || null },
      rfq: { no: Number((po.rfq || {}).no) || null, ref: String((po.rfq || {}).ref || '').slice(0, 30) }, pay_terms: String(po.pay_terms || '').slice(0, 200),
      vendor: { name: String(v.name || '').slice(0, 80), gstin: String(v.gstin || '').slice(0, 15), pan: String(v.pan || '').slice(0, 10), address: String(v.address || '').slice(0, 300), phone: String(v.phone || '').slice(0, 20), email: String(v.email || '').slice(0, 120) },
      by: { email: String(by.email || '').slice(0, 120), name: String(by.name || '').slice(0, 120) }, at: new Date().toISOString() } });
}
const whoOf = po => { const b = (po && po.by) || {}; return { email: String(b.email || '').slice(0, 120) || 'purchase', name: String(b.name || 'Purchase').slice(0, 120) }; };
async function refOf(site, no, date) { const P = work(), [h, pp] = await Promise.all([P.headingOf(site, {}), P.papersOf(site)]); return W.refOf(P.prefixOf(pp, h, site), 'PO', date, no); }

const OP = {
  // the heading of each site's papers and what its PO starts with (the Store's PO form: the site's address and contact, the terms)
  async papers(d) {
    const P = work(), list = [...new Set((Array.isArray(d.sites) ? d.sites : []).map(site_))].slice(0, 40), out = [];
    for (const c of list) {
      try { const st = await readySite(c), [h, pp] = await Promise.all([P.headingOf(c, {}), P.papersOf(c)]);
        out.push({ site: c, name: (h && h.site) || st.name, heading: P.headOut(h, pp), start: P.startOf(h, pp), prefix: P.prefixOf(pp, h, c) }); }
      catch (e) { out.push({ site: c, name: c, error: e && e.status && e.status < 500 ? e.message : 'Could not be read now.' }); }
    }
    return { sites: out };
  },
  // the copy written – made (approved, Open), or the same one again (nothing changes – never twice)
  async put(d) {
    const site = site_(d.site); await readySite(site);
    if (!(await step10On(site))) throw fail(409, STEP10(site), 'step10');
    const row = await rowOf(site, d.po), who = whoOf(d.po);
    let r;
    try { r = await work().rpc(site, 'store_po_pur_put', { p_row: row, p_by: who.email, p_name: who.name }); }
    catch (e) {
      if (e && e.code === 'rule' && /^STORE_PUR_AMEND/.test(String(e.message))) throw fail(409, 'A later revision of ' + row.pur.ref + ' is not taken at the Store yet (a PO amendment comes later).', 'amend');
      if (e && e.code === 'notinstalled') throw fail(409, STEP10(site), 'step10');
      return work().said(e);
    }
    r = r || {};
    // (made: noted; the same copy again – noted too: the first answer may have been lost before its note)
    if (r.result === 'made' || r.result === 'same') { work().changed(site); await activity(site, who.email, r.result === 'made' ? 'PO from Purchase' : 'PO from Purchase (the same copy again)', 'PO ' + r.no, { pur: row.pur.ref, cs: row.pur.cs.ref, vendor: row.vendor, total: row.total, lines: row.lines.length, by: who.name }); }
    return { site: site, no: Number(r.no), rev: Number(r.rev), result: String(r.result || ''), ref: await refOf(site, Number(r.no), row.date) };
  },
  // the copy cancelled – only while no GRN is made against it; never at the site: kept as Cancelled (a late copy changes nothing)
  async cancel(d) {
    const site = site_(d.site); await readySite(site);
    if (!(await step10On(site))) throw fail(409, STEP10(site), 'step10');
    const why = String(d.why || '').replace(/\s+/g, ' ').trim().slice(0, 200), who = whoOf(d.po);
    if (why.length < 3) throw fail(400, 'Why is it cancelled?', 'field');
    const pur = Number((d.po || {}).pur_no); if (!Number.isInteger(pur) || pur < 1) throw fail(400, 'Not a proper PO (its number).', 'shape');
    const had = ((await db(site, 'GET', 'store_po?select=no&pur_no=eq.' + pur)) || [])[0];
    let row;
    if (had) row = { pur_no: pur, pur_rev: Number((d.po || {}).rev || 1), pur: {} };
    else { try { row = await rowOf(site, d.po); } catch (e) { if (e && e.status && e.status < 500) return { site: site, no: null, result: 'none' }; throw e; } }      // (it could never be made at this site as it is)
    const note = W.dmy(W.today()) + ' cancelled by Purchase (' + who.name + '): ' + why; row.why = why;
    let r;
    try { r = await work().rpc(site, 'store_po_pur_cancel', { p_row: row, p_note: note, p_by: who.email, p_name: who.name }); }
    catch (e) {
      const m = /^STORE_PO_RECEIVED (\d+)/.exec(String((e && e.message) || '')), c = /^STORE_PUR_CLOSED (\d+)/.exec(String((e && e.message) || ''));
      if (e && e.code === 'rule' && m) { const g = await dbAll(site, 'store_grn?select=*&po_no=eq.' + Number(m[1]), 'no').catch(() => []);
        throw fail(409, 'Material of this PO has come at site ' + site + ' – ' + (g.length ? g.length + ' GRN (' + g.map(x => R.refOf(x) + ' of ' + W.dmy(x.date)).join(', ') + ')' : 'a GRN has it') + ' – it is not cancelled.', 'received', { grns: g.map(x => R.refOf(x)) }); }
      if (e && e.code === 'rule' && c) throw fail(409, 'This PO is closed at site ' + site + ' – it is not cancelled.', 'closed');
      if (e && e.code === 'notinstalled') throw fail(409, STEP10(site), 'step10');
      return work().said(e);
    }
    r = r || {};
    if (r.result === 'cancelled') { work().changed(site); await activity(site, who.email, 'PO cancelled by Purchase', 'PO ' + r.no, { pur: 'PO-' + String(pur).padStart(4, '0'), why: why, by: who.name }); }
    return { site: site, no: r.no === null || r.no === undefined ? null : Number(r.no), result: String(r.result || '') };
  },
  // each copy as the site has it: its state, every GRN against it and its balance – read only
  async state(d) {
    const P = work(), q = (Array.isArray(d.q) ? d.q : []).slice(0, 40), full = d.full === true, out = [];
    for (const x of q) {
      const c = site_(x && x.site), nos = [...new Set((Array.isArray(x.nos) ? x.nos : []).map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 300);
      try {
        const st = await readySite(c);
        if (!(await step10On(c))) { out.push({ site: c, name: st.name, error: STEP10(c), pos: [] }); continue; }
        const [rows, h, pp] = await Promise.all([nos.length ? dbAll(c, 'store_po?select=*&pur_no=in.(' + nos.join(',') + ')', 'no') : [], P.headingOf(c, {}), P.papersOf(c)]);
        const grns = rows.length ? await P.grnsOfPos(c, rows.map(p => p.no), full ? '*,store_grn_lines(*)' : 'no,po_no,store_grn_lines(qty,po_line)') : [], rec = P.recOf(grns), pre = P.prefixOf(pp, h, c);
        const before = full ? P.beforeOf(grns) : {}, items = full ? await P.itemsOf(c) : {};
        const pos = rows.map(p => { const v = P.poView(p, rec), mine = grns.filter(g => Number(g.po_no) === Number(p.no)), hsn = {};
          (p.lines || []).forEach(l => { hsn[l.line] = l.hsn || (items[l.code] || {}).hsn || ''; });
          return Object.assign({ pur_no: Number(p.pur_no), rev: Number(p.pur_rev || 1), no: Number(p.no), ref: W.refOf(pre, 'PO', p.date, p.no), date: p.date, status: p.status, state: v.state, appr: v.appr,
            close_note: p.close_note || '', lines: W.poBalance(p, rec).map(l => Object.assign(l, { hsn: hsn[l.line] || '' })), grn_count: mine.length },
          full ? { grns: mine.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.no - b.no).map(g => { const lines = P.sortLines(g.store_grn_lines);
            return { no: g.no, ref: R.refOf(g), date: g.date, supplier: g.supplier, invoice_no: g.invoice_no, invoice_date: g.invoice_date, challan_no: g.challan_no, vehicle_no: g.vehicle_no, taxable: g.taxable, gst: g.gst, gross: g.gross,
              lines: lines.map(l => ({ line: l.line, code: l.code, name: l.name, unit: l.unit, qty: l.qty, rate: l.rate, taxable: l.taxable, gst_pct: l.gst_pct, po_line: l.po_line })), check: W.billCheck(lines, p, before[g.no] || {}) }; }) } : {}); });
        out.push(Object.assign({ site: c, name: (h && h.site) || st.name, pos: pos }, full ? { heading: P.headOut(h, pp) } : {}));
      } catch (e) { out.push({ site: c, name: c, error: e && e.status && e.status < 500 ? e.message : 'Could not be read now.', pos: [] }); }
    }
    return { sites: out };
  },
};

module.exports = handler(async (req, res) => {
  const key = secret();
  if (key.length < 24) throw fail(503, NOT_SET, 'setup');
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
  const q = check(await readBody(req), key, Date.now());
  await inbox.once(q.nonce, q.ts);
  send(res, 200, Object.assign({ ok: true }, await OP[q.op](q.data)));
});
module.exports.check = check;      // (for the unit test)
module.exports.textOf = textOf;
module.exports.rowOf = rowOf;
