/* POST /api/purinbox – (09-11-2026, Purchase Phase 1) PURCHASE'S INBOX: the approved Material Requirement lines of the asked sites
 * still to order – the SAME figures as HO Purchase's own list here (ACTIONS.purPending of api/work.js, used as it is: nothing of the
 * Store's pages changes). A site's requirements stay in that site's own database; Purchase only asks. It answers ONLY Purchase's
 * server (rcl-purchase lib/storelink.js), never a browser:
 *   { v: 1, ts, nonce, sites: ['S1', …], sig }   sig = HMAC-SHA256 with PUR_STORE_SECRET of "rcl-pur-store|v1|<ts>|<nonce>|<sites,>"
 *   – PUR_STORE_SECRET: the same long secret word in the Store's and Purchase's Vercel projects (never in a file). Not set: 503 and
 *     nothing else;
 *   – ts: Purchase's clock, at most 5 minutes off; nonce: 32 hex, used ONCE (noted with the Portal's used tickets of the first site –
 *     store_tickets "pur-<nonce>"; no database step);
 *   → { sites: [{ site, name, reqs: [{ no, ref, date, need_by, for_kind, for_text, remark, since, made_by, lines: [{ line, code, name,
 *       unit, qty, ordered, left, brand, spec, note }] }], own?, error? }], today }
 *     own: the site buys its requirements itself (Portal → Workflow) – as in HO Purchase's list, none of them is given.
 * It only reads (and notes the nonce). Written fresh for RCL. */
'use strict';
const crypto = require('crypto');
const { handler, readBody, send, fail } = require('../lib/http');
const { db, registry } = require('../lib/sites');

const WINDOW = 5 * 60 * 1000;
const secret = () => String(process.env.PUR_STORE_SECRET || '').trim();      // (a newline pasted with the value in Vercel is not part of it)
const NOT_SET = 'Purchase\'s link to the Store is not set up here (PUR_STORE_SECRET in Vercel – the same as in the Purchase project).';
const textOf = (ts, nonce, sites) => ['rcl-pur-store', 'v1', ts, nonce, sites.join(',')].join('|');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
/* the question checked (no database): the secret set, its parts, its signature, its time → { ts, nonce, sites } */
function check(x, key, now) {
  if (String(key || '').length < 24) throw fail(503, NOT_SET, 'setup');
  x = x || {};
  const ts = Number(x.ts), nonce = String(x.nonce || ''), sites = Array.isArray(x.sites) ? x.sites.map(String) : null;
  if (x.v !== 1 || !Number.isSafeInteger(ts) || !/^[0-9a-f]{32}$/.test(nonce) || !sites || !sites.length || sites.length > 40 || !sites.every(c => /^[A-Z0-9]{1,12}$/.test(c)) ||
    new Set(sites).size !== sites.length || !/^[0-9a-f]{64}$/.test(String(x.sig || ''))) throw fail(400, 'Not a proper question.', 'shape');
  const want = crypto.createHmac('sha256', String(key)).update(textOf(ts, nonce, sites)).digest('hex');
  if (!same(x.sig, want)) throw fail(401, 'Refused (the signature does not match).', 'sig');
  if (Math.abs((now || Date.now()) - ts) > WINDOW) throw fail(401, 'Refused (its time is more than 5 minutes off – check the clock).', 'time');
  return { ts: ts, nonce: nonce, sites: sites };
}
// the nonce used ONCE: noted in the first site's store_tickets (where the Portal's used tickets are) – a second time is refused
async function once(nonce, ts) {
  const home = (await registry()).find(y => y.home);
  if (!home) throw fail(500, 'The Store has no first site in the list of sites.', 'setup');
  try { await db(home.code, 'POST', 'store_tickets', [{ jti: 'pur-' + nonce, expires_at: new Date(ts + 2 * WINDOW).toISOString() }], 'return=minimal'); }
  catch (e) { if (e && e.code === 'duplicate') throw fail(401, 'Refused (this question was used already).', 'nonce'); throw e; }
}
// HO Purchase's list, asked as HO Purchase ("Store Purchase" – every site); only after the question is checked
const SVC = Object.freeze({ email: '', name: 'Purchase', site: '', admin: false, super: false, pages: Object.freeze({ purchase: 'Edit' }), info: Object.freeze({}) });
const pick = r => ({ no: r.no, ref: r.ref, date: r.date, need_by: r.need_by || null, for_kind: r.for_kind || '', for_text: r.for_text || '', remark: r.remark || '', since: r.since || '', made_by: r.made_by || '',
  lines: (r.lines || []).map(l => ({ line: l.line, code: l.code, name: l.name, unit: l.unit, qty: l.qty, ordered: l.ordered, left: l.left, brand: l.brand || '', spec: l.spec || '', note: l.note || '' })) });

module.exports = handler(async (req, res) => {
  const key = secret();
  if (key.length < 24) throw fail(503, NOT_SET, 'setup');
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
  const q = check(await readBody(req), key, Date.now());
  await once(q.nonce, q.ts);
  const all = await require('./work.js').ACTIONS.purPending(SVC, {});
  const by = new Map((all.sites || []).map(st => [st.site, st]));
  send(res, 200, { today: all.today, sites: q.sites.map(c => {
    const st = by.get(c);
    if (!st) return { site: c, name: c, reqs: [], error: 'No Store at this site.' };
    return Object.assign({ site: st.site, name: st.name, reqs: (st.reqs || []).map(pick) }, st.own ? { own: true } : {}, st.error ? { error: st.error } : {});
  }) });
});
module.exports.check = check;      // (for the unit test)
module.exports.textOf = textOf;
module.exports.SVC = SVC;
