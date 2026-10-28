/* THE OLD INWARD REGISTER IMPORTED (28-10-2026) through the Store's own door, on the local test rig (never the live databases):
 * the Portal :3010, the Store :3020 started with ANTHROPIC_API_KEY=test-key-s and ANTHROPIC_API_BASE=http://127.0.0.1:3996 (the AI's
 * stand-in – this test starts it), the site database S1 (:3100, rcl – Mechanical's vendors table in it). Test values only.
 *   node test/grnreg.test.js                     a register made here (1,500 rows – every case of his file)
 *   REG_FILE=<his .xlsx> node test/grnreg.test.js  his own file (kept out of the repository) – the same checks, its size measured
 * The page's own reading (public/grnreg.js, the same xlsx tool) and the page's parts (suppliers 500, items 1,000, GRNs 150 / 3,000
 * lines, the AI 250 / 200 / 400 names) – each answer of the server timed (Vercel stops one after 30 s). */
'use strict';
const { execSync } = require('child_process'), path = require('path'), fs = require('fs');
const XLSX = require('../public/vendor/xlsx-0.18.5.full.min.js'), RG = require('../public/grnreg');
const P = 'http://127.0.0.1:3010', ST = 'http://127.0.0.1:3020';
let pass = 0, fail = 0; const out = [], T0 = Date.now();
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 700) : '')); };
const sql = (db, q) => execSync('timeout 120 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q, maxBuffer: 64 * 1024 * 1024 }).toString().trim();
const sqlFile = (db, f) => execSync('timeout 120 su postgres -c "psql -d ' + db + ' -v ON_ERROR_STOP=1 -tA -q"', { input: fs.readFileSync(f) }).toString();
const wait = ms => new Promise(r => setTimeout(r, ms));
function client(base) {
  let cookie = '';
  const req = async (p, body) => {
    const h = { 'Content-Type': 'application/json', 'X-RCL': '1' }; if (cookie) h.Cookie = cookie;
    const t = Date.now(), r = await fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(120000) });
    const sc = r.headers.get('set-cookie'); if (sc) { const v = sc.split(';')[0]; cookie = /=$/.test(v) ? '' : v; }
    let j = {}; try { j = JSON.parse(await r.text()); } catch (e) { j = {}; }
    return { status: r.status, j: j, loc: r.headers.get('location') || '', ms: Date.now() - t };
  };
  return { req };
}
const PW = 'Nashik#Road848!', SAPW = 'Super#Admin2041';
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

const { aiStandin, makeRegister, AILOG, AIBUSY } = require('./regkit');
// the page's reading of a file (regFile in public/work.js)
function readBook(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  return wb.SheetNames.map(n => { const ws = wb.Sheets[n]; return { name: n, r0: ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s.r : 0, aoa: XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) }; });
}

