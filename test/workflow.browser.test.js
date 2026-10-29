/* (29-10-2026) THE STORE'S WORKFLOW in the browser, on the local rig (never live) – run right after `PART=b node test/workflow.test.js`
 * (it leaves its people, PO, GRNs, issue and return): a requirement verified from the list; the return waiting for its verification
 * ("Waiting for you"); HO Purchase – each PO with its balance, its Details (every GRN checked with the PO), the bills from the sites
 * (✓ Checked); a site that buys itself – "To order" on its Purchase Orders page; the GRN form – the PO's rate, a bill above it asked
 * first; the Portal's Workflow tab; a phone.   node test/workflow.browser.test.js   Pictures in $SHOTS (wf_*.png). */
'use strict';
const M = '/home/claude/test/node_modules/';
const chromium = require(M + '@sparticuz/chromium').default || require(M + '@sparticuz/chromium'); const puppeteer = require(M + 'puppeteer-core');
const { execSync } = require('child_process'), fs = require('fs'), path = require('path');
const wait = ms => new Promise(r => setTimeout(r, ms));
const P = 'http://127.0.0.1:3010', ST = 'http://127.0.0.1:3020';
const SHOTS = path.join(process.env.SHOTS || path.join(__dirname, 'shots')); fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 600) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < (ms || 20000)) { try { const v = await fn(); if (v) return v; } catch (e) { /* changing */ } await wait(300); } return null; };
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const VPW = 'Audit#PassView9!x', PW = 'Nashik#Road848!', SAPW = 'Super#Admin2041';

