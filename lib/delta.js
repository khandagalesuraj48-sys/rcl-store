/* (Mechanical update-155 – THE SAME FILE as Mechanical's server/delta.js, word for word below this line: one way for every module)
 * (update-155) "SAME AS YOU HAVE" AND "ONLY WHAT CHANGED" – for every question the page asks (lists, the Dashboard, the
 * heartbeat …), one shared way for the whole app, with no change to any action's own code.
 *
 * The page keeps the last answer of each question in its memory only (never in the browser's storage) with the answer's
 * fingerprint (h, SHA-256). When it asks the same question again it says which fingerprint it has (have). The server works the
 * answer out exactly as before – from the database, with the asker's access checked as always – and then:
 *   · the same fingerprint            → { h, same: 1 }                 (about 50 bytes instead of the whole list)
 *   · the server still has that answer → { h, base, delta: [...] }      (only the parts that changed; the rest is copied
 *                                                                       from what the page already has)
 *   · anything else                   → { h, result }                  (the whole answer, as before)
 * The page checks the rebuilt answer against h; a mismatch (or a missing base) asks again for the whole answer. So the page
 * always ends up with exactly the server's answer of NOW – a stored answer is never taken as the truth, only as a shorthand.
 * Only a page that asks for it (m: 1) gets these answers; every other caller (an older page, the phone app) gets { result }.
 *
 * The answers kept here are per question AND per sign-in (the key holds the site and the whole question, with the sign-in's
 * token), so one person's answer is never used for another's – and a base is used only by the same asker.
 *
 * CLIENT is the text of the two functions both sides use (the page gets this same text in its bridge): split an answer into
 * pieces at "}," and "]," (the end of a row) and rebuild an answer from a base and a delta. */
'use strict';
const crypto = require('crypto');

const CLIENT = [
  'function rclSplit(t) { var out = [], st = 0, n = t.length, c, p = 0;',
  '  for (var j = 0; j < n; j++) { c = t.charCodeAt(j); if (c === 44 && (p === 125 || p === 93)) { out.push(t.slice(st, j + 1)); st = j + 1; } p = c; }',
  '  if (st < n) out.push(t.slice(st)); return out; }',
  'function rclPatch(base, ops) { if (!Array.isArray(ops)) return null; var seg = rclSplit(base), s = \'\';',
  '  for (var i = 0; i < ops.length; i++) { var o = ops[i];',
  '    if (typeof o === \'string\') s += o;',
  '    else if (Array.isArray(o) && o.length === 2 && o[0] >= 0 && o[1] > 0 && o[0] + o[1] <= seg.length) s += seg.slice(o[0], o[0] + o[1]).join(\'\');',
  '    else return null; }',
  '  return s; }'
].join('\n');
const { rclSplit, rclPatch } = new Function(CLIENT + '\nreturn { rclSplit: rclSplit, rclPatch: rclPatch };')();

const hash = text => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex').slice(0, 32);

/* the changes from the old answer to the new one: copies of runs of the old pieces ([first, how many]) and new text (a string) */
function diff(oldT, newT) {
  const a = rclSplit(oldT), b = rclSplit(newT), pos = new Map();
  for (let i = 0; i < a.length; i++) { const l = pos.get(a[i]); if (!l) pos.set(a[i], [i]); else if (l.length < 8) l.push(i); }
  const ops = []; let lit = '', run = null, end = 0;
  for (let j = 0; j < b.length; j++) {
    const s = b[j];
    if (run && run[0] + run[1] < a.length && a[run[0] + run[1]] === s) { run[1]++; end = run[0] + run[1]; continue; }
    const l = s.length > 8 ? pos.get(s) : null;
    if (l) {
      const i = l.find(x => x >= end) !== undefined ? l.find(x => x >= end) : l[0];
      if (lit) { ops.push(lit); lit = ''; }
      run = [i, 1]; ops.push(run); end = i + 1; continue;
    }
    run = null; lit += s;
  }
  if (lit) ops.push(lit);
  return ops;
}

/* the answers kept on this server, by question (site + whole question with the sign-in's token): newest last; at most
 * MAX_TOTAL characters, an answer above MAX_ONE is not kept (it still gets "same") */
const MAX_TOTAL = Math.max(1e6, Number(process.env.RCL_ANSWERS_MAX) || 32e6), MAX_ONE = 2e6, MIN_DELTA = 4096;
const KEPT = new Map(); let total = 0;
function keep(key, h, text) {
  const had = KEPT.get(key); if (had) { KEPT.delete(key); total -= had.text.length; }
  if (text.length > MAX_ONE) return;
  KEPT.set(key, { h: h, text: text }); total += text.length;
  for (const [k, v] of KEPT) { if (total <= MAX_TOTAL) break; KEPT.delete(k); total -= v.text.length; }
}
const keyOf = (site, fn, args) => hash(String(site || '') + '\n' + String(fn) + '\n' + JSON.stringify(args === undefined ? [] : args));

/* the answer to send: { text, kind: 'full' | 'same' | 'delta' } – out is the whole answer (JSON text) as worked out now */
function answer(key, out, have, canPatch) {
  const h = hash(out), prev = KEPT.get(key);
  have = typeof have === 'string' && /^[0-9a-f]{32}$/.test(have) ? have : '';
  if (have && have === h) { if (!prev || prev.h !== h) keep(key, h, out); else { KEPT.delete(key); KEPT.set(key, prev); } return { text: '{"h":"' + h + '","same":1}', kind: 'same', full: out.length }; }
  let d = '';
  if (canPatch && have && prev && prev.h === have && out.length >= MIN_DELTA) {
    const t = JSON.stringify(diff(prev.text, out));
    if (t.length < out.length / 2) d = t;
  }
  keep(key, h, out);
  if (d) return { text: '{"h":"' + h + '","base":"' + have + '","delta":' + d + '}', kind: 'delta', full: out.length };
  return { text: '{"h":"' + h + '","result":' + out + '}', kind: 'full', full: out.length };
}
const kept = () => ({ answers: KEPT.size, chars: total });
const clearKept = () => { KEPT.clear(); total = 0; };
module.exports = { CLIENT, rclSplit, rclPatch, diff, hash, answer, keyOf, kept, clearKept };
