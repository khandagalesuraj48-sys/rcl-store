/* SIGN-IN THROUGH THE PORTAL – the only way into the Store (the Portal is the one sign-in and the one place access is given).
 * The Portal sends the browser here with a TICKET after "#sso=" (it never reaches a server log): who, which site, Admin or
 * User, his other modules on that site and his other sites of the Store – SIGNED by the Portal (ES256), valid 60 seconds.
 * Checked here: the signature with the Portal's PUBLIC key (<PORTAL_URL>/api/jwks – kept 10 minutes, asked again at most every
 * 5 s for a key not known yet), who made it (iss = PORTAL_URL), for whom (aud = "store"), its time, and its parts. That a
 * ticket is used ONCE is checked in the site's database (store_tickets – api/sso.js). */
'use strict';
const crypto = require('crypto');
const { fail } = require('./http');

const AUD = 'store', EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function url() {
  const u = String(process.env.PORTAL_URL || '').trim().replace(/\/+$/, '');
  // (the Portal may also be served under a path of the one address, e.g. https://erp…/portal)
  if (/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[a-z0-9-]{1,30})?$/i.test(u) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/[a-z0-9-]{1,30})?$/i.test(u)) return u;
  return '';
}
const bad = why => fail(401, 'The Portal sign-in could not be accepted (' + why + ') – open the Store again from the Portal.', 'ticket');

let KEYS = { at: 0, from: '', keys: [] };
async function keys(fresh) {
  const from = url();
  if (KEYS.from === from && KEYS.at && Date.now() - KEYS.at < (fresh ? 5000 : 600000)) return KEYS.keys;
  let j = null;
  try { const r = await fetch(from + '/api/jwks', { signal: AbortSignal.timeout(10000) }); if (r.ok) j = await r.json(); } catch (e) { j = null; }
  if (!j) { if (KEYS.from === from && KEYS.keys.length) return KEYS.keys; throw bad('the Portal could not be reached'); }
  KEYS = { at: Date.now(), from: from, keys: Array.isArray(j.keys) ? j.keys : [] };
  return KEYS.keys;
}
// a module's address as the Portal gives it (https only; http only for this computer, for tests); '' = none
const okUrl = u => { u = String(u || '').trim().replace(/\/+$/, ''); return /^https:\/\/[a-z0-9.-]+(:\d+)?(\/[a-z0-9-]{1,30})?$/i.test(u) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/[a-z0-9-]{1,30})?$/i.test(u) ? u : ''; };
const part = s => { try { return JSON.parse(Buffer.from(String(s), 'base64url').toString('utf8')); } catch (e) { return null; } };

// the Store's pages and what each may be: Dashboard – seen or not; Item Master – Edit (add) / View (see, export) / No access
// (step 2, 28-10-2026) Requirement, Inward (GRN), Issue & Return – Edit / View / No access; Stock & Reports, Purchase orders (of the
// site) – View / No access; STORE PURCHASE – HO Purchase: the purchase orders of every site (Edit) – given also to a Store Admin
const PAGE_ACCESS = { dashboard: ['View', 'None'], items: ['Edit', 'View', 'None'], req: ['Edit', 'View', 'None'], grn: ['Edit', 'View', 'None'], issue: ['Edit', 'View', 'None'],
  reports: ['View', 'None'], po: ['View', 'None'], purchase: ['Edit', 'None'] };
