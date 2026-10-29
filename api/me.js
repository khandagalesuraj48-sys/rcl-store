/* GET /api/me – who is signed in here (and the Portal's address, also when nobody is: the page then goes there). */
'use strict';
const { handler, send } = require('../lib/http');
const portal = require('../lib/portal');
const ses = require('../lib/session');
const { isPreview } = require('../lib/preview');
const { db } = require('../lib/sites');
const W = require('../lib/work');
/* (28-10-2026) one who approves the site's purchase orders sees its Purchase Orders page (as one who approves requirements);
 * (29-10-2026) one who VERIFIES or APPROVES a work of the site (the Super Admin's workflow in the Portal) sees its page – Requirements,
 * Purchase Orders, Inward (GRN), Issue & Return – to verify or approve it there, even when that page is not given to him (View). */
function pagesFor(s, set) {
  const e = String(s.email).toLowerCase(), wf = W.wfOf(set), add = {};
  if (W.levelsOf(set).some(l => l.people.some(p => p.email === e)) || W.isIn(wf.verify.req, e)) add.req = 'View';
  if (W.poApprovers(set).some(p => p.email === e) || W.isIn(wf.verify.po, e)) add.po = 'View';
  if (W.isIn(wf.verify.grn, e) || W.isIn(wf.approve.grn, e)) add.grn = 'View';
  if (W.isIn(wf.verify.iss, e) || W.isIn(wf.approve.iss, e)) add.issue = 'View';
  const out = Object.assign({}, s.pages);
  Object.keys(add).forEach(k => { if (!out[k] || out[k] === 'None') out[k] = add[k]; });
  return out;
}
module.exports = handler(async (req, res) => {
  const s = await ses.read(req);
  if (!s) return send(res, 200, { signedIn: false, portal: portal.url(), preview: isPreview() || undefined });
  let pages = s.pages;
  if (!s.admin) { try { const r = ((await db(s.site, 'GET', 'store_settings?select=value&id=eq.approvers')) || [])[0]; pages = pagesFor(s, r ? r.value : null); } catch (e) { /* as given */ } }
  send(res, 200, { signedIn: true, preview: isPreview() || undefined, user: { email: s.email, name: s.name, admin: s.admin, super: s.super || undefined }, pages: pages, site: s.site, siteName: s.info.siteName || s.site, mods: s.info.mods || [], sites: s.info.sites || [], portal: portal.url() });
});
module.exports.pagesFor = pagesFor;      // (for the unit test – 29-10-2026)
