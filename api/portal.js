/* POST /api/portal { ticket } – THE SUPER ADMIN'S CONSOLE (the Portal's server) tells the Store of a site who approves its Material
 * Requirements, level by level (1 to 5; any one person of a level approves). Given in the Portal: Users & Access → a person → Pages
 * → Store → "Approves requirements" (step 2, 28-10-2026). The ticket is signed by the Portal (aud "store-admin", 60 s), checked
 * with the Portal's public key and used ONCE (its number in the site's store_tickets) – lib/portal.js verifyAdmin.
 * Kept in the site's own database: store_settings 'approvers'. A requirement waiting at a level then waits for the new people. */
'use strict';
const { handler, readBody, send, fail } = require('../lib/http');
const portal = require('../lib/portal');
const { db } = require('../lib/sites');
const { activity } = require('../lib/activity');

module.exports = handler(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' });
  const x = await readBody(req), c = await portal.verifyAdmin(x.ticket);
  try { await db(c.site, 'POST', 'store_tickets', [{ jti: c.jti, expires_at: new Date((c.exp + 300) * 1000).toISOString() }], 'return=minimal'); }
  catch (e) {
    if (e && e.code === 'duplicate') throw fail(401, 'This ticket was already used.', 'ticket');
    if (e && e.code === 'notinstalled') throw fail(500, 'The Store is not set up in the database of site ' + c.site + ' yet: run sql/store_step1_items.sql and sql/store_step2_work.sql once in that site\'s Supabase → SQL Editor.', 'notinstalled');
    throw e;
  }
  const value = { levels: c.levels, by: c.by, at: new Date().toISOString() };
  try { await db(c.site, 'POST', 'store_settings', [{ id: 'approvers', value: value, updated_by: c.by }], 'resolution=merge-duplicates,return=minimal'); }
  catch (e) { if (e && e.code === 'notinstalled') throw fail(500, 'The Store\'s step 2 is not run in the database of site ' + c.site + ' yet: run sql/store_step2_work.sql once in that site\'s Supabase → SQL Editor.', 'notinstalled'); throw e; }
  await activity(c.site, c.by, 'Approvers set', c.site, { levels: c.levels.map(l => 'Level ' + l.level + ': ' + l.people.map(p => p.name || p.email).join(', ')) });
  send(res, 200, { ok: true, site: c.site, levels: c.levels.length });
});
