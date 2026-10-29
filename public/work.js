/* THE STORE'S WORK – the pages of step 2 (28-10-2026: "sagle banwayla chalu kr"): Material Requirements (and their approvals, level by
 * level), Purchase (all sites – HO Purchase), Purchase Orders, Inward (GRN), Issue & Return, Stock & Reports, Opening stock & Numbers.
 * The same look and the same sign-in as the Item Master (index.html gives its kit: window.RS). Every save is checked again by the server
 * (api/work.js) and inside the database (one save at a time, the stock never below zero on any date). Simple screens: a list, and a form
 * that opens above it. */
(function () {
  'use strict';
  const K = () => window.RS;
  const $ = id => document.getElementById(id), esc = s => K().esc(s);
  const W = (action, x) => K().api('api/work', Object.assign({ action: action }, x || {}));
  let B = null;      // what the pages need (the items, the stock, the machinery, the names typed before, who approves)
  const n2 = v => v === '' || v === null || v === undefined ? '' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
  const money = v => '₹' + Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const a2 = v => v === '' || v === null || v === undefined ? '' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });      // (an amount in a list: 2 decimals)
  const dmy = d => d ? String(d).slice(0, 10).split('-').reverse().join('-') : '';
  const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  // (29-10-2026) a page left open past midnight: its lists (and "today") are read again on the new day – a Store User's date is today's
  const dayNow = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const today = () => (B && B.today && B._day === dayNow() && B.today) || dayNow();
  const monthStart = () => today().slice(0, 8) + '01';
  const keyOf = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pg = k => ((K().S.me || {}).pages || {})[k] || 'None', admin = () => !!(K().S.me && K().S.me.user.admin), buyer = () => pg('purchase') === 'Edit';
  // (29-10-2026, the MD: "jo entry user karayla jail tyala auto aajchi date select aasel tyala date change krta yenar nahi") a Store User:
  // an entry's date is today, by itself, not to be changed – the Store Admin and the Super Admin any day (the server refuses another)
  const backOk = () => admin() || !!(K().S.me && K().S.me.user && K().S.me.user.super);
  const entryDate = () => ' type="date"' + (backOk() ? '' : ' min="' + today() + '" max="' + today() + '" readonly title="Today – an entry of an earlier day is made by the Store Admin."');
  const canEdit = k => pg(k) === 'Edit';
  const toast = (t, bad) => K().toast(t, bad), failed = e => K().failed(e), ask = (t, h, b) => K().ask(t, h, b);
  async function boot(force) { if (!B || force || B._day !== dayNow()) { B = await W('boot'); B._day = dayNow(); lists(); } return B; }
  const itemOf = code => (B.items || []).find(i => i.code === code);
  const label = i => i.code + ' · ' + i.name + ' (' + i.unit + ')';
  // the lists the boxes offer: items, suppliers, sub-contractors, vendors
  function lists() {
    let d = $('dl_witems'); if (!d) { d = document.createElement('div'); d.id = 'wl_box'; d.hidden = true; document.body.appendChild(d); }
    $('wl_box').innerHTML = '<datalist id="dl_witems">' + (B.items || []).filter(i => i.status === 'Active').map(i => '<option value="' + esc(label(i)) + '">').join('') + '</datalist>' +
      ['suppliers', 'subs', 'vendors'].map(k => '<datalist id="dl_w' + k + '">' + ((B.names || {})[k] || []).map(n => '<option value="' + esc(n) + '">').join('') + '</datalist>').join('');
    const nb = $('nb_req'); if (nb) { const n = B.waiting || 0; nb.textContent = n; nb.hidden = !n; }
  }
  // an item typed or picked: its code ("ITM-0001 · …" or the name as it is in the Item Master)
  function codeOf(v) { const m = /^\s*(ITM-\d+)/i.exec(String(v || '')); if (m) return m[1].toUpperCase(); const k = keyOf(v); const it = k && (B.items || []).find(i => keyOf(i.name) === k); return it ? it.code : ''; }
  const stockOf = c => (B.stock || {})[c] || 0;
  // (28-10-2026) a line's Brand and Material specification, small after the item
  const bsOf = l => (l.brand || l.spec ? ' <small>' + esc([l.brand, l.spec].filter(Boolean).join(' · ')) + '</small>' : '');
  const tag = (t, cls) => '<span class="tag' + (cls ? ' ' + cls : '') + '">' + esc(t) + '</span>';
  const stateTag = s => tag(s, /^(Approved|Received|Open)$/.test(s) ? '' : /Pending|Part/.test(s) ? 'warn' : /Rejected|Cancelled/.test(s) ? 'bad' : 'off');
  const field = (id, lbl, html, cls) => '<div class="field' + (cls ? ' ' + cls : '') + '"><label for="' + id + '">' + esc(lbl) + '</label>' + html + '</div>';
  const inp = (id, v, more) => '<input id="' + id + '" value="' + esc(v === undefined || v === null ? '' : v) + '"' + (more || '') + '>';
  const sel = (id, opts, v, more) => '<select id="' + id + '"' + (more || '') + '>' + opts.map(o => { const val = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(val) + '"' + (String(val) === String(v === undefined || v === null ? '' : v) ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select>';
  const val = id => { const e = $(id); return e ? e.value : ''; };
  // (28-10-2026) small line signs (the GRN form of his picture)
  const ICO = { box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    clear: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>', plus: '<path d="M5 12h14"/><path d="M12 5v14"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/>',
    down: '<path d="m6 9 6 6 6-6"/>', bin: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>', x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>' };
  const ico = (k, cls) => '<svg' + (cls ? ' class="' + cls + '"' : '') + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICO[k] + '</svg>';
  const busy = async (btn, f) => { if (btn.disabled) return; btn.disabled = true; try { await f(); } catch (e) { failed(e); } finally { btn.disabled = false; } };

  /* ---------- the LINES of a paper: a row each, an empty row always there to type into ----------
   * cols: [{ k, h, type: 'item' | 'num' | 'text' | 'check' | 'ro', w, calc(row) }]
   * (28-10-2026) opt.boxes – the GRN's look: the item's search box, the worked-out values in grey boxes, a bin on each row, the last
   * column "Action"; opt.addRow – a row added by "+ Add Row" (L.add), not by itself (one row when there is none) */
  function Lines(box, cols, rows, opt) {
    opt = opt || {};
    { const nb = box.cloneNode(false); box.replaceWith(nb); box = nb; }      // (drawn again – e.g. another PO picked: the listeners of before go with the old box)
    const L = { rows: (rows || []).map(r => Object.assign({}, r)) };
    const blank = () => { const o = {}; cols.forEach(c => { o[c.k] = c.type === 'check' ? false : ''; }); return o; };
    L.draw = () => {
      if (!opt.fixed && (opt.addRow ? !L.rows.length : !L.rows.some(r => !r.item && !r.code))) L.rows.push(blank());
      const bx = !!opt.boxes;
      box.innerHTML = '<div class="tw"><table class="lines' + (bx ? ' boxes' : '') + '"><thead><tr><th>#</th>' + cols.map(c => '<th' + (c.type === 'num' && !bx || c.type === 'ro' && c.n ? ' class="n"' : '') + '>' + esc(c.h) + '</th>').join('') + (opt.fixed ? '' : '<th class="x">' + esc(bx ? 'Action' : '') + '</th>') + '</tr></thead><tbody>' +
        L.rows.map((r, i) => '<tr data-i="' + i + '"><td>' + (i + 1) + '</td>' + cols.map(c => {
          const v = r[c.k];
          if (c.type === 'ro' || (c.type === 'item' && r.fixedItem)) { const t = c.calc ? c.calc(r) : esc(c.type === 'item' ? (r.code ? label(itemOf(r.code) || { code: r.code, name: r.name, unit: r.unit }) : '') : v);
            return bx ? '<td><div class="rob' + (c.n ? ' n' : '') + '">' + (t === '' ? '–' : t) + '</div></td>' : '<td class="' + (c.n ? 'n' : '') + '">' + t + '</td>'; }
          if (c.type === 'check') return '<td style="text-align:center"><input type="checkbox" data-k="' + c.k + '"' + (v ? ' checked' : '') + ' style="width:auto;min-height:0"></td>';
          const vv = c.type === 'item' ? (r.item || (r.code ? label(itemOf(r.code) || { code: r.code, name: r.name, unit: r.unit }) : '')) : v === undefined || v === null ? '' : v;
          const box1 = '<input data-k="' + c.k + '" class="' + (c.type === 'item' ? 'it' : c.type === 'num' ? 'q' : 's') + '"' + (c.type === 'item' ? ' list="dl_witems" placeholder="' + (bx ? 'Search item…' : 'Type the item…') + '"' + (bx && vv ? ' title="' + esc(vv) + '"' : '') : c.type === 'num' ? ' inputmode="decimal"' + (c.ph ? ' placeholder="' + esc(c.ph) + '"' : '') : '') + ' value="' + esc(vv) + '"' + (c.w ? ' style="width:' + c.w + 'px"' : '') + '>';
          return '<td>' + (bx && c.type === 'item' ? '<div class="ib">' + box1 + ico('search') + '</div>' : box1) + '</td>';
        }).join('') + (opt.fixed ? '' : '<td class="x">' + (bx ? '<button type="button" class="binb" data-x="' + i + '" title="Take this row out" aria-label="Take row ' + (i + 1) + ' out">' + ico('bin') + '</button>'
          : r.item || r.code ? '<button type="button" class="link del" data-x="' + i + '" title="Take this line out">✕</button>' : '') + '</td>') + '</tr>').join('') +
        (opt.total ? '<tr class="tot"><td></td>' + opt.total(L.rows) + '</tr>' : '') + '</tbody></table></div>';
    };
    box.addEventListener('input', e => {
      const tr = e.target.closest('tr[data-i]'); if (!tr || !e.target.dataset.k) return;
      const r = L.rows[Number(tr.dataset.i)], k = e.target.dataset.k;
      r[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      if (k === 'item') { r.item = e.target.value; r.code = codeOf(e.target.value); const it = itemOf(r.code); if (it && opt.picked) opt.picked(r, it); }
      if (e.type === 'input' && k !== 'item') { const at = e.target.selectionStart; L.draw(); const ne = box.querySelector('tr[data-i="' + tr.dataset.i + '"] [data-k="' + k + '"]'); if (ne) { ne.focus(); try { ne.setSelectionRange(at, at); } catch (x) { /* a number box */ } } }
    });
    box.addEventListener('change', e => { const tr = e.target.closest('tr[data-i]'); if (!tr) return; const k = e.target.dataset.k; if (k === 'item' || e.target.type === 'checkbox') { const r = L.rows[Number(tr.dataset.i)]; if (k === 'item') { r.code = codeOf(e.target.value); if (r.code) r.item = label(itemOf(r.code)); } else r[k] = e.target.checked; L.draw(); } });
    box.addEventListener('click', e => { const x = e.target.closest('[data-x]'); if (!x) return; L.rows.splice(Number(x.dataset.x), 1); L.draw(); });
    L.get = () => L.rows.filter(r => r.code || String(r.item || '').trim());
    L.add = () => { L.rows.push(blank()); L.draw(); const e = box.querySelector('tr[data-i="' + (L.rows.length - 1) + '"] [data-k]'); if (e) e.focus(); };
    L.draw();
    return L;
  }
  const num = v => { const n = Number(String(v === undefined || v === null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; };
  // a paper's money: taxable = qty × rate, GST on it, the total
  const lineMoney = r => { const t = r2(r2(num(r.qty) * num(r.rate)) * (100 - num(r.disc_pct)) / 100), g = r2(t * num(r.gst_pct) / 100); return { t: t, g: g, all: r2(t + g) }; };      // (28-10-2026) less its Disc. % (a PO's line)

  // a save that asks first when a party's name is nearly one written before, or more than a PO has to come
  async function saveAsk(action, x) {
    for (let round = 0; round < 4; round++) {
      try { return await W(action, x); }
      catch (e) {
        if (e.code === 'party' && e.data) {
          const near = e.data.near || [];
          const v = await ask('The same ' + e.data.field + '?', '<p><b>' + esc(e.data.typed) + '</b> – nearly the same is already there:</p><ul>' + near.map(n => '<li><b>' + esc(n) + '</b></li>').join('') + '</ul><p class="mr">हेच नाव आधी असे लिहिलेले आहे – तेच आहे का?</p>',
            near.map(n => ({ label: 'Use "' + n + '"', value: n, primary: true })).concat([{ label: 'Another ' + e.data.field + ' – save as typed', value: '__new' }]));
          if (v === null) return null;
          const f = { 'supplier': ['grn', 'supplier'], 'vendor': ['po', 'vendor'], 'sub-contractor': ['issue', 'party'] }[e.data.field];
          if (v === '__new') x.confirmParty = true; else if (f) x[f[0]][f[1]] = v;
          continue;
        }
        if (e.code === 'over' && e.data) {
          const v = await ask('More than the PO', '<p>' + esc(e.message) + '</p><p class="mr">PO मध्ये उरलेल्यापेक्षा जास्त माल आला आहे – तरी घ्यायचा का?</p>', [{ label: 'Cancel', value: false }, { label: 'Take it in', value: true, primary: true }]);
          if (!v) return null; x.confirmOver = true; continue;
        }
        throw e;
      }
    }
    return null;
  }
  // a paper or a report printed (an A4 page made here – the page itself is not printed)
  function printHtml(title, html, land) {
    const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(f);
    const d = f.contentWindow.document;
    d.open(); d.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>@page{size:A4 ' + (land ? 'landscape' : 'portrait') + ';margin:10mm}body{font:12px Arial,sans-serif;color:#000}h1{font-size:17px;margin:0 0 2px}h2{font-size:14px;margin:8px 0 4px}' +
      'table{border-collapse:collapse;width:100%}th,td{border:1px solid #444;padding:3px 5px;text-align:left;vertical-align:top}th{background:#eee}td.n,th.n{text-align:right}.muted{color:#555}.hd{display:flex;justify-content:space-between;gap:12px;margin-bottom:8px}.sign{margin-top:40px;display:flex;justify-content:space-between}</style></head><body>' + html + '</body></html>');
    d.close();
    setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('Could not print here.', true); } setTimeout(() => f.remove(), 60000); }, 300);
  }
  // a report (one table) as an Excel file – its title and dates on top
  async function toExcel(rep, name) {
    const X = await K().xlsx(), aoa = [[rep.title], [rep.sub || ''], [], rep.cols.map(c => c.h)].concat(rep.rows.map(r => r.map(v => v === null || v === undefined ? '' : v)));
    if (rep.total) aoa.push(rep.total.map(v => v === null || v === undefined ? '' : v));
    const ws = X.utils.aoa_to_sheet(aoa); ws['!cols'] = rep.cols.map(c => ({ wch: c.n ? 12 : 22 }));
    const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, String(rep.title).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)); X.writeFile(wb, name + '_' + today() + '.xlsx');
  }
  const repTable = rep => '<div class="tw"><table class="rpt"><thead><tr>' + rep.cols.map(c => '<th' + (c.n ? ' class="n"' : '') + '>' + esc(c.h) + '</th>').join('') + '</tr></thead><tbody>' +
    (rep.rows.length ? rep.rows.map(r => '<tr>' + r.map((v, i) => '<td' + (rep.cols[i] && rep.cols[i].n ? ' class="n"' : '') + '>' + esc(rep.cols[i] && rep.cols[i].n && v !== '' ? n2(v) : v) + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + rep.cols.length + '" class="empty">Nothing in these dates.</td></tr>') +
    (rep.total ? '<tr class="tot" style="font-weight:700;background:#F6F8FB">' + rep.total.map((v, i) => '<td' + (rep.cols[i] && rep.cols[i].n ? ' class="n"' : '') + '>' + esc(rep.cols[i] && rep.cols[i].n && v !== '' ? n2(v) : v) + '</td>').join('') + '</tr>' : '') + '</tbody></table></div>';
  const head = (title, sub) => '<div class="hd"><div><h1>' + esc(title) + '</h1><div class="muted">' + esc(sub || '') + '</div></div><div class="muted" style="text-align:right">' + esc((K().S.me || {}).siteName || '') + '<br>Store · ' + dmy(today()) + '</div></div>';

  /* ====================== MATERIAL REQUIREMENTS ====================== */
  const RQ = { list: [], filter: 'open' };
  async function reqPage() {
    const el = $('pg_req');
    el.innerHTML = '<section class="panel"><h2>Material Requirements</h2><p class="muted" style="margin:0">What the site needs. Approved level by level (who approves: given by the Super Admin in the Portal) – then HO Purchase makes its purchase order.</p>' +
      '<div class="bar">' + (canEdit('req') ? '<button type="button" class="btn primary" id="rq_new">+ New requirement</button>' : '') + '<button type="button" class="btn" id="rq_xl">Export to Excel</button><span class="count" id="rq_lv"></span></div>' +
      '<div class="chips" id="rq_chips"></div></section><section class="panel formbox" id="rq_form" hidden></section><section class="panel" id="rq_listbox"><div class="bar" style="margin-top:0" id="rq_bulk" hidden><button type="button" class="btn small" id="rq_okall">Approve the ticked</button></div><div id="rq_list"></div></section>';
    $('rq_xl').onclick = () => busy($('rq_xl'), async () => toExcel(await W('report', { kind: 'req' }), 'Requirements'));
    if ($('rq_new')) $('rq_new').onclick = () => reqForm(null);
    $('rq_okall').onclick = () => busy($('rq_okall'), async () => { const nos = [...document.querySelectorAll('#rq_list .rq-tick:checked')].map(x => Number(x.value)); if (!nos.length) return toast('Tick the requirements to approve.', true); const r = await W('reqDecide', { nos: nos, ok: true }); toast(r.done.length + ' approved' + (r.left.length ? '; ' + r.left.map(l => l.no + ': ' + l.why).join('; ') : '') + '.'); reqLoad(); });
    $('rq_chips').onclick = e => { const c = e.target.closest('[data-f]'); if (!c) return; RQ.filter = c.dataset.f; reqDraw(); };
    $('rq_list').onclick = e => reqClick(e);
    await reqLoad();
  }
  async function reqLoad() {
    try { await boot(); const r = await W('reqList'); RQ.list = r.reqs; RQ.levels = r.levels; RQ.heading = r.heading;
      $('rq_lv').textContent = r.levels.length ? 'Approved by: ' + r.levels.map(l => 'Level ' + l.level + ' – ' + l.people.join(', ')).join(' · ') : 'No approver set for this site – a requirement is approved when it is made.';
      B.waiting = RQ.list.filter(x => x.mayApprove).length; lists(); reqDraw(); }
    catch (e) { failed(e); $('rq_list').innerHTML = '<p class="empty">' + esc(e.message) + '</p>'; }
  }
  const RQF = [['open', 'Open (pending + to order)'], ['mine', 'Waiting for me'], ['Pending', 'Pending'], ['Approved', 'Approved'], ['Rejected', 'Rejected'], ['Closed', 'Closed'], ['Cancelled', 'Cancelled'], ['all', 'All']];
  function reqDraw() {
    const L = RQ.list, cnt = f => L.filter(x => reqIn(x, f)).length;
    $('rq_chips').innerHTML = RQF.map(([k, t]) => '<button type="button" class="chip" data-f="' + k + '" aria-pressed="' + (RQ.filter === k) + '">' + esc(t) + ' (' + cnt(k) + ')</button>').join('');
    const rows = L.filter(x => reqIn(x, RQ.filter));
    $('rq_bulk').hidden = !rows.some(x => x.mayApprove);
    $('rq_list').innerHTML = '<div class="tw"><table><thead><tr><th></th><th>No</th><th>Date</th><th>Needed by</th><th>For</th><th>Items</th><th>State</th><th>Asked by</th><th></th></tr></thead><tbody>' +
      (rows.map(x => '<tr data-no="' + x.no + '"><td>' + (x.mayApprove ? '<input type="checkbox" class="rq-tick" value="' + x.no + '" style="width:auto;min-height:0">' : '') + '</td><td><b>' + x.no + '</b></td><td>' + dmy(x.date) + '</td><td>' + dmy(x.need_by) + '</td><td style="white-space:normal">' + esc(x.for_kind + (x.for_text ? ' – ' + x.for_text : '')) + '</td>' +
        '<td style="white-space:normal">' + x.lines.map(l => esc(l.name + ' ' + n2(l.qty) + ' ' + l.unit) + bsOf(l) + (x.status === 'Approved' && l.left < l.qty ? ' <small>(ordered ' + n2(l.ordered) + ')</small>' : '')).join('<br>') + '</td>' +
        '<td>' + stateTag(x.status) + (x.status === 'Pending' ? '<small>Level ' + x.level + (x.waitFor.length ? ' – ' + esc(x.waitFor.join(', ')) : '') + '</small>' : '') + '</td><td><small>' + esc(x.created_name || x.created_by || '') + '</small></td>' +
        '<td><div class="acts">' + (x.mayApprove ? '<button type="button" class="btn small primary rq-ok">Approve</button><button type="button" class="btn small bad rq-no">Reject</button>' : '') +
        '<button type="button" class="link rq-det">Details</button><button type="button" class="link rq-print">Print</button>' + ((x.mine || admin()) && x.status === 'Pending' && !(x.approvals || []).length && canEdit('req') ? '<button type="button" class="link rq-edit">Change</button>' : '') +
        ((x.mine || admin()) && (x.status === 'Pending' || x.status === 'Approved') && !x.lines.some(l => l.ordered > 0) ? '<button type="button" class="link del rq-cancel">Cancel</button>' : '') +
        ((buyer() || admin()) && x.status === 'Approved' && x.lines.some(l => l.left > 0) ? '<button type="button" class="link rq-close">Close</button>' : '') + '</div></td></tr>').join('') || '<tr><td colspan="9" class="empty">No requirement here.</td></tr>') + '</tbody></table></div>';
  }
  const reqIn = (x, f) => f === 'all' || (f === 'mine' ? x.mayApprove : f === 'open' ? (x.status === 'Pending' || (x.status === 'Approved' && x.lines.some(l => l.left > 0))) : x.status === f);
  async function reqClick(e) {
    const tr = e.target.closest('tr[data-no]'); if (!tr) return; const x = RQ.list.find(r => r.no === Number(tr.dataset.no)); if (!x) return;
    const b = e.target.closest('button'); if (!b) return;
    if (b.classList.contains('rq-det')) {
      const nx = tr.nextElementSibling; if (nx && nx.classList.contains('det')) { nx.remove(); return; }
      const d = document.createElement('tr'); d.className = 'det';
      d.innerHTML = '<td colspan="9"><b>Requirement ' + x.no + '</b>' + (x.remark ? ' – ' + esc(x.remark) : '') + '<table style="margin-top:6px"><thead><tr><th>Item</th><th>Brand</th><th>Material specification</th><th class="n">Asked</th><th class="n">Ordered</th><th class="n">To order</th><th class="n">Stock now</th><th>Note</th></tr></thead><tbody>' +
        x.lines.map(l => '<tr><td>' + esc(l.name) + '</td><td>' + esc(l.brand || '') + '</td><td style="white-space:normal">' + esc(l.spec || '') + '</td><td class="n">' + n2(l.qty) + ' ' + esc(l.unit) + '</td><td class="n">' + n2(l.ordered || 0) + '</td><td class="n">' + n2(l.left || 0) + '</td><td class="n">' + n2(stockOf(l.code)) + '</td><td>' + esc(l.note || '') + '</td></tr>').join('') + '</tbody></table>' +
        ((x.approvals || []).length ? '<p class="sub2" style="margin:6px 0 0">' + x.approvals.map(a => 'Level ' + a.level + ': ' + (a.ok ? 'approved' : 'rejected') + ' by ' + esc(a.name) + ' on ' + dmy(a.at) + (a.note ? ' – "' + esc(a.note) + '"' : '')).join('<br>') + '</p>' : '') + (x.close_note ? '<p class="sub2">' + esc(x.close_note) + '</p>' : '') + '</td>';
      tr.after(d); return;
    }
    if (b.classList.contains('rq-print')) return reqPrint(x, RQ.heading);      // (28-10-2026) his Purchase Requisition Form
    if (b.classList.contains('rq-ok')) return busy(b, async () => { await W('reqDecide', { no: x.no, ok: true }); toast('Requirement ' + x.no + ' approved.'); reqLoad(); });
    if (b.classList.contains('rq-no')) {
      const v = await ask('Reject requirement ' + x.no + '?', '<p>Say why (the person who made it sees it):</p><input id="rq_why" maxlength="300" style="width:100%"><p class="mr">का नाकारले ते लिहा.</p>', [{ label: 'Cancel', value: false }, { label: 'Reject', value: true, bad: true }]);
      if (!v) return; const why = (document.getElementById('rq_why') || {}).value || '';
      return busy(b, async () => { await W('reqDecide', { no: x.no, ok: false, note: why }); toast('Requirement ' + x.no + ' rejected.'); reqLoad(); });
    }
    if (b.classList.contains('rq-edit')) return reqForm(x);
    if (b.classList.contains('rq-cancel')) { const v = await ask('Cancel requirement ' + x.no + '?', '<p>It will not be ordered.</p><p class="mr">ही मागणी रद्द होईल.</p>', [{ label: 'No', value: false }, { label: 'Cancel it', value: true, bad: true }]); if (!v) return; return busy(b, async () => { await W('reqCancel', { no: x.no }); toast('Requirement ' + x.no + ' cancelled.'); reqLoad(); }); }
    if (b.classList.contains('rq-close')) { const v = await ask('Close requirement ' + x.no + '?', '<p>What is still to order will not be bought.</p>', [{ label: 'No', value: false }, { label: 'Close', value: true, primary: true }]); if (!v) return; return busy(b, async () => { await W('reqClose', { no: x.no }); toast('Requirement ' + x.no + ' closed.'); reqLoad(); }); }
  }
  function reqForm(x) {
    if (!B) return void boot().then(() => reqForm(x)).catch(failed);      // (pressed before the page had its lists)
    const f = $('rq_form'); f.hidden = false;
    f.innerHTML = '<h2>' + (x ? 'Change requirement ' + x.no : 'New requirement') + '</h2><div class="grid" style="margin-top:10px">' +
      field('rq_date', 'Date *', inp('rq_date', x ? x.date : today(), entryDate())) + field('rq_need', 'Needed by', inp('rq_need', x ? x.need_by : '', ' type="date"')) +
      field('rq_kind', 'For *', sel('rq_kind', B.kinds.for, x ? x.for_kind : 'Site work')) + '<div class="field wide" id="rq_whichw"></div>' + field('rq_rem', 'Remark', inp('rq_rem', x ? x.remark : '', ' maxlength="300"'), 'wide') + '</div><div id="rq_lines"></div>' +
      '<div class="bar"><button type="button" class="btn primary" id="rq_save">Save requirement</button><button type="button" class="btn" id="rq_x">Cancel</button></div>';
    const which = () => { const k = val('rq_kind'), cur = x ? x.for_text : '';
      $('rq_whichw').innerHTML = k === 'Machinery' ? '<label for="rq_for">Machinery *</label>' + sel('rq_for', [['', 'Pick…']].concat((B.machinery || []).map(m => [m.no, m.no + (m.name ? ' – ' + m.name : '')])), cur) : '<label for="rq_for">' + (k === 'Site work' ? 'Location / work (e.g. Ch 540+450 toe wall)' : 'Which') + '</label>' + inp('rq_for', cur, ' maxlength="120"'); };
    which(); $('rq_kind').onchange = which;
    const L = Lines($('rq_lines'), [{ k: 'item', h: 'Item *', type: 'item' }, { k: 'qty', h: 'Qty *', type: 'num' }, { k: 'unit', h: 'Unit', type: 'ro', calc: r => esc((itemOf(r.code) || {}).unit || '') }, { k: 'stock', h: 'Stock now', type: 'ro', n: true, calc: r => r.code ? n2(stockOf(r.code)) : '' },
      { k: 'brand', h: 'Brand', type: 'text', w: 140 }, { k: 'spec', h: 'Material specification', type: 'text', w: 230 }, { k: 'note', h: 'Note', type: 'text' }],
      x ? x.lines.map(l => ({ code: l.code, qty: l.qty, brand: l.brand || '', spec: l.spec || '', note: l.note || '' })) : []);
    $('rq_x').onclick = () => { f.hidden = true; };
    $('rq_save').onclick = e => busy(e.target, async () => {
      const lines = L.get(); if (lines.some(l => !l.code)) throw new Error('Line ' + (L.rows.indexOf(lines.find(l => !l.code)) + 1) + ': pick the item from the list (as it is in the Item Master).');
      const r = await W('reqSave', { no: x ? x.no : undefined, req: { date: val('rq_date'), need_by: val('rq_need'), for_kind: val('rq_kind'), for_text: val('rq_for'), remark: val('rq_rem'), lines: lines.map(l => ({ code: l.code, qty: l.qty, brand: l.brand, spec: l.spec, note: l.note })) } });
      toast('Requirement ' + r.no + ' saved – ' + (r.status === 'Approved' ? 'approved (no approver set for this site).' : 'it waits for Level ' + r.level + '.'));
      f.hidden = true; reqLoad();
    });
    f.scrollIntoView({ block: 'nearest' });
  }

  /* ====================== PURCHASE (ALL SITES) – HO Purchase ====================== */
  const PU = { sites: [], pos: [] };
  async function purPage() {
    const el = $('pg_purchase');
    el.innerHTML = '<section class="panel"><h2>Purchase – every site</h2><p class="muted" style="margin:0">The approved requirements of every site still to order. Tick the lines of one site and make its purchase order – it is kept in that site\'s own records.</p>' +
      '<div class="bar"><button type="button" class="btn" id="pu_ref">Refresh</button><button type="button" class="btn" id="pu_xl">Export the POs (Excel)</button></div></section><section class="panel formbox" id="pu_form" hidden></section><div id="pu_sites"></div>' +
      '<section class="panel"><h2>Purchase orders of every site</h2><div id="pu_pos" style="margin-top:8px"></div></section>';
    $('pu_ref').onclick = () => purLoad();
    $('pu_xl').onclick = () => busy($('pu_xl'), async () => toExcel(await W('report', { kind: 'po', all: true }), 'Purchase_orders'));
    $('pu_sites').onclick = e => { const b = e.target.closest('[data-mk]'); if (b) purForm(b.dataset.mk, null); };
    $('pu_pos').onclick = e => poClick(e, PU.pos, () => purLoad());
    await purLoad();
  }
  async function purLoad() {
    try {
      const [p, l] = await Promise.all([W('purPending'), W('poList', { all: true })]); PU.sites = p.sites; PU.pos = l.pos;
      $('pu_sites').innerHTML = PU.sites.map(s => '<section class="panel" data-site="' + esc(s.site) + '"><h2>' + esc(s.name) + ' <small class="muted">(' + esc(s.site) + ')</small></h2>' + (s.error ? '<p class="muted">' + esc(s.error) + '</p>' :
        (s.reqs.length ? '<div class="tw" style="margin-top:8px"><table><thead><tr><th></th><th>Req</th><th>Date</th><th>Needed by</th><th>For</th><th>Item</th><th class="n">Asked</th><th class="n">Ordered</th><th class="n">To order</th></tr></thead><tbody>' +
          s.reqs.map(r => r.lines.filter(l => l.left > 0).map(l => '<tr><td><input type="checkbox" class="pu-tick" data-site="' + esc(s.site) + '" data-req="' + r.no + '" data-line="' + l.line + '" style="width:auto;min-height:0"></td><td>' + r.no + '</td><td>' + dmy(r.date) + '</td><td>' + dmy(r.need_by) + '</td><td style="white-space:normal">' + esc(r.for_kind + (r.for_text ? ' – ' + r.for_text : '')) + '</td><td style="white-space:normal">' + esc(l.name) + bsOf(l) + '</td><td class="n">' + n2(l.qty) + ' ' + esc(l.unit) + '</td><td class="n">' + n2(l.ordered) + '</td><td class="n"><b>' + n2(l.left) + '</b></td></tr>').join('')).join('') + '</tbody></table></div>'
          : '<p class="muted">Nothing to order.</p>') + '<div class="bar"><button type="button" class="btn primary small" data-mk="' + esc(s.site) + '">Make a PO for ' + esc(s.site) + (s.reqs.length ? ' (the ticked lines)' : '') + '</button>' + (s.open ? '<span class="count">' + s.open + ' PO(s) open</span>' : '') + '</div>') + '</section>').join('');
      $('pu_pos').innerHTML = poTable(PU.pos, true);
    } catch (e) { failed(e); }
  }
  async function purForm(site, po) {
    const f = $('pu_form'); f.hidden = false; f.innerHTML = '<p class="muted">Loading the items of ' + esc(site) + '…</p>'; f.scrollIntoView({ block: 'nearest' });
    let it; try { it = await W('purItems', { site: site }); } catch (e) { failed(e); f.hidden = true; return; }
    const keepB = B; B = Object.assign({}, B, { items: it.items, names: Object.assign({}, (B || {}).names, { vendors: it.vendors }) }); lists();
    const ticked = po ? [] : [...document.querySelectorAll('.pu-tick:checked')].filter(x => x.dataset.site === site);
    const st = PU.sites.find(s => s.site === site) || { reqs: [] };
    const rows = po ? po.lines.map(l => Object.assign({ fixedItem: !!l.req_no }, l, { disc_pct: l.disc_pct || '', hsn: l.hsn || '' })) : ticked.map(t => { const r = st.reqs.find(q => q.no === Number(t.dataset.req)), l = r.lines.find(z => z.line === Number(t.dataset.line)); const i = it.items.find(z => z.code === l.code) || {};
      return { code: l.code, name: l.name, unit: l.unit, qty: l.left, rate: '', disc_pct: '', hsn: i.hsn || '', gst_pct: i.gst_pct === null || i.gst_pct === undefined ? '' : i.gst_pct, req_no: r.no, req_line: l.line, brand: l.brand || '', spec: l.spec || '', fixedItem: true }; });
    f.innerHTML = '<h2>' + (po ? 'Change PO ' + po.no : 'New purchase order') + ' – ' + esc(site) + '</h2><div class="grid" style="margin-top:10px">' +
      field('pu_date', 'PO date *', inp('pu_date', po ? po.date : today(), entryDate())) + field('pu_ven', 'Vendor (supplier) *', inp('pu_ven', po ? po.vendor : '', ' list="dl_wvendors" maxlength="80" autocomplete="off"'), 'wide') +
      field('pu_gst', 'Vendor GST no.', inp('pu_gst', po ? po.vendor_gst : '', ' maxlength="15"')) + field('pu_del', 'Delivery by', inp('pu_del', po ? po.deliver_by : '', ' type="date"')) +
      // (28-10-2026, his format) the PO Details: Credit Period, Site Contact, Shipping Address; Freight, Load / Unload; Terms line by line
      // (a new PO starts with the site's Shipping Address, Site Contact and Terms of Store Settings)
      (it.step5 ? field('pu_cr', 'Credit Period (days)', inp('pu_cr', po ? po.credit_days : '', ' inputmode="numeric" placeholder="e.g. 0 or 30"')) + field('pu_sc', 'Site Contact', inp('pu_sc', po ? po.site_contact : (it.papers || {}).site_contact || '', ' maxlength="120" placeholder="Name : mobile"'), 'wide') +
        field('pu_ship', 'Shipping Address', '<textarea id="pu_ship" rows="2" maxlength="300">' + esc(po ? po.ship_to || '' : (it.papers || {}).ship_to || '') + '</textarea>', 'wide') +
        field('pu_fr', 'Total Freight Charges ₹', inp('pu_fr', po ? po.freight || '' : '', ' inputmode="decimal"')) + field('pu_lu', 'Total Load / Unload Amount ₹', inp('pu_lu', po ? po.load_unload || '' : '', ' inputmode="decimal"')) : '') +
      field('pu_terms', 'Terms And Conditions (one a line)', '<textarea id="pu_terms" rows="4" maxlength="3000">' + esc(po ? po.terms || '' : (it.papers || {}).terms || '') + '</textarea>', 'wide') + field('pu_rem', 'Remark', inp('pu_rem', po ? po.remark : '', ' maxlength="300"'), 'wide') + '</div><div id="pu_lines"></div>' +
      (it.step5 ? '' : '<p class="note2">The Credit Period, Site Contact, Shipping Address, Freight, Load / Unload and the PO\'s approval come after the Store\'s database step 5 (sql/store_step5_po_format.sql) is run at this site.</p>') +
      '<div class="bar"><button type="button" class="btn primary" id="pu_save">Save PO</button><button type="button" class="btn" id="pu_x">Cancel</button></div>';
    $('pu_ven').onchange = () => { const g = (it.gst || {})[val('pu_ven').trim()]; if (g && !val('pu_gst')) $('pu_gst').value = g; };
    const tot = rs => { const s = rs.filter(r => r.code).map(lineMoney).reduce((a, m) => ({ t: a.t + m.t, g: a.g + m.g, all: a.all + m.all }), { t: 0, g: 0, all: 0 }); return '<td colspan="10">Total</td><td class="n">' + money(s.t) + '</td><td class="n">' + money(s.g) + '</td><td class="n">' + money(s.all) + '</td><td></td>'; };
    const L = Lines($('pu_lines'), [{ k: 'item', h: 'Item *', type: 'item' }, { k: 'req', h: 'Req', type: 'ro', calc: r => r.req_no ? 'REQ ' + r.req_no : '' }, { k: 'brand', h: 'Brand', type: 'text', w: 130 }, { k: 'spec', h: 'Material specification', type: 'text', w: 200 }, { k: 'qty', h: 'Qty *', type: 'num' }, { k: 'unit', h: 'Unit', type: 'ro', calc: r => esc(r.unit || (itemOf(r.code) || {}).unit || '') },
      { k: 'rate', h: 'Rate ₹ *', type: 'num' }, { k: 'disc_pct', h: 'Disc. %', type: 'num' }, { k: 'hsn', h: 'HSN', type: 'text', w: 90 }, { k: 'gst_pct', h: 'GST %', type: 'num' }, { k: 'tx', h: 'Taxable', type: 'ro', n: true, calc: r => r.code ? money(lineMoney(r).t) : '' }, { k: 'gx', h: 'GST', type: 'ro', n: true, calc: r => r.code ? money(lineMoney(r).g) : '' }, { k: 'ax', h: 'Total', type: 'ro', n: true, calc: r => r.code ? money(lineMoney(r).all) : '' }],
      rows, { total: tot, picked: (r, i) => { if (r.gst_pct === '' && i.gst_pct !== null && i.gst_pct !== undefined) r.gst_pct = i.gst_pct; if (!r.hsn && i.hsn) r.hsn = i.hsn; } });
    const done = () => { f.hidden = true; B = keepB; if (B) lists(); };      // (28-10-2026) the Purchase page opened straight (B not read yet): no error after Save PO / Cancel, the list comes again
    $('pu_x').onclick = done;
    $('pu_save').onclick = e => busy(e.target, async () => {
      const lines = L.get(); if (lines.some(l => !l.code)) throw new Error('Pick each item from the list (as it is in the Item Master of ' + site + ').');
      const x = { site: site, no: po ? po.no : undefined, po: { date: val('pu_date'), vendor: val('pu_ven'), vendor_gst: val('pu_gst'), deliver_by: val('pu_del'), terms: val('pu_terms'), remark: val('pu_rem'),
        credit_days: val('pu_cr'), site_contact: val('pu_sc'), ship_to: val('pu_ship'), freight: val('pu_fr'), load_unload: val('pu_lu'),
        lines: lines.map(l => ({ code: l.code, qty: l.qty, rate: l.rate, disc_pct: l.disc_pct, hsn: l.hsn || '', gst_pct: l.gst_pct, req_no: l.req_no || undefined, req_line: l.req_line || undefined, brand: l.brand || '', spec: l.spec || '' })) } };
      const r = await saveAsk('poSave', x); if (!r) return;
      toast('PO ' + r.no + ' of ' + r.site + ' saved – ' + money(r.total) + (r.appr === 'Waiting' ? ' – it waits for its approval.' : '.')); done(); purLoad();
    });
  }
  const poTable = (pos, sites) => '<div class="tw"><table><thead><tr>' + (sites ? '<th>Site</th>' : '') + '<th>PO</th><th>Date</th><th>Vendor</th><th>Items</th><th class="n">Total</th><th>State</th><th></th></tr></thead><tbody>' +
    (pos.map(p => '<tr data-po="' + p.no + '" data-site="' + esc(p.site || '') + '">' + (sites ? '<td>' + esc(p.site) + '</td>' : '') + '<td><b>' + p.no + '</b></td><td>' + dmy(p.date) + '</td><td>' + esc(p.vendor) + '</td><td style="white-space:normal">' +
      p.lines.map(l => esc(l.name + ' ' + n2(l.qty) + ' ' + l.unit) + bsOf(l) + (l.received ? ' <small>(came ' + n2(l.received) + ')</small>' : '')).join('<br>') + '</td><td class="n">' + money(p.total) + '</td><td>' + stateTag(p.state) + apprTag(p) + '</td><td><div class="acts">' +
      (p.mayApprove ? '<button type="button" class="btn small primary po-ok">Approve</button><button type="button" class="btn small bad po-no">Reject</button>' : '') + '<button type="button" class="link po-print">Print</button>' +
      (buyer() && p.status === 'Open' && sites ? '<button type="button" class="link po-edit">Change</button>' : '') + (buyer() && p.status === 'Open' && !p.lines.some(l => l.received > 0) ? '<button type="button" class="link del po-cancel">Cancel</button>' : '') +
      ((buyer() || admin()) && p.status === 'Open' && p.state !== 'Received' ? '<button type="button" class="link po-close">Close</button>' : '') + '</div></td></tr>').join('') || '<tr><td colspan="8" class="empty">No purchase order.</td></tr>') + '</tbody></table></div>';
  // (28-10-2026) a PO's approval: waiting (for whom), rejected (why), approved (by whom)
  const apprTag = p => p.status !== 'Open' || !p.appr ? '' : p.appr === 'Waiting' ? '<br>' + tag('Waiting approval', 'warn') + (p.waitFor && p.waitFor.length ? '<small> ' + esc(p.waitFor.join(', ')) + '</small>' : '')
    : p.appr === 'Rejected' ? '<br>' + tag('Rejected', 'bad') + (p.appr_note ? '<small> "' + esc(p.appr_note) + '" – ' + esc(p.appr_name || '') + '</small>' : '') : p.appr_name ? '<br><small>Approved by ' + esc(p.appr_name) + '</small>' : '';
  async function poClick(e, list, reload) {
    const b = e.target.closest('button'), tr = e.target.closest('tr[data-po]'); if (!b || !tr) return;
    const p = list.find(z => z.no === Number(tr.dataset.po) && (z.site || '') === tr.dataset.site); if (!p) return;
    const site = p.site || undefined;
    if (b.classList.contains('po-print')) return busy(b, async () => { const r = await W('poGet', { site: site, no: p.no }); poPrint(r.po, r.heading, r.supplier); });
    if (b.classList.contains('po-ok')) return busy(b, async () => { await W('poDecide', { no: p.no, ok: true }); toast('PO ' + p.no + ' approved.'); reload(); });
    if (b.classList.contains('po-no')) {
      const v = await ask('Reject PO ' + p.no + '?', '<p>Say why (the one who made it sees it and changes it):</p><input id="po_why" maxlength="300" style="width:100%"><p class="mr">का नाकारले ते लिहा.</p>', [{ label: 'Cancel', value: false }, { label: 'Reject', value: true, bad: true }]);
      if (!v) return; const why = (document.getElementById('po_why') || {}).value || '';
      return busy(b, async () => { await W('poDecide', { no: p.no, ok: false, note: why }); toast('PO ' + p.no + ' rejected.'); reload(); });
    }
    if (b.classList.contains('po-edit')) return purForm(p.site, p);
    if (b.classList.contains('po-cancel')) { if (!await ask('Cancel PO ' + p.no + '?', '<p>Nothing of it has come – it is cancelled.</p>', [{ label: 'No', value: false }, { label: 'Cancel the PO', value: true, bad: true }])) return; return busy(b, async () => { await W('poCancel', { site: site, no: p.no }); toast('PO ' + p.no + ' cancelled.'); reload(); }); }
    if (b.classList.contains('po-close')) { if (!await ask('Close PO ' + p.no + '?', '<p>The rest of it will not come.</p>', [{ label: 'No', value: false }, { label: 'Close', value: true, primary: true }])) return; return busy(b, async () => { await W('poClose', { site: site, no: p.no }); toast('PO ' + p.no + ' closed.'); reload(); }); }
  }
  /* (28-10-2026) THE COMPANY'S OWN PAPERS – his formats: "DIESEL PURCHASE ORDER – NEW POPULAR SERVICE STATION" (the Purchase Order) and
   * "REQUIREMENT OF EXHAUST FANS" (the Purchase Requisition Form): the logo and the company's details on top, the boxes and columns as
   * there. The company's name, address, GST, PAN and logo from the site's company; its e-mail, contact, CIN and web from Store Settings. */
  const RLOGO = 'https://i.ibb.co/CpSfBqXX/RCL-LOGO-PDF.png';      // (the Rachana logo of the menu – its words cut out of the big picture)
  const logoOf = h => h.logo ? '<img src="' + esc(h.logo) + '" alt="" style="max-height:70px;max-width:100%">'
    : /rachana/i.test(h.company || '') ? '<span class="plogo"><img src="' + RLOGO + '" alt="' + esc(h.company) + '"></span>' : '<b style="font-size:22px">' + esc(h.company || '') + '</b>';
  const PCSS = '<style>.fm{font:11px Arial,sans-serif}.fm table{border-collapse:collapse;width:100%}.fm td,.fm th{border:1px solid #000;padding:2px 5px;vertical-align:top}.fm .nb td{border:0;padding:1px 3px}' +
    '.fm .plogo{position:relative;overflow:hidden;display:inline-block;width:250px;aspect-ratio:3.724}.fm .plogo img{position:absolute;max-width:none;width:209.2%;left:-54.8%;top:-227.8%;height:auto}' +
    '.fm .cn{font-size:18px;font-weight:700;text-align:center}.fm .ttl{text-align:center;font-weight:700;font-size:14px}.fm .sh{text-align:center;font-weight:700;border-bottom:1px solid #000;margin:0 -5px 3px;padding-bottom:2px}' +
    '.fm .r{text-align:right}.fm .c{text-align:center}.fm .sig{display:flex;justify-content:space-between;margin-top:120px;padding:0 40px}.fm .sig div{text-align:center;font-weight:700}.fm .cg{text-align:center;font-weight:700;margin-top:6px}' +
    '.fm ol{margin:4px 0 0 18px;padding:0}.fm li{margin:6px 0}.fm .s2{margin-top:90px;display:flex;justify-content:space-between;padding:0 10px}.fm .s2 div{text-align:center;min-width:150px}.fm .s2 span{display:block;border-top:1px solid #000;margin-top:2px}</style>';
  const kv = rows => '<table class="nb">' + rows.map(r => '<tr><td style="width:' + (r[2] || 95) + 'px">' + esc(r[0]) + '</td><td style="width:10px">-</td><td>' + (r[1] || '') + '</td></tr>').join('') + '</table>';
  const nl = t => esc(t || '').replace(/\n/g, '<br>');
  function poPrint(p, h, sup) {
    h = h || {}; sup = sup || {};
    const n2f = v => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const head = '<table><tr><td style="width:50%;text-align:center;vertical-align:middle;border-right:0">' + logoOf(h) + '</td><td style="border-left:1px solid #000"><div class="cn">' + esc(h.company || '') + '</div>' +
      '<div class="c">' + nl(h.address) + '</div><table class="nb">' +
      '<tr><td><b>Email ID.</b> : ' + esc(h.email || '') + '</td><td><b>Contact</b> : ' + esc(h.phone || '') + '</td></tr><tr><td><b>CIN No</b> : ' + esc(h.cin || '') + '</td><td><b>Web</b> : ' + esc(h.web || '') + '</td></tr>' +
      '<tr><td><b>GST No</b> : ' + esc(h.gstin || '') + '</td><td><b>PAN No</b> : ' + esc(h.pan || '') + '</td></tr></table></td></tr><tr><td colspan="2" class="ttl">Purchase Order</td></tr>' +
      '<tr><td style="width:50%"><div class="sh">Supplier Details</div>' + kv([['Name', '<b>' + esc(sup.name || p.vendor) + '</b>'], ['Address', nl(sup.address)], ['Mobile No.', esc(sup.mobile)], ['E-mail', esc(sup.email)], ['Contact Person', esc(sup.contact)], ['GSTIN No', esc(sup.gstin || p.vendor_gst || '')]]) + '</td>' +
      '<td><div class="sh">PO Details</div>' + kv([['PO No.', '<b>' + esc(p.ref || p.no) + '</b>'], ['PO Date', dmy(p.date)], ['Credit Period', p.credit_days === null || p.credit_days === undefined ? '' : p.credit_days + ' Days'], ['Project Name', esc(h.site || p.site || '')], ['Site Contact', esc(p.site_contact || '')]].concat(p.deliver_by ? [['Delivery by', dmy(p.deliver_by)]] : [])) +
      '<div class="sh" style="border-top:1px solid #000;padding-top:2px;margin-top:3px">Shipping Address</div>' + nl(p.ship_to) + '</td></tr></table>';
    const lines = p.lines.map((l, i) => '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(l.name + (l.spec ? ' - ' + l.spec : '')) + '</td><td class="c">' + esc(l.brand || '-') + '</td><td class="c">' + esc(l.hsn || '') + '</td><td class="r">' + n2f(l.gst_pct) +
      '</td><td class="r">' + Number(l.qty).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 3 }) + '</td><td class="c">' + esc(l.unit) + '</td><td class="r">' + n2f(l.rate) + '</td><td class="r">' + n2f(l.disc_pct) + '</td><td class="r">' + n2f(l.taxable) + '</td></tr>').join('');
    const disc = p.lines.reduce((a, l) => a + Number(l.disc || 0), 0), gross = p.lines.reduce((a, l) => a + Number(l.taxable || 0), 0), gst = Number(p.gst || 0);
    const row = (t, v, b) => '<tr><td colspan="9"><b>' + t + '</b></td><td class="r">' + (b ? '<b>' + n2f(v) + '</b>' : n2f(v)) + '</td></tr>';
    const items = '<table style="margin-top:6px"><thead><tr><th>S.N.</th><th>Item Description- Specification</th><th>Brand</th><th>HSN</th><th>GST %</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Disc. %</th><th>Amount</th></tr></thead><tbody>' + lines +
      row('Total Disc. Amount', disc) + row('Gross Amount', gross) + (gst > 0 ? row('Total GST Amount', gst) : '') + '<tr><td colspan="10" style="height:22px"></td></tr>' +
      row('Total Freight Charges', p.freight || 0) + row('Total Load / Unload Amount', p.load_unload || 0) + row('TOTAL AMOUNT (Rs.)', p.total, true) +
      '<tr><td colspan="2"><b>Amount in word :</b></td><td colspan="8"><b>' + esc(p.words || '') + '</b></td></tr></tbody></table>';
    const terms = String(p.terms || '').split('\n').map(t => t.trim()).filter(Boolean);
    const tc = terms.length ? '<p style="margin-top:14px"><b>Terms And Conditions:</b></p>' + (terms.every(t => /^\d+[.)]/.test(t)) ? terms.map(t => '<p style="margin:6px 0">' + esc(t) + '</p>').join('') : '<ol>' + terms.map(t => '<li>' + esc(t) + '</li>').join('') + '</ol>') : '';
    const ap = p.appr === 'Waiting' ? '(waiting for approval)' : p.appr === 'Rejected' ? '(rejected)' : esc(p.appr_name || '');
    printHtml('PO ' + (p.ref || p.no), PCSS + '<div class="fm">' + head + items + '<p style="margin-top:8px"><b>Remark:</b> ' + esc(p.remark || '') + '</p>' + tc +
      '<div class="sig"><div>' + esc(p.created_name || '') + '<br><br>Prepared By</div><div>' + ap + '<br><br>Approved By</div></div><div class="cg">This Purchase Order is computer generated it does not require signature.</div></div>');
  }
  // the Purchase Requisition Form of a requirement: Prepared By – who made it; Checked By – the levels before the last; Approved By – the last
  function reqPrint(x, h) {
    h = h || {};
    const ok = (x.approvals || []).filter(a => a.ok), last = x.status === 'Approved' || x.status === 'Closed' ? ok[ok.length - 1] : null, checked = (last ? ok.slice(0, -1) : ok).map(a => a.name).join(', ');
    const appr = last ? last.name : x.status === 'Pending' ? '(waiting – level ' + x.level + ')' : x.status === 'Rejected' ? '(rejected)' : '';
    const head = '<table><tr><td style="width:55%;text-align:center;vertical-align:middle" rowspan="2">' + logoOf(h) + '</td><td class="cn" style="font-size:26px;font-weight:400;height:70px;vertical-align:middle">' + esc(h.company || '') + '</td></tr>' +
      '<tr><td class="c" style="font-size:16px">Purchase Requisition Form</td></tr></table>' +
      '<table class="nb" style="border:1px solid #000;border-top:0"><tr><td style="width:15%">Project Name :</td><td style="width:45%">' + esc(h.site || '') + '</td><td style="width:15%">Sub Project :</td><td>' + esc(x.for_kind + (x.for_text ? ' – ' + x.for_text : '')) + '</td></tr>' +
      '<tr><td>Indent No. :</td><td>' + esc(x.ref || x.no) + '</td><td>Date :</td><td>' + dmy(x.date).replace(/-/g, '/') + '</td></tr></table>';
    const items = '<table><thead><tr><th>Sr No</th><th>Item Code</th><th>Item Description</th><th>Item Specification</th><th>Unit</th><th>Quantity</th><th>Required Date</th></tr></thead><tbody>' +
      x.lines.map((l, i) => '<tr><td class="c">' + (i + 1) + '</td><td class="c">' + esc(l.code) + '</td><td>' + esc(l.name) + '</td><td>' + esc([l.brand ? 'Brand: ' + l.brand : '', l.spec || '', l.note || ''].filter(Boolean).join(' · ')) + '</td><td class="c">' + esc(l.unit) +
        '</td><td class="r">' + Number(l.qty).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 3 }) + '</td><td class="c">' + dmy(x.need_by || x.date).replace(/-/g, '/') + '</td></tr>').join('') + '</tbody></table>';
    printHtml('Requirement ' + (x.ref || x.no), PCSS + '<div class="fm" style="border:1px solid #000;min-height:260mm;padding:0">' + head + items + '<p style="margin:6px">Remark:' + esc(x.remark || '') + '</p>' +
      '<div class="s2"><div>' + esc(x.created_name || '') + '<span>Prepared By</span></div><div>' + esc(checked) + '<span>Checked By</span></div><div>' + esc(appr) + '<span>Approved By</span></div></div></div>');
  }

  /* ====================== PURCHASE ORDERS OF THIS SITE ====================== */
  async function poPage() {
    const el = $('pg_po');
    el.innerHTML = '<section class="panel"><h2>Purchase Orders of this site</h2><p class="muted" style="margin:0">Made by HO Purchase; what has come is from the GRNs against each.</p><div class="bar"><button type="button" class="btn" id="po_xl">Export to Excel</button><label class="sub2"><input type="checkbox" id="po_pend" style="width:auto;min-height:0"> Only what is still to come</label></div></section><section class="panel" id="po_list"></section>';
    let list = [];
    const load = async () => { try { list = (await W('poList')).pos; draw(); } catch (e) { failed(e); } };
    const draw = () => { $('po_list').innerHTML = poTable($('po_pend').checked ? list.filter(p => p.status === 'Open' && p.state !== 'Received') : list, false); };
    $('po_pend').onchange = draw; $('po_list').onclick = e => poClick(e, list, load);
    $('po_xl').onclick = () => busy($('po_xl'), async () => toExcel(await W('report', { kind: 'po', pending: $('po_pend').checked }), 'Purchase_orders'));
    await load();
  }

  /* ====================== INWARD (GRN) ====================== */
  const GR = { list: [] };
  async function grnPage() {
    const el = $('pg_grn');
    el.innerHTML = '<div class="pghead"><span class="pgico">' + ico('box') + '</span><div><h2>Inward (GRN)</h2><p>Material received against a purchase order or direct (a bill). Its basic rate makes the item\'s average rate.</p></div></div>' +
      '<section class="panel"><div class="bar" style="margin:0">' + field('gr_from', 'From', inp('gr_from', monthStart(), ' type="date"')) + field('gr_to', 'To', inp('gr_to', today(), ' type="date"')) + '<button type="button" class="btn" id="gr_show">Show</button><button type="button" class="btn" id="gr_hide" hidden>Hide list</button>' +
      (canEdit('grn') ? '<button type="button" class="btn primary" id="gr_new">+ New GRN</button>' : '') + '<button type="button" class="btn" id="gr_xl">GRN register (Excel)</button>' +
      (admin() ? '<button type="button" class="btn" id="gr_imp">Import from Excel</button><button type="button" class="btn small" id="gr_tpl">Import format</button><input type="file" id="gr_file" accept=".xlsx,.xls,.csv" hidden>' : '') + '</div></section>' +
      '<section id="gr_form" hidden></section><section class="panel formbox" id="gr_impbox" hidden></section><section class="panel" id="gr_list"></section>';
    // (28-10-2026, "show dable ki distey but prt hide pn krta yaw") Show – the list of the dates; Hide list – it goes away again
    const hint = '<p class="empty" id="gr_hint">Choose the dates and press <b>Show</b> – the GRNs of those dates come here.<br><span class="mr">तारखा निवडा आणि Show दाबा – त्या तारखांचे GRN इथे दिसतील.</span></p>';
    $('gr_show').onclick = () => { GR.shown = true; $('gr_hide').hidden = false; grnLoad(); };
    $('gr_hide').onclick = () => { GR.shown = false; $('gr_hide').hidden = true; $('gr_list').innerHTML = hint; };
    if ($('gr_new')) $('gr_new').onclick = () => grnForm(null);
    $('gr_xl').onclick = () => busy($('gr_xl'), async () => toExcel(await W('report', { kind: 'grn', from: val('gr_from'), to: val('gr_to') }), 'GRN_register'));
    // (28-10-2026) the Import of the GRNs: the register's (his inward register – any size, its own GRN No; the check first)
    if ($('gr_imp')) { $('gr_imp').onclick = () => { $('gr_file').value = ''; $('gr_file').click(); }; $('gr_file').onchange = () => regFile($('gr_file').files[0], $('gr_impbox')); $('gr_tpl').onclick = () => importTemplate('grn'); }
    $('gr_list').onclick = e => grnClick(e);
    GR.shown = false; $('gr_list').innerHTML = hint;
    await boot();
  }
  // (28-10-2026, "ji excel diley tech column mala GRN / inward madhe de") his inward register's columns; (the same day, "show kel nantr
  // disaw ani perfect nit disaw") shown when Show is pressed, each GRN a card: its own (GRN No, date, supplier, invoice, challan, vehicle,
  // PO, TCS, gross) once at its top, its materials under it (Sr No, Material Description, Received Qty, UOM, Basic Rate, Taxable / GST /
  // Gross Amount, Remark). The GRN register (Excel) has every column on each row.
  const LCOLS = ['Sr No', 'Material Description', 'Received Qty', 'UOM', 'Basic Rate', 'Taxable Amount', 'GST Amount', 'Gross Amount', 'Remark'];
  const refOf = g => String(g.ref === null || g.ref === undefined || g.ref === '' ? g.no : g.ref);
  async function grnLoad() {
    if (!GR.shown) return;      // (the list comes when Show is pressed)
    try { const r = await W('grnList', { from: val('gr_from'), to: val('gr_to') }); GR.list = r.grns;
      let sr = 0;
      const kv = (k, v, cls) => '<div class="gk' + (cls ? ' ' + cls : '') + '"><small>' + esc(k) + '</small><span>' + v + '</span></div>';
      const card = g => '<article class="grnc" data-no="' + g.no + '"><header>' + kv('GRN No', '<b>' + esc(refOf(g)) + '</b>', 'gno') + kv('GRN Date', dmy(g.date)) + kv('Supplier Name', '<b>' + esc(g.supplier) + '</b>', 'gsup') +
          (g.invoice_no ? kv('Invoice No.', esc(g.invoice_no)) : '') + (g.invoice_date ? kv('Invoice Date', dmy(g.invoice_date)) : '') + (g.challan_no ? kv('Challan No', esc(g.challan_no)) : '') + (g.vehicle_no ? kv('Vehicle No', esc(g.vehicle_no)) : '') +
          (g.po_no ? kv('PO No', esc(g.po_no)) : '') + (Number(g.tcs) ? kv('TCS', money(g.tcs)) : '') + kv('Gross Amount', '<b>' + money(g.gross) + '</b>', 'gamt') +
          '<div class="gacts"><button type="button" class="btn small gr-print">Print</button>' + (admin() ? '<button type="button" class="btn small gr-edit">Change</button><button type="button" class="btn small bad gr-del">Delete</button>' : '') + '</div></header>' +
        '<div class="gtw"><table class="glines"><thead><tr>' + LCOLS.map(h => '<th' + (/Qty|Rate|Amount|Sr No/.test(h) ? ' class="n"' : '') + '>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
          (g.lines.length ? g.lines.map(l => '<tr><td class="n">' + (++sr) + '</td><td class="gm">' + esc(l.name || '') + '</td><td class="n">' + n2(l.qty) + '</td><td>' + esc(l.unit || '') + '</td><td class="n">' + a2(l.rate) + '</td><td class="n">' + a2(l.taxable) + '</td><td class="n">' + a2(l.gst) + '</td><td class="n"><b>' + a2(l.gross) + '</b></td><td class="gr">' + esc(l.remark || '') + '</td></tr>').join('')
            : '<tr><td colspan="9" class="empty">No material.</td></tr>') + '</tbody></table></div>' + (g.remark ? '<p class="grem"><b>Remark:</b> ' + esc(g.remark) + '</p>' : '') + '</article>';
      const tot = GR.list.reduce((a, g) => a + Number(g.gross || 0), 0), rows = GR.list.reduce((a, g) => a + g.lines.length, 0);
      $('gr_list').innerHTML = '<div class="glhead"><h3>GRNs ' + dmy(val('gr_from')) + ' to ' + dmy(val('gr_to')) + '</h3><p class="count">' + GR.list.length + ' GRN(s) · ' + rows + ' row(s) · ' + money(tot) + '</p></div>' +
        (GR.list.map(card).join('') || '<p class="empty">No GRN in these dates.</p>'); }
    catch (e) { failed(e); }
  }
  async function grnClick(e) {
    const b = e.target.closest('button'), tr = e.target.closest('[data-no]'); if (!b || !tr) return; const g = GR.list.find(x => x.no === Number(tr.dataset.no)); if (!g) return;
    if (b.classList.contains('gr-print')) return printHtml('GRN ' + refOf(g), head('Goods Received Note – GRN ' + refOf(g), dmy(g.date)) + '<p><b>Supplier:</b> ' + esc(g.supplier) + (g.invoice_no ? ' · Invoice ' + esc(g.invoice_no) + ' ' + dmy(g.invoice_date) : '') + (g.challan_no ? ' · Challan ' + esc(g.challan_no) : '') + (g.vehicle_no ? ' · Vehicle ' + esc(g.vehicle_no) : '') + (g.po_no ? ' · PO ' + g.po_no : '') + '</p>' +
      '<table><thead><tr><th>#</th><th>Material</th><th class="n">Received Qty</th><th>UOM</th><th class="n">Basic Rate</th><th class="n">Taxable</th><th class="n">GST %</th><th class="n">GST</th><th class="n">Gross</th><th>Remark</th></tr></thead><tbody>' + g.lines.map((l, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(l.name) + '</td><td class="n">' + n2(l.qty) + '</td><td>' + esc(l.unit) + '</td><td class="n">' + n2(l.rate) + '</td><td class="n">' + n2(l.taxable) + '</td><td class="n">' + n2(l.gst_pct) + '</td><td class="n">' + n2(l.gst) + '</td><td class="n">' + n2(l.gross) + '</td><td>' + esc(l.remark || '') + '</td></tr>').join('') +
      (Number(g.tcs) ? '<tr><td colspan="8">TCS</td><td class="n">' + n2(g.tcs) + '</td><td></td></tr>' : '') + '<tr><td colspan="8"><b>Gross</b></td><td class="n"><b>' + n2(g.gross) + '</b></td><td></td></tr></tbody></table>' + (g.remark ? '<p>' + esc(g.remark) + '</p>' : '') + '<div class="sign"><div>Received by: ' + esc(g.created_name || '') + '</div><div>Store in-charge</div></div>');
    if (b.classList.contains('gr-edit')) return grnForm(g);
    if (b.classList.contains('gr-del')) { if (!await ask('Delete GRN ' + refOf(g) + '?', '<p>Its material goes out of the stock (refused if it was issued already).</p><p class="mr">हा GRN डिलीट होईल.</p>', [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, bad: true }])) return; return busy(b, async () => { await W('grnDelete', { no: g.no }); toast('GRN ' + refOf(g) + ' deleted.'); B = null; await boot(); grnLoad(); }); }
  }
  async function grnForm(g) {
    const f = $('gr_form'); f.hidden = false; f.innerHTML = '<p class="muted">Loading…</p>';
    try { await boot(); } catch (e) { failed(e); f.hidden = true; return; }      // (pressed before the page had its lists)
    let pos = []; try { pos = (await W('poOpen')).pos; } catch (e) { pos = []; }
    if (g && g.po_no && !pos.some(p => p.no === Number(g.po_no))) pos.push({ no: Number(g.po_no), vendor: g.supplier, lines: [] });
    // (28-10-2026, his picture) two cards: GRN Details – Clear and the GRN date at its top right; Items – + Add Row
    f.innerHTML = '<div class="gcard"><div class="ghead">' + ico('box', 'gico') + '<h3>GRN Details</h3>' + (g ? '<span class="gsub">Change GRN ' + esc(refOf(g)) + '</span>' : '') +
        '<div class="gact"><button type="button" class="btn" id="gr_clr" title="' + (g ? 'Back to the GRN as it is saved' : 'Empty the form') + '">' + ico('clear') + 'Clear</button>' +
          field('gr_ref', 'GRN No', inp('gr_ref', g ? refOf(g) : '', g ? ' readonly title="The GRN No of a saved GRN stays as it is"' : ' maxlength="20" autocomplete="off" placeholder="…"'), 'gref') + field('gr_date', 'GRN Date *', inp('gr_date', g ? g.date : today(), entryDate())) + '</div></div>' +
      '<div class="ggrid g3">' + field('gr_po', 'Against PO', sel('gr_po', [['', 'Direct (no PO)']].concat(pos.map(p => [p.no, 'PO ' + p.no + ' – ' + p.vendor + (p.lines.length ? ' (' + p.lines.filter(l => l.left > 0).map(l => l.name + ' ' + n2(l.left)).join(', ') + ')' : '')])), g ? g.po_no || '' : '')) +
        field('gr_sup', 'Supplier *', '<div class="ib">' + inp('gr_sup', g ? g.supplier : '', ' list="dl_wsuppliers" maxlength="80" autocomplete="off" placeholder="Select or type the supplier"') + ico('down') + '</div>') +
        field('gr_ch', 'Challan No', inp('gr_ch', g ? g.challan_no : '', ' maxlength="40"')) + '</div>' +
      '<div class="ggrid g4">' + field('gr_inv', 'Invoice No', inp('gr_inv', g ? g.invoice_no : '', ' maxlength="40"')) + field('gr_invd', 'Invoice Date', inp('gr_invd', g ? g.invoice_date : '', ' type="date"')) +
        field('gr_veh', 'Vehicle No', inp('gr_veh', g ? g.vehicle_no : '', ' maxlength="20"')) + field('gr_tcs', 'TCS ₹', inp('gr_tcs', g && Number(g.tcs) ? g.tcs : '', ' inputmode="decimal"')) + '</div>' +
      field('gr_rem', 'Remark', '<textarea id="gr_rem" rows="3" maxlength="300" placeholder="Enter remark (optional)…">' + esc(g ? g.remark || '' : '') + '</textarea>') + '</div>' +
      '<div class="gcard gitems"><div class="ghead">' + ico('box', 'gico blue') + '<h3>Items</h3><div class="gact"><button type="button" class="btn blue" id="gr_add">' + ico('plus') + 'Add Row</button></div></div><div id="gr_lines"></div></div>' +
      '<div class="gbtns"><button type="button" class="btn primary big" id="gr_save">' + ico('save') + 'Save GRN</button><button type="button" class="btn big" id="gr_x">' + ico('x') + 'Cancel</button></div>';
    const tot = rs => { const s = rs.filter(r => r.code).map(lineMoney).reduce((a, m) => ({ t: a.t + m.t, g: a.g + m.g, all: a.all + m.all }), { t: 0, g: 0, all: 0 }), tc = num(val('gr_tcs'));
      return '<td colspan="5">Total</td><td class="n">' + money(s.t) + '</td><td class="n">' + money(s.g) + '</td><td class="n">' + money(s.all) + '</td><td></td><td></td>' +
        (tc ? '</tr><tr class="tot"><td></td><td colspan="7">TCS ' + money(tc) + ' · Gross with TCS</td><td class="n">' + money(r2(s.all + tc)) + '</td><td></td><td></td>' : ''); };
    const cols = [{ k: 'item', h: 'Item *', type: 'item' }, { k: 'qty', h: 'Received Qty *', type: 'num' }, { k: 'unit', h: 'Unit', type: 'ro', calc: r => esc(r.unit || (itemOf(r.code) || {}).unit || '') }, { k: 'rate', h: 'Basic Rate ₹', type: 'num' }, { k: 'gst_pct', h: 'GST %', type: 'num', ph: '0' },
      { k: 'tx', h: 'Taxable', type: 'ro', n: true, calc: r => money(r.code ? lineMoney(r).t : 0) }, { k: 'gx', h: 'GST', type: 'ro', n: true, calc: r => money(r.code ? lineMoney(r).g : 0) }, { k: 'ax', h: 'Gross', type: 'ro', n: true, calc: r => money(r.code ? lineMoney(r).all : 0) },
      { k: 'remark', h: 'Remark', type: 'text' }];
    const picked = (r, i) => { if (r.gst_pct === '' && i.gst_pct !== null && i.gst_pct !== undefined) r.gst_pct = i.gst_pct; };
    let L = null;
    const fromPo = () => {
      const p = pos.find(z => z.no === Number(val('gr_po')));
      const rows = g && Number(g.po_no || 0) === Number(val('gr_po') || 0) ? g.lines.map(l => ({ code: l.code, name: l.name, unit: l.unit, qty: l.qty, rate: l.rate, gst_pct: l.gst_pct, po_line: l.po_line, remark: l.remark || '', fixedItem: !!l.po_line }))
        : p ? p.lines.filter(l => l.left > 0).map(l => ({ code: l.code, name: l.name, unit: l.unit, qty: l.left, rate: l.rate, gst_pct: l.gst_pct, po_line: l.line, fixedItem: true })) : [];
      if (p && !g && !val('gr_sup')) $('gr_sup').value = p.vendor;
      L = Lines($('gr_lines'), cols, rows, { total: tot, picked: picked, boxes: true, addRow: true });
    };
    fromPo(); $('gr_po').onchange = fromPo; $('gr_tcs').oninput = () => L.draw();
    $('gr_add').onclick = () => L.add();
    // (28-10-2026, "new grn number auto yeil … manually pn edit krta yeil") a new GRN: its GRN No comes by itself, it can be changed (step 4)
    if (!g) W('grnNext').then(r => { const e = $('gr_ref'); if (!e || e.dataset.typed) return; e.value = r.next; if (!r.step4) { e.readOnly = true; e.title = 'The GRN gets this number by itself. A number typed by hand needs the Store\'s database step 4 (sql/store_step4_grn_no.sql).'; } }).catch(() => { const e = $('gr_ref'); if (e) e.placeholder = 'the next number'; });
    $('gr_ref').addEventListener('input', () => { $('gr_ref').dataset.typed = '1'; });
    // Clear: a new GRN empty again; a GRN being changed back as it is saved (nothing saved is changed)
    $('gr_clr').onclick = async () => { if ((L.get().length || val('gr_sup')) && !await ask('Clear the form?', '<p>' + (g ? 'The GRN comes back as it is saved – what is typed here goes.' : 'What is typed here goes.') + ' Nothing saved is changed.</p><p class="mr">फॉर्म मध्ये टाइप केलेले जाईल – save केलेले काहीही बदलत नाही.</p>', [{ label: 'Cancel', value: false }, { label: 'Clear', value: true, primary: true }])) return; grnForm(g); };
    $('gr_x').onclick = () => { f.hidden = true; };
    $('gr_save').onclick = e => busy(e.target, async () => {
      const lines = L.get(); if (lines.some(l => !l.code)) throw new Error('Pick each item from the list (as it is in the Item Master).');
      const x = { no: g ? g.no : undefined, grn: { ref: g ? undefined : val('gr_ref').trim(), po_no: val('gr_po') || undefined, date: val('gr_date'), supplier: val('gr_sup'), challan_no: val('gr_ch'), invoice_no: val('gr_inv'), invoice_date: val('gr_invd'), vehicle_no: val('gr_veh'), tcs: val('gr_tcs'), remark: val('gr_rem'),
        lines: lines.map(l => ({ code: l.code, qty: l.qty, rate: l.rate, gst_pct: l.gst_pct, po_line: l.po_line || undefined, remark: l.remark || undefined })) } };
      let r; try { r = await saveAsk('grnSave', x); } catch (e2) { if (e2 && e2.code === 'refused' && e2.data && e2.data.next && $('gr_ref')) { $('gr_ref').value = e2.data.next; delete $('gr_ref').dataset.typed; } throw e2; }
      if (!r) return;
      toast('GRN ' + (r.ref || r.no) + ' saved – ' + money(r.gross) + '.'); f.hidden = true; B = null; await boot(); grnLoad();
    });
    f.scrollIntoView({ block: 'nearest' });
  }

  /* ====================== ISSUE (OUTWARD) & RETURN ====================== */
  const IS = { list: [] };
  async function issuePage() {
    const el = $('pg_issue');
    el.innerHTML = '<section class="panel"><h2>Issue (Outward) &amp; Return</h2><p class="muted" style="margin:0">Material given out: to site work, a sub-contractor, a machinery (it goes into its maintenance log book in Mechanical) or the office; what comes back – Return.</p>' +
      '<div class="bar">' + field('is_from', 'From', inp('is_from', monthStart(), ' type="date"')) + field('is_to', 'To', inp('is_to', today(), ' type="date"')) + '<button type="button" class="btn" id="is_show">Show</button>' +
      (canEdit('issue') ? '<button type="button" class="btn primary" id="is_new">+ New issue</button>' : '') + '<button type="button" class="btn" id="is_xl">Issue register (Excel)</button>' +
      (admin() ? '<button type="button" class="btn" id="is_imp">Import from Excel</button><button type="button" class="btn small" id="is_tpl">Import format</button><input type="file" id="is_file" accept=".xlsx,.xls,.csv" hidden>' : '') + '</div></section>' +
      '<section class="panel formbox" id="is_form" hidden></section><section class="panel formbox" id="is_impbox" hidden></section><section class="panel" id="is_list"></section>';
    $('is_show').onclick = () => issueLoad();
    if ($('is_new')) $('is_new').onclick = () => issueForm(null);
    $('is_xl').onclick = () => busy($('is_xl'), async () => toExcel(await W('report', { kind: 'issue', from: val('is_from'), to: val('is_to') }), 'Issue_register'));
    if ($('is_imp')) { $('is_imp').onclick = () => { $('is_file').value = ''; $('is_file').click(); }; $('is_file').onchange = () => importFile('issue', $('is_file').files[0], $('is_impbox'), issueLoad); $('is_tpl').onclick = () => importTemplate('issue'); }
    $('is_list').onclick = e => issueClick(e);
    await boot(); await issueLoad();
  }
  const toWho = i => i.to_kind === 'Machinery' ? i.machinery + (i.party ? ' (' + i.party + ')' : '') : i.to_kind === 'Sub-contractor' ? i.party : i.to_kind === 'Site work' ? 'RCL – site work' : 'Office';
  async function issueLoad() {
    try { const r = await W('issueList', { from: val('is_from'), to: val('is_to') }); IS.list = r.issues;
      $('is_list').innerHTML = '<div class="tw"><table><thead><tr><th>Outward</th><th>Date</th><th>Issued to</th><th>Location · side</th><th>Use for</th><th>Items</th><th class="n">Amount</th><th>Returns</th><th></th></tr></thead><tbody>' +
        (IS.list.map(i => { const out = i.lines.filter(l => l.returnable && l.qty - (l.back || 0) > 0.0005);
          return '<tr data-no="' + i.no + '"><td><b>' + i.no + '</b>' + (i.debit ? ' ' + tag('Debit', 'warn') : '') + '</td><td>' + dmy(i.date) + '</td><td>' + esc(toWho(i)) + (i.receiver ? '<small>' + esc(i.receiver) + '</small>' : '') + (i.reading !== null && i.reading !== undefined ? '<small>Reading ' + n2(i.reading) + '</small>' : '') + '</td><td>' + esc([i.location, i.side].filter(Boolean).join(' · ')) + '</td><td style="white-space:normal">' + esc(i.use_for || '') + '</td>' +
            '<td style="white-space:normal">' + i.lines.map(l => esc(l.name + ' ' + n2(l.qty) + ' ' + l.unit) + (l.returnable ? ' <small>returnable' + (l.back ? ', ' + n2(l.back) + ' back' : '') + '</small>' : l.back ? ' <small>' + n2(l.back) + ' back</small>' : '')).join('<br>') + '</td><td class="n">' + money(i.amount) + '</td>' +
            '<td>' + (i.returns || []).map(r => 'Return ' + r.no + ' · ' + dmy(r.date) + (admin() ? ' <button type="button" class="link del is-rdel" data-r="' + r.no + '">Delete</button>' : '')).join('<br>') + (out.length ? '<small>' + out.length + ' returnable item(s) out</small>' : '') + '</td>' +
            '<td><div class="acts">' + (canEdit('issue') ? '<button type="button" class="link is-ret">Return</button>' : '') + '<button type="button" class="link is-print">Print</button>' + (admin() ? '<button type="button" class="link is-edit">Change</button><button type="button" class="link del is-del">Delete</button>' : '') + '</div></td></tr>'; }).join('') || '<tr><td colspan="9" class="empty">No issue in these dates.</td></tr>') + '</tbody></table></div>' +
        '<p class="count">' + IS.list.length + ' issue(s) · ' + money(IS.list.reduce((a, i) => a + Number(i.amount || 0), 0)) + '</p>'; }
    catch (e) { failed(e); }
  }
  async function issueClick(e) {
    const b = e.target.closest('button'), tr = e.target.closest('tr[data-no]'); if (!b || !tr) return; const i = IS.list.find(x => x.no === Number(tr.dataset.no)); if (!i) return;
    if (b.classList.contains('is-ret')) return retForm(i);
    if (b.classList.contains('is-edit')) return issueForm(i);
    if (b.classList.contains('is-print')) return printHtml('Outward ' + i.no, head('Issue (Outward) – ' + i.no, dmy(i.date)) + '<p><b>Issued to:</b> ' + esc(toWho(i)) + (i.location ? ' · Location ' + esc(i.location) : '') + (i.side ? ' · ' + esc(i.side) : '') + (i.use_for ? ' · Use for: ' + esc(i.use_for) : '') + (i.receiver ? ' · Receiver: ' + esc(i.receiver) : '') + '</p>' +
      '<table><thead><tr><th>#</th><th>Material</th><th class="n">Qty</th><th>UOM</th><th class="n">Rate</th><th class="n">Amount</th><th>Returnable</th><th>Serial No</th></tr></thead><tbody>' + i.lines.map((l, k) => '<tr><td>' + (k + 1) + '</td><td>' + esc(l.name) + '</td><td class="n">' + n2(l.qty) + '</td><td>' + esc(l.unit) + '</td><td class="n">' + n2(l.rate) + '</td><td class="n">' + n2(r2(Number(l.amount) + Number(l.gst || 0))) + '</td><td>' + (l.returnable ? 'Yes' : '') + '</td><td>' + esc(l.serial || '') + '</td></tr>').join('') +
      '</tbody></table><div class="sign"><div>Issued by: ' + esc(i.created_name || '') + '</div><div>Received by: ' + esc(i.receiver || '') + '</div></div>');
    if (b.classList.contains('is-del')) { if (!await ask('Delete outward ' + i.no + '?', '<p>Its material comes back into the stock.</p><p class="mr">हे issue डिलीट होईल.</p>', [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, bad: true }])) return; return busy(b, async () => { await W('issueDelete', { no: i.no }); toast('Outward ' + i.no + ' deleted.'); B = null; await boot(); issueLoad(); }); }
    if (b.classList.contains('is-rdel')) { const n = Number(b.dataset.r); if (!await ask('Delete return ' + n + '?', '<p>What came back goes out of the stock again.</p>', [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, bad: true }])) return; return busy(b, async () => { await W('retDelete', { no: n }); toast('Return ' + n + ' deleted.'); B = null; await boot(); issueLoad(); }); }
  }
  function issueForm(i) {
    if (!B) return void boot().then(() => issueForm(i)).catch(failed);      // (pressed before the page had its lists)
    const f = $('is_form'); f.hidden = false;
    f.innerHTML = '<h2>' + (i ? 'Change outward ' + i.no : 'New issue') + '</h2><div class="grid" style="margin-top:10px">' +
      field('is_date', 'Date *', inp('is_date', i ? i.date : today(), entryDate())) + field('is_kind', 'Issued to *', sel('is_kind', B.kinds.to, i ? i.to_kind : 'Site work')) + '<div class="field wide" id="is_whow"></div>' +
      field('is_loc', 'Location (chainage)', inp('is_loc', i ? i.location : '', ' maxlength="120" placeholder="e.g. 540+450 to 540+480"')) + field('is_side', 'Side', sel('is_side', [['', '–']].concat(B.kinds.sides), i ? i.side : '')) +
      field('is_use', 'Use for (work)', inp('is_use', i ? i.use_for : '', ' maxlength="120" placeholder="e.g. Toe wall, BC, Consumable"'), 'wide') + field('is_rcv', 'Receiver', inp('is_rcv', i ? i.receiver : '', ' maxlength="80"')) +
      '<div class="field" id="is_debw"><label><input type="checkbox" id="is_deb" style="width:auto;min-height:0"' + (i && i.debit ? ' checked' : '') + '> On debit (charged to them, with GST)</label></div>' + field('is_rem', 'Remark', inp('is_rem', i ? i.remark : '', ' maxlength="300"'), 'wide') + '</div><div id="is_lines"></div>' +
      '<div class="bar"><button type="button" class="btn primary" id="is_save">Save issue</button><button type="button" class="btn" id="is_x">Cancel</button></div>';
    const who = () => { const k = val('is_kind');
      $('is_whow').innerHTML = k === 'Sub-contractor' ? '<label for="is_party">Sub-contractor *</label>' + inp('is_party', i ? i.party : '', ' list="dl_wsubs" maxlength="80" autocomplete="off"')
        : k === 'Machinery' ? '<div class="grid" style="grid-template-columns:2fr 1fr;gap:10px"><div><label for="is_mach">Machinery *</label>' + sel('is_mach', [['', 'Pick…']].concat((B.machinery || []).map(m => [m.no, m.no + (m.name ? ' – ' + m.name : '') + (m.own && m.own !== 'Own' ? ' (' + m.own + ')' : '')])), i ? i.machinery : '') + '</div><div><label for="is_read">Reading (KM / Hrs)</label>' + inp('is_read', i && i.reading !== null ? i.reading : '', ' inputmode="decimal"') + '</div></div>' : '';
      $('is_debw').hidden = !(k === 'Sub-contractor' || k === 'Machinery'); if ($('is_debw').hidden) $('is_deb').checked = false; draw(); };
    let L = null;
    const draw = () => { const deb = $('is_deb').checked, rows = L ? L.rows : (i ? i.lines.map(l => ({ code: l.code, qty: l.qty, returnable: l.returnable, serial: l.serial || '', rate: i.debit ? l.rate : '', gst_pct: i.debit ? l.gst_pct : '', remark: l.remark || '' })) : []);
      L = Lines($('is_lines'), [{ k: 'item', h: 'Item *', type: 'item' }, { k: 'qty', h: 'Qty *', type: 'num' }, { k: 'unit', h: 'Unit', type: 'ro', calc: r => esc((itemOf(r.code) || {}).unit || '') }, { k: 'st', h: 'Stock now', type: 'ro', n: true, calc: r => r.code ? n2(stockOf(r.code)) : '' },
        { k: 'returnable', h: 'Returnable', type: 'check' }, { k: 'serial', h: 'Serial No (tyre / battery)', type: 'text' }].concat(deb ? [{ k: 'rate', h: 'Debit rate ₹ (blank = average)', type: 'num' }, { k: 'gst_pct', h: 'GST %', type: 'num' }] : []).concat([{ k: 'remark', h: 'Remark', type: 'text' }]), rows,
        { picked: (r, it) => { if (deb && r.gst_pct === '' && it.gst_pct !== null && it.gst_pct !== undefined) r.gst_pct = it.gst_pct; } }); };
    who(); $('is_kind').onchange = () => { L = L; who(); }; $('is_deb').onchange = draw;
    $('is_x').onclick = () => { f.hidden = true; };
    $('is_save').onclick = e => busy(e.target, async () => {
      const lines = L.get(); if (lines.some(l => !l.code)) throw new Error('Pick each item from the list (as it is in the Item Master).');
      const x = { no: i ? i.no : undefined, issue: { date: val('is_date'), to_kind: val('is_kind'), party: val('is_party'), machinery: val('is_mach'), reading: val('is_read'), location: val('is_loc'), side: val('is_side'), use_for: val('is_use'), receiver: val('is_rcv'), debit: $('is_deb').checked, remark: val('is_rem'),
        lines: lines.map(l => ({ code: l.code, qty: l.qty, returnable: !!l.returnable, serial: l.serial, rate: l.rate, gst_pct: l.gst_pct, remark: l.remark })) } };
      const r = await saveAsk('issueSave', x); if (!r) return;
      toast('Outward ' + r.no + ' saved – ' + money(r.amount) + '.'); f.hidden = true; B = null; await boot(); issueLoad();
    });
    f.scrollIntoView({ block: 'nearest' });
  }
  async function retForm(i) {
    const f = $('is_form'); f.hidden = false;
    const left = i.lines.filter(l => l.qty - (l.back || 0) > 0.0005);
    if (!left.length) { f.hidden = true; return toast('Everything of outward ' + i.no + ' has come back.', true); }
    f.innerHTML = '<h2>Return to the store – outward ' + i.no + ' (' + esc(toWho(i)) + ', ' + dmy(i.date) + ')</h2><div class="grid" style="margin-top:10px">' + field('rt_date', 'Return date *', inp('rt_date', today(), entryDate())) + field('rt_rem', 'Remark', inp('rt_rem', '', ' maxlength="300"'), 'wide') + '</div>' +
      '<div class="tw"><table class="lines"><thead><tr><th>Item</th><th class="n">Issued</th><th class="n">Back before</th><th class="n">Still out</th><th>Back now</th><th>Remark (condition)</th></tr></thead><tbody>' +
      left.map(l => '<tr data-l="' + l.id + '"><td>' + esc(l.name) + (l.returnable ? ' ' + tag('returnable', 'blue') : '') + '</td><td class="n">' + n2(l.qty) + ' ' + esc(l.unit) + '</td><td class="n">' + n2(l.back || 0) + '</td><td class="n">' + n2(r2(l.qty - (l.back || 0))) + '</td><td><input class="q rt-q" inputmode="decimal"></td><td><input class="s rt-r" maxlength="120"></td></tr>').join('') + '</tbody></table></div>' +
      '<div class="bar"><button type="button" class="btn primary" id="rt_save">Save return</button><button type="button" class="btn" id="rt_x">Cancel</button></div>';
    $('rt_x').onclick = () => { f.hidden = true; };
    $('rt_save').onclick = e => busy(e.target, async () => {
      const lines = [...f.querySelectorAll('tr[data-l]')].map(tr => ({ issue_line: Number(tr.dataset.l), qty: tr.querySelector('.rt-q').value, remark: tr.querySelector('.rt-r').value })).filter(l => String(l.qty).trim());
      if (!lines.length) throw new Error('Type what came back of at least one item.');
      const r = await W('retSave', { ret: { issue_no: i.no, date: val('rt_date'), remark: val('rt_rem'), lines: lines } });
      toast('Return ' + r.no + ' saved.'); f.hidden = true; B = null; await boot(); issueLoad();
    });
    f.scrollIntoView({ block: 'nearest' });
  }

  /* ====================== EXCEL IMPORT (the Store Admin) – his INWARD / OUTWORD columns ====================== */
  const IMP = {
    // (28-10-2026) the GRN's format: his inward register's columns (read by regFile – the same as his file)
    grn: { head: ['Sr No', 'GRN No', 'GRN Date', 'Challan No', 'Invoice No.', 'Invoice Date', 'Vehicle No', 'Supplier Name', 'Material Description', 'Received Qty', 'UOM', 'Basic Rate', 'Taxable Amount', 'GST Amount', 'TCS', 'Gross Amount', 'Remark'],
      map: { ref: /^grn\s*no/, date: /^grn\s*date|^date$/, challan_no: /challan/, invoice_no: /^invoice\s*no/, invoice_date: /^invoice\s*date|^invoive/, vehicle_no: /vehicle/, party: /supplier|party/, item: /material|item/, qty: /received\s*qty|^qty|inward\s*qty/, rate: /basic\s*rate|^rate/, gst_pct: /gst\s*%|gst\s*rate/, tcs: /^tcs/, remark: /remark/ } },
    issue: { head: ['Date', 'Outward No', 'Party Name', 'Sub Contractor Name', 'Machinery', 'Reading', 'Material', 'Qty', 'UOM', 'Location', 'Side', 'Use For', 'Receiver Name', 'Returnable', 'Serial No', 'Remark'],
      map: { date: /^date$|issue\s*date/, ref: /out\s*w(o|a)rd\s*no|outward\s*no/, party: /sub\s*contractor/, party0: /^party/, machinery: /machinery|vehicle/, reading: /reading/, item: /^material|item/, qty: /^qty|issued?\s*qty/, location: /location/, side: /^side/, use_for: /use\s*for|work\s*desc/, receiver: /receiver/, returnable: /returnable/, serial: /serial|battery\s*no|tyre\s*no/, remark: /remark/ } },
  };
  async function importTemplate(kind) { const X = await K().xlsx(), ws = X.utils.aoa_to_sheet([IMP[kind].head]); const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, kind === 'grn' ? 'Inward' : 'Outward'); X.writeFile(wb, (kind === 'grn' ? 'GRN' : 'Issue') + '_import_format.xlsx'); }
  async function importFile(kind, file, box, reload) {
    if (!file) return;
    try {
      const X = await K().xlsx(), wb = X.read(await file.arrayBuffer(), { type: 'array', cellDates: true }), ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = X.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
      const hi = aoa.findIndex(r => r.some(c => /material|item/i.test(String(c))));
      if (hi < 0) throw new Error('The file has no "Material" heading – use the Import format.');
      const h = aoa[hi].map(c => String(c).replace(/\s+/g, ' ').trim().toLowerCase()), M = IMP[kind].map, col = {};
      Object.keys(M).forEach(k => { col[k] = h.findIndex(c => M[k].test(c)); });
      const rows = []; aoa.slice(hi + 1).forEach((r, n) => { const g = k => col[k] < 0 ? '' : String(r[col[k]] === undefined ? '' : r[col[k]]).trim(); const x = { line: hi + n + 2 }; Object.keys(M).forEach(k => { x[k] = g(k); });
        if (kind === 'issue' && !x.party && x.party0) x.party = x.party0; delete x.party0; if (x.item && x.qty) rows.push(x); });
      if (!rows.length) throw new Error('The file has no rows with a material and its quantity.');
      const go = async check => W('importDocs', { kind: kind, rows: rows, check: check });
      const r = await go(true); box.hidden = false;
      box.innerHTML = '<h2>Import from Excel – check</h2><p class="muted">' + rows.length + ' rows → ' + r.docs + ' ' + (kind === 'grn' ? 'GRN(s)' : 'issue(s)') + ', ' + r.errors + ' with a mistake.' + (r.errors ? ' Correct them in the file and choose it again – nothing is imported while one is left.' : '') + '</p>' +
        '<div class="tw"><table><thead><tr><th>Line</th><th>No in the file</th><th>Item</th><th>Result</th></tr></thead><tbody>' + r.rows.map(x => '<tr><td>' + x.line + '</td><td>' + esc(x.ref) + '</td><td>' + esc(x.item) + '</td><td style="white-space:normal">' + (x.status === 'ok' ? tag('OK') : tag('Mistake', 'bad')) + ' ' + esc(x.msg || '') + '</td></tr>').join('') + '</tbody></table></div>' +
        '<div class="bar"><button type="button" class="btn primary" id="im_go"' + (r.errors || !r.docs ? ' disabled' : '') + '>Import ' + r.docs + '</button><button type="button" class="btn" id="im_x">Cancel</button></div>';
      $('im_x').onclick = () => { box.hidden = true; };
      $('im_go').onclick = e => busy(e.target, async () => { const z = await go(false); toast(z.saved + ' imported (' + (kind === 'grn' ? 'GRN ' : 'Outward ') + z.nos.join(', ') + ').'); box.hidden = true; B = null; await boot(); reload(); });
      box.scrollIntoView({ block: 'nearest' });
    } catch (e) { failed(e); }
  }

  /* ====================== THE OLD INWARD REGISTER (28-10-2026, the Store Admin) ======================
   * His "INWARD UPTO GRN … .xlsx" – or any file with the register's headings: every sheet is read and the register's taken (grnreg.js:
   * the sheet with GRN No · Material · Qty and the most rows). The check first – nothing saved: the new suppliers and items, the names
   * the AI finds written in more than one way (he ticks), the same row twice (he deletes what he wants; kept when he does not), the
   * rows to look at (corrected here, else left out), the notes. Then Import a part at a time – suppliers (the Vendor Master, "Material
   * Supplier"), items (the Item Master), GRNs with the file's GRN No. A GRN already in the Store is never saved twice: Import again
   * goes on from where it stopped. What he chose is kept in this browser for this file until the import is done. */
  const RGI = {};
  const G2 = () => window.RSG;
  const pause = () => new Promise(r => setTimeout(r, 30));
  const n0 = v => Number(v || 0).toLocaleString('en-IN');
  const memKey = () => 'rs_reg:' + ((K().S.me || {}).site || '') + ':' + RGI.file.name + ':' + RGI.file.size;
  const memGet = () => { try { return JSON.parse(localStorage.getItem(memKey()) || 'null'); } catch (e) { return null; } };
  const memPut = () => { try { localStorage.setItem(memKey(), JSON.stringify({ ch: RGI.ch, ai: RGI.ai })); } catch (e) { /* a private window: kept on this page only */ } };
  const memDrop = () => { try { localStorage.removeItem(memKey()); } catch (e) { /* nothing kept */ } };
  const AIL = { party: ['supplier', 'Suppliers'], item: ['item', 'Items'], category: ['category', 'Categories'] };

  async function regFile(file, box) {
    if (!file) return;
    Object.assign(RGI, { box: box, file: file, run: null }); box.hidden = false;
    box.innerHTML = '<h2>Import the inward register</h2><p class="muted">Reading ' + esc(file.name) + ' … (a big file takes a few seconds)</p>';
    box.scrollIntoView({ block: 'nearest' });
    try {
      const X = await K().xlsx(); await pause();
      const wb = X.read(await file.arrayBuffer(), { type: 'array' });      // (numbers as they are: a date is Excel's day number – grnreg.js reads it)
      const sheets = wb.SheetNames.map(n => { const ws = wb.Sheets[n]; let r0 = 0; try { r0 = ws['!ref'] ? X.utils.decode_range(ws['!ref']).s.r : 0; } catch (e) { r0 = 0; }
        return { name: n, r0: r0, aoa: X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) }; });
      const sh = G2().pickSheet(sheets);
      if (!sh) throw new Error('No sheet of this file has the inward register\'s headings (GRN No or GRN Date, Supplier Name, Material Description, Received Qty) – see "Import format".');
      const rows = G2().readRows(sh);
      if (!rows.length) throw new Error('The sheet "' + sh.name + '" has no rows under its headings.');
      box.innerHTML = '<h2>Import the inward register</h2><p class="muted">' + n0(rows.length) + ' rows read – checking them with the Store …</p>';
      const info = await W('regInfo');
      Object.assign(RGI, { sheet: sh.name, others: sh.others, rows: rows, info: info, ch: { fix: { party: {}, item: {}, category: {} }, gone: {}, edit: {} }, ai: null, q: {} });
      const m = memGet(); if (m && m.ch) { RGI.ch = Object.assign(RGI.ch, m.ch); RGI.ai = m.ai || null; }
      regPlan(); regDraw();
    } catch (e) { failed(e); box.innerHTML = '<h2>Import the inward register</h2><div class="errbox">' + esc(e.message) + '</div><div class="bar"><button type="button" class="btn" id="rg_x">Close</button></div>'; $('rg_x').onclick = () => { box.hidden = true; }; }
  }
  const regPlan = () => { RGI.p = G2().plan(RGI.rows, RGI.info, RGI.ch, RGI.info.today); };

  // a list that can be long: the first 300 rows that have what is typed in its search box
  function regList(id, head, rows, cells, empty) {
    const q = String(RGI.q[id] || '').toLowerCase(), got = q ? rows.filter(r => JSON.stringify(r).toLowerCase().indexOf(q) > -1) : rows;
    return '<div class="bar" style="margin:8px 0">' + (rows.length > 12 ? '<div class="field grow" style="margin:0"><input class="rg-q" data-l="' + id + '" value="' + esc(RGI.q[id] || '') + '" placeholder="Search in this list"></div>' : '') +
      (rows.length > 12 ? '<span class="count">' + (q ? n0(got.length) + ' of ' : '') + n0(rows.length) + (got.length > 300 ? ' – the first 300 shown (all of them in "Excel of the check")' : '') + '</span>' : '') + '</div>' +
      '<div class="tw rgsc" id="rgs_' + id + '" style="max-height:420px;overflow:auto"><table class="lines"><thead><tr>' + head.map(h => '<th' + (/^(Qty|Rows|GST %|Gross ₹|Line|Same as line)$/.test(h) ? ' class="n"' : '') + '>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
      (got.slice(0, 300).map(cells).join('') || '<tr><td colspan="' + head.length + '" class="empty">' + esc(empty || 'None.') + '</td></tr>') + '</tbody></table></div>';
  }

  function regDraw() {
    const p = RGI.p, info = RGI.info, b = RGI.box, run = RGI.run;
    const keep = {}; b.querySelectorAll('.rgsc').forEach(e => { keep[e.id] = e.scrollTop; });
    const open = {}; b.querySelectorAll('details[id]').forEach(e => { open[e.id] = e.open; });
    const isOpen = (id, d) => (open[id] === undefined ? d : open[id]) ? ' open' : '';
    const tile = (cls, l, n, s) => '<div class="tile ' + cls + '"><small>' + esc(l) + '</small><b>' + n + '</b><span>' + esc(s) + '</span></div>';
    const sec = (id, t, n, body, d) => '<details id="' + id + '"' + isOpen(id, d) + ' style="margin-top:12px"><summary style="cursor:pointer;font-weight:700;font-size:16px">' + esc(t) + ' <span class="tag' + (n ? ' warn' : ' off') + '">' + n0(n) + '</span></summary>' + body + '</details>';
    const dupCut = p.dups.filter(d => !d.gone).length, ai = RGI.ai;
    const aiRows = l => ((ai && ai[l]) || []).map(z => ({ from: z[0], to: z[1], rows: z[2], on: RGI.ch.fix[l][z[0]] === z[1] }));
    const aiN = ai ? Object.keys(AIL).reduce((a, l) => a + ((ai[l] || []).length), 0) : 0, aiOn = Object.keys(AIL).reduce((a, l) => a + Object.keys(RGI.ch.fix[l] || {}).length, 0);
    const ranges = (p.from ? dmy(p.from) + ' to ' + dmy(p.to) : '');
    b.innerHTML = '<h2>Import the inward register – check</h2>' +
      '<p class="muted" style="margin:2px 0 10px">' + esc(RGI.file.name) + ' · sheet "' + esc(RGI.sheet) + '" – ' + n0(RGI.rows.length) + ' rows' + (RGI.others.length ? ' (the other sheets – ' + esc(RGI.others.slice(0, 6).join(', ')) + (RGI.others.length > 6 ? ' …' : '') + ' – are not the register)' : '') + '. Nothing is saved until Import.</p>' +
      '<p class="mr muted" style="margin:0 0 10px">काहीही save झालेले नाही – खालची यादी तपासा, मग Import दाबा.</p>' +
      (info.step3 ? '' : '<div class="errbox">The Store\'s database step 3 is not run in this site yet: the Admin runs <b>sql/store_step3_grn_import.sql</b> once in Supabase → SQL Editor (in every site). Until then the check can be seen, Import cannot be done.</div>') +
      '<div class="tiles">' + tile('g', 'GRNs to import', n0(p.docs.length), n0(p.lines) + ' lines · ' + money(p.gross).replace(/\.\d\d$/, '') + (ranges ? ' · ' + ranges : '')) +
      tile('m', 'Already in the Store', n0(p.already.length), 'left out – never twice') + tile('b', 'New suppliers', n0(p.newSup.length), 'into the Vendor Master (Material Supplier)') +
      tile('b', 'New items', n0(p.newItems.length), 'into the Item Master') + tile(dupCut ? 'a' : 'm', 'Duplicate rows', n0(p.dups.length), dupCut + ' kept (imported) · ' + (p.dups.length - dupCut) + ' deleted') +
      tile(p.look.length ? 'a' : 'm', 'Rows to look at', n0(p.look.length), 'left out until corrected') + tile('g', 'Next new GRN', p.next, 'goes on after the file\'s ' + (p.maxRef || '–')) + '</div>' +
      (p.noRef ? '<p class="note2">' + p.noRef + ' GRN(s) of the file have no GRN No – they get the numbers ' + p.first + (p.noRef > 1 ? ' to ' + (p.first + p.noRef - 1) : '') + '.</p>' : '') +
      (p.empty.length ? '<p class="count">' + n0(p.empty.length) + ' row(s) have only a GRN No, date or supplier (no material, quantity or amount) – nothing to import there.</p>' : '') +
      sec('rgd_look', 'Rows to look at – correct here, else they are left out', p.look.length, '<p class="muted">Type what is missing (the row is then checked again). तपासायच्या ओळी – इथेच दुरुस्त करा, नाहीतर त्या import होणार नाहीत.</p>' +
        regList('look', ['Line', 'GRN No', 'GRN Date', 'Supplier', 'Material', 'Qty', 'Why'], p.look, l => { const e = RGI.ch.edit[l.line] || {};
          return '<tr data-line="' + l.line + '"><td class="n">' + l.line + '</td><td>' + esc(l.ref || '') + '</td><td><input type="date" class="rg-e" data-k="date" value="' + esc(e.date || l.date || '') + '" style="width:150px"></td>' +
            '<td><input class="rg-e" data-k="party" value="' + esc(e.party || l.party || '') + '" list="dl_wsuppliers" style="width:200px"></td><td><input class="rg-e" data-k="item" value="' + esc(e.item || l.item || '') + '" style="width:240px"></td>' +
            '<td><input class="rg-e q" data-k="qty" inputmode="decimal" value="' + esc(e.qty !== undefined ? e.qty : l.qty || '') + '"></td><td style="white-space:normal;min-width:220px">' + l.why.map(w => tag(w, 'bad')).join(' ') + '</td></tr>'; }, 'No row to look at.'), !!p.look.length) +
      sec('rgd_dup', 'Duplicate rows – the same row twice in the file', p.dups.length, '<p class="muted">Every column the same as an earlier row. Delete what is a mistake; what you do not delete is imported as it is. Duplicate ओळी – चुकीची असेल ती Delete करा; Delete न केलेली तशीच save होईल.</p>' +
        '<div class="bar" style="margin:6px 0"><button type="button" class="btn small bad" id="rg_dupall">Delete all duplicates</button><button type="button" class="btn small" id="rg_dupnone">Keep all</button></div>' +
        regList('dup', ['Line', 'Same as line', 'GRN No', 'GRN Date', 'Supplier', 'Material', 'Qty', 'Gross ₹', ''], p.dups, d => '<tr data-line="' + d.line + '"' + (d.gone ? ' class="off"' : '') + '><td class="n">' + d.line + '</td><td class="n">' + d.first + '</td><td>' + esc(d.row.ref || d.row.refText || '') + '</td><td>' + dmy(d.row.date) + '</td><td>' + esc(d.row.party) + '</td><td>' + esc(d.row.item) + '</td><td class="n">' + esc(d.row.qty) + '</td><td class="n">' + esc(d.row.gross === '' ? '' : n2(d.row.gross)) + '</td>' +
          '<td>' + (d.gone ? tag('Deleted', 'off') + ' <button type="button" class="link rg-dup" data-v="0">Undo</button>' : '<button type="button" class="link del rg-dup" data-v="1">Delete</button>') + '</td></tr>', 'No row twice.'), !!p.dups.length) +
      sec('rgd_ai', 'Names written in more than one way (the AI) – tick what is the same', aiN, !info.ai ? '<p class="note2">The AI is not set up for the Store (ANTHROPIC_API_KEY in Vercel → rcl-store → Environment Variables) – the names stay as in the file (a name with the same letters – "Oil-Filter", "OIL FILTER" – is one already).</p>' :
        '<p class="muted">The AI reads the suppliers, items and categories of the file and lists the ones written differently. Tick (✓) what is the same thing – it is then saved with the right spelling. What is not ticked stays as in the file. ' + (aiN ? aiOn + ' ticked.' : '') + '</p>' +
        '<div class="bar" style="margin:6px 0">' + (RGI.aiRun ? '<span class="tag warn">' + esc(RGI.aiRun) + '</span><button type="button" class="btn small" id="rg_aistop">Stop</button>' : '<button type="button" class="btn small primary" id="rg_ai">' + (ai && ai.parts ? (ai.left ? 'Go on with the AI (' + ai.left + ' parts left)' : 'Ask the AI again') : 'Find them with the AI') + '</button>') + (ai && ai.err ? '<span class="tag bad">' + esc(ai.err) + '</span>' : '') + '</div>' +
        Object.keys(AIL).map(l => !(ai && ai[l] && ai[l].length) ? '' : '<h3 style="margin:12px 0 0;font-size:15px">' + AIL[l][1] + ' <span class="count">' + ai[l].length + '</span> <button type="button" class="link rg-aiall" data-l="' + l + '" data-v="1">✓ all</button> · <button type="button" class="link rg-aiall" data-l="' + l + '" data-v="0">none</button></h3>' +
          regList('ai_' + l, ['✓', 'In the file', 'Right spelling', 'Rows'], aiRows(l), z => '<tr><td><input type="checkbox" class="rg-ai" data-l="' + l + '" data-f="' + esc(z.from) + '" data-t="' + esc(z.to) + '"' + (z.on ? ' checked' : '') + ' style="width:auto;min-height:0"></td><td style="white-space:normal">' + esc(z.from) + '</td><td style="white-space:normal"><b>' + esc(z.to) + '</b></td><td class="n">' + n0(z.rows) + '</td></tr>')).join(''), false) +
      sec('rgd_sup', 'New suppliers – into the Vendor Master as "Material Supplier" (GST, PAN, Aadhaar to fill later)', p.newSup.length, regList('sup', ['Supplier', 'Rows'], p.newSup, s => '<tr><td>' + esc(s.name) + '</td><td class="n">' + n0(s.rows) + '</td></tr>'), false) +
      sec('rgd_items', 'New items – into the Item Master', p.newItems.length, '<p class="muted">Unit: the one most of its rows have; category: its Remark when that is used in 20 rows or more, else General; GST %: the usual one of its rows. All can be changed later in the Item Master.</p>' +
        regList('items', ['Item', 'Unit', 'Category', 'GST %', 'Rows'], p.newItems, i => '<tr><td style="white-space:normal">' + esc(i.name) + '</td><td>' + esc(i.unit) + '</td><td>' + esc(i.category) + '</td><td class="n">' + esc(i.gst) + '</td><td class="n">' + n0(i.rows) + '</td></tr>'), false) +
      sec('rgd_notes', 'Notes – imported as the file has them', p.notes.length, regList('notes', ['Line', 'GRN No', 'Note'], p.notes, z => '<tr><td class="n">' + z.line + '</td><td>' + esc(z.ref || '') + '</td><td style="white-space:normal">' + (z.big ? tag('Check', 'warn') + ' ' : '') + esc(z.msg) + '</td></tr>'), false) +
      sec('rgd_have', 'Already in the Store – left out', p.already.length, regList('have', ['GRN No', 'GRN Date', 'Supplier', 'Invoice'], p.already, d => '<tr><td>' + esc(d.ref) + '</td><td>' + dmy(d.date) + '</td><td>' + esc(d.supplier) + '</td><td>' + esc(d.invoice_no || '') + '</td></tr>'), false) +
      (run ? regRunHtml() : '') +
      '<div class="bar"><button type="button" class="btn primary" id="rg_go"' + (!info.step3 || !p.docs.length || (run && run.busy) || RGI.aiRun ? ' disabled' : '') + '>Import ' + n0(p.docs.length) + ' GRN</button><button type="button" class="btn" id="rg_xl">Excel of the check</button><button type="button" class="btn" id="rg_x"' + (run && run.busy ? ' disabled' : '') + '>Close</button></div>';
    Object.keys(keep).forEach(id => { const e = $(id); if (e) e.scrollTop = keep[id]; });
    regWire();
  }
  function regRunHtml() {
    const r = RGI.run, bar = (t, a, n) => '<div style="margin:6px 0"><div class="count">' + esc(t) + ' – ' + n0(a) + ' of ' + n0(n) + '</div><div style="height:8px;background:#EEF0F2;border-radius:6px;overflow:hidden"><div style="height:8px;width:' + (n ? Math.round(a / n * 100) : 100) + '%;background:var(--good)"></div></div></div>';
    return '<section class="note2" style="margin-top:14px"><b>' + (r.busy ? 'Importing … (keep this page open)' : r.stopped ? 'Stopped' : 'Imported') + '</b>' + bar('Suppliers', r.supDone, r.supOf) + bar('Items', r.itemDone, r.itemOf) + bar('GRNs', r.grnDone, r.grnOf) +
      '<div>' + n0(r.sup) + ' supplier(s) and ' + n0(r.items) + ' item(s) made · ' + n0(r.saved) + ' GRN saved' + (r.skipped ? ' · ' + n0(r.skipped) + ' already in the Store (left out)' : '') + (r.errors.length ? ' · <b style="color:var(--bad)">' + r.errors.length + ' GRN with a mistake (not saved)</b>' : '') + '</div>' +
      (r.stopped ? '<div class="errbox">' + esc(r.stopped) + ' – press Import again: what is saved already is left (never twice), the rest goes on.</div>' : '') +
      (r.errors.length ? '<div class="tw" style="max-height:220px;overflow:auto;margin-top:6px"><table><thead><tr><th>GRN No</th><th>Mistake</th></tr></thead><tbody>' + r.errors.slice(0, 300).map(z => '<tr><td>' + esc(z.ref) + '</td><td style="white-space:normal">' + esc(z.msg) + '</td></tr>').join('') + '</tbody></table></div>' : '') +
      (r.bad.length ? '<div class="count">Items not made: ' + esc(r.bad.slice(0, 10).map(z => z.name + ' (' + z.msg + ')').join('; ')) + '</div>' : '') + '</section>';
  }
  function regWire() {
    const b = RGI.box, again = () => { memPut(); regPlan(); regDraw(); };
    b.querySelectorAll('.rg-q').forEach(e => { e.oninput = () => { RGI.q[e.dataset.l] = e.value; clearTimeout(RGI.qt); RGI.qt = setTimeout(() => { regDraw(); const n = b.querySelector('.rg-q[data-l="' + e.dataset.l + '"]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250); }; });
    b.querySelectorAll('.rg-e').forEach(e => { e.onchange = () => { const line = e.closest('tr').dataset.line, x = RGI.ch.edit[line] = RGI.ch.edit[line] || {}; x[e.dataset.k] = e.value.trim(); again(); }; });
    b.querySelectorAll('.rg-dup').forEach(e => { e.onclick = () => { const line = e.closest('tr').dataset.line; if (e.dataset.v === '1') RGI.ch.gone[line] = true; else delete RGI.ch.gone[line]; again(); }; });
    if ($('rg_dupall')) $('rg_dupall').onclick = async () => { if (!await ask('Delete all ' + RGI.p.dups.length + ' duplicate rows?', '<p>Each row that is the same as an earlier row is left out of the import (the earlier one is imported).</p><p class="mr">सर्व duplicate ओळी वगळल्या जातील.</p>', [{ label: 'Cancel', value: false }, { label: 'Delete all', value: true, bad: true }])) return; RGI.p.dups.forEach(d => { RGI.ch.gone[d.line] = true; }); again(); };
    if ($('rg_dupnone')) $('rg_dupnone').onclick = () => { RGI.ch.gone = {}; again(); };
    b.querySelectorAll('.rg-ai').forEach(e => { e.onchange = () => { const f = RGI.ch.fix[e.dataset.l]; if (e.checked) f[e.dataset.f] = e.dataset.t; else delete f[e.dataset.f]; again(); }; });
    b.querySelectorAll('.rg-aiall').forEach(e => { e.onclick = () => { const l = e.dataset.l, f = RGI.ch.fix[l] = {}; if (e.dataset.v === '1') (RGI.ai[l] || []).forEach(z => { f[z[0]] = z[1]; }); again(); }; });
    if ($('rg_ai')) $('rg_ai').onclick = () => regAi();
    if ($('rg_aistop')) $('rg_aistop').onclick = () => { RGI.aiStop = true; };
    $('rg_go').onclick = () => regImport();
    $('rg_xl').onclick = e => busy(e.target, regExcel);
    $('rg_x').onclick = () => { b.hidden = true; };
  }

  /* the AI: the names of the file in parts (sorted – the same name written differently is mostly near), 4 parts at a time; each part
   * with the names already saved near it. A part done is kept: "Go on" asks only the rest. */
  async function regAi() {
    if (RGI.ai && RGI.ai.parts && !RGI.ai.left) RGI.ai = null;      // all asked before: asked again from the start
    const names = G2().namesOf(RGI.rows), info = RGI.info, ai = RGI.ai = (RGI.ai && RGI.ai.parts) ? RGI.ai : { party: [], item: [], category: [], parts: 0, done: {} };
    const saved = { party: info.vendors || [], item: (info.items || []).map(i => i[1]), category: [...new Set((info.items || []).map(i => i[3]).filter(Boolean))] };
    const SIZE = { party: 250, item: 200, category: 400 }, jobs = [];
    Object.keys(AIL).forEach(l => {
      const list = Object.keys(names[l]).sort((a, b) => G2().keyOf(a).localeCompare(G2().keyOf(b))).map(n => [n, names[l][n]]);
      const sv = saved[l].map(n => [G2().keyOf(n), n]).sort((a, b) => a[0].localeCompare(b[0]));
      for (let i = 0; i < list.length; i += SIZE[l]) {
        const part = list.slice(i, i + SIZE[l]); if (part.length < 2) continue;
        const k1 = G2().keyOf(part[0][0]), k2 = G2().keyOf(part[part.length - 1][0]);
        jobs.push({ id: l + ':' + i, l: l, names: part, saved: sv.filter(z => z[0] >= k1 && z[0] <= k2).slice(0, 300).map(z => z[1]) });
      }
    });
    ai.parts = jobs.length; ai.err = '';
    const todo = jobs.filter(j => !ai.done[j.id]); ai.left = todo.length;
    RGI.aiStop = false; let n = 0, stop = '';
    const show = () => { RGI.aiRun = 'The AI is reading the names – part ' + (jobs.length - ai.left) + ' of ' + jobs.length; regDraw(); };
    show();
    const one = async j => {
      for (let t = 0; t < 2; t++) {
        try { const r = await W('regNames', { list: AIL[j.l][0], names: j.names, saved: j.saved }); const rows = {}; j.names.forEach(a => { rows[a[0]] = a[1]; });
          (r.fixes || []).forEach(z => { ai[j.l].push([z[0], z[1], rows[z[0]] || 0]); }); ai.done[j.id] = true; ai.left--; return; }
        catch (e) { if (t || /not accept its key|no credit|not set up/i.test(String(e.message))) throw e; await new Promise(r => setTimeout(r, 4000)); }
      }
    };
    const worker = async () => { while (todo.length && !RGI.aiStop && !stop) { const j = todo.shift(); try { await one(j); } catch (e) { stop = e.message; } n++; memPut(); show(); } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    RGI.aiRun = ''; ai.err = stop || (RGI.aiStop ? 'Stopped – press Go on for the rest' : '');
    memPut(); regDraw();
    if (!stop && !RGI.aiStop) toast('The AI found ' + Object.keys(AIL).reduce((a, l) => a + ai[l].length, 0) + ' name(s) written differently – tick what is the same.');
  }

  /* IMPORT: the suppliers (500 a part), the items (1,000 a part), then the GRNs (150 or 3,000 lines a part) – each part saved whole or
   * not at all; a stop (no internet, the server busy) is said, and Import again goes on (nothing is saved twice) */
  async function regImport() {
    const p = RGI.p, d0 = p.dups.filter(d => !d.gone).length;
    if (!p.docs.length) return toast('Nothing to import.');
    if (!await ask('Import ' + n0(p.docs.length) + ' GRN?', '<ul><li>' + n0(p.lines) + ' lines, ' + money(p.gross) + ' (' + dmy(p.from) + ' to ' + dmy(p.to) + ') – counted in the stock</li>' +
      '<li>' + n0(p.newSup.length) + ' new supplier(s) into the Vendor Master ("Material Supplier"), ' + n0(p.newItems.length) + ' new item(s) into the Item Master</li>' +
      '<li>GRN No as in the file; the next new GRN: ' + p.next + '</li>' + (d0 ? '<li>' + d0 + ' duplicate row(s) kept (imported as they are)</li>' : '') + (p.look.length ? '<li>' + p.look.length + ' row(s) to look at are left out</li>' : '') +
      (p.already.length ? '<li>' + n0(p.already.length) + ' GRN already in the Store – left out</li>' : '') + '</ul><p class="mr">हे सर्व Store मध्ये save होईल. मोठी फाईल असल्याने काही मिनिटे लागतील – page बंद करू नका.</p>',
      [{ label: 'Cancel', value: false }, { label: 'Import', value: true, primary: true }])) return;
    const r = RGI.run = { busy: true, supDone: 0, supOf: p.newSup.length, itemDone: 0, itemOf: p.newItems.length, grnDone: 0, grnOf: p.docs.length, sup: 0, items: 0, saved: 0, skipped: 0, errors: [], bad: [], stopped: '' };
    regDraw();
    try {
      for (let i = 0; i < p.newSup.length; i += 500) { const z = await W('regVendors', { names: p.newSup.slice(i, i + 500).map(x => x.name) }); r.sup += z.added; r.supDone = Math.min(p.newSup.length, i + 500); regDraw(); }
      for (let i = 0; i < p.newItems.length; i += 1000) { const z = await W('regItems', { items: p.newItems.slice(i, i + 1000).map(x => ({ name: x.name, unit: x.unit, category: x.category, gst: x.gst })) }); r.items += z.added.length; r.bad.push(...(z.bad || [])); r.itemDone = Math.min(p.newItems.length, i + 1000); regDraw(); }
      let part = [], lines = 0;
      const send = async () => {
        const z = await W('regGrns', { docs: part.map(d => ({ ref: d.ref, date: d.date, supplier: d.supplier, challan_no: d.challan_no, invoice_no: d.invoice_no, invoice_date: d.invoice_date, vehicle_no: d.vehicle_no,
          lines: d.lines.map(l => ({ line: l.line, item: l.item, qty: l.qty, unit: l.unit, rate: l.rate, taxable: l.taxable, gst: l.gst, gst_pct: l.gst_pct, tcs: l.tcs, remark: l.remark })) })) });
        r.saved += (z.saved || []).length; r.skipped += (z.skipped || []).length; r.errors.push(...(z.errors || [])); r.grnDone += part.length; part = []; lines = 0; regDraw();
      };
      for (const d of p.docs) { if (part.length && (part.length >= 150 || lines + d.lines.length > 3000)) await send(); part.push(d); lines += d.lines.length; }
      if (part.length) await send();
      memDrop();
      toast(n0(r.saved) + ' GRN imported' + (r.skipped ? ', ' + n0(r.skipped) + ' already there' : '') + (r.errors.length ? ', ' + r.errors.length + ' with a mistake' : '') + '.');
    } catch (e) { r.stopped = e.message || String(e); failed(e); }
    r.busy = false; B = null;
    try { RGI.info = await W('regInfo'); regPlan(); } catch (e) { /* the check stays as it was */ }
    regDraw();
    if ($('gr_from') && p.from) { $('gr_from').value = p.to.slice(0, 8) + '01'; $('gr_to').value = today(); }
    boot().then(grnLoad).catch(() => {});
  }

  // the check as an Excel file: the GRNs to import in the register's columns, the rows to look at, the duplicates, the notes, the
  // new suppliers and items, the AI's names
  async function regExcel() {
    const X = await K().xlsx(), p = RGI.p, wb = X.utils.book_new(), add = (name, aoa, w) => { const ws = X.utils.aoa_to_sheet(aoa); if (w) ws['!cols'] = w.map(x => ({ wch: x })); X.utils.book_append_sheet(wb, ws, name); };
    let sr = 0; const grn = [G2().HEAD.concat(['Excel line'])];
    p.docs.forEach(d => d.lines.forEach((l, i) => grn.push([++sr, d.ref, dmy(d.date), i ? '' : d.challan_no, i ? '' : d.invoice_no, i ? '' : dmy(d.invoice_date), i ? '' : d.vehicle_no, d.supplier, l.item, l.qty, G2().unitOf(l.unit).unit, l.rate === null ? '' : l.rate, l.taxable, l.gst, l.tcs === null ? '' : l.tcs, r2(l.taxable + l.gst + (l.tcs || 0)), l.remark, l.line])));
    add('GRNs to import', grn, [7, 9, 11, 12, 14, 11, 13, 30, 40, 10, 7, 10, 13, 12, 8, 13, 22, 9]);
    add('Rows to look at', [['Excel line', 'GRN No', 'GRN Date', 'Supplier', 'Material', 'Qty', 'Why']].concat(p.look.map(l => [l.line, l.ref, dmy(l.date), l.party, l.item, l.qty, l.why.join('; ')])), [9, 9, 11, 30, 40, 9, 50]);
    add('Duplicate rows', [['Excel line', 'Same as line', 'GRN No', 'GRN Date', 'Supplier', 'Material', 'Qty', 'Gross', 'Deleted']].concat(p.dups.map(d => [d.line, d.first, d.row.ref, dmy(d.row.date), d.row.party, d.row.item, d.row.qty, d.row.gross, d.gone ? 'Yes' : ''])), [9, 11, 9, 11, 30, 40, 9, 12, 8]);
    add('Notes', [['Excel line', 'GRN No', 'Note']].concat(p.notes.map(z => [z.line, z.ref, z.msg])), [9, 9, 90]);
    add('New suppliers', [['Supplier', 'Rows']].concat(p.newSup.map(s => [s.name, s.rows])), [45, 8]);
    add('New items', [['Item', 'Unit', 'Category', 'GST %', 'Rows']].concat(p.newItems.map(i => [i.name, i.unit, i.category, i.gst, i.rows])), [50, 8, 22, 7, 8]);
    if (RGI.ai) add('Names (AI)', [['List', 'In the file', 'Right spelling', 'Rows', 'Ticked']].concat(...Object.keys(AIL).map(l => (RGI.ai[l] || []).map(z => [AIL[l][1], z[0], z[1], z[2], RGI.ch.fix[l][z[0]] === z[1] ? 'Yes' : '']))), [11, 45, 45, 7, 7]);
    add('Already in the Store', [['GRN No', 'GRN Date', 'Supplier', 'Invoice No']].concat(p.already.map(d => [d.ref, dmy(d.date), d.supplier, d.invoice_no])), [9, 11, 40, 16]);
    X.writeFile(wb, 'Inward_register_check_' + today() + '.xlsx');
  }

  /* ====================== STOCK & REPORTS ====================== */
  const REPS = [['stock', 'Stock'], ['statement', 'Stock statement (day / month / period)'], ['ledger', 'Item ledger'], ['grn', 'GRN register'], ['issue', 'Issue register'], ['consumption', 'Consumption'], ['returnable', 'Returnable out'], ['req', 'Requirements'], ['po', 'Purchase orders']];
  const RP = { kind: 'stock', rep: null };
  async function repPage() {
    const el = $('pg_reports');
    el.innerHTML = '<section class="panel"><h2>Stock &amp; Reports</h2><div class="chips" id="rp_chips"></div><div class="bar" id="rp_bar"></div><div class="bar" style="margin-top:0"><button type="button" class="btn primary" id="rp_go">Show</button><button type="button" class="btn" id="rp_xl" disabled>Export to Excel</button><button type="button" class="btn" id="rp_pr" disabled>Print</button></div></section><section class="panel" id="rp_out" hidden></section>';
    $('rp_chips').onclick = e => { const c = e.target.closest('[data-k]'); if (!c) return; RP.kind = c.dataset.k; bar(); };
    $('rp_go').onclick = e => busy(e.target, show);
    $('rp_xl').onclick = () => busy($('rp_xl'), async () => toExcel(RP.rep, RP.rep.title.replace(/[^A-Za-z0-9]+/g, '_')));
    $('rp_pr').onclick = () => printHtml(RP.rep.title, head(RP.rep.title, RP.rep.sub) + repTable(RP.rep).replace(/<div class="tw">|<\/div>$/g, ''), RP.rep.cols.length > 8);
    await boot(); bar(); show().catch(failed);
  }
  function bar() {
    $('rp_chips').innerHTML = REPS.map(([k, t]) => '<button type="button" class="chip" data-k="' + k + '" aria-pressed="' + (RP.kind === k) + '">' + esc(t) + '</button>').join('');
    const k = RP.kind, dates = ['statement', 'ledger', 'grn', 'issue', 'consumption'].indexOf(k) > -1, cats = [...new Set((B.items || []).map(i => i.category))].sort();
    $('rp_bar').innerHTML = (k === 'stock' ? field('rp_date', 'As on', inp('rp_date', today(), ' type="date"')) + field('rp_cat', 'Category', sel('rp_cat', [['', 'All']].concat(cats), '')) + '<label class="sub2"><input type="checkbox" id="rp_below" style="width:auto;min-height:0"> Only below min stock</label><label class="sub2"><input type="checkbox" id="rp_all" style="width:auto;min-height:0"> Every item (also with no stock)</label>' : '') +
      (dates ? '<div class="field"><label>Dates</label><div class="chips" style="margin:0" id="rp_q"><button type="button" class="chip" data-q="day">Today</button><button type="button" class="chip" data-q="month">This month</button><button type="button" class="chip" data-q="last">Last month</button></div></div>' + field('rp_from', 'From', inp('rp_from', monthStart(), ' type="date"')) + field('rp_to', 'To', inp('rp_to', today(), ' type="date"')) : '') +
      (k === 'ledger' ? field('rp_item', 'Item *', inp('rp_item', '', ' list="dl_witems" placeholder="Type the item…"'), 'grow') : '') +
      (k === 'grn' ? field('rp_sup', 'Supplier', inp('rp_sup', '', ' list="dl_wsuppliers"')) : '') +
      (k === 'issue' || k === 'consumption' ? field('rp_tk', 'Issued to', sel('rp_tk', [['', 'All']].concat(B.kinds.to), '')) + field('rp_party', 'Party / sub-contractor', inp('rp_party', '', ' list="dl_wsubs"')) + field('rp_mach', 'Machinery', sel('rp_mach', [['', 'All']].concat((B.machinery || []).map(m => m.no)), '')) + field('rp_loc', 'Location has', inp('rp_loc', '')) + (k === 'issue' ? field('rp_item2', 'Item', inp('rp_item2', '', ' list="dl_witems"')) : '') : '') +
      (k === 'consumption' ? field('rp_by', 'By', sel('rp_by', [['party', 'Party / sub-contractor'], ['machinery', 'Machinery'], ['use_for', 'Use for'], ['location', 'Location'], ['item', 'Item']], 'party')) : '') +
      (k === 'returnable' ? field('rp_party', 'Party', inp('rp_party', '', ' list="dl_wsubs"')) : '') +
      (k === 'req' ? field('rp_st', 'State', sel('rp_st', [['', 'All'], ['To order', 'To order'], ['Pending', 'Pending'], ['Approved', 'Approved'], ['Rejected', 'Rejected'], ['Closed', 'Closed'], ['Cancelled', 'Cancelled']], 'To order')) : '') +
      (k === 'po' ? '<label class="sub2"><input type="checkbox" id="rp_pend" style="width:auto;min-height:0" checked> Only what is still to come</label>' + (buyer() ? '<label class="sub2"><input type="checkbox" id="rp_allsites" style="width:auto;min-height:0"> Every site</label>' : '') : '');
    const q = $('rp_q'); if (q) q.onclick = e => { const c = e.target.closest('[data-q]'); if (!c) return; const t = today(); let f = t, to = t;
      if (c.dataset.q === 'month') f = monthStart(); if (c.dataset.q === 'last') { const d = new Date(t.slice(0, 8) + '01T00:00:00Z'); d.setUTCDate(0); to = d.toISOString().slice(0, 10); f = to.slice(0, 8) + '01'; }
      $('rp_from').value = f; $('rp_to').value = to; };
  }
  async function show() {
    const k = RP.kind, x = { kind: k };
    if (k === 'stock') Object.assign(x, { date: val('rp_date'), cat: val('rp_cat'), below: $('rp_below').checked, all: $('rp_all').checked });
    if ($('rp_from')) Object.assign(x, { from: val('rp_from'), to: val('rp_to') });
    if (k === 'ledger') { x.code = codeOf(val('rp_item')); if (!x.code) throw new Error('Pick the item.'); }
    if (k === 'grn') x.supplier = val('rp_sup').trim();
    if (k === 'issue' || k === 'consumption') Object.assign(x, { toKind: val('rp_tk'), party: val('rp_party').trim(), machinery: val('rp_mach'), location: val('rp_loc').trim(), code: k === 'issue' ? codeOf(val('rp_item2')) : '', by: val('rp_by') });
    if (k === 'returnable') x.party = val('rp_party').trim();
    if (k === 'req') x.status = val('rp_st');
    if (k === 'po') { x.pending = $('rp_pend').checked; x.all = !!($('rp_allsites') && $('rp_allsites').checked); }
    const rep = RP.rep = await W('report', x);
    $('rp_out').hidden = false; $('rp_out').innerHTML = '<h2>' + esc(rep.title) + '</h2><p class="muted" style="margin:2px 0 10px">' + esc(rep.sub || '') + ' · ' + rep.rows.length + ' row(s)</p>' + repTable(rep);
    $('rp_xl').disabled = $('rp_pr').disabled = false;
  }

  /* ====================== OPENING STOCK & NUMBERS (the Store Admin) ====================== */
  async function setPage() {
    const el = $('pg_settings');
    el.innerHTML = '<section class="panel"><h2>Opening stock</h2><p class="muted" style="margin:0">The stock of each item when the Store starts here (as on a date) and its rate. Change a row and Save; 0 takes it out. Or import an Excel (Item, Qty, Rate, Date).</p>' +
      '<div class="bar">' + field('op_date', 'As on (for new rows)', inp('op_date', monthStart(), ' type="date"')) + field('op_q', 'Search', inp('op_q', '', ' placeholder="Item, code, category"'), 'grow') + '<button type="button" class="btn primary" id="op_save">Save the changed rows</button><button type="button" class="btn" id="op_imp">Import from Excel</button><button type="button" class="btn small" id="op_tpl">Import format</button><input type="file" id="op_file" accept=".xlsx,.xls,.csv" hidden></div><div id="op_list"></div></section>' +
      '<section class="panel"><h2>Numbers</h2><p class="muted" style="margin:0">Where the GRN and Outward numbers go on from (e.g. after the old register\'s last number). Only higher than the last one used.</p><div class="bar" id="nm_bar"></div></section>' +
      // (28-10-2026, his formats) the papers: the numbers' prefix (RCL/VTR → RCL/VTR/PO/2026/0128, RCL/VTR/PR/2026/0232), the heading's
      // e-mail, contact, CIN, web; what a new PO starts with – its Shipping Address, Site Contact, Terms And Conditions
      '<section class="panel"><h2>Papers – Purchase Order and Requirement</h2><p class="muted" style="margin:0">Printed on the PO and the Purchase Requisition Form of this site. The company\'s name, address, GST, PAN and logo come from the site\'s company (Portal).</p><div class="grid" id="pp_box" style="margin-top:10px"></div>' +
      '<div class="bar"><button type="button" class="btn primary" id="pp_save">Save the papers</button></div></section>';
    await boot();
    let rows = [], have = {};
    const draw = () => { const q = val('op_q').toLowerCase();
      $('op_list').innerHTML = '<div class="tw"><table class="lines"><thead><tr><th>Code</th><th>Item</th><th>Unit</th><th>Category</th><th>As on</th><th>Opening qty</th><th>Rate ₹</th></tr></thead><tbody>' +
        B.items.filter(i => !q || [i.code, i.name, i.category].join(' ').toLowerCase().indexOf(q) > -1).map(i => { const o = have[i.code] || {}; return '<tr data-c="' + esc(i.code) + '"><td>' + esc(i.code) + '</td><td>' + esc(i.name) + '</td><td>' + esc(i.unit) + '</td><td>' + esc(i.category) + '</td><td>' + (o.date ? dmy(o.date) : '') + '</td><td><input class="q op-q" inputmode="decimal" value="' + esc(o.qty === undefined ? '' : n2(o.qty).replace(/,/g, '')) + '"></td><td><input class="q op-r" inputmode="decimal" value="' + esc(o.rate === undefined ? '' : o.rate) + '"></td></tr>'; }).join('') + '</tbody></table></div>'; };
    const load = async () => { rows = (await W('openingList')).rows; have = {}; rows.forEach(r => { have[r.code] = r; }); draw(); };
    $('op_q').oninput = draw;
    $('op_save').onclick = e => busy(e.target, async () => {
      const ch = [...document.querySelectorAll('#op_list tr[data-c]')].map(tr => ({ code: tr.dataset.c, qty: tr.querySelector('.op-q').value.trim(), rate: tr.querySelector('.op-r').value.trim() })).filter(r => { const o = have[r.code]; return o ? (num(r.qty) !== Number(o.qty) || num(r.rate) !== Number(o.rate)) : r.qty !== ''; });
      if (!ch.length) return toast('Nothing changed.');
      const r = await W('openingSave', { date: val('op_date'), rows: ch.map(c => Object.assign(c, { date: have[c.code] ? have[c.code].date : val('op_date') })) });
      toast('Opening stock saved – ' + r.rows + ' item(s).'); B = null; await boot(); load();
    });
    $('op_tpl').onclick = async () => { const X = await K().xlsx(), ws = X.utils.aoa_to_sheet([['Item', 'Qty', 'Rate', 'Date']].concat(B.items.map(i => [i.name, '', '', '']))); const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'Opening stock'); X.writeFile(wb, 'Opening_stock_format.xlsx'); };
    $('op_imp').onclick = () => { $('op_file').value = ''; $('op_file').click(); };
    $('op_file').onchange = () => busy($('op_imp'), async () => {
      const X = await K().xlsx(), wb = X.read(await $('op_file').files[0].arrayBuffer(), { type: 'array', cellDates: true }), aoa = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
      const hi = aoa.findIndex(r => r.some(c => /item|material/i.test(String(c)))); if (hi < 0) throw new Error('The file has no "Item" heading – use the Import format.');
      const h = aoa[hi].map(c => String(c).trim().toLowerCase()), ci = re => h.findIndex(c => re.test(c)), C = { item: ci(/item|material/), qty: ci(/qty|quantity|stock/), rate: ci(/rate/), date: ci(/date/) };
      const out = [], bad = [];
      aoa.slice(hi + 1).forEach((r, n) => { const it = String(r[C.item] || '').trim(), q = String(C.qty < 0 ? '' : r[C.qty]).trim(); if (!it || q === '') return; const c = codeOf(it); if (!c) bad.push('line ' + (hi + n + 2) + ': ' + it); else out.push({ code: c, qty: q, rate: C.rate < 0 ? '' : String(r[C.rate]).trim(), date: C.date < 0 ? '' : String(r[C.date]).trim() }); });
      if (bad.length) throw new Error('Not in the Item Master (write them as there): ' + bad.slice(0, 8).join('; ') + (bad.length > 8 ? ' …' : '') + '. Nothing was imported.');
      if (!out.length) throw new Error('The file has no rows with an item and its quantity.');
      if (!await ask('Import the opening stock?', '<p>' + out.length + ' item(s) – their opening stock is set as in the file.</p>', [{ label: 'Cancel', value: false }, { label: 'Import', value: true, primary: true }])) return;
      const r = await W('openingSave', { date: val('op_date'), rows: out }); toast('Opening stock imported – ' + r.rows + ' item(s).'); B = null; await boot(); load();
    });
    const nums = async () => { const n = await W('numbers');
      $('nm_bar').innerHTML = field('nm_grn', 'Next GRN No (last used ' + n.used.GRN + ')', inp('nm_grn', n.next.GRN, ' inputmode="numeric"')) + field('nm_out', 'Next Outward No (last used ' + n.used.OUT + ')', inp('nm_out', n.next.OUT, ' inputmode="numeric"')) + '<button type="button" class="btn" id="nm_save">Save the numbers</button>';
      $('nm_save').onclick = e => busy(e.target, async () => { const r = await W('numbersSave', { GRN: val('nm_grn'), OUT: val('nm_out') }); toast('Next GRN ' + r.next.GRN + ', next Outward ' + r.next.OUT + '.'); nums(); }); };
    const papers = n => { const pp = n.papers || {}, ta = (id, v) => '<textarea id="' + id + '" rows="3">' + esc(v || '') + '</textarea>';
      $('pp_box').innerHTML = field('pp_prefix', 'Numbers start with', inp('pp_prefix', pp.prefix || '', ' maxlength="30" placeholder="' + esc(n.prefixNow || 'RCL/VTR') + '"')) + field('pp_email', 'Email ID', inp('pp_email', pp.email || '', ' maxlength="80"')) +
        field('pp_phone', 'Contact', inp('pp_phone', pp.phone || '', ' maxlength="60"')) + field('pp_cin', 'CIN No', inp('pp_cin', pp.cin || '', ' maxlength="30"')) + field('pp_web', 'Web', inp('pp_web', pp.web || '', ' maxlength="80"')) +
        field('pp_sc', 'Site Contact (a new PO)', inp('pp_sc', pp.site_contact || '', ' maxlength="120" placeholder="Name : mobile"')) + field('pp_ship', 'Shipping Address (a new PO)', ta('pp_ship', pp.ship_to), 'wide') +
        field('pp_terms', 'Terms And Conditions (a new PO – one a line)', ta('pp_terms', pp.terms), 'wide') +
        '<p class="muted wide" style="margin:0">PO No: <b>' + esc((pp.prefix || n.prefixNow || '') + '/PO/' + today().slice(0, 4) + '/0001') + '</b> · Indent No: <b>' + esc((pp.prefix || n.prefixNow || '') + '/PR/' + today().slice(0, 4) + '/0001') + '</b>' +
        (n.step5 ? '' : ' · <b>The PO\'s Credit Period, Site Contact, Shipping Address, Freight, Load / Unload and its approval need the Store\'s step 5 (sql/store_step5_po_format.sql) at this site.</b>') + '</p>';
      $('pp_save').onclick = e => busy(e.target, async () => { const r = await W('papersSave', { prefix: val('pp_prefix'), email: val('pp_email'), phone: val('pp_phone'), cin: val('pp_cin'), web: val('pp_web'), site_contact: val('pp_sc'), ship_to: val('pp_ship'), terms: val('pp_terms') });
        toast('The papers are saved.'); papers(r); }); };
    try { await load(); await nums(); papers(await W('numbers')); } catch (e) { failed(e); }
  }

  /* ====================== THE DASHBOARD'S WORK PART ====================== */
  async function dash() {
    try {
      const d = await W('dash'); await boot();
      const tile = (cls, l, n, s) => '<div class="tile ' + cls + '"><small>' + esc(l) + '</small><b>' + n + '</b><span>' + esc(s) + '</span></div>';
      $('db_work').hidden = false;
      $('db_work').innerHTML = tile('g', 'Stock value', money(d.stock.value).replace(/\.\d\d$/, ''), 'at the average basic rate') + tile(d.stock.below ? 'a' : 'm', 'Below min stock', d.stock.below, 'items to order') +
        (d.req ? tile('a', 'Waiting for my approval', d.req.mine, d.req.pending + ' requirement(s) pending') + tile('b', 'Approved – to order', d.req.approved, 'requirements') : '') + (d.po ? tile('m', 'POs open', d.po.open, 'material to come') : '') +
        (d.grn ? tile('g', 'GRN today', d.grn.today, money(d.grn.todayValue) + ' · month ' + d.grn.month) : '') + (d.issue ? tile('b', 'Issues today', d.issue.today, money(d.issue.todayValue) + ' · month ' + d.issue.month) : '');
      if (d.req) { B.waiting = d.req.mine; lists(); }
      const parts = [];
      if (d.grn) parts.push('<section class="panel"><h2>Recent GRN</h2><div class="tw" style="margin-top:10px"><table><thead><tr><th>GRN</th><th>Date</th><th>Supplier</th><th class="n">Gross</th></tr></thead><tbody>' + (d.grn.recent.map(g => '<tr><td>' + esc(refOf(g)) + '</td><td>' + dmy(g.date) + '</td><td>' + esc(g.supplier) + '</td><td class="n">' + money(g.gross) + '</td></tr>').join('') || '<tr><td colspan="4" class="empty">None this month.</td></tr>') + '</tbody></table></div></section>');
      if (d.issue) parts.push('<section class="panel"><h2>Recent issues</h2><div class="tw" style="margin-top:10px"><table><thead><tr><th>Outward</th><th>Date</th><th>To</th><th class="n">Amount</th></tr></thead><tbody>' + (d.issue.recent.map(i => '<tr><td>' + i.no + '</td><td>' + dmy(i.date) + '</td><td>' + esc(toWho(i)) + '</td><td class="n">' + money(i.amount) + '</td></tr>').join('') || '<tr><td colspan="4" class="empty">None this month.</td></tr>') + '</tbody></table></div></section>');
      $('db_work2').hidden = !parts.length; $('db_work2').innerHTML = parts.join('');
    } catch (e) { if (e && e.code === 'notinstalled') { $('db_work').hidden = false; $('db_work').innerHTML = '<div class="note2">' + esc(e.message) + '</div>'; } }
  }

  const OPEN = { req: reqPage, purchase: purPage, po: poPage, grn: grnPage, issue: issuePage, reports: repPage, settings: setPage };
  window.RSW = { open: page => { if (!OPEN[page]) return; B = null; OPEN[page]().catch(e => failed(e)); }, dash: () => { B = null; dash(); } };
})();
