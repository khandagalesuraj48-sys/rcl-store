/* The Store's WORK in the browser (step 2, 28-10-2026), on the local rig (never live) – run after test/work.test.js (it leaves its
 * items, papers and access): the Dashboard's work part; Requirements – a new one from the form, approved from the list; Inward – a
 * direct GRN from the form; Issue – to a sub-contractor, then a Return; Stock & Reports – the stock, the statement, an Excel; Purchase
 * (all sites) – HO Purchase makes a PO from ticked lines; Opening stock & Numbers; a phone.   node test/work.browser.test.js
 * Pictures in test/shots/ (work_*.png). Uses the Chromium of the rig (/home/claude/test/node_modules). */
'use strict';
const M = '/home/claude/test/node_modules/';
const chromium = require(M + '@sparticuz/chromium').default || require(M + '@sparticuz/chromium'); const puppeteer = require(M + 'puppeteer-core');
const { execSync } = require('child_process'), fs = require('fs'), path = require('path');
const wait = ms => new Promise(r => setTimeout(r, ms));
const P = 'http://127.0.0.1:3010', ST = 'http://127.0.0.1:3020';
const SHOTS = path.join(process.env.SHOTS || path.join(__dirname, 'shots')), DL = path.join(SHOTS, 'dl'); fs.mkdirSync(DL, { recursive: true });
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 500) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < (ms || 20000)) { try { const v = await fn(); if (v) return v; } catch (e) { /* changing */ } await wait(300); } return null; };
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

