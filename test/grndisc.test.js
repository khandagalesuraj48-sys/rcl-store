/* (29-10-2026) A GRN'S DISCOUNTS – on a line and on the whole bill, each on the Basic or after GST, % or ₹ – and, against a PO, its Qty /
 * received before / shortage; the item's code in its own column. On the local rig only (never live), after test/work.test.js (its items,
 * POs and people). Two parts, the Store started again between them:
 *   PART=a  the site's database WITHOUT the Store's step 6: no discount offered (a note), a discount sent refused, a GRN as before saved
 *   PART=b  after sql/store_step6_grn_discount.sql: the money as the server works it out, kept in the database, the stock's rate = the
 *           net rate; the form in a browser (its columns, its sums = what is saved), the list's card and its PO columns
 *   PART=a node test/grndisc.test.js · PART=b node test/grndisc.test.js      (pictures in $SHOTS: grndisc_*.png) */
'use strict';
const M = '/home/claude/test/node_modules/';
const chromium = require(M + '@sparticuz/chromium').default || require(M + '@sparticuz/chromium'); const puppeteer = require(M + 'puppeteer-core');
const { execSync } = require('child_process'), fs = require('fs'), path = require('path');
const W = require('../lib/work.js');
const P = 'http://127.0.0.1:3010', ST = 'http://127.0.0.1:3020', PART = process.env.PART || 'a';
const SHOTS = process.env.SHOTS || path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0; const out = [], T0 = Date.now();
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 600) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < (ms || 20000)) { try { const v = await fn(); if (v) return v; } catch (e) { /* changing */ } await wait(300); } return null; };
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
function client(base) {
  let cookie = '';
  const req = async (p, body) => {
    const h = { 'Content-Type': 'application/json', 'X-RCL': '1' }; if (cookie) h.Cookie = cookie;
    const r = await fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(90000) });
    const sc = r.headers.get('set-cookie'); if (sc) { const v = sc.split(';')[0]; cookie = /=$/.test(v) ? '' : v; }
    let j = {}; try { j = JSON.parse(await r.text()); } catch (e) { j = {}; }
    return { status: r.status, j: j, loc: r.headers.get('location') || '' };
  };
  return { req };
}
async function storeAs(email, pw, site) {
  const p = client(P), l = await p.req('/api/auth', { action: 'login', email: email, password: pw });
  if (l.status !== 200) throw new Error('Portal sign-in of ' + email + ': ' + JSON.stringify(l.j));
  const tk = ((await p.req('/api/go?module=store&site=' + site)).loc.split('#sso=')[1] || ''), s = client(ST), r = await s.req('/api/sso', { ticket: tk });
  if (r.status !== 200) throw new Error('Store sign-in of ' + email + ' at ' + site + ': ' + JSON.stringify(r.j));
  return { w: (action, x) => s.req('/api/work', Object.assign({ action: action }, x || {})) };
}
const PW = 'Nashik#Road848!';

