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
  const dmy = d => d ? String(d).slice(0, 10).split('-').reverse().join('-') : '';
  const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const today = () => (B && B.today) || new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const monthStart = () => today().slice(0, 8) + '01';
  const keyOf = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pg = k => ((K().S.me || {}).pages || {})[k] || 'None', admin = () => !!(K().S.me && K().S.me.user.admin), buyer = () => pg('purchase') === 'Edit';
  const canEdit = k => pg(k) === 'Edit';
  const toast = (t, bad) => K().toast(t, bad), failed = e => K().failed(e), ask = (t, h, b) => K().ask(t, h, b);
  async function boot(force) { if (!B || force) { B = await W('boot'); lists(); } return B; }
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
  const tag = (t, cls) => '<span class="tag' + (cls ? ' ' + cls : '') + '">' + esc(t) + '</span>';
  const stateTag = s => tag(s, /^(Approved|Received|Open)$/.test(s) ? '' : /Pending|Part/.test(s) ? 'warn' : /Rejected|Cancelled/.test(s) ? 'bad' : 'off');
  const field = (id, lbl, html, cls) => '<div class="field' + (cls ? ' ' + cls : '') + '"><label for="' + id + '">' + esc(lbl) + '</label>' + html + '</div>';
  const inp = (id, v, more) => '<input id="' + id + '" value="' + esc(v === undefined || v === null ? '' : v) + '"' + (more || '') + '>';
  const sel = (id, opts, v, more) => '<select id="' + id + '"' + (more || '') + '>' + opts.map(o => { const val = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(val) + '"' + (String(val) === String(v === undefined || v === null ? '' : v) ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select>';
  const val = id => { const e = $(id); return e ? e.value : ''; };
  const busy = async (btn, f) => { if (btn.disabled) return; btn.disabled = true; try { await f(); } catch (e) { failed(e); } finally { btn.disabled = false; } };

  /* ---------- the LINES of a paper: a row each, an empty row always there to type into ----------
   * cols: [{ k, h, type: 'item' | 'num' | 'text' | 'check' | 'ro', w, calc(row) }] */
  function Lines(box, cols, rows, opt) {
    opt = opt || {};
    { const nb = box.cloneNode(false); box.replaceWith(nb); box = nb; }      // (drawn again – e.g. another PO picked: the listeners of before go with the old box)
    const L = { rows: (rows || []).map(r => Object.assign({}, r)) };
    const blank = () => { const o = {}; cols.forEach(c => { o[c.k] = c.type === 'check' ? false : ''; }); return o; };
    L.draw = () => {
      if (!opt.fixed && !L.rows.some(r => !r.item && !r.code)) L.rows.push(blank());
      box.innerHTML = '<div class="tw"><table class="lines"><thead><tr><th>#</th>' + cols.map(c => '<th' + (c.type === 'num' || c.type === 'ro' && c.n ? ' class="n"' : '') + '>' + esc(c.h) + '</th>').join('') + (opt.fixed ? '' : '<th></th>') + '</tr></thead><tbody>' +
        L.rows.map((r, i) => '<tr data-i="' + i + '"><td>' + (i + 1) + '</td>' + cols.map(c => {
          const v = r[c.k];
          if (c.type === 'ro' || (c.type === 'item' && r.fixedItem)) return '<td class="' + (c.n ? 'n' : '') + '">' + (c.calc ? c.calc(r) : esc(c.type === 'item' ? (r.code ? label(itemOf(r.code) || { code: r.code, name: r.name, unit: r.unit }) : '') : v)) + '</td>';
          if (c.type === 'check') return '<td style="text-align:center"><input type="checkbox" data-k="' + c.k + '"' + (v ? ' checked' : '') + ' style="width:auto;min-height:0"></td>';
          return '<td><input data-k="' + c.k + '" class="' + (c.type === 'item' ? 'it' : c.type === 'num' ? 'q' : 's') + '"' + (c.type === 'item' ? ' list="dl_witems" placeholder="Type the item…"' : c.type === 'num' ? ' inputmode="decimal"' : '') + ' value="' + esc(c.type === 'item' ? (r.item || (r.code ? label(itemOf(r.code) || { code: r.code, name: r.name, unit: r.unit }) : '')) : v === undefined || v === null ? '' : v) + '"' + (c.w ? ' style="width:' + c.w + 'px"' : '') + '></td>';
        }).join('') + (opt.fixed ? '' : '<td class="x">' + (r.item || r.code ? '<button type="button" class="link del" data-x="' + i + '" title="Take this line out">✕</button>' : '') + '</td>') + '</tr>').join('') +
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
    L.draw();
    return L;
  }
  const num = v => { const n = Number(String(v === undefined || v === null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0; };
  // a paper's money: taxable = qty × rate, GST on it, the total
  const lineMoney = r => { const t = r2(num(r.qty) * num(r.rate)), g = r2(t * num(r.gst_pct) / 100); return { t: t, g: g, all: r2(t + g) }; };

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
    try { await boot(); const r = await W('reqList'); RQ.list = r.reqs; RQ.levels = r.levels;
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
        '<td style="white-space:normal">' + x.lines.map(l => esc(l.name + ' ' + n2(l.qty) + ' ' + l.unit) + (x.status === 'Approved' && l.left < l.qty ? ' <small>(ordered ' + n2(l.ordered) + ')</small>' : '')).join('<br>') + '</td>' +
        '<td>' + stateTag(x.status) + (x.status === 'Pending' ? '<small>Level ' + x.level + (x.waitFor.length ? ' – ' + esc(x.waitFor.join(', ')) : '') + '</small>' : '') + '</td><td><small>' + esc(x.created_name || x.created_by || '') + '</small></td>' +
        '<td><div class="acts">' + (x.mayApprove ? '<button type="button" class="btn small primary rq-ok">Approve</button><button type="button" class="btn small bad rq-no">Reject</button>' : '') +
        '<button type="button" class="link rq-det">Details</button>' + ((x.mine || admin()) && x.status === 'Pending' && !(x.approvals || []).length && canEdit('req') ? '<button type="button" class="link rq-edit">Change</button>' : '') +
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
      d.innerHTML = '<td colspan="9"><b>Requirement ' + x.no + '</b>' + (x.remark ? ' – ' + esc(x.remark) : '') + '<table style="margin-top:6px"><thead><tr><th>Item</th><th class="n">Asked</th><th class="n">Ordered</th><th class="n">To order</th><th class="n">Stock now</th><th>Note</th></tr></thead><tbody>' +
        x.lines.map(l => '<tr><td>' + esc(l.name) + '</td><td class="n">' + n2(l.qty) + ' ' + esc(l.unit) + '</td><td class="n">' + n2(l.ordered || 0) + '</td><td class="n">' + n2(l.left || 0) + '</td><td class="n">' + n2(stockOf(l.code)) + '</td><td>' + esc(l.note || '') + '</td></tr>').join('') + '</tbody></table>' +
        ((x.approvals || []).length ? '<p class="sub2" style="margin:6px 0 0">' + x.approvals.map(a => 'Level ' + a.level + ': ' + (a.ok ? 'approved' : 'rejected') + ' by ' + esc(a.name) + ' on ' + dmy(a.at) + (a.note ? ' – "' + esc(a.note) + '"' : '')).join('<br>') + '</p>' : '') + (x.close_note ? '<p class="sub2">' + esc(x.close_note) + '</p>' : '') + '</td>';
      tr.after(d); return;
    }
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
      field('rq_date', 'Date *', inp('rq_date', x ? x.date : today(), ' type="date"')) + field('rq_need', 'Needed by', inp('rq_need', x ? x.need_by : '', ' type="date"')) +
      field('rq_kind', 'For *', sel('rq_kind', B.kinds.for, x ? x.for_kind : 'Site work')) + '<div class="field wide" id="rq_whichw"></div>' + field('rq_rem', 'Remark', inp('rq_rem', x ? x.remark : '', ' maxlength="300"'), 'wide') + '</div><div id="rq_lines"></div>' +
      '<div class="bar"><button type="button" class="btn primary" id="rq_save">Save requirement</button><button type="button" class="btn" id="rq_x">Cancel</button></div>';
    const which = () => { const k = val('rq_kind'), cur = x ? x.for_text : '';
      $('rq_whichw').innerHTML = k === 'Machinery' ? '<label for="rq_for">Machinery *</label>' + sel('rq_for', [['', 'Pick…']].concat((B.machinery || []).map(m => [m.no, m.no + (m.name ? ' – ' + m.name : '')])), cur) : '<label for="rq_for">' + (k === 'Site work' ? 'Location / work (e.g. Ch 540+450 toe wall)' : 'Which') + '</label>' + inp('rq_for', cur, ' maxlength="120"'); };
    which(); $('rq_kind').onchange = which;
    const L = Lines($('rq_lines'), [{ k: 'item', h: 'Item *', type: 'item' }, { k: 'qty', h: 'Qty *', type: 'num' }, { k: 'unit', h: 'Unit', type: 'ro', calc: r => esc((itemOf(r.code) || {}).unit || '') }, { k: 'stock', h: 'Stock now', type: 'ro', n: true, calc: r => r.code ? n2(stockOf(r.code)) : '' }, { k: 'note', h: 'Note', type: 'text' }],
      x ? x.lines.map(l => ({ code: l.code, qty: l.qty, note: l.note || '' })) : []);
    $('rq_x').onclick = () => { f.hidden = true; };
    $('rq_save').onclick = e => busy(e.target, async () => {
      const lines = L.get(); if (lines.some(l => !l.code)) throw new Error('Line ' + (L.rows.indexOf(lines.find(l => !l.code)) + 1) + ': pick the item from the list (as it is in the Item Master).');
      const r = await W('reqSave', { no: x ? x.no : undefined, req: { date: val('rq_date'), need_by: val('rq_need'), for_kind: val('rq_kind'), for_text: val('rq_for'), remark: val('rq_rem'), lines: lines.map(l => ({ code: l.code, qty: l.qty, note: l.note })) } });
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
          s.reqs.map(r => r.lines.filter(l => l.left > 0).map(l => '<tr><td><input type="checkbox" class="pu-tick" data-site="' + esc(s.site) + '" data-req="' + r.no + '" data-line="' + l.line + '" style="width:auto;min-height:0"></td><td>' + r.no + '</td><td>' + dmy(r.date) + '</td><td>' + dmy(r.need_by) + '</td><td style="white-space:normal">' + esc(r.for_kind + (r.for_text ? ' – ' + r.for_text : '')) + '</td><td>' + esc(l.name) + '</td><td class="n">' + n2(l.qty) + ' ' + esc(l.unit) + '</td><td class="n">' + n2(l.ordered) + '</td><td class="n"><b>' + n2(l.left) + '</b></td></tr>').join('')).join('') + '</tbody></table></div>'
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
    const rows = po ? po.lines.map(l => Object.assign({ fixedItem: !!l.req_no }, l)) : ticked.map(t => { const r = st.reqs.find(q => q.no === Number(t.dataset.req)), l = r.lines.find(z => z.line === Number(t.dataset.line)); const i = it.items.find(z => z.code === l.code) || {};
      return { code: l.code, name: l.name, unit: l.unit, qty: l.left, rate: '', gst_pct: i.gst_pct === null || i.gst_pct === undefined ? '' : i.gst_pct, req_no: r.no, req_line: l.line, fixedItem: true }; });
    f.innerHTML = '<h2>' + (po ? 'Change PO ' + po.no : 'New purchase order') + ' – ' + esc(site) + '</h2><div class="grid" style="margin-top:10px">' +
      field('pu_date', 'PO date *', inp('pu_date', po ? po.date : today(), ' type="date"')) + field('pu_ven', 'Vendor (supplier) *', inp('pu_ven', po ? po.vendor : '', ' list="dl_wvendors" maxlength="80" autocomplete="off"'), 'wide') +
      field('pu_gst', 'Vendor GST no.', inp('pu_gst', po ? po.vendor_gst : '', ' maxlength="15"')) + field('pu_del', 'Delivery by', inp('pu_del', po ? po.deliver_by : '', ' type="date"')) +
      field('pu_terms', 'Terms (payment, delivery, …)', inp('pu_terms', po ? po.terms : '', ' maxlength="500"'), 'wide') + field('pu_rem', 'Remark', inp('pu_rem', po ? po.remark : '', ' maxlength="300"'), 'wide') + '</div><div id="pu_lines"></div>' +
      '<div class="bar"><button type="button" class="btn primary" id="pu_save">Save PO</button><button type="button" class="btn" id="pu_x">Cancel</button></div>';
    $('pu_ven').onchange = () => { const g = (it.gst || {})[val('pu_ven').trim()]; if (g && !val('pu_gst')) $('pu_gst').value = g; };
    const tot = rs => { const s = rs.filter(r => r.code).map(lineMoney).reduce((a, m) => ({ t: a.t + m.t, g: a.g + m.g, all: a.all + m.all }), { t: 0, g: 0, all: 0 }); return '<td colspan="6">Total</td><td class="n">' + money(s.t) + '</td><td class="n">' + money(s.g) + '</td><td class="n">' + money(s.all) + '</td><td></td>'; };
    const L = Lines($('pu_lines'), [{ k: 'item', h: 'Item *', type: 'item' }, { k: 'req', h: 'Req', type: 'ro', calc: r => r.req_no ? 'REQ ' + r.req_no : '' }, { k: 'qty', h: 'Qty *', type: 'num' }, { k: 'unit', h: 'Unit', type: 'ro', calc: r => esc(r.unit || (itemOf(r.code) || {}).unit || '') },
      { k: 'rate', h: 'Rate ₹ *', type: 'num' }, { k: 'gst_pct', h: 'GST %', type: 'num' }, { k: 'tx', h: 'Taxable', type: 'ro', n: true, calc: r => r.code ? money(lineMoney(r).t) : '' }, { k: 'gx', h: 'GST', type: 'ro', n: true, calc: r => r.code ? money(lineMoney(r).g) : '' }, { k: 'ax', h: 'Total', type: 'ro', n: true, calc: r => r.code ? money(lineMoney(r).all) : '' }],
      rows, { total: tot, picked: (r, i) => { if (r.gst_pct === '' && i.gst_pct !== null && i.gst_pct !== undefined) r.gst_pct = i.gst_pct; } });
    const done = () => { f.hidden = true; B = keepB; lists(); };
    $('pu_x').onclick = done;
    $('pu_save').onclick = e => busy(e.target, async () => {
      const lines = L.get(); if (lines.some(l => !l.code)) throw new Error('Pick each item from the list (as it is in the Item Master of ' + site + ').');
      const x = { site: site, no: po ? po.no : undefined, po: { date: val('pu_date'), vendor: val('pu_ven'), vendor_gst: val('pu_gst'), deliver_by: val('pu_del'), terms: val('pu_terms'), remark: val('pu_rem'),
        lines: lines.map(l => ({ code: l.code, qty: l.qty, rate: l.rate, gst_pct: l.gst_pct, req_no: l.req_no || undefined, req_line: l.req_line || undefined })) } };
      const r = await saveAsk('poSave', x); if (!r) return;
      toast('PO ' + r.no + ' of ' + r.site + ' saved – ' + money(r.total) + '.'); done(); purLoad();
    });
  }
  const poTable = (pos, sites) => '<div class="tw"><table><thead><tr>' + (sites ? '<th>Site</th>' : '') + '<th>PO</th><th>Date</th><th>Vendor</th><th>Items</th><th class="n">Total</th><th>State</th><th></th></tr></thead><tbody>' +
    (pos.map(p => '<tr data-po="' + p.no + '" data-site="' + esc(p.site || '') + '">' + (sites ? '<td>' + esc(p.site) + '</td>' : '') + '<td><b>' + p.no + '</b></td><td>' + dmy(p.date) + '</td><td>' + esc(p.vendor) + '</td><td style="white-space:normal">' +
      p.lines.map(l => esc(l.name + ' ' + n2(l.qty) + ' ' + l.unit) + (l.received ? ' <small>(came ' + n2(l.received) + ')</small>' : '')).join('<br>') + '</td><td class="n">' + money(p.total) + '</td><td>' + stateTag(p.state) + '</td><td><div class="acts"><button type="button" class="link po-print">Print</button>' +
      (buyer() && p.status === 'Open' && sites ? '<button type="button" class="link po-edit">Change</button>' : '') + (buyer() && p.status === 'Open' && !p.lines.some(l => l.received > 0) ? '<button type="button" class="link del po-cancel">Cancel</button>' : '') +
      ((buyer() || admin()) && p.status === 'Open' && p.state !== 'Received' ? '<button type="button" class="link po-close">Close</button>' : '') + '</div></td></tr>').join('') || '<tr><td colspan="8" class="empty">No purchase order.</td></tr>') + '</tbody></table></div>';
  async function poClick(e, list, reload) {
    const b = e.target.closest('button'), tr = e.target.closest('tr[data-po]'); if (!b || !tr) return;
    const p = list.find(z => z.no === Number(tr.dataset.po) && (z.site || '') === tr.dataset.site); if (!p) return;
    const site = p.site || undefined;
    if (b.classList.contains('po-print')) return busy(b, async () => { const r = await W('poGet', { site: site, no: p.no }); poPrint(r.po, r.heading); });
    if (b.classList.contains('po-edit')) return purForm(p.site, p);
    if (b.classList.contains('po-cancel')) { if (!await ask('Cancel PO ' + p.no + '?', '<p>Nothing of it has come – it is cancelled.</p>', [{ label: 'No', value: false }, { label: 'Cancel the PO', value: true, bad: true }])) return; return busy(b, async () => { await W('poCancel', { site: site, no: p.no }); toast('PO ' + p.no + ' cancelled.'); reload(); }); }
    if (b.classList.contains('po-close')) { if (!await ask('Close PO ' + p.no + '?', '<p>The rest of it will not come.</p>', [{ label: 'No', value: false }, { label: 'Close', value: true, primary: true }])) return; return busy(b, async () => { await W('poClose', { site: site, no: p.no }); toast('PO ' + p.no + ' closed.'); reload(); }); }
  }
  function poPrint(p, h) {
    h = h || {};
    printHtml('PO ' + p.no, '<div class="hd"><div><h1>' + esc(h.company || 'Purchase Order') + '</h1><div class="muted">' + esc(h.address || '') + (h.gstin ? '<br>GSTIN ' + esc(h.gstin) : '') + '</div></div><div style="text-align:right"><h1>PURCHASE ORDER</h1>PO No <b>' + p.no + '</b> · ' + dmy(p.date) + '<br>Site: ' + esc(h.site || p.site || '') + '</div></div>' +
      '<p><b>To:</b> ' + esc(p.vendor) + (p.vendor_gst ? ' · GSTIN ' + esc(p.vendor_gst) : '') + (p.deliver_by ? '<br><b>Delivery by:</b> ' + dmy(p.deliver_by) : '') + '</p>' +
      '<table><thead><tr><th>#</th><th>Item</th><th class="n">Qty</th><th>Unit</th><th class="n">Rate ₹</th><th class="n">Taxable ₹</th><th class="n">GST %</th><th class="n">GST ₹</th><th class="n">Total ₹</th></tr></thead><tbody>' +
      p.lines.map((l, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(l.name) + '</td><td class="n">' + n2(l.qty) + '</td><td>' + esc(l.unit) + '</td><td class="n">' + n2(l.rate) + '</td><td class="n">' + n2(l.taxable) + '</td><td class="n">' + n2(l.gst_pct) + '</td><td class="n">' + n2(l.gst) + '</td><td class="n">' + n2(l.total) + '</td></tr>').join('') +
      '<tr><td colspan="5"><b>Total</b></td><td class="n"><b>' + n2(p.taxable) + '</b></td><td></td><td class="n"><b>' + n2(p.gst) + '</b></td><td class="n"><b>' + n2(p.total) + '</b></td></tr></tbody></table>' +
      (p.terms ? '<p><b>Terms:</b> ' + esc(p.terms) + '</p>' : '') + (p.remark ? '<p>' + esc(p.remark) + '</p>' : '') + '<div class="sign"><div>Prepared by: ' + esc(p.created_name || '') + '</div><div>Authorised signatory</div></div>');
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
    el.innerHTML = '<section class="panel"><h2>Inward (GRN)</h2><p class="muted" style="margin:0">Material received: against a purchase order or direct (a bill). Its basic rate makes the item\'s average rate.</p>' +
      '<div class="bar">' + field('gr_from', 'From', inp('gr_from', monthStart(), ' type="date"')) + field('gr_to', 'To', inp('gr_to', today(), ' type="date"')) + '<button type="button" class="btn" id="gr_show">Show</button>' +
      (canEdit('grn') ? '<button type="button" class="btn primary" id="gr_new">+ New GRN</button>' : '') + '<button type="button" class="btn" id="gr_xl">GRN register (Excel)</button>' +
      (admin() ? '<button type="button" class="btn" id="gr_imp">Import from Excel</button><button type="button" class="btn small" id="gr_tpl">Import format</button><input type="file" id="gr_file" accept=".xlsx,.xls,.csv" hidden>' : '') + '</div></section>' +
      '<section class="panel formbox" id="gr_form" hidden></section><section class="panel formbox" id="gr_impbox" hidden></section><section class="panel" id="gr_list"></section>';
    $('gr_show').onclick = () => grnLoad();
    if ($('gr_new')) $('gr_new').onclick = () => grnForm(null);
    $('gr_xl').onclick = () => busy($('gr_xl'), async () => toExcel(await W('report', { kind: 'grn', from: val('gr_from'), to: val('gr_to') }), 'GRN_register'));
    if ($('gr_imp')) { $('gr_imp').onclick = () => { $('gr_file').value = ''; $('gr_file').click(); }; $('gr_file').onchange = () => importFile('grn', $('gr_file').files[0], $('gr_impbox'), grnLoad); $('gr_tpl').onclick = () => importTemplate('grn'); }
    $('gr_list').onclick = e => grnClick(e);
    await boot(); await grnLoad();
  }
  async function grnLoad() {
    try { const r = await W('grnList', { from: val('gr_from'), to: val('gr_to') }); GR.list = r.grns;
      $('gr_list').innerHTML = '<div class="tw"><table><thead><tr><th>GRN</th><th>Date</th><th>Supplier</th><th>Invoice</th><th>Vehicle</th><th>PO</th><th>Items</th><th class="n">Gross</th><th></th></tr></thead><tbody>' +
        (GR.list.map(g => '<tr data-no="' + g.no + '"><td><b>' + g.no + '</b></td><td>' + dmy(g.date) + '</td><td>' + esc(g.supplier) + '</td><td>' + esc([g.invoice_no, dmy(g.invoice_date)].filter(Boolean).join(' · ')) + (g.challan_no ? '<small>Challan ' + esc(g.challan_no) + '</small>' : '') + '</td><td>' + esc(g.vehicle_no || '') + '</td><td>' + (g.po_no || '') + '</td>' +
          '<td style="white-space:normal">' + g.lines.map(l => esc(l.name + ' ' + n2(l.qty) + ' ' + l.unit + ' @ ' + n2(l.rate))).join('<br>') + '</td><td class="n">' + money(g.gross) + '</td><td><div class="acts"><button type="button" class="link gr-print">Print</button>' +
          (admin() ? '<button type="button" class="link gr-edit">Change</button><button type="button" class="link del gr-del">Delete</button>' : '') + '</div></td></tr>').join('') || '<tr><td colspan="9" class="empty">No GRN in these dates.</td></tr>') + '</tbody></table></div>' +
        '<p class="count">' + GR.list.length + ' GRN(s) · ' + money(GR.list.reduce((a, g) => a + Number(g.gross || 0), 0)) + '</p>'; }
    catch (e) { failed(e); }
  }
  async function grnClick(e) {
    const b = e.target.closest('button'), tr = e.target.closest('tr[data-no]'); if (!b || !tr) return; const g = GR.list.find(x => x.no === Number(tr.dataset.no)); if (!g) return;
    if (b.classList.contains('gr-print')) return printHtml('GRN ' + g.no, head('Goods Received Note – GRN ' + g.no, dmy(g.date)) + '<p><b>Supplier:</b> ' + esc(g.supplier) + (g.invoice_no ? ' · Invoice ' + esc(g.invoice_no) + ' ' + dmy(g.invoice_date) : '') + (g.challan_no ? ' · Challan ' + esc(g.challan_no) : '') + (g.vehicle_no ? ' · Vehicle ' + esc(g.vehicle_no) : '') + (g.po_no ? ' · PO ' + g.po_no : '') + '</p>' +
      '<table><thead><tr><th>#</th><th>Material</th><th class="n">Received Qty</th><th>UOM</th><th class="n">Basic Rate</th><th class="n">Taxable</th><th class="n">GST %</th><th class="n">GST</th><th class="n">Gross</th></tr></thead><tbody>' + g.lines.map((l, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(l.name) + '</td><td class="n">' + n2(l.qty) + '</td><td>' + esc(l.unit) + '</td><td class="n">' + n2(l.rate) + '</td><td class="n">' + n2(l.taxable) + '</td><td class="n">' + n2(l.gst_pct) + '</td><td class="n">' + n2(l.gst) + '</td><td class="n">' + n2(l.gross) + '</td></tr>').join('') +
      (Number(g.tcs) ? '<tr><td colspan="8">TCS</td><td class="n">' + n2(g.tcs) + '</td></tr>' : '') + '<tr><td colspan="8"><b>Gross</b></td><td class="n"><b>' + n2(g.gross) + '</b></td></tr></tbody></table>' + (g.remark ? '<p>' + esc(g.remark) + '</p>' : '') + '<div class="sign"><div>Received by: ' + esc(g.created_name || '') + '</div><div>Store in-charge</div></div>');
    if (b.classList.contains('gr-edit')) return grnForm(g);
    if (b.classList.contains('gr-del')) { if (!await ask('Delete GRN ' + g.no + '?', '<p>Its material goes out of the stock (refused if it was issued already).</p><p class="mr">हा GRN डिलीट होईल.</p>', [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, bad: true }])) return; return busy(b, async () => { await W('grnDelete', { no: g.no }); toast('GRN ' + g.no + ' deleted.'); B = null; await boot(); grnLoad(); }); }
  }
  async function grnForm(g) {
    const f = $('gr_form'); f.hidden = false; f.innerHTML = '<p class="muted">Loading…</p>';
    try { await boot(); } catch (e) { failed(e); f.hidden = true; return; }      // (pressed before the page had its lists)
    let pos = []; try { pos = (await W('poOpen')).pos; } catch (e) { pos = []; }
    if (g && g.po_no && !pos.some(p => p.no === Number(g.po_no))) pos.push({ no: Number(g.po_no), vendor: g.supplier, lines: [] });
    f.innerHTML = '<h2>' + (g ? 'Change GRN ' + g.no : 'New GRN') + '</h2><div class="grid" style="margin-top:10px">' +
      field('gr_po', 'Against PO', sel('gr_po', [['', 'Direct (no PO)']].concat(pos.map(p => [p.no, 'PO ' + p.no + ' – ' + p.vendor + (p.lines.length ? ' (' + p.lines.filter(l => l.left > 0).map(l => l.name + ' ' + n2(l.left)).join(', ') + ')' : '')])), g ? g.po_no || '' : ''), 'wide') +
      field('gr_date', 'GRN date *', inp('gr_date', g ? g.date : today(), ' type="date"')) + field('gr_sup', 'Supplier *', inp('gr_sup', g ? g.supplier : '', ' list="dl_wsuppliers" maxlength="80" autocomplete="off"'), 'wide') +
      field('gr_ch', 'Challan No', inp('gr_ch', g ? g.challan_no : '', ' maxlength="40"')) + field('gr_inv', 'Invoice No', inp('gr_inv', g ? g.invoice_no : '', ' maxlength="40"')) + field('gr_invd', 'Invoice date', inp('gr_invd', g ? g.invoice_date : '', ' type="date"')) +
      field('gr_veh', 'Vehicle No', inp('gr_veh', g ? g.vehicle_no : '', ' maxlength="20"')) + field('gr_tcs', 'TCS ₹', inp('gr_tcs', g ? g.tcs : '', ' inputmode="decimal"')) + field('gr_rem', 'Remark', inp('gr_rem', g ? g.remark : '', ' maxlength="300"'), 'wide') + '</div><div id="gr_lines"></div>' +
      '<div class="bar"><button type="button" class="btn primary" id="gr_save">Save GRN</button><button type="button" class="btn" id="gr_x">Cancel</button></div>';
    const tot = rs => { const s = rs.filter(r => r.code).map(lineMoney).reduce((a, m) => ({ t: a.t + m.t, g: a.g + m.g, all: a.all + m.all }), { t: 0, g: 0, all: 0 }); return '<td colspan="5">Total' + (num(val('gr_tcs')) ? ' (+ TCS ' + money(num(val('gr_tcs'))) + ')' : '') + '</td><td class="n">' + money(s.t) + '</td><td class="n">' + money(s.g) + '</td><td class="n">' + money(s.all + num(val('gr_tcs'))) + '</td><td></td>'; };
    const cols = [{ k: 'item', h: 'Item *', type: 'item' }, { k: 'qty', h: 'Received Qty *', type: 'num' }, { k: 'unit', h: 'Unit', type: 'ro', calc: r => esc(r.unit || (itemOf(r.code) || {}).unit || '') }, { k: 'rate', h: 'Basic Rate ₹', type: 'num' }, { k: 'gst_pct', h: 'GST %', type: 'num' },
      { k: 'tx', h: 'Taxable', type: 'ro', n: true, calc: r => r.code ? money(lineMoney(r).t) : '' }, { k: 'gx', h: 'GST', type: 'ro', n: true, calc: r => r.code ? money(lineMoney(r).g) : '' }, { k: 'ax', h: 'Gross', type: 'ro', n: true, calc: r => r.code ? money(lineMoney(r).all) : '' }];
    const picked = (r, i) => { if (r.gst_pct === '' && i.gst_pct !== null && i.gst_pct !== undefined) r.gst_pct = i.gst_pct; };
    let L = null;
    const fromPo = () => {
      const p = pos.find(z => z.no === Number(val('gr_po')));
      const rows = g && Number(g.po_no || 0) === Number(val('gr_po') || 0) ? g.lines.map(l => ({ code: l.code, name: l.name, unit: l.unit, qty: l.qty, rate: l.rate, gst_pct: l.gst_pct, po_line: l.po_line, fixedItem: !!l.po_line }))
        : p ? p.lines.filter(l => l.left > 0).map(l => ({ code: l.code, name: l.name, unit: l.unit, qty: l.left, rate: l.rate, gst_pct: l.gst_pct, po_line: l.line, fixedItem: true })) : [];
      if (p && !g && !val('gr_sup')) $('gr_sup').value = p.vendor;
      L = Lines($('gr_lines'), cols, rows, { total: tot, picked: picked });
    };
    fromPo(); $('gr_po').onchange = fromPo; $('gr_tcs').oninput = () => L.draw();
    $('gr_x').onclick = () => { f.hidden = true; };
    $('gr_save').onclick = e => busy(e.target, async () => {
      const lines = L.get(); if (lines.some(l => !l.code)) throw new Error('Pick each item from the list (as it is in the Item Master).');
      const x = { no: g ? g.no : undefined, grn: { po_no: val('gr_po') || undefined, date: val('gr_date'), supplier: val('gr_sup'), challan_no: val('gr_ch'), invoice_no: val('gr_inv'), invoice_date: val('gr_invd'), vehicle_no: val('gr_veh'), tcs: val('gr_tcs'), remark: val('gr_rem'),
        lines: lines.map(l => ({ code: l.code, qty: l.qty, rate: l.rate, gst_pct: l.gst_pct, po_line: l.po_line || undefined })) } };
      const r = await saveAsk('grnSave', x); if (!r) return;
      toast('GRN ' + r.no + ' saved – ' + money(r.gross) + '.'); f.hidden = true; B = null; await boot(); grnLoad();
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
      field('is_date', 'Date *', inp('is_date', i ? i.date : today(), ' type="date"')) + field('is_kind', 'Issued to *', sel('is_kind', B.kinds.to, i ? i.to_kind : 'Site work')) + '<div class="field wide" id="is_whow"></div>' +
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
    f.innerHTML = '<h2>Return to the store – outward ' + i.no + ' (' + esc(toWho(i)) + ', ' + dmy(i.date) + ')</h2><div class="grid" style="margin-top:10px">' + field('rt_date', 'Return date *', inp('rt_date', today(), ' type="date"')) + field('rt_rem', 'Remark', inp('rt_rem', '', ' maxlength="300"'), 'wide') + '</div>' +
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
    grn: { head: ['GRN No', 'GRN Date', 'Challan No', 'Invoice No.', 'Invoice Date', 'Vehicle No', 'Supplier Name', 'Material Description', 'Received Qty', 'UOM', 'Basic Rate', 'GST %', 'TCS', 'Remark'],
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
      '<section class="panel"><h2>Numbers</h2><p class="muted" style="margin:0">Where the GRN and Outward numbers go on from (e.g. after the old register\'s last number). Only higher than the last one used.</p><div class="bar" id="nm_bar"></div></section>';
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
    try { await load(); await nums(); } catch (e) { failed(e); }
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
      if (d.grn) parts.push('<section class="panel"><h2>Recent GRN</h2><div class="tw" style="margin-top:10px"><table><thead><tr><th>GRN</th><th>Date</th><th>Supplier</th><th class="n">Gross</th></tr></thead><tbody>' + (d.grn.recent.map(g => '<tr><td>' + g.no + '</td><td>' + dmy(g.date) + '</td><td>' + esc(g.supplier) + '</td><td class="n">' + money(g.gross) + '</td></tr>').join('') || '<tr><td colspan="4" class="empty">None this month.</td></tr>') + '</tbody></table></div></section>');
      if (d.issue) parts.push('<section class="panel"><h2>Recent issues</h2><div class="tw" style="margin-top:10px"><table><thead><tr><th>Outward</th><th>Date</th><th>To</th><th class="n">Amount</th></tr></thead><tbody>' + (d.issue.recent.map(i => '<tr><td>' + i.no + '</td><td>' + dmy(i.date) + '</td><td>' + esc(toWho(i)) + '</td><td class="n">' + money(i.amount) + '</td></tr>').join('') || '<tr><td colspan="4" class="empty">None this month.</td></tr>') + '</tbody></table></div></section>');
      $('db_work2').hidden = !parts.length; $('db_work2').innerHTML = parts.join('');
    } catch (e) { if (e && e.code === 'notinstalled') { $('db_work').hidden = false; $('db_work').innerHTML = '<div class="note2">' + esc(e.message) + '</div>'; } }
  }

  const OPEN = { req: reqPage, purchase: purPage, po: poPage, grn: grnPage, issue: issuePage, reports: repPage, settings: setPage };
  window.RSW = { open: page => { if (!OPEN[page]) return; B = null; OPEN[page]().catch(e => failed(e)); }, dash: () => { B = null; dash(); } };
})();
