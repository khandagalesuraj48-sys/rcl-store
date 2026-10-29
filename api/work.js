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
const { db, dbAll, files, registry } = require('../lib/sites');
const crypto = require('crypto');
const { activity } = require('../lib/activity');
const W = require('../lib/work');
const R = require('../lib/sreport');
const I = require('../lib/items');
const G = require('../lib/grnimport');
const AI = require('../lib/ai');
const AL = require('../lib/ailook');
const { codesAll, nextCode, codeOnce } = require('../lib/itemcodes');
const ML = require('../lib/mlog');
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
/* (29-10-2026) THE SITE'S WORKFLOW – as the Super Admin set it in the Portal (lib/work.js wfOf): who verifies each work, who approves the
 * GRN and the issues, what goes to Head Office once approved. Read afresh (one small row) – a person taken off it is off at once. */
const wfAt = async site => { const r = ((await db(site, 'GET', 'store_settings?select=value&id=eq.approvers')) || [])[0]; return W.wfOf(r && r.value); };
const me_ = s => String(s.email || '').toLowerCase();
// one who verifies or approves a work sees its page (to do it there), as one who approves the requirements sees them
const seeWork = (s, page, wf, kind) => can(s, page, 'View') || W.isIn(wf.verify[kind], s.email) || W.isIn((wf.approve || {})[kind], s.email);
// a few lists kept on this server for 2 minutes (machinery, vendors, names typed before) – emptied by this server's own saves
const CACHE = new Map();
async function kept(site, what, f) {
  const k = site + '|' + what, c = CACHE.get(k);
  if (c && Date.now() - c.at < 120000) return c.p;
  if (CACHE.size > 200) CACHE.clear();
  const e = { at: Date.now(), p: f() }; CACHE.set(k, e); e.p.catch(() => { if (CACHE.get(k) === e) CACHE.delete(k); });
  return e.p;
}
const changed = site => { [...CACHE.keys()].forEach(k => { if (k.startsWith(site + '|')) CACHE.delete(k); }); LIVE.delete(site); };      // (29-10-2026) and its live answer: the next look sees the change
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
  // (29-10-2026, the Store's step 8) a requirement in a purchase order; a paper changed meanwhile; a PO whose material came
  if ((x = /^STORE_REQ_ORDERED (\d+)\|(\d+)/.exec(m))) throw fail(409, 'Requirement ' + x[1] + ' is in PO ' + x[2] + ' – delete PO ' + x[2] + ' first (HO Purchase), then change or delete the requirement.', 'ordered', { po: Number(x[2]) });
  if ((x = /^STORE_REQ_STATE (\d+)\|(.*)$/.exec(m))) throw fail(409, 'Requirement ' + x[1] + ' is ' + String(x[2]).toLowerCase() + ' – it is not changed.', 'decided');
  if (/^STORE_CHANGED/.test(m)) throw fail(409, 'It was changed by someone else just now – refresh and look.', 'decided');
  if ((x = /^STORE_PO_RECEIVED (\d+)/.exec(m))) throw fail(409, 'Material of PO ' + x[1] + ' has come (a GRN has it) – it cannot be deleted. Close it (the rest will not come).', 'received');
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
const PAPERS = ['prefix', 'email', 'phone', 'cin', 'web', 'ship_to', 'site_contact', 'terms', 'site_address'];      // (29-10-2026) site_address: the site's address on the papers
const papersOf = site => kept(site, 'papers', async () => { const r = ((await db(site, 'GET', 'store_settings?select=value&id=eq.papers')) || [])[0]; return Object.assign({}, r && r.value && typeof r.value === 'object' ? r.value : {}); });
// the prefix of the papers' numbers: as set, else the company's initials and the site ("RCL/VTR")
const prefixOf = (pp, h, site) => pp.prefix || [W.initialsOf(h && h.company), site].filter(Boolean).join('/');
// is the Store's step 5 (the PO's own fields, its approval) in this site's database?
// (29-10-2026, the review) a step's column there? false only when the database says it is missing (42703); any other fault is told as it
// is and not kept (before: a moment's fault was kept for 2 minutes as "run step N")
const colOn = async (site, path) => { try { await db(site, 'GET', path); return true; } catch (e) { if (e && e.code !== 'notinstalled' && /42703|does not exist/.test(String(e.message))) return false; throw e; } };
const step5On = site => kept(site, 'step5', () => colOn(site, 'store_po?select=appr&limit=1'));
const STEP5 = 'The purchase order\'s Credit Period, Site Contact, Shipping Address, Freight, Load / Unload and its approval need the Store\'s database step 5 at this site: the Admin runs sql/store_step5_po_format.sql once in Supabase → SQL Editor (in every site). Until then a PO is saved without them – leave them empty.';
// (29-10-2026) is the Store's step 6 (the GRN's discounts, a line's net rate) in this site's database?
const step6On = site => kept(site, 'step6', () => colOn(site, 'store_grn_lines?select=net_rate&limit=1'));
const STEP6 = 'A discount on a GRN (on a line or on the whole bill) needs the Store\'s database step 6 at this site: the Admin runs sql/store_step6_grn_discount.sql once in Supabase → SQL Editor (in every site). Until then a GRN is saved without a discount – leave it empty.';
/* (29-10-2026) A REQUIREMENT'S PHOTOS – "requirement madhe attachment cha option … material photo … multiple photos … app madhun photo
 * kadhla tri laptop web madhe yeil" (his answers: the whole requirement, many photos; in the print too). A photo is made smaller where
 * it is taken (the page / the app: a JPEG of a few hundred KB) and sent here; it is kept ONCE in the site's private file store (the
 * bucket erp-files – Mechanical's, the same Supabase project) under its fingerprint: store/req/<2>/<sha>.jpg – never overwritten or
 * deleted. The requirement keeps the list (store_req.photos, step 7: [{ sha, size, by, at }]). A photo opens only through a link of
 * 15 minutes. Sent from the app, it is on the laptop's page at once (the same site's store) – and the other way round. */