(async () => {
  const A = await storeAs('sujit@rcl.test', PW, 'S1');
  const boot = (await A.w('boot')).j, items = boot.items || [];
  const CEM = (items.find(i => i.name === 'Cement OPC 53') || {}).code, BAM = (items.find(i => i.name === 'Bamboo 16 Ft') || {}).code;
  ok('the items of test/work.test.js are there', !!(CEM && BAM), [CEM, BAM]);
  const IT = {}; items.forEach(i => { IT[i.code] = i; });
  const made = [];
  const L1 = { code: CEM, qty: 10, rate: 350, gst_pct: 28, disc: '10%' }, L2 = { code: BAM, qty: 100, rate: 90, gst_pct: 0, disc: '500', disc_on: 'gst' };
  const grn = (lines, x) => ({ grn: Object.assign({ date: today, supplier: 'Bedrok Chem Infra', invoice_no: 'DISC-' + PART + '-' + Date.now() % 100000, lines: lines }, x || {}), confirmParty: true });
  let r = await A.w('grnNext');
  ok('grnNext says whether the site has step 6 (' + PART + ')', r.status === 200 && r.j.step6 === (PART === 'b'), r.j);
  const b = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox'], headless: 'shell', protocolTimeout: 120000 });
  const errs = [];
  async function as(email, pw, site, page) {
    const ctx = await b.createBrowserContext(), p = await ctx.newPage(); p.on('pageerror', e => errs.push(String(e.message).slice(0, 200))); await p.setViewport({ width: 1536, height: 960 });
    await p.goto(P + '/', { waitUntil: 'load' }); await p.waitForSelector('#l_email', { visible: true });
    const st = await p.evaluate(async (e, w) => (await fetch('/api/auth', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-RCL': '1' }, body: JSON.stringify({ action: 'login', email: e, password: w }) })).status, email, pw);
    if (st !== 200) throw new Error('the Portal sign-in of ' + email + ': ' + st);
    await p.goto(P + '/api/go?module=store&site=' + site + '&page=' + page, { waitUntil: 'load' });
    const inside = await until(() => p.url().startsWith(ST) && p.evaluate(() => !document.getElementById('v_app').hidden), 30000);
    if (!inside) throw new Error(email + ' could not open the Store: ' + p.url());
    await wait(1500); return p;
  }
  const set = (p, id, v) => p.evaluate((i, x) => { const e = document.getElementById(i); e.value = x; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, id, v);
  const line = (p, i, k, v) => p.evaluate((n, key, x) => { const e = document.querySelector('#gr_lines tr[data-i="' + n + '"] [data-k="' + key + '"]'); if (!e) throw new Error('no box ' + key + ' in row ' + n); e.value = x; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, i, k, v);
  const heads = p => p.evaluate(() => [...document.querySelectorAll('#gr_lines thead th')].map(t => t.textContent.trim()));
  const label = code => { const i = IT[code]; return i.code + ' · ' + i.name + ' (' + i.unit + ')'; };
  const shot = (p, n) => Promise.race([p.screenshot({ path: path.join(SHOTS, n + '.png') }).catch(() => {}), wait(20000)]);
  try {
    if (PART === 'a') {
      r = await A.w('grnSave', grn([L1]));
      ok('no step 6: a discount sent is refused – nothing lost, said what to run', r.status === 400 && r.j.code === 'sql' && /needs the Store's database step 6 .*store_step6_grn_discount\.sql/.test(r.j.error || ''), r.j);
      r = await A.w('grnSave', grn([{ code: CEM, qty: 2, rate: 350 }]));
      ok('no step 6: a GRN as before is saved', r.status === 200 && r.j.ok, r.j); if (r.j.no) made.push(r.j.no);
      const p = await as('sujit@rcl.test', PW, 'S1', 'grn');
      await p.click('#gr_new'); await until(() => p.$('#gr_lines tr[data-i="0"]'));
      const h = await heads(p), note = await p.evaluate(() => { const e = document.getElementById('gr_nodisc'); return e ? e.textContent : ''; });
      ok('the form without step 6: the Item Code column, no discount columns, no bill discount, a note', h.indexOf('Item Code') === 1 && h.indexOf('Disc. (% or ₹)') === -1 && !(await p.$('#gr_bd')) && /needs the Store's database step 6/.test(note), { h: h, note: note });
      await line(p, 0, 'item', label(CEM)); await wait(300); await line(p, 0, 'qty', '4'); await line(p, 0, 'rate', '350'); await wait(400);
      const s0 = await p.evaluate(() => document.getElementById('gr_sum').innerText);
      ok('…its sums as before: Basic, Taxable, GST, Gross (no discount line)', /Basic\s*₹1,400\.00/.test(s0) && /Gross\s*₹1,792\.00/.test(s0) && !/Discount/.test(s0), s0);
      await shot(p, 'grndisc_a_form');
    } else {
      // ---- the server: the money as checkGrn works it out, kept in the database; the stock's rate = the net rate ----
      const x = grn([L1, L2], { bill_disc: '2%', bill_disc_on: 'basic' }), want = W.checkGrn(x.grn, IT);
      r = await A.w('grnSave', x);
      ok('step 6: a GRN with a line\'s 10% on Basic, a line\'s ₹500 after GST and the bill\'s 2% on Basic saved', r.status === 200 && r.j.ok && r.j.gross === want.head.gross, { got: r.j, want: want.head.gross });
      const no = r.j.no; if (no) made.push(no);
      const hd = sql('rcl', 'select basic, disc, bill_disc, bill_disc_pct, bill_disc_on, taxable, gst, gross from store_grn where no = ' + Number(no)).split('|').map(v => isNaN(Number(v)) || v === '' ? v : Number(v));
      ok('…its head in the database: Basic, the discounts, the bill\'s 2% on Basic, Taxable, GST, Gross', JSON.stringify(hd) === JSON.stringify([want.head.basic, want.head.disc, want.head.bill_disc, 2, 'basic', want.head.taxable, want.head.gst, want.head.gross]), { db: hd, want: want.head });
      const ln = sql('rcl', 'select code, basic, disc, disc_pct, disc_on, bill_disc, taxable, gst, gross, net_rate from store_grn_lines where grn_no = ' + Number(no) + ' order by line').split('\n').map(l => l.split('|'));
      const wl = want.lines.map(l => [l.code, l.basic, l.disc, l.disc_pct === null ? '' : l.disc_pct, l.disc_on || '', l.bill_disc, l.taxable, l.gst, l.gross, l.net_rate].map(String));
      ok('…each line: Basic, its own discount (10 % on Basic / ₹500 after GST), its part of the bill\'s, Taxable, GST, Gross, its net rate', JSON.stringify(ln.map(a => a.map(v => String(isNaN(Number(v)) || v === '' ? v : Number(v))))) === JSON.stringify(wl), { db: ln, want: wl });
      const mv = sql('rcl', "select string_agg(rate::text, ',' order by id) from store_moves where kind = 'GRN' and no = " + Number(no));
      ok('the stock\'s rate of each line = its net rate (what was really paid, without GST)', mv.split(',').map(Number).join(',') === want.lines.map(l => l.net_rate).join(','), { moves: mv, net: want.lines.map(l => l.net_rate) });
      const lst = (await A.w('grnList', { from: today, to: today })).j.grns.find(g => g.no === no) || {};
      ok('grnList gives the discounts and the net rate to the page', Number(lst.bill_disc) === want.head.bill_disc && (lst.lines || []).every((l, i) => Number(l.net_rate) === want.lines[i].net_rate), lst);
      // ---- the form in a browser ----
      const p = await as('sujit@rcl.test', PW, 'S1', 'grn');
      await p.click('#gr_new'); await until(() => p.$('#gr_lines tr[data-i="0"]'));
      let h = await heads(p);
      ok('the form: # · Item Code · Item · Received Qty · Unit · Basic Rate · Disc. (% or ₹) · Disc. on · GST % · Taxable · GST · Gross · Remark; the bill\'s discount below',
        JSON.stringify(h) === JSON.stringify(['#', 'Item Code', 'Item *', 'Received Qty *', 'Unit', 'Basic Rate ₹', 'Disc. (% or ₹)', 'Disc. on', 'GST %', 'Taxable', 'GST', 'Gross', 'Remark', 'Action']) && !!(await p.$('#gr_bd')) && !!(await p.$('#gr_bdon')), h);
      await set(p, 'gr_sup', 'Bedrok Chem Infra'); await set(p, 'gr_inv', 'DISC-B-FORM');
      await line(p, 0, 'item', label(CEM)); await wait(300);
      const code0 = await p.evaluate(() => (document.querySelector('#gr_lines tr[data-i="0"] .rob.ic') || {}).textContent);
      ok('the item picked: its code in its own box, its name in the item\'s', code0 === CEM && await p.evaluate(() => document.querySelector('#gr_lines tr[data-i="0"] [data-k="item"]').value) === IT[CEM].name, code0);
      await line(p, 0, 'qty', '10'); await line(p, 0, 'rate', '350'); await line(p, 0, 'gst_pct', '28'); await line(p, 0, 'disc', '10%');
      await p.click('#gr_add'); await wait(300);
      await line(p, 1, 'item', label(BAM)); await wait(300); await line(p, 1, 'qty', '100'); await line(p, 1, 'rate', '90'); await line(p, 1, 'gst_pct', '0'); await line(p, 1, 'disc', '500'); await line(p, 1, 'disc_on', 'gst');
      await set(p, 'gr_bd', '2%'); await set(p, 'gr_bdon', 'basic'); await wait(500);
      const sm = await p.evaluate(() => document.getElementById('gr_sum').innerText), money = v => '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      ok('the form\'s sums = the server\'s: Basic, Discount, of it on the bill, Taxable, GST, Gross', sm.includes(money(want.head.basic)) && sm.includes('− ' + money(want.head.disc)) && sm.includes(money(want.head.bill_disc)) && sm.includes(money(want.head.taxable)) && sm.includes(money(want.head.gst)) && sm.includes(money(want.head.gross)), { form: sm, want: want.head });
      const tx = await p.evaluate(() => [...document.querySelectorAll('#gr_lines tbody tr[data-i]')].slice(0, 2).map(tr => [...tr.querySelectorAll('.rob.n')].slice(-3).map(d => d.textContent)));
      ok('…each line\'s Taxable, GST, Gross on the form = the server\'s', JSON.stringify(tx) === JSON.stringify(want.lines.map(l => [money(l.taxable), money(l.gst), money(l.gross)])), { form: tx });
      await shot(p, 'grndisc_b_form');
      await p.click('#gr_save'); await wait(2500);
      const fno = Number(sql('rcl', "select max(no) from store_grn where invoice_no = 'DISC-B-FORM'"));
      const fg = sql('rcl', 'select gross, disc, bill_disc from store_grn where no = ' + fno);
      ok('saved from the form: the same money', fno > 0 && fg === [want.head.gross, want.head.disc, want.head.bill_disc].join('|'), { no: fno, db: fg }); if (fno) made.push(fno);
      // the list's card: the code, the discount and the net rate; the bill's discount
      await p.click('#gr_show'); await wait(2000);
      const card = await p.evaluate(n => { const c = document.querySelector('.grnc[data-no="' + n + '"]'); return c ? { h: [...c.querySelectorAll('thead th')].map(t => t.textContent), top: c.querySelector('header').innerText } : null; }, fno);
      ok('the GRN\'s card: Item Code, Discount ₹, Net Rate; the bill\'s discount at its top', !!card && ['Item Code', 'Discount ₹', 'Net Rate'].every(k => card.h.indexOf(k) > -1) && /Bill discount\s*2% on Basic/i.test(card.top), card);
      await shot(p, 'grndisc_b_list');
      // against a PO: its Qty, what came before, the shortage after this GRN
      const pos = (await A.w('poOpen')).j.pos || [];
      if (!pos.length) ok('a PO to take in against (the story of test/work.test.js)', false, 'no open approved PO');
      else {
        await p.click('#gr_new'); await until(() => p.$('#gr_lines tr[data-i="0"]'));
        await set(p, 'gr_po', String(pos[0].no)); await wait(600);
        h = await heads(p);
        const l0 = (pos[0].lines || []).find(l => l.left > 0) || {};
        await line(p, 0, 'qty', String(Math.max(1, Math.floor(l0.left / 2)))); await wait(400);
        const row = await p.evaluate(() => { const ths = [...document.querySelectorAll('#gr_lines thead th')].map(t => t.textContent.trim()), tds = [...document.querySelectorAll('#gr_lines tr[data-i="0"] td')];
          const at = k => tds[ths.indexOf(k)] ? tds[ths.indexOf(k)].textContent.trim() : null; return { po: at('PO Qty'), before: at('Received before'), short: at('Shortage') }; });
        const n2 = v => Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }), short = Math.round((l0.qty - l0.received - Math.max(1, Math.floor(l0.left / 2))) * 1000) / 1000;
        ok('against PO ' + pos[0].no + ': PO Qty, Received before, Shortage after this GRN (' + n2(short) + ')', h.indexOf('PO Qty') > -1 && h.indexOf('Shortage') > -1 && row.po === n2(l0.qty) && row.before === n2(l0.received) && row.short === (short > 0 ? n2(short) : '0'), { h: h, row: row, line: l0 });
        await shot(p, 'grndisc_b_po');
      }
    }
    ok('no page error', errs.length === 0, errs);
  } finally {
    await b.close();
    for (const n of made) await A.w('grnDelete', { no: n });      // (the rig's story goes on as it was)
  }
  console.log(out.join('\n')); console.log('TOTAL ' + pass + ' passed, ' + fail + ' failed  (' + Math.round((Date.now() - T0) / 1000) + ' s)');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR', e && e.stack); process.exit(1); });
