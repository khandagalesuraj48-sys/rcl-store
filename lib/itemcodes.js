/* THE ITEM CODE – one numbering for all sites (ITM-0001 …: the next after the highest of every site), so no code is ever given twice
 * and the codes already given never change (api/items.js; 28-10-2026 also the old inward register's import, api/work.js). */
'use strict';
const { db, dbAll, registry } = require('./sites');
const enc = encodeURIComponent;
/* the codes given at every site – only for the next Item Code (one numbering for all sites). A site whose Store is not set up
 * or cannot be reached is passed over: a code it gave meanwhile is caught by codeOnce() at the save. */
async function codesAll(site) {
  const sites = (await registry()).filter(x => x.status === 'ready');
  const parts = await Promise.all(sites.map(x => dbAll(x.code, 'items?select=code,created_at', 'code').then(r => (r || []).map(i => Object.assign(i, { site: x.code })))
    .catch(e => { if (x.code === site) throw e; return []; })));
  return [].concat(...parts);
}
const codeNo = c => { const m = /^ITM-(\d+)$/.exec(String(c || '')); return m ? Number(m[1]) : 0; };
const nextCode = (list, k) => 'ITM-' + String(list.reduce((n, i) => Math.max(n, codeNo(i.code)), 0) + 1 + (k || 0)).padStart(4, '0');
/* one numbering for all sites: two sites saving at the same moment could give the same next code – the item just made here then
 * takes the next free one (it is seconds old; nothing refers to it yet) */
async function codeOnce(site, it, have) {
  for (let k = 0; k < 3; k++) {
    const codes = k === 0 && have ? have : await codesAll(site), twin = codes.find(i => i.code === it.code && i.site !== site && String(i.created_at) <= String(it.created_at));
    if (!twin) return it;
    try { it = ((await db(site, 'PATCH', 'items?code=eq.' + enc(it.code), { code: nextCode(codes) }, 'return=representation')) || [])[0] || it; } catch (e) { if (!(e && e.code === 'duplicate')) throw e; }
  }
  return it;
}

module.exports = { codesAll, codeNo, nextCode, codeOnce };
