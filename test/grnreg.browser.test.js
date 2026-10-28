/* THE OLD INWARD REGISTER ON THE PAGE (28-10-2026), on the local rig (never live) – run after test/grnreg.test.js (it leaves step 3 and
 * the access): the Store Admin opens Inward (GRN), chooses a register made as his file is (Import from Excel) – the check: the tiles,
 * the rows to look at (one corrected on the page), the duplicate rows (one deleted), the AI's names (found, ticked), the new suppliers
 * and items, the notes; the Excel of the check; Import – the parts and the result; Import again – nothing twice; the GRN list in his
 * register's columns; a phone.   node test/grnreg.browser.test.js   Pictures in test/shots/ (grnreg_*.png). */
'use strict';
const M = '/home/claude/test/node_modules/';
const chromium = require(M + '@sparticuz/chromium').default || require(M + '@sparticuz/chromium'); const puppeteer = require(M + 'puppeteer-core');
const { execSync } = require('child_process'), fs = require('fs'), path = require('path');
const { aiStandin, makeRegister, AILOG } = require('./regkit');
const wait = ms => new Promise(r => setTimeout(r, ms));
const P = 'http://127.0.0.1:3010', ST = 'http://127.0.0.1:3020';
const SHOTS = path.join(process.env.SHOTS || path.join(__dirname, 'shots')), DL = path.join(SHOTS, 'dl'); fs.mkdirSync(DL, { recursive: true });
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 600) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < (ms || 20000)) { try { const v = await fn(); if (v) return v; } catch (e) { /* changing */ } await wait(300); } return null; };

