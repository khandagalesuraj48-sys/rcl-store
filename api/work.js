/* POST /api/work { action, … } – THE STORE'S WORK of THIS SITE (step 2, 28-10-2026: "sagle banwayla chalu kr"):
 *   Material Requirement → its approvals, level by level (who approves: given by the Super Admin in the Portal)
 *   → Purchase Order (made by HO Purchase – "Store Purchase" – for every site; kept in that site's own database)
 *   → Inward (GRN: supplier, challan, invoice, vehicle, against its PO or direct) → the stock
 *   → Issue (Outward: site work / a sub-contractor / a machinery – it joins that machinery's maintenance log book in Mechanical –
 *     / office; location, side, use for, receiver; returnable) → Return;
 *   Opening stock; Stock & Reports (material / day / month / period wise); Excel in and out.
 * Every save is checked here (lib/work.js) and again inside the database (sql/store_step2_work.sql – one save at a time on the site,
 * an item's stock never below zero on any date). Each site's data stays in its own database; only Store Purchase reads every site. */
'use strict';
const { handler, readBody, send, sameSite, fail } = require('../lib/http');
const ses = require('../lib/session');
const { db, dbAll, registry } = require('../lib/sites');
const { activity } = require('../lib/activity');
const W = require('../lib/work');
const R = require('../lib/sreport');
const I = require('../lib/items');
const { r2, r3, dmy } = W;
const enc = encodeURIComponent;

const PAGE_NAME = { req: 'Material Requirements', grn: 'Inward (GRN)', issue: 'Issue & Return', reports: 'Stock & Reports', po: 'Purchase Orders' };
const can = (s, page, lvl) => { const v = (s.pages || {})[page]; return lvl === 'Edit' ? v === 'Edit' : v === 'Edit' || v === 'View'; };
function need(s, page, lvl) {
  if (can(s, page, lvl)) return;
  const v = (s.pages || {})[page];
  throw fail(403, lvl === 'Edit' && v === 'View' ? 'You may see ' + PAGE_NAME[page] + ' on this site, not add to it (View). Ask the Super Admin for Edit.' : 'You have no access to ' + PAGE_NAME[page] + ' on this site – ask the Super Admin.', 'page');
}
const adminOnly = (s, what) => { if (!s.admin) throw fail(403, 'Only the Store Admin can ' + what + '.', 'admin'); };
const isBuyer = s => (s.pages || {}).purchase === 'Edit';
const buyerOnly = s => { if (!isBuyer(s)) throw fail(403, 'Purchase orders are made by HO Purchase – "Store Purchase", given by the Super Admin in the Portal.', 'purchase'); };
const userErr = e => { if (e && e.user) throw fail(400, e.message, 'field'); throw e; };
const gone = what => fail(404, what + ' is not there any more (it may have been deleted) – refresh.', 'gone');
const num = v => v === null || v === undefined || v === '' ? 0 : Number(v);
const noOf = v => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw fail(400, 'No proper number.', 'field'); return n; };
const monthStart = () => W.today().slice(0, 8) + '01';
function period(x) {
  let from, to;
  try { from = W.dayOf(x.from || monthStart(), 'From date', { future: true }); to = W.dayOf(x.to || W.today(), 'To date', { future: true }); } catch (e) { userErr(e); }
  if (to < from) throw fail(400, 'The To date ' + dmy(to) + ' is before the From date ' + dmy(from) + '.', 'field');
  return { from: from, to: to };
}

