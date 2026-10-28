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
const { guard } = require('./preview');      // (20-10-2026) a Preview works only with the test database
const sleep = ms => new Promise(r => setTimeout(r, ms));

function homeConf() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, ''), key = String(process.env.SUPABASE_SECRET_KEY || '');
  if (!url || !key) throw fail(500, 'The Store server is not set up: add SUPABASE_URL and SUPABASE_SECRET_KEY (the first site\'s – the same as in Mechanical) in Vercel → Environment Variables, then Redeploy.', 'setup');
  return { url, key };
}
/* one REST call to a database (3 tries on a network fault or a busy database).
 * (24-10-2026, Mechanical's update-155 – the audit's R3) A read, a change (PATCH – it sets values) and a delete are asked again as
 * before: done twice, they leave the same. A NEW ROW (POST) is sent again only when the database said it did not do it (503 – not
 * reachable, 429 – too busy) or when it never left this server (no connection): after no answer at all it may have been done, so
 * it is not sent a second time – the person is told to look at the list first (no item twice, no false "DUPLICATE"). */
// (update-155) the request never left this server (no connection, the name not found): sent again, as before – nothing can have been done
const NOT_SENT = /^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT)$/;
const notSent = e => { const c = (e && e.cause) || e || {}, list = Array.isArray(c.errors) && c.errors.length ? c.errors : [c]; return list.every(x => NOT_SENT.test(String((x && x.code) || ''))); };
async function rest(c, method, path, body, prefer, what, headers) {
  await guard(c);
  const write = method === 'POST' && !/merge-duplicates/.test(String(prefer || ''));      // (an upsert is the same done twice)
  let last = '';
  for (let i = 0; i < 3; i++) {
    let r;
    try {
      r = await fetch(c.url + '/rest/v1/' + path, { method, headers: Object.assign({ apikey: c.key, 'Content-Type': 'application/json' }, prefer ? { Prefer: prefer } : {}, headers || {}),
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    } catch (e) {
      last = String((e && e.message) || e);
      if (write && !notSent(e)) throw fail(503, 'No answer from the database (' + what + ') – it may or may not have been saved: refresh the list and look before you try again.', 'net');
      await sleep(300 * (i + 1)); continue;
    }
    const t = await r.text();
    if (r.ok) return t ? JSON.parse(t) : null;
    last = r.status + ' ' + t.slice(0, 300);
    if (r.status === 503 || r.status === 429 || (!write && r.status >= 500)) { await sleep(400 * (i + 1)); continue; }
    if ((r.status === 404 || r.status === 400) && /PGRST205|42P01|Could not find the table/i.test(t)) throw fail(500, 'NOT_INSTALLED', 'notinstalled');
    if (/23505|duplicate key/.test(t)) throw fail(409, 'This already exists.', 'duplicate');
    // (step 2, the Store's work) a rule of a save inside the database said no (store_*_put: "STORE_SHORT code|date|balance" …) – told as it is
    const rule = /"message"\s*:\s*"(STORE_[A-Z_]+[^"]*)"/.exec(t);
    if (rule) throw fail(409, rule[1], 'rule');
    if (/PGRST202|Could not find the function/i.test(t)) throw fail(500, 'NOT_INSTALLED', 'notinstalled');
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
/* (24-10-2026, the audit's R4) EVERY ROW of a read, page by page: the database's web layer gives at most 1,000 rows to one question
 * (Supabase's "Max rows"), so "limit=100000" stopped at 1,000 items without a word – a longer list was cut, and a new Item Code could
 * be one already given. Pages of 1,000 in the order of [key] (keyset: "after the last one"), until a page comes back short. */
async function dbAll(site, path, key) {
  const c = await conf(site), out = [], k = key || 'code';
  let after = null;
  for (let n = 0; n < 1000; n++) {
    const page = (await rest(c, 'GET', path + '&order=' + k + '.asc&limit=1000' + (after === null ? '' : '&' + k + '=gt.' + encodeURIComponent(after)), undefined, undefined, 'site ' + c.code)) || [];
    out.push(...page);
    if (page.length < 1000) return out;
    after = page[page.length - 1][k];
  }
  return out;
}
const forget = () => { REG = { at: 0, rows: null }; };
module.exports = { db, dbAll, conf, registry, forget, envKeyName, _rest: rest };      // (_rest: for the unit test only)