(async () => {
  const ai = await aiStandin();
  const b = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox'], headless: 'shell', protocolTimeout: 180000 });
  const errs = [];
  try {
    // the start: S1's GRNs, items and the suppliers the API test made taken out (the rig's test rows only)
    sql('rcl', "truncate public.store_grn_lines, public.store_grn cascade; update public.store_numbers set next_no = 1 where kind = 'GRN'; delete from public.items; delete from public.vendors where vendor_type = 'Material Supplier' or remark like 'Material supplier – from the Store%';");
    const file = path.join(DL, 'INWARD_test_register.xlsx'); fs.writeFileSync(file, makeRegister().buf);
    const ctx = await b.createBrowserContext(), p = await ctx.newPage(); p.on('pageerror', e => errs.push(String(e.message).slice(0, 200))); await p.setViewport({ width: 1440, height: 900 });
    const cdp = await p.target().createCDPSession(); await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, browserContextId: ctx.id });
    await p.goto(P + '/', { waitUntil: 'load' }); await p.waitForSelector('#l_email', { visible: true });
    const st = await p.evaluate(async () => (await fetch('/api/auth', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-RCL': '1' }, body: JSON.stringify({ action: 'login', email: 'sujit@rcl.test', password: 'Nashik#Road848!' }) })).status);
    if (st !== 200) throw new Error('the Portal sign-in: ' + st);
    await p.goto(P + '/api/go?module=store&site=S1&page=grn', { waitUntil: 'load' });
    if (!await until(() => p.url().startsWith(ST) && p.evaluate(() => !!document.getElementById('gr_imp')), 30000)) throw new Error('the Store\'s Inward (GRN) did not open: ' + p.url());
    await wait(1200);
    const shot = (n, full) => p.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: !!full });
    const text = sel => p.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText : ''; }, sel);
    const tiles = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#gr_impbox .tile')].map(t => [t.querySelector('small').textContent, t.querySelector('b').textContent])));
    let r = await p.evaluate(() => ({ hint: !!document.getElementById('gr_hint'), cards: document.querySelectorAll('#gr_list .grnc').length }));
    ok('the GRN page: no list until Show is pressed ("Choose the dates and press Show")', r.hint && r.cards === 0, r);
    // ---- the Import format: his columns ----
    await p.click('#gr_tpl'); const fmt = await until(() => fs.readdirSync(DL).find(f => /^GRN_import_format\.xlsx$/.test(f)), 15000);
    const XLSX = require('../public/vendor/xlsx-0.18.5.full.min.js');
    const fh = fmt ? XLSX.utils.sheet_to_json(XLSX.read(fs.readFileSync(path.join(DL, fmt))).Sheets.Inward, { header: 1 })[0] : [];
    ok('   "Import format": the headings of his register (Sr No … Gross Amount, Remark)', JSON.stringify(fh) === JSON.stringify(require('../public/grnreg').HEAD), fh);
    // ---- the file chosen: the check ----
    const t0 = Date.now(); const inp = await p.$('#gr_file'); await inp.uploadFile(file); await p.evaluate(() => document.getElementById('gr_file').dispatchEvent(new Event('change')));
    const shown = await until(() => p.evaluate(() => /Import the inward register – check/.test((document.getElementById('gr_impbox') || {}).innerText || '')), 60000);
    ok('the register chosen: the check is shown (' + (Date.now() - t0) + ' ms) – nothing saved', !!shown && sql('rcl', 'select count(*) from store_grn') === '0', await text('#gr_impbox'));
    let t = await tiles();
    ok('   the tiles: 411 GRNs to import, 60 new suppliers, 204 new items (4 of them written differently), 10 duplicate rows, 3 rows to look at, the next new GRN 413',
      t['GRNs to import'] === '411' && t['New suppliers'] === '60' && t['New items'] === '204' && t['Duplicate rows'] === '10' && t['Rows to look at'] === '3' && t['Next new GRN'] === '413', t);
    r = await text('#gr_impbox');
    ok('   it says the sheet taken, the other sheet left, the GRNs without a GRN No and their numbers, a row with only a GRN No', /sheet "MAIN SHEET INWARD1"/.test(r) && /the other sheets – Summary – are not the register/.test(r) && /2 GRN\(s\) of the file have no GRN No – they get the numbers 411 to 412/.test(r) && /1 row\(s\) have only a GRN No/.test(r), r.slice(0, 900));
    await shot('grnreg_check');
    // ---- a row to look at corrected on the page: its date typed ----
    const lk = await p.evaluate(() => [...document.querySelectorAll('#rgd_look tbody tr[data-line]')].map(tr => [tr.dataset.line, tr.innerText.replace(/\s+/g, ' ')]));
    ok('   the rows to look at, each with why (not a date, no quantity, a date 20 years before the GRNs around it)', lk.length === 3 && /is not a date/.test(lk[0][1]) && /no quantity/.test(lk[1][1]) && /the GRNs around GRN No 404 are of/.test(lk[2][1]), lk);
    await p.evaluate(l => { const e = document.querySelector('#rgd_look tr[data-line="' + l + '"] [data-k="date"]'); e.value = '2023-04-14'; e.dispatchEvent(new Event('change', { bubbles: true })); }, lk[0][0]);
    await wait(600); t = await tiles();
    ok('   its date typed: the row goes in – 412 GRNs, 2 rows to look at', t['GRNs to import'] === '412' && t['Rows to look at'] === '2', t);
    // ---- a duplicate deleted (one kept) ----
    await p.evaluate(() => { document.getElementById('rgd_dup').open = true; }); await wait(200);
    const d1 = await p.evaluate(() => { const tr = document.querySelector('#rgd_dup tbody tr[data-line]'); tr.querySelector('.rg-dup').click(); return tr.dataset.line; });
    await wait(600); t = await tiles();
    r = await p.evaluate(l => document.querySelector('#rgd_dup tr[data-line="' + l + '"]').innerText, d1);
    ok('   a duplicate row deleted: "Deleted – Undo"; the other 9 kept (imported as they are)', /Deleted/.test(r) && /9 kept \(imported\) · 1 deleted/.test(await text('#gr_impbox .tiles')), [r, t]);
    await shot('grnreg_dups');
    // ---- the AI: found, ticked ----
    await p.evaluate(() => { document.getElementById('rgd_ai').open = true; }); await p.click('#rg_ai');
    const aiDone = await until(() => p.evaluate(() => !document.getElementById('rg_aistop') && document.querySelectorAll('#rgd_ai .rg-ai').length > 0), 60000);
    r = await p.evaluate(() => [...document.querySelectorAll('#rgd_ai .rg-ai')].map(x => [x.dataset.f, x.dataset.t, x.checked]));
    ok('the AI\'s names (' + AILOG.length + ' questions to the AI): each with its right spelling, none ticked until he ticks', !!aiDone && r.length >= 3 && r.every(x => !x[2]) && r.some(x => /Hydrolic/.test(x[0]) && /Hydraulic/.test(x[1])), r);
    await shot('grnreg_ai');
    await p.evaluate(() => document.querySelector('#rgd_ai .rg-aiall[data-v="1"]').click()); await wait(700);
    t = await tiles();
    ok('   "✓ all": every name ticked – the items written differently are one item now (200 new items)', t['New items'] === '200' && (await p.evaluate(() => [...document.querySelectorAll('#rgd_ai .rg-ai')].every(x => x.checked))), t);
    // ---- the Excel of the check ----
    // (a second download of the same page is held by the browser – the workbook is taken as the page writes it)
    await p.evaluate(() => { const X = window.XLSX, w = X.writeFile; X.writeFile = (wb, name) => { window.__xl = { name: name, sheets: wb.SheetNames, rows: wb.SheetNames.map(n => X.utils.sheet_to_json(wb.Sheets[n], { header: 1 }).length), head: X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })[0] }; return w(wb, name); }; });
    const cover = await p.evaluate(() => { const b = document.getElementById('rg_xl'); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e === b ? '' : (e ? e.tagName + '#' + e.id + '.' + e.className + ' ' + String(e.textContent).slice(0, 80) : 'nothing'); });
    ok('   the buttons under the check are free to press (nothing over them)', !cover, cover);
    await p.evaluate(() => document.getElementById('rg_xl').click()); const xl = await until(() => p.evaluate(() => window.__xl), 20000);
    ok('   "Excel of the check": the GRNs in his columns, the rows to look at, the duplicates, the notes, the new suppliers and items, the AI\'s names',
      xl && /^Inward_register_check_\d{4}-\d{2}-\d{2}\.xlsx$/.test(xl.name) && JSON.stringify(xl.sheets) === JSON.stringify(['GRNs to import', 'Rows to look at', 'Duplicate rows', 'Notes', 'New suppliers', 'New items', 'Names (AI)', 'Already in the Store']) &&
      JSON.stringify(xl.head.slice(0, 17)) === JSON.stringify(require('../public/grnreg').HEAD) && xl.rows[1] === 3 && xl.rows[4] === 61, xl);
    // ---- the choices kept in this browser for this file: the page opened again, the file chosen again ----
    await p.reload({ waitUntil: 'load' }); await until(() => p.evaluate(() => !!document.getElementById('gr_imp')), 30000); await wait(1000);
    await (await p.$('#gr_file')).uploadFile(file); await p.evaluate(() => document.getElementById('gr_file').dispatchEvent(new Event('change')));
    await until(() => p.evaluate(() => /– check/.test((document.getElementById('gr_impbox') || {}).innerText || '')), 60000); await wait(500);
    const t2 = await tiles();
    ok('   the page opened again and the same file chosen: what he chose is there (the date typed, the duplicate deleted, the names ticked)', JSON.stringify(t2) === JSON.stringify(t), [t2, t]);
    // ---- IMPORT ----
    await p.click('#rg_go'); await p.waitForSelector('#dlg:not([hidden])'); r = await text('#dlg');
    ok('Import asks first: the GRNs, lines, amount, suppliers into the Vendor Master, items, the GRN No as in the file and the next new GRN', /Import 412 GRN\?/.test(r) && /into the Vendor Master \("Material Supplier"\)/.test(r) && /the next new GRN: 413/.test(r) && /9 duplicate row\(s\) kept/.test(r), r);
    await p.evaluate(() => [...document.querySelectorAll('#dlg_btns button')].find(x => x.textContent === 'Import').click());
    const done = await until(() => p.evaluate(() => /Imported/.test((document.querySelector('#gr_impbox .note2 b') || {}).textContent || '')), 120000);
    r = await text('#gr_impbox section.note2');
    ok('   the parts and the result: suppliers, items, GRNs – 412 saved', !!done && /412 GRN saved/.test(r) && !/mistake/.test(r), r);
    ok('   in the database: 412 GRNs, the next GRN 413', sql('rcl', 'select count(*) from store_grn') === '412' && sql('rcl', "select next_no from store_numbers where kind = 'GRN'") === '413');
    await shot('grnreg_done');
    t = await tiles();
    ok('   the check again (after the import): nothing left to import – 412 already in the Store', t['GRNs to import'] === '0' && t['Already in the Store'] === '412' && await p.evaluate(() => document.getElementById('rg_go').disabled), t);
    // ---- the GRN list: his columns, the GRN No as in the file ----
    await p.evaluate(() => { document.getElementById('gr_from').value = '2022-12-01'; document.getElementById('gr_to').value = '2023-06-30'; }); await p.click('#gr_show'); await wait(2500);
    r = await p.evaluate(() => { const cards = [...document.querySelectorAll('#gr_list .grnc')], a = cards.find(c => c.querySelector('.gno span').textContent === '342-A');
      return { n: cards.length, rows: document.querySelectorAll('#gr_list .glines tbody tr').length, keys: a ? [...a.querySelectorAll('header .gk small')].map(x => x.textContent) : null, heads: a ? [...a.querySelectorAll('.glines thead th')].map(x => x.textContent) : null,
        line: a ? [...a.querySelector('.glines tbody tr').children].map(td => td.textContent) : null, count: document.querySelector('#gr_list .count').textContent }; });
    ok('   Show: each GRN a card – GRN 342-A as in the file; its GRN No, date, supplier, invoice, gross at the top; its materials under it (Sr No, Material Description, Received Qty, UOM, Basic Rate, Taxable / GST / Gross Amount, Remark)',
      r.n === 412 && /412 GRN\(s\)/.test(r.count) && r.rows > 412 && r.keys && r.keys.slice(0, 3).join('|') === 'GRN No|GRN Date|Supplier Name' && r.keys.indexOf('Gross Amount') > -1 &&
      JSON.stringify(r.heads) === JSON.stringify(['Sr No', 'Material Description', 'Received Qty', 'UOM', 'Basic Rate', 'Taxable Amount', 'GST Amount', 'Gross Amount', 'Remark']) && /^\d+$/.test(r.line[0]) && /\.\d\d$/.test(r.line[7]), r);
    await p.evaluate(() => window.scrollTo(0, document.getElementById('gr_list').offsetTop - 80)); await shot('grnreg_list');
    r = await p.evaluate(() => ({ hide: !document.getElementById('gr_hide').hidden }));
    await p.click('#gr_hide'); await wait(300);
    const r2 = await p.evaluate(() => ({ hint: !!document.getElementById('gr_hint'), cards: document.querySelectorAll('#gr_list .grnc').length, hide: !document.getElementById('gr_hide').hidden }));
    ok('   "Hide list" (shown with the list): the list goes away – the hint again', r.hide && r2.hint && r2.cards === 0 && !r2.hide, [r, r2]);
    await p.click('#gr_show'); await wait(2500);
    // (28-10-2026, his picture) a GRN changed: the form of his picture with that GRN in it; Clear – back as it is saved
    await p.evaluate(() => [...document.querySelectorAll('#gr_list .grnc')].find(c => c.querySelector('.gno span').textContent === '342-A').querySelector('.gr-edit').click()); await wait(1500);
    const chg = () => p.evaluate(() => ({ sub: (document.querySelector('#gr_form .gsub') || {}).textContent, sup: document.getElementById('gr_sup').value, rows: document.querySelectorAll('#gr_lines tbody tr[data-i]').length, qty: (document.querySelector('#gr_lines tr[data-i="0"] [data-k="qty"]') || {}).value }));
    const c0 = await chg();
    ok('Change on GRN 342-A: the form of his picture, "Change GRN 342-A", its supplier and rows', c0.sub === 'Change GRN 342-A' && !!c0.sup && c0.rows >= 1 && !!c0.qty, c0);
    await p.evaluate(() => { const e = document.querySelector('#gr_lines tr[data-i="0"] [data-k="qty"]'); e.value = '999'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await p.click('#gr_clr'); await wait(400);
    await p.evaluate(() => [...document.querySelectorAll('#dlg_btns button')].find(b => b.textContent === 'Clear').click()); await wait(1500);
    const c1 = await chg();
    ok('   a quantity typed, then Clear: the GRN back as it is saved (nothing saved changed)', JSON.stringify(c1) === JSON.stringify(c0), [c0, c1]);
    await p.evaluate(() => document.getElementById('gr_form').scrollIntoView({ block: 'start' })); await shot('grn_change_form');
    await p.click('#gr_x'); await wait(300);
    // a phone
    await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });      // (a phone: the page is loaded again)
    await until(() => p.evaluate(() => !document.getElementById('v_app').hidden && !!window.RS), 30000); await wait(1500);
    await p.evaluate(() => window.RS.go('grn')); await until(() => p.evaluate(() => !!document.getElementById('gr_imp')), 15000); await wait(1500);
    const wide = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
    ok('a phone: the page is not wider than the phone (the lists scroll inside)', wide);
    await shot('grnreg_phone');
    ok('no fault on the page', errs.length === 0, errs);
  } catch (e) { ok('the test ran to its end', false, e && e.stack); }
  await b.close(); ai.close();
  console.log(out.join('\n')); console.log('TOTAL pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
})();
