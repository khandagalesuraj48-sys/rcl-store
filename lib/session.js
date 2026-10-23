/* SIGN-INS of the Store – one per site (a person on two sites opens each through the Portal). The browser keeps a random
 * sign-in in a cookie page scripts cannot read (HttpOnly, SameSite=Lax): "<SITE>.<random>". The site's database keeps only
 * its fingerprint (SHA-256) with who, Admin or User (as the Portal said) and when it ends – or at "Sign out".
 * (23-10-2026, his yes: "ata je approval deych aahe te pr tri de") A sign-in lasts 15 MINUTES, no longer 12 hours: the open page
 * asks the Portal for a fresh ticket every 10 minutes and signs in again with it (api/sso, renew). Whom the Super Admin removed
 * in the Portal – or changed from Admin to User – gets no ticket, or the new role, so he is out of the Store within 15 minutes. */
'use strict';
const crypto = require('crypto');
const { db } = require('./sites');
const { fail } = require('./http');
const COOKIE = 'rcl_store', MAX_MS = 15 * 60 * 1000;
const fp = t => crypto.createHash('sha256').update(String(t)).digest('hex');
function cookieOf(req) {
  const c = String(req.headers.cookie || ''); const m = c.split(/;\s*/).map(x => x.split('=')).find(x => x[0] === COOKIE);
  return m ? decodeURIComponent(m.slice(1).join('=')) : '';
}
const secure = req => String(req.headers['x-forwarded-proto'] || '') === 'https' || !!process.env.VERCEL;
const setCookie = (req, v, maxAgeS) => COOKIE + '=' + encodeURIComponent(v) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAgeS + (secure(req) ? '; Secure' : '');
const clearCookie = req => setCookie(req, '', 0);

async function create(req, x) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db(x.site, 'POST', 'store_sessions', [{ id_hash: fp(token), email: x.email, name: x.name, is_admin: !!x.admin, expires_at: new Date(Date.now() + MAX_MS).toISOString(), info: { mods: x.mods, sites: x.sites, siteName: x.siteName, pages: x.pages || {} } }], 'return=minimal');
  return setCookie(req, x.site + '.' + token, Math.floor(MAX_MS / 1000));
}
async function read(req) {
  const v = cookieOf(req), m = /^([A-Z0-9]{1,12})\.([A-Za-z0-9_-]{30,})$/.exec(v);
  if (!m) return null;
  let s = null;
  try { s = ((await db(m[1], 'GET', 'store_sessions?select=id_hash,email,name,is_admin,expires_at,info&id_hash=eq.' + fp(m[2]))) || [])[0]; }
  catch (e) { if (e && (e.code === 'site' || e.code === 'notinstalled')) return null; throw e; }
  if (!s) return null;
  if (Date.parse(s.expires_at) <= Date.now()) { await db(m[1], 'DELETE', 'store_sessions?id_hash=eq.' + s.id_hash, undefined, 'return=minimal'); return null; }
  const info = s.info || {};
  return { site: m[1], idHash: s.id_hash, email: s.email, name: s.name, admin: !!s.is_admin, info: info, pages: pagesOf(!!s.is_admin, info.pages) };
}
// what a person may do on each page: the Store Admin everything; a User as the Portal gave (a page not given = as before)
function pagesOf(admin, p) {
  p = p && typeof p === 'object' ? p : {};
  return { dashboard: admin ? 'View' : (p.dashboard === 'None' ? 'None' : 'View'), items: admin ? 'Edit' : (['Edit', 'View', 'None'].indexOf(p.items) > -1 ? p.items : 'Edit') };
}
async function need(req) { const s = await read(req); if (!s) throw fail(401, 'SESSION_EXPIRED', 'session'); return s; }
async function end(req) { const s = await read(req); if (s) await db(s.site, 'DELETE', 'store_sessions?id_hash=eq.' + s.idHash, undefined, 'return=minimal'); }
module.exports = { create, read, need, end, clearCookie, pagesOf };
