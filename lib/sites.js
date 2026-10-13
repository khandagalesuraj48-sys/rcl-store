/* WHICH DATABASE IS A SITE'S. One site = one database (one Supabase project) with every module of that site in it; the
 * Store's tables sit next to Mechanical's. The list of sites is the one Mechanical keeps in the FIRST site's database
 * (public.rcl_sites – Mechanical's step 7), read here with the first site's settings:
 *   SUPABASE_URL, SUPABASE_SECRET_KEY   – the first site (VTR): the same values as in the Mechanical project in Vercel
 *   SITE_<CODE>_KEY                    – another site's secret key (e.g. SITE_18B_KEY), the same as in Mechanical
 *   RCL_SITES_KEY                      – only for a site whose key is kept locked in the list (Mechanical's update-90)
 * The list is kept in this server's memory for 15 seconds. Nothing of a key is ever written anywhere by this module. */
'use strict';
const crypto = require('crypto');
const { fail } = require('./http');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function homeConf() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, ''), key = String(process.env.SUPABASE_SECRET_KEY || '');
  if (!url || !key) throw fail(500, 'The Store server is not set up: add SUPABASE_URL and SUPABASE_SECRET_KEY (the first site\'s – the same as in Mechanical) in Vercel → Environment Variables, then Redeploy.', 'setup');
  return { url, key };
}
// one REST call to a database (3 tries on a network fault or a busy database)
async function rest(c, method, path, body, prefer, what) {
  let last = '';
  for (let i = 0; i < 3; i++) {
    let r;
    try {
      r = await fetch(c.url + '/rest/v1/' + path, { method, headers: Object.assign({ apikey: c.key, 'Content-Type': 'application/json' }, prefer ? { Prefer: prefer } : {}),
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    } catch (e) { last = String((e && e.message) || e); await sleep(300 * (i + 1)); continue; }
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : null;
    last = r.status + ' ' + t.slice(0, 300);
    if (r.status >= 500 || r.status === 429) { await sleep(400 * (i + 1)); continue; }
    if ((r.status === 404 || r.status === 400) && /PGRST205|42P01|Could not find the table/i.test(t)) throw fail(500, 'NOT_INSTALLED', 'notinstalled');
    if (/23505|duplicate key/.test(t)) throw fail(409, 'This already exists.', 'duplicate');
    if (r.status === 401 || r.status === 403) throw fail(500, 'The database of ' + what + ' refused the key – check its key in Vercel.', 'key');
    throw fail(500, 'Database (' + what + '): ' + last);
  }
  throw fail(503, 'Could not reach the database (' + what + ') – please try again in a moment.', 'net');
}

/* ---------- the lock on a site's key kept in the list (Mechanical's update-90 – the same lock) ---------- */
function open(sealed) {
  const k0 = String(process.env.RCL_SITES_KEY || '');
  if (k0.length < 24) throw fail(500, 'This site cannot be opened: the Store server has no RCL_SITES_KEY (Vercel).', 'key');
  const k = crypto.createHash('sha256').update('rcl-sites|' + k0).digest(), s = String(sealed || '');
  if (!/^v1\./.test(s)) throw fail(500, 'This site cannot be opened: its database key is not kept the right way.', 'key');
  const b = Buffer.from(s.slice(3), 'base64url');
  try { const d = crypto.createDecipheriv('aes-256-gcm', k, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); }
  catch (e) { throw fail(500, 'This site cannot be opened: its key does not match RCL_SITES_KEY.', 'key'); }
}
const envKeyName = c => 'SITE_' + String(c || '').toUpperCase() + '_KEY';

let REG = { at: 0, rows: null };
async function registry() {
  if (REG.rows && Date.now() - REG.at < 15000) return REG.rows;
  const rows = await rest(homeConf(), 'GET', 'rcl_sites?select=code,name,home,status,db_url,db_key_enc&order=sort.asc,code.asc', undefined, undefined, 'sites');
  REG = { at: Date.now(), rows: rows || [] };
  return REG.rows;
}
// a site's database: { code, name, url, key } – only a site that is ready
async function conf(code) {
  const c = String(code || '').toUpperCase();
  if (!/^[A-Z0-9]{1,12}$/.test(c)) throw fail(400, 'No proper site.', 'site');
  const x = (await registry()).find(y => y.code === c);
  if (!x || x.status !== 'ready') throw fail(400, 'This site is not set up (' + c + ').', 'site');
  if (x.home) return Object.assign({ code: c, name: x.name || c }, homeConf());
  const key = x.db_key_enc ? open(x.db_key_enc) : String(process.env[envKeyName(c)] || '').trim();
  if (!x.db_url || !key) throw fail(500, 'The Store server has no key for site ' + c + ': add ' + envKeyName(c) + ' (the same as in Mechanical) in Vercel → Environment Variables, then Redeploy.', 'key');
  return { code: c, name: x.name || c, url: String(x.db_url).replace(/\/+$/, ''), key: key };
}
// one call to a site's database
async function db(site, method, path, body, prefer) { const c = await conf(site); return rest(c, method, path, body, prefer, 'site ' + c.code); }
const forget = () => { REG = { at: 0, rows: null }; };
module.exports = { db, conf, registry, forget, envKeyName };
