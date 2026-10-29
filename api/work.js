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
const G = require('../lib/grnimport');
const AI = require('../lib/ai');
const AL = require('../lib/ailook');
const { codesAll, nextCode, codeOnce } = require('../lib/itemcodes');
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
/* (29-10-2026, the MD – urgent: "admin ani super admin fkt back dated entry kru shakto baki konich nahi … jo entry user karayla jail tyala
 * auto aajchi date select aasel tyala date change krta yenar nahi … modual wise") A STORE USER (not the Store Admin of this site, not the
 * Super Admin) makes an entry – a requirement, a purchase order, a GRN, an issue, a return – only of TODAY. A requirement or a PO he
 * changes (the PO's approval sends it back to him) keeps its own date; moved, it must be today. Changes and deletions of GRNs, issues
 * and returns, the imports and the opening stock are the Store Admin's already. */
const TODAY_RULE = () => process.env.STORE_TODAY_RULE !== 'off' || !!process.env.VERCEL;      // ('off' only on the local test rig: its story is dated over ten days – never on Vercel)
const todayOnly = (s, date, what, was) => {
  if (!TODAY_RULE() || s.admin || s.super || !date || date >= W.today() || (was && date === was)) return;
  throw fail(400, what + ' of ' + W.dmy(date) + ': a Store User enters only today\'s entries – an entry of an earlier day is made only by the Store Admin or the Super Admin. Ask the Store Admin.', 'date');
};
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
const itemsOf = async site => { const m = {}; (await dbAll(site, 'items?select=code,name,unit,category,hsn,gst_pct,min_stock,status', 'code')).forEach(i => { m[i.code] = i; }); return m; };
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
// (28-10-2026, step 4) the number the next new GRN gets: the next of the numbers, past any taken (as a number or as a GRN No)
async function nextGrn(site) {
  const n0 = Number((((await db(site, 'GET', 'store_numbers?select=next_no&kind=eq.GRN')) || [])[0] || {}).next_no || 1);
  for (let n = n0; ; n += 300) {
    const ns = Array.from({ length: 300 }, (_, i) => n + i), used = new Set();
    ((await db(site, 'GET', 'store_grn?select=no,ref&or=(and(no.gte.' + n + ',no.lt.' + (n + 300) + '),ref.in.(' + ns.join(',') + '))')) || []).forEach(g => { used.add(String(g.no)); if (g.ref) used.add(String(g.ref)); });
    const f = ns.find(x => !used.has(String(x))); if (f) return f;
  }
}
// is the Store's step 4 (a GRN No typed by hand) in this site's database? – its function answers "no lines" to an empty GRN, nothing saved
async function step4On(site) {
  try { await rpc(site, 'store_grn_new', { p_head: {}, p_lines: [], p_ref: null, p_by: '', p_name: '' }); return true; }
  catch (e) { if (e && e.code === 'rule' && /STORE_NO_LINES/.test(String(e.message))) return true; if (e && (e.code === 'notinstalled' || /store_grn_new|PGRST202|42883/i.test(String(e.message)))) return false; throw e; }
}
const STEP4 = 'A GRN No typed by hand needs the Store\'s database step 4 at this site: the Admin runs sql/store_step4_grn_no.sql once in Supabase → SQL Editor (in every site). Until then the GRN gets the next number by itself – leave its GRN No as it comes.';
/* (28-10-2026, his formats – "DIESEL PURCHASE ORDER", "REQUIREMENT OF EXHAUST FANS") the papers' own settings of a site (Store
 * Settings – the Store Admin): the numbers' prefix ("RCL/VTR"), the heading's e-mail, contact, CIN, web, and what a new PO starts with
 * (its shipping address, site contact, terms). Kept in store_settings 'papers' (no database step). */
