/* POST /api/portal { ticket } – THE SUPER ADMIN'S CONSOLE (the Portal's server) tells the Store of a site who approves its Material
 * Requirements, level by level (1 to 5; any one person of a level approves). Given in the Portal: Users & Access → a person → Pages
 * → Store → "Approves requirements" (step 2, 28-10-2026). The ticket is signed by the Portal (aud "store-admin", 60 s), checked
 * with the Portal's public key and used ONCE (its number in the site's store_tickets) – lib/portal.js verifyAdmin.
 * Kept in the site's own database: store_settings 'approvers'. A requirement waiting at a level then waits for the new people.
 * (28-10-2026) also who approves the site's purchase orders ("Approves purchase orders") – its key po.
 * (29-10-2026) and the site's WORKFLOW – who verifies each work, who approves the GRN and the issues, what goes to Head Office (its key
 * wf; lib/work.js wfOf). The answer says whether the site's database has the Store's step 9 (the verification of POs, GRNs and issues
 * needs it) – the Portal tells the Super Admin. */
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
  // (28-10-2026) who approves its purchase orders – kept as it was when the Portal sends none (a Portal of before); (29-10-2026) its workflow too
  let po = c.po, wf = c.wf, was = null;
  if (po === null || wf === null) { try { const r = ((await db(c.site, 'GET', 'store_settings?select=value&id=eq.approvers')) || [])[0]; was = r && r.value && typeof r.value === 'object' ? r.value : null; } catch (e) { was = null; } }
  if (po === null) po = was && Array.isArray(was.po) ? was.po : [];
  if (wf === null) wf = was && was.wf && typeof was.wf === 'object' ? was.wf : undefined;
  const value = Object.assign({ levels: c.levels, po: po }, wf ? { wf: wf } : {}, { by: c.by, at: new Date().toISOString() });
  try { await db(c.site, 'POST', 'store_settings', [{ id: 'approvers', value: value, updated_by: c.by }], 'resolution=merge-duplicates,return=minimal'); }
  catch (e) { if (e && e.code === 'notinstalled') throw fail(500, 'The Store\'s step 2 is not run in the database of site ' + c.site + ' yet: run sql/store_step2_work.sql once in that site\'s Supabase → SQL Editor.', 'notinstalled'); throw e; }
  const names = l => (l || []).map(p => p.name || p.email);
  await activity(c.site, c.by, 'Approvers set', c.site, Object.assign({ levels: c.levels.map(l => 'Level ' + l.level + ': ' + l.people.map(p => p.name || p.email).join(', ')), po: names(po) },
    wf ? { verify: { req: names(wf.verify.req), po: names(wf.verify.po), grn: names(wf.verify.grn), iss: names(wf.verify.iss) }, approve: { grn: names(wf.approve.grn), iss: names(wf.approve.iss) },
      ho: Object.keys(wf.ho).filter(k => wf.ho[k]) } : {}));
  // (29-10-2026) the Store's step 9 at this site? (the verification of POs, GRNs and issues needs it)
  let step9 = false; try { await db(c.site, 'GET', 'store_grn?select=wf&limit=1'); step9 = true; } catch (e) { step9 = false; }
  send(res, 200, { ok: true, site: c.site, levels: c.levels.length, po: po.length, step9: step9 });
});
