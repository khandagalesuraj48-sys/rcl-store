/* A NEW GRN WITH ITS GRN NO (28-10-2026, "new grn kartana new grn number auto yeil ok ani manually pn edit krta yeil"; his answer: the
 * Store's SQL step 4) through the Store's own door, on the local test rig (never the live databases): the Portal :3010, the Store :3020,
 * the site database S1 (:3100, rcl). Run after test/grnreg.test.js (its step 3, its access). Test values only.
 *   node test/grnno.test.js
 * Before step 4: the form's number (the next) saves as before; a number typed by hand is refused with what to run. Step 4 (twice):
 * the next number; a whole number not used → the GRN's number, the next goes on after it; "342-B" kept as typed (a number of its own);
 * a GRN No already used → refused, nothing saved, the next free one said; nothing typed → the next. */
'use strict';
const { execSync } = require('child_process'), path = require('path'), fs = require('fs');
const P = 'http://127.0.0.1:3010', ST = 'http://127.0.0.1:3020';
let pass = 0, fail = 0; const out = [];
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 700) : '')); };
const sql = (db, q) => execSync('timeout 120 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
const sqlFile = (db, f) => execSync('timeout 120 su postgres -c "psql -d ' + db + ' -v ON_ERROR_STOP=1 -tA -q"', { input: fs.readFileSync(f) }).toString();
const wait = ms => new Promise(r => setTimeout(r, ms));
function client(base) {
  let cookie = '';
  const req = async (p, body) => {
    const h = { 'Content-Type': 'application/json', 'X-RCL': '1' }; if (cookie) h.Cookie = cookie;
    const r = await fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(60000) });
    const sc = r.headers.get('set-cookie'); if (sc) { const v = sc.split(';')[0]; cookie = /=$/.test(v) ? '' : v; }
    let j = {}; try { j = JSON.parse(await r.text()); } catch (e) { j = {}; }
    return { status: r.status, j: j, loc: r.headers.get('location') || '' };
  };
  return { req };
}
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