const PH = { bucket: 'erp-files', max: 10, raw: 2 * 1024 * 1024, day: 200 };
const phPath = sha => 'store/req/' + sha.slice(0, 2) + '/' + sha + '.jpg';
const step7On = site => kept(site, 'step7', () => colOn(site, 'store_req?select=photos&limit=1'));
const STEP7 = 'Photos of a requirement need the Store\'s database step 7 at this site: the Admin runs sql/store_step7_req_photos.sql once in Supabase → SQL Editor (in every site). Until then a requirement is saved without photos.';
// the proof that THIS person sent THIS photo (its size) to THIS site – given when it is sent, asked when a requirement takes it
const phTok = (site, email, sha, size) => crypto.createHmac('sha256', 'rcl-store-photo|' + String(process.env.SUPABASE_SECRET_KEY || '')).update([site, String(email || '').toLowerCase(), sha, size].join('|')).digest('hex').slice(0, 40);
const phTokOk = (t, site, email, sha, size) => { const a = Buffer.from(String(t || '')), b = Buffer.from(phTok(site, email, sha, size)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const phList = v => (Array.isArray(v) ? v : []).filter(p => p && /^[0-9a-f]{64}$/.test(String(p.sha))).map(p => ({ sha: String(p.sha), size: Math.max(0, Math.round(num(p.size))), by: String(p.by || ''), at: String(p.at || '') }));
/* the list a requirement is to have, from what a save sent ([{ sha, size, t }]): a photo it has already, or one this person sent to
 * this site (its proof t); at most 10, each once. null = no list sent (an older page / app: the photos stay as they are). */
function phOf(s, list, had) {
  if (list === undefined || list === null) return null;
  if (!Array.isArray(list)) throw fail(400, 'The photos were not sent right – add them again.', 'field');
  if (list.length > PH.max) throw fail(400, 'A requirement keeps at most ' + PH.max + ' photos – take some out.', 'field');
  const old = new Map((had || []).map(p => [p.sha, p])), seen = new Set(), at = new Date().toISOString();
  return list.map(x => {
    const sha = String((x && x.sha) || '').toLowerCase(), size = Math.round(num(x && x.size));
    if (!/^[0-9a-f]{64}$/.test(sha)) throw fail(400, 'A photo was not sent right – add it again.', 'field');
    if (seen.has(sha)) throw fail(400, 'The same photo is there twice – take one out.', 'field');
    seen.add(sha);
    if (old.has(sha)) return old.get(sha);
    if (!phTokOk(x.t, s.site, s.email, sha, size)) throw fail(400, 'A photo was not added from this page (or by you) – add it again.', 'field');
    return { sha: sha, size: size, by: s.name || s.email, at: at };
  });
}
// the links (15 minutes) of photos: path → its address
async function phLinks(site, list) {
  if (!list.length) return {};
  const r = await files(site, 'POST', 'object/sign/' + PH.bucket, JSON.stringify({ expiresIn: 900, paths: list.map(p => phPath(p.sha)) }), 'application/json');
  if (!r.ok) throw fail(502, 'The photos could not be opened (' + r.status + ') – try again in a moment.', 'store');
  const out = {}; (Array.isArray(r.json) ? r.json : []).forEach(y => { if (y && y.path && y.signedURL) out[y.path] = r.base + y.signedURL; });
  return out;
}
/* (29-10-2026) LIVE – the site's last change: the newest activity row's number (every save of the Store notes one – the unit test checks
 * it). One read of the database for every open page of the site on this server in 2 seconds (kept in memory; never used for a save). */
const LIVE = new Map();
function liveOf(site) {
  const c = LIVE.get(site); if (c && Date.now() - c.at < 2000) return c.p;
  const e = { at: Date.now(), p: db(site, 'GET', 'store_activity?select=id&order=id.desc&limit=1').then(r => Number((r && r[0] && r[0].id) || 0)) };
  LIVE.set(site, e); e.p.catch(() => { if (LIVE.get(site) === e) LIVE.delete(site); });
  if (LIVE.size > 200) LIVE.clear();
  return e.p;
}
// who approves the POs of a site (the Portal tells: store_settings 'approvers' → po)
const poPeople = async site => { const r = ((await db(site, 'GET', 'store_settings?select=value&id=eq.approvers')) || [])[0]; return W.poApprovers(r ? r.value : null); };
const apprOf = p => p.appr || 'Approved';      // a PO made before step 5: as approved
const byNo = (a, b) => b.no - a.no;
const sortLines = l => (l || []).slice().sort((a, b) => a.line - b.line);
// ordered so far of each requirement line (POs not cancelled): 'req:line' → qty
function orderedOf(pos) { const o = {}; (pos || []).forEach(p => { if (p.status === 'Cancelled') return; (p.lines || []).forEach(l => { if (l.req_no) { const k = l.req_no + ':' + l.req_line; o[k] = r3((o[k] || 0) + num(l.qty)); } }); }); return o; }
// the GRNs against some POs (their lines' quantities and PO lines; sel: what else of them)
async function grnsOfPos(site, poNos, sel) {
  const grns = [];
  for (let i = 0; i < poNos.length; i += 150) grns.push(...await dbAll(site, 'store_grn?select=' + (sel || 'no,po_no,store_grn_lines(qty,po_line)') + '&po_no=in.(' + poNos.slice(i, i + 150).join(',') + ')', 'no'));
  return grns;
}
// received so far of each PO line (GRN lines): 'po:line' → qty
const recOf = (grns, skipGrn) => { const o = {}; grns.forEach(g => { if (skipGrn && g.no === skipGrn) return; (g.store_grn_lines || []).forEach(l => { if (l.po_line) { const k = g.po_no + ':' + l.po_line; o[k] = r3((o[k] || 0) + num(l.qty)); } }); }); return o; };
async function receivedOf(site, poNos, skipGrn) { if (!poNos.length) return {}; return recOf(await grnsOfPos(site, poNos), skipGrn); }
// (29-10-2026) what had come on each PO line BEFORE each GRN – in the order they came (date, then number): grn no → 'po:line' → qty
function beforeOf(grns) {
  const out = {}, run = {};
  grns.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || a.no - b.no).forEach(g => { out[g.no] = Object.assign({}, run);
    (g.store_grn_lines || []).forEach(l => { if (l.po_line) { const k = g.po_no + ':' + l.po_line; run[k] = r3((run[k] || 0) + num(l.qty)); } }); });
  return out;
}
/* (29-10-2026) the Store's step 9 at this site: the workflow of the purchase orders, the GRNs, the issues and the returns (their column wf) */
const step9On = site => kept(site, 'step9', () => colOn(site, 'store_grn?select=wf&limit=1'));
const STEP9 = 'The verification and approval of purchase orders, GRNs and issues (and Head Office\'s check) need the Store\'s database step 9 at this site: the Admin runs sql/store_step9_workflow.sql once in Supabase → SQL Editor (in every site). Until then they are saved as before.';
/* a GRN / an issue / a return with its workflow for this person: the step it waits for, whether he decides it, for whom it waits */
function wfInfo(wf, kind, w, s) {
  if (!w || typeof w !== 'object') return { wf: null, step: '', mayDecide: false, waitFor: [] };
  const step = W.wfStepNow(wf, kind, w);
  return { wf: w, step: step, mayDecide: W.wfMay(wf, kind, w, s.email), waitFor: step ? W.wfWaitFor(wf, kind, w) : [] };
}
/* (29-10-2026) GRNs as the lists show them: their lines, their workflow and – against a PO – the bill checked with its PO (rate, GST %,
 * what the PO still had before it) */
async function grnsOut(s, site, grns, wf) {
  const poNos = [...new Set(grns.filter(g => g.po_no).map(g => Number(g.po_no)))], pos = {};
  let before = {};
  if (poNos.length) {
    for (let i = 0; i < poNos.length; i += 150) (await dbAll(site, 'store_po?select=no,lines&no=in.(' + poNos.slice(i, i + 150).join(',') + ')', 'no')).forEach(p => { pos[p.no] = p; });
    before = beforeOf(await grnsOfPos(site, poNos, 'no,po_no,date,store_grn_lines(qty,po_line)'));
  }
  return grns.map(r => { const lines = sortLines(r.store_grn_lines || r.lines), po = r.po_no ? pos[Number(r.po_no)] : null;
    return Object.assign({}, r, { ref: R.refOf(r), lines: lines, store_grn_lines: undefined, check: po ? W.billCheck(lines, po, before[r.no] || {}) : null }, wfInfo(wf, 'grn', r.wf, s)); });
}
// issues as the lists show them: their lines with what came back, their returns, the workflow of each
async function issuesOut(s, site, iss, wf) {
  const min = iss.reduce((m, i) => Math.min(m, i.no), Infinity), back = {}, rets = isFinite(min) ? await dbAll(site, 'store_return?select=*,store_return_lines(*)&issue_no=gte.' + min, 'no') : [];
  rets.forEach(r => (r.store_return_lines || []).forEach(l => { back[l.issue_line] = r3((back[l.issue_line] || 0) + num(l.qty)); }));
  const retOf = {}; rets.forEach(r => { (retOf[r.issue_no] = retOf[r.issue_no] || []).push(Object.assign({ no: r.no, date: r.date, lines: sortLines(r.store_return_lines), party: r.party, remark: r.remark, created_name: r.created_name }, wfInfo(wf, 'iss', r.wf, s))); });
  return iss.sort(byNo).map(i => Object.assign({}, i, { store_issue_lines: undefined, returns: retOf[i.no] || [],
    lines: sortLines(i.store_issue_lines).map(l => Object.assign({}, l, { back: back[l.id] || 0 })) }, wfInfo(wf, 'iss', i.wf, s)));
}
/* a GRN's / an issue's / a return's workflow set when it is saved (lib/work.js wfStart) – its own write after the save; a fault is told
 * (the paper stays saved; nothing of its stock changes) */
async function wfSet(site, table, no, s, kind, isNew) {
  if (!(await step9On(site).catch(() => false))) return { state: '', note: '' };
  const w0 = W.wfStart(await wfAt(site), kind, s.email);
  if (!w0 && isNew) return { state: '', note: '' };
  try { await db(site, 'PATCH', table + '?no=eq.' + Number(no), { wf: w0 }, 'return=minimal'); }
  catch (e) { return { state: '', note: 'It is saved – but its verification / approval could not be noted (' + String((e && e.message) || e).slice(0, 80) + '). The Store Admin opens it with Change and saves it again.' }; }
  return { state: w0 ? w0.state : '', note: '' };
}
// what is still to come of a PO, line by line; its state: Open / Received (all came) / Closed / Cancelled
function poView(p, rec) {
  const lines = sortLines(p.lines).map(l => { const r = r3(num(rec[p.no + ':' + l.line])); return Object.assign({}, l, { received: r, left: Math.max(0, r3(num(l.qty) - r)) }); });
  const state = p.status !== 'Open' ? p.status : lines.every(l => l.left <= 0.0005) ? 'Received' : lines.some(l => l.received > 0) ? 'Part received' : 'Open';
  return Object.assign({}, p, { lines: lines, state: state, appr: apprOf(p) });
}
/* (29-10-2026) a PO waiting: for its VERIFICATION (someone verifies the POs of its site – step 9 keeps it: wf.state 'verify'; nobody
 * verifies any more – its approval) or for its APPROVAL. Who decides it: a person of its own site (signed in there), never his own. */
function poStep(p, wf, approvers, s, here) {
  const maker = String(p.created_by || '').toLowerCase(), w = p.wf;
  if (p.status !== 'Open' || apprOf(p) !== 'Waiting') return { step: '', may: false, waitFor: [] };
  if (w && w.state === 'verify' && W.othersOf(wf.verify.po, maker).length) return { step: 'verify', may: here !== false && W.isIn(wf.verify.po, s.email) && me_(s) !== maker, waitFor: W.othersOf(wf.verify.po, maker).map(q => q.name) };
  return { step: 'approve', may: here !== false && W.mayApprovePo(approvers, s.email, p.created_by), waitFor: approvers.filter(q => q.email !== maker).map(q => q.name) };
}
/* (29-10-2026) a requirement waiting for its VERIFICATION: Pending at level 0 (someone verifies the requirements of the site – the
 * Portal's workflow). Nobody verifies any more: it waits for its first level of approval instead. Its level NOW: */
const reqStep = (r, lv, wf) => {
  const maker = String(r.created_by || '').toLowerCase();
  if (r.status !== 'Pending') return { step: '', level: Number(r.level) || 0 };
  if (Number(r.level) === 0 && wf && W.othersOf(wf.verify.req, maker).length) return { step: 'verify', level: 0 };
  return { step: 'approve', level: Number(r.level) === 0 ? W.nextLevel(lv, 0, maker) : Number(r.level) };
};
const reqView = (r, ordered, lv, s, wf) => { const st = reqStep(r, lv, wf), maker = String(r.created_by || '').toLowerCase();
  const mayVerify = st.step === 'verify' && W.isIn(wf.verify.req, s.email) && me_(s) !== maker;
  return Object.assign({}, r, {
    lines: sortLines(r.lines).map(l => { const o = r3(num(ordered[r.no + ':' + l.line])); return Object.assign({}, l, { ordered: o, left: r.status === 'Approved' ? Math.max(0, r3(num(l.qty) - o)) : 0 }); }),
    // (an older app knows only "Approve": for one who verifies it, that is his verification)
    level: st.level, step: st.step, mayVerify: mayVerify, mayApprove: r.status === 'Pending' && (st.step === 'verify' ? mayVerify : W.canApprove(lv, st.level, s.email, r.created_by)), mine: maker === me_(s),
    waitFor: st.step === 'verify' ? W.othersOf(wf.verify.req, maker).map(p => p.name) : st.step === 'approve' ? ((lv.find(l => l.level === st.level) || { people: [] }).people.filter(p => p.email !== maker).map(p => p.name)) : [] }); };
// the sites with the Store's step 2 – HO Purchase works on every one of them
async function storeSites() { return (await registry()).filter(x => x.status === 'ready').map(x => ({ code: x.code, name: x.name || x.code })); }
async function siteFor(s, x) {
  const site = String(x.site || s.site).toUpperCase();
  if (site !== s.site) { buyerOnly(s); if (!(await storeSites()).some(y => y.code === site)) throw fail(400, 'No such site (' + site + ').', 'site'); }
  return site;
}
/* (29-10-2026, "konte jail konte nahi jail te super admin tharau shakel") a site whose approved requirements do NOT go to Head Office (the
 * Portal → Workflow) buys them itself: its Store Admin makes, changes, cancels and deletes the purchase orders of his own site. HO Purchase
 * – every site, as before. */
async function mayBuy(s, site) { if (isBuyer(s)) return true; if (!s.admin || site !== s.site) return false; return !(await wfAt(site)).ho.req; }
async function buyerOr(s, site) { if (!(await mayBuy(s, site))) throw fail(403, 'Purchase orders are made by HO Purchase – "Store Purchase", given by the Super Admin in the Portal (a site whose requirements do not go to Head Office: its Store Admin).', 'purchase'); }
// one who may see the requirements: the page (View), HO Purchase, one who approves or verifies them
const reqSeer = (s, lv, wf) => can(s, 'req', 'View') || isBuyer(s) || lv.some(l => l.people.some(p => p.email === me_(s))) || W.isIn(wf.verify.req, s.email);
// when it was approved (its last approval), else made – HO Purchase sees since when it waits for its PO
const istDay = t => { const d = Date.parse(t); return isNaN(d) ? String(t || '').slice(0, 10) : new Date(d + 330 * 60000).toISOString().slice(0, 10); };      // (a time kept in UTC: its day in India)
const sinceOf = r => { const a = (r.approvals || []).filter(y => y && y.ok && y.at).map(y => String(y.at)).sort(); return a.length ? istDay(a[a.length - 1]) : String(r.date || '').slice(0, 10); };
/* (29-10-2026) the Store's step 8 at this site: the requirement's own Indent No. (each financial year and letter from 0001), its contact,
 * its maintenance log book; a requirement changed after its approval, deleted; a PO deleted */
const step8On = site => kept(site, 'step8', () => colOn(site, 'store_req?select=indent_no&limit=1'));
const STEP8 = 'This needs the Store\'s database step 8 at this site: the Admin runs sql/store_step8_req_indent.sql once in Supabase → SQL Editor (in every site). Until then a requirement keeps its number and is changed only while nobody approved it.';
/* (29-10-2026, "mala te kahi save karayla nko sangu … mi agodar sagle save keley") THE PAPERS' HEADING – as the Super Admin gave it in the
 * Portal: the site's company (name, address, GSTIN, PAN, logo) and the site's own address and contact. It comes with every ticket of the
 * Portal (api/sso – each sign-in and its renewal every 10 minutes) and is kept in the site's settings ("portal_paper") for another
 * site's papers (HO Purchase). A site nobody signed in to since: Mechanical's list of sites, as before. */
const portalPaper = site => kept(site, 'pportal', async () => { const r = ((await db(site, 'GET', 'store_settings?select=value&id=eq.portal_paper')) || [])[0]; return r && r.value && typeof r.value === 'object' ? r.value : null; });
// the heading of a site's papers: the Portal's; else the site's company in Mechanical's list of sites and companies (the first site's database)
async function headingOf(site, s) {
  try {
    let p = s && s.site === site && s.info && s.info.paper && typeof s.info.paper === 'object' ? s.info.paper : null;
    if (!p) { try { p = await portalPaper(site); } catch (e) { p = null; } }
    if (p && (p.company || (p.site && (p.site.address || p.site.contact || p.site.phone)))) {
      const co = p.company || {}, st = p.site || {};
      return { site: st.name || site, company: co.name || '', address: co.address || '', gstin: co.gstin || '', pan: co.pan || '', logo: /^(https:\/\/|data:image\/)/.test(String(co.logo || '')) ? co.logo : '',
        siteAddr: st.address || '', siteContact: st.contact || '', sitePhone: st.phone || '' };
    }
    const home = (await registry()).find(x => x.home); if (!home) return null;
    const st = ((await db(home.code, 'GET', 'rcl_sites?select=code,name,company_id&code=eq.' + enc(site))) || [])[0];
    const co = st && st.company_id ? ((await db(home.code, 'GET', 'rcl_companies?select=id,name,address,gstin,pan,logo&id=eq.' + enc(st.company_id))) || [])[0] : null;
    return { site: st ? st.name : site, company: co ? co.name : '', address: co ? co.address || '' : '', gstin: co ? co.gstin || '' : '', pan: co ? co.pan || '' : '', logo: co && /^(https:\/\/|data:image\/)/.test(String(co.logo || '')) ? co.logo : '' };
  } catch (e) { return null; }
}
// the heading a paper prints: the company's, the Papers' e-mail / contact / CIN / web, the site's address (the Portal's; else the Papers')
const headOut = (h, pp) => Object.assign({}, h || {}, { email: pp.email || '', phone: pp.phone || '', cin: pp.cin || '', web: pp.web || '', site_address: (h && h.siteAddr) || pp.site_address || pp.ship_to || '' });
/* (29-10-2026, "jewa purchase order banwali jail or requirement banwali jail tewa contact name ani number je default ahe te auto yetil but
 * user … edit pn karta yeil") what a new requirement / PO starts with: the site's contact and address from the Portal (Sites); not given
 * there: the Store's own Papers settings, as before. The person changes them in the form. */
const startOf = (h, pp) => ({ contact_name: (h && h.siteContact) || '', contact_phone: (h && h.sitePhone) || '', ship_to: (h && h.siteAddr) || pp.ship_to || '',
  site_contact: [h && h.siteContact, h && h.sitePhone].filter(Boolean).join(' – ') || pp.site_contact || '', terms: pp.terms || '' });
// the POs (not cancelled) that have a requirement: req no → [PO nos]
function posOfReq(pos) { const o = {}; (pos || []).forEach(p => { if (p.status === 'Cancelled') return; (p.lines || []).forEach(l => { const n = Number(l.req_no); if (n) { o[n] = o[n] || []; if (o[n].indexOf(p.no) === -1) o[n].push(p.no); } }); }); return o; }
// (29-10-2026) a requirement's maintenance log book, attached when it is made / changed: up to which date it is written, how many bills
async function logbookOf(site, s, forText) {
  const m = (await machinery(site)).find(y => y.no === forText); if (!m) return null;
  const i = await ML.infoOf(dbAll, site, m.no);
  return i.bills ? { no: m.no, upto: i.upto, bills: i.bills, at: new Date().toISOString(), by: s.name || s.email } : null;
}
const brief = i => ({ code: i.code, name: i.name, unit: i.unit, category: i.category, hsn: i.hsn || '', gst_pct: i.gst_pct, min_stock: i.min_stock, status: i.status });

const ACTIONS = {
  /* ---------- (29-10-2026) LIVE: what changed at this site? (the page reads its list again only when this changes) ---------- */
  async live(s, x) {
    if (x.all && isBuyer(s)) return { v: (await Promise.all((await storeSites()).map(st => liveOf(st.code).catch(() => 0)))).join('.') };      // (HO Purchase: every site)
    return { v: await liveOf(s.site) };
  },
  /* ---------- what the pages need to start ---------- */
  async boot(s) {
    const [items, st, mach, lv, nm, h, pp, s8, wf, s9] = await Promise.all([itemsOf(s.site), stockOn(s.site), machinery(s.site), levels(s.site), names(s.site), headingOf(s.site, s), papersOf(s.site), step8On(s.site).catch(() => false),
      wfAt(s.site), step9On(s.site).catch(() => false)]);
    const stock = {}, avg = {}; st.forEach(r => { stock[r.code] = r3(num(r.qty)); avg[r.code] = r2(avgOf(r)); });
    const e = me_(s), names2 = l => l.map(p => p.name);
    return { site: s.site, today: W.today(), me: { email: s.email, name: s.name, admin: s.admin, super: s.super, pages: s.pages, buyer: isBuyer(s) },
      items: Object.values(items).map(brief).sort((a, b) => a.name.localeCompare(b.name)), stock: stock, avg: avg, machinery: mach, names: nm,
      levels: lv.map(l => ({ level: l.level, people: l.people.map(p => p.name) })), myLevels: lv.filter(l => l.people.some(p => p.email === String(s.email).toLowerCase())).map(l => l.level),
      kinds: { for: W.FOR_KINDS, to: W.TO_KINDS, sides: W.SIDES },
      start: startOf(h, pp), step8: s8,      // (29-10-2026) a new requirement's contact; step 8 at this site
      // (29-10-2026) the site's workflow (the Portal): what this person verifies / approves; who does each step; what goes to Head Office;
      // whether the site buys its requirements itself (its Store Admin makes their POs); step 9 at this site
      wf: { mine: { vreq: W.isIn(wf.verify.req, e), vpo: W.isIn(wf.verify.po, e), vgrn: W.isIn(wf.verify.grn, e), agrn: W.isIn(wf.approve.grn, e), viss: W.isIn(wf.verify.iss, e), aiss: W.isIn(wf.approve.iss, e) },
        verify: { req: names2(wf.verify.req), po: names2(wf.verify.po), grn: names2(wf.verify.grn), iss: names2(wf.verify.iss) }, approve: { grn: names2(wf.approve.grn), iss: names2(wf.approve.iss) },
        ho: wf.ho, buy: isBuyer(s) || (s.admin && !wf.ho.req) }, step9: s9 };
  },
  async dash(s) {
    const t = W.today(), out = { today: t };
    const [items, st] = await Promise.all([itemsOf(s.site), stockOn(s.site)]);
    let value = 0, below = 0; const by = new Map(st.map(r => [r.code, r]));
    Object.values(items).forEach(i => { const r = by.get(i.code), q = r ? num(r.qty) : 0; value += q * avgOf(r); if (i.status === 'Active' && i.min_stock !== null && i.min_stock !== undefined && q < Number(i.min_stock)) below++; });
    out.stock = { value: r2(value), below: below, items: Object.keys(items).length };
    const [lv, wf, s9] = await Promise.all([levels(s.site), wfAt(s.site), step9On(s.site).catch(() => false)]);
    if (reqSeer(s, lv, wf)) {
      const reqs = await dbAll(s.site, 'store_req?select=no,status,level,created_by&status=in.(Pending,Approved)', 'no');
      // (29-10-2026) "waiting for me" – to verify or to approve
      out.req = { pending: reqs.filter(r => r.status === 'Pending').length, mine: reqs.filter(r => r.status === 'Pending' && reqView(Object.assign({ lines: [] }, r), {}, lv, s, wf).mayApprove).length, approved: reqs.filter(r => r.status === 'Approved').length };
    }
    if (can(s, 'po', 'View') || can(s, 'grn', 'View') || isBuyer(s)) out.po = { open: (await dbAll(s.site, 'store_po?select=no&status=eq.Open', 'no')).length };
    /* (29-10-2026) what waits for THIS person at this site – a PO to verify or approve, a GRN, an issue or a return to verify or approve */
    if (s9) {
      const w = { po: 0, grn: 0, issue: 0, ret: 0 }, ppl = await poPeople(s.site);
      try {
        const [pos, gs, is, rs] = await Promise.all([dbAll(s.site, 'store_po?select=no,appr,created_by,wf&status=eq.Open&appr=eq.Waiting', 'no'), dbAll(s.site, 'store_grn?select=no,wf&wf->>state=in.(verify,approve)', 'no'),
          dbAll(s.site, 'store_issue?select=no,wf&wf->>state=in.(verify,approve)', 'no'), dbAll(s.site, 'store_return?select=no,wf&wf->>state=in.(verify,approve)', 'no')]);
        w.po = pos.filter(p => poStep(p, wf, ppl, s).may).length; w.grn = gs.filter(g => W.wfMay(wf, 'grn', g.wf, s.email)).length;
        w.issue = is.filter(g => W.wfMay(wf, 'iss', g.wf, s.email)).length; w.ret = rs.filter(g => W.wfMay(wf, 'iss', g.wf, s.email)).length;
      } catch (e) { /* (the counts – the lists say it) */ }
      out.wf = w;
    }
    if (can(s, 'grn', 'View')) { const g = (await dbAll(s.site, 'store_grn?select=*&date=gte.' + t.slice(0, 8) + '01', 'no')).map(x => ({ no: x.no, ref: R.refOf(x), date: x.date, supplier: x.supplier, gross: x.gross })); out.grn = { today: g.filter(x => x.date === t).length, todayValue: r2(g.filter(x => x.date === t).reduce((a, x) => a + num(x.gross), 0)), month: g.length, monthValue: r2(g.reduce((a, x) => a + num(x.gross), 0)), recent: g.sort(byNo).slice(0, 8) }; }
    if (can(s, 'issue', 'View')) { const g = await dbAll(s.site, 'store_issue?select=no,date,to_kind,party,machinery,use_for,amount&date=gte.' + t.slice(0, 8) + '01', 'no'); out.issue = { today: g.filter(x => x.date === t).length, todayValue: r2(g.filter(x => x.date === t).reduce((a, x) => a + num(x.amount), 0)), month: g.length, monthValue: r2(g.reduce((a, x) => a + num(x.amount), 0)), recent: g.sort(byNo).slice(0, 8) }; }
    return out;
  },

  /* ---------- MATERIAL REQUIREMENT ---------- */
  async reqList(s) {
    const [lv, wf] = await Promise.all([levels(s.site), wfAt(s.site)]);
    if (!reqSeer(s, lv, wf)) need(s, 'req', 'View');
    const [reqs, pos] = await Promise.all([dbAll(s.site, 'store_req?select=*', 'no'), dbAll(s.site, 'store_po?select=no,status,lines', 'no')]);
    const ordered = orderedOf(pos);
    const [h, pp, s7, s8] = await Promise.all([headingOf(s.site, s), papersOf(s.site), step7On(s.site), step8On(s.site)]), inPo = posOfReq(pos);
    const mayEd = can(s, 'req', 'Edit');
    return { reqs: reqs.sort(byNo).map(r => { const mine = String(r.created_by || '').toLowerCase() === String(s.email).toLowerCase(), po = inPo[r.no] || [], own = mayEd && (mine || s.admin);
      return Object.assign(reqView(r, ordered, lv, s, wf), { ref: W.indentOf(r, h, s.site), photos: phList(r.photos), pos: po, logbook: r.logbook || null, contact_name: r.contact_name || '', contact_phone: r.contact_phone || '',
        // (29-10-2026, "ekda banwaleli requirement edit delet krta yeil … approval nantr … jr requirement chi PO banli aahe … adhi PO delet") who made
        // it (or the Store Admin): Change – also when approved or rejected (it is approved again), Delete; not while a PO has it
        edit: own && !po.length && (s8 ? ['Pending', 'Approved', 'Rejected'].indexOf(r.status) > -1 : r.status === 'Pending' && !(r.approvals || []).length),
        del: own && !po.length && s8, attach: own && ['Closed', 'Cancelled'].indexOf(r.status) === -1 }); }),
      levels: lv.map(l => ({ level: l.level, people: l.people.map(p => p.name) })), verifiers: wf.verify.req.map(p => p.name),      // (29-10-2026) who verifies them
      heading: headOut(h, pp),      // (28-10-2026) for its paper (the Purchase Requisition Form); (29-10-2026) the Portal's heading and the site's address
      step7: s7, step8: s8, start: startOf(h, pp) };      // (29-10-2026) photos can be added (step 7); the Indent No., contact, log book (step 8)
  },
  async reqSave(s, x) {
    need(s, 'req', 'Edit');
    const items = await itemsOf(s.site), mach = await machinery(s.site), no = x.no ? noOf(x.no) : null, s8 = await step8On(s.site);
    let cur = null, again = false;
    if (no) {
      cur = ((await db(s.site, 'GET', 'store_req?select=*&no=eq.' + no)) || [])[0]; if (!cur) throw gone('Requirement ' + no);
      if (String(cur.created_by).toLowerCase() !== String(s.email).toLowerCase() && !s.admin) throw fail(403, 'Only who made a requirement (or the Store Admin) changes it.', 'admin');
      if (s8) {      // (29-10-2026) also when approved or rejected – then it is approved again; never while a PO has it
        if (['Pending', 'Approved', 'Rejected'].indexOf(cur.status) === -1) throw fail(409, 'Requirement ' + no + ' is ' + String(cur.status).toLowerCase() + ' – it is not changed.', 'decided');
        const po = posOfReq(await dbAll(s.site, 'store_po?select=no,status,lines', 'no'))[no] || [];
        if (po.length) throw fail(409, 'Requirement ' + no + ' is in PO ' + po.join(', ') + ' – delete PO ' + po.join(', ') + ' first (HO Purchase), then change the requirement.', 'ordered', { po: po });
        again = cur.status !== 'Pending' || (cur.approvals || []).length > 0;
      } else if (cur.status !== 'Pending' || (cur.approvals || []).length) throw fail(409, 'Requirement ' + no + ' is already ' + (cur.status === 'Pending' ? 'approved at a level' : cur.status.toLowerCase()) + ' – it cannot be changed now. Cancel it and make a new one.', 'decided');
    }
    let r; try { r = W.checkReq(x.req, items, { machinery: mach, had: new Set(cur ? (cur.lines || []).map(l => l.code) : []) }); } catch (e) { userErr(e); }
    todayOnly(s, r.date, 'Requirement', cur ? String(cur.date).slice(0, 10) : '');
    if (!s8) { delete r.contact_name; delete r.contact_phone; }      // (kept only with step 8 – the page asks for them only then)
    /* (29-10-2026) its maintenance log book (a machinery's requirement – "auto requirement madhe attach hoil … jr nasel karaych tr te hi
     * option"): a new one gets it by itself (as it is written now – up to its last bill) unless false is sent; a change: true = attached
     * (it keeps the one it has for the same machinery), false = taken off, not sent (an older page / app) = as it was */
    let lb;
    if (s8) {
      const same = cur && cur.logbook && cur.logbook.no === r.for_text ? cur.logbook : null;
      if (r.for_kind !== 'Machinery' || x.logbook === false) lb = null;
      else if (x.logbook === true || !cur) lb = same || await logbookOf(s.site, s, r.for_text);
      else lb = same;
    }
    // (29-10-2026) its photos: the list sent (none sent – an older page: as they are); before step 7 only an empty list is taken
    let ph = null;
    if (x.photos !== undefined && x.photos !== null) {
      if (!(await step7On(s.site))) { if (!Array.isArray(x.photos) || x.photos.length) throw fail(400, STEP7, 'sql'); }
      else ph = phOf(s, x.photos, cur ? phList(cur.photos) : []);
      // (the review) a Change keeps the photos added since its form was opened (the phone, the Store Admin – reqPhotoAdd): only the
      // photos the form knew of (photosWas) can be taken out; an older form that does not say: as it sends
      if (ph && cur && Array.isArray(x.photosWas)) {
        const knew = new Set(x.photosWas.map(h => String(h || '').toLowerCase())), more = phList(cur.photos).filter(p => !knew.has(p.sha) && !ph.some(q => q.sha === p.sha));
        if (ph.length + more.length > PH.max) throw fail(409, 'Photos were added to requirement ' + no + ' just now – it would have more than ' + PH.max + '. Refresh and look.', 'decided');
        ph = ph.concat(more);
      }
    }
    // (29-10-2026) its verification first, when someone other than its maker verifies the requirements of this site (level 0)
    const wf = await wfAt(s.site);
    if (no && s8) {      // (step 8) in the database, at one time with the purchase orders: never while a PO has it
      const row = Object.assign({}, r, ph !== null ? { photos: ph } : {}, lb !== undefined ? { logbook: lb } : {});
      if (again) { const vf = W.othersOf(wf.verify.req, cur.created_by).length > 0, level = vf ? 0 : W.nextLevel(await levels(s.site), 0, cur.created_by); Object.assign(row, { status: vf || level ? 'Pending' : 'Approved', level: level, approvals: [] }); }
      const out = await rpc(s.site, 'store_req_change', { p_no: no, p_at: cur.updated_at, p_row: row, p_by: s.email }).catch(e => said(e, items));
      await activity(s.site, s.email, 'Requirement changed', 'REQ ' + no, Object.assign({ lines: r.lines.length }, ph !== null ? { photos: ph.length } : {}, lb !== undefined ? { logbook: lb ? lb.upto : null } : {},
        again ? { approvedAgain: true, was: cur.status, approvals: (cur.approvals || []).map(a => a.name + (a.ok ? ' approved' : ' rejected') + ' (level ' + a.level + ')') } : {}));
      return { ok: true, no: no, status: out && out.status, level: out && out.level, again: again, step: out && out.status === 'Pending' ? (Number(out.level) === 0 ? 'verify' : 'approve') : '' };
    }
    if (no) {
      const out = ((await db(s.site, 'PATCH', 'store_req?no=eq.' + no + '&status=eq.Pending&updated_at=eq.' + enc(cur.updated_at), Object.assign({}, r, ph !== null ? { photos: ph } : {}, { updated_by: s.email }), 'return=representation')) || [])[0];
      if (!out) throw fail(409, 'Requirement ' + no + ' was changed or decided by someone else just now – refresh and look.', 'decided');
      await activity(s.site, s.email, 'Requirement changed', 'REQ ' + no, Object.assign({ lines: r.lines.length }, ph !== null ? { photos: ph.length } : {}));
      return { ok: true, no: no, status: out.status, level: out.level };
    }
    const lv = await levels(s.site), vf = W.othersOf(wf.verify.req, s.email).length > 0, level = vf ? 0 : W.nextLevel(lv, 0, s.email);
    const row = Object.assign({}, r, { status: vf || level ? 'Pending' : 'Approved', level: level, approvals: [] }, s8 && lb ? { logbook: lb } : {});
    const n = await rpc(s.site, 'store_req_put', { p_row: row, p_by: s.email, p_name: s.name }).catch(e => said(e, items));
    // (the photos: on the row just made – a second write; if it fails the requirement stays saved and the person is told)
    let phNote = '';
    if (ph && ph.length) { try { await db(s.site, 'PATCH', 'store_req?no=eq.' + Number(n), { photos: ph }, 'return=minimal'); } catch (e) { phNote = 'Requirement ' + Number(n) + ' is saved, but its photos were not kept – add them again with "Photos" on it.'; } }
    // (29-10-2026) its Indent No. (step 8: given in the database when it is made)
    let ref = '';
    try { const [x1, h] = await Promise.all([db(s.site, 'GET', 'store_req?select=*&no=eq.' + Number(n)), headingOf(s.site, s)]); if (x1 && x1[0]) ref = W.indentOf(x1[0], h, s.site); } catch (e) { ref = ''; }
    await activity(s.site, s.email, 'Requirement made', 'REQ ' + n, Object.assign({ lines: r.lines.map(l => l.name + ' ' + l.qty + ' ' + l.unit), status: row.status }, ref ? { indent: ref } : {}, ph && ph.length && !phNote ? { photos: ph.length } : {}, row.logbook ? { logbook: row.logbook.upto } : {}));
    return Object.assign({ ok: true, no: Number(n), ref: ref, status: row.status, level: level, step: vf ? 'verify' : level ? 'approve' : '', waitFor: vf ? W.othersOf(wf.verify.req, s.email).map(p => p.name) : [] }, phNote ? { photoNote: phNote } : {});
  },
  /* ---------- (29-10-2026) A REQUIREMENT'S PHOTOS ---------- */
  // one photo, as it is added (made smaller where it was taken): kept once under its fingerprint; its proof for the save
  async reqPhotoUp(s, x) {
    need(s, 'req', 'Edit');
    if (!(await step7On(s.site))) throw fail(400, STEP7, 'sql');
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(x.data || ''));
    if (!m) throw fail(400, 'A photo must be a JPG picture (the page makes it one) – add it again.', 'field');
    if (m[1].length > Math.ceil(PH.raw * 4 / 3) + 4) throw fail(400, 'This photo is too big (more than 2 MB) – add it again (it is made smaller where it is taken).', 'field');
    const b = Buffer.from(m[1], 'base64');
    if (b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8 || b[2] !== 0xFF) throw fail(400, 'This file is not a real JPG photo – add a photo.', 'field');
    const sha = crypto.createHash('sha256').update(b).digest('hex');
    // (the review) at most PH.day photos a person in a day at a site – a lost sign-in cannot fill the store; each one sent is noted
    const day0 = new Date(Date.parse(W.today() + 'T00:00:00+05:30')).toISOString();
    const sentToday = (await db(s.site, 'GET', 'store_activity?select=id&action=eq.' + enc('Requirement photo sent') + '&email=eq.' + enc(s.email) + '&at=gte.' + enc(day0) + '&limit=' + (PH.day + 1))) || [];
    if (sentToday.length >= PH.day) throw fail(429, 'You sent ' + PH.day + ' photos today – that is the most for one day. Send the rest tomorrow (if you did not send them, tell the Store Admin).', 'limit');
    const r = await files(s.site, 'POST', 'object/' + PH.bucket + '/' + phPath(sha), b, 'image/jpeg');
    const dup = /Duplicate|already exists|"409"/i.test(r.text);      // (the same photo kept before – it is not kept twice)
    if (/bucket not found/i.test(r.text)) throw fail(400, 'The place for the photos is missing at this site. ' + STEP7, 'sql');
    if (!r.ok && !dup) throw fail(502, 'The file store did not keep the photo (' + r.status + ') – add it again.', 'store');
    await activity(s.site, s.email, 'Requirement photo sent', 'photo ' + sha.slice(0, 12), { size: b.length, again: dup || undefined });
    return { ok: true, sha: sha, size: b.length, t: phTok(s.site, s.email, sha, b.length) };
  },
  // the photos of a requirement with their links (15 minutes) – seen big and printed; HO Purchase: of any site
  async reqPhotos(s, x) {
    const site = await siteFor(s, x), no = noOf(x.no);
    if (site === s.site && !can(s, 'req', 'View') && !isBuyer(s)) { const [lv, wf] = await Promise.all([levels(s.site), wfAt(s.site)]); if (!reqSeer(s, lv, wf)) need(s, 'req', 'View'); }      // (29-10-2026) one who verifies them too
    if (!(await step7On(site))) return { no: no, photos: [] };
    const r = ((await db(site, 'GET', 'store_req?select=no,photos&no=eq.' + no)) || [])[0]; if (!r) throw gone('Requirement ' + no);
    const list = phList(r.photos), u = await phLinks(site, list);
    return { no: no, photos: list.map(p => Object.assign({}, p, { url: u[phPath(p.sha)] || '' })) };
  },
  /* photos added to a requirement already made (made on the laptop – its photos taken with the phone): who made it or the Store Admin,
   * while it waits or is approved. A photo is taken out only while nobody has approved it yet (Change). */
  async reqPhotoAdd(s, x) {
    need(s, 'req', 'Edit');
    const no = noOf(x.no);
    if (!(await step7On(s.site))) throw fail(400, STEP7, 'sql');
    const cur = ((await db(s.site, 'GET', 'store_req?select=*&no=eq.' + no)) || [])[0]; if (!cur) throw gone('Requirement ' + no);
    if (String(cur.created_by).toLowerCase() !== String(s.email).toLowerCase() && !s.admin) throw fail(403, 'Only who made a requirement (or the Store Admin) adds its photos.', 'admin');
    if (['Pending', 'Approved'].indexOf(cur.status) === -1) throw fail(409, 'Requirement ' + no + ' is ' + String(cur.status).toLowerCase() + ' – photos are added only while it waits or is approved.', 'decided');
    const had = phList(cur.photos), add = (Array.isArray(x.photos) ? x.photos : []).filter(p => !had.some(h => h.sha === String((p && p.sha) || '').toLowerCase()));
    if (!add.length) throw fail(400, 'Add a photo first (the ones sent are already on it).', 'field');
    const list = phOf(s, had.map(p => ({ sha: p.sha })).concat(add), had);
    const out = ((await db(s.site, 'PATCH', 'store_req?no=eq.' + no + '&updated_at=eq.' + enc(cur.updated_at), { photos: list, updated_by: s.email }, 'return=representation')) || [])[0];
    if (!out) throw fail(409, 'Requirement ' + no + ' was changed by someone else just now – refresh and add the photos again.', 'decided');
    await activity(s.site, s.email, 'Requirement photos added', 'REQ ' + no, { added: list.length - had.length, photos: list.length });
    return { ok: true, no: no, photos: list.length };
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
  /* (29-10-2026, "ekda banwaleli requirement edit delet krta yeil … jr requirement chi po banli aahe … sagalyat adhi po delet krayla lagel")
   * DELETE a requirement – who made it or the Store Admin; never while a purchase order (not cancelled) has it: that PO first. */
  async reqDelete(s, x) {
    need(s, 'req', 'Edit');
    if (!(await step8On(s.site))) throw fail(400, STEP8, 'sql');
    const no = noOf(x.no), cur = ((await db(s.site, 'GET', 'store_req?select=*&no=eq.' + no)) || [])[0];
    if (!cur) throw gone('Requirement ' + no);
    if (String(cur.created_by).toLowerCase() !== String(s.email).toLowerCase() && !s.admin) throw fail(403, 'Only who made a requirement (or the Store Admin) deletes it.', 'admin');
    await rpc(s.site, 'store_req_del', { p_no: no, p_at: cur.updated_at }).catch(e => said(e));
    changed(s.site);
    await activity(s.site, s.email, 'Requirement deleted', 'REQ ' + no, { date: cur.date, status: cur.status, for: cur.for_kind + (cur.for_text ? ' – ' + cur.for_text : ''), lines: (cur.lines || []).map(l => l.name + ' ' + l.qty + ' ' + l.unit),
      indent: cur.indent_no ? [cur.indent_fy, cur.indent_kind, String(cur.indent_no).padStart(4, '0')].join('/') : undefined, photos: phList(cur.photos).length || undefined });
    return { ok: true };
  },
  // (29-10-2026, "upload keleli photo … edit or delet krta yetil ek ek") one photo taken off a requirement (its file stays kept – as every file)
  async reqPhotoDel(s, x) {
    need(s, 'req', 'Edit');
    const no = noOf(x.no), sha = String(x.sha || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha)) throw fail(400, 'Which photo? – refresh and try again.', 'field');
    const cur = ((await db(s.site, 'GET', 'store_req?select=*&no=eq.' + no)) || [])[0]; if (!cur) throw gone('Requirement ' + no);
    if (String(cur.created_by).toLowerCase() !== String(s.email).toLowerCase() && !s.admin) throw fail(403, 'Only who made a requirement (or the Store Admin) takes its photos out.', 'admin');
    if (['Closed', 'Cancelled'].indexOf(cur.status) > -1) throw fail(409, 'Requirement ' + no + ' is ' + String(cur.status).toLowerCase() + ' – its photos stay as they are.', 'decided');
    const had = phList(cur.photos), list = had.filter(p => p.sha !== sha);
    if (list.length === had.length) throw fail(409, 'This photo is not on requirement ' + no + ' any more – refresh.', 'decided');
    const out = ((await db(s.site, 'PATCH', 'store_req?no=eq.' + no + '&updated_at=eq.' + enc(cur.updated_at), { photos: list, updated_by: s.email }, 'return=representation')) || [])[0];
    if (!out) throw fail(409, 'Requirement ' + no + ' was changed by someone else just now – refresh and look.', 'decided');
    await activity(s.site, s.email, 'Requirement photo taken out', 'REQ ' + no, { photo: sha.slice(0, 12), photos: list.length });
    return { ok: true, no: no, photos: list.length };
  },
  /* (29-10-2026) a machinery's maintenance log book: what the form shows when it is picked (up to which date it is written, how many
   * bills); attached to a requirement or taken off it (attach: true = as it is written now) – who made it or the Store Admin */
  async mlogInfo(s, x) {
    if (!can(s, 'req', 'View')) need(s, 'req', 'Edit');
    const m = (await machinery(s.site)).find(y => y.no === I.clean(x.no, 60)); if (!m) throw fail(400, 'Machinery "' + I.clean(x.no, 60) + '" is not in the Asset Master of this site.', 'field');
    return Object.assign(await ML.infoOf(dbAll, s.site, m.no), { name: m.name });
  },
  async reqLogbook(s, x) {
    need(s, 'req', 'Edit');
    if (!(await step8On(s.site))) throw fail(400, STEP8, 'sql');
    const no = noOf(x.no), cur = ((await db(s.site, 'GET', 'store_req?select=*&no=eq.' + no)) || [])[0]; if (!cur) throw gone('Requirement ' + no);
    if (String(cur.created_by).toLowerCase() !== String(s.email).toLowerCase() && !s.admin) throw fail(403, 'Only who made a requirement (or the Store Admin) attaches its log book.', 'admin');
    if (['Closed', 'Cancelled'].indexOf(cur.status) > -1) throw fail(409, 'Requirement ' + no + ' is ' + String(cur.status).toLowerCase() + ' – it stays as it is.', 'decided');
    if (cur.for_kind !== 'Machinery') throw fail(400, 'Requirement ' + no + ' is not for a machinery – it has no log book.', 'field');
    const lb = x.attach === true ? await logbookOf(s.site, s, cur.for_text) : null;
    if (x.attach === true && !lb) throw fail(400, cur.for_text + ' has no maintenance log book yet (no bill, nothing issued to it).', 'field');
    const out = ((await db(s.site, 'PATCH', 'store_req?no=eq.' + no + '&updated_at=eq.' + enc(cur.updated_at), { logbook: lb, updated_by: s.email }, 'return=representation')) || [])[0];
    if (!out) throw fail(409, 'Requirement ' + no + ' was changed by someone else just now – refresh and look.', 'decided');
    await activity(s.site, s.email, lb ? 'Requirement log book attached' : 'Requirement log book taken out', 'REQ ' + no, lb ? { machinery: lb.no, upto: lb.upto, bills: lb.bills } : { machinery: cur.for_text });
    return { ok: true, no: no, logbook: lb };
  },
  // the attached log book for the print – one piece of HTML (the web page and the app put it on the pages after the form); HO Purchase: any site
  async reqLogbookHtml(s, x) {
    const site = await siteFor(s, x), no = noOf(x.no);
    if (site === s.site && !can(s, 'req', 'View') && !isBuyer(s)) { const [lv, wf] = await Promise.all([levels(s.site), wfAt(s.site)]); if (!reqSeer(s, lv, wf)) need(s, 'req', 'View'); }      // (29-10-2026) one who verifies them too
    if (!(await step8On(site))) return { no: no, html: '' };
    const r = ((await db(site, 'GET', 'store_req?select=no,for_kind,for_text,logbook&no=eq.' + no)) || [])[0]; if (!r) throw gone('Requirement ' + no);
    const lb = r.logbook && r.logbook.no ? r.logbook : null; if (!lb) return { no: no, html: '' };
    const m = (await machinery(site)).find(y => y.no === lb.no) || { no: lb.no, name: '', type: '' };
    return { no: no, upto: lb.upto, html: ML.htmlOf(m, await ML.billsOf(dbAll, site, lb.no, lb.upto), lb.upto), css: ML.CSS };
  },
  // approve (or reject, with why) – one or many at once; any one person of the level it waits for; never one's own
  async reqDecide(s, x) {
    const nos = (Array.isArray(x.nos) ? x.nos : [x.no]).slice(0, 100).map(noOf), ok = x.ok === true, note = I.clean(x.note, 300);
    if (!ok && !note) throw fail(400, 'Say why it is rejected.', 'field');
    const [lv, wf] = await Promise.all([levels(s.site), wfAt(s.site)]), done = [], left = [];
    for (const no of nos) {
      const cur = ((await db(s.site, 'GET', 'store_req?select=*&no=eq.' + no)) || [])[0];
      if (!cur || cur.status !== 'Pending') { left.push({ no: no, why: cur ? 'already ' + cur.status.toLowerCase() : 'not there any more' }); continue; }
      const own = String(cur.created_by).toLowerCase() === me_(s), st = reqStep(cur, lv, wf);
      /* (29-10-2026) its VERIFICATION (level 0): one who verifies the requirements of this site (never his own); verified – to its first
       * level of approval (none: approved); not – rejected, saying why */
      if (st.step === 'verify') {
        if (own || !W.isIn(wf.verify.req, s.email)) { left.push({ no: no, why: own ? 'your own requirement' : 'it waits for its verification – not yours' }); continue; }
      } else if (!st.level || !W.canApprove(lv, st.level, s.email, cur.created_by)) { left.push({ no: no, why: own ? 'your own requirement' : !st.level ? 'nobody verifies or approves the requirements of this site now – the Super Admin gives it in the Portal' : 'it waits for level ' + st.level + ' – not yours' }); continue; }
      const next = ok ? W.nextLevel(lv, st.step === 'verify' ? 0 : st.level, cur.created_by) : 0;
      const ap = (cur.approvals || []).concat([Object.assign({ level: st.level, email: s.email, name: s.name, at: new Date().toISOString(), ok: ok, note: note || null }, st.step === 'verify' ? { step: 'verify' } : {})]);
      const patch = { approvals: ap, level: next, status: ok ? (next ? 'Pending' : 'Approved') : 'Rejected', updated_by: s.email };
      const out = ((await db(s.site, 'PATCH', 'store_req?no=eq.' + no + '&status=eq.Pending&level=eq.' + cur.level + '&updated_at=eq.' + enc(cur.updated_at), patch, 'return=representation')) || [])[0];
      if (!out) { left.push({ no: no, why: 'decided by someone else just now' }); continue; }
      done.push({ no: no, status: out.status, level: out.level, step: st.step });
      await activity(s.site, s.email, st.step === 'verify' ? (ok ? 'Requirement verified' : 'Requirement rejected (verification)') : ok ? 'Requirement approved' : 'Requirement rejected', 'REQ ' + no, { level: st.level, note: note || undefined, now: out.status });
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
  /* (29-10-2026) x.mine – a site that buys its requirements itself (the Portal → Workflow: they do not go to Head Office): its own, for its
   * Store Admin. Else HO Purchase: every site whose requirements go to Head Office – with who made each and since when it waits. */
  async purPending(s, x) {
    const mine = !!(x && x.mine);
    if (mine) await buyerOr(s, s.site); else buyerOnly(s);
    const out = [];
    for (const st of mine ? [{ code: s.site, name: (s.info && s.info.siteName) || s.site }] : await storeSites()) {
      try {
        const [reqs, pos, h, wf] = await Promise.all([dbAll(st.code, 'store_req?select=*&status=eq.Approved', 'no'), dbAll(st.code, 'store_po?select=no,status,lines', 'no'), headingOf(st.code, s), wfAt(st.code)]);
        if (!mine && !wf.ho.req) { out.push({ site: st.code, name: st.name, reqs: [], own: true, open: pos.filter(p => p.status === 'Open').length }); continue; }      // (the site buys itself)
        const o = orderedOf(pos), list = reqs.sort((a, b) => a.no - b.no).map(r => Object.assign(reqView(r, o, [], s), { ref: W.indentOf(r, h, st.code), since: sinceOf(r), made_by: r.created_name || r.created_by || '' })).filter(r => r.lines.some(l => l.left > 0.0005));      // (29-10-2026) with its Indent No.
        out.push({ site: st.code, name: st.name, reqs: list, open: pos.filter(p => p.status === 'Open').length });
      } catch (e) { out.push({ site: st.code, name: st.name, reqs: [], error: e && e.code === 'notinstalled' ? 'The Store\'s step 2 is not run in this site\'s database yet.' : 'Could not be read now.' }); }
    }
    return { sites: out, today: W.today() };
  },
  // a site's items and vendors (to make its PO)
  async purItems(s, x) {
    const site = await siteFor(s, x); if (site === s.site) await buyerOr(s, site);      // (29-10-2026) a site that buys itself: its Store Admin
    const [items, nm, pp, s5, h, s8] = await Promise.all([itemsOf(site), names(site), papersOf(site), step5On(site), headingOf(site, s), step8On(site).catch(() => false)]);
    const st0 = startOf(h, pp);
    return { site: site, items: Object.values(items).filter(i => i.status === 'Active').map(brief).sort((a, b) => a.name.localeCompare(b.name)), vendors: nm.vendors, gst: nm.gst,
      papers: { ship_to: st0.ship_to, site_contact: st0.site_contact, terms: st0.terms, contact_name: st0.contact_name, contact_phone: st0.contact_phone }, step5: s5, step8: s8 };      // (28-10-2026) what a new PO of this site starts with; (29-10-2026) the site's address and contact from the Portal
  },
  async poList(s, x) {
    const site = await siteFor(s, x), [mine, wf0] = await Promise.all([poPeople(s.site), wfAt(s.site)]);      // (28-10-2026) one who approves POs sees them (as one who approves requirements); (29-10-2026) one who verifies them
    if (!isBuyer(s) && !can(s, 'po', 'View') && !can(s, 'grn', 'View') && !mine.some(p => p.email === me_(s)) && !W.isIn(wf0.verify.po, s.email)) need(s, 'po', 'View');
    const sites = x.all && isBuyer(s) ? await storeSites() : [{ code: site, name: site }], out = [];
    for (const st of sites) {
      try {
        const pos = await dbAll(st.code, 'store_po?select=*', 'no'), grns = pos.length ? await grnsOfPos(st.code, pos.map(p => p.no)) : [], rec = recOf(grns);
        const nGrn = {}; grns.forEach(g => { nGrn[g.po_no] = (nGrn[g.po_no] || 0) + 1; });      // (29-10-2026) how many GRNs came on each
        const who = st.code === s.site ? mine : [], wf = st.code === s.site ? wf0 : await wfAt(st.code).catch(() => W.wfOf(null));      // a PO is approved by a person of its own site, signed in there
        // (29-10-2026) each line of a requirement with its Indent No.
        const rn = [...new Set([].concat(...pos.map(p => (p.lines || []).map(l => Number(l.req_no)))).filter(n => n > 0))], rq = {};
        if (rn.length) { try { const h = await headingOf(st.code, s); for (let i = 0; i < rn.length; i += 150) (await dbAll(st.code, 'store_req?select=*&no=in.(' + rn.slice(i, i + 150).join(',') + ')', 'no')).forEach(r => { rq[r.no] = W.indentOf(r, h, st.code); }); } catch (e) { /* (the number alone) */ } }
        pos.forEach(p => { p.lines = (p.lines || []).map(l => l.req_no && rq[l.req_no] ? Object.assign({}, l, { req_ref: rq[l.req_no] }) : l); });
        const apprAll = st.code === s.site ? mine : await poPeople(st.code).catch(() => []);
        pos.sort(byNo).forEach(p => { const v = poView(p, rec), ps = poStep(p, wf, apprAll, s, st.code === s.site);
          // (29-10-2026) its verification first (step 9): an older app knows only "Approve" – for one who verifies it, that is his verification
          out.push(Object.assign(v, { site: st.code, siteName: st.name, step: ps.step, mayVerify: ps.step === 'verify' && ps.may, mayApprove: ps.may, waitFor: ps.waitFor, grns: nGrn[p.no] || 0 })); });
      } catch (e) { if (sites.length === 1) throw e; }
    }
    return { pos: out, today: W.today(), buy: await mayBuy(s, site) };      // (29-10-2026) buy: this person makes and changes the POs of this site (HO Purchase; a site that buys itself – its Store Admin)
  },
  /* (29-10-2026, "standard ERP … PO … GRN … balance") ONE PO with every GRN made against it: each line ordered, came and still to come
   * (quantity and value), each GRN (its bill) with its lines and its check with the PO – HO Purchase sees the PO in full, the site its
   * GRNs and its balance */
  async poGrns(s, x) {
    const site = await siteFor(s, x), no = noOf(x.no), [mine, wf0] = await Promise.all([poPeople(s.site), wfAt(s.site)]);
    if (!isBuyer(s) && !can(s, 'po', 'View') && !can(s, 'grn', 'View') && !mine.some(p => p.email === me_(s)) && !W.isIn(wf0.verify.po, s.email)) need(s, 'po', 'View');
    const p = ((await db(site, 'GET', 'store_po?select=*&no=eq.' + no)) || [])[0]; if (!p) throw gone('PO ' + no);
    const grns = await dbAll(site, 'store_grn?select=*,store_grn_lines(*)&po_no=eq.' + no, 'no'), before = beforeOf(grns), rec = recOf(grns), wf = site === s.site ? wf0 : await wfAt(site);
    const [h, pp] = await Promise.all([headingOf(site, s), papersOf(site)]);
    return { po: Object.assign(poView(p, rec), { site: site, ref: W.refOf(prefixOf(pp, h, site), 'PO', p.date, p.no) }), lines: W.poBalance(p, rec), today: W.today(),
      grns: grns.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.no - b.no).map(g => { const lines = sortLines(g.store_grn_lines);
        return Object.assign({ no: g.no, ref: R.refOf(g), date: g.date, supplier: g.supplier, invoice_no: g.invoice_no, invoice_date: g.invoice_date, challan_no: g.challan_no, vehicle_no: g.vehicle_no, taxable: g.taxable, gst: g.gst, gross: g.gross,
          lines: lines.map(l => ({ line: l.line, code: l.code, name: l.name, unit: l.unit, qty: l.qty, rate: l.rate, taxable: l.taxable, gst_pct: l.gst_pct, po_line: l.po_line })), check: W.billCheck(lines, p, before[g.no] || {}) }, wfInfo(wf, 'grn', g.wf, s)); }) };
  },
  async poGet(s, x) {
    const site = await siteFor(s, x), no = noOf(x.no), [mine, wf0] = await Promise.all([poPeople(s.site), wfAt(s.site)]);
    if (!isBuyer(s) && !can(s, 'po', 'View') && !can(s, 'grn', 'View') && !mine.some(p => p.email === me_(s)) && !W.isIn(wf0.verify.po, s.email)) need(s, 'po', 'View');      // (29-10-2026) one who verifies them too
    const p = ((await db(site, 'GET', 'store_po?select=*&no=eq.' + no)) || [])[0]; if (!p) throw gone('PO ' + no);
    const [h, pp, items] = await Promise.all([headingOf(site, s), papersOf(site), itemsOf(site)]);
    // (28-10-2026, his format) the supplier's details from the Vendor Master of the site (Mechanical's – the same database): address,
    // mobile, e-mail, the Owner Name as the contact person, GSTIN – what is not there stays blank
    let v = null; try { v = ((await dbAll(site, 'vendors?select=*', 'id')) || []).find(r => I.keyOf(r.vendor_name) === I.keyOf(p.vendor)) || null; } catch (e) { v = null; }
    const supplier = { name: p.vendor, address: v ? v.address || '' : '', mobile: v ? v.phone || '' : '', email: v ? v.email || '' : '', contact: v ? v.owner_name || '' : '', gstin: p.vendor_gst || (v ? v.gst_number || '' : '') };
    // (29-10-2026) each line of a requirement with its Indent No.
    const rn = [...new Set((p.lines || []).map(l => Number(l.req_no)).filter(n => n > 0))], rq = {};
    if (rn.length) { try { (await dbAll(site, 'store_req?select=*&no=in.(' + rn.join(',') + ')', 'no')).forEach(r => { rq[r.no] = W.indentOf(r, h, site); }); } catch (e) { /* (the number alone) */ } }
    const vby = ((p.wf && Array.isArray(p.wf.steps) ? p.wf.steps : []).filter(y => y && y.step === 'verify' && y.ok).pop() || {}).name || '';      // (29-10-2026) who verified it (its paper: "Verified By")
    const po = Object.assign(poView(p, await receivedOf(site, [no])), { site: site, ref: W.refOf(prefixOf(pp, h, site), 'PO', p.date, p.no), words: W.inWords(p.total), verified_by: vby,
      lines: sortLines(p.lines).map(l => Object.assign({}, l, { hsn: l.hsn || (items[l.code] || {}).hsn || '' }, l.req_no && rq[l.req_no] ? { req_ref: rq[l.req_no] } : {})) });
    return { po: po, supplier: supplier, heading: headOut(h, pp) };
  },
  async poSave(s, x) {
    const site = await siteFor(s, x); await buyerOr(s, site);      // (29-10-2026) a site that buys itself: its Store Admin too
    const no = x.no ? noOf(x.no) : null, items = await itemsOf(site);
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
    // (29-10-2026) its VERIFICATION first (step 9 at its site), when someone other than its maker verifies the POs of its site; then its approval
    const s9 = s5 && await step9On(site).catch(() => false), wf = s9 ? await wfAt(site) : null, vf = !!(wf && W.othersOf(wf.verify.po, s.email).length);
    let others = [];
    if (s5) { others = (await poPeople(site)).filter(q => q.email !== me_(s));
      p.appr = others.length || vf ? 'Waiting' : 'Approved'; p.appr_note = others.length || vf ? '' : 'Nobody approves purchase orders at this site – approved when made.'; }
    if (cur) {      // a changed PO: never less than already came
      const rec = await receivedOf(site, [no]);
      (cur.lines || []).forEach(l => { const got = rec[no + ':' + l.line] || 0, nl = p.lines.find(y => y.line === l.line && y.code === l.code); if (got > 0 && (!nl || nl.qty + 0.0005 < got)) throw fail(409, l.name + ': ' + r3(got) + ' ' + l.unit + ' already came on PO ' + no + ' – the PO keeps at least that (line ' + l.line + ').', 'received'); });
    }
    const n = await rpc(site, 'store_po_put', { p_no: no, p_row: p, p_by: s.email, p_name: s.name }).catch(e => said(e, items));
    // (29-10-2026) its workflow: to verification (a changed PO again); none – nothing kept (its approval is its appr, as before)
    let wfNote = '';
    if (s9 && (vf || no)) { try { await db(site, 'PATCH', 'store_po?no=eq.' + Number(n), { wf: vf ? { state: 'verify', by: me_(s), at: new Date().toISOString(), steps: [] } : null }, 'return=minimal'); }
      catch (e) { wfNote = 'PO ' + Number(n) + ' is saved – but its verification could not be noted (' + String((e && e.message) || e).slice(0, 80) + '): it waits for its approval. Save it again to send it for verification.'; } }
    changed(site);
    await activity(site, s.email, no ? 'PO changed' : 'PO made', 'PO ' + n, { vendor: p.vendor, total: p.total, lines: p.lines.length, by: s.site !== site ? 'HO Purchase (' + s.site + ')' : undefined, verify: vf || undefined });
    return Object.assign({ ok: true, site: site, no: Number(n), total: p.total, appr: p.appr || 'Approved', step: p.appr === 'Waiting' ? (vf && !wfNote ? 'verify' : 'approve') : '' }, wfNote ? { note: wfNote } : {});
  },
  /* (28-10-2026, his answer: "PO approve karaychi payri kara") a PO waiting for its approval: approved (his name goes on the PO's
   * "Approved By") or rejected, saying why (the one who made it changes it – it waits again). Only one the Super Admin ticked for this
   * site ("Approves purchase orders"), never his own; only a PO still open and waiting. */
  async poDecide(s, x) {
    if (!(await step5On(s.site))) throw fail(400, STEP5, 'sql');
    const no = noOf(x.no), ok = x.ok === true, note = I.clean(x.note, 300), [people, wf] = await Promise.all([poPeople(s.site), wfAt(s.site)]);
    const p = ((await db(s.site, 'GET', 'store_po?select=*&no=eq.' + no)) || [])[0]; if (!p) throw gone('PO ' + no);
    if (p.status !== 'Open' || apprOf(p) !== 'Waiting') throw fail(409, 'PO ' + no + ' is not waiting for its approval any more (it is ' + (p.status !== 'Open' ? p.status.toLowerCase() : apprOf(p).toLowerCase()) + ') – refresh.', 'decided');
    const own = String(p.created_by || '').toLowerCase() === me_(s), ps = poStep(p, wf, people, s, true), at = new Date().toISOString();
    /* (29-10-2026) its VERIFICATION: one who verifies the POs of this site (never his own) – verified: it waits for its approval (nobody
     * approves POs here: approved); not: rejected, saying why (the one who made it changes it – it waits again) */
    if (ps.step === 'verify') {
      if (!ps.may) throw fail(403, own ? 'Nobody verifies his own purchase order.' : 'You do not verify the purchase orders of this site – the Super Admin gives it in the Portal ("Verifies purchase orders").', 'approve');
      if (!ok && !note) throw fail(400, 'Say why the PO is sent back (the one who made it sees it).', 'field');
      const more = people.filter(q => q.email !== String(p.created_by || '').toLowerCase()).length > 0;
      const w = Object.assign({}, p.wf, { state: !ok ? 'returned' : more ? 'approve' : 'done', steps: ((p.wf || {}).steps || []).concat([{ step: 'verify', ok: ok, email: me_(s), name: s.name, at: at, note: note || null }]) });
      const patch = !ok ? { appr: 'Rejected', appr_by: s.email, appr_name: s.name, appr_at: at, appr_note: note, wf: w } : more ? { wf: w }
        : { appr: 'Approved', appr_by: s.email, appr_name: s.name, appr_at: at, appr_note: 'Verified by ' + s.name + ' – nobody approves purchase orders at this site.', wf: w };
      const r = await db(s.site, 'PATCH', 'store_po?no=eq.' + no + '&status=eq.Open&appr=eq.Waiting&wf->>state=eq.verify', patch, 'return=representation');
      if (!r || !r.length) throw fail(409, 'PO ' + no + ' was decided by someone else just now – refresh.', 'decided');
      changed(s.site);
      await activity(s.site, s.email, ok ? 'PO verified' : 'PO rejected (verification)', 'PO ' + no, { vendor: p.vendor, total: num(p.total), note: note || undefined, now: patch.appr || 'Waiting approval' });
      return { ok: true, no: no, appr: patch.appr || 'Waiting', step: w.state };
    }
    if (!W.mayApprovePo(people, s.email, p.created_by)) throw fail(403, own ? 'Nobody approves his own purchase order.' : 'You do not approve the purchase orders of this site – the Super Admin gives it in the Portal ("Approves purchase orders").', 'approve');
    if (!ok && !note) throw fail(400, 'Say why the PO is rejected (the one who made it sees it).', 'field');
    const patch = { appr: ok ? 'Approved' : 'Rejected', appr_by: s.email, appr_name: s.name, appr_at: at, appr_note: note || null };
    if (p.wf && typeof p.wf === 'object') patch.wf = Object.assign({}, p.wf, { state: ok ? 'done' : 'returned', steps: (p.wf.steps || []).concat([{ step: 'approve', ok: ok, email: me_(s), name: s.name, at: at, note: note || null }]) });
    const r = await db(s.site, 'PATCH', 'store_po?no=eq.' + no + '&status=eq.Open&appr=eq.Waiting', patch, 'return=representation');
    if (!r || !r.length) throw fail(409, 'PO ' + no + ' was decided by someone else just now – refresh.', 'decided');
    changed(s.site);
    await activity(s.site, s.email, ok ? 'PO approved' : 'PO rejected', 'PO ' + no, { vendor: p.vendor, total: num(p.total), note: note || undefined });
    return { ok: true, no: no, appr: ok ? 'Approved' : 'Rejected' };
  },
  async poCancel(s, x) {
    const site = await siteFor(s, x), no = noOf(x.no); await buyerOr(s, site);      // (29-10-2026) a site that buys itself: its Store Admin too
    const p = ((await db(site, 'GET', 'store_po?select=no,status&no=eq.' + no)) || [])[0]; if (!p) throw gone('PO ' + no);
    if (p.status !== 'Open') throw fail(409, 'PO ' + no + ' is ' + p.status.toLowerCase() + ' already.', 'decided');
    if ((await dbAll(site, 'store_grn?select=no&po_no=eq.' + no, 'no')).length) throw fail(409, 'Material of PO ' + no + ' has come (a GRN has it) – it cannot be cancelled. Close it (the rest will not come).', 'received');
    await db(site, 'PATCH', 'store_po?no=eq.' + no + '&status=eq.Open', { status: 'Cancelled', close_note: W.dmy(W.today()) + ' cancelled by ' + s.name, updated_by: s.email }, 'return=minimal');
    await activity(site, s.email, 'PO cancelled', 'PO ' + no, null);
    return { ok: true };
  },
  /* (29-10-2026) DELETE a purchase order – HO Purchase; never one whose material came (a GRN has it). Its requirements are then free to
   * be changed or deleted (his words: "jr requirement chi po banli aahe … sagalyat adhi po delet krayla lagel mgch same requirement edit") */
  async poDelete(s, x) {
    const site = await siteFor(s, x), no = noOf(x.no); await buyerOr(s, site);      // (29-10-2026) a site that buys itself: its Store Admin too
    if (!(await step8On(site))) throw fail(400, STEP8, 'sql');
    const p = ((await db(site, 'GET', 'store_po?select=*&no=eq.' + no)) || [])[0]; if (!p) throw gone('PO ' + no);
    await rpc(site, 'store_po_del', { p_no: no }).catch(e => said(e));
    changed(site);
    await activity(site, s.email, 'PO deleted', 'PO ' + no, { date: p.date, vendor: p.vendor, total: num(p.total), status: p.status, requirements: [...new Set((p.lines || []).map(l => l.req_no).filter(Boolean))], by: s.site !== site ? 'HO Purchase (' + s.site + ')' : undefined });
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
    const wf = await wfAt(s.site);
    if (!seeWork(s, 'grn', wf, 'grn')) need(s, 'grn', 'View');      // (29-10-2026) one who verifies or approves the GRNs sees them
    const p = period(x), g = await dbAll(s.site, 'store_grn?select=*,store_grn_lines(*)&date=gte.' + p.from + '&date=lte.' + p.to, 'no');
    // (28-10-2026) the newest first by date, then by GRN No (an imported GRN's number is its GRN No – "342-A" too – not its row's)
    // (29-10-2026) each with its workflow and – against a PO – its bill checked with the PO
    return { from: p.from, to: p.to, grns: await grnsOut(s, s.site, g.sort((a, b) => b.date.localeCompare(a.date) || R.refCmp(b, a)), wf) };
  },
  /* (29-10-2026) WAITING FOR ME at this site: the GRNs, issues and returns this person verifies or approves now (of any date – the lists
   * show a period), with everything the lists show of them */
  async wfMine(s) {
    if (!(await step9On(s.site))) return { grns: [], issues: [], step9: false };
    const wf = await wfAt(s.site), q = '&wf->>state=in.(verify,approve)';
    const [gs, is, rs] = await Promise.all([dbAll(s.site, 'store_grn?select=*,store_grn_lines(*)' + q, 'no'), dbAll(s.site, 'store_issue?select=*,store_issue_lines(*)' + q, 'no'), dbAll(s.site, 'store_return?select=issue_no,wf' + q, 'no')]);
    const g2 = gs.filter(g => W.wfMay(wf, 'grn', g.wf, s.email));
    // an issue waiting, or one whose return waits (the issue is shown with its returns)
    const want = new Set(is.filter(i => W.wfMay(wf, 'iss', i.wf, s.email)).map(i => i.no).concat(rs.filter(r => W.wfMay(wf, 'iss', r.wf, s.email)).map(r => r.issue_no)));
    let i2 = is.filter(i => want.has(i.no)); const more = [...want].filter(n => !i2.some(i => i.no === n));
    if (more.length) i2 = i2.concat(await dbAll(s.site, 'store_issue?select=*,store_issue_lines(*)&no=in.(' + more.slice(0, 300).join(',') + ')', 'no'));
    return { grns: await grnsOut(s, s.site, g2.sort((a, b) => b.date.localeCompare(a.date) || R.refCmp(b, a)), wf), issues: await issuesOut(s, s.site, i2, wf), step9: true };
  },
  /* (29-10-2026) a GRN, an issue or a return VERIFIED or APPROVED (or sent back, saying why) – one who verifies / approves that work at
   * this site (the Portal), never his own; verified – to its approval (when someone approves), approved – done and, by the site's rule,
   * to Head Office. Its stock is not touched (it counted when it was saved). */
  async wfDecide(s, x) {
    const T = { grn: ['store_grn', 'grn', 'GRN'], issue: ['store_issue', 'iss', 'Issue'], ret: ['store_return', 'iss', 'Return'] }[String(x.kind || '')];
    if (!T) throw fail(400, 'Which paper?', 'field');
    if (!(await step9On(s.site))) throw fail(400, STEP9, 'sql');
    const no = noOf(x.no), ok = x.ok === true, note = I.clean(x.note, 300), wf = await wfAt(s.site);
    const cur = ((await db(s.site, 'GET', T[0] + '?select=*&no=eq.' + no)) || [])[0]; if (!cur) throw gone(T[2] + ' ' + no);
    const w = cur.wf, label = T[2] + ' ' + (T[1] === 'grn' ? R.refOf(cur) : no);
    if (!w || (w.state !== 'verify' && w.state !== 'approve')) throw fail(409, label + ' is not waiting for a verification or an approval (any more) – refresh.', 'decided');
    if (!W.wfMay(wf, T[1], w, s.email)) {
      const st = W.wfStepNow(wf, T[1], w);
      throw fail(403, w.by === me_(s) ? 'Nobody verifies or approves his own entry.' : !st ? 'Nobody ' + (w.state === 'verify' ? 'verifies or approves' : 'approves') + ' the ' + (T[1] === 'grn' ? 'GRNs' : 'issues & returns') + ' of this site now – the Super Admin gives it in the Portal.' : 'You do not ' + (st === 'verify' ? 'verify' : 'approve') + ' the ' + (T[1] === 'grn' ? 'GRNs' : 'issues & returns') + ' of this site – the Super Admin gives it in the Portal.', 'approve');
    }
    if (!ok && !note) throw fail(400, 'Say why it is sent back (the Store Admin corrects it).', 'field');
    const step = W.wfStepNow(wf, T[1], w), nw = W.wfNext(wf, T[1], w, { email: s.email, name: s.name }, ok, note);
    const r = await db(s.site, 'PATCH', T[0] + '?no=eq.' + no + '&wf->>state=eq.' + w.state, { wf: nw }, 'return=representation');
    if (!r || !r.length) throw fail(409, label + ' was decided by someone else just now – refresh.', 'decided');
    changed(s.site);
    await activity(s.site, s.email, label.split(' ')[0] + (ok ? (step === 'verify' ? ' verified' : ' approved') : ' sent back (' + step + ')'), label, { note: note || undefined, now: nw.state, ho: nw.ho || undefined });
    return { ok: true, no: no, state: nw.state, ho: !!nw.ho };
  },
  /* (29-10-2026, "konte jail konte nahi jail te super admin tharau shakel") HEAD OFFICE: what the sites sent – their GRNs (the suppliers'
   * bills, each checked with its PO) or their issues and returns – approved there and sent to Head Office by the site's rule (the Portal
   * → Workflow). HO Purchase checks each (✓ Checked, a note if he wants). x.kind 'grn' | 'iss'; x.done: the ones checked (the newest 60). */
  async hoInbox(s, x) {
    buyerOnly(s);
    const kind = x.kind === 'iss' ? 'iss' : 'grn', q = '&wf->>ho=eq.true&wf->hoOk=' + (x.done ? 'not.is.null' : 'is.null'), out = [];
    for (const st of await storeSites()) {
      try {
        if (!(await step9On(st.code))) { out.push({ site: st.code, name: st.name, rows: [], step9: false }); continue; }
        const wf = await wfAt(st.code), lim = x.done ? '&order=no.desc&limit=60' : '';
        if (kind === 'grn') { const g = x.done ? (await db(st.code, 'GET', 'store_grn?select=*,store_grn_lines(*)' + q + lim)) || [] : await dbAll(st.code, 'store_grn?select=*,store_grn_lines(*)' + q, 'no');
          out.push({ site: st.code, name: st.name, ho: wf.ho.grn, rows: await grnsOut(s, st.code, g.sort((a, b) => b.date.localeCompare(a.date) || R.refCmp(b, a)), wf), step9: true }); }
        else {
          const [is, rs] = await Promise.all([x.done ? db(st.code, 'GET', 'store_issue?select=*,store_issue_lines(*)' + q + lim).then(v => v || []) : dbAll(st.code, 'store_issue?select=*,store_issue_lines(*)' + q, 'no'),
            x.done ? db(st.code, 'GET', 'store_return?select=no,issue_no,wf' + q + lim).then(v => v || []) : dbAll(st.code, 'store_return?select=no,issue_no,wf' + q, 'no')]);
          const more = [...new Set(rs.map(r => r.issue_no))].filter(n => !is.some(i => i.no === n));
          const all = more.length ? is.concat(await dbAll(st.code, 'store_issue?select=*,store_issue_lines(*)&no=in.(' + more.slice(0, 300).join(',') + ')', 'no')) : is;
          out.push({ site: st.code, name: st.name, ho: wf.ho.iss, rows: await issuesOut(s, st.code, all, wf), step9: true });
        }
      } catch (e) { out.push({ site: st.code, name: st.name, rows: [], error: 'Could not be read now.' }); }
    }
    return { kind: kind, done: !!x.done, sites: out };
  },
  // (29-10-2026) Head Office checked what a site sent (HO Purchase): ✓ with who, when and a note
  async hoCheck(s, x) {
    buyerOnly(s);
    const T = { grn: ['store_grn', 'GRN'], issue: ['store_issue', 'Issue'], ret: ['store_return', 'Return'] }[String(x.kind || '')];
    if (!T) throw fail(400, 'Which paper?', 'field');
    const site = await siteFor(s, x), no = noOf(x.no), note = I.clean(x.note, 300);
    if (!(await step9On(site))) throw fail(400, STEP9, 'sql');
    const cur = ((await db(site, 'GET', T[0] + '?select=*&no=eq.' + no)) || [])[0]; if (!cur) throw gone(T[1] + ' ' + no);
    const w = cur.wf, label = T[1] + ' ' + (T[0] === 'store_grn' ? R.refOf(cur) : no) + ' of ' + site;
    if (!w || w.ho !== true) throw fail(409, label + ' was not sent to Head Office – refresh.', 'decided');
    if (w.hoOk) throw fail(409, label + ' is checked already (by ' + (w.hoOk.name || '') + ') – refresh.', 'decided');
    const nw = Object.assign({}, w, { hoOk: { email: me_(s), name: s.name, at: new Date().toISOString(), note: note || null } });
    const r = await db(site, 'PATCH', T[0] + '?no=eq.' + no + '&wf->>ho=eq.true&wf->hoOk=is.null', { wf: nw }, 'return=representation');
    if (!r || !r.length) throw fail(409, label + ' was checked by someone else just now – refresh.', 'decided');
    changed(site);
    await activity(site, s.email, 'Checked by Head Office', label, { note: note || undefined, by: 'HO Purchase (' + s.site + ')' });
    return { ok: true };
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
    // (29-10-2026) its workflow (step 9): to verification / approval; a changed GRN starts again (also to Head Office again, by the rule)
    const wfr = await wfSet(s.site, 'store_grn', n, s, 'grn', !no);
    changed(s.site);
    await activity(s.site, s.email, no ? 'GRN changed' : 'GRN made', 'GRN ' + (!no && g.head.ref ? g.head.ref : n), { supplier: g.head.supplier, gross: g.head.gross, lines: g.lines.map(l => l.name + ' ' + l.qty + ' ' + l.unit), po: poNo || undefined, wf: wfr.state || undefined });
    return Object.assign({ ok: true, no: Number(n), ref: !no && g.head.ref ? g.head.ref : String(n), gross: g.head.gross, wf: wfr.state }, wfr.note ? { note: wfr.note } : {});
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
    const wf = await wfAt(s.site);
    if (!seeWork(s, 'issue', wf, 'iss')) need(s, 'issue', 'View');      // (29-10-2026) one who verifies or approves the issues sees them
    const p = period(x), iss = await dbAll(s.site, 'store_issue?select=*,store_issue_lines(*)&date=gte.' + p.from + '&date=lte.' + p.to, 'no');
    // (29-10-2026) each issue and each of its returns with its workflow
    return { from: p.from, to: p.to, issues: await issuesOut(s, s.site, iss, wf) };
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
    const wfr = await wfSet(s.site, 'store_issue', n, s, 'iss', !no);      // (29-10-2026) its workflow (step 9)
    changed(s.site);
    await activity(s.site, s.email, no ? 'Issue changed' : 'Issue made', 'OUT ' + n, { to: g.head.to_kind + (g.head.party ? ' ' + g.head.party : '') + (g.head.machinery ? ' ' + g.head.machinery : ''), lines: g.lines.map(l => l.name + ' ' + l.qty + ' ' + l.unit), wf: wfr.state || undefined });
    return Object.assign({ ok: true, no: Number(n), amount: g.head.amount, wf: wfr.state }, wfr.note ? { note: wfr.note } : {});
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
    const wfr = await wfSet(s.site, 'store_return', n, s, 'iss', !no);      // (29-10-2026) its workflow (step 9) – as the issues'
    changed(s.site);
    await activity(s.site, s.email, no ? 'Return changed' : 'Return made', 'RET ' + n, { issue: iss.no, lines: g.lines.length, wf: wfr.state || undefined });
    return Object.assign({ ok: true, no: Number(n), wf: wfr.state }, wfr.note ? { note: wfr.note } : {});
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
    if (k === 'req') { const [reqs, pos, h] = await Promise.all([dbAll(s.site, 'store_req?select=*', 'no'), dbAll(s.site, 'store_po?select=no,status,lines', 'no'), headingOf(s.site, s)]); return R.requirements(reqs, orderedOf(pos), { status: x.status, from: x.from, to: x.to, ref: r => W.indentOf(r, h, s.site) }); }      // (29-10-2026) with its Indent No.
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
    const [pp, h, s5] = await Promise.all([papersOf(s.site), headingOf(s.site, s), step5On(s.site)]);
    return { next: { GRN: n.GRN || 1, OUT: n.OUT || 1 }, used: { GRN: g && g[0] ? Number(g[0].no) : 0, OUT: o && o[0] ? Number(o[0].no) : 0 }, papers: pp, prefixNow: prefixOf(pp, h, s.site), step5: s5 };
  },
  // (28-10-2026) the papers' settings (the Store Admin): the numbers' prefix, the heading's e-mail / contact / CIN / web, a new PO's
  // shipping address, site contact and terms – each as typed (empty = none)
  async papersSave(s, x) {
    adminOnly(s, 'set the papers');
    const v = {}, max = { prefix: 30, email: 80, phone: 60, cin: 30, web: 80, ship_to: 300, site_contact: 120, terms: 3000, site_address: 300 }, cur = await papersOf(s.site);
    PAPERS.forEach(k => { if (x[k] === undefined && cur[k] !== undefined) { v[k] = cur[k]; return; }      // (29-10-2026) a box not sent (an older app) keeps what it has
      const raw = String(x[k] === undefined || x[k] === null ? '' : x[k]); const t = (k === 'terms' || k === 'ship_to' || k === 'site_address' ? raw.split(/\r?\n/).map(l => I.clean(l, 400)).filter(Boolean).join('\n') : I.clean(raw, max[k])).slice(0, max[k]); if (t) v[k] = t; });
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
module.exports._ph = { phOf, phTok, phList, phPath, PH, STEP7 };      // (for the unit test – 29-10-2026, a requirement's photos)
