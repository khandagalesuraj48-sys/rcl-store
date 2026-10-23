/* (23-10-2026, his yes: "ata je approval deych aahe te pr tri de") A Store sign-in lasts 15 MINUTES; the open page keeps it fresh
 * with a fresh Portal ticket every 10 minutes. Whom the Super Admin removes in the Portal is out within 15 minutes; a new role
 * shows by itself. On the rig in one-address mode (never live):
 *   GATEWAY=1 PORTAL=1 bash /home/claude/rig/all.sh        then        timeout 300 node test/renew.test.js
 * The page's clock is moved on by 11 minutes to make the 10-minute renewal come at once. The Portal's rows are put back at the end. */
'use strict';
const M = '/home/claude/test/node_modules/';
const chromium = require(M + '@sparticuz/chromium').default || require(M + '@sparticuz/chromium'); const puppeteer = require(M + 'puppeteer-core');
const { execSync } = require('child_process');
const wait = ms => new Promise(r => setTimeout(r, ms));
const G = 'http://127.0.0.1:3030', WHO = 'sujit@rcl.test';
const out = []; let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 500) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < (ms || 20000)) { try { const v = await fn(); if (v) return v; } catch (e) { /* changing */ } await wait(300); } return null; };
const sess = () => sql('rcl', "select coalesce(string_agg(id_hash || '|' || is_admin || '|' || round(extract(epoch from expires_at - now())), ',' order by created_at), '') from public.store_sessions where email = '" + WHO + "'");
const signIns = () => Number(sql('rcl', "select count(*) from public.store_activity where email = '" + WHO + "' and action = 'Sign-in'"));
const opened = () => Number(sql('rcl_portal', "select count(*) from audit where action = 'Opened module' and target like 'store%'") || 0);
(async () => {
  const before = sql('rcl_portal', "select key || '|' || coalesce(url, '') from modules where key in ('mechanical', 'store') order by key");
  sql('rcl_portal', "update modules set url = '" + G + "' where key = 'mechanical'; update modules set url = '" + G + "/store', status = 'live' where key = 'store'; " +
    "delete from access where module = 'store' and email = '" + WHO + "'; insert into access (email, site, module, role, granted_by) values ('" + WHO + "', 'S1', 'store', 'admin', 'test'); delete from counters; update users set start_item = null where email = '" + WHO + "';");
  sql('rcl', "truncate public.store_sessions, public.store_tickets, public.store_activity; delete from web.cache where key like 'F\\_%' or key like 'LG\\_%';");
  const b = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox'], headless: 'shell', protocolTimeout: 120000 });
  const errs = [];
  const st = p => p.frames().find(x => /\/store\//.test(x.url()));
  // the page's clock moved on (the renewal comes when 10 minutes have gone by) and the page "comes back" (visibilitychange)
  const later = (p, min) => st(p).evaluate(m => { if (!window.__real) { window.__real = Date.now; window.__off = 0; Date.now = () => window.__real() + window.__off; } window.__off += m * 60000; document.dispatchEvent(new Event('visibilitychange')); }, min);
  try {
    const ctx = await b.createBrowserContext(), p = await ctx.newPage();
    await ctx.overridePermissions(G, ['geolocation']); await p.setGeolocation({ latitude: 19.997453, longitude: 73.789802, accuracy: 20 });      // (Mechanical opens only with the location on)
    p.on('pageerror', e => errs.push(String(e.message).slice(0, 200))); await p.setViewport({ width: 1440, height: 900 });
    await p.goto(G + '/portal/', { waitUntil: 'load' });
    await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'l_email', { timeout: 20000 });
    await p.type('#l_email', WHO); await p.type('#l_pass', 'Nashik#Road848!'); await p.click('#l_btn');
    await until(() => p.evaluate(() => !document.getElementById('v_home').hidden && document.querySelectorAll('#h_sites a.mod').length));
    await p.evaluate(() => [...document.querySelectorAll('#h_sites a.mod')].find(a => /module=store&site=S1/.test(a.getAttribute('href'))).click());
    const in1 = await until(async () => { const f = st(p); return f && await f.evaluate(() => !document.getElementById('v_app').hidden && document.getElementById('u_role').textContent); }, 60000);
    const s1 = sess(), age = Number((s1.split('|')[2] || '0'));
    ok('the Store opens signed in (Store Admin); its sign-in lasts 15 minutes, not 12 hours', /Store Admin/.test(in1 || '') && s1.split(',').length === 1 && age > 840 && age <= 905, [in1, s1]);
    const a0 = signIns(), o0 = opened();
    // ---- 10 minutes later: a fresh ticket, a new sign-in, the old one gone; nothing new in the activity records ----
    await later(p, 11);
    const s2 = await until(() => { const v = sess(); return v && v.split('|')[0] !== s1.split('|')[0] ? v : null; }, 20000);
    ok('10 minutes later the page signs in again with a fresh Portal ticket: one sign-in, a new one of 15 minutes, the old one gone', !!s2 && s2.split(',').length === 1 && Number(s2.split('|')[2]) > 840, [s1, s2]);
    ok('   not written again: the Store\'s activity record (Sign-in) and the Portal\'s ("Opened module")', signIns() === a0 && opened() === o0, { signIns: [a0, signIns()], opened: [o0, opened()] });
    // ---- the Super Admin makes him a Store User: the next renewal shows it ----
    sql('rcl_portal', "update access set role = 'user' where email = '" + WHO + "' and site = 'S1' and module = 'store';");
    await later(p, 11);
    const r3 = await until(() => st(p).evaluate(() => { const t = document.getElementById('u_role').textContent; return /Store User/.test(t) ? { role: t, adminBtns: [...document.querySelectorAll('[data-admin]')].filter(x => !x.hidden).length } : null; }), 20000);
    ok('made a Store User in the Portal: within the renewal the page says Store User, the Admin\'s buttons go; the sign-in is a User\'s', !!r3 && r3.adminBtns === 0 && /\|false\|/.test(sess()), [r3, sess()]);
    ok('   the change of role is written once in the activity record', signIns() === a0 + 1, signIns());
    // ---- the Super Admin takes the Store away: out at the next renewal ----
    sql('rcl_portal', "delete from access where email = '" + WHO + "' and site = 'S1' and module = 'store';");
    await later(p, 11);
    const r4 = await until(() => st(p).evaluate(() => !document.getElementById('v_start').hidden && document.getElementById('st_msg').textContent), 20000);
    const me = await st(p).evaluate(async () => (await (await fetch('api/me', { credentials: 'same-origin' })).json()));
    ok('the Store taken away in the Portal: at the next renewal the page says "You no longer have the Store on this site"; his Store sign-in is gone', /You no longer have the Store on this site/.test(r4 || '') && sess() === '' && !me.signedIn, [r4, sess(), me]);
    ok('no script error on the page', !errs.length, errs);
  } finally {
    await b.close();
    before.split('\n').filter(Boolean).forEach(l => { const [k, u] = l.split('|'); sql('rcl_portal', "update modules set url = " + (u ? "'" + u + "'" : 'null') + " where key = '" + k + "';"); });
    sql('rcl_portal', "delete from access where module = 'store' and email = '" + WHO + "';");
  }
  console.log(out.join('\n') + '\n\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log(out.join('\n')); console.log('CRASH ' + (e && e.stack || e)); process.exit(1); });
