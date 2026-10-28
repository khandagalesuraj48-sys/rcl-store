/* THE AI FOR THE STORE (28-10-2026, the old inward register: "AI read krel"): Claude (Anthropic), as Mechanical's – with
 * ANTHROPIC_API_KEY in this project's settings (Vercel → rcl-store → Environment Variables; never in a file or in chat).
 * ANTHROPIC_MODEL fixes the model (else Sonnet, then Haiku when Sonnet is busy); ANTHROPIC_API_BASE is for tests (a stand-in).
 * Only words go to it (names of the file) – never a key, a password or a person's data. Without a key: off (said so). */
'use strict';
const KEY = () => String(process.env.ANTHROPIC_API_KEY || '').trim();
const BASE = () => String(process.env.ANTHROPIC_API_BASE || 'https://api.anthropic.com').replace(/\/+$/, '');
const MODELS = () => { const m = String(process.env.ANTHROPIC_MODEL || '').trim(); return m ? [m] : ['claude-sonnet-5-5', 'claude-haiku-5-5']; };
const on = () => !!KEY();

// what the AI answered as JSON (the first {…} of its text) – null when it is not
function jsonOf(t) {
  const s = String(t || ''), a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
}

/* one question (text only), answered as JSON. Busy (429 / 5xx / 529 / too slow): the next model while there is time (opt.ms for the
 * whole question – the Store's server answers within 30 s); a key not taken, no credit: said. */
async function askJson(prompt, opt) {
  opt = opt || {};
  const end = Date.now() + (opt.ms || 50000);
  if (!on()) { const e = new Error('The AI is not set up for the Store (ANTHROPIC_API_KEY in Vercel → rcl-store → Environment Variables) – the names stay as in the file.'); e.user = true; throw e; }
  let last = 'the AI service was too slow to answer';
  for (const model of MODELS()) {
    const left = end - Date.now();
    if (left < 4000) break;
    let r;
    try {
      r = await fetch(BASE() + '/v1/messages', { method: 'POST', headers: { 'x-api-key': KEY(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: model, max_tokens: opt.tokens || 8000, messages: [{ role: 'user', content: [{ type: 'text', text: String(prompt) }] }] }), signal: AbortSignal.timeout(left) });
    } catch (e) { last = 'the AI service was too slow to answer'; continue; }
    const text = await r.text().catch(() => '');
    if (r.status === 401 || r.status === 403) { const e = new Error('The AI service did not accept its key (' + r.status + '): the Admin has to check ANTHROPIC_API_KEY of rcl-store in Vercel and Redeploy.'); e.user = true; throw e; }
    if (r.status === 400 && /credit balance|purchase credits|billing/i.test(text)) { const e = new Error('The AI service has no credit left (Claude): the Admin has to add funds in Claude Console → Billing.'); e.user = true; throw e; }
    if (r.status === 429 || r.status >= 500) { last = 'the AI service is busy (' + r.status + ')'; continue; }
    if (!r.ok) { last = 'the AI service answered ' + r.status; continue; }
    let j = null; try { j = JSON.parse(text); } catch (e) { j = null; }
    const out = jsonOf(((j && j.content) || []).filter(c => c && c.type === 'text').map(c => c.text).join(''));
    if (out) return out;
    last = 'the AI\'s answer was cut off';
  }
  const e = new Error('The AI could not look at the names now (' + last + ') – try again in a minute.'); e.user = true; throw e;
}

module.exports = { on, askJson, jsonOf };
