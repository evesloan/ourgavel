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
 *   GH_TOKEN     — a fine-grained GitHub token with Issues: Read and write on evesloan/ourgavel
 *                  ONLY. It must not have contents or workflow access.
 *   QUEUE_TOKEN  — OPTIONAL. Enables the handoff queue (see below). Leave it unset and that
 *                  route does not exist; there is no half-open state.
 * Vars:
 *   REPO         — "evesloan/ourgavel"
 *   ORIGIN       — "https://ourgavel.com"
 *
 * INSTANT BOARD (added 2026-08-26). A theory or question that passes the same automated
 * screen the pulse runs is answered {published:true} and mirrored into KV for up to two
 * hours; the board and embed poll GET ?pending=<case> and show it to every viewer within
 * seconds. The GitHub issue remains the durable record — the pulse ingests it into
 * community.json as before, and the static build replaces the KV mirror. One that fails
 * the screen is filed with the needs-review label and answered {held:true} so the reader
 * is told the truth: an editor looks first. If KV or the screen data is unavailable the
 * relay degrades to the old behaviour and says so with {queued:true}. Fail closed:
 * nothing is ever shown instantly that the screen has not passed.
 */

// ==== SCREEN (GENERATED from scripts/screen.js by bundle-screen.js — do not edit) ====
const SCREEN = (() => { const module = { exports: {} };
/* OurGavel — the implication screen.
 *
 * `personMentions()` in poll.js catches NAMES. It is good at that and blind to everything else.
 * Tested against real submissions and the live case data, it waves through every one of these:
 *
 *     "Could it have been her husband at the time?"
 *     "the father was never properly investigated"
 *     "What about P.C.? He was the one who left the house."
 *     "Why has nobody asked the neighbour what he saw that night?"
 *
 * Each points at one identifiable living person who has not been charged, and each would have
 * gone onto a public board inside fifteen minutes. EDITORIAL.md §5 does not care whether the
 * accusation arrives as a proper noun. Neither does the person it lands on.
 *
 * So this file screens on IDENTIFIABILITY rather than capitalisation: relationship words fixed
 * to one person by a determiner or a possessive ("the husband" and "Clancy's brother" are
 * people; "husbands" is a category), the coded references people reach for precisely because
 * they know naming is not allowed, initials, jurors (§10, never, in any lane), and the
 * interrogative form of an accusation — which EDITORIAL.md names outright: "just asking
 * questions" fails.
 *
 * A hit is not a rejection. A hit means a human looks first, and `cleared[]` in
 * data/queue/held-comments.json is how that human puts one back. The cost of a false positive
 * is that an editor reads one extra sentence; the cost of a false negative is a bereaved father
 * reading on a public website that a stranger thinks he told his wife to kill their children.
 * Those costs are not comparable, and this file is tuned accordingly.
 *
 * Deliberately NOT screened: conduct and institutions. EDITORIAL.md §5 declares those open
 * season, so the prosecution, the defence, the judge, the detective, the hospital, the agency
 * and the medical examiner are absent from the vocabulary below on purpose. A screen that holds
 * "the hospital never escalated" would be a worse failure than the one it replaces, just a
 * quieter one — it would push every institutional question into a queue, and an editor who is
 * rubber-stamping is not moderating. That is what the must-PASS half of screen.test.js defends.
 *
 * Provenance: an earlier session drafted a screen with this same purpose. Its patch never landed
 * and had gone stale against main (it predated the `question` submission kind and would have
 * silently reverted it). Its better ideas — jurors, possessives, the escalate flag, `cleared[]` —
 * are carried here rather than lost, and this file supersedes it.
 */

// Relationship nouns. These denote a specific private individual once a determiner or a
// possessive fixes them to one.
const RELATION_NOUNS = [
  'husbands?', 'wi(?:fe|ves)', 'spouses?', 'exes', 'ex', 'boyfriends?', 'girlfriends?',
  'fianc(?:e|é)(?:e|és|es)?', 'partners?', 'lovers?', 'mistress(?:es)?', 'widows?', 'widowers?',
  'fathers?', 'mothers?', 'dads?', 'mums?', 'moms?', 'parents?', 'stepfathers?', 'stepmothers?',
  'stepdads?', 'stepmoms?', 'brothers?', 'sisters?', 'siblings?', 'twins?', 'sons?', 'daughters?',
  'grand(?:mother|father|parent|ma|pa)s?', 'uncles?', 'aunts?', 'cousins?', 'nephews?', 'nieces?',
  'in-laws?', 'family members?', 'relatives?', 'next of kin',
  'neighbou?rs?', 'roommates?', 'housemates?', 'flatmates?', 'landlords?', 'tenants?',
  'babysitters?', 'nannies|nanny', 'au pairs?', 'housekeepers?', 'carers?', 'caregivers?',
  'co-?workers?', 'colleagues?', 'bosses|boss', 'employers?', 'assistants?', 'bodyguards?',
  'best friends?', 'friends?',
];
const REL_ALT = RELATION_NOUNS.join('|');
// Determiners that fix a noun to one identifiable person, plus up to two modifiers
// ("her ex husband", "the second wife", "his new girlfriend").
const MODS = '(?:(?:ex|step|half|former|current|first|second|third|new|old|estranged|late|other|real|so-called)[-\\s]+){0,2}';
const REL_RE = new RegExp('\\b(?:the|her|his|their|its|our|my|that|this|a|an|one)\\s+' + MODS + '(' + REL_ALT + ')\\b', 'i');
// "Clancy's brother", "the defendant's mother" — a possessive identifies just as precisely.
const POSSESSIVE_RE = new RegExp("\\b[A-Za-z]+['\u2019]s\\s+" + MODS + '(' + REL_ALT + ')\\b', 'i');

// Ways of pointing at someone while making a show of not naming them. Somebody writing one of
// these knows the rule and is working around it, which is exactly why it routes to a human.
const CODED = [
  [/\byou[-\s]?know[-\s]?who\b/i, 'coded reference to a specific person'],
  [/\bwe all know who\b/i, 'coded reference to a specific person'],
  [/\ba certain (?:someone|person|individual|party|man|woman|family|relative|family member)\b/i, 'coded reference to a specific person'],
  [/\bthe (?:one|person|guy|man|woman) (?:we|you|i)\s+(?:all\s+)?(?:can'?t|cannot|won'?t|shouldn'?t|are not allowed to|aren'?t allowed to)\s+name\b/i, 'coded reference to a specific person'],
  [/\bwon'?t say (?:the|his|her|their) name\b/i, 'coded reference to a specific person'],
  [/\brhymes with\b/i, 'coded reference to a specific person'],
  [/\bnot? names?,? but\b/i, 'coded reference to a specific person'],
  [/\bnot naming (?:names|anyone|him|her|them)\b/i, 'coded reference to a specific person'],
  [/\bif you know,? you know\b/i, 'coded reference to a specific person'],
  [/\bthe other (?:one|person|parent|adult)\b/i, 'points at an unnamed specific person'],
  [/\bsomeone (?:else )?(?:close to|in|inside) (?:the|that|her|his|their)\s+\w+/i, 'points at an unnamed specific person'],
  [/\bsomeone (?:in|inside) (?:the )?(?:house|home|family|room|building)\b/i, 'points at an unnamed specific person'],
  [/\bwho (?:really|actually) (?:did it|did|killed|was behind)\b/i, 'implies an uncharged person committed the crime'],
  [/\bthe (?:real|actual) (?:killer|suspect|perpetrator|culprit|murderer|one)\b/i, 'implies an uncharged person committed the crime'],
];

// Initials standing in for a name. Institutional abbreviations are exempt — a federal case is
// full of them — but an acronym earlier in the text must not shield real initials later, so
// every occurrence is checked rather than only the first.
const INITIALS_RE = /(?:^|[^A-Za-z.])([A-Z]\.\s?[A-Z]\.?(?:\s?[A-Z]\.?)?)(?=$|[^A-Za-z])/g;
const ACRONYMS = new Set(['US', 'USA', 'UK', 'EU', 'DA', 'ME', 'PD', 'DC', 'FBI', 'ATF', 'DEA',
  'AM', 'PM', 'AG', 'EMS', 'ER', 'ICU', 'PTSD', 'DOJ', 'MGL', 'CV', 'JD', 'MD', 'PHD', 'RN',
  'LLC', 'INC', 'PS', 'BS', 'ID', 'TV', 'OK']);
const isAcronym = s => ACRONYMS.has(String(s).replace(/[^A-Za-z]/g, '').toUpperCase());
// An initial plus a surname ("P. Clancy") identifies as precisely as the full name. The
// lookbehind keeps "U.S. Attorney" and "D.C. Circuit" out of it — those are institutions.
const INITIAL_SURNAME_RE = /(?<![A-Za-z]\.)\b([A-Z])\.\s?([A-Z][a-z]{2,})\b/;

// EDITORIAL.md §10 — jurors. Never, in any lane, in any framing.
const JUROR_RE = /\bjuror\s*(?:#|no\.?|number)?\s*\d+|\bjuror\b|\bthe\s+(?:foreman|forewoman|forepersons?)\b|\bjury\s+members?\b/i;

// The interrogative form of an accusation. EDITORIAL.md §5 rejects it by name.
const JAQ = [
  [/\b(?:why|how come|how is it that)\b[^.?!]{0,110}?\b(?:never|not|n['’`]t|no ?one|nobody)\b[^.?!]{0,70}?\b(?:charged|arrested|questioned|interviewed|investigated|looked at|a suspect|suspected|searched|tested|polygraph\w*|indicted|prosecuted|on trial)\b/i,
    'asks why an uncharged person was not investigated — an accusation in question form'],
  [/\b(?:why|how come)\b[^.?!]{0,110}?\b(?:alibi|lie detector|polygraph|phone records|whereabouts)\b/i,
    'asks for an uncharged person to be investigated'],
];

// Framing that turns a person reference into an insinuation. On its own this is fine — asking
// hard questions is the point of the site. Combined with a person reference it is the shape the
// rubric fails by name, and the item is worth an editor's attention before the rest of the queue.
const IMPLICATION_RE = new RegExp([
  'could it (?:have )?(?:be|been)', 'what if (?:it|he|she|they|someone) (?:was|were|had|did)',
  "is(?:n'?t| not) it (?:odd|strange|suspicious|convenient|weird|interesting)",
  "why (?:did|would|has|have)(?:n'?t)? (?:he|she|they|nobody|no one)",
  'makes you wonder', 'just asking', 'no ?one (?:is|has) ask(?:ing|ed)',
  'nobody (?:is|has) ask(?:ing|ed)', 'has anyone (?:looked at|considered|asked about)',
  'seems awfully convenient', 'draw your own conclusion',
].join('|'), 'i');

const PII_RES = [
  [/\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i, 'an email address'],
  [/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/, 'a phone number'],
  [/\b\d{1,5}\s+[A-Z][a-z]+\s+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Blvd|Way)\b/, 'a street address'],
  [/(?:^|\s)@[a-z0-9_]{3,}\b/i, 'a social handle'],
  [/\b\d{3}-\d{2}-\d{4}\b/, 'an identification number'],
];

/** Screen free text for references to identifiable people other than the defendant.
 *  Returns [] when nothing fires. Each hit is { rule, why, match }. */
function implicationHits(text) {
  const t = String(text || '');
  const hits = [];
  for (const [re, why] of PII_RES) { const p = t.match(re); if (p) { hits.push({ rule: 'pii', why: 'it looks like it contains ' + why, match: p[0].trim() }); break; } }
  const j = t.match(JUROR_RE);
  if (j) hits.push({ rule: 'juror', why: 'it refers to a juror, which we never publish', match: j[0].trim() });
  const m = t.match(REL_RE) || t.match(POSSESSIVE_RE);
  if (m) hits.push({ rule: 'relation', why: `refers to a specific private individual ("${m[0].trim()}")`, match: m[0].trim() });
  for (const [re, why] of CODED) { const c = t.match(re); if (c) { hits.push({ rule: 'coded', why, match: c[0].trim() }); break; } }
  for (const [re, why] of JAQ) { const q = t.match(re); if (q) { hits.push({ rule: 'just-asking', why, match: q[0].trim().slice(0, 60) }); break; } }
  for (const i of t.matchAll(INITIALS_RE)) {
    if (!isAcronym(i[1])) { hits.push({ rule: 'initials', why: `initials stand in for a name ("${i[1].trim()}")`, match: i[1].trim() }); break; }
  }
  const s = t.match(INITIAL_SURNAME_RE);
  if (s) hits.push({ rule: 'initials', why: `an initial and a surname identify a person ("${s[0]}")`, match: s[0] });
  return hits;
}

/** One-line reason for the editor queue and for the submitter, or '' if the text is clear. */
function implicationReason(text) {
  const h = implicationHits(text);
  return h.length ? h.map(x => x.why).join('; ') : '';
}

/** True when a person reference arrives wrapped in insinuation — the "just asking questions"
 *  shape. Held either way; this only tells the editor which item to read first. */
function shouldEscalate(text) {
  const h = implicationHits(text);
  return h.some(x => x.rule !== 'pii') && (IMPLICATION_RE.test(String(text || '')) || h.some(x => x.rule === 'just-asking'));
}

// ---------------------------------------------------------------------------------
// The NAME screen, canonical copies. These moved here 2026-08-26 so that build.js and
// the relay Worker can share them with the pulse. poll.js still carries its own local
// copies (deliberately untouched that night: a queued handoff held a full-file poll.js
// and an edit here would have been silently clobbered when it applied). pending.test.js
// asserts the two copies stay byte-identical until a lane dedupes them; if that test is
// failing, someone changed one copy — change both, or finish the dedupe.
function personMentions(text, allowedNames) {
  const t = ' ' + text + ' ';
  const hits = new Set();
  // capitalized bigrams that look like names (not sentence-start artifacts alone)
  for (const m of t.matchAll(/\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})\b/g)) {
    const full = m[1] + ' ' + m[2];
    if (!allowedNames.stop.has(m[1].toLowerCase()) && !allowedNames.allowed.has(full.toLowerCase())) hits.add(full);
  }
  // known participant tokens (witnesses, family) — any mention routes to review
  for (const tok of allowedNames.participants) {
    if (tok.length > 3 && new RegExp('\\b' + tok + '\\b', 'i').test(text)) hits.add(tok);
  }
  return [...hits];
}
function buildNameSets(CASE, days) {
  const allowed = new Set(); // the defendant — the person the trial is about
  const parts = String(CASE.defendant || '').match(/[A-Z][a-z]+ [A-Z][a-z]+/);
  if (parts) allowed.add(parts[0].toLowerCase());
  const participants = new Set();
  for (const d of days.days || []) for (const w of d.witnesses || []) {
    for (const tok of w.name.replace(/["'.]/g, '').split(/\s+/)) if (/^[A-Z][a-z]{3,}$/.test(tok)) participants.add(tok);
  }
  // defendant's own tokens are allowed, remove from participant token set
  if (parts) for (const tok of parts[0].split(' ')) participants.delete(tok);
  const stop = new Set(['the', 'this', 'that', 'court', 'judge', 'jury', 'state', 'trial', 'county', 'superior', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'january', 'august', 'boston', 'massachusetts', 'commonwealth', 'defense', 'prosecution']);
  return { allowed, participants: [...participants], stop };
}
const PII = [/\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i, /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/, /\b\d{1,5}\s+[A-Z][a-z]+\s+(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Blvd)\b/, /(?:^|\s)@[a-z0-9_]{3,}\b/i];

// names.json round-trip: a name set serialised for the Worker, and hydrated back.
// The Worker cannot read data/; it fetches the built site's names.json instead.
function serialiseNameSets(ns) {
  return { allowed: [...ns.allowed], participants: [...ns.participants], stop: [...ns.stop] };
}
function hydrateNameSets(o) {
  return { allowed: new Set(o.allowed || []), participants: [...(o.participants || [])], stop: new Set(o.stop || []) };
}

module.exports = {
  implicationHits, implicationReason, shouldEscalate, RELATION_NOUNS,
  personMentions, buildNameSets, PII, serialiseNameSets, hydrateNameSets,
};

return module.exports; })();
// ==== END SCREEN ====

// Per-case name sets, fetched from the built site and cached per isolate. The screen's
// name half is case-specific; without it we do not publish instantly (fail closed).
const NAMES_TTL = 10 * 60 * 1000;
const namesCache = new Map();
async function nameSetsFor(slug, origin) {
  const hit = namesCache.get(slug);
  if (hit && Date.now() - hit.at < NAMES_TTL) return hit.ns;
  try {
    const r = await fetch(origin + '/cases/' + slug + '/names.json', { cf: { cacheTtl: 300 } });
    if (!r.ok) return null;
    const ns = SCREEN.hydrateNameSets(await r.json());
    namesCache.set(slug, { at: Date.now(), ns });
    return ns;
  } catch { return null; }
}

const PEND_TTL_SEC = 7200;
const pendKey = (slug, n) => 'pend:' + slug + ':' + n;

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

// ---------------------------------------------------------------- the handoff queue
// An unattended lane (SEO, community, development) finishes a piece of work and POSTs it
// here; scripts/poll.js picks it up on the next pulse, applies it, runs the whole gate, and
// commits only if everything is green. That is the loop that lets the site improve itself
// while nobody is watching.
//
// This is the only route in this Worker that can cause code to run anywhere, so it is the
// only one that needs a token, and it FAILS CLOSED: with QUEUE_TOKEN unset it 404s.
//
// Why the origin check above is not enough. `origin` is absent on any server-side request,
// so `if (origin && origin !== allowed)` — exactly right for a browser — cannot tell one of
// our own lanes from anyone at all with curl. A reader theory slipping through that gap is
// a moderation problem and the hourly sweep catches it. A handoff slipping through it would
// put content on a court record under our own byline, having passed every test we have,
// because no test suite can catch a plausible lie. Hence a shared secret, and hence this
// route ignoring `redact()` and the three-word rule, both of which would corrupt a payload.
const HANDOFF_LABEL = 'handoff';
const MAX_HANDOFF = 60000;        // GitHub issue bodies cap at 65536; leave room for the wrapper
const HANDOFF_LANES = ['seo', 'community', 'development', 'lead'];

// Constant-time compare. A token checked with === leaks its length and prefix to anyone
// willing to measure, and this one is worth measuring.
function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(String(a || ''));
  const y = enc.encode(String(b || ''));
  if (x.length !== y.length || x.length === 0) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

async function handoff(body, request, env, allowed) {
  if (!env.QUEUE_TOKEN) return json({ error: 'not found' }, 404, allowed);
  const auth = request.headers.get('authorization') || '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!safeEqual(presented, env.QUEUE_TOKEN)) return json({ error: 'not found' }, 404, allowed);

  const lane = HANDOFF_LANES.includes(String(body.lane || '')) ? String(body.lane) : '';
  const title = String(body.title || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 100);
  const payload = String(body.payload || '');
  if (!lane) return json({ error: 'unknown lane' }, 400, allowed);
  if (!title) return json({ error: 'a handoff needs a title' }, 400, allowed);
  if (!payload) return json({ error: 'a handoff needs a payload' }, 400, allowed);
  if (payload.length > MAX_HANDOFF) return json({ error: 'payload too large: ' + payload.length + ' > ' + MAX_HANDOFF }, 413, allowed);
  // Base64 only. The applier decodes and hashes this; anything else is a bug upstream and
  // should be refused here rather than filed as an issue nobody can apply.
  if (!/^[A-Za-z0-9+/=\s]+$/.test(payload)) return json({ error: 'payload must be base64' }, 400, allowed);
  const sha = String(body.sha256 || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha)) return json({ error: 'a handoff needs a sha256 of the decoded payload' }, 400, allowed);

  const issueBody = [
    '### Lane', lane,
    '', '### SHA-256 of the decoded payload', sha,
    '', '### Payload (base64 of a gzipped JSON apply-plan)',
    '```', payload.replace(/\s+/g, ''), '```',
    '', '---',
    'Queued by an unattended OurGavel lane through the authenticated relay.',
    'scripts/poll.js applies this on the next pulse, gates it on the full suite, and commits',
    'only if every check passes. Nothing here reached the site without that gate.',
  ].join('\n');

  const res = await fetch(`https://api.github.com/repos/${env.REPO}/issues`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + env.GH_TOKEN,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'OurGavelSubmitRelay/1.0',
    },
    body: JSON.stringify({ title: '[handoff:' + lane + '] ' + title, body: issueBody, labels: [HANDOFF_LABEL, 'lane:' + lane] }),
  });
  if (!res.ok) return json({ error: 'could not queue that', status: res.status }, 502, allowed);
  const issue = await res.json();
  return json({ ok: true, url: issue.html_url, number: issue.number }, 200, allowed);
}

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
    'access-control-allow-methods': 'GET, POST, OPTIONS',
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
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-max-age': '86400',
          'vary': 'origin',
        },
      });
    }
    // The instant-board feed: submissions that passed the screen, visible to every
    // viewer while the next static build catches up. Public data, no auth, no store.
    if (request.method === 'GET') {
      const slug = (new URL(request.url).searchParams.get('pending') || '').replace(/[^a-z0-9-]/g, '').slice(0, 60);
      if (!slug) return json({ error: 'GET ?pending=<case>' }, 400, allowed);
      const items = [];
      if (env.RATE) {
        try {
          const list = await env.RATE.list({ prefix: 'pend:' + slug + ':' });
          for (const k of list.keys.slice(0, 24)) {
            const v = await env.RATE.get(k.name);
            if (v) { try { items.push(JSON.parse(v)); } catch {} }
          }
        } catch {}
      }
      return new Response(JSON.stringify({ items }), {
        status: 200,
        headers: {
          'content-type': 'application/json', 'cache-control': 'no-store',
          'access-control-allow-origin': allowed, 'vary': 'origin',
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
    // The queue is a different animal from a reader submission: authenticated, unredacted,
    // and much larger. Branch before any of the reader-shaped validation below touches it.
    if (kind === 'handoff') return handoff(body, request, env, allowed);
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
    // Mirror the composer EXACTLY (build.js): comment, report and connection carry their
    // text in `reasoning`; everything else in `claim`. This checked `claim` for reports, so
    // a report that passed the form was refused here with the same words the form uses —
    // the reader was told to add detail to text the page had already accepted. Found by
    // pending.test.js posting the composer's real payload shape.
    const primary = (kind === 'comment' || kind === 'report' || kind === 'connection') ? reasoning : claim;
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

    // ---- the instant path, for the two kinds the pulse auto-publishes ----------------
    // Same screen, same order, same outcome as ingestTheories() in poll.js: PII, then
    // named people, then the implication screen. Pass -> publish now (KV mirror) and let
    // the pulse make it durable. Fail -> file WITH needs-review so the pulse holds it
    // too, and tell the reader the truth. No screen data -> no instant claim.
    let instant = null;   // null = not applicable | {state:'published'|'held'|'queued', ...}
    if (kind === 'theory' || kind === 'question') {
      const all = [claim, reasoning, falsify].join('\n');
      const ns = await nameSetsFor(caseSlug, allowed);
      if (!ns) instant = { state: 'queued' };
      else {
        const pii = SCREEN.PII.some(re => re.test(all));
        const mentioned = pii ? [] : SCREEN.personMentions(all, ns);
        const implied = pii || mentioned.length ? '' : SCREEN.implicationReason(all);
        if (pii) instant = { state: 'held', why: 'it looks like it contains contact or address details' };
        else if (mentioned.length) instant = { state: 'held', why: 'it discusses a specific person — posts about people always get human eyes first' };
        else if (implied) instant = { state: 'held', why: 'it ' + implied + ' — posts about people always get human eyes first, however they are phrased' };
        else if (!env.RATE) instant = { state: 'queued' };
        else instant = { state: 'published' };
      }
    }

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
        labels: [KINDS[kind].label, 'via-composer']
          .concat(kind === 'report' ? ['urgent'] : [])
          .concat(instant && instant.state === 'held' ? ['needs-review'] : []),
      }),
    });

    if (!res.ok) {
      return json({ error: 'Could not file that just now. Try again in a moment.' }, 502, allowed);
    }
    const issue = await res.json();

    if (instant && instant.state === 'published') {
      // The KV mirror every viewer's board polls. The static build replaces it within
      // the hour; the TTL cleans up regardless. Position is assigned client-side —
      // only the client knows how many cards of this kind it is already drawing.
      const node = {
        id: 'c-' + issue.number, kind,
        type: kind === 'theory' ? 'rumor' : 'question',
        status: kind === 'theory' ? 'unverified' : 'open',
        title: claim,
        body: reasoning + (falsify ? ' — What would disprove it: ' + falsify : ''),
        submittedBy: name || 'anonymous', issueNumber: issue.number, issue: issue.html_url,
        traction: { up: 0, down: 0 }, sources: [], ts: Date.now(),
      };
      try {
        await env.RATE.put(pendKey(caseSlug, issue.number), JSON.stringify(node), { expirationTtl: PEND_TTL_SEC });
      } catch { instant = { state: 'queued' }; }
      if (instant.state === 'published') {
        return json({ ok: true, url: issue.html_url, number: issue.number, published: true, node }, 200, allowed);
      }
    }
    if (instant && instant.state === 'held') {
      return json({ ok: true, url: issue.html_url, number: issue.number, held: true, why: instant.why }, 200, allowed);
    }
    if (instant && instant.state === 'queued') {
      return json({ ok: true, url: issue.html_url, number: issue.number, queued: true }, 200, allowed);
    }
    return json({ ok: true, url: issue.html_url, number: issue.number }, 200, allowed);
  },
};
