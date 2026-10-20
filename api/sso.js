/* POST /api/sso { ticket } – the Portal sent the person here: the ticket is checked (lib/portal.js), used ONCE (its number is
 * written into the site's store_tickets), and a Store sign-in for that site starts. */
'use strict';
const { handler, readBody, send, sameSite, fail } = require('../lib/http');
const { isPreview } = require('../lib/preview');
const portal = require('../lib/portal');
const { db } = require('../lib/sites');
const ses = require('../lib/session');
const { activity } = require('../lib/activity');

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
  sameSite(req);
  const x = await readBody(req), c = await portal.verify(x.ticket);
  try { await db(c.site, 'POST', 'store_tickets', [{ jti: c.jti, expires_at: new Date((c.exp + 300) * 1000).toISOString() }], 'return=minimal'); }
  catch (e) {
    if (e && e.code === 'duplicate') throw fail(401, 'The Portal sign-in could not be accepted (this ticket was already used) – open the Store again from the Portal.', 'ticket');
    if (e && e.code === 'notinstalled') throw fail(500, 'The Store is not set up in the database of site ' + c.site + ' yet: run sql/store_step1_items.sql once in that site\'s Supabase → SQL Editor.', 'notinstalled');
    throw e;
  }
  if (Math.random() < 0.05) { const old = new Date(Date.now() - 86400000).toISOString(); db(c.site, 'DELETE', 'store_tickets?expires_at=lt.' + old, undefined, 'return=minimal').catch(() => {}); db(c.site, 'DELETE', 'store_sessions?expires_at=lt.' + old, undefined, 'return=minimal').catch(() => {}); }
  const cookie = await ses.create(req, c);
  await activity(c.site, c.email, 'Sign-in', c.site, { admin: c.admin });
  send(res, 200, { ok: true, preview: isPreview() || undefined, user: { email: c.email, name: c.name, admin: c.admin }, pages: ses.pagesOf(c.admin, c.pages), site: c.site, siteName: c.siteName, mods: c.mods, sites: c.sites, portal: portal.url() }, { 'Set-Cookie': cookie });
});
