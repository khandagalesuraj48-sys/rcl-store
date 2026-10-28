/* (28-10-2026) FOR THE STORE'S TESTS ON THE LOCAL RIG: the AI's stand-in (Anthropic's Messages API on :3996 – the Store started with
 * ANTHROPIC_API_KEY=test-key-s ANTHROPIC_API_BASE=http://127.0.0.1:3996) and an inward register made as his file is (test values only). */
'use strict';
const http = require('http'), XLSX = require('../public/vendor/xlsx-0.18.5.full.min.js'), I = require('../lib/items');
// ---- the AI's stand-in (Anthropic's Messages API): names that are near (lib/items near()) given the spelling most rows use ----
const AILOG = [], AIBUSY = { n: 0 };
function aiStandin() {
  return new Promise(res => {
    const srv = http.createServer((q, r) => { let b = ''; q.on('data', c => { b += c; }); q.on('end', () => {
      const send = (code, o) => { r.writeHead(code, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(o)); };
      if (q.headers['x-api-key'] !== 'test-key-s') return send(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
      if (!q.headers['anthropic-version']) return send(400, { type: 'error', error: { type: 'invalid_request_error', message: 'anthropic-version: header is required' } });
      let j = {}; try { j = JSON.parse(b); } catch (e) { return send(400, { type: 'error', error: { type: 'invalid_request_error', message: 'format' } }); }
      if (AIBUSY.n > 0) { AIBUSY.n--; AILOG.push({ model: j.model, busy: true }); return send(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }); }
      const text = ((j.messages || [])[0] || {}).content.map(c => c.text).join(''), a = text.indexOf('In the file, [name, rows]: '), e2 = text.indexOf('\nAlready saved: ');
      let names = [], saved = []; try { names = JSON.parse(text.slice(a + 27, e2 > -1 ? e2 : undefined)); saved = e2 > -1 ? JSON.parse(text.slice(e2 + 16)) : []; } catch (e) { names = []; }
      AILOG.push({ model: j.model, n: names.length, saved: saved.length, ok: /^NAMES OF AN OLD STORE INWARD REGISTER/.test(text), kind: (/In the list of (\w+)/.exec(text) || [])[1], max: j.max_tokens });
      const fixes = [], byRows = names.slice().sort((x, y) => y[1] - x[1]);
      names.forEach(([n, rows]) => { const to = saved.find(s => I.near(n, s)) || (byRows.find(([m, k]) => m !== n && k > rows && I.near(n, m)) || [])[0]; if (to) fixes.push([n, to]); });
      send(200, { id: 'msg_s' + AILOG.length, type: 'message', role: 'assistant', model: j.model, content: [{ type: 'text', text: JSON.stringify({ fixes: fixes }) }], stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 60 } });
    }); }).listen(3996, '127.0.0.1', () => res(srv));
  });
}

