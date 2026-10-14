/* The Store in the browser, on the local rig (never live): the Portal :3010 → the Store :3020 (and Mechanical :3000).
 *   sign-in through the Portal; Item Master: add, the same name refused, a near name asked ("Sugaar" – Sugar is there),
 *   a proper name suggested; Change site → T2 (its own items only); Mechanical's menu shows the Store; Excel export and
 *   import (checked row by row); a phone.       node test/browser.test.js      (pictures in test/shots/)
 * Uses the Chromium of the rig (/home/claude/test/node_modules). */
'use strict';
const M = '/home/claude/test/node_modules/';
const chromium = require(M + '@sparticuz/chromium').default || require(M + '@sparticuz/chromium'); const puppeteer = require(M + 'puppeteer-core');
const { execSync } = require('child_process'), fs = require('fs'), path = require('path');
const wait = ms => new Promise(r => setTimeout(r, ms));
const P = 'http://127.0.0.1:3010', ST = 'http://127.0.0.1:3020', MECH = 'http://127.0.0.1:3000';
const SHOTS = path.join(__dirname, 'shots'), DL = path.join(SHOTS, 'dl'); fs.mkdirSync(DL, { recursive: true });
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 400) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < (ms || 20000)) { try { const v = await fn(); if (v) return v; } catch (e) { /* changing */ } await wait(300); } return null; };