(async () => {
  const b = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox'], headless: 'shell', protocolTimeout: 120000 });
  const errs = [];
  // one person in his own browser: signed in at the Portal, the Store opened on a page of a site
  async function as(email, pw, site, page) {
    const ctx = await b.createBrowserContext(), p = await ctx.newPage(); p.on('pageerror', e => errs.push(email + ': ' + String(e.message).slice(0, 200))); await p.setViewport({ width: 1440, height: 900 });
    const cdp = await p.target().createCDPSession(); await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, browserContextId: ctx.id });
    await p.goto(P + '/', { waitUntil: 'load' }); await p.waitForSelector('#l_email', { visible: true });
    // (the Portal's own sign-in, as its page sends it – its browser test checks the form itself)
    const st = await p.evaluate(async (e, w) => (await fetch('/api/auth', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-RCL': '1' }, body: JSON.stringify({ action: 'login', email: e, password: w }) })).status, email, pw);
    if (st !== 200) throw new Error('the Portal sign-in of ' + email + ': ' + st);
    await p.goto(P + '/api/go?module=store&site=' + site + '&page=' + page, { waitUntil: 'load' });
    const inside = await until(() => p.url().startsWith(ST) && p.evaluate(() => !document.getElementById('v_app').hidden), 30000);
    if (!inside) throw new Error(email + ' could not open the Store at ' + site + ': ' + p.url() + ' – ' + (await p.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => '')));
    await wait(1500);
    return p;
  }
  const set = (p, id, v) => p.evaluate((i, x) => { const e = document.getElementById(i); e.value = x; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, id, v);
  // a line of a paper: its box in row i (the item typed as the list offers it)
  const line = (p, box, i, k, v) => p.evaluate((bx, n, key, x) => { const e = document.querySelector('#' + bx + ' tr[data-i="' + n + '"] [data-k="' + key + '"]'); if (!e) throw new Error('no box ' + key + ' in row ' + n); if (e.type === 'checkbox') e.checked = !!x; else e.value = x; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, box, i, k, v);
  const toast = p => p.evaluate(() => { const t = document.getElementById('toast'); return t && !t.hidden ? t.textContent : ''; });
  const shot = (p, n) => p.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: false });
  const label = code => sql('rcl', "select code || ' · ' || name || ' (' || unit || ')' from items where code = '" + code + "'");
  const CEM = sql('rcl', "select code from items where name = 'Cement OPC 53'"), BAM = sql('rcl', "select code from items where name = 'Bamboo 16 Ft'"), OIL = sql('rcl', "select code from items where name = 'Engine Oil 15W40'");
  try {
    ok('the data of test/work.test.js is there (its items)', !!(CEM && BAM && OIL), [CEM, BAM, OIL]);
    // ---- the store keeper: Dashboard, Requirements (approve), GRN, Issue, Return, Reports ----
    const K = await as('store@rcl.test', 'Audit#PassView9!x', 'S1', 'dashboard');
    let st = await K.evaluate(() => ({ menu: [...document.querySelectorAll('#grp_store .navbtn')].filter(x => !x.hidden).map(x => x.textContent.trim()), tiles: [...document.querySelectorAll('#db_work .tile small')].map(x => x.textContent) }));
    ok('store (a User): the menu shows only the pages given – Dashboard, Item Master, Requirements, Purchase Orders, Inward (GRN), Issue & Return, Stock & Reports (no Purchase, no Opening stock)',
      JSON.stringify(st.menu.map(x => x.replace(/\d+$/, ''))) === JSON.stringify(['Dashboard', 'Item Master', 'Requirements', 'Purchase Orders', 'Inward (GRN)', 'Issue & Return', 'Stock & Reports']), st.menu);
    ok('   the Dashboard\'s work part: stock value, below min, waiting for my approval, POs open, GRN and issues today', ['Stock value', 'Below min stock', 'Waiting for my approval', 'POs open', 'GRN today', 'Issues today'].every(t => st.tiles.indexOf(t) > -1), st.tiles);
    await shot(K, 'work_dashboard');
    // a requirement of view waits for Level 1 (store): approved from the list
    const V = await as('view@rcl.test', 'Audit#PassView9!x', 'S1', 'req');
    await V.click('#rq_new'); await wait(400);
    await set(V, 'rq_for', 'Ch 545+417 toe wall');
    await line(V, 'rq_lines', 0, 'item', label(CEM)); await line(V, 'rq_lines', 0, 'qty', '75'); await line(V, 'rq_lines', 0, 'brand', 'ACC'); await line(V, 'rq_lines', 0, 'spec', 'PPC, 50 kg bag');
    await line(V, 'rq_lines', 1, 'item', label(OIL)); await line(V, 'rq_lines', 1, 'qty', '4');
    await shot(V, 'work_req_form');
    await V.click('#rq_save'); await wait(1500);
    const t1 = await toast(V), rqn = Number(sql('rcl', 'select max(no) from store_req'));
    ok('view makes a requirement from the form (2 items): saved, it waits for Level 1', /Requirement \d+ saved – it waits for Level 1/.test(t1) && sql('rcl', 'select status || level || jsonb_array_length(lines) from store_req where no = ' + rqn) === 'Pending12', t1);
    ok('   (28-10-2026) the form\'s Brand and Material specification of a line: kept', sql('rcl', "select (lines->0->>'brand') || '|' || (lines->0->>'spec') from store_req where no = " + rqn) === 'ACC|PPC, 50 kg bag', sql('rcl', 'select lines from store_req where no = ' + rqn));
    await K.click('#grp_store [data-page="req"]'); await wait(1500);
    await K.evaluate(() => [...document.querySelectorAll('#rq_chips .chip')].find(c => c.dataset.f === 'mine').click()); await wait(400);
    st = await K.evaluate(n => ({ badge: document.getElementById('nb_req').textContent, row: !!document.querySelector('#rq_list tr[data-no="' + n + '"] .rq-ok') }), rqn);
    ok('   store sees it under "Waiting for me" (the menu counts it) with Approve / Reject', st.row && Number(st.badge) >= 1, st);
    await shot(K, 'work_req_list');
    await K.evaluate(n => document.querySelector('#rq_list tr[data-no="' + n + '"] .rq-ok').click(), rqn); await wait(1800);
    ok('   Approve: it goes on to Level 2', sql('rcl', 'select status || level from store_req where no = ' + rqn) === 'Pending2', sql('rcl', 'select status || level from store_req where no = ' + rqn));
    // a direct GRN
    await K.click('#grp_store [data-page="grn"]'); await wait(1500);
    await K.click('#gr_new'); await wait(1200);
    // (28-10-2026, his picture) the form in two cards: GRN Details (Clear and the GRN Date at its top right), Items (+ Add Row, a bin on each row)
    st = await K.evaluate(() => ({ heads: [...document.querySelectorAll('#gr_form .gcard h3')].map(h => h.textContent), date: !!document.querySelector('#gr_form .ghead .gact #gr_date'), clear: !!document.querySelector('#gr_form .ghead #gr_clr'),
      grid: [...document.querySelectorAll('#gr_form .ggrid label')].map(l => l.textContent), rem: (document.getElementById('gr_rem') || {}).tagName, add: !!document.querySelector('#gr_form #gr_add'), rows: document.querySelectorAll('#gr_lines tbody tr[data-i]').length,
      th: [...document.querySelectorAll('#gr_lines thead th')].map(t => t.textContent), bins: document.querySelectorAll('#gr_lines .binb').length, ph: (document.querySelector('#gr_lines [data-k="item"]') || {}).placeholder,
      ref: (document.getElementById('gr_ref') || {}).value, refAt: !!document.querySelector('#gr_form .ghead .gact #gr_ref') }));
    ok('the GRN form of his picture: GRN Details (Clear, GRN Date at the top right; PO / Supplier / Challan No; Invoice No / Invoice Date / Vehicle No / TCS; the Remark box), Items (+ Add Row; one row, its bin; "Search item…")',
      JSON.stringify(st.heads) === '["GRN Details","Items"]' && st.date && st.clear && JSON.stringify(st.grid) === JSON.stringify(['Against PO', 'Supplier *', 'Challan No', 'Invoice No', 'Invoice Date', 'Vehicle No', 'TCS ₹']) && st.rem === 'TEXTAREA' && st.add && st.rows === 1 && st.bins === 1 && st.ph === 'Search item…' &&
      JSON.stringify(st.th) === JSON.stringify(['#', 'Item *', 'Received Qty *', 'Unit', 'Basic Rate ₹', 'GST %', 'Taxable', 'GST', 'Gross', 'Remark', 'Action']), st);
    ok('   (28-10-2026) its GRN No at the top right: the next number by itself (' + st.ref + ')', st.refAt && /^\d+$/.test(st.ref || ''), st);
    await set(K, 'gr_sup', 'Shree Auto Spares'); await set(K, 'gr_inv', 'SA-77'); await set(K, 'gr_veh', 'mh12 xy 4455');
    await line(K, 'gr_lines', 0, 'item', label(OIL)); await line(K, 'gr_lines', 0, 'qty', '6'); await line(K, 'gr_lines', 0, 'rate', '335');
    await K.click('#gr_add'); await wait(300);
    st = await K.evaluate(() => ({ rows: document.querySelectorAll('#gr_lines tbody tr[data-i]').length, focus: document.activeElement && document.activeElement.dataset.k, row: document.activeElement && document.activeElement.closest('tr').dataset.i, unit: [...document.querySelectorAll('#gr_lines tr[data-i] .rob')].map(x => x.textContent) }));
    ok('   + Add Row: a second row, the cursor in its Item box; the unit is the item\'s (Item Master), a row without an item –', st.rows === 2 && st.focus === 'item' && st.row === '1' && st.unit[0] === sql('rcl', "select unit from items where code = '" + OIL + "'") && st.unit[4] === '–', st);
    await K.evaluate(() => document.querySelector('#gr_lines tr[data-i="1"] .binb').click()); await wait(300);
    ok('   its bin: the row taken out', await K.evaluate(() => document.querySelectorAll('#gr_lines tbody tr[data-i]').length) === 1);
    await K.click('#gr_clr'); await wait(400);
    st = await K.evaluate(() => ({ dlg: !document.getElementById('dlg').hidden && document.getElementById('dlg_t').textContent }));
    await K.evaluate(() => [...document.querySelectorAll('#dlg_btns button')].find(b => b.textContent === 'Cancel').click()); await wait(300);
    ok('   Clear asks first ("Clear the form?"); Cancel: what is typed stays', st.dlg === 'Clear the form?' && await K.evaluate(() => document.getElementById('gr_sup').value) === 'Shree Auto Spares' && await K.evaluate(() => document.querySelectorAll('#gr_lines tr[data-i] [data-k="qty"]')[0].value) === '6', st);
    st = await K.evaluate(() => [...document.querySelectorAll('#gr_lines tr.tot td')].map(x => x.textContent));
    ok('a direct GRN from the form: taxable, GST (the item\'s 18 %), gross worked out as typed', st.join('|').indexOf('₹2,010.00') > -1 && st.join('|').indexOf('₹361.80') > -1 && st.join('|').indexOf('₹2,371.80') > -1, st);
    await shot(K, 'work_grn_form');
    const g0 = Number(sql('rcl', 'select count(*) from store_grn'));
    await K.click('#gr_save'); await wait(1800);
    ok('   saved – its number, the vehicle written properly', Number(sql('rcl', 'select count(*) from store_grn')) === g0 + 1 && sql('rcl', "select vehicle_no from store_grn order by created_at desc limit 1") === 'MH12XY4455', await toast(K));
    await shot(K, 'work_grn_list');
    // an issue to a sub-contractor, then a return
    await K.click('#grp_store [data-page="issue"]'); await wait(1500);
    await K.click('#is_new'); await wait(500);
    await set(K, 'is_kind', 'Sub-contractor'); await wait(200); await set(K, 'is_party', 'Tushar Mandal'); await set(K, 'is_loc', '541+045'); await set(K, 'is_side', 'RHS'); await set(K, 'is_use', 'BC'); await set(K, 'is_rcv', 'Kishor');
    await line(K, 'is_lines', 0, 'item', label(BAM)); await line(K, 'is_lines', 0, 'qty', '10'); await line(K, 'is_lines', 0, 'returnable', true);
    await shot(K, 'work_issue_form');
    const o0 = Number(sql('rcl', 'select count(*) from store_issue'));
    await K.click('#is_save'); await wait(1800);
    const ono = Number(sql('rcl', 'select max(no) from store_issue'));
    ok('an issue from the form: to the sub-contractor Tushar Mandal, Bamboo 10 returnable, location 541+045 RHS', Number(sql('rcl', 'select count(*) from store_issue')) === o0 + 1 && sql('rcl', "select party || location || side || use_for from store_issue where no = " + ono) === 'Tushar Mandal541+045RHSBC' && sql('rcl', 'select returnable from store_issue_lines where issue_no = ' + ono) === 't', await toast(K));
    await K.evaluate(n => document.querySelector('#is_list tr[data-no="' + n + '"] .is-ret').click(), ono); await wait(600);
    await K.evaluate(() => { const q = document.querySelector('#is_form .rt-q'); q.value = '4'; });
    await shot(K, 'work_return_form');
    await K.click('#rt_save'); await wait(1800);
    ok('   a Return of it: Bamboo 4 back', sql('rcl', 'select sum(l.qty) from store_return_lines l join store_return r on r.no = l.return_no where r.issue_no = ' + ono) === '4', await toast(K));
    await shot(K, 'work_issue_list');
    // reports
    await K.click('#grp_store [data-page="reports"]'); await wait(2500);
    st = await K.evaluate(() => ({ title: (document.querySelector('#rp_out h2') || {}).textContent, rows: document.querySelectorAll('#rp_out tbody tr').length }));
    ok('Stock & Reports opens on the Stock (as on today)', st.title === 'Stock' && st.rows >= 3, st);
    await shot(K, 'work_reports_stock');
    await K.evaluate(() => [...document.querySelectorAll('#rp_chips .chip')].find(c => c.dataset.k === 'statement').click()); await wait(300);
    await K.evaluate(() => document.querySelector('#rp_q [data-q="month"]').click()); await K.click('#rp_go'); await wait(2500);
    st = await K.evaluate(() => ({ title: (document.querySelector('#rp_out h2') || {}).textContent, head: [...document.querySelectorAll('#rp_out thead th')].map(x => x.textContent).join('|') }));
    ok('   the Stock statement of this month – his daily report\'s columns (Opening · Inward · Return · Issued · Consumed · Closing · Avg basic rate · Stock amount)', st.title === 'Stock statement' && /Opening\|Inward\|Return\|Issued\|Consumed\|Closing\|Avg basic rate\|Stock amount/.test(st.head), st);
    await shot(K, 'work_reports_statement');
    fs.readdirSync(DL).filter(f => /^Stock_statement/.test(f)).forEach(f => fs.unlinkSync(path.join(DL, f)));
    await K.click('#rp_xl'); const xf = await until(() => fs.readdirSync(DL).find(f => /^Stock_statement_.*\.xlsx$/.test(f)), 15000);
    ok('   its Excel downloaded', !!xf, fs.readdirSync(DL));
    // ---- HO Purchase (sujit at T2): the approved requirements of every site → a PO ----
    sql('rcl', 'update store_req set status = \'Approved\', level = 0 where no = ' + rqn);      // (its Level 2 – sujit – here by the database: the test of the approvals is test/work.test.js)
    const B = await as('sujit@rcl.test', 'Nashik#Road848!', 'T2', 'purchase');
    st = await B.evaluate(() => ({ title: document.getElementById('pg_title').textContent, sites: [...document.querySelectorAll('#pu_sites section h2')].map(x => x.textContent), ticks: document.querySelectorAll('.pu-tick[data-site="S1"]').length }));
    ok('HO Purchase (signed in at T2): Purchase – every site; S1\'s lines to order with a tick each', st.title === 'Purchase (all sites)' && st.sites.some(x => /S1/.test(x)) && st.ticks >= 2, st);
    await B.evaluate(n => document.querySelectorAll('.pu-tick[data-site="S1"][data-req="' + n + '"]').forEach(x => { x.checked = true; }), rqn);
    await B.evaluate(() => document.querySelector('[data-mk="S1"]').click()); await wait(1500);
    await set(B, 'pu_ven', 'Bedrok Chem Infra');
    const nl = await B.evaluate(() => document.querySelectorAll('#pu_lines tr[data-i]').length);
    await line(B, 'pu_lines', 0, 'rate', '338'); await line(B, 'pu_lines', 1, 'rate', '305');
    await shot(B, 'work_po_form');
    const p0 = Number(sql('rcl', 'select count(*) from store_po'));
    await B.click('#pu_save'); await wait(2000);
    ok('   the ticked lines in the PO form (with their requirement); saved in S1\'s records', nl >= 2 && Number(sql('rcl', 'select count(*) from store_po')) === p0 + 1 && sql('rcl_s2', 'select count(*) from store_po') === '0', [nl, await toast(B)]);
    await shot(B, 'work_purchase');
    // ---- the Store Admin: Opening stock & Numbers ----
    const A = await as('sujit@rcl.test', 'Nashik#Road848!', 'S1', 'settings');
    st = await A.evaluate(() => ({ title: document.getElementById('pg_title').textContent, rows: document.querySelectorAll('#op_list tr[data-c]').length, nm: !!document.getElementById('nm_grn') }));
    ok('the Store Admin: Opening stock (every item a row) and the Numbers', st.title === 'Opening stock & Numbers' && st.rows >= 3 && st.nm, st);
    await shot(A, 'work_settings');
    // ---- a phone ----
    await K.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });      // (a phone: the page is loaded again)
    await until(() => K.evaluate(() => !document.getElementById('v_app').hidden && !!window.RS), 30000); await wait(1500);
    await K.evaluate(() => window.RS.go('issue')); await until(() => K.evaluate(() => !!document.getElementById('is_new')), 15000);
    await K.evaluate(() => document.getElementById('is_new').click()); await wait(600);
    const wide = await K.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
    ok('a phone (390 px): the Issue page and its form fit the width (the lines scroll inside their box)', wide, await K.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]));
    await shot(K, 'work_phone_issue');
    // a form pressed at once – before the page has read its lists (a slow line): it waits for them, then opens
    const early = await K.evaluate(async () => { window.RS.go('reports'); await new Promise(r => setTimeout(r, 300)); window.RS.go('issue'); const b0 = document.getElementById('is_new'); if (!b0) return 'no button'; b0.click();
      for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 250)); if (document.getElementById('is_kind')) return 'open'; } return 'not open'; });
    ok('"+ New issue" pressed at once (the page\'s lists not read yet): the form opens when they are – no error', early === 'open', early);
    ok('no error on the pages', errs.length === 0, errs);
  } catch (e) { ok('no error in the test itself', false, String(e && e.stack || e)); }
  finally { await b.close(); }
  console.log(out.join('\n')); console.log('TOTAL ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