(async () => {
  try {
    const root = path.join(__dirname, '..');
    sql('rcl', "drop function if exists public.store_grn_new(jsonb, jsonb, text, text, text); notify pgrst, 'reload schema';");      // (a site before step 4)
    await wait(1500);
    const as = async (email, pw) => { const p = client(P); await p.req('/api/auth', { action: 'login', email: email, password: pw }); const t = ((await p.req('/api/go?module=store&site=S1')).loc.split('#sso=')[1] || ''); const s = client(ST); const x = await s.req('/api/sso', { ticket: t }); if (x.status !== 200) throw new Error('sign-in ' + email + ': ' + JSON.stringify(x.j)); return (a, b) => s.req('/api/work', Object.assign({ action: a }, b || {})); };
    const A = await as('sujit@rcl.test', 'Nashik#Road848!'), K = await as('store@rcl.test', 'Audit#PassView9!x');
    let r = await A('regItems', { items: [{ name: 'GRN No Test Bolt M12', unit: 'Nos', category: 'Hardware', gst: 18 }] });
    const IT = (r.j.added && r.j.added[0] && r.j.added[0][0]) || sql('rcl', "select code from items where name = 'GRN No Test Bolt M12'");
    ok('an item for the test (the Store Admin)', /^ITM-\d+$/.test(IT), r.j);
    const grn = (ref, sup) => ({ grn: { ref: ref, date: today, supplier: sup || 'GRN No Test Traders', invoice_no: 'T-' + Math.random().toString(36).slice(2, 7), lines: [{ code: IT, qty: 2, rate: 10, gst_pct: 18 }] } });
    const refOf = no => sql('rcl', 'select ref from store_grn where no = ' + no);

    const g0 = sql('rcl', 'select count(*) from store_grn'), s0 = Number(sql('rcl', "select coalesce(sum(qty), 0) from store_grn_lines where code = '" + IT + "'"));
    // ---- before step 4 ----
    r = await K('grnNext');
    const n1 = r.j.next;
    ok('the new GRN\'s form (a User with GRN Edit): the next GRN No; step 4 not there yet', r.status === 200 && Number.isInteger(n1) && n1 > 0 && r.j.step4 === false, r.j);
    r = await K('grnSave', grn(String(n1)));
    ok('   saved with the number as it came: GRN ' + n1 + ', its GRN No "' + n1 + '"', r.status === 200 && r.j.no === n1 && r.j.ref === String(n1) && refOf(n1) === String(n1), r.j);
    r = await K('grnSave', grn('900000'));
    ok('   a number typed by hand: refused – the Admin runs sql/store_step4_grn_no.sql (nothing saved)', r.status === 400 && /store_step4_grn_no\.sql/.test(r.j.error) && sql('rcl', "select count(*) from store_grn where ref = '900000'") === '0', r.j);

    // ---- step 4 ----
    let r0 = ''; try { sqlFile('rcl', path.join(root, 'sql', 'store_step4_grn_no.sql')); r0 = sqlFile('rcl', path.join(root, 'sql', 'store_step4_grn_no.sql')); } catch (e) { r0 = 'FAULT ' + e.message; }
    ok('the Store\'s step 4 runs twice in a site\'s database without a fault (it only adds)', /Store step 4 done · next GRN \d+/.test(r0), r0);
    await wait(1500);
    r = await K('grnNext');
    const n2 = r.j.next;
    ok('after step 4: the next GRN No (' + n2 + '), step 4 there', r.status === 200 && n2 === n1 + 1 && r.j.step4 === true, r.j);
    r = await K('grnSave', grn(String(n2)));
    ok('   the number as it came: GRN ' + n2, r.status === 200 && r.j.no === n2 && refOf(n2) === String(n2), r.j);
    const big = n2 + 500;
    r = await K('grnSave', grn(String(big)));
    ok('   a higher whole number typed (' + big + '): it is the GRN\'s number, its GRN No', r.status === 200 && r.j.no === big && r.j.ref === String(big) && refOf(big) === String(big), r.j);
    r = await K('grnNext');
    ok('   the next new GRN goes on after it: ' + (big + 1), r.j.next === big + 1, r.j);
    r = await K('grnSave', grn(String(big)));
    ok('   the same GRN No again: refused – "already used", the next free number said; nothing saved', r.status === 409 && r.j.code === 'refused' && /GRN No \d+ is already used/.test(r.j.error) && r.j.next === big + 1 && sql('rcl', "select count(*) from store_grn where ref = '" + big + "'") === '1', r.j);
    r = await K('grnSave', grn('342-b'));
    const far = r.j.no;
    ok('   "342-b" typed: kept as typed, the GRN a number of its own (beyond 1,000,000,000); the next not moved', r.status === 200 && far > 1e9 && refOf(far) === '342-b' && (await K('grnNext')).j.next === big + 1, r.j);
    r = await K('grnSave', grn('342-B'));
    ok('   "342-B" (the same, in capitals): refused', r.status === 409 && r.j.code === 'refused', r.j);
    const low = n1 - 1 > 0 && sql('rcl', 'select count(*) from store_grn where no = ' + (n1 - 1) + " or ref = '" + (n1 - 1) + "'") === '0' ? n1 - 1 : null;
    if (low) { r = await K('grnSave', grn(String(low))); ok('   a lower whole number not used (' + low + '): the GRN\'s number; the next stays ' + (big + 1), r.status === 200 && r.j.no === low && (await K('grnNext')).j.next === big + 1, r.j); }
    r = await K('grnSave', grn(''));
    ok('   nothing typed: the next number (' + (big + 1) + ')', r.status === 200 && r.j.no === big + 1 && refOf(big + 1) === String(big + 1), r.j);
    r = await K('grnSave', grn('12/A#'));
    ok('   a GRN No with other signs: refused – said which', r.status === 400 && /letters, digits/.test(r.j.error), r.j);
    ok('   every GRN of this test has its GRN No; the stock of the item counted (all saved GRNs)', Number(sql('rcl', 'select count(*) from store_grn')) === Number(g0) + 5 + (low ? 1 : 0) && Number(sql('rcl', "select coalesce(sum(qty), 0) from store_grn_lines where code = '" + IT + "'")) === s0 + 2 * (5 + (low ? 1 : 0)), sql('rcl', "select count(*) from store_grn_lines where code = '" + IT + "'"));
    r = await K('grnSave', { no: big, grn: Object.assign(grn('77777').grn, { date: today }) });
    ok('   changing a GRN (the Store Admin only) – a User: refused; its GRN No stays', r.status === 403 && refOf(big) === String(big), r.j);
  } catch (e) { ok('the test ran to its end', false, e.stack || String(e)); }
  console.log(out.join('\n'));
  console.log('TOTAL pass=' + pass + ' fail=' + fail);
  process.exit(fail ? 1 : 0);
})();