const ADMIN_TOO = ['purchase'];      // (what a Store Admin gets only when it is given – he has every other page)
/* a ticket of the Portal: its signature (the Portal's public key), who made it, for whom (aud), its time. The claims, unchecked else. */
async function check(ticket, aud, now) {
  const from = url();
  if (!from) throw fail(500, 'The Store is not linked to the Portal: add PORTAL_URL (e.g. https://rcl-portal-flame.vercel.app) in Vercel → Environment Variables, then Redeploy.', 'setup');
  const t = String(ticket || '');
  if (t.length > 8000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t)) throw bad('not a ticket');
  const [h64, b64, s64] = t.split('.'), head = part(h64), c = part(b64);
  if (!head || !c || head.alg !== 'ES256' || !head.kid) throw bad('not a ticket of the Portal');
  let jwk = (await keys(false)).find(k => k.kid === head.kid);
  if (!jwk) jwk = (await keys(true)).find(k => k.kid === head.kid);
  if (!jwk) throw bad('unknown key');
  let ok = false;
  try { ok = crypto.verify('sha256', Buffer.from(h64 + '.' + b64), { key: crypto.createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(s64, 'base64url')); } catch (e) { ok = false; }
  if (!ok) throw bad('the signature does not match');
  const sec = Math.floor((now || Date.now()) / 1000);
  if (c.iss !== from) throw bad('made by another Portal');
  if (c.aud !== aud) throw bad('made for another module');
  if (typeof c.exp !== 'number' || typeof c.iat !== 'number' || c.exp - c.iat > 120) throw bad('no proper time');
  if (c.exp < sec - 5) throw bad('it ran out – it is valid for one minute');
  if (c.iat > sec + 60) throw bad('made in the future – check the clock');
  if (!/^[A-Z0-9]{1,12}$/.test(String(c.site || ''))) throw bad('no proper site');
  if (!/^[0-9a-f]{16,64}$/.test(String(c.jti || ''))) throw bad('no ticket number');
  return c;
}
/* (step 2) THE SUPER ADMIN'S CONSOLE TELLS THE STORE (aud "store-admin", sent by the Portal's server, not by a browser): who
 * approves the requirements of a site, level by level. The same checks as a sign-in's ticket; used once (api/portal.js). */
async function verifyAdmin(ticket, now) {
  const c = await check(ticket, 'store-admin', now);
  const email = String(c.sub || '').trim().toLowerCase();
  if (!EMAIL.test(email)) throw bad('no proper email');
  if (['approvers'].indexOf(c.act) === -1) throw bad('no proper action');
  const levels = (Array.isArray(c.levels) ? c.levels : []).slice(0, 5).map(l => ({ level: Number(l && l.level),
    people: (Array.isArray(l && l.people) ? l.people : []).slice(0, 40).map(p => ({ email: String((p && p.email) || '').trim().toLowerCase().slice(0, 120), name: String((p && p.name) || '').slice(0, 80) })).filter(p => EMAIL.test(p.email)) }))
    .filter(l => l.level >= 1 && l.level <= 5);
  return { by: email, site: c.site, act: c.act, levels: levels, jti: c.jti, exp: c.exp };
}
async function verify(ticket, now) {
  const c = await check(ticket, AUD, now);
  const email = String(c.sub || '').trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 120) throw bad('no proper email');
  if (['admin', 'user'].indexOf(c.role) === -1) throw bad('no proper role');
  const list = (a, f) => (Array.isArray(a) ? a : []).slice(0, 40).map(f).filter(Boolean);
  // (14-10-2026) the pages a Store User may open, as the Super Admin set them in the Portal (none given = as before: every page)
  const pages = {}; const pg = c.pages && typeof c.pages === 'object' ? c.pages : {};
  Object.keys(PAGE_ACCESS).forEach(k => { if (PAGE_ACCESS[k].indexOf(pg[k]) > -1) pages[k] = pg[k]; });
  if (c.role === 'admin') Object.keys(pages).forEach(k => { if (ADMIN_TOO.indexOf(k) === -1) delete pages[k]; });
  return { email: email, pages: pages, super: c.super === true, name: String(c.name || email).slice(0, 80), site: c.site, siteName: String(c.siteName || c.site).slice(0, 80), admin: c.role === 'admin', jti: c.jti, exp: c.exp,
    mods: list(c.mods, m => m && /^[a-z]{2,20}$/.test(String(m.key)) ? { key: m.key, name: String(m.name || m.key).slice(0, 40), url: okUrl(m.url) } : null),
    sites: list(c.sites, s => s && /^[A-Z0-9]{1,12}$/.test(String(s.code)) ? { code: s.code, name: String(s.name || s.code).slice(0, 80) } : null) };
}
module.exports = { url, verify, verifyAdmin, AUD, PAGE_ACCESS };
