'use strict';
const { db } = require('./sites');
// who did what in the Store – written into the site's own database (never stops the work it records)
async function activity(site, email, action, target, detail) {
  try { await db(site, 'POST', 'store_activity', [{ email: email, action: action, target: String(target || '').slice(0, 200), detail: detail || null }], 'return=minimal'); }
  catch (e) { console.error('[store activity] ' + String((e && e.message) || e)); }
}
module.exports = { activity };
