/* (29-10-2026) A REQUIREMENT'S PHOTOS on the local test rig (never the live databases) – run after test/work.test.js (its items, people
 * and access). PART=a: a site BEFORE the Store's step 7 (the photos refused with what to run; a requirement as before). PART=b: after it
 * (the rig's runner runs step 7 between the parts and starts the Store again): sent, kept once under the fingerprint, taken by a save
 * only with the sender's proof, changed, added after approval, seen (15-minute links) – by HO Purchase of another site too – and in the
 * browser: the form's photos, the list's Photos, seen big, added, printed (test/shots/reqphoto_*.png).   PART=b node test/reqphoto.test.js */
'use strict';
const { execSync } = require('child_process'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const P = 'http://127.0.0.1:3010', ST = 'http://127.0.0.1:3020';
const PART = process.env.PART || 'b';
const STORE = '/home/claude/rig/storage';      // (the rig's stand-in for Supabase Storage of S1)
const SHOTS = path.join(process.env.SHOTS || path.join(__dirname, 'shots')); fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0; const out = [], T0 = Date.now();
const ok = (n, c, x) => { c ? pass++ : fail++; out.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined && !c ? '  → ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 600) : '')); };
const sql = (db, q) => execSync('timeout 60 su postgres -c "psql -d ' + db + ' -tA -q"', { input: q }).toString().trim();
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < (ms || 20000)) { try { const v = await fn(); if (v) return v; } catch (e) { /* changing */ } await wait(300); } return null; };
// a test photo (a JPEG or PNG of one colour, w × h) – made with the rig's Python
const pic = (rgb, w, h, kind) => Buffer.from(execSync('timeout 30 python3 -c "import io,sys; from PIL import Image, ImageDraw; im=Image.new(\'RGB\',(' + w + ',' + h + '),(' + rgb.join(',') + ')); d=ImageDraw.Draw(im); d.rectangle([' + (w >> 2) + ',' + (h >> 2) + ',' + (w >> 1) + ',' + (h >> 1) + '],fill=(255,255,255)); b=io.BytesIO(); im.save(b,\'' + (kind || 'JPEG') + '\'); sys.stdout.write(b.getvalue().hex())"').toString(), 'hex');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const jpg = b => 'data:image/jpeg;base64,' + b.toString('base64');
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
  const t = ((await p.req('/api/go?module=store&site=' + site)).loc.split('#sso=')[1] || ''), s = client(ST), r = await s.req('/api/sso', { ticket: t });
  if (r.status !== 200) throw new Error('Store sign-in of ' + email + ' at ' + site + ': ' + JSON.stringify(r.j));
  return (action, x) => s.req('/api/work', Object.assign({ action: action }, x || {}));
}
const PW = 'Nashik#Road848!', VPW = 'Audit#PassView9!x';
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

