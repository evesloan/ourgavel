/**
 * OurGavel submission relay — Cloudflare Worker.
 *
 * The site is static, so it cannot hold the secret needed to file a submission. This tiny
 * Worker does: the browser POSTs a composed theory here, and this creates the GitHub issue
 * the pulse already knows how to read. Nothing about the existing review flow changes —
 * this only replaces "get redirected to GitHub and retype it" with "hit Post".
 *
 * Deploy once (see docs/SUBMIT-SETUP.md). Free tier is far beyond what this needs.
 *
 * Secrets required:
 *   GH_TOKEN  — a fine-grained GitHub token with Issues: Read and write on evesloan/ourgavel
 *               ONLY. It must not have contents or workflow access.
 * Vars:
 *   REPO      — "evesloan/ourgavel"
 *   ORIGIN    — "https://ourgavel.com"
 */

const MAX = { claim: 220, reasoning: 1800, falsify: 400, name: 40 };
const WINDOW_SEC = 3600;
const PER_WINDOW = 12;          // submissions per IP per hour — generous; spam-shaped, not user-shaped

// Never let a submission carry contact details into a public repo. Mirrors scripts/poll.js.
const REDACTORS = [
  [/\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/gi, '[email removed]'],
  [/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g, '[phone removed]'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[id removed]'],
  [/\b\d{1,5}\s+[A-Z][a-z]+\s+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Blvd|Way)\b/g, '[address removed]'],
  [/\b(?:\d[ -]?){13,19}\b/g, '[number removed]'],
];
const redact = (t, cap) => {
  let s = String(t || '');
  for (const [re, sub] of REDACTORS) s = s.replace(re, sub);
  return s.slice(0, cap).trim();
};

const json = (obj, status, origin) => new Response(JSON.stringify(obj), {
  status,
  headers: {
    'content-type': 'application/json',
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    'vary': 'origin',
  },
});

export default {
  async fetch(request, env) {
    const allowed = env.ORIGIN || 'https://ourgavel.com';
    if (request.method === 'OPTIONS') return json({ ok: true }, 204, allowed);
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, allowed);

    // Only our own pages may submit.
    const origin = request.headers.get('origin') || '';
    if (origin && origin !== allowed) return json({ error: 'origin not allowed' }, 403, allowed);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400, allowed); }

    const kind = String(body.kind || 'theory');
    if (!['theory', 'evidence', 'connection'].includes(kind)) return json({ error: 'unknown kind' }, 400, allowed);

    const caseSlug = String(body.case || '').replace(/[^a-z0-9-]/g, '').slice(0, 60);
    const claim = redact(body.claim, MAX.claim);
    const reasoning = redact(body.reasoning, MAX.reasoning);
    const falsify = redact(body.falsify, MAX.falsify);
    const name = redact(body.name, MAX.name).replace(/[^\w .'-]/g, '');
    if (!caseSlug || claim.length < 8) return json({ error: 'Say a bit more — one clear sentence at least.' }, 400, allowed);

    // Rate limit per IP. KV is optional: without it the Worker still works, just uncapped,
    // and the hourly editor sweep remains the backstop.
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    if (env.RATE) {
      const key = 'rl:' + ip;
      const n = parseInt(await env.RATE.get(key) || '0', 10);
      if (n >= PER_WINDOW) {
        return json({ error: "You've posted a lot in the last hour. Give it a little while — nothing was lost." }, 429, allowed);
      }
      await env.RATE.put(key, String(n + 1), { expirationTtl: WINDOW_SEC });
    }

    const attribution = name ? `Posted as **${name}** (unverified display name)` : 'Posted anonymously';
    const issueBody = [
      `### Case`, caseSlug,
      ``, `### Your theory, in one sentence`, claim,
      ``, `### Reasoning`, reasoning || '_none given_',
      ``, `### What would disprove it?`, falsify || '_none given_',
      ``, `---`, attribution + ' via the board composer on ' + allowed + '.',
      `Screened for personal information before submission. Subject to the same review as every other post.`,
    ].join('\n');

    const res = await fetch(`https://api.github.com/repos/${env.REPO}/issues`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + env.GH_TOKEN,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'OurGavelSubmitRelay/1.0',
      },
      body: JSON.stringify({
        title: `[${kind}] ${claim.slice(0, 90)}`,
        body: issueBody,
        labels: [kind, 'via-composer'],
      }),
    });

    if (!res.ok) {
      return json({ error: 'Could not file that just now. Try again in a moment.' }, 502, allowed);
    }
    const issue = await res.json();
    return json({ ok: true, url: issue.html_url, number: issue.number }, 200, allowed);
  },
};
