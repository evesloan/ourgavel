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

// Every way a reader can contribute. All of them land as a labelled GitHub issue, which is
// the queue the pulse and the review session already read — so nothing about moderation
// changes, only where the writing happens.
const KINDS = {
  theory:     { label: 'theory',     title: c => '[theory] ' + c.claim },
  question:   { label: 'question',   title: c => '[question] ' + c.claim },
  evidence:   { label: 'evidence',   title: c => '[evidence] ' + (c.claim || c.url) },
  connection: { label: 'connection', title: c => '[connection] ' + (c.from || '?') + ' → ' + (c.to || '?') },
  comment:    { label: 'discussion', title: c => 'Discussion: ' + (c.nodeTitle || c.node || 'a card') },
  report:     { label: 'report',     title: c => '[report] ' + (c.reason || 'content report') },
  correction: { label: 'correction', title: c => '[correction] ' + (c.claim || 'factual correction') },
  request:    { label: 'case-request', title: c => '[case request] ' + (c.claim || 'new case') },
};

const MAX = { claim: 220, reasoning: 1800, falsify: 400, name: 40, url: 400, node: 80, reason: 80 };
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
    // A 204 may not carry a body -- `new Response(body, {status:204})` throws in the runtime,
    // so this used to fail the CORS preflight outright and take every JSON POST with it.
    // Null body, and the CORS headers that are the entire point of the response.
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': allowed,
          'access-control-allow-headers': 'content-type',
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-max-age': '86400',
          'vary': 'origin',
        },
      });
    }
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, allowed);

    // Only our own pages may submit.
    const origin = request.headers.get('origin') || '';
    if (origin && origin !== allowed) return json({ error: 'origin not allowed' }, 403, allowed);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400, allowed); }

    const kind = String(body.kind || 'theory');
    if (!KINDS[kind]) return json({ error: 'unknown kind' }, 400, allowed);

    const caseSlug = String(body.case || '').replace(/[^a-z0-9-]/g, '').slice(0, 60);
    const claim = redact(body.claim, MAX.claim);
    const reasoning = redact(body.reasoning, MAX.reasoning);
    const falsify = redact(body.falsify, MAX.falsify);
    const name = redact(body.name, MAX.name).replace(/[^\w .'-]/g, '');
    const node = redact(body.node, MAX.node).replace(/[^\w-]/g, '');
    const nodeTitle = redact(body.nodeTitle, MAX.claim);
    const reason = redact(body.reason, MAX.reason);
    const from = redact(body.from, MAX.node);
    const to = redact(body.to, MAX.node);
    const relation = ['supports', 'contradicts', 'contested', 'explains'].includes(body.relation) ? body.relation : '';
    // Only http(s) links are accepted, and only as evidence — never rendered as markup.
    const url = /^https?:\/\/\S+$/i.test(String(body.url || '')) ? String(body.url).slice(0, MAX.url) : '';

    // A discussion comment needs a body, not a headline; everything else needs a claim.
    const primary = kind === 'comment' ? reasoning : claim;
    if (!caseSlug) return json({ error: 'Missing case.' }, 400, allowed);
    if (kind === 'evidence' && !url) return json({ error: 'Evidence needs a link to the source.' }, 400, allowed);
    // Three words, matching the composer. The relay must not be stricter than the form, or a
    // reader gets past the page only to be refused by something they cannot see.
    if (String(primary || '').trim().split(/\s+/).filter(Boolean).length < 3) {
      return json({ error: 'Three words at least — enough to make the point.' }, 400, allowed);
    }

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
    const lines = [`### Case`, caseSlug];
    // The node marker is what lets the pulse attach a discussion to the right card.
    if (node) lines.push(``, `<!--node:${node} case:${caseSlug}-->`, `### Card`, nodeTitle || node);
    if (kind === 'connection') {
      lines.push(``, `### From`, from || '_?_', ``, `### To`, to || '_?_', ``, `### Relation`, relation || '_unspecified_');
    }
    if (kind === 'report') lines.push(``, `### What is wrong`, reason || '_unspecified_');
    if (url) lines.push(``, `### Source`, url);
    if (claim) lines.push(``, `### In one sentence`, claim);
    lines.push(``, kind === 'comment' ? `### Comment` : `### Reasoning`, reasoning || '_none given_');
    if (falsify) lines.push(``, `### What would disprove it?`, falsify);
    lines.push(
      ``, `---`, attribution + ' via the composer on ' + allowed + '.',
      `Screened for personal information before submission. Subject to the same review as every other post.`,
    );
    const issueBody = lines.join('\n');

    const title = (KINDS[kind].title({ claim, url, from, to, node, nodeTitle, reason }) || kind).slice(0, 110);
    const res = await fetch(`https://api.github.com/repos/${env.REPO}/issues`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + env.GH_TOKEN,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'OurGavelSubmitRelay/1.0',
      },
      body: JSON.stringify({
        title,
        body: issueBody,
        // report jumps the queue; everything else follows the normal path
        labels: [KINDS[kind].label, 'via-composer'].concat(kind === 'report' ? ['urgent'] : []),
      }),
    });

    if (!res.ok) {
      return json({ error: 'Could not file that just now. Try again in a moment.' }, 502, allowed);
    }
    const issue = await res.json();
    return json({ ok: true, url: issue.html_url, number: issue.number }, 200, allowed);
  },
};