// ---- a register as his file is: a Summary sheet, the heading on row 4 (two lines in a cell), a GRN's details on its first row ----
function makeRegister() {
  const head = ['Sr No ', 'GRN\r\n No', 'GRN Date ', 'Challan No ', 'Invoice No.', 'Invoice Date', 'Vehicle No', 'Supplier Name ', 'Material Description', 'Received\r\nQty', 'UOM', 'Basic\r\nRate ', 'Taxable \r\nAmount', 'GST\r\n Amount', 'TCS', 'Gross \r\nAmount', 'Remark'];
  const sup = []; for (let i = 0; i < 60; i++) sup.push(['Shree', 'Om', 'Sai', 'Jai', 'Navkar', 'Mahalaxmi'][i % 6] + ' ' + ['Hardware', 'Traders', 'Auto Parts', 'Steel Centre', 'Electricals', 'Tyres', 'Enterprises', 'Lubricants', 'Paints', 'Stationery'][Math.floor(i / 6)] + (i % 4 === 0 ? ' Bhiwandi' : ''));
  const items = []; for (let i = 0; i < 200; i++) items.push([['Hydraulic Oil', 'Gear Oil', 'Fuel Filter', 'Oil Filter', 'Air Filter', 'Bolt', 'Nut', 'Washer', 'Binding Wire', 'Cement OPC'][i % 10] + ' ' + (10 + Math.floor(i / 10) * 2) + (i % 10 < 5 ? ' No' : ' MM'), ['ltr', 'Ltrs', 'nos', 'Nos ', 'pcs', 'nos', 'nos', 'nos', 'kgs', 'bags'][i % 10], [180, 210, 450, 380, 900, 12, 4, 1, 80, 350][i % 10]]);
  const rows = [], dup = [], sr = { n: 0 }, d0 = 44900;      // 2022-12-05
  const row = (ref, day, s, inv, it, qty, x) => { const [name, uom, rate] = items[it], tx = Math.round(qty * rate * 100) / 100, g = Math.round(tx * 18) / 100;
    return [++sr.n, ref, d0 + day, x && x.ch || '', inv, d0 + day - 1, x && x.veh || '', sup[s], (x && x.name) || name, qty, uom, rate, tx, g, x && x.tcs || '', Math.round((tx + g + (x && x.tcs || 0)) * 100) / 100, x && x.rem || ''] };
  for (let ref = 1; ref <= 400; ref++) {
    const s = (ref * 7) % 60, day = Math.floor(ref / 3), n = 1 + (ref % 6);
    for (let k = 0; k < n; k++) {
      const it = (ref * 13 + k * 17) % 200, r = row(ref, day, s, 'INV-' + ref, it, 1 + ((ref + k) % 9), { veh: k ? '' : 'MH-04-AB-' + (1000 + ref), rem: (ref + k) % 3 ? 'Mechanical' : 'Hardware', tcs: ref % 50 === 0 && !k ? 12.5 : 0,
        name: ref % 25 === 0 && k === 0 ? items[it][0].replace('Hydraulic', 'Hydrolic').replace('Filter', 'Fliter').replace('Binding', 'Bindding') : '' });
      if (k) { r[2] = ''; r[4] = ''; r[5] = ''; r[7] = ''; }      // (his file: the GRN's details on its first row only)
      rows.push(r);
      if (ref % 40 === 0 && k === 0) { const d = r.slice(); d[0] = ++sr.n; rows.push(d); dup.push(d[0]); }      // the same row twice
    }
  }
  rows.push(row('342-A', 115, 5, 'INV-342A', 3, 2, { rem: 'Mechanical' })); rows.push(row('342 B', 115, 9, 'INV-342B', 4, 1, {}));
  rows.push(row(120, 41, 33, 'INV-OTHER', 8, 50, {}));      // GRN No 120 of another supplier, day and invoice: its own GRN
  rows.push(row('', 120, 11, 'TCI-77', 50, 1, { rem: 'Transport' })); rows.push(row('', 121, 12, 'TCI-78', 51, 1, {}));      // no GRN No
  const bad = row(401, 134, 3, 'INV-401', 9, 3, {}); bad[2] = '14-04-205'; rows.push(bad);      // not a date
  const noq = row(402, 134, 3, 'INV-402', 7, 0, {}); noq[9] = ''; noq[12] = ''; noq[13] = ''; noq[15] = ''; rows.push(noq);      // no quantity, no amount
  rows.push([++sr.n, 403, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);      // only a GRN No
  const far = row(404, 135, 3, 'INV-404', 9, 3, {}); far[2] = d0 + 135 - 7305; rows.push(far);      // 20 years early (a typing slip)
  for (let ref = 405; ref <= 410; ref++) rows.push(row(ref, 136, ref % 60, 'INV-' + ref, ref % 200, 2, {}));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Material', 'Qty'], ['Cement', 10]]), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['RCL – INWARD REGISTER'], [], []].concat([head], rows)), 'MAIN SHEET INWARD1');
  return { buf: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), dup: dup };
}
module.exports = { aiStandin, makeRegister, AILOG, AIBUSY };