(async () => {
  sql('rcl_portal', "insert into modules (key, name, url, status, sort) values ('store', 'Store', 'http://127.0.0.1:3020', 'live', 2) on conflict (key) do update set url = excluded.url, status = 'live'; " +
    "delete from access where module = 'store'; insert into access (email, site, module, role, granted_by) values ('sujit@rcl.test', 'S1', 'store', 'admin', 'test'), ('sujit@rcl.test', 'T2', 'store', 'user', 'test'); delete from counters; update users set start_item = null where email = 'sujit@rcl.test';");
  for (const db of ['rcl', 'rcl_s2']) sql(db, 'truncate public.items, public.store_sessions, public.store_tickets, public.store_activity; alter sequence public.items_code_seq restart;');
  sql('rcl', "delete from web.cache where key like 'F\\_%' or key like 'LG\\_%';");
  const b = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox'], headless: 'shell', protocolTimeout: 120000 });
  const errs = [];
  try {
    const p = await b.newPage(); p.on('pageerror', e => errs.push(String(e.message).slice(0, 200))); await p.setViewport({ width: 1440, height: 900 });
    const cdp = await p.target().createCDPSession(); await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
    // ---- the Portal → the Store ----
    await p.goto(ST + '/', { waitUntil: 'load' });
    const atPortal = await until(() => p.url().startsWith(P) && p.evaluate(() => !document.getElementById('v_login').hidden));
    ok('opening the Store, nobody signed in: the browser goes to the Portal\'s sign-in', !!atPortal, p.url());
    await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'l_email', { timeout: 20000 });
    await p.type('#l_email', 'sujit@rcl.test'); await p.type('#l_pass', 'Nashik#Road848!'); await p.click('#l_btn');
    await until(() => p.evaluate(() => !document.getElementById('v_home').hidden));
    const cards = await p.$$eval('#h_sites a.mod', x => x.map(a => a.textContent + ' ' + a.getAttribute('href')));
    ok('his dashboard shows the Store on S1 and on T2', cards.filter(c => /module=store/.test(c)).length === 2, cards);
    await p.evaluate(() => [...document.querySelectorAll('#h_sites a.mod')].find(a => /module=store&site=S1/.test(a.getAttribute('href'))).click());
    const inStore = await until(() => p.url().startsWith(ST) && p.evaluate(() => !document.getElementById('v_app').hidden), 30000);
    ok('a click opens the Store, signed in (nothing typed here); the ticket is gone from the address', !!inStore && !/sso=/.test(p.url()), p.url());
    let st = await p.evaluate(() => ({ site: document.getElementById('site_name').textContent, role: document.getElementById('u_role').textContent, mods: [...document.querySelectorAll('#mods .grphead')].map(x => x.textContent.trim()), imp: !document.getElementById('b_import').hidden }));
    ok('   the dark menu: Change site (S1) at the top, Mechanical under "Other modules"; Store Admin may import', /S1|VTR/.test(st.site) && /Store Admin/.test(st.role) && st.mods.some(x => /Mechanical/.test(x)) && st.imp, st);
    st = await p.evaluate(() => ({ title: document.getElementById('pg_title').textContent, dash: !document.getElementById('pg_dashboard').hidden, pages: [...document.querySelectorAll('#grp_store .navbtn')].map(x => x.textContent.trim() + (x.getAttribute('aria-current') ? '*' : '')), url: location.hash }));
    ok('   the Store opens on its Dashboard; the Store group (open) lists Dashboard and Item Master', st.title === 'Dashboard' && st.dash && st.pages.join() === 'Dashboard*,Item Master' && st.url === '#page=dashboard', st);
    await p.click('#mods .grphead'); await wait(1500);
    st = await p.evaluate(() => [...document.querySelectorAll('#mods .grp.open .navbtn')].map(x => x.textContent.trim() + ' ' + x.dataset.go));
    ok('   a click on Mechanical opens its pages (a dropdown) in the dark menu', st.length >= 1 && st.every(x => /\S/.test(x)), st);
    await p.click('#grp_store [data-page="items"]'); await wait(1200);
    st = await p.evaluate(() => ({ title: document.getElementById('pg_title').textContent, items: !document.getElementById('pg_items').hidden, dash: !document.getElementById('pg_dashboard').hidden, url: location.href }));
    ok('   Item Master opens in the same window (no new window, no new address – only #page)', st.title === 'Item Master' && st.items && !st.dash && st.url === ST + '/#page=items' && (await b.pages()).length === 2, st);
    // ---- add; the same; near; a proper name ----
    const addItem = async (name, unit, cat, extra) => { await p.click('#b_new'); await p.evaluate((n, u, c, x) => { const s = (id, v) => { document.getElementById(id).value = v; }; s('i_name', n); s('i_unit', u); s('i_cat', c); s('i_hsn', x.hsn || ''); s('i_gst', x.gst || ''); s('i_min', x.min || ''); }, name, unit, cat, extra || {}); await p.click('#b_save'); await wait(1200); };
    const dlg = () => p.evaluate(() => ({ open: !document.getElementById('dlg').hidden, title: document.getElementById('dlg_t').textContent, text: document.getElementById('dlg_b').innerText, btns: [...document.querySelectorAll('#dlg_btns button')].map(x => x.textContent) }));
    const press = label => p.evaluate(l => [...document.querySelectorAll('#dlg_btns button')].find(x => x.textContent.indexOf(l) === 0).click(), label);
    const rows = () => p.$$eval('#i_rows tr[data-code]', x => x.map(tr => tr.children[0].textContent + ' ' + tr.children[1].childNodes[0].textContent));
    await addItem('Sugar', 'Kg', 'Grocery', { hsn: '1701', gst: '5', min: '10' }); await wait(800);
    ok('an item added from the form: ITM-0001 Sugar in the list', (await rows()).join() === 'ITM-0001 Sugar', await rows());
    await addItem('sugar', 'Kg', 'Grocery'); let d = await dlg();
    if (d.open && /proper name/i.test(d.title)) { await press('Keep mine'); await wait(1200); d = await dlg(); }
    ok('the same name: "Already there" – not saved', d.open && /Already there/.test(d.title) && /ITM-0001/.test(d.text), d);
    await press('OK'); await wait(300);
    await addItem('Sugaar', 'Kg', 'Grocery'); d = await dlg();
    ok('his example "Sugaar": a proper name is suggested first – Sugar', d.open && /proper name/i.test(d.title) && /Suggested: Sugar/.test(d.text), d);
    await press('Keep mine'); await wait(1300); d = await dlg();
    ok('   kept as typed: "Is it the same item?" – Sugar (ITM-0001) named, in English and Marathi', d.open && /same item/.test(d.title) && /Sugar \(ITM-0001/.test(d.text) && /हाच item आहे का/.test(d.text), d);
    await p.screenshot({ path: path.join(SHOTS, 'store_near_name.png') });
    await press('Same item'); await wait(800);
    ok('   "Same item – do not save": nothing saved', (await rows()).length === 1 && sql('rcl', 'select count(*) from items') === '1');
    await p.click('#b_save'); await wait(1200); d = await dlg(); if (/proper name/i.test(d.title)) { await press('Keep mine'); await wait(1300); }
    await press('Different item'); await wait(1500);
    ok('   asked again, "Different item – save": saved, marked as confirmed different', (await rows()).join() === 'ITM-0001 Sugar,ITM-0002 Sugaar' && /confirmed different/.test(await p.$eval('#i_rows', x => x.textContent)), await rows());
    await addItem('hydrolic hose 10mm', 'Mtr', 'Spare Parts'); d = await dlg();
    ok('"hydrolic hose 10mm": suggested "Hydraulic Hose 10 mm" (spelling shown)', /Hydraulic Hose 10 mm/.test(d.text) && /hydrolic → hydraulic/.test(d.text), d);
    await press('Use'); await wait(1500);
    ok('   used: saved as "Hydraulic Hose 10 mm"', (await rows()).some(r => /ITM-0003 Hydraulic Hose 10 mm/.test(r)), await rows());
    await p.screenshot({ path: path.join(SHOTS, 'store_items.png') });
    // ---- Excel: export, then import a file (checked row by row) ----
    await p.click('#b_export'); const xf = await until(() => fs.readdirSync(DL).find(f => /^Items_S1_.*\.xlsx$/.test(f)), 15000);
    ok('Export to Excel: a file of this site\'s items', !!xf, fs.readdirSync(DL));
    const csv = path.join(DL, 'import.csv'); fs.writeFileSync(csv, 'Item Name,Unit,Category,HSN Code,GST %,Min Stock\nSugar,Kg,Grocery,,,\nAir Filter,Nos,Spare Parts,84213100,18,5\nAir Filters,Nos,Spare Parts,,,\nCoolant,Ltr,Oil & Lubricants,,,\n');
    const inp = await p.$('#f_file'); await inp.uploadFile(csv); await wait(2500);
    const rep = await p.evaluate(() => ({ shown: !document.getElementById('p_imp').hidden, sum: document.getElementById('imp_sum').textContent, rows: [...document.querySelectorAll('#imp_rows tr')].map(tr => tr.children[1].textContent + ':' + tr.children[2].textContent) }));
    ok('Import: every row checked first – Sugar already there, Air Filter new, Air Filters near (tick), Coolant new', rep.shown && rep.rows.join('|') === 'Sugar:Already there – left out|Air Filter:New – will be added|Air Filters:Near name – confirm|Coolant:New – will be added', rep);
    await p.screenshot({ path: path.join(SHOTS, 'store_import.png') });
    await p.click('#b_imp_go'); await wait(1500);
    ok('   Import without ticking the near name: nothing imported', sql('rcl', 'select count(*) from items') === '3');
    await p.evaluate(() => { const c = document.querySelector('.imp-ok'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }); await p.click('#b_imp_go'); await wait(2000);
    ok('   ticked "different item": 3 imported, Sugar left out', sql('rcl', 'select count(*) from items') === '6' && (await rows()).length === 6, await rows());
    // ---- the Store Dashboard ----
    await p.click('#grp_store [data-page="dashboard"]'); await wait(1500);
    st = await p.evaluate(() => ({ tiles: [...document.querySelectorAll('#db_tiles .tile')].map(t => t.querySelector('small').textContent + '=' + t.querySelector('b').textContent), recent: document.querySelectorAll('#db_recent tr').length, cats: [...document.querySelectorAll('#db_cats tr')].map(tr => tr.children[0].textContent + ':' + tr.children[1].textContent) }));
    ok('Dashboard: 6 items, 6 active, 0 inactive, 3 categories, 6 added this month; recent items; items by category', st.tiles.join() === 'Items=6,Active=6,Inactive=0,Categories=3,Added this month=6' && st.recent === 6 && st.cats.join() === 'Grocery:2,Oil & Lubricants:1,Spare Parts:3', st);
    await p.screenshot({ path: path.join(SHOTS, 'store_dashboard.png') });
    await p.goto(ST + '/#page=items', { waitUntil: 'load' }); await wait(2000);
    st = await p.evaluate(() => ({ title: document.getElementById('pg_title').textContent, n: document.querySelectorAll('#i_rows tr[data-code]').length }));
    ok('   an address with #page=items (from another module\'s menu) opens Item Master straight away', st.title === 'Item Master' && st.n === 6, st);
    // ---- Change site → T2: its own items only ----
    await p.click('#site_chg'); await wait(400); d = await dlg();
    ok('Change site: his Store sites (S1 open now), and "All my modules"', d.btns.some(x => /S1|VTR.*open now/.test(x)) && d.btns.some(x => /T2/.test(x)) && d.btns.some(x => /All my modules/.test(x)), d.btns);
    await p.evaluate(() => [...document.querySelectorAll('#dlg_btns button')].find(x => /T2/.test(x.textContent)).click());
    const onT2 = await until(() => p.url().startsWith(ST) && p.evaluate(() => !document.getElementById('v_app').hidden && /T2/.test(document.getElementById('site_name').textContent)), 30000);
    await wait(1500);
    st = await p.evaluate(() => ({ page: document.getElementById('pg_title').textContent, count: document.getElementById('i_count').textContent, imp: !document.getElementById('b_import').hidden, role: document.getElementById('u_role').textContent }));
    ok('   T2 opens through the Portal, no sign-in, on the same page (Item Master): S1\'s 6 items are there too (one list for all sites); he is a Store User there (no import)', !!onT2 && /^6 of 6/.test(st.count) && !st.imp && /Store User/.test(st.role) && st.page === 'Item Master', st);
    // (14-10-2026) an item of S1, at T2: "Made at" S1 and by whom – it is changed only there
    const by = await p.evaluate(() => document.querySelector('#i_rows tr[data-site="S1"] td:nth-child(9)').textContent);
    await p.evaluate(() => document.querySelector('#i_rows tr[data-site="S1"] .i-edit').click()); await wait(400); d = await dlg();
    ok('   its Edit at T2: a box – made at site S1 by sujit, changed only there; the form does not open', /sujit@rcl\.test/.test(by) && /made at site/.test(d.text) && /only at/.test(d.text) && await p.evaluate(() => document.getElementById('p_form').hidden), { by, d });
    await p.screenshot({ path: path.join(SHOTS, 'store_other_site.png') });
    await p.evaluate(() => document.querySelector('#dlg_btns button').click()); await wait(200);
    // ---- Mechanical's dark menu shows the Store ----
    await p.goto(P + '/api/go?module=mechanical&site=S1', { waitUntil: 'load' });
    const mm = await until(async () => { const f = p.frames().find(x => x !== p.mainFrame()); return f && await f.evaluate(() => { const g = document.getElementById('grp_mods'); return g && !g.hidden && [...g.querySelectorAll('button')].map(x => x.textContent.replace('↗', '').trim()).join(','); }); }, 40000);
    ok('Mechanical on S1: its dark menu shows "Store" under Machinery', /Store/.test(mm || ''), mm);
    // ---- a phone ----
    const q = await b.newPage(); q.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
    await q.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await q.goto(P + '/api/go?module=store&site=S1', { waitUntil: 'load' });
    await until(() => q.url().startsWith(ST) && q.evaluate(() => !document.getElementById('v_app').hidden), 30000); await wait(1500);
    const wide = await q.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await q.click('#menu_btn'); await wait(500);
    const menu = await q.evaluate(() => { const r = document.getElementById('site_chg').getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; });
    ok('phone: the page does not scroll sideways; the menu opens with Change site on the screen', wide <= 1 && menu, { wide, menu });
    await q.screenshot({ path: path.join(SHOTS, 'store_phone.png') });
  } catch (e) { ok('the run finished', false, e.stack || String(e)); }
  finally { await b.close(); }
  ok('no script error on any page', errs.length === 0, errs);
  sql('rcl_portal', "delete from access where module = 'store' and granted_by = 'test';");
  console.log(out.join('\n')); console.log('\nTOTAL ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