(async () => {
  const CEM = sql('rcl', "select code from items where name = 'Cement OPC 53'"), OIL = sql('rcl', "select code from items where name = 'Engine Oil 15W40'");
  ok('the data of test/work.test.js is there (its items)', !!(CEM && OIL), [CEM, OIL]);
  const V = await storeAs('view@rcl.test', VPW, 'S1'), A = await storeAs('sujit@rcl.test', PW, 'S1'), K = await storeAs('store@rcl.test', VPW, 'S1'), B = await storeAs('sujit@rcl.test', PW, 'T2');
  const req = (lines, more) => Object.assign({ req: { date: today, need_by: '', for_kind: 'Site work', for_text: 'Ch 546+100 culvert', remark: 'photo test', lines: lines } }, more || {});
  const col = () => sql('rcl', "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'store_req' and column_name = 'photos'");
  const P1 = pic([200, 40, 40], 320, 240), P2 = pic([40, 160, 60], 300, 400), P3 = pic([30, 60, 200], 280, 210), P4 = pic([220, 180, 20], 260, 200);
  let r;
  if (PART === 'a') {
    ok('(a) the rig\'s S1 is as a site before step 7: store_req has no photos column', col() === '0', col());
    r = await V('reqPhotoUp', { data: jpg(P1) });
    ok('(a) a photo sent before step 7: refused, with what to run (sql/store_step7_req_photos.sql in every site)', r.status === 400 && r.j.code === 'sql' && /store_step7_req_photos\.sql/.test(r.j.error), r);
    r = await V('reqList');
    ok('(a) the list says photos cannot be added yet (step7 false) – the requirements as before', r.status === 200 && r.j.step7 === false && Array.isArray(r.j.reqs), r.j.step7);
    r = await V('reqSave', req([{ code: CEM, qty: 3 }], { photos: [] }));
    ok('(a) a requirement saved from the new page (no photo: an empty list) – as before', r.status === 200 && r.j.ok, r);
    r = await V('reqSave', req([{ code: CEM, qty: 3 }]));
    ok('(a) …and from an older page / app (no photos sent)', r.status === 200 && r.j.ok, r);
    r = await V('reqSave', req([{ code: CEM, qty: 3 }], { photos: [{ sha: sha(P1), size: P1.length, t: 'x' }] }));
    ok('(a) a requirement with a photo before step 7: refused with what to run – nothing saved', r.status === 400 && r.j.code === 'sql', r);
  } else {
    ok('(b) step 7 is run in S1: store_req.photos is there; every requirement of before has an empty list', col() === '1' && sql('rcl', "select count(*) from store_req where photos <> '[]'::jsonb") === '0', col());
    ok('(b) the bucket erp-files (Mechanical\'s) stays private, its limit as it was (step 7 did not change it)', sql('rcl', "select public || '|' || file_size_limit from storage.buckets where id = 'erp-files'") === 'false|10485760', sql('rcl', "select row_to_json(b) from storage.buckets b where id = 'erp-files'"));
    // ---- sent ----
    r = await V('reqPhotoUp', { data: jpg(P1) });
    const f1 = path.join(STORE, 'erp-files', 'store', 'req', sha(P1).slice(0, 2), sha(P1) + '.jpg');
    ok('a photo sent: kept under its fingerprint (SHA-256) – store/req/<2>/<sha>.jpg in the site\'s file store, the same bytes; its size and proof back',
      r.status === 200 && r.j.sha === sha(P1) && r.j.size === P1.length && /^[0-9a-f]{40}$/.test(r.j.t) && fs.existsSync(f1) && fs.readFileSync(f1).equals(P1), [r, fs.existsSync(f1)]);
    const p1 = { sha: r.j.sha, size: r.j.size, t: r.j.t };
    r = await V('reqPhotoUp', { data: jpg(P1) });
    ok('   the same photo again: the same fingerprint (kept once – not twice)', r.status === 200 && r.j.sha === p1.sha, r);
    r = await V('reqPhotoUp', { data: 'data:image/jpeg;base64,' + pic([1, 2, 3], 40, 40, 'PNG').toString('base64') });
    ok('   a PNG sent as a JPG: refused ("not a real JPG photo")', r.status === 400 && /not a real JPG/.test(r.j.error), r);
    r = await V('reqPhotoUp', { data: 'data:image/png;base64,' + pic([1, 2, 3], 40, 40, 'PNG').toString('base64') });
    ok('   not a JPG at all: refused', r.status === 400 && /must be a JPG/.test(r.j.error), r);
    r = await V('reqPhotoUp', { data: jpg(Buffer.concat([P1, Buffer.alloc(2200000, 7)])) });
    ok('   bigger than 2 MB: refused (the page / the app make a photo smaller first)', r.status === 400 && /too big/.test(r.j.error), r);
    r = await K('reqPhotoUp', { data: jpg(P2) });
    ok('   one with Requirements View only (store): refused – sending a photo needs Edit', r.status === 403, r);
    const p2 = (await V('reqPhotoUp', { data: jpg(P2) })).j, p3 = (await V('reqPhotoUp', { data: jpg(P3) })).j;
    // ---- a new requirement with two photos ----
    r = await V('reqSave', req([{ code: CEM, qty: 5 }, { code: OIL, qty: 2 }], { photos: [p1, { sha: p2.sha, size: p2.size, t: p2.t }] }));
    const n1 = r.j.no, row = () => JSON.parse(sql('rcl', 'select photos::text from store_req where no = ' + n1) || '[]');
    ok('a new requirement with two photos: saved – the list keeps each photo\'s fingerprint, size, who (View User) and when', r.status === 200 && r.j.ok && !r.j.photoNote &&
      JSON.stringify(row().map(p => [p.sha, p.size, p.by])) === JSON.stringify([[p1.sha, P1.length, 'View User'], [p2.sha, P2.length, 'View User']]) && row().every(p => /^\d{4}-\d\d-\d\dT/.test(p.at)), [r, row()]);
    ok('   its activity is noted (Requirement made, 2 photos)', sql('rcl', "select count(*) from store_activity where action = 'Requirement made' and target = 'REQ " + n1 + "' and detail::text like '%\"photos\": 2%'") === '1', sql('rcl', "select detail::text from store_activity where target = 'REQ " + n1 + "'"));
    r = await A('reqSave', req([{ code: CEM, qty: 1 }], { photos: [p3] }));
    ok('   another person\'s photo (its proof is View User\'s): refused for sujit – nothing saved', r.status === 400 && /not added from this page \(or by you\)/.test(r.j.error), r);
    r = await V('reqSave', req([{ code: CEM, qty: 1 }], { photos: [{ sha: p3.sha, size: p3.size, t: '0'.repeat(40) }] }));
    ok('   a made-up proof: refused', r.status === 400 && /not added from this page/.test(r.j.error), r);
    r = await V('reqSave', req([{ code: CEM, qty: 1 }], { photos: [p1, p1] }));
    ok('   the same photo twice: refused', r.status === 400 && /twice/.test(r.j.error), r);
    r = await V('reqSave', req([{ code: CEM, qty: 1 }], { photos: Array.from({ length: 11 }, () => p1) }));
    ok('   more than 10 photos: refused', r.status === 400 && /at most 10 photos/.test(r.j.error), r);
    r = await V('reqList');
    const x1 = (r.j.reqs || []).find(q => q.no === n1);
    ok('the list: step7 true; the requirement with its 2 photos (no links in the list)', r.j.step7 === true && x1 && x1.photos.length === 2 && !x1.photos[0].url, x1 && x1.photos);
    r = await K('reqPhotos', { no: n1 });
    const u1 = r.j.photos && r.j.photos[0] && r.j.photos[0].url;
    let bytes = null; try { bytes = Buffer.from(await (await fetch(u1, { signal: AbortSignal.timeout(15000) })).arrayBuffer()); } catch (e) { bytes = null; }
    ok('its photos with their links (15 minutes) – for store (an approver, Requirements View); the link gives the photo itself', r.status === 200 && r.j.photos.length === 2 && /\/storage\/v1\/object\/sign\/erp-files\/store\/req\//.test(u1) && !!bytes && bytes.equals(P1), [r.j, bytes && bytes.length]);
    // ---- changed while nobody approved it ----
    r = await V('reqSave', Object.assign(req([{ code: CEM, qty: 5 }, { code: OIL, qty: 2 }], { photos: [{ sha: p2.sha }] }), { no: n1 }));
    ok('Change (it waits, nobody approved): one photo taken out – the one left as it was (who, when); a photo it has needs no proof', r.status === 200 && row().length === 1 && row()[0].sha === p2.sha && row()[0].by === 'View User', [r, row()]);
    r = await V('reqSave', Object.assign(req([{ code: CEM, qty: 6 }, { code: OIL, qty: 2 }]), { no: n1 }));
    ok('   changed from an older page / app (no photos sent): its photos stay', r.status === 200 && row().length === 1, [r, row()]);
    // ---- approved: photos added (who made it, the Store Admin) ----
    r = await K('reqDecide', { no: n1, ok: true }); const r2 = await A('reqDecide', { no: n1, ok: true });
    ok('approved at level 1 (store) and level 2 (sujit)', r.status === 200 && r2.status === 200 && sql('rcl', 'select status from store_req where no = ' + n1) === 'Approved', [r.j, r2.j]);
    r = await V('reqSave', Object.assign(req([{ code: CEM, qty: 6 }], { photos: [{ sha: p2.sha }] }), { no: n1 }));
    ok('   approved: the requirement is not changed any more (as before) – photos neither by Change', r.status === 409, r);
    r = await V('reqPhotoAdd', { no: n1, photos: [{ sha: p3.sha, size: p3.size, t: p3.t }] });
    ok('   who made it adds a photo to it (made on the laptop – the photo taken with the phone): 2 now', r.status === 200 && r.j.photos === 2 && row().map(p => p.sha).join() === [p2.sha, p3.sha].join(), [r, row()]);
    const p4 = (await A('reqPhotoUp', { data: jpg(P4) })).j;
    r = await A('reqPhotoAdd', { no: n1, photos: [{ sha: p4.sha, size: p4.size, t: p4.t }] });
    ok('   the Store Admin (sujit) adds one too: 3 – each with who added it', r.status === 200 && r.j.photos === 3 && row()[2].by === 'Sujit Test', [r, row()]);
    r = await K('reqPhotoAdd', { no: n1, photos: [{ sha: p4.sha }] });
    ok('   store (Requirements View, not its maker): refused', r.status === 403, r);
    r = await V('reqPhotoAdd', { no: n1, photos: [{ sha: p3.sha }] });
    ok('   a photo it has already: "Add a photo first" – nothing changed', r.status === 400 && /Add a photo first/.test(r.j.error) && row().length === 3, r);
    ok('   noted in its activity (Requirement photos added)', sql('rcl', "select count(*) from store_activity where action = 'Requirement photos added' and target = 'REQ " + n1 + "'") === '2');
    // ---- HO Purchase sees them from another site ----
    r = await B('purPending');
    const s1 = (r.j.sites || []).find(q => q.site === 'S1'), inPur = s1 && s1.reqs.find(q => q.no === n1);
    ok('HO Purchase (sujit at T2): the approved requirement in Purchase – every site, with its 3 photos', !!inPur && (inPur.photos || []).length === 3, s1 && s1.reqs.map(q => q.no));
    r = await B('reqPhotos', { site: 'S1', no: n1 });
    ok('   …and their links (another site – HO Purchase only)', r.status === 200 && r.j.photos.length === 3 && r.j.photos.every(p => p.url), r.j);
    r = await V('reqPhotos', { site: 'T2', no: 1 });
    ok('   another site\'s photos for one who is not HO Purchase: refused', r.status === 403, r);
    // ---- cancelled: no photo added ----
    const n2 = (await V('reqSave', req([{ code: OIL, qty: 1 }]))).j.no; await V('reqCancel', { no: n2 });
    const p5 = (await V('reqPhotoUp', { data: jpg(pic([90, 90, 90], 200, 150)) })).j;
    r = await V('reqPhotoAdd', { no: n2, photos: [p5] });
    ok('a cancelled requirement: no photo added ("only while it waits or is approved")', r.status === 409 && /only while it waits or is approved/.test(r.j.error), r);
    r = await V('reqSave', req([{ code: OIL, qty: 1 }]));
    ok('a new requirement from an older page / app (no photos): its list empty', r.status === 200 && sql('rcl', 'select photos::text from store_req where no = ' + r.j.no) === '[]', r);

    // ================= THE BROWSER =================
    const M = '/home/claude/test/node_modules/';
    const chromium = require(M + '@sparticuz/chromium').default || require(M + '@sparticuz/chromium'); const puppeteer = require(M + 'puppeteer-core');
    const b = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox'], headless: 'shell', protocolTimeout: 120000 });
    const errs = [];
    async function as(email, pw, site, page, width) {
      const ctx = await b.createBrowserContext(), p = await ctx.newPage(); p.on('pageerror', e => errs.push(email + ': ' + String(e.message).slice(0, 200))); await p.setViewport({ width: width || 1440, height: 900 });
      await p.goto(P + '/', { waitUntil: 'load' }); await p.waitForSelector('#l_email', { visible: true });
      const st = await p.evaluate(async (e, w) => (await fetch('/api/auth', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-RCL': '1' }, body: JSON.stringify({ action: 'login', email: e, password: w }) })).status, email, pw);
      if (st !== 200) throw new Error('the Portal sign-in of ' + email + ': ' + st);
      await p.goto(P + '/api/go?module=store&site=' + site + '&page=' + page, { waitUntil: 'load' });
      if (!await until(() => p.url().startsWith(ST) && p.evaluate(() => !document.getElementById('v_app').hidden), 30000)) throw new Error(email + ' could not open the Store');
      await wait(1500); return p;
    }
    const line = (p, i, k, v) => p.evaluate((n, key, x) => { const e = document.querySelector('#rq_lines tr[data-i="' + n + '"] [data-k="' + key + '"]'); e.value = x; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, i, k, v);
    const toast = p => p.evaluate(() => { const t = document.getElementById('toast'); return t && !t.hidden ? t.textContent : ''; });
    const label = code => sql('rcl', "select code || ' · ' || name || ' (' || unit || ')' from items where code = '" + code + "'");
    const tmp = path.join(SHOTS, 'reqphoto_in'); fs.mkdirSync(tmp, { recursive: true });
    const big = path.join(tmp, 'site-photo.jpg'), png = path.join(tmp, 'material.png');
    fs.writeFileSync(big, pic([150, 110, 70], 3200, 2400)); fs.writeFileSync(png, pic([70, 120, 170], 900, 700, 'PNG'));
    try {
      const W1 = await as('view@rcl.test', VPW, 'S1', 'req');
      await W1.click('#rq_new'); await wait(500);
      const box = await W1.evaluate(() => { const e = document.querySelector('#rq_photos .phbox'); return e ? e.innerText : ''; });
      ok('browser: the requirement form has "Photos of the material – optional – up to 10 photos" and "📷 Add photos"', /Photos of the material/.test(box) && /optional – up to 10 photos/.test(box) && /Add photos/.test(box), box);
      await line(W1, 0, 'item', label(CEM)); await line(W1, 0, 'qty', '12');
      const inp = await W1.$('#rq_photos input[type=file]'); await inp.uploadFile(big, png);
      const tiles = await until(() => W1.evaluate(() => { const t = [...document.querySelectorAll('#rq_photos .phtile')]; return t.length === 2 && !document.querySelector('#rq_photos .phspin') && t.every(x => x.querySelector('img') && x.querySelector('img').naturalWidth > 0) ? t.length : 0; }), 30000);
      ok('   two photos picked (a 3200 × 2400 JPG, a PNG): sent at once, two tiles with the pictures, "2 of 10"', tiles === 2 && /2 of 10/.test(await W1.evaluate(() => document.querySelector('#rq_photos .phhead').innerText)), [tiles, errs]);
      await W1.screenshot({ path: path.join(SHOTS, 'reqphoto_form.png') });
      await W1.evaluate(() => document.querySelector('#rq_photos img[data-v="0"]').click()); await wait(500);
      const v1 = await W1.evaluate(() => { const o = document.getElementById('ph_view'); return o ? { t: o.querySelector('.phbar span').textContent, w: o.querySelector('img').naturalWidth } : null; });
      ok('   a tile opens the photo big ("1 / 2"); Esc closes it', v1 && /^1 \/ 2/.test(v1.t) && v1.w > 0, v1);
      await W1.keyboard.press('Escape'); await wait(300);
      const n0 = Number(sql('rcl', 'select max(no) from store_req'));
      await W1.click('#rq_save'); await wait(2500);
      const n3 = Number(sql('rcl', 'select max(no) from store_req')), ph3 = JSON.parse(sql('rcl', 'select photos::text from store_req where no = ' + n3) || '[]');
      const dims = ph3.map(p => execSync('timeout 20 python3 -c "from PIL import Image; im=Image.open(\'' + path.join(STORE, 'erp-files', 'store', 'req', p.sha.slice(0, 2), p.sha + '.jpg') + '\'); print(im.format, im.size[0], im.size[1])"').toString().trim());
      ok('   saved: the requirement with its 2 photos – each a JPEG, the big one made 1600 × 1200 (the page makes it smaller), a few hundred KB at most', n3 === n0 + 1 && ph3.length === 2 && dims[0] === 'JPEG 1600 1200' && /^JPEG 900 700$/.test(dims[1]) && ph3.every(p => p.size < 1200000), [dims, ph3, await toast(W1)]);
      // the list: 📷 and Photos
      const li = await until(() => W1.evaluate(n => { const tr = document.querySelector('#rq_list tr[data-no="' + n + '"]'); return tr && tr.querySelector('.rq-ph') ? { t: tr.innerText, b: tr.querySelector('.rq-ph').textContent } : null; }, n3), 15000);
      ok('   in the list: "📷 2 photos" with its items, and "Photos (2)"', li && /📷 2 photos/.test(li.t) && li.b === 'Photos (2)', li);
      await W1.evaluate(n => document.querySelector('#rq_list tr[data-no="' + n + '"] .rq-ph').click(), n3);
      const row1 = await until(() => W1.evaluate(() => { const d = document.querySelector('#rq_list tr.phrow'); if (!d) return null; const im = [...d.querySelectorAll('img')]; return im.length && im.every(i => i.naturalWidth > 0) ? { n: im.length, t: d.innerText, add: !!d.querySelector('input[type=file]') } : null; }), 20000);
      ok('   Photos: the row under it with both photos (through their links), who added them, and "Add photos" (he made it)', row1 && row1.n === 2 && /View User/.test(row1.t) && row1.add, row1);
      await W1.screenshot({ path: path.join(SHOTS, 'reqphoto_list.png') });
      const ip2 = await W1.$('#rq_list tr.phrow input[type=file]'); const add1 = path.join(tmp, 'later.jpg'); fs.writeFileSync(add1, pic([200, 60, 160], 640, 480)); await ip2.uploadFile(add1);
      const after = await until(() => { const v = JSON.parse(sql('rcl', 'select photos::text from store_req where no = ' + n3) || '[]'); return v.length === 3 ? v : null; }, 20000);
      const row2 = await until(() => W1.evaluate(() => { const d = document.querySelector('#rq_list tr.phrow'); const im = d ? [...d.querySelectorAll('img')] : []; return im.length === 3 && im.every(i => i.naturalWidth > 0) ? 3 : 0; }), 20000);
      ok('   "Add photos" on a requirement made already: the photo sent and added – 3 photos, shown at once', !!after && row2 === 3 && /1 photo added to requirement/.test(await toast(W1)), [after, row2, await toast(W1)]);
      // the print: the form, then its photos
      const n0f = await W1.evaluate(() => document.querySelectorAll('iframe').length);
      await W1.evaluate(n => document.querySelector('#rq_list tr[data-no="' + n + '"] .rq-print').click(), n3);
      const html = await until(() => W1.evaluate(n => { const f = [...document.querySelectorAll('iframe')]; if (f.length <= n) return null; const d = f[f.length - 1].contentDocument; return d && d.body && d.body.innerHTML.length > 200 ? d.documentElement.outerHTML : null; }, n0f), 20000);
      const q = await b.createBrowserContext().then(c => c.newPage()); await q.setViewport({ width: 794, height: 1123 }); await q.setContent(html || '<p>no print</p>', { waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
      const pr = await q.evaluate(() => ({ t: document.body.innerText, imgs: [...document.querySelectorAll('figure img')].map(i => i.naturalWidth) }));
      await q.screenshot({ path: path.join(SHOTS, 'reqphoto_print.png'), fullPage: true }); try { await q.pdf({ path: path.join(SHOTS, 'reqphoto_print.pdf'), format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } }); } catch (e) { /* no PDF here */ }
      ok('   Print: the Purchase Requisition Form, then "Photos of the material – … (3)" – the 3 photos (loaded), "Photo 1 · View User · <date>"', /Purchase Requisition Form/.test(pr.t) && /Photos of the material – .*\(3\)/.test(pr.t) && pr.imgs.length === 3 && pr.imgs.every(w => w > 0) && /Photo 1 · View User · \d\d-\d\d-\d{4}/.test(pr.t), pr);
      // the change form: its photos with their links; one taken out
      await W1.evaluate(n => { const b2 = document.querySelector('#rq_list tr[data-no="' + n + '"] .rq-edit'); if (b2) b2.click(); }, n3); await wait(300);
      const cf = await until(() => W1.evaluate(() => { const t = [...document.querySelectorAll('#rq_photos .phtile img')]; return t.length === 3 && t.every(i => i.naturalWidth > 0) ? 3 : 0; }), 20000);
      ok('   Change (nobody approved it yet): the form shows its 3 photos', cf === 3, cf);
      await W1.evaluate(() => document.querySelector('#rq_photos [data-x="0"]').click()); await wait(200);
      await W1.click('#rq_save'); await wait(2500);
      const after2 = JSON.parse(sql('rcl', 'select photos::text from store_req where no = ' + n3) || '[]');
      ok('   one taken out (✕) and saved: 2 photos – the first one gone, the others as they were', after2.length === 2 && after2[0].sha === after[1].sha && after2[1].sha === after[2].sha, [after2.map(p => p.sha.slice(0, 6)), after.map(p => p.sha.slice(0, 6))]);
      // HO Purchase of T2: the photos of S1's approved requirement
      const H = await as('sujit@rcl.test', PW, 'T2', 'purchase');
      const pb = await until(() => H.evaluate(n => { const x = document.querySelector('#pu_sites .pu-ph[data-site="S1"][data-req="' + n + '"]'); return x ? x.textContent : null; }, n1), 20000);
      ok('browser – HO Purchase (at T2): the approved requirement of S1 shows "📷 3"', pb === '📷 3', pb);
      await H.evaluate(n => document.querySelector('#pu_sites .pu-ph[data-site="S1"][data-req="' + n + '"]').click(), n1);
      const hv = await until(() => H.evaluate(() => { const o = document.getElementById('ph_view'); return o && o.querySelector('img').naturalWidth > 0 ? o.querySelector('.phbar span').textContent : null; }), 20000);
      ok('   pressed: its photos big ("1 / 3 · View User …") – ‹ › to the others', hv && /^1 \/ 3 · View User/.test(hv), hv);
      await H.evaluate(() => document.querySelector('#ph_view .phnext').click()); await wait(300);
      ok('   › the next one: "2 / 3"', /^2 \/ 3/.test(await H.evaluate(() => document.querySelector('#ph_view .phbar span').textContent)));
      await H.screenshot({ path: path.join(SHOTS, 'reqphoto_view.png') });
      // a phone's width
      const Ph = await as('view@rcl.test', VPW, 'S1', 'req', 390);
      await Ph.click('#rq_new'); await wait(400);
      const ip3 = await Ph.$('#rq_photos input[type=file]'); await ip3.uploadFile(big);
      await until(() => Ph.evaluate(() => { const i = document.querySelector('#rq_photos .phtile img'); return i && i.naturalWidth > 0; }), 30000);
      const wide = await Ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
      await Ph.screenshot({ path: path.join(SHOTS, 'reqphoto_phone.png'), fullPage: false });
      ok('   a phone\'s width (390 px): the photos\' box fits – nothing wider than the screen', wide, wide);
      ok('no fault in the pages', errs.length === 0, errs);
    } finally { await b.close(); }
  }
})().catch(e => { fail++; out.push('FAIL the test stopped: ' + (e && e.stack || e)); }).finally(() => {
  console.log(out.join('\n')); console.log('TOTAL ' + pass + ' passed, ' + fail + ' failed  (' + Math.round((Date.now() - T0) / 1000) + ' s)'); process.exit(fail ? 1 : 0);
});
