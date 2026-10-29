/* (29-10-2026) LIVE – another person's save shows by itself, on the local rig (never live) – run after test/work.test.js (its people
 * and items): the Requirements page of view in a browser; sujit saves through the Store's door; the page shows it without a reload. The
 * rhythm: a page with others' entries asks every 2 s; a page without them (Stock & Reports) asks nothing; a hidden tab nothing, and at
 * once when it is seen again; a row's details open – read when they are closed. Two pages of the site on one server: one read of the
 * database for both (the rig door counts).   node test/live.test.js */
'use strict';
const M = '/home/claude/test/node_modules/';
const chromium = require(M + '@sparticuz/chromium').default || require(M + '@sparticuz/chromium'); const puppeteer = require(M + 'puppeteer-core');
const { execSync } = require('child_process');
const P = 'http://127.0.0.1:3010', ST = 'http://127.0.0.1:3020';
let pass = 0, fail = 0; const out = [], T0 = Date.now();
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 500) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < (ms || 20000)) { try { const v = await fn(); if (v) return v; } catch (e) { /* changing */ } await wait(200); } return null; };
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
function client(base) {
  let cookie = '';
  const req = async (p, body) => {
    const h = { 'Content-Type': 'application/json', 'X-RCL': '1' }; if (cookie) h.Cookie = cookie;
    const r = await fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(60000) });
    const sc = r.headers.get('set-cookie'); if (sc) { const v = sc.split(';')[0]; cookie = /=$/.test(v) ? '' : v; }
    let j = {}; try { j = JSON.parse(await r.text()); } catch (e) { j = {}; } return { status: r.status, j: j, loc: r.headers.get('location') || '' };
  };
  return { req };
}
async function storeAs(email, pw, site) {
  const p = client(P); await p.req('/api/auth', { action: 'login', email: email, password: pw });
  const t = ((await p.req('/api/go?module=store&site=' + site)).loc.split('#sso=')[1] || ''), s = client(ST); await s.req('/api/sso', { ticket: t });
  return (action, x) => s.req('/api/work', Object.assign({ action: action }, x || {}));
}
const PW = 'Nashik#Road848!', VPW = 'Audit#PassView9!x';

(async () => {
  const CEM = sql('rcl', "select code from items where name = 'Cement OPC 53'");
  ok('the data of test/work.test.js is there', !!CEM, CEM);
  const A = await storeAs('sujit@rcl.test', PW, 'S1');
  const mk = async (q, more) => (await A('reqSave', Object.assign({ req: { date: today, need_by: '', for_kind: 'Site work', for_text: 'live ' + q, remark: '', lines: [{ code: CEM, qty: q }] } }, more || {}))).j.no;
  let r = await A('live');
  ok('live: a small answer – the site\'s last change (a number)', r.status === 200 && /^\d+$/.test(String(r.j.v)) && JSON.stringify(r.j).length < 60, r);
  const b = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox'], headless: 'shell' });
  const errs = [];
  async function as(email, pw, page) {
    const ctx = await b.createBrowserContext(), p = await ctx.newPage(); p.on('pageerror', e => errs.push(String(e.message).slice(0, 200))); await p.setViewport({ width: 1440, height: 900 });
    p.__live = 0; p.on('request', q => { if (q.method() === 'POST' && /\/api\/work$/.test(q.url()) && /"action":"live"/.test(q.postData() || '')) p.__live++; });
    await p.goto(P + '/', { waitUntil: 'load' }); await p.waitForSelector('#l_email', { visible: true });
    await p.evaluate(async (e, w) => (await fetch('/api/auth', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-RCL': '1' }, body: JSON.stringify({ action: 'login', email: e, password: w }) })).status, email, pw);
    await p.goto(P + '/api/go?module=store&site=S1&page=' + page, { waitUntil: 'load' });
    if (!await until(() => p.url().startsWith(ST) && p.evaluate(() => !document.getElementById('v_app').hidden), 30000)) throw new Error(email + ' could not open the Store');
    await wait(1500); return p;
  }
  const row = (p, n) => p.evaluate(no => !!document.querySelector('#rq_list tr[data-no="' + no + '"]'), n);
  try {
    const V = await as('view@rcl.test', VPW, 'req');
    await until(() => V.evaluate(() => document.querySelectorAll('#rq_list tr[data-no]').length > 0), 15000);
    V.__live = 0; await wait(6200);
    const n6 = V.__live;
    ok('the Requirements page in use: it asks "what changed?" every 2 s (about 3 in 6 s)', n6 >= 2 && n6 <= 4, n6);
    // sujit makes one → view's list shows it by itself
    const n1 = await mk(7), t1 = Date.now();
    const seen = await until(() => row(V, n1), 8000);
    ok('sujit saves a requirement: it shows on view\'s page by itself (no reload) within 4 s', !!seen && Date.now() - t1 <= 4500, [n1, Date.now() - t1]);
    // a row's details open: held until closed
    await V.evaluate(no => document.querySelector('#rq_list tr[data-no="' + no + '"] .rq-det').click(), n1); await wait(300);
    const n2 = await mk(8); await wait(5000);
    const held = !(await row(V, n2)) && await V.evaluate(() => !!document.querySelector('#rq_list tr.det'));
    ok('   a row\'s details open: the list is not drawn again under them (another\'s save waits)', held, held);
    await V.evaluate(no => document.querySelector('#rq_list tr[data-no="' + no + '"] .rq-det').click(), n1);
    ok('   …closed: the waiting change shows within 3 s', !!(await until(() => row(V, n2), 3500)), n2);
    // a hidden tab asks nothing; seen again – at once
    await V.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    V.__live = 0; await wait(5000); const nh = V.__live;
    await V.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await wait(700); const nb = V.__live;
    ok('a hidden tab: nothing asked in 5 s; seen again: asked at once', nh === 0 && nb >= 1, [nh, nb]);
    // a page without others' entries (Stock & Reports): nothing asked
    await V.evaluate(() => { const b2 = document.querySelector('[data-page="reports"]'); if (b2) b2.click(); }); await wait(1500);
    V.__live = 0; await wait(5000);
    ok('Stock & Reports (no one else\'s entries on it): nothing asked', V.__live === 0, V.__live);
    // two pages of the site on one server: one read of the database for both
    await V.evaluate(() => { const b2 = document.querySelector('[data-page="req"]'); if (b2) b2.click(); }); await wait(1500);
    const K = await as('store@rcl.test', VPW, 'req');
    await fetch('http://127.0.0.1:3100/__meter', { method: 'POST' }); V.__live = 0; K.__live = 0; await wait(8000);
    const meter = await (await fetch('http://127.0.0.1:3100/__meter')).json(), reads = (meter.rows || []).filter(x => /store_activity/.test(x.kind)).reduce((a, x) => a + x.calls, 0);
    ok('two pages of the site asking every 2 s (' + (V.__live + K.__live) + ' asks in 8 s): the database read only about once in 2 s for both (' + reads + ')', V.__live + K.__live >= 6 && reads <= Math.ceil((V.__live + K.__live) / 2) + 1, [V.__live, K.__live, reads, meter.rows]);
    ok('no fault in the pages', errs.length === 0, errs);
  } finally { await b.close(); }
})().catch(e => { fail++; out.push('FAIL the test stopped: ' + (e && e.stack || e)); }).finally(() => {
  console.log(out.join('\n')); console.log('TOTAL ' + pass + ' passed, ' + fail + ' failed  (' + Math.round((Date.now() - T0) / 1000) + ' s)'); process.exit(fail ? 1 : 0);
});
