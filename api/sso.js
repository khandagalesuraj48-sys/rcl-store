/* POST /api/sso { ticket } – the Portal sent the person here: the ticket is checked (lib/portal.js), used ONCE (its number is
 * written into the site's store_tickets), and a Store sign-in for that site starts.
 * { ticket, renew: 1 } (23-10-2026): the open page's fresh ticket every 10 minutes – the sign-in it had is replaced (its row goes);
 * the same person on the same site is not written in the activity record again. */
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
  let old = null; try { old = await ses.read(req); } catch (e) { old = null; }
  const cookie = await ses.create(req, c);
  if (old) { try { await db(old.site, 'DELETE', 'store_sessions?id_hash=eq.' + old.idHash, undefined, 'return=minimal'); } catch (e) { /* it ends by itself in 15 minutes */ } }
  const again = !!x.renew && !!old && old.site === c.site && String(old.email).toLowerCase() === String(c.email).toLowerCase() && old.admin === !!c.admin;
  /* (29-10-2026) the papers' heading the Portal sent (the site's company, its address and contact) – kept in the site's settings when it
   * changed, for HO Purchase's papers of this site (another site's sign-in); not kept (no step 2 yet, a moment's fault): nothing lost –
   * the next sign-in keeps it */
  if (c.paper) {
    try {
      const was = ((await db(c.site, 'GET', 'store_settings?select=value&id=eq.portal_paper')) || [])[0];
      if (!was || JSON.stringify(was.value) !== JSON.stringify(c.paper)) await db(c.site, 'POST', 'store_settings?on_conflict=id', [{ id: 'portal_paper', value: c.paper, updated_by: 'Portal' }], 'resolution=merge-duplicates,return=minimal');
    } catch (e) { /* kept at the next sign-in */ }
  }
  if (!again) await activity(c.site, c.email, 'Sign-in', c.site, { admin: c.admin });
  send(res, 200, { ok: true, preview: isPreview() || undefined, user: { email: c.email, name: c.name, admin: c.admin, super: c.super || undefined }, pages: ses.pagesOf(c.admin, c.pages), site: c.site, siteName: c.siteName, mods: c.mods, sites: c.sites, portal: portal.url() }, { 'Set-Cookie': cookie });
});