/* ---------- what is read from the site's database ---------- */
const itemsOf = async site => { const m = {}; (await dbAll(site, 'items?select=code,name,unit,category,gst_pct,min_stock,status', 'code')).forEach(i => { m[i.code] = i; }); return m; };
const rpc = (site, fn, args) => db(site, 'POST', 'rpc/' + fn, args);
const stockOn = async (site, date) => (await db(site, 'GET', 'rpc/store_stock_on' + (date ? '?p_date=' + date : ''))) || [];
const avgOf = r => r && num(r.in_qty) > 0 ? num(r.in_value) / num(r.in_qty) : 0;
async function levels(site) { const r = ((await db(site, 'GET', 'store_settings?select=value&id=eq.approvers')) || [])[0]; return W.levelsOf(r && r.value); }
// a few lists kept on this server for 2 minutes (machinery, vendors, names typed before) – emptied by this server's own saves
const CACHE = new Map();
async function kept(site, what, f) {
  const k = site + '|' + what, c = CACHE.get(k);
  if (c && Date.now() - c.at < 120000) return c.p;
  if (CACHE.size > 200) CACHE.clear();
  const e = { at: Date.now(), p: f() }; CACHE.set(k, e); e.p.catch(() => { if (CACHE.get(k) === e) CACHE.delete(k); });
  return e.p;
}
const changed = site => [...CACHE.keys()].forEach(k => { if (k.startsWith(site + '|')) CACHE.delete(k); });
// the site's machinery (Mechanical's Asset Master – the same database)
const machinery = site => kept(site, 'mach', async () => {
  let rows = []; try { rows = await dbAll(site, 'master?select=id,machinery_number,machinery_name,type,owner_name,ownership,status,unit,active_from,inactive_from', 'id'); } catch (e) { rows = []; }
  return rows.filter(r => r.machinery_number).map(r => ({ no: String(r.machinery_number).trim(), name: r.machinery_name || '', type: r.type || '', owner: r.owner_name || '', own: r.ownership || '', unit: r.unit || '', from: r.active_from || null, until: r.inactive_from || null }))
    .sort((a, b) => a.no.localeCompare(b.no));
});
// the names typed before: suppliers (GRN), sub-contractors (Issue), vendors (PO) – with Mechanical's Vendor Master of the site
const names = site => kept(site, 'names', async () => {
  const safe = p => p.catch(() => []);
  const [ven, grn, iss, po] = await Promise.all([safe(dbAll(site, 'vendors?select=id,vendor_name,gst_number', 'id')), safe(dbAll(site, 'store_grn?select=no,supplier', 'no')),
    safe(dbAll(site, 'store_issue?select=no,party,to_kind', 'no')), safe(dbAll(site, 'store_po?select=no,vendor,vendor_gst', 'no'))]);
  const uniq = l => [...new Set(l.map(x => String(x || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const gst = {}; ven.forEach(v => { if (v.vendor_name && v.gst_number) gst[String(v.vendor_name).trim()] = String(v.gst_number).trim(); }); po.forEach(p => { if (p.vendor && p.vendor_gst) gst[p.vendor] = p.vendor_gst; });
  const vn = ven.map(v => v.vendor_name);
  return { suppliers: uniq(grn.map(g => g.supplier).concat(vn, po.map(p => p.vendor))), subs: uniq(iss.filter(i => i.to_kind === 'Sub-contractor').map(i => i.party)), vendors: uniq(po.map(p => p.vendor).concat(vn, grn.map(g => g.supplier))), gst: gst };
});
// "is it the same as …?" – a near name of a party typed before (as the Item Master's near names)
function party(name, known, confirmed, field) {
  const p = W.partyOf(name, known, !!confirmed);
  if (p.near.length) throw fail(409, 'Please confirm: "' + p.near.join('", "') + '" is already there – is "' + p.name + '" another ' + field + '?', 'party', { near: p.near, field: field, typed: p.name });
  return p.name;
}
// a machinery issued to: on the site on that date (Active From … the day before Inactive From – as in Mechanical)
function onSite(m, date) {
  if (!m) return;
  if (m.from && date < String(m.from).slice(0, 10)) throw fail(400, m.no + ' is on the site only from ' + dmy(m.from) + ' (Asset Master).', 'field');
  if (m.until && date >= String(m.until).slice(0, 10)) throw fail(400, m.no + ' left the site on ' + dmy(m.until) + ' (Asset Master: Inactive From).', 'field');
}
// a "no" of the database told in words (STORE_SHORT …, lib/sites.js gives them as code 'rule')
function said(e, items) {
  if (!e || e.code !== 'rule') throw e;
  const m = String(e.message); let x;
  const nm = c => (items && items[c] ? items[c].name : c), un = c => (items && items[c] ? ' ' + items[c].unit : '');
  if ((x = /^STORE_SHORT (.*)\|(\d{4}-\d{2}-\d{2})\|(-?[\d.]+)/.exec(m))) throw fail(409, 'Not enough stock of ' + nm(x[1]) + ' on ' + dmy(x[2]) + ': it would be ' + r3(x[3]) + un(x[1]) + ' (below zero). Nothing was saved.', 'short');
  if ((x = /^STORE_HAS_RETURN (\d+)/.exec(m))) throw fail(409, 'Outward ' + x[1] + ' has a return – delete the return first, then change or delete the issue.', 'hasreturn');
  if ((x = /^STORE_OVER_RETURN (.*)\|(.*)\|(.*)$/.exec(m))) throw fail(409, x[1] + ': ' + r3(x[3]) + ' back is more than was issued (' + r3(x[2]) + '). Nothing was saved.', 'overreturn');
  if (/^STORE_RETURN_BEFORE_ISSUE/.test(m)) throw fail(400, 'The return date is before the issue date.', 'field');
  if ((x = /^STORE_OVER_ORDER (\d+)\|(.*)\|(.*)\|(.*)$/.exec(m))) throw fail(409, 'Requirement ' + x[1] + ', ' + x[2] + ': ordered ' + r3(x[4]) + ', asked ' + r3(x[3]) + ' – never more than asked. Nothing was saved.', 'overorder');
  if ((x = /^STORE_REQ_NOT_APPROVED (\d+)/.exec(m))) throw fail(409, 'Requirement ' + x[1] + ' is not approved (or no longer open) – it cannot be ordered.', 'notapproved');
  if (/^STORE_NO_LINES/.test(m)) throw fail(400, 'Add at least one item.', 'field');
  if (/^STORE_GONE/.test(m)) throw gone('This paper');
  throw fail(409, m, 'rule');
}
const byNo = (a, b) => b.no - a.no;
const sortLines = l => (l || []).slice().sort((a, b) => a.line - b.line);
// ordered so far of each requirement line (POs not cancelled): 'req:line' → qty
function orderedOf(pos) { const o = {}; (pos || []).forEach(p => { if (p.status === 'Cancelled') return; (p.lines || []).forEach(l => { if (l.req_no) { const k = l.req_no + ':' + l.req_line; o[k] = r3((o[k] || 0) + num(l.qty)); } }); }); return o; }
// received so far of each PO line (GRN lines): 'po:line' → qty
async function receivedOf(site, poNos, skipGrn) {
  const o = {}; if (!poNos.length) return o;
  const grns = [];
  for (let i = 0; i < poNos.length; i += 150) grns.push(...await dbAll(site, 'store_grn?select=no,po_no,store_grn_lines(qty,po_line)&po_no=in.(' + poNos.slice(i, i + 150).join(',') + ')', 'no'));
  grns.forEach(g => { if (skipGrn && g.no === skipGrn) return; (g.store_grn_lines || []).forEach(l => { if (l.po_line) { const k = g.po_no + ':' + l.po_line; o[k] = r3((o[k] || 0) + num(l.qty)); } }); });
  return o;
}
// what is still to come of a PO, line by line; its state: Open / Received (all came) / Closed / Cancelled
function poView(p, rec) {
  const lines = sortLines(p.lines).map(l => { const r = r3(num(rec[p.no + ':' + l.line])); return Object.assign({}, l, { received: r, left: Math.max(0, r3(num(l.qty) - r)) }); });
  const state = p.status !== 'Open' ? p.status : lines.every(l => l.left <= 0.0005) ? 'Received' : lines.some(l => l.received > 0) ? 'Part received' : 'Open';
  return Object.assign({}, p, { lines: lines, state: state });
}
const reqView = (r, ordered, lv, s) => Object.assign({}, r, {
  lines: sortLines(r.lines).map(l => { const o = r3(num(ordered[r.no + ':' + l.line])); return Object.assign({}, l, { ordered: o, left: r.status === 'Approved' ? Math.max(0, r3(num(l.qty) - o)) : 0 }); }),
  mayApprove: r.status === 'Pending' && W.canApprove(lv, r.level, s.email, r.created_by), mine: String(r.created_by || '').toLowerCase() === String(s.email).toLowerCase(),
  waitFor: r.status === 'Pending' ? ((lv.find(l => l.level === r.level) || { people: [] }).people.filter(p => p.email !== String(r.created_by || '').toLowerCase()).map(p => p.name)) : [] });
// the sites with the Store's step 2 – HO Purchase works on every one of them
async function storeSites() { return (await registry()).filter(x => x.status === 'ready').map(x => ({ code: x.code, name: x.name || x.code })); }
async function siteFor(s, x) {
  const site = String(x.site || s.site).toUpperCase();
  if (site !== s.site) { buyerOnly(s); if (!(await storeSites()).some(y => y.code === site)) throw fail(400, 'No such site (' + site + ').', 'site'); }
  return site;
}
// the heading of a PO's paper: the site's company (Mechanical's list of sites and companies, in the first site's database)
async function headingOf(site) {
  try {
    const home = (await registry()).find(x => x.home); if (!home) return null;
    const st = ((await db(home.code, 'GET', 'rcl_sites?select=code,name,company_id&code=eq.' + enc(site))) || [])[0];
    const co = st && st.company_id ? ((await db(home.code, 'GET', 'rcl_companies?select=id,name,address,gstin,pan&id=eq.' + enc(st.company_id))) || [])[0] : null;
    return { site: st ? st.name : site, company: co ? co.name : '', address: co ? co.address || '' : '', gstin: co ? co.gstin || '' : '', pan: co ? co.pan || '' : '' };
  } catch (e) { return null; }
}
const brief = i => ({ code: i.code, name: i.name, unit: i.unit, category: i.category, gst_pct: i.gst_pct, min_stock: i.min_stock, status: i.status });

const ACTIONS = {
  /* ---------- what the pages need to start ---------- */
  async boot(s) {
    const [items, st, mach, lv, nm] = await Promise.all([itemsOf(s.site), stockOn(s.site), machinery(s.site), levels(s.site), names(s.site)]);
    const stock = {}, avg = {}; st.forEach(r => { stock[r.code] = r3(num(r.qty)); avg[r.code] = r2(avgOf(r)); });
    return { site: s.site, today: W.today(), me: { email: s.email, name: s.name, admin: s.admin, super: s.super, pages: s.pages, buyer: isBuyer(s) },
      items: Object.values(items).map(brief).sort((a, b) => a.name.localeCompare(b.name)), stock: stock, avg: avg, machinery: mach, names: nm,
      levels: lv.map(l => ({ level: l.level, people: l.people.map(p => p.name) })), myLevels: lv.filter(l => l.people.some(p => p.email === String(s.email).toLowerCase())).map(l => l.level),
      kinds: { for: W.FOR_KINDS, to: W.TO_KINDS, sides: W.SIDES } };
  },
  async dash(s) {
    const t = W.today(), out = { today: t };
    const [items, st] = await Promise.all([itemsOf(s.site), stockOn(s.site)]);
    let value = 0, below = 0; const by = new Map(st.map(r => [r.code, r]));
    Object.values(items).forEach(i => { const r = by.get(i.code), q = r ? num(r.qty) : 0; value += q * avgOf(r); if (i.status === 'Active' && i.min_stock !== null && i.min_stock !== undefined && q < Number(i.min_stock)) below++; });
    out.stock = { value: r2(value), below: below, items: Object.keys(items).length };
    if (can(s, 'req', 'View') || isBuyer(s)) {
      const [reqs, lv] = await Promise.all([dbAll(s.site, 'store_req?select=no,status,level,created_by&status=in.(Pending,Approved)', 'no'), levels(s.site)]);
      out.req = { pending: reqs.filter(r => r.status === 'Pending').length, mine: reqs.filter(r => r.status === 'Pending' && W.canApprove(lv, r.level, s.email, r.created_by)).length, approved: reqs.filter(r => r.status === 'Approved').length };
    }
    if (can(s, 'po', 'View') || can(s, 'grn', 'View') || isBuyer(s)) out.po = { open: (await dbAll(s.site, 'store_po?select=no&status=eq.Open', 'no')).length };
    if (can(s, 'grn', 'View')) { const g = await dbAll(s.site, 'store_grn?select=no,date,supplier,gross&date=gte.' + t.slice(0, 8) + '01', 'no'); out.grn = { today: g.filter(x => x.date === t).length, todayValue: r2(g.filter(x => x.date === t).reduce((a, x) => a + num(x.gross), 0)), month: g.length, monthValue: r2(g.reduce((a, x) => a + num(x.gross), 0)), recent: g.sort(byNo).slice(0, 8) }; }
    if (can(s, 'issue', 'View')) { const g = await dbAll(s.site, 'store_issue?select=no,date,to_kind,party,machinery,use_for,amount&date=gte.' + t.slice(0, 8) + '01', 'no'); out.issue = { today: g.filter(x => x.date === t).length, todayValue: r2(g.filter(x => x.date === t).reduce((a, x) => a + num(x.amount), 0)), month: g.length, monthValue: r2(g.reduce((a, x) => a + num(x.amount), 0)), recent: g.sort(byNo).slice(0, 8) }; }
    return out;
  },

  /* ---------- MATERIAL REQUIREMENT ---------- */
  async reqList(s) {
    const lv = await levels(s.site);
    if (!can(s, 'req', 'View') && !isBuyer(s) && !lv.some(l => l.people.some(p => p.email === String(s.email).toLowerCase()))) need(s, 'req', 'View');
    const [reqs, pos] = await Promise.all([dbAll(s.site, 'store_req?select=*', 'no'), dbAll(s.site, 'store_po?select=no,status,lines', 'no')]);
    const ordered = orderedOf(pos);
    return { reqs: reqs.sort(byNo).map(r => reqView(r, ordered, lv, s)), levels: lv.map(l => ({ level: l.level, people: l.people.map(p => p.name) })) };
  },
  async reqSave(s, x) {
    need(s, 'req', 'Edit');
    const items = await itemsOf(s.site), mach = await machinery(s.site), no = x.no ? noOf(x.no) : null;
    let cur = null;
    if (no) {
      cur = ((await db(s.site, 'GET', 'store_req?select=*&no=eq.' + no)) || [])[0]; if (!cur) throw gone('Requirement ' + no);
      if (String(cur.created_by).toLowerCase() !== String(s.email).toLowerCase() && !s.admin) throw fail(403, 'Only who made a requirement (or the Store Admin) changes it.', 'admin');
      if (cur.status !== 'Pending' || (cur.approvals || []).length) throw fail(409, 'Requirement ' + no + ' is already ' + (cur.status === 'Pending' ? 'approved at a level' : cur.status.toLowerCase()) + ' – it cannot be changed now. Cancel it and make a new one.', 'decided');
    }
    let r; try { r = W.checkReq(x.req, items, { machinery: mach, had: new Set(cur ? (cur.lines || []).map(l => l.code) : []) }); } catch (e) { userErr(e); }
    if (no) {
      const out = ((await db(s.site, 'PATCH', 'store_req?no=eq.' + no + '&status=eq.Pending&updated_at=eq.' + enc(cur.updated_at), Object.assign({}, r, { updated_by: s.email }), 'return=representation')) || [])[0];
      if (!out) throw fail(409, 'Requirement ' + no + ' was changed or decided by someone else just now – refresh and look.', 'decided');
      await activity(s.site, s.email, 'Requirement changed', 'REQ ' + no, { lines: r.lines.length });
      return { ok: true, no: no, status: out.status, level: out.level };
    }
    const lv = await levels(s.site), level = W.nextLevel(lv, 0, s.email);
    const row = Object.assign({}, r, { status: level ? 'Pending' : 'Approved', level: level, approvals: [] });
    const n = await rpc(s.site, 'store_req_put', { p_row: row, p_by: s.email, p_name: s.name }).catch(e => said(e, items));
    await activity(s.site, s.email, 'Requirement made', 'REQ ' + n, { lines: r.lines.map(l => l.name + ' ' + l.qty + ' ' + l.unit), status: row.status });
    return { ok: true, no: Number(n), status: row.status, level: level };
  },
  async reqCancel(s, x) {
    const no = noOf(x.no), cur = ((await db(s.site, 'GET', 'store_req?select=*&no=eq.' + no)) || [])[0];
    if (!cur) throw gone('Requirement ' + no);
    if (String(cur.created_by).toLowerCase() !== String(s.email).toLowerCase() && !s.admin) throw fail(403, 'Only who made a requirement (or the Store Admin) cancels it.', 'admin');
    if (['Pending', 'Approved'].indexOf(cur.status) === -1) throw fail(409, 'Requirement ' + no + ' is ' + cur.status.toLowerCase() + ' already.', 'decided');
    const o = orderedOf(await dbAll(s.site, 'store_po?select=no,status,lines', 'no'));
    if ((cur.lines || []).some(l => o[no + ':' + l.line])) throw fail(409, 'Requirement ' + no + ' is ordered (a purchase order has it) – it cannot be cancelled. HO Purchase can close it.', 'ordered');
    const out = ((await db(s.site, 'PATCH', 'store_req?no=eq.' + no + '&updated_at=eq.' + enc(cur.updated_at), { status: 'Cancelled', level: 0, close_note: W.dmy(W.today()) + ' cancelled by ' + s.name, updated_by: s.email }, 'return=representation')) || [])[0];
    if (!out) throw fail(409, 'Requirement ' + no + ' was changed by someone else just now – refresh and look.', 'decided');
    await activity(s.site, s.email, 'Requirement cancelled', 'REQ ' + no, null);
    return { ok: true };
  },
  // approve (or reject, with why) – one or many at once; any one person of the level it waits for; never one's own
  async reqDecide(s, x) {
    const nos = (Array.isArray(x.nos) ? x.nos : [x.no]).slice(0, 100).map(noOf), ok = x.ok === true, note = I.clean(x.note, 300);
    if (!ok && !note) throw fail(400, 'Say why it is rejected.', 'field');
    const lv = await levels(s.site), done = [], left = [];
    for (const no of nos) {
      const cur = ((await db(s.site, 'GET', 'store_req?select=*&no=eq.' + no)) || [])[0];
      if (!cur || cur.status !== 'Pending') { left.push({ no: no, why: cur ? 'already ' + cur.status.toLowerCase() : 'not there any more' }); continue; }
      if (!W.canApprove(lv, cur.level, s.email, cur.created_by)) { left.push({ no: no, why: String(cur.created_by).toLowerCase() === String(s.email).toLowerCase() ? 'your own requirement' : 'it waits for level ' + cur.level + ' – not yours' }); continue; }
      const next = ok ? W.nextLevel(lv, cur.level, cur.created_by) : 0;
      const ap = (cur.approvals || []).concat([{ level: cur.level, email: s.email, name: s.name, at: new Date().toISOString(), ok: ok, note: note || null }]);
      const patch = { approvals: ap, level: next, status: ok ? (next ? 'Pending' : 'Approved') : 'Rejected', updated_by: s.email };
      const out = ((await db(s.site, 'PATCH', 'store_req?no=eq.' + no + '&status=eq.Pending&level=eq.' + cur.level + '&updated_at=eq.' + enc(cur.updated_at), patch, 'return=representation')) || [])[0];
      if (!out) { left.push({ no: no, why: 'decided by someone else just now' }); continue; }
      done.push({ no: no, status: out.status, level: out.level });
      await activity(s.site, s.email, ok ? 'Requirement approved' : 'Requirement rejected', 'REQ ' + no, { level: cur.level, note: note || undefined, now: out.status });
    }
    if (!done.length && left.length) throw fail(409, left.map(l => 'Requirement ' + l.no + ': ' + l.why).join('; ') + '.', 'decided', { left: left });
    return { ok: true, done: done, left: left };
  },
  // the rest of an approved requirement will not be bought (HO Purchase or the Store Admin)
  async reqClose(s, x) {
    if (!isBuyer(s) && !s.admin) throw fail(403, 'Only HO Purchase or the Store Admin closes a requirement.', 'admin');
    const site = await siteFor(s, x), no = noOf(x.no), note = I.clean(x.note, 200);
    const cur = ((await db(site, 'GET', 'store_req?select=no,status,updated_at&no=eq.' + no)) || [])[0];
    if (!cur) throw gone('Requirement ' + no);
    if (cur.status !== 'Approved') throw fail(409, 'Only an approved requirement is closed (it is ' + cur.status.toLowerCase() + ').', 'decided');
    await db(site, 'PATCH', 'store_req?no=eq.' + no + '&status=eq.Approved', { status: 'Closed', close_note: W.dmy(W.today()) + ' closed by ' + s.name + (note ? ': ' + note : ''), updated_by: s.email }, 'return=minimal');
    await activity(site, s.email, 'Requirement closed', 'REQ ' + no, { note: note || undefined });
    return { ok: true };
  },

  /* ---------- PURCHASE ORDER (HO Purchase – every site) ---------- */
  // every site's approved requirements still to order
  async purPending(s) {
    buyerOnly(s);
    const out = [];
    for (const st of await storeSites()) {
      try {
        const [reqs, pos] = await Promise.all([dbAll(st.code, 'store_req?select=*&status=eq.Approved', 'no'), dbAll(st.code, 'store_po?select=no,status,lines', 'no')]);
        const o = orderedOf(pos), list = reqs.sort((a, b) => a.no - b.no).map(r => reqView(r, o, [], s)).filter(r => r.lines.some(l => l.left > 0.0005));
        out.push({ site: st.code, name: st.name, reqs: list, open: pos.filter(p => p.status === 'Open').length });
      } catch (e) { out.push({ site: st.code, name: st.name, reqs: [], error: e && e.code === 'notinstalled' ? 'The Store\'s step 2 is not run in this site\'s database yet.' : 'Could not be read now.' }); }
    }
    return { sites: out };
  },
  // a site's items and vendors (to make its PO)
  async purItems(s, x) {
    const site = await siteFor(s, x); if (site === s.site && !isBuyer(s)) buyerOnly(s);
    const [items, nm] = await Promise.all([itemsOf(site), names(site)]);
    return { site: site, items: Object.values(items).filter(i => i.status === 'Active').map(brief).sort((a, b) => a.name.localeCompare(b.name)), vendors: nm.vendors, gst: nm.gst };
  },
  async poList(s, x) {
    const site = await siteFor(s, x);
    if (!isBuyer(s) && !can(s, 'po', 'View') && !can(s, 'grn', 'View')) need(s, 'po', 'View');
    const sites = x.all && isBuyer(s) ? await storeSites() : [{ code: site, name: site }], out = [];
    for (const st of sites) {
      try {
        const pos = await dbAll(st.code, 'store_po?select=*', 'no'), rec = await receivedOf(st.code, pos.map(p => p.no));
        pos.sort(byNo).forEach(p => out.push(Object.assign(poView(p, rec), { site: st.code, siteName: st.name })));
      } catch (e) { if (sites.length === 1) throw e; }
    }
    return { pos: out };
  },
  async poGet(s, x) {
    const site = await siteFor(s, x), no = noOf(x.no);
    if (!isBuyer(s) && !can(s, 'po', 'View') && !can(s, 'grn', 'View')) need(s, 'po', 'View');
    const p = ((await db(site, 'GET', 'store_po?select=*&no=eq.' + no)) || [])[0]; if (!p) throw gone('PO ' + no);
    return { po: Object.assign(poView(p, await receivedOf(site, [no])), { site: site }), heading: await headingOf(site) };
  },
  async poSave(s, x) {
    buyerOnly(s);
    const site = await siteFor(s, x), no = x.no ? noOf(x.no) : null, items = await itemsOf(site);
    let cur = null;
    if (no) { cur = ((await db(site, 'GET', 'store_po?select=*&no=eq.' + no)) || [])[0]; if (!cur) throw gone('PO ' + no); if (cur.status !== 'Open') throw fail(409, 'PO ' + no + ' is ' + cur.status.toLowerCase() + ' – it is not changed.', 'decided'); }
    const rn = [...new Set(((x.po && x.po.lines) || []).map(l => Number(l && l.req_no)).filter(n => Number.isInteger(n) && n > 0))];
    const reqs = {}; if (rn.length) (await dbAll(site, 'store_req?select=no,status,lines&no=in.(' + rn.join(',') + ')', 'no')).forEach(r => { reqs[r.no] = r; });
    let p; try { p = W.checkPo(x.po, items, { reqs: reqs, had: new Set(cur ? (cur.lines || []).map(l => l.code) : []) }); } catch (e) { userErr(e); }
    const fresh = rn.filter(n => !cur || !(cur.lines || []).some(l => Number(l.req_no) === n));
    fresh.forEach(n => { if (!reqs[n] || reqs[n].status !== 'Approved') throw fail(409, 'Requirement ' + n + ' is not approved (or no longer open) – it cannot be ordered.', 'notapproved'); });
    p.vendor = party(p.vendor, (await names(site)).vendors, x.confirmParty, 'vendor');
    if (cur) {      // a changed PO: never less than already came
      const rec = await receivedOf(site, [no]);
      (cur.lines || []).forEach(l => { const got = rec[no + ':' + l.line] || 0, nl = p.lines.find(y => y.line === l.line && y.code === l.code); if (got > 0 && (!nl || nl.qty + 0.0005 < got)) throw fail(409, l.name + ': ' + r3(got) + ' ' + l.unit + ' already came on PO ' + no + ' – the PO keeps at least that (line ' + l.line + ').', 'received'); });
    }
    const n = await rpc(site, 'store_po_put', { p_no: no, p_row: p, p_by: s.email, p_name: s.name }).catch(e => said(e, items));
    changed(site);
    await activity(site, s.email, no ? 'PO changed' : 'PO made', 'PO ' + n, { vendor: p.vendor, total: p.total, lines: p.lines.length, by: s.site !== site ? 'HO Purchase (' + s.site + ')' : undefined });
    return { ok: true, site: site, no: Number(n), total: p.total };
  },
  async poCancel(s, x) {
    buyerOnly(s);
    const site = await siteFor(s, x), no = noOf(x.no);
    const p = ((await db(site, 'GET', 'store_po?select=no,status&no=eq.' + no)) || [])[0]; if (!p) throw gone('PO ' + no);
    if (p.status !== 'Open') throw fail(409, 'PO ' + no + ' is ' + p.status.toLowerCase() + ' already.', 'decided');
    if ((await dbAll(site, 'store_grn?select=no&po_no=eq.' + no, 'no')).length) throw fail(409, 'Material of PO ' + no + ' has come (a GRN has it) – it cannot be cancelled. Close it (the rest will not come).', 'received');
    await db(site, 'PATCH', 'store_po?no=eq.' + no + '&status=eq.Open', { status: 'Cancelled', close_note: W.dmy(W.today()) + ' cancelled by ' + s.name, updated_by: s.email }, 'return=minimal');
    await activity(site, s.email, 'PO cancelled', 'PO ' + no, null);
    return { ok: true };
  },
  async poClose(s, x) {
    const site = await siteFor(s, x), no = noOf(x.no), note = I.clean(x.note, 200);
    if (!isBuyer(s) && !(site === s.site && s.admin)) throw fail(403, 'Only HO Purchase or the Store Admin closes a PO.', 'admin');
    const p = ((await db(site, 'GET', 'store_po?select=no,status&no=eq.' + no)) || [])[0]; if (!p) throw gone('PO ' + no);
    if (p.status !== 'Open') throw fail(409, 'PO ' + no + ' is ' + p.status.toLowerCase() + ' already.', 'decided');
    await db(site, 'PATCH', 'store_po?no=eq.' + no + '&status=eq.Open', { status: 'Closed', close_note: W.dmy(W.today()) + ' closed by ' + s.name + (note ? ': ' + note : ''), updated_by: s.email }, 'return=minimal');
    await activity(site, s.email, 'PO closed', 'PO ' + no, { note: note || undefined });
    return { ok: true };
  },

  /* ---------- INWARD (GRN) ---------- */
  async grnList(s, x) {
    need(s, 'grn', 'View');
    const p = period(x), g = await dbAll(s.site, 'store_grn?select=*,store_grn_lines(*)&date=gte.' + p.from + '&date=lte.' + p.to, 'no');
    return { from: p.from, to: p.to, grns: g.sort(byNo).map(r => Object.assign({}, r, { lines: sortLines(r.store_grn_lines), store_grn_lines: undefined })) };
  },
  // this site's open POs with what is still to come (a GRN against a PO)
  async poOpen(s) {
    need(s, 'grn', 'Edit');
    const pos = await dbAll(s.site, 'store_po?select=*&status=eq.Open', 'no'), rec = await receivedOf(s.site, pos.map(p => p.no));
    return { pos: pos.sort(byNo).map(p => poView(p, rec)).filter(p => p.state !== 'Received') };
  },
  async grnSave(s, x) {
    const no = x.no ? noOf(x.no) : null;
    if (no) adminOnly(s, 'change a GRN'); else need(s, 'grn', 'Edit');
    const items = await itemsOf(s.site);
    let cur = null; if (no) { cur = ((await db(s.site, 'GET', 'store_grn?select=*,store_grn_lines(code)&no=eq.' + no)) || [])[0]; if (!cur) throw gone('GRN ' + no); }
    const poNo = x.grn && x.grn.po_no ? noOf(x.grn.po_no) : null;
    let po = null;
    if (poNo) {
      po = ((await db(s.site, 'GET', 'store_po?select=*&no=eq.' + poNo)) || [])[0]; if (!po) throw gone('PO ' + poNo);
      if (po.status !== 'Open' && !(cur && Number(cur.po_no) === poNo)) throw fail(409, 'PO ' + poNo + ' is ' + po.status.toLowerCase() + ' – its material is not taken in on it.', 'decided');
    }
    let g; try { g = W.checkGrn(x.grn, items, { po: po, had: new Set(cur ? (cur.store_grn_lines || []).map(l => l.code) : []) }); } catch (e) { userErr(e); }
    g.head.supplier = party(g.head.supplier, (await names(s.site)).suppliers.concat(po ? [po.vendor] : []), x.confirmParty, 'supplier');
    if (po && !x.confirmOver) {      // more than the PO still has to come: asked first
      const rec = await receivedOf(s.site, [poNo], no), over = [];
      g.lines.filter(l => l.po_line).forEach(l => { const pl = (po.lines || []).find(z => Number(z.line) === l.po_line), left = r3(num(pl.qty) - num(rec[poNo + ':' + l.po_line])); if (l.qty > left + 0.0005) over.push(l.name + ': ' + l.qty + ' ' + l.unit + ' (PO still has ' + Math.max(0, left) + ')'); });
      if (over.length) throw fail(409, 'More than PO ' + poNo + ' still has to come – ' + over.join('; ') + '. Take it in anyway?', 'over', { over: over });
    }
    const n = await rpc(s.site, 'store_grn_put', { p_no: no, p_head: g.head, p_lines: g.lines, p_by: s.email, p_name: s.name }).catch(e => said(e, items));
    changed(s.site);
    await activity(s.site, s.email, no ? 'GRN changed' : 'GRN made', 'GRN ' + n, { supplier: g.head.supplier, gross: g.head.gross, lines: g.lines.map(l => l.name + ' ' + l.qty + ' ' + l.unit), po: poNo || undefined });
    return { ok: true, no: Number(n), gross: g.head.gross };
  },
  async grnDelete(s, x) {
    adminOnly(s, 'delete a GRN');
    const no = noOf(x.no), items = await itemsOf(s.site);
    await rpc(s.site, 'store_grn_del', { p_no: no }).catch(e => said(e, items));
    changed(s.site); await activity(s.site, s.email, 'GRN deleted', 'GRN ' + no, null);
    return { ok: true };
  },

  /* ---------- OPENING STOCK (the Store Admin) ---------- */
  async openingList(s) {
    if (!s.admin) need(s, 'reports', 'View');
    return { rows: await dbAll(s.site, 'store_opening?select=*', 'code') };
  },
  async openingSave(s, x) {
    adminOnly(s, 'set the opening stock');
    const items = await itemsOf(s.site);
    let rows; try { rows = W.checkOpening(x.rows, items, x.date); } catch (e) { userErr(e); }
    if (x.check) return { ok: true, rows: rows.length };
    await rpc(s.site, 'store_open_put', { p_rows: rows, p_by: s.email }).catch(e => said(e, items));
    await activity(s.site, s.email, 'Opening stock', rows.length + ' items', { rows: rows.slice(0, 300).map(r => r.code + ' ' + r.qty + ' @ ' + r.rate) });
    return { ok: true, rows: rows.length };
  },

  /* ---------- ISSUE (OUTWARD) and RETURN ---------- */
  async issueList(s, x) {
    need(s, 'issue', 'View');
    const p = period(x), iss = await dbAll(s.site, 'store_issue?select=*,store_issue_lines(*)&date=gte.' + p.from + '&date=lte.' + p.to, 'no');
    const min = iss.reduce((m, i) => Math.min(m, i.no), Infinity), back = {}, rets = isFinite(min) ? await dbAll(s.site, 'store_return?select=*,store_return_lines(*)&issue_no=gte.' + min, 'no') : [];
    rets.forEach(r => (r.store_return_lines || []).forEach(l => { back[l.issue_line] = r3((back[l.issue_line] || 0) + num(l.qty)); }));
    const retOf = {}; rets.forEach(r => { (retOf[r.issue_no] = retOf[r.issue_no] || []).push({ no: r.no, date: r.date, lines: sortLines(r.store_return_lines) }); });
    return { from: p.from, to: p.to, issues: iss.sort(byNo).map(i => Object.assign({}, i, { store_issue_lines: undefined, returns: retOf[i.no] || [],
      lines: sortLines(i.store_issue_lines).map(l => Object.assign({}, l, { back: back[l.id] || 0 })) })) };
  },
  async issueGet(s, x) {
    need(s, 'issue', 'View');
    const no = noOf(x.no), i = ((await db(s.site, 'GET', 'store_issue?select=*,store_issue_lines(*)&no=eq.' + no)) || [])[0]; if (!i) throw gone('Outward ' + no);
    const rets = await dbAll(s.site, 'store_return?select=*,store_return_lines(*)&issue_no=eq.' + no, 'no'), back = {};
    rets.forEach(r => (r.store_return_lines || []).forEach(l => { back[l.issue_line] = r3((back[l.issue_line] || 0) + num(l.qty)); }));
    return { issue: Object.assign({}, i, { store_issue_lines: undefined, lines: sortLines(i.store_issue_lines).map(l => Object.assign({}, l, { back: back[l.id] || 0 })),
      returns: rets.sort((a, b) => a.no - b.no).map(r => Object.assign({}, r, { store_return_lines: undefined, lines: sortLines(r.store_return_lines) })) }) };
  },
  async issueSave(s, x) {
    const no = x.no ? noOf(x.no) : null;
    if (no) adminOnly(s, 'change an issue'); else need(s, 'issue', 'Edit');
    const [items, mach] = await Promise.all([itemsOf(s.site), machinery(s.site)]);
    let cur = null; if (no) { cur = ((await db(s.site, 'GET', 'store_issue?select=no,date,store_issue_lines(code)&no=eq.' + no)) || [])[0]; if (!cur) throw gone('Outward ' + no); }
    let date; try { date = W.dayOf(x.issue && x.issue.date, 'issue date'); } catch (e) { userErr(e); }
    const st = new Map((await stockOn(s.site, date)).map(r => [r.code, r]));
    let g; try { g = W.checkIssue(x.issue, items, { machinery: mach, rateFor: c => avgOf(st.get(c)), had: new Set(cur ? (cur.store_issue_lines || []).map(l => l.code) : []) }); } catch (e) { userErr(e); }
    if (g.head.to_kind === 'Machinery') onSite(mach.find(m => m.no === g.head.machinery), g.head.date);
    if (g.head.to_kind === 'Sub-contractor') g.head.party = party(g.head.party, (await names(s.site)).subs, x.confirmParty, 'sub-contractor');
    const n = await rpc(s.site, 'store_issue_put', { p_no: no, p_head: g.head, p_lines: g.lines, p_by: s.email, p_name: s.name }).catch(e => said(e, items));
    changed(s.site);
    await activity(s.site, s.email, no ? 'Issue changed' : 'Issue made', 'OUT ' + n, { to: g.head.to_kind + (g.head.party ? ' ' + g.head.party : '') + (g.head.machinery ? ' ' + g.head.machinery : ''), lines: g.lines.map(l => l.name + ' ' + l.qty + ' ' + l.unit) });
    return { ok: true, no: Number(n), amount: g.head.amount };
  },
  async issueDelete(s, x) {
    adminOnly(s, 'delete an issue');
    const no = noOf(x.no), items = await itemsOf(s.site);
    await rpc(s.site, 'store_issue_del', { p_no: no }).catch(e => said(e, items));
    changed(s.site); await activity(s.site, s.email, 'Issue deleted', 'OUT ' + no, null);
    return { ok: true };
  },
  async retSave(s, x) {
    const no = x.no ? noOf(x.no) : null;
    if (no) adminOnly(s, 'change a return'); else need(s, 'issue', 'Edit');
    const iss = (await ACTIONS.issueGet(Object.assign({}, s, { pages: Object.assign({}, s.pages, { issue: 'View' }) }), { no: x.ret && x.ret.issue_no })).issue;
    const back = {}; (iss.returns || []).forEach(r => { if (r.no === no) return; (r.lines || []).forEach(l => { back[l.issue_line] = r3((back[l.issue_line] || 0) + num(l.qty)); }); });
    let g; try { g = W.checkReturn(x.ret, iss, { back: back }); } catch (e) { userErr(e); }
    const items = await itemsOf(s.site);
    const n = await rpc(s.site, 'store_return_put', { p_no: no, p_head: g.head, p_lines: g.lines, p_by: s.email, p_name: s.name }).catch(e => said(e, items));
    await activity(s.site, s.email, no ? 'Return changed' : 'Return made', 'RET ' + n, { issue: iss.no, lines: g.lines.length });
    return { ok: true, no: Number(n) };
  },
  async retDelete(s, x) {
    adminOnly(s, 'delete a return');
    const no = noOf(x.no), items = await itemsOf(s.site);
    await rpc(s.site, 'store_return_del', { p_no: no }).catch(e => said(e, items));
    await activity(s.site, s.email, 'Return deleted', 'RET ' + no, null);
    return { ok: true };
  },

  /* ---------- EXCEL IMPORT (the Store Admin): GRN and Issue registers in his columns – checked first, then all or none ---------- */
  async importDocs(s, x) {
    adminOnly(s, 'import from Excel');
    const kind = x.kind === 'issue' ? 'issue' : 'grn', rows = Array.isArray(x.rows) ? x.rows.slice(0, 5001) : [];
    if (!rows.length) throw fail(400, 'The file has no rows.', 'field');
    if (rows.length > 5000) throw fail(400, 'At most 5000 rows in one file.', 'field');
    const [items, mach] = await Promise.all([itemsOf(s.site), machinery(s.site)]), byKey = {};
    Object.values(items).forEach(i => { byKey[I.keyOf(i.name)] = i; });
    const moves = kind === 'issue' ? await dbAll(s.site, 'store_moves?select=code,date,q,kind,rate,id&kind=in.(GRN,OPN)', 'id') : [], rateFor = W.rateFinder(moves);
    const groups = new Map(), report = [];
    rows.forEach((r, n) => {
      const line = Number(r && r.line) || n + 2, res = { line: line, ref: String((r && r.ref) || '').slice(0, 30), item: String((r && r.item) || '').slice(0, 120) };
      const it = byKey[I.keyOf(res.item)];
      if (!it) { const near = I.similar(res.item, Object.values(items), null); res.status = 'error'; res.msg = near.length ? 'Not in the Item Master – near: ' + near.map(y => y.name).join(', ') + ' (write it as there)' : 'Not in the Item Master of this site – add it there first'; report.push(res); return; }
      res.code = it.code;
      const key = res.ref || [r.date, r.party, r.invoice_no].join('|');
      const gq = groups.get(key) || { key: key, rows: [], first: line }; gq.rows.push(Object.assign({}, r, { code: it.code, _line: line })); groups.set(key, gq);
      report.push(res);
    });
    const docs = [];
    for (const gq of groups.values()) {
      const f = gq.rows[0];
      try {
        if (kind === 'grn') {
          const g = W.checkGrn({ date: f.date, supplier: f.party, challan_no: f.challan_no, invoice_no: f.invoice_no, invoice_date: f.invoice_date, vehicle_no: f.vehicle_no, tcs: gq.rows.reduce((a, y) => a + num(y.tcs), 0),
            remark: f.ref ? 'File GRN no. ' + f.ref : f.remark, lines: gq.rows.map(y => ({ code: y.code, qty: y.qty, rate: y.rate, gst_pct: y.gst_pct, remark: y.remark })) }, items, {});
          docs.push({ head: g.head, lines: g.lines, ref: gq.key, n: gq.rows.length });
        } else {
          const g = W.checkIssue({ date: f.date, to_kind: f.to_kind || (f.machinery ? 'Machinery' : f.party && !/^rcl$/i.test(String(f.party).trim()) ? 'Sub-contractor' : 'Site work'), party: /^rcl$/i.test(String(f.party || '').trim()) ? '' : f.party,
            machinery: f.machinery, reading: f.reading, location: f.location, side: f.side, use_for: f.use_for || 'As per file', receiver: f.receiver, remark: f.ref ? 'File outward no. ' + f.ref : f.remark,
            lines: gq.rows.map(y => ({ code: y.code, qty: y.qty, returnable: /^(yes|y|returnable)$/i.test(String(y.returnable || '').trim()), serial: y.serial, remark: y.remark })) }, items, { machinery: mach, rateFor: rateFor });
          docs.push({ head: g.head, lines: g.lines, ref: gq.key, n: gq.rows.length });
        }
        gq.rows.forEach(y => { const r = report.find(z => z.line === y._line); r.status = 'ok'; r.msg = (kind === 'grn' ? 'GRN of ' : 'Issue of ') + W.dmy(docs[docs.length - 1].head.date) + ' – ' + gq.rows.length + ' item(s)'; });
      } catch (e) { if (!(e && e.user)) throw e; gq.rows.forEach(y => { const r = report.find(z => z.line === y._line); r.status = 'error'; r.msg = e.message; }); }
    }
    const errors = report.filter(r => r.status === 'error').length, out = { rows: report.sort((a, b) => a.line - b.line), docs: docs.length, errors: errors };
    if (x.check) return out;
    if (errors) throw fail(400, errors + ' row(s) of the file have a mistake – correct them in the file and import again. Nothing was imported.', 'rows', { report: out });
    const fn = kind === 'grn' ? 'store_grn_many' : 'store_issue_many';
    const nos = await rpc(s.site, fn, { p_docs: docs.map(d => ({ head: d.head, lines: d.lines })), p_by: s.email, p_name: s.name }).catch(e => said(e, items));
    changed(s.site);
    await activity(s.site, s.email, kind === 'grn' ? 'GRNs imported' : 'Issues imported', docs.length + ' papers', { nos: (nos || []).slice(0, 300) });
    return Object.assign(out, { ok: true, saved: (nos || []).length, nos: nos || [] });
  },

  /* ---------- STOCK & REPORTS ---------- */
  async report(s, x) {
    const k = String(x.kind || '');
    const pageOf = { grn: 'grn', issue: 'issue', consumption: 'issue', returnable: 'issue', req: 'req', po: 'po' };
    if (!can(s, 'reports', 'View') && !(pageOf[k] && can(s, pageOf[k], 'View')) && !(k === 'po' && isBuyer(s))) need(s, 'reports', 'View');
    const items = await itemsOf(s.site), list = Object.values(items);
    if (k === 'stock') { let d; try { d = W.dayOf(x.date || W.today(), 'date', { future: true }); } catch (e) { userErr(e); } return R.stock(list, await stockOn(s.site, d), d, { cat: x.cat, below: !!x.below, all: !!x.all }); }
    if (k === 'statement') { const p = period(x); return R.statement(list, (await db(s.site, 'GET', 'rpc/store_statement?p_from=' + p.from + '&p_to=' + p.to)) || [], p.from, p.to); }
    if (k === 'ledger') {
      const p = period(x), it = items[String(x.code || '')]; if (!it) throw fail(400, 'Pick the item.', 'field');
      const moves = await dbAll(s.site, 'store_moves?select=code,date,q,kind,no,rate,id&code=eq.' + enc(it.code) + '&date=lte.' + p.to, 'id'), who = {};
      const nos = kind => [...new Set(moves.filter(m => m.kind === kind && m.date >= p.from).map(m => m.no))];
      const get = async (t, sel, kind, f) => { const l = nos(kind); for (let i = 0; i < l.length; i += 150) (await dbAll(s.site, t + '?select=no,' + sel + '&no=in.(' + l.slice(i, i + 150).join(',') + ')', 'no')).forEach(r => { who[kind + ':' + r.no] = f(r); }); };
      await Promise.all([get('store_grn', 'supplier', 'GRN', r => r.supplier), get('store_issue', 'to_kind,party,machinery,location,use_for', 'OUT', r => [r.party || (r.to_kind === 'Site work' ? 'RCL' : r.to_kind), r.machinery, r.location, r.use_for].filter(Boolean).join(' · ')), get('store_return', 'party,issue_no', 'RET', r => (r.party || '') + ' (outward ' + r.issue_no + ')')]);
      return R.ledger(it, moves, who, p.from, p.to);
    }
    if (k === 'grn') { const p = period(x), g = await dbAll(s.site, 'store_grn?select=*,store_grn_lines(*)&date=gte.' + p.from + '&date=lte.' + p.to, 'no'); return R.grnRegister(g.map(r => Object.assign(r, { lines: r.store_grn_lines })), p.from, p.to, { supplier: x.supplier }); }
    if (k === 'issue' || k === 'consumption') {
      const p = period(x), iss = await dbAll(s.site, 'store_issue?select=*,store_issue_lines(*)&date=gte.' + p.from + '&date=lte.' + p.to, 'no'), back = {};
      const min = iss.reduce((m, i) => Math.min(m, i.no), Infinity);
      if (isFinite(min)) (await dbAll(s.site, 'store_return?select=no,issue_no,store_return_lines(issue_line,qty)&issue_no=gte.' + min, 'no')).forEach(r => (r.store_return_lines || []).forEach(l => { back[l.issue_line] = r3((back[l.issue_line] || 0) + num(l.qty)); }));
      const o = { kind: x.toKind, party: x.party, machinery: x.machinery, item: x.code, itemName: items[x.code] ? items[x.code].name : '', location: x.location };
      const list2 = iss.map(i => Object.assign(i, { lines: i.store_issue_lines }));
      return k === 'issue' ? R.issueRegister(list2, back, p.from, p.to, o) : R.consumption(list2, back, p.from, p.to, x.by, o);
    }
    if (k === 'returnable') {
      const lines = await dbAll(s.site, 'store_issue_lines?select=*&returnable=is.true', 'id'), nos = [...new Set(lines.map(l => l.issue_no))], iss = [], back = {};
      for (let i = 0; i < nos.length; i += 150) iss.push(...await dbAll(s.site, 'store_issue?select=*&no=in.(' + nos.slice(i, i + 150).join(',') + ')', 'no'));
      const ids = lines.map(l => l.id);
      for (let i = 0; i < ids.length; i += 150) (await dbAll(s.site, 'store_return_lines?select=id,issue_line,qty&issue_line=in.(' + ids.slice(i, i + 150).join(',') + ')', 'id')).forEach(l => { back[l.issue_line] = r3((back[l.issue_line] || 0) + num(l.qty)); });
      iss.forEach(i => { i.lines = lines.filter(l => l.issue_no === i.no); });
      return R.returnable(iss, back, { party: x.party });
    }
    if (k === 'req') { const [reqs, pos] = await Promise.all([dbAll(s.site, 'store_req?select=*', 'no'), dbAll(s.site, 'store_po?select=no,status,lines', 'no')]); return R.requirements(reqs, orderedOf(pos), { status: x.status, from: x.from, to: x.to }); }
    if (k === 'po') {
      const sites = x.all && isBuyer(s) ? await storeSites() : [{ code: s.site, name: s.site }], rows = [], o = { from: x.from, to: x.to, pending: !!x.pending, vendor: x.vendor };
      let t = null;
      for (const st of sites) {
        try { const pos = await dbAll(st.code, 'store_po?select=*', 'no'); pos.forEach(p => { p.site = st.code; }); const r = R.purchaseOrders(pos, await receivedOf(st.code, pos.map(p => p.no)), o); rows.push(...r.rows); t = t || r; }
        catch (e) { if (sites.length === 1) throw e; }
      }
      t = t || R.purchaseOrders([], {}, o);
      return sites.length === 1 ? t : Object.assign({}, t, { rows: rows, title: 'Purchase orders – every site' + (x.pending ? ' (to come)' : ''), total: null });
    }
    throw fail(400, 'No such report.', 'field');
  },

  /* ---------- SETTINGS (the Store Admin): where the GRN and Outward numbers go on from ---------- */
  async numbers(s) {
    adminOnly(s, 'see the numbers');
    const [nums, g, o] = await Promise.all([db(s.site, 'GET', 'store_numbers?select=kind,next_no'), db(s.site, 'GET', 'store_grn?select=no&order=no.desc&limit=1'), db(s.site, 'GET', 'store_issue?select=no&order=no.desc&limit=1')]);
    const n = {}; (nums || []).forEach(r => { n[r.kind] = Number(r.next_no); });
    return { next: { GRN: n.GRN || 1, OUT: n.OUT || 1 }, used: { GRN: g && g[0] ? Number(g[0].no) : 0, OUT: o && o[0] ? Number(o[0].no) : 0 } };
  },
  async numbersSave(s, x) {
    adminOnly(s, 'set the numbers');
    const cur = await ACTIONS.numbers(s), set = {};
    for (const k of ['GRN', 'OUT']) {
      if (x[k] === undefined || x[k] === null || x[k] === '') continue;
      const v = Number(x[k]); if (!Number.isInteger(v) || v < 1 || v > 1e9) throw fail(400, 'The next ' + (k === 'GRN' ? 'GRN' : 'Outward') + ' number must be a whole number (1 or more).', 'field');
      if (v <= cur.used[k]) throw fail(400, 'The next ' + (k === 'GRN' ? 'GRN' : 'Outward') + ' number must be more than ' + cur.used[k] + ' (the last one used).', 'field');
      set[k] = v;
    }
    for (const k of Object.keys(set)) await db(s.site, 'PATCH', 'store_numbers?kind=eq.' + k, { next_no: set[k] }, 'return=minimal');
    if (Object.keys(set).length) await activity(s.site, s.email, 'Numbers set', s.site, set);
    return Object.assign(await ACTIONS.numbers(s), { ok: true });
  },
};

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
  sameSite(req);
  const s = await ses.need(req), x = await readBody(req), a = String(x.action || '');
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, a)) return send(res, 404, { error: 'Unknown action.' });
  try { send(res, 200, await ACTIONS[a](s, x)); }
  catch (e) { if (e && e.code === 'notinstalled') throw fail(500, 'The Store\'s work is not set up in the database of site ' + s.site + ' yet: run sql/store_step2_work.sql once in that site\'s Supabase → SQL Editor.', 'notinstalled'); throw e; }
});
module.exports.ACTIONS = ACTIONS;      // (for the unit test)