(async () => {
  const b = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox'], headless: 'shell', protocolTimeout: 120000 });
  const errs = [];
  async function portalIn(email, pw, w) {
    const ctx = await b.createBrowserContext(), p = await ctx.newPage(); p.on('pageerror', e => errs.push(email + ': ' + String(e.message).slice(0, 200))); await p.setViewport({ width: w || 1440, height: 900 });
    await p.goto(P + '/', { waitUntil: 'load' }); await p.waitForSelector('#l_email', { visible: true });
    const st = await p.evaluate(async (e, x) => (await fetch('/api/auth', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-RCL': '1' }, body: JSON.stringify({ action: 'login', email: e, password: x }) })).status, email, pw);
    if (st !== 200) throw new Error('the Portal sign-in of ' + email + ': ' + st);
    return p;
  }
  async function as(email, pw, site, page, w) {
    const p = await portalIn(email, pw, w);
    await p.goto(P + '/api/go?module=store&site=' + site + '&page=' + page, { waitUntil: 'load' });
    const inside = await until(() => p.url().startsWith(ST) && p.evaluate(() => !document.getElementById('v_app').hidden), 30000);
    if (!inside) throw new Error(email + ' could not open the Store at ' + site + ': ' + p.url());
    await wait(1800);
    return p;
  }
  const toast = p => p.evaluate(() => { const t = document.getElementById('toast'); return t && !t.hidden ? t.textContent : ''; });
  const shot = (p, n, full) => p.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: !!full });
  const dlgBtn = (p, label) => p.evaluate(l => { const x = [...document.querySelectorAll('#dlg_btns button')].find(y => y.textContent === l); if (!x) return false; x.click(); return true; }, label);
  try {
    const PO = Number(sql('rcl', "select max(no) from store_po where vendor = 'Ultra Cement Depot'")), CEM = sql('rcl', "select code from items where name = 'Cement OPC 53'");
    ok('the data of test/workflow.test.js (PART b) is there', PO > 0 && !!CEM, [PO, CEM]);
    // a new requirement of the store keeper (through the Store's own door) – it waits for view's verification
    sql('rcl_portal', "select 1");
    // ---- view (verifies): the requirement from the list; the return "Waiting for you" ----
    const K0 = await as('store@rcl.test', VPW, 'S1', 'req');
    const made = await K0.evaluate(async (c, d) => (await (await fetch('api/work', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-RCL': '1' }, body: JSON.stringify({ action: 'reqSave', req: { date: d, for_kind: 'Site work', for_text: 'Ch 560 drain', lines: [{ code: c, qty: 40 }] } }) })).json()), CEM, today);
    ok('a requirement of the store keeper waits for its verification', made && made.step === 'verify', made);
    const V = await as('view@rcl.test', VPW, 'S1', 'req');
    let st = await V.evaluate(n => { const tr = document.querySelector('#rq_list tr[data-no="' + n + '"]'); return tr ? { tag: tr.querySelector('.tag') && tr.querySelector('.tag').textContent, btn: (tr.querySelector('.rq-ok') || {}).textContent, lv: document.getElementById('rq_lv').textContent } : null; }, made.no);
    ok('view: Requirements – "Waiting verification" and his "Verify"; the line says who verifies and who approves', st && st.tag === 'Waiting verification' && st.btn === 'Verify' && /^Verified by: View User · Approved by: Level 1 – Asha Accounts/.test(st.lv), st);
    await shot(V, 'wf_req_verify');
    await V.click('#rq_list tr[data-no="' + made.no + '"] .rq-ok'); await wait(1500);
    const t1 = await toast(V);
    ok('   Verify → "verified"; now it waits for Level 1', /verified\./.test(t1) && sql('rcl', 'select status || level from store_req where no = ' + made.no) === 'Pending1', [t1, sql('rcl', 'select status || level from store_req where no = ' + made.no)]);
    await V.evaluate(() => document.querySelector('#grp_store [data-page="issue"]').click()); await wait(2500);
    st = await V.evaluate(() => { const m = document.getElementById('is_mine'); return { shown: !m.hidden, text: m.innerText.slice(0, 400), btns: [...m.querySelectorAll('.wf-ok')].map(x => x.textContent + ':' + x.dataset.wk) }; });
    ok('view: Issue & Return – "Waiting for you": the outward with its return to verify', st.shown && /Waiting for you/.test(st.text) && st.btns.indexOf('Verify:ret') > -1, st);
    await shot(V, 'wf_issue_mine');
    await V.click('#is_mine .wf-ok[data-wk="ret"]'); await wait(1500);
    const t2 = await toast(V);
    ok('   the return verified (it waits for its approval)', /Return \d+ verified – it waits for its approval\./.test(t2), t2);
    // ---- HO Purchase (sujit at T2): the POs with their balance, Details, the bills from the sites ----
    const HO = await as('sujit@rcl.test', PW, 'T2', 'purchase');
    await until(() => HO.evaluate(() => !!document.querySelector('#pu_pos tr[data-po]')), 15000);
    st = await HO.evaluate(n => { const tr = document.querySelector('#pu_pos tr[data-po="' + n + '"][data-site="S1"]'); return tr ? tr.innerText.replace(/\s+/g, ' ') : ''; }, PO);
    ok('HO Purchase: S1\'s PO in full – 500 · came 200 · balance 300, open for 0 day(s), 2 GRN', /500 Ton · came 200 · balance 300/.test(st) && /0 day\(s\) open · 2 GRN/.test(st), st);
    await HO.click('#pu_pos tr[data-po="' + PO + '"][data-site="S1"] .po-det'); await wait(1500);
    st = await HO.evaluate(() => { const d = document.querySelector('#pu_pos tr.det'); return d ? d.innerText.replace(/\s+/g, ' ') : ''; });
    ok('   Details: ordered ₹1,90,000 · came ₹76,000 · balance ₹1,14,000; each GRN – ✓ As per PO', /1,90,000\.00 76,000\.00 1,14,000\.00/.test(st) && (st.match(/✓ As per PO/g) || []).length === 2, st);
    await shot(HO, 'wf_ho_po_details');
    st = await HO.evaluate(() => { const g = document.getElementById('pu_hog'); return { text: g.innerText.replace(/\s+/g, ' ').slice(0, 600), btn: [...g.querySelectorAll('.ho-ok')].map(x => x.dataset.wk + ':' + x.dataset.site + ':' + x.dataset.wn) }; });
    const G2 = Number(sql('rcl', "select no from store_grn where invoice_no = 'UC/102'"));
    ok('   Bills (GRN) from the sites – 1 to check: S1\'s GRN 2, approved, its bill as per PO; ✓ Checked', /1 to check/.test(st.text) && /✓ As per PO/.test(st.text) && st.btn.join() === 'grn:S1:' + G2, st);
    await HO.evaluate(() => document.getElementById('pu_hog').scrollIntoView()); await shot(HO, 'wf_ho_bills');
    await HO.click('#pu_hog .ho-ok'); await wait(500);
    await HO.evaluate(() => { const i = document.getElementById('ho_note'); i.value = 'Bill passed for payment'; }); await dlgBtn(HO, '✓ Checked'); await wait(2000);
    st = await HO.evaluate(() => document.getElementById('pu_hog').innerText.replace(/\s+/g, ' ').slice(0, 300));
    ok('   ✓ Checked: it leaves the list (0 to check)', /0 to check/.test(st) && JSON.parse(sql('rcl', 'select wf::text from store_grn where no = ' + G2)).hoOk.note === 'Bill passed for payment', st);
    // ---- sujit at S1 (Store Admin – S1 buys itself): "To order" on its Purchase Orders page ----
    const A = await as('sujit@rcl.test', PW, 'S1', 'po');
    st = await A.evaluate(() => { const t = document.getElementById('po_toorder'); return { shown: !t.hidden, text: t.innerText.replace(/\s+/g, ' ').slice(0, 300), mk: !!document.getElementById('po_mk') }; });
    ok('S1\'s Store Admin – Purchase Orders: "To order – this site buys it itself" with a Make a PO', st.shown && /To order – this site buys it itself/.test(st.text) && st.mk, st);
    await A.evaluate(() => { const c = document.querySelector('#po_toorder .pu-tick'); if (c) c.click(); }); await A.click('#po_mk'); await wait(1800);
    st = await A.evaluate(() => ({ form: !document.getElementById('po_form').hidden, h: (document.querySelector('#po_form h2') || {}).textContent, lines: document.querySelectorAll('#pu_lines tr[data-i]').length }));
    ok('   its PO form opens on the same page (the ticked line in it)', st.form && /New purchase order – S1/.test(st.h) && st.lines >= 1, st);
    await shot(A, 'wf_site_buys');
    // ---- the store keeper: the GRN form against the PO – its rate, a bill above it asked first ----
    const K = await as('store@rcl.test', VPW, 'S1', 'grn');
    await K.click('#gr_new'); await wait(1500);
    await K.evaluate(n => { const s = document.getElementById('gr_po'); s.value = String(n); s.dispatchEvent(new Event('change', { bubbles: true })); }, PO); await wait(600);
    st = await K.evaluate(() => ({ heads: [...document.querySelectorAll('#gr_lines thead th')].map(x => x.textContent), pr: (document.querySelector('#gr_lines tr[data-i="0"]') || { innerText: '' }).innerText }));
    ok('the GRN form against the PO: a "PO Rate" column – 380.00 (400 less 5 %)', st.heads.indexOf('PO Rate') > -1 && /380\.00/.test(st.pr), st);
    await K.evaluate(() => { const e = document.querySelector('#gr_lines tr[data-i="0"] [data-k="qty"]'); e.value = '50'; e.dispatchEvent(new Event('input', { bubbles: true })); }); await wait(300);
    await K.evaluate(() => { const e = document.querySelector('#gr_lines tr[data-i="0"] [data-k="disc"]'); e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); }); await wait(300);
    st = await K.evaluate(() => (document.querySelector('#gr_lines tr[data-i="0"] .over') || {}).textContent || '');
    ok('   the bill at 400 without its discount: the PO\'s rate marked ⚠', /380\.00 ⚠/.test(st), st);
    await shot(K, 'wf_grn_form_rate');
    await K.click('#gr_save'); await wait(800);
    st = await K.evaluate(() => ({ dlg: !document.getElementById('dlg').hidden && document.getElementById('dlg_t').textContent, b: document.getElementById('dlg_b').innerText }));
    ok('   Save: "The bill is not as per the PO" – asked first', st.dlg === 'The bill is not as per the PO' && /rate 400\.00 – PO 380\.00/.test(st.b), st);
    await shot(K, 'wf_grn_ask');
    await dlgBtn(K, 'Cancel'); await wait(300);
    ok('   Cancel: nothing saved', Number(sql('rcl', "select count(*) from store_grn where po_no = " + PO)) === 2);
    // the GRN list: each GRN's card with its bill checked and its workflow
    await K.evaluate(() => { document.getElementById('gr_x').click(); document.getElementById('gr_show').click(); }); await wait(2000);
    st = await K.evaluate(() => [...document.querySelectorAll('#gr_list .grnc .gwf')].map(x => x.innerText.replace(/\s+/g, ' ')));
    ok('   the GRN cards: "Bill with PO … ✓ As per PO", Approved, ✓ Checked by HO', st.length >= 2 && st.every(x => /Bill with PO \d+: ✓ As per PO/.test(x)) && st.some(x => /✓ Checked by HO/.test(x)), st);
    await K.evaluate(() => document.getElementById('gr_list').scrollIntoView()); await shot(K, 'wf_grn_cards');
    // a phone's width
    const PH = await as('view@rcl.test', VPW, 'S1', 'grn', 390);
    await PH.evaluate(() => document.getElementById('gr_show').click()); await wait(2000);
    const wide = await PH.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2);
    ok('a phone (390 px): the GRN page fits its width', wide);
    await shot(PH, 'wf_phone_grn');
    // ---- the Portal: the Super Admin's Workflow tab ----
    const SA = await portalIn('sa@rcl.test', SAPW);
    await SA.goto(P + '/', { waitUntil: 'load' }); await until(() => SA.evaluate(() => !document.getElementById('v_sa').hidden), 15000);
    await SA.evaluate(() => document.querySelector('#sa_tabs button[data-t="wf"]').click()); await wait(1200);
    await SA.evaluate(() => { const s = document.getElementById('wf_site'); s.value = 'S1'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await wait(600);
    st = await SA.evaluate(() => ({ rows: [...document.querySelectorAll('#wf_box tr[data-w]')].map(tr => tr.innerText.replace(/\s+/g, ' ')), sel: [...document.querySelectorAll('#wf_box .wf-ho')].map(s => s.dataset.k + ':' + s.value), save: !!document.getElementById('wf_save') }));
    ok('the Portal – Workflow (S1): each work, who verifies, who approves, once approved → Head Office (requirements No, GRN Yes, issues No)',
      st.rows.length === 4 && /Material Requirements View User Level 1: Asha Accounts/.test(st.rows[0]) && /Inward \(GRN\).*View User|Inward \(GRN\).*Asha Accounts/.test(st.rows[2]) && st.sel.join() === 'req:0,grn:1,iss:0' && st.save, st);
    await shot(SA, 'wf_portal_workflow', true);
    await SA.evaluate(() => { const s = document.querySelector('#wf_box .wf-ho[data-k="iss"]'); s.value = '1'; }); await SA.click('#wf_save'); await wait(2000);
    const t3 = await SA.evaluate(() => document.getElementById('toast').textContent);
    ok('   Save – the Store of S1 told (issues now to Head Office)', /Saved – the Store of S1 is told\./.test(t3) && JSON.parse(sql('rcl', "select value::text from store_settings where id = 'approvers'")).wf.ho.iss === true, t3);
    ok('no error on any page', !errs.length, errs);
  } catch (e) { ok('CRASH ' + (e && e.stack || e), false); }
  await b.close();
  console.log(out.join('\n'));
  console.log('TOTAL ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