const PAPERS = ['prefix', 'email', 'phone', 'cin', 'web', 'ship_to', 'site_contact', 'terms'];
const papersOf = site => kept(site, 'papers', async () => { const r = ((await db(site, 'GET', 'store_settings?select=value&id=eq.papers')) || [])[0]; return Object.assign({}, r && r.value && typeof r.value === 'object' ? r.value : {}); });
// the prefix of the papers' numbers: as set, else the company's initials and the site ("RCL/VTR")
const prefixOf = (pp, h, site) => pp.prefix || [W.initialsOf(h && h.company), site].filter(Boolean).join('/');
// is the Store's step 5 (the PO's own fields, its approval) in this site's database?
const step5On = site => kept(site, 'step5', async () => { try { await db(site, 'GET', 'store_po?select=appr&limit=1'); return true; } catch (e) { if (e && e.code === 'notinstalled') throw e; return false; } });
const STEP5 = 'The purchase order\'s Credit Period, Site Contact, Shipping Address, Freight, Load / Unload and its approval need the Store\'s database step 5 at this site: the Admin runs sql/store_step5_po_format.sql once in Supabase → SQL Editor (in every site). Until then a PO is saved without them – leave them empty.';
// (29-10-2026) is the Store's step 6 (the GRN's discounts, a line's net rate) in this site's database?
const step6On = site => kept(site, 'step6', async () => { try { await db(site, 'GET', 'store_grn_lines?select=net_rate&limit=1'); return true; } catch (e) { if (e && e.code === 'notinstalled') throw e; return false; } });
const STEP6 = 'A discount on a GRN (on a line or on the whole bill) needs the Store\'s database step 6 at this site: the Admin runs sql/store_step6_grn_discount.sql once in Supabase → SQL Editor (in every site). Until then a GRN is saved without a discount – leave it empty.';
// who approves the POs of a site (the Portal tells: store_settings 'approvers' → po)
const poPeople = async site => { const r = ((await db(site, 'GET', 'store_settings?select=value&id=eq.approvers')) || [])[0]; return W.poApprovers(r ? r.value : null); };
const apprOf = p => p.appr || 'Approved';      // a PO made before step 5: as approved
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
  return Object.assign({}, p, { lines: lines, state: state, appr: apprOf(p) });
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
    const co = st && st.company_id ? ((await db(home.code, 'GET', 'rcl_companies?select=id,name,address,gstin,pan,logo&id=eq.' + enc(st.company_id))) || [])[0] : null;
    return { site: st ? st.name : site, company: co ? co.name : '', address: co ? co.address || '' : '', gstin: co ? co.gstin || '' : '', pan: co ? co.pan || '' : '', logo: co && /^(https:\/\/|data:image\/)/.test(String(co.logo || '')) ? co.logo : '' };
  } catch (e) { return null; }
}
const brief = i => ({ code: i.code, name: i.name, unit: i.unit, category: i.category, hsn: i.hsn || '', gst_pct: i.gst_pct, min_stock: i.min_stock, status: i.status });

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
    if (can(s, 'grn', 'View')) { const g = (await dbAll(s.site, 'store_grn?select=*&date=gte.' + t.slice(0, 8) + '01', 'no')).map(x => ({ no: x.no, ref: R.refOf(x), date: x.date, supplier: x.supplier, gross: x.gross })); out.grn = { today: g.filter(x => x.date === t).length, todayValue: r2(g.filter(x => x.date === t).reduce((a, x) => a + num(x.gross), 0)), month: g.length, monthValue: r2(g.reduce((a, x) => a + num(x.gross), 0)), recent: g.sort(byNo).slice(0, 8) }; }
    if (can(s, 'issue', 'View')) { const g = await dbAll(s.site, 'store_issue?select=no,date,to_kind,party,machinery,use_for,amount&date=gte.' + t.slice(0, 8) + '01', 'no'); out.issue = { today: g.filter(x => x.date === t).length, todayValue: r2(g.filter(x => x.date === t).reduce((a, x) => a + num(x.amount), 0)), month: g.length, monthValue: r2(g.reduce((a, x) => a + num(x.amount), 0)), recent: g.sort(byNo).slice(0, 8) }; }
    return out;
  },

  /* ---------- MATERIAL REQUIREMENT ---------- */
  async reqList(s) {
    const lv = await levels(s.site);
    if (!can(s, 'req', 'View') && !isBuyer(s) && !lv.some(l => l.people.some(p => p.email === String(s.email).toLowerCase()))) need(s, 'req', 'View');
    const [reqs, pos] = await Promise.all([dbAll(s.site, 'store_req?select=*', 'no'), dbAll(s.site, 'store_po?select=no,status,lines', 'no')]);
    const ordered = orderedOf(pos);
    const [h, pp] = await Promise.all([headingOf(s.site), papersOf(s.site)]), pre = prefixOf(pp, h, s.site);
    return { reqs: reqs.sort(byNo).map(r => Object.assign(reqView(r, ordered, lv, s), { ref: W.refOf(pre, 'PR', r.date, r.no) })), levels: lv.map(l => ({ level: l.level, people: l.people.map(p => p.name) })),
      heading: Object.assign({}, h || {}, { email: pp.email || '', phone: pp.phone || '', cin: pp.cin || '', web: pp.web || '' }) };      // (28-10-2026) for its paper (the Purchase Requisition Form)
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
    todayOnly(s, r.date, 'Requirement', cur ? String(cur.date).slice(0, 10) : '');
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
    const [items, nm, pp, s5] = await Promise.all([itemsOf(site), names(site), papersOf(site), step5On(site)]);
    return { site: site, items: Object.values(items).filter(i => i.status === 'Active').map(brief).sort((a, b) => a.name.localeCompare(b.name)), vendors: nm.vendors, gst: nm.gst,
      papers: { ship_to: pp.ship_to || '', site_contact: pp.site_contact || '', terms: pp.terms || '' }, step5: s5 };      // (28-10-2026) what a new PO of this site starts with
  },
  async poList(s, x) {
    const site = await siteFor(s, x), mine = await poPeople(s.site);      // (28-10-2026) one who approves POs sees them (as one who approves requirements)
    if (!isBuyer(s) && !can(s, 'po', 'View') && !can(s, 'grn', 'View') && !mine.some(p => p.email === String(s.email).toLowerCase())) need(s, 'po', 'View');
    const sites = x.all && isBuyer(s) ? await storeSites() : [{ code: site, name: site }], out = [];
    for (const st of sites) {
      try {
        const pos = await dbAll(st.code, 'store_po?select=*', 'no'), rec = await receivedOf(st.code, pos.map(p => p.no));
        const who = st.code === s.site ? mine : [];      // a PO is approved by a person of its own site, signed in there
        pos.sort(byNo).forEach(p => { const v = poView(p, rec);
          out.push(Object.assign(v, { site: st.code, siteName: st.name, mayApprove: p.status === 'Open' && v.appr === 'Waiting' && W.mayApprovePo(who, s.email, p.created_by),
            waitFor: v.appr === 'Waiting' ? who.filter(q => q.email !== String(p.created_by || '').toLowerCase()).map(q => q.name) : [] })); });
      } catch (e) { if (sites.length === 1) throw e; }
    }
    return { pos: out };
  },
  async poGet(s, x) {
    const site = await siteFor(s, x), no = noOf(x.no), mine = await poPeople(s.site);
    if (!isBuyer(s) && !can(s, 'po', 'View') && !can(s, 'grn', 'View') && !mine.some(p => p.email === String(s.email).toLowerCase())) need(s, 'po', 'View');
    const p = ((await db(site, 'GET', 'store_po?select=*&no=eq.' + no)) || [])[0]; if (!p) throw gone('PO ' + no);
    const [h, pp, items] = await Promise.all([headingOf(site), papersOf(site), itemsOf(site)]);
    // (28-10-2026, his format) the supplier's details from the Vendor Master of the site (Mechanical's – the same database): address,
    // mobile, e-mail, the Owner Name as the contact person, GSTIN – what is not there stays blank
    let v = null; try { v = ((await dbAll(site, 'vendors?select=*', 'id')) || []).find(r => I.keyOf(r.vendor_name) === I.keyOf(p.vendor)) || null; } catch (e) { v = null; }
    const supplier = { name: p.vendor, address: v ? v.address || '' : '', mobile: v ? v.phone || '' : '', email: v ? v.email || '' : '', contact: v ? v.owner_name || '' : '', gstin: p.vendor_gst || (v ? v.gst_number || '' : '') };
    const po = Object.assign(poView(p, await receivedOf(site, [no])), { site: site, ref: W.refOf(prefixOf(pp, h, site), 'PO', p.date, p.no), words: W.inWords(p.total),
      lines: sortLines(p.lines).map(l => Object.assign({}, l, { hsn: l.hsn || (items[l.code] || {}).hsn || '' })) });
    return { po: po, supplier: supplier, heading: Object.assign({}, h || {}, { email: pp.email || '', phone: pp.phone || '', cin: pp.cin || '', web: pp.web || '' }) };
  },
  async poSave(s, x) {
    buyerOnly(s);
    const site = await siteFor(s, x), no = x.no ? noOf(x.no) : null, items = await itemsOf(site);
    let cur = null;
    if (no) { cur = ((await db(site, 'GET', 'store_po?select=*&no=eq.' + no)) || [])[0]; if (!cur) throw gone('PO ' + no); if (cur.status !== 'Open') throw fail(409, 'PO ' + no + ' is ' + cur.status.toLowerCase() + ' – it is not changed.', 'decided'); }
    const rn = [...new Set(((x.po && x.po.lines) || []).map(l => Number(l && l.req_no)).filter(n => Number.isInteger(n) && n > 0))];
    const reqs = {}; if (rn.length) (await dbAll(site, 'store_req?select=no,status,lines&no=in.(' + rn.join(',') + ')', 'no')).forEach(r => { reqs[r.no] = r; });
    let p; try { p = W.checkPo(x.po, items, { reqs: reqs, had: new Set(cur ? (cur.lines || []).map(l => l.code) : []) }); } catch (e) { userErr(e); }
    todayOnly(s, p.date, 'Purchase order', cur ? String(cur.date).slice(0, 10) : '');
    const fresh = rn.filter(n => !cur || !(cur.lines || []).some(l => Number(l.req_no) === n));
    fresh.forEach(n => { if (!reqs[n] || reqs[n].status !== 'Approved') throw fail(409, 'Requirement ' + n + ' is not approved (or no longer open) – it cannot be ordered.', 'notapproved'); });
    p.vendor = party(p.vendor, (await names(site)).vendors, x.confirmParty, 'vendor');
    // (28-10-2026) step 5: the PO's own fields and its approval – without the step, a PO with them is refused (they would be lost)
    const s5 = await step5On(site);
    if (!s5 && (p.credit_days !== null || p.site_contact || p.ship_to || p.freight > 0 || p.load_unload > 0)) throw fail(400, STEP5, 'sql');
    if (s5) { const others = (await poPeople(site)).filter(q => q.email !== String(s.email).toLowerCase());
      p.appr = others.length ? 'Waiting' : 'Approved'; p.appr_note = others.length ? '' : 'Nobody approves purchase orders at this site – approved when made.'; }
    if (cur) {      // a changed PO: never less than already came
      const rec = await receivedOf(site, [no]);
      (cur.lines || []).forEach(l => { const got = rec[no + ':' + l.line] || 0, nl = p.lines.find(y => y.line === l.line && y.code === l.code); if (got > 0 && (!nl || nl.qty + 0.0005 < got)) throw fail(409, l.name + ': ' + r3(got) + ' ' + l.unit + ' already came on PO ' + no + ' – the PO keeps at least that (line ' + l.line + ').', 'received'); });
    }
    const n = await rpc(site, 'store_po_put', { p_no: no, p_row: p, p_by: s.email, p_name: s.name }).catch(e => said(e, items));
    changed(site);
    await activity(site, s.email, no ? 'PO changed' : 'PO made', 'PO ' + n, { vendor: p.vendor, total: p.total, lines: p.lines.length, by: s.site !== site ? 'HO Purchase (' + s.site + ')' : undefined });
    return { ok: true, site: site, no: Number(n), total: p.total, appr: p.appr || 'Approved' };
  },
  /* (28-10-2026, his answer: "PO approve karaychi payri kara") a PO waiting for its approval: approved (his name goes on the PO's
   * "Approved By") or rejected, saying why (the one who made it changes it – it waits again). Only one the Super Admin ticked for this
   * site ("Approves purchase orders"), never his own; only a PO still open and waiting. */
  async poDecide(s, x) {
    if (!(await step5On(s.site))) throw fail(400, STEP5, 'sql');
    const no = noOf(x.no), ok = x.ok === true, note = I.clean(x.note, 300), people = await poPeople(s.site);
    const p = ((await db(s.site, 'GET', 'store_po?select=no,status,appr,created_by,total,vendor&no=eq.' + no)) || [])[0]; if (!p) throw gone('PO ' + no);
    if (!W.mayApprovePo(people, s.email, p.created_by)) throw fail(403, String(p.created_by || '').toLowerCase() === String(s.email).toLowerCase() ? 'Nobody approves his own purchase order.' : 'You do not approve the purchase orders of this site – the Super Admin gives it in the Portal ("Approves purchase orders").', 'approve');
    if (p.status !== 'Open' || apprOf(p) !== 'Waiting') throw fail(409, 'PO ' + no + ' is not waiting for its approval any more (it is ' + (p.status !== 'Open' ? p.status.toLowerCase() : apprOf(p).toLowerCase()) + ') – refresh.', 'decided');
    if (!ok && !note) throw fail(400, 'Say why the PO is rejected (the one who made it sees it).', 'field');
    const r = await db(s.site, 'PATCH', 'store_po?no=eq.' + no + '&status=eq.Open&appr=eq.Waiting', { appr: ok ? 'Approved' : 'Rejected', appr_by: s.email, appr_name: s.name, appr_at: new Date().toISOString(), appr_note: note || null }, 'return=representation');
    if (!r || !r.length) throw fail(409, 'PO ' + no + ' was decided by someone else just now – refresh.', 'decided');
    changed(s.site);
    await activity(s.site, s.email, ok ? 'PO approved' : 'PO rejected', 'PO ' + no, { vendor: p.vendor, total: num(p.total), note: note || undefined });
    return { ok: true, no: no, appr: ok ? 'Approved' : 'Rejected' };
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
    // (28-10-2026) the newest first by date, then by GRN No (an imported GRN's number is its GRN No – "342-A" too – not its row's)
    return { from: p.from, to: p.to, grns: g.sort((a, b) => b.date.localeCompare(a.date) || R.refCmp(b, a)).map(r => Object.assign({}, r, { ref: R.refOf(r), lines: sortLines(r.store_grn_lines), store_grn_lines: undefined })) };
  },
  // this site's open POs with what is still to come (a GRN against a PO)
  async poOpen(s, x) {
    need(s, 'grn', 'Edit');
    // (29-10-2026, "PO Qty, आलेले, Shortage दिसावे") a GRN being changed (x.grn): its own PO too, and what came on it BEFORE that GRN
    const gno = x && x.grn ? noOf(x.grn) : null, own = gno ? ((await db(s.site, 'GET', 'store_grn?select=po_no&no=eq.' + gno)) || [])[0] : null, ownPo = own && own.po_no ? Number(own.po_no) : null;
    const pos = await dbAll(s.site, 'store_po?select=*&status=eq.Open', 'no');
    if (ownPo && !pos.some(p => Number(p.no) === ownPo)) { const p = ((await db(s.site, 'GET', 'store_po?select=*&no=eq.' + ownPo)) || [])[0]; if (p) pos.push(p); }
    const rec = await receivedOf(s.site, pos.map(p => p.no), gno || undefined);
    return { pos: pos.sort(byNo).map(p => poView(p, rec)).filter(p => (p.state !== 'Received' && p.appr === 'Approved') || Number(p.no) === ownPo) };      // (28-10-2026) a PO not approved yet: its material is not taken in on it
  },
  // (28-10-2026) the new GRN's form: the next GRN No (it can be changed by hand where step 4 is run)
  async grnNext(s) {
    need(s, 'grn', 'Edit');
    const [next, on, s6] = await Promise.all([nextGrn(s.site), step4On(s.site), step6On(s.site)]);
    return { next: next, step4: on, step6: s6 };
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
      if (apprOf(po) !== 'Approved' && !(cur && Number(cur.po_no) === poNo)) throw fail(409, 'PO ' + poNo + ' is ' + (apprOf(po) === 'Rejected' ? 'rejected' : 'not approved yet') + ' – its material is taken in on it only after it is approved.', 'notapproved');
    }
    let g; try { g = W.checkGrn(x.grn, items, { po: po, had: new Set(cur ? (cur.store_grn_lines || []).map(l => l.code) : []) }); } catch (e) { userErr(e); }
    todayOnly(s, g.head.date, 'GRN');
    // (29-10-2026) a discount needs step 6 (else it would be lost)
    if ((g.head.disc > 0 || g.lines.some(l => l.disc > 0)) && !(await step6On(s.site))) throw fail(400, STEP6, 'sql');
    g.head.supplier = party(g.head.supplier, (await names(s.site)).suppliers.concat(po ? [po.vendor] : []), x.confirmParty, 'supplier');
    if (po && !x.confirmOver) {      // more than the PO still has to come: asked first
      const rec = await receivedOf(s.site, [poNo], no), over = [];
      g.lines.filter(l => l.po_line).forEach(l => { const pl = (po.lines || []).find(z => Number(z.line) === l.po_line), left = r3(num(pl.qty) - num(rec[poNo + ':' + l.po_line])); if (l.qty > left + 0.0005) over.push(l.name + ': ' + l.qty + ' ' + l.unit + ' (PO still has ' + Math.max(0, left) + ')'); });
      if (over.length) throw fail(409, 'More than PO ' + poNo + ' still has to come – ' + over.join('; ') + '. Take it in anyway?', 'over', { over: over });
    }
    let n;
    if (!no && g.head.ref) {      // (step 4) a new GRN with its GRN No: saved with it in one go – a number already used is refused
      n = await rpc(s.site, 'store_grn_new', { p_head: g.head, p_lines: g.lines, p_ref: g.head.ref, p_by: s.email, p_name: s.name }).catch(async e => {
        if (e && (e.code === 'notinstalled' || /store_grn_new|PGRST202|42883/i.test(String(e.message)))) {      // no step 4 here: only the number as it came
          if (g.head.ref === String(await nextGrn(s.site))) return rpc(s.site, 'store_grn_put', { p_no: null, p_head: g.head, p_lines: g.lines, p_by: s.email, p_name: s.name }).catch(e2 => said(e2, items));
          throw fail(400, STEP4, 'sql');
        }
        if (e && e.code === 'rule' && /^STORE_REF_USED/.test(String(e.message))) { const nx = await nextGrn(s.site); throw fail(409, 'GRN No ' + g.head.ref + ' is already used by another GRN – the next free number is ' + nx + '. Nothing was saved.', 'refused', { next: nx }); }
        return said(e, items);
      });
    } else n = await rpc(s.site, 'store_grn_put', { p_no: no, p_head: g.head, p_lines: g.lines, p_by: s.email, p_name: s.name }).catch(e => said(e, items));
    changed(s.site);
    await activity(s.site, s.email, no ? 'GRN changed' : 'GRN made', 'GRN ' + (!no && g.head.ref ? g.head.ref : n), { supplier: g.head.supplier, gross: g.head.gross, lines: g.lines.map(l => l.name + ' ' + l.qty + ' ' + l.unit), po: poNo || undefined });
    return { ok: true, no: Number(n), ref: !no && g.head.ref ? g.head.ref : String(n), gross: g.head.gross };
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
    todayOnly(s, date, 'Issue');
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
    todayOnly(s, g.head.date, 'Return');
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

  /* ---------- (28-10-2026) THE OLD INWARD REGISTER (his "INWARD UPTO GRN …", sheet MAIN SHEET INWARD1) – the Store Admin. The page reads
   * the file, puts every GRN together and shows the check (nothing saved); here: what is there already, the names written in more
   * than one way (the AI – he ticks), the suppliers made in the site's Vendor Master ("Material Supplier"), the items made, the GRNs
   * saved a part at a time with the file's GRN No – a GRN already in the Store never twice (lib/grnimport.js). ---------- */
  async regInfo(s) {
    adminOnly(s, 'import the old inward register');
    let step3 = true; try { await db(s.site, 'GET', 'store_grn?select=ref&limit=1'); } catch (e) { if (/ref|42703|PGRST204|column/i.test(String(e && e.message))) step3 = false; else throw e; }
    const [items, ven, grns, nums] = await Promise.all([itemsOf(s.site), dbAll(s.site, 'vendors?select=id,vendor_name', 'id').catch(() => []),
      dbAll(s.site, 'store_grn?select=no,' + (step3 ? 'ref,' : '') + 'date,supplier,invoice_no', 'no'), db(s.site, 'GET', 'store_numbers?select=next_no&kind=eq.GRN')]);
    return { step3: step3, ai: AI.on(), today: W.today(), units: I.UNITS, next: Number(((nums || [])[0] || {}).next_no || 1),
      items: Object.values(items).map(i => [i.code, i.name, i.unit, i.category]), vendors: ven.map(v => v.vendor_name).filter(Boolean),
      grns: grns.map(g => [G.docKey(g.ref || g.no, g.date, g.supplier, g.invoice_no), String(g.ref || g.no), g.no, g.date, g.supplier]) };
  },
  // the names of the file written in more than one way (the AI) – suppliers, items or categories; he ticks what is changed
  async regNames(s, x) {
    adminOnly(s, 'import the old inward register');
    const what = { supplier: 'SUPPLIER names (the shop, dealer or company the material came from)', item: 'ITEM names (the material, part, oil, tool, service)', category: 'CATEGORY names (the kind of material)' }[x.list];
    if (!what) throw fail(400, 'Which names?', 'field');
    const seen = {}, names = (Array.isArray(x.names) ? x.names : []).map(a => Array.isArray(a) ? [I.clean(a[0], 120), Math.max(1, Math.floor(num(a[1])) || 1)] : [I.clean(a, 120), 1])
      .filter(a => a[0] && !seen[a[0]] && (seen[a[0]] = true)).slice(0, 800);
    if (names.length < 2) return { fixes: [] };
    const saved = (Array.isArray(x.saved) ? x.saved : []).map(v => I.clean(v, 120)).filter(Boolean).slice(0, 3000);
    const ask = 'NAMES OF AN OLD STORE INWARD REGISTER (GRN) of a construction company in India. The same name is often written in several ways: a letter missing or extra, ' +
      'another spelling, spaces or dots, a short form, singular / plural (e.g. "LABOUR CHARGE" and "Labour Charges"; "Hardeware" for "Hardware"; "Shree Ganesh Electrical & Hardware" and "Shri Ganesh Electricals & Hardware"). ' +
      'In the list of ' + what + ' below find the names that are the SAME thing written differently, and give for each of them its right spelling: the name already saved when it is one of them, ' +
      'else the spelling most rows use. Different things stay apart – never put together two different parts, sizes, grades, models, colours or numbers (FUEL FILTER and OIL FILTER, 10 MM and 12 MM, ' +
      '15W40 and 20W50, M-40 and M-30, a part number and another) or two different companies (a branch or a place in the name makes another one: "Vandana Auto Center" is not "Vandana Motors"). ' +
      'A name already right is not given. Answer with JSON only: {"fixes": [[nameInTheList, rightSpelling], …]} – nameInTheList exactly as it is below.\n' +
      'In the file, [name, rows]: ' + JSON.stringify(names) + (saved.length ? '\nAlready saved: ' + JSON.stringify(saved) : '');
    let j; try { j = await AI.askJson(ask, { tokens: 8000, ms: 26000 }); } catch (e) { userErr(e); }
    const has = {}; names.forEach(a => { has[a[0]] = true; });
    const out = [], done = {};
    (Array.isArray(j && j.fixes) ? j.fixes : []).forEach(z => {
      const a = Array.isArray(z) ? z : z && typeof z === 'object' ? [z.from || z.nameInTheList, z.to || z.rightSpelling] : [];
      const from = I.clean(a[0], 120), to = I.clean(a[1], x.list === 'supplier' ? 80 : x.list === 'category' ? 40 : 120);
      if (!has[from] || !to || to === from || done[from]) return;
      done[from] = true; out.push([from, to]);
    });
    return { fixes: out.slice(0, 5000) };
  },
  // the suppliers of the file made in the site's Vendor Master (Mechanical's – the same database) as "Material Supplier": the name only,
  // GST / PAN / Aadhaar to be filled later; a name already there is left
  async regVendors(s, x) {
    adminOnly(s, 'import the old inward register');
    const want = [...new Set((Array.isArray(x.names) ? x.names : []).map(v => I.clean(v, 80)).filter(v => I.keyOf(v).length >= 2))].slice(0, 1000);
    if (!want.length) return { added: 0, have: 0 };
    const have = new Set((await dbAll(s.site, 'vendors?select=id,vendor_name', 'id')).map(v => I.keyOf(v.vendor_name)));
    const now = new Date().toISOString(), rows = [];
    want.forEach(n => { const k = I.keyOf(n); if (have.has(k)) return; have.add(k);
      rows.push({ id: n.replace(/\s+/g, ' ').trim().toUpperCase(), vendor_name: n, gst_registered: 'No', vendor_type: 'Material Supplier', remark: 'Material supplier – from the Store\'s old inward register (GST, PAN, Aadhaar to be filled)', entered_at: now, entered_by: s.email, owner_site: s.site }); });
    if (rows.length) {
      const put = r => db(s.site, 'POST', 'vendors', r, 'resolution=ignore-duplicates,return=minimal');
      try { await put(rows); } catch (e) { if (/owner_site|vendor_type|42703|PGRST204/i.test(String(e && e.message))) await put(rows.map(r => { const o = Object.assign({}, r); delete o.owner_site; if (/vendor_type/i.test(String(e.message))) delete o.vendor_type; return o; })); else throw e; }
      changed(s.site);
      await activity(s.site, s.email, 'Suppliers made (old inward register)', rows.length + ' suppliers', { names: rows.map(r => r.vendor_name).slice(0, 300) });
    }
    return { added: rows.length, have: want.length - rows.length };
  },
  // the items of the file made in the Item Master: [{ name, unit, category, gst }] – a name already there (its key) is left
  async regItems(s, x) {
    adminOnly(s, 'import the old inward register');
    const rows = (Array.isArray(x.items) ? x.items : []).slice(0, 1501);
    if (rows.length > 1500) throw fail(400, 'At most 1,500 items in one part.', 'field');
    const list = await dbAll(s.site, 'items?select=code,name,name_key', 'code'), have = new Set(list.map(i => i.name_key || I.keyOf(i.name))), ins = [], bad = [];
    rows.forEach(r => {
      let it; try { it = I.check({ name: r && r.name, unit: r && r.unit, category: (r && r.category) || 'General', gst: r && r.gst !== undefined && r.gst !== null ? String(r.gst) : '' }); }
      catch (e) { if (!(e && e.user)) throw e; bad.push({ name: String((r && r.name) || '').slice(0, 120), msg: e.message }); return; }
      if (have.has(it.name_key)) return; have.add(it.name_key);
      ins.push(Object.assign(it, { created_by: s.email }));      // (its "similar_note" stays empty: that note says "near another name – confirmed different")
    });
    let added = [];
    if (ins.length) {
      const codes = await codesAll(s.site);
      ins.forEach((it, k) => { it.code = nextCode(codes, k); });
      try { added = (await db(s.site, 'POST', 'items', ins, 'return=representation')) || []; }
      catch (e) { if (e && e.code === 'duplicate') throw fail(409, 'An item of this part was saved by someone else meanwhile – press Import again (what is there is left).', 'exact'); throw e; }
      const after = await codesAll(s.site), fixed = []; for (const i of added) fixed.push(await codeOnce(s.site, i, after)); added = fixed;
      changed(s.site);
      await activity(s.site, s.email, 'Items made (old inward register)', added.length + ' items', { added: added.map(i => i.code + ' ' + i.name).slice(0, 300) });
    }
    return { added: added.map(i => [i.code, i.name]), have: rows.length - ins.length - bad.length, bad: bad };
  },
  // a part of the GRNs: each checked (lib/grnimport.js – its items in the Item Master); one already in the Store (its GRN No, date,
  // supplier, invoice) is left out; the rest saved in one go with the file's GRN No (the database: store_grn_import, SQL step 3)
  async regGrns(s, x) {
    adminOnly(s, 'import the old inward register');
    const docs = Array.isArray(x.docs) ? x.docs.slice(0, 401) : [];
    if (docs.length > 400) throw fail(400, 'At most 400 GRNs in one part.', 'field');
    if (docs.reduce((a, d) => a + (Array.isArray(d && d.lines) ? d.lines.length : 0), 0) > 4000) throw fail(400, 'At most 4,000 lines in one part.', 'field');
    const items = await itemsOf(s.site), byKey = {}; Object.values(items).forEach(i => { byKey[I.keyOf(i.name)] = i; });
    const t = W.today(), good = [], errors = [], skipped = [];
    docs.forEach(d => { try { good.push(G.checkDoc(d, byKey, t)); } catch (e) { if (!(e && e.user)) throw e; errors.push({ ref: String((d && d.ref) || ''), msg: e.message }); } });
    if (good.length) {
      // the Store's GRNs of the same days (only those days – a part of the file can have a date far from the others); a GRN of the file
      // without a GRN No got a number at its import: it is the same GRN when its date, supplier and invoice are
      const days = [...new Set(good.map(g => g.head.date))], there = new Set(), noRef = k => k.replace(/^[^|]*/, '');
      for (let i = 0; i < days.length; i += 60) (await dbAll(s.site, 'store_grn?select=*&date=in.(' + days.slice(i, i + 60).join(',') + ')', 'no')).forEach(g => { const k = G.docKey(g.ref || g.no, g.date, g.supplier, g.invoice_no); there.add(k); there.add('*' + noRef(k)); });
      for (let i = 0; i < good.length; i++) { const k = good[i].key, k2 = '*' + noRef(k), was = good[i].head.ref ? there.has(k) : there.has(k2);
        if (was) { skipped.push(good[i].head.ref || ''); good.splice(i--, 1); } else { there.add(k); if (!good[i].head.ref) there.add(k2); } }
    }
    let saved = [];
    if (good.length) {
      saved = (await rpc(s.site, 'store_grn_import', { p_docs: good.map(g => ({ head: g.head, lines: g.lines })), p_by: s.email, p_name: s.name }).catch(e => {
        if (e && (e.code === 'notinstalled' || /store_grn_import|PGRST202|42883/i.test(String(e.message)))) throw fail(400, 'The Store\'s database step 3 is not run here yet: the Admin runs sql/store_step3_grn_import.sql once in Supabase → SQL Editor (in every site).', 'sql');
        return said(e, items); })) || [];
      changed(s.site);
      await activity(s.site, s.email, 'GRNs imported (old inward register)', saved.length + ' GRNs', { refs: saved.map(z => z.ref).slice(0, 400), skipped: skipped.length, errors: errors.length });
    }
    return { saved: saved, skipped: skipped, errors: errors };
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
      const nos = kind => [...new Set(moves.filter(m => m.kind === kind && m.date >= p.from).map(m => m.no))], refs = {};
      const get = async (t, sel, kind, f) => { const l = nos(kind); for (let i = 0; i < l.length; i += 150) (await dbAll(s.site, t + '?select=' + (sel === '*' ? '*' : 'no,' + sel) + '&no=in.(' + l.slice(i, i + 150).join(',') + ')', 'no')).forEach(r => { who[kind + ':' + r.no] = f(r); if (r.ref) refs[kind + ':' + r.no] = r.ref; }); };
      await Promise.all([get('store_grn', '*', 'GRN', r => r.supplier), get('store_issue', 'to_kind,party,machinery,location,use_for', 'OUT', r => [r.party || (r.to_kind === 'Site work' ? 'RCL' : r.to_kind), r.machinery, r.location, r.use_for].filter(Boolean).join(' · ')), get('store_return', 'party,issue_no', 'RET', r => (r.party || '') + ' (outward ' + r.issue_no + ')')]);
      return R.ledger(it, moves, who, p.from, p.to, refs);
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

  /* ---------- (28-10-2026) THE ASSISTANT'S LOOK-UPS ("AI la app cha main brain": Mechanical's Ask answers about the Store too) –
   * read only, each through the Store's own report with every check of the person's Store access (lib/ailook.js) ---------- */
  async aiLook(s, x) {
    try { return await AL.look(x || {}, { report: (kind, y) => ACTIONS.report(s, Object.assign({}, y, { kind: kind })), items: () => itemsOf(s.site) }); }
    catch (e) { return userErr(e); }
  },

  /* ---------- SETTINGS (the Store Admin): where the GRN and Outward numbers go on from ---------- */
  async numbers(s) {
    adminOnly(s, 'see the numbers');
    // (28-10-2026) the last GRN number used: an old register's GRN whose GRN No was used already ("342-A", a second supplier) has a
    // number of its own beyond 1,000,000,000 – not one the next GRN goes on from
    const [nums, g, o] = await Promise.all([db(s.site, 'GET', 'store_numbers?select=kind,next_no'), db(s.site, 'GET', 'store_grn?select=no&no=lt.1000000000&order=no.desc&limit=1'), db(s.site, 'GET', 'store_issue?select=no&order=no.desc&limit=1')]);
    const n = {}; (nums || []).forEach(r => { n[r.kind] = Number(r.next_no); });
    const [pp, h, s5] = await Promise.all([papersOf(s.site), headingOf(s.site), step5On(s.site)]);
    return { next: { GRN: n.GRN || 1, OUT: n.OUT || 1 }, used: { GRN: g && g[0] ? Number(g[0].no) : 0, OUT: o && o[0] ? Number(o[0].no) : 0 }, papers: pp, prefixNow: prefixOf(pp, h, s.site), step5: s5 };
  },
  // (28-10-2026) the papers' settings (the Store Admin): the numbers' prefix, the heading's e-mail / contact / CIN / web, a new PO's
  // shipping address, site contact and terms – each as typed (empty = none)
  async papersSave(s, x) {
    adminOnly(s, 'set the papers');
    const v = {}, max = { prefix: 30, email: 80, phone: 60, cin: 30, web: 80, ship_to: 300, site_contact: 120, terms: 3000 };
    PAPERS.forEach(k => { const raw = String(x[k] === undefined || x[k] === null ? '' : x[k]); const t = (k === 'terms' || k === 'ship_to' ? raw.split(/\r?\n/).map(l => I.clean(l, 400)).filter(Boolean).join('\n') : I.clean(raw, max[k])).slice(0, max[k]); if (t) v[k] = t; });
    if (v.prefix && !/^[A-Za-z0-9][A-Za-z0-9/-]*$/.test(v.prefix)) throw fail(400, 'The prefix of the numbers may have only letters, digits, "/" and "-" (e.g. RCL/VTR).', 'field');
    if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) throw fail(400, 'The e-mail "' + v.email + '" is not an e-mail address.', 'field');
    await db(s.site, 'POST', 'store_settings', [{ id: 'papers', value: v, updated_by: s.email }], 'resolution=merge-duplicates,return=minimal');
    changed(s.site); await activity(s.site, s.email, 'Papers set', s.site, v);
    return Object.assign(await ACTIONS.numbers(s), { ok: true });
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
module.exports.todayOnly = todayOnly;      // (for the unit test – 29-10-2026)
