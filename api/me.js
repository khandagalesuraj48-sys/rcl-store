/* GET /api/me – who is signed in here (and the Portal's address, also when nobody is: the page then goes there). */
'use strict';
const { handler, send } = require('../lib/http');
const portal = require('../lib/portal');
const ses = require('../lib/session');
module.exports = handler(async (req, res) => {
  const s = await ses.read(req);
  if (!s) return send(res, 200, { signedIn: false, portal: portal.url() });
  send(res, 200, { signedIn: true, user: { email: s.email, name: s.name, admin: s.admin }, pages: s.pages, site: s.site, siteName: s.info.siteName || s.site, mods: s.info.mods || [], sites: s.info.sites || [], portal: portal.url() });
});