(async () => {
  const ai = await aiStandin(), slow = [];
  try {
    // ---- the start: the Store's steps 1, 2, 3 in S1, its tables empty; the vendors the register made before taken out (test rows only) ----
    const root = path.join(__dirname, '..');
    sqlFile('rcl', path.join(root, 'sql', 'store_step1_items.sql')); sqlFile('rcl', path.join(root, 'sql', 'store_step2_work.sql'));
    sql('rcl', 'truncate public.store_return_lines, public.store_return, public.store_issue_lines, public.store_issue, public.store_grn_lines, public.store_grn, public.store_opening, public.store_po, public.store_req, public.items, public.store_activity cascade; ' +
      "alter sequence public.items_code_seq restart; update public.store_numbers set next_no = 1; notify pgrst, 'reload schema';");
    let r0 = ''; try { sqlFile('rcl', path.join(root, 'sql', 'store_step3_grn_import.sql')); r0 = sqlFile('rcl', path.join(root, 'sql', 'store_step3_grn_import.sql')); } catch (e) { r0 = 'FAULT ' + e.message; }
    sql('rcl', "delete from public.vendors where vendor_type = 'Material Supplier' or remark like 'Material supplier – from the Store%'");      // (the rig's: what an earlier run of this test made)
    ok('the Store\'s step 3 runs twice in a site\'s database without a fault (it only adds)', /Store step 3 done · GRN 0 · next GRN 1/.test(r0), r0);
    await wait(1500);
    sql('rcl_portal', "insert into modules (key, name, url, status, sort) values ('store', 'Store', 'http://127.0.0.1:3020', 'live', 2) on conflict (key) do update set url = excluded.url, status = 'live'; alter table public.access add column if not exists pages jsonb; notify pgrst, 'reload schema';");
    const SA = client(P); let r = await SA.req('/api/auth', { action: 'login', email: 'sa@rcl.test', password: SAPW });
    ok('the Super Admin signs in to the Portal', r.status === 200 && r.j.user && r.j.user.super, r.j);
    for (const [e, s, ro] of [['sujit@rcl.test', 'S1', 'admin'], ['store@rcl.test', 'S1', 'user']]) await SA.req('/api/admin', { action: 'accessSet', email: e, site: s, module: 'store', role: ro });
    await SA.req('/api/admin', { action: 'storePagesSave', email: 'store@rcl.test', site: 'S1', pages: { dashboard: 'View', items: 'Edit', grn: 'Edit', issue: 'Edit', reports: 'View' } });
    const as = async (email, pw) => { const p = client(P); await p.req('/api/auth', { action: 'login', email: email, password: pw }); const t = ((await p.req('/api/go?module=store&site=S1')).loc.split('#sso=')[1] || ''); const s = client(ST); const x = await s.req('/api/sso', { ticket: t }); if (x.status !== 200) throw new Error('sign-in ' + email + ': ' + JSON.stringify(x.j)); return (a, b) => s.req('/api/work', Object.assign({ action: a }, b || {})); };
    const A = await as('sujit@rcl.test', PW), K = await as('store@rcl.test', 'Audit#PassView9!x');
    const timed = async (what, p) => { const x = await p; if (x.ms > 20000) slow.push(what + ' ' + x.ms + ' ms'); return x; };

    // ---- a GRN made in the Store before the import: its GRN No is its number (step 3) ----
    r = await K('regInfo');
    ok('a User cannot import the register (the Store Admin only) – said', r.status === 403 && r.j.code === 'admin', r.j);
    r = await A('regInfo');
    ok('the Store Admin: the Store\'s side of the check – step 3 there, the AI on, the next GRN 1, nothing there yet', r.status === 200 && r.j.step3 === true && r.j.ai === true && r.j.next === 1 && r.j.today === today && Array.isArray(r.j.grns) && r.j.grns.length === 0, r.j);
    r = await A('regItems', { items: [{ name: 'Cement OPC 53', unit: 'Bag', category: 'Cement', gst: 28 }] });
    r = await A('grnSave', { grn: { date: today, supplier: 'Before The Import', invoice_no: 'B-1', lines: [{ code: r.j.added[0][0], qty: 5, rate: 350, gst_pct: 28 }] } });
    ok('a GRN made in the Store before: number 1, its GRN No "1"', r.status === 200 && r.j.no === 1 && sql('rcl', 'select ref from store_grn where no = 1') === '1', r.j);

    // ---- the file read as the page reads it ----
    const own = process.env.REG_FILE, made = own ? null : makeRegister(), t0 = Date.now();
    const sheets = readBook(own ? fs.readFileSync(own) : made.buf), sh = RG.pickSheet(sheets), rows = sh ? RG.readRows(sh) : [];
    ok('the file read as the page reads it: the register\'s sheet (not the Summary), every row (' + rows.length + ' in ' + (Date.now() - t0) + ' ms)', sh && sh.name === 'MAIN SHEET INWARD1' && sh.others.indexOf('Summary') > -1 && rows.length > 1000, sh && [sh.name, sh.others, rows.length]);
    let info = (await A('regInfo')).j;

    // ---- the AI: the page's parts (suppliers 250, items 200, categories 400), the names saved near each part ----
    AIBUSY.n = 1;      // the first answer: busy – the next model
    const names = RG.namesOf(rows), AIL = { party: 'supplier', item: 'item', category: 'category' }, SIZE = { party: 250, item: 200, category: 400 }, fixes = { party: [], item: [], category: [] }, aiMs = [];
    for (const l of Object.keys(AIL)) {
      const list = Object.keys(names[l]).sort((a, b) => RG.keyOf(a).localeCompare(RG.keyOf(b))).map(n => [n, names[l][n]]);
      for (let i = 0; i < list.length; i += SIZE[l]) { const part = list.slice(i, i + SIZE[l]); if (part.length < 2) continue;
        const x = await timed('regNames ' + l, A('regNames', { list: AIL[l], names: part, saved: l === 'item' ? info.items.map(z => z[1]) : [] })); aiMs.push(x.ms);
        if (x.status !== 200) { ok('the AI part ' + l + ' ' + i, false, x.j); break; }
        x.j.fixes.forEach(z => fixes[l].push(z)); }
    }
    const nFix = fixes.party.length + fixes.item.length + fixes.category.length;
    ok('the AI read the names in parts (' + AILOG.length + ' questions, the slowest answer ' + Math.max(...aiMs) + ' ms): busy once – the next model took it; it found names written differently (' + nFix + ')',
      AILOG[0].busy && AILOG[0].model === 'claude-sonnet-5-5' && AILOG[1].model === 'claude-haiku-5-5' && AILOG.filter(x => !x.busy).every(x => x.ok && x.n <= 800) && nFix > 0, [AILOG.slice(0, 3), nFix]);
    if (!own) { const odd = Object.keys(names.item).filter(n => /Hydrolic|Fliter|Bindding/.test(n)), back = n => n.replace('Hydrolic', 'Hydraulic').replace('Fliter', 'Filter').replace('Bindding', 'Binding');
      ok('   every name written differently in the file given its right spelling (e.g. "Hydrolic Oil 10 No" → "Hydraulic Oil 10 No")', odd.length >= 3 && odd.every(n => fixes.item.some(z => z[0] === n && z[1] === back(n))), [odd, fixes.item]); }
    r = await A('regNames', { list: 'x', names: [['a', 1], ['b', 1]] });
    ok('   a list that is not one is refused', r.status === 400, r.j);

    // ---- the check (the page's plan) with every name ticked; the duplicates kept; one corrected row ----
    const ch = { fix: { party: {}, item: {}, category: {} }, gone: {}, edit: {} };
    Object.keys(fixes).forEach(l => fixes[l].forEach(z => { ch.fix[l][z[0]] = z[1]; }));
    let p = RG.plan(rows, info, ch, info.today);
    if (!own) {
      ok('the check: 411 GRNs (GRN No 120 twice – another supplier, day, invoice), 2 without a GRN No, the duplicate rows shown and kept, 3 rows to look at (not a date, no quantity, 20 years early)',
        p.docs.length === 411 && p.noRef === 2 && p.dups.length === made.dup.length && p.look.length === 3 && p.empty.length === 1 && p.docs.filter(d => d.ref === '120').length === 2,
        [p.docs.length, p.noRef, p.dups.length, made.dup.length, p.look.map(l => [l.line, l.why]), p.empty.length]);
      ok('   the next new GRN after the import: after the file\'s highest GRN No (410) and its 2 without a number – 413', p.maxRef === 410 && p.first === 411 && p.next === 413, [p.maxRef, p.first, p.next]);
      const look = p.look.find(l => l.why.some(w => /not a date/.test(w)));
      ch.edit[look.line] = { date: info.today.slice(0, 8) + '01' };
      p = RG.plan(rows, info, ch, info.today);
      ok('   a date typed for a row to look at: its GRN goes in', p.look.length === 2 && p.docs.length === 412, [p.look.length, p.docs.length]);
    }
    const supBefore = Number(sql('rcl', "select count(*) from vendors where vendor_type = 'Material Supplier'"));

    // ---- IMPORT, the page's parts: suppliers 500, items 1,000, GRNs 150 or 3,000 lines – each answer timed ----
    const ti = Date.now(), parts = { sup: 0, item: 0, grn: 0 }, res = { sup: 0, items: 0, saved: 0, skipped: 0, errors: [] };
    for (let i = 0; i < p.newSup.length; i += 500) { const x = await timed('regVendors', A('regVendors', { names: p.newSup.slice(i, i + 500).map(s => s.name) })); parts.sup++; if (x.status !== 200) throw new Error('regVendors ' + JSON.stringify(x.j)); res.sup += x.j.added; }
    for (let i = 0; i < p.newItems.length; i += 1000) { const x = await timed('regItems', A('regItems', { items: p.newItems.slice(i, i + 1000).map(z => ({ name: z.name, unit: z.unit, category: z.category, gst: z.gst })) })); parts.item++; if (x.status !== 200) throw new Error('regItems ' + JSON.stringify(x.j)); res.items += x.j.added.length; }
    const sendAll = async plan => { let part = [], lines = 0; const o = { saved: 0, skipped: 0, errors: [], parts: 0 };
      const send = async () => { const x = await timed('regGrns', A('regGrns', { docs: part.map(d => ({ ref: d.ref, date: d.date, supplier: d.supplier, challan_no: d.challan_no, invoice_no: d.invoice_no, invoice_date: d.invoice_date, vehicle_no: d.vehicle_no, lines: d.lines })) }));
        o.parts++; if (x.status !== 200) throw new Error('regGrns ' + JSON.stringify(x.j).slice(0, 400)); o.saved += x.j.saved.length; o.skipped += x.j.skipped.length; o.errors.push(...x.j.errors); part = []; lines = 0; };
      for (const d of plan.docs) { if (part.length && (part.length >= 150 || lines + d.lines.length > 3000)) await send(); part.push(d); lines += d.lines.length; }
      if (part.length) await send(); return o; };
    const g1 = await sendAll(p); parts.grn = g1.parts;
    const secs = Math.round((Date.now() - ti) / 1000);
    ok('the import: ' + p.newSup.length + ' suppliers, ' + p.newItems.length + ' items, ' + p.docs.length + ' GRNs (' + p.lines + ' lines) in ' + (parts.sup + parts.item + parts.grn) + ' parts, ' + secs + ' s; no answer of the server slower than 20 s',
      res.sup === p.newSup.length && res.items === p.newItems.length && g1.saved === p.docs.length && g1.errors.length === 0 && slow.length === 0, [res, g1.saved, g1.errors.slice(0, 5), slow]);
    const db = sql('rcl', "select count(*) || '|' || coalesce(sum((select count(*) from store_grn_lines l where l.grn_no = g.no)), 0) from store_grn g where no > 1");
    ok('   in the database: every GRN and line of the check (the GRN made before stays)', db === p.docs.length + '|' + p.lines && sql('rcl', "select supplier from store_grn where no = 1") === 'Before The Import', db);
    const refs = sql('rcl', "select string_agg(ref, ',' order by ref) from store_grn where ref in ('342-A', '342 B', '120', '1')"), far = sql('rcl', 'select count(*) from store_grn where no > 1000000000');
    if (!own) ok('   the GRN No as in the file: 342-A, 342 B, 120 twice (the second has a number of its own beyond 1,000,000,000), 1 twice (the Store\'s and the file\'s)',
      refs === '1,1,120,120,342 B,342-A' && Number(far) === 4, [refs, far]);
    const nx = Number(sql('rcl', "select next_no from store_numbers where kind = 'GRN'"));
    ok('   the next GRN goes on after the file\'s highest GRN No and those without a number: ' + p.next, nx === p.next, [nx, p.next]);
    const ven = sql('rcl', "select count(*) || '|' || count(*) filter (where gst_registered = 'No' and pan_number is null and aadhaar_number is null and remark like 'Material supplier%' and owner_site = 'S1') from vendors where vendor_type = 'Material Supplier'");
    ok('   the suppliers in the site\'s Vendor Master (Mechanical\'s): "Material Supplier", GST / PAN / Aadhaar to be filled', ven === (supBefore + p.newSup.length) + '|' + (supBefore + p.newSup.length), ven);
    const it = sql('rcl', "select count(*) || '|' || count(*) filter (where similar_note like 'From the old inward register%') from items");
    ok('   the items in the Item Master (codes ITM-…): ' + p.newItems.length + ' new (and the one made before by the same door)', it === (p.newItems.length + 1) + '|' + (p.newItems.length + 1), it);
    // the stock: an item's GRN quantities in the file = its stock
    const big = p.newItems.slice().sort((a, b) => b.rows - a.rows)[0], want = p.docs.reduce((a, d) => a + d.lines.filter(l => RG.keyOf(l.item) === RG.keyOf(big.name)).reduce((s, l) => s + Number(l.qty), 0), 0);
    const code = sql('rcl', "select code from items where name_key = '" + RG.keyOf(big.name) + "'"), stock = Number(sql('rcl', "select coalesce(sum(q), 0) from store_moves where code = '" + code + "'"));
    ok('   counted in the stock: ' + big.name + ' – ' + Math.round(want * 1000) / 1000 + ' (every GRN of it)', Math.abs(stock - want) < 0.001, [code, stock, want]);

    // ---- again: nothing twice ----
    info = (await A('regInfo')).j;
    const p2 = RG.plan(rows, info, ch, info.today);
    ok('the check again after the import: every GRN already in the Store, no supplier or item new', p2.docs.length === 0 && p2.already.length === p.docs.length && p2.newSup.length === 0 && p2.newItems.length === 0, [p2.docs.length, p2.already.length, p2.newSup.length, p2.newItems.length]);
    const g2 = await sendAll(p);
    ok('   Import pressed again with the same parts (a stop and a start again): every GRN left out – none twice', g2.saved === 0 && g2.skipped === p.docs.length && sql('rcl', 'select count(*) from store_grn') === String(p.docs.length + 1), [g2.saved, g2.skipped]);

    // ---- after: a new GRN gets the next number; the list, the register and the numbers ----
    r = await A('grnSave', { grn: { date: today, supplier: 'After The Import', lines: [{ code: code, qty: 1, rate: 10 }] } });
    ok('a new GRN after the import: number ' + p.next + ', its GRN No the same', r.status === 200 && r.j.no === p.next && sql('rcl', 'select ref from store_grn where no = ' + p.next) === String(p.next), r.j);
    r = await A('numbers');
    ok('   Opening stock & Numbers: the last GRN used ' + p.next + ' (not the numbers of their own beyond 1,000,000,000), the next ' + (p.next + 1), r.j.used.GRN === p.next && r.j.next.GRN === p.next + 1, r.j);
    const d1 = p.docs.find(d => d.ref === '342-A') || p.docs[0];
    r = await A('grnList', { from: d1.date, to: d1.date });
    const lg = (r.j.grns || []).find(g => g.ref === d1.ref);
    ok('the GRN list: the GRN No as in the file (' + d1.ref + '), its lines with their Remark', r.status === 200 && lg && lg.lines.length === d1.lines.length, (r.j.grns || []).map(g => [g.no, g.ref]));
    r = await A('report', { kind: 'grn', from: d1.date, to: d1.date });
    ok('   the GRN register (Excel): his columns, the GRN No as in the file', r.status === 200 && JSON.stringify(r.j.cols.map(c => c.h).slice(0, 17)) === JSON.stringify(RG.HEAD) && r.j.rows.some(x => String(x[1]) === d1.ref), [r.j.cols && r.j.cols.map(c => c.h), (r.j.rows || []).slice(0, 2)]);
    r = await A('report', { kind: 'ledger', code: code, from: '2000-01-01', to: today });
    ok('   the item ledger: "GRN <GRN No>" with the supplier', r.status === 200 && r.j.rows.some(x => /^GRN \S/.test(x[1]) && x[2]), (r.j.rows || []).slice(0, 3));
    r = await A('dash');
    ok('   the Dashboard\'s recent GRNs carry their GRN No', r.status === 200 && r.j.grn && r.j.grn.recent.every(g => g.ref), r.j.grn);
    // ---- the step not run: said (a site where the Admin has not run it yet) ----
    sql('rcl', "alter function public.store_grn_import(jsonb, text, text) rename to store_grn_import_x; notify pgrst, 'reload schema';"); await wait(1200);
    r = await A('regGrns', { docs: [{ ref: '9999', date: today, supplier: 'X Y', lines: [{ item: big.name, qty: 1 }] }] });
    sql('rcl', "alter function public.store_grn_import_x(jsonb, text, text) rename to store_grn_import; notify pgrst, 'reload schema';"); await wait(1200);
    ok('a site where step 3 is not run: Import says to run sql/store_step3_grn_import.sql there', r.status === 400 && /store_step3_grn_import\.sql/.test(r.j.error), r.j);
  } catch (e) { ok('the test ran to its end', false, e && e.stack); }
  ai.close();
  console.log(out.join('\n')); console.log('TOTAL pass=' + pass + ' fail=' + fail + ' secs=' + Math.round((Date.now() - T0) / 1000));
  process.exit(fail ? 1 : 0);
})();
