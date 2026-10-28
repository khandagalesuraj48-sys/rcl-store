/* GET /api/me – who is signed in here (and the Portal's address, also when nobody is: the page then goes there). */
'use strict';
const { handler, send } = require('../lib/http');
const portal = require('../lib/portal');
const ses = require('../lib/session');
const { isPreview } = require('../lib/preview');
const { db } = require('../lib/sites');
const W = require('../lib/work');
module.exports = handler(async (req, res) => {
  const s = await ses.read(req);
  if (!s) return send(res, 200, { signedIn: false, portal: portal.url(), preview: isPreview() || undefined });
  // (28-10-2026) one who approves the site's purchase orders sees its Purchase Orders page (as one who approves requirements)
  let pages = s.pages;
  if (!s.admin && (pages || {}).po !== 'View') {
    try { const r = ((await db(s.site, 'GET', 'store_settings?select=value&id=eq.approvers')) || [])[0]; if (W.poApprovers(r ? r.value : null).some(p => p.email === String(s.email).toLowerCase())) pages = Object.assign({}, pages, { po: 'View' }); } catch (e) { /* as given */ }
  }
  send(res, 200, { signedIn: true, preview: isPreview() || undefined, user: { email: s.email, name: s.name, admin: s.admin, super: s.super || undefined }, pages: pages, site: s.site, siteName: s.info.siteName || s.site, mods: s.info.mods || [], sites: s.info.sites || [], portal: portal.url() });
});
