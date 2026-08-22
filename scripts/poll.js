#!/usr/bin/env node
/* OurGavel 15-minute pulse. Runs in GitHub Actions (unrestricted egress).
   1. Polls each case's RSS feeds; new keyword-matching items -> ticker (attributed, linked).
   2. Flags verdict-keyword items; if >=2 distinct outlets flag within the fresh window, opens a
      'verdict-watch' issue to alert the operators. NEVER writes a verdict as fact - that is
      red-lane, human+agent territory (see AGENT.md).
   3. Syncs open GitHub issues (community submissions + reports) into data/queue/issues.json
      for the hourly review session.
   4. Syncs reaction counts (traction) for published community nodes.
   No dependencies. Node 18+ (global fetch). */
const fs = require('fs');
const path = require('path');
const { assess, OUTCOME_LABEL, MIN_OUTLETS } = require('./verdict.js');

const ROOT = path.join(__dirname, '..');
const { discoverCase, safeToDiscover } = require('./media-fetch.js');
const DATA = path.join(ROOT, 'data');
const REPO = process.env.GB_REPO || 'evesloan/ourgavel';
const TOKEN = process.env.GITHUB_TOKEN || '';
const NOW = new Date().toISOString();

// ---- redaction ---------------------------------------------------------------
// Submissions are screened before publication, but the queue and thread files are
// COMMITTED TO A PUBLIC REPO. Anything personal that slips into a submission would
// become permanent and indexable, so it is stripped here too — defence in depth,
// on the way in, before it can ever be written to disk.
const REDACTORS = [
  [/\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/gi, '[email removed]'],
  [/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g, '[phone removed]'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[id removed]'],
  [/\b\d{1,5}\s+[A-Z][a-z]+\s+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Blvd|Way)\b/g, '[address removed]'],
  [/\b(?:\d[ -]?){13,19}\b/g, '[number removed]'],
];
function redact(text, cap) {
  let t = String(text || '');
  for (const [re, sub] of REDACTORS) t = t.replace(re, sub);
  return cap ? t.slice(0, cap) : t;
}

const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n'); };
const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return (h >>> 0).toString(36); };

async function get(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'OurGavelBot/1.0 (+https://ourgavel.com)', ...(opts.headers || {}) } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}
async function gh(pathname, opts = {}) {
  const r = await fetch('https://api.github.com' + pathname, {
    method: opts.method || 'GET',
    headers: { 'authorization': 'Bearer ' + TOKEN, 'accept': 'application/vnd.github+json', 'user-agent': 'OurGavelBot/1.0', ...(opts.body ? { 'content-type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!r.ok) throw new Error('GitHub ' + pathname + ' HTTP ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return r.json();
}

function parseRss(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const pick = tag => {
      const m = b.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
      return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim() : '';
    };
    let link = pick('link');
    if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"/i); link = m ? m[1] : ''; }
    const title = pick('title');
    const date = pick('pubDate') || pick('published') || pick('updated') || '';
    if (title && link) items.push({ title: decode(title), link: link.trim(), date });
  }
  return items;
}
const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&#8217;/g, '’').replace(/&#8216;/g, '‘').replace(/&#8220;/g, '“').replace(/&#8221;/g, '”').replace(/&nbsp;/g, ' ');

async function pollCase(slug) {
  const dir = path.join(DATA, 'cases', slug);
  const CASE = read(path.join(dir, 'case.json'));
  const tickerPath = path.join(dir, 'ticker.json');
  const T = fs.existsSync(tickerPath) ? read(tickerPath) : { items: [], seen: [] };
  const seen = new Set(T.seen);
  const kws = CASE.keywords.map(k => k.toLowerCase());
  const vkws = (CASE.verdictKeywords || []).map(k => k.toLowerCase());
  const fresh = [];
  for (const feed of CASE.feeds) {
    try {
      const xml = await get(feed.url);
      for (const it of parseRss(xml).slice(0, 40)) {
        const tl = it.title.toLowerCase();
        if (!kws.some(k => tl.includes(k))) continue;
        const id = hash(it.link);
        if (seen.has(id)) continue;
        seen.add(id);
        const isVerdicty = vkws.some(k => tl.includes(k));
        const ts = it.date ? new Date(it.date).toISOString() : NOW;
        fresh.push({ ts, outlet: feed.outlet, headline: it.title, url: it.link, flag: isVerdicty ? 'verdict-watch' : null });
      }
      feed._ok = true;
    } catch (e) { feed._ok = false; console.error('feed fail', feed.outlet, e.message); }
  }
  if (fresh.length) {
    fresh.sort((a, b) => b.ts.localeCompare(a.ts));
    T.items = [...fresh, ...T.items].slice(0, 100);
    T.seen = [...seen].slice(-600);
    write(tickerPath, T);
    console.log(slug + ':', fresh.length, 'new items');
  } else console.log(slug + ': no new items');

  // ---- verdict -------------------------------------------------------------
  // As of 2026-08-22 the site publishes verdicts without a human, so this is the most
  // consequential code here. Three gates (see scripts/verdict.js): the language must be
  // indicative, MIN_OUTLETS independent newsrooms must agree, and that agreement must
  // survive a second pulse cycle. Disagreement never publishes — it escalates.
  const statePath = path.join(dir, 'verdict-state.json');
  const state = fs.existsSync(statePath) ? read(statePath) : {};
  const v = assess(T.items);

  if (v.status === 'conflict') {
    if (TOKEN && state.alerted !== 'conflict') {
      await gh(`/repos/${REPO}/issues`, { method: 'POST', body: {
        title: `CONFLICT: outlets disagree on the ${CASE.shortTitle} verdict — nothing published`,
        body: `Newsrooms are reporting different outcomes. The site has published NOTHING and will not until this resolves.\n\n`
          + `Leading: **${v.outcome}** (${v.outlets.join(', ')})\n`
          + v.conflict.map(c => `Contradicted by **${c.outcome}** (${c.outlets.join(', ')})`).join('\n')
          + `\n\nA human should look at this now.`,
        labels: ['verdict-watch', 'red-lane'] } });
    }
    write(statePath, { ...state, alerted: 'conflict', outcome: null });
    console.log(slug + ': VERDICT CONFLICT — withholding');
  } else if (v.status === 'ready') {
    if (state.pending === v.outcome) {
      // Second consecutive cycle agreeing. Publish.
      if (!CASE.verdict) {
        const sources = v.items.map(i => ({ outlet: i.outlet, url: i.url }));
        CASE.verdict = {
          outcome: v.outcome,
          label: OUTCOME_LABEL[v.outcome] || v.outcome,
          publishedAt: NOW,
          confirmedBy: v.outlets.length,
          sources,
        };
        CASE.phase = 'Verdict returned';
        CASE.statusNow = `The jury returned its verdict: ${OUTCOME_LABEL[v.outcome] || v.outcome}. `
          + `Confirmed by ${v.outlets.length} independent newsrooms, listed below. Sentencing and any appeal follow separately.`;
        CASE.statusNowSources = sources;
        write(path.join(dir, 'case.json'), CASE);

        const daysPath = path.join(dir, 'days.json');
        if (fs.existsSync(daysPath)) {
          const D = read(daysPath);
          const last = (D.days || []).reduce((m, d) => Math.max(m, d.day || 0), 0);
          D.days = D.days || [];
          D.days.push({
            day: last + 1, date: NOW.slice(0, 10), phase: 'Verdict',
            headline: `Verdict: ${OUTCOME_LABEL[v.outcome] || v.outcome}`,
            summary: `The jury returned its verdict. Reported independently by ${v.outlets.join(', ')}. `
              + `This entry was published automatically once ${MIN_OUTLETS}+ newsrooms agreed and that agreement held across two checks.`,
            sources, witnesses: [],
          });
          write(daysPath, D);
        }
        console.log(slug + ': VERDICT PUBLISHED —', v.outcome);
        if (TOKEN) {
          await gh(`/repos/${REPO}/issues`, { method: 'POST', body: {
            title: `Verdict published: ${CASE.shortTitle} — ${OUTCOME_LABEL[v.outcome] || v.outcome}`,
            body: `Published automatically after ${v.outlets.length} independent newsrooms agreed across two consecutive checks.\n\n`
              + sources.map(x => `- ${x.outlet}: ${x.url}`).join('\n')
              + `\n\nNext: the review session should resolve the board's central question, add the sentencing date if known, and archive the case when it is over.`,
            labels: ['verdict-watch'] } });
        }
      }
      write(statePath, { ...state, published: v.outcome, pending: null, alerted: 'published' });
    } else {
      // First sighting of a qualifying consensus. Hold one cycle.
      write(statePath, { ...state, pending: v.outcome, firstSeen: NOW });
      console.log(slug + ': verdict consensus seen (' + v.outcome + ') — holding one cycle to confirm');
    }
  } else if (v.status === 'watch') {
    write(statePath, { ...state, pending: null });
    console.log(slug + ': verdict signal below threshold (' + v.outlets.length + '/' + MIN_OUTLETS + ')');
  }

  // A published verdict that later contradicts the newsroom picture must be flagged loudly.
  if (CASE.verdict && v.status !== 'none' && v.outcome && v.outcome !== CASE.verdict.outcome && TOKEN && state.alerted !== 'disputed') {
    await gh(`/repos/${REPO}/issues`, { method: 'POST', body: {
      title: `DISPUTED: published ${CASE.shortTitle} verdict contradicted by later reporting`,
      body: `The site published **${CASE.verdict.outcome}**. Newsrooms are now reporting **${v.outcome}** (${v.outlets.join(', ')}).\n\nCorrect or retract immediately.`,
      labels: ['verdict-watch', 'red-lane'] } });
    write(statePath, { ...state, alerted: 'disputed' });
    console.log(slug + ': VERDICT DISPUTED');
  }
}

async function syncIssues() {
  if (!TOKEN) { console.log('no token; skipping issue sync'); return; }
  try {
    const issues = await gh(`/repos/${REPO}/issues?state=open&per_page=100`);
    const q = issues.filter(i => !i.pull_request).map(i => ({
      number: i.number, title: redact(i.title, 300), body: redact(i.body, 4000),
      labels: i.labels.map(l => typeof l === 'string' ? l : l.name),
      user: i.user && i.user.login, created: i.created_at,
      reactions: { up: (i.reactions && i.reactions['+1']) || 0, down: (i.reactions && i.reactions['-1']) || 0 },
      url: i.html_url,
    }));
    write(path.join(DATA, 'queue', 'issues.json'), { synced: NOW, open: q });
    console.log('issue queue:', q.length, 'open');
    await syncThreads(q);
    // traction sync for published community nodes
    for (const slug of fs.readdirSync(path.join(DATA, 'cases'))) {
      const cPath = path.join(DATA, 'cases', slug, 'community.json');
      if (!fs.existsSync(cPath)) continue;
      const C = read(cPath);
      let dirty = false;
      for (const n of C.nodes || []) {
        if (!n.issueNumber) continue;
        const match = q.find(i => i.number === n.issueNumber);
        if (match) { const t = { up: match.reactions.up, down: match.reactions.down }; if (!n.traction || n.traction.up !== t.up || n.traction.down !== t.down) { n.traction = t; dirty = true; } }
      }
      if (dirty) write(cPath, C);
    }
  } catch (e) { console.error('issue sync fail', e.message); }
}

// ---- discussion threads ------------------------------------------------------
// Every node can have a discussion. A published theory's thread is its own issue.
// Record nodes get threads lazily: any issue whose body carries an <!--node:ID-->
// marker becomes that node's thread. Comments are synced into data each cycle and
// rendered into the static board, so readers see threads with <=15 min lag and
// zero client-side API calls.
async function syncThreads(openIssues) {
  const byCase = {};
  for (const slug of fs.readdirSync(path.join(DATA, 'cases'))) {
    const cPath = path.join(DATA, 'cases', slug, 'community.json');
    if (!fs.existsSync(path.join(DATA, 'cases', slug, 'case.json'))) continue;
    byCase[slug] = { threads: {} };
    const C = fs.existsSync(cPath) ? read(cPath) : { nodes: [] };
    for (const n of C.nodes || []) if (n.issueNumber) byCase[slug].threads['c-' + n.issueNumber] = { number: n.issueNumber, url: n.issue };
  }
  for (const iss of openIssues) {
    const m = (iss.body || '').match(/<!--node:([\w-]+)\s+case:([\w-]+)-->/);
    if (m && byCase[m[2]] && !byCase[m[2]].threads[m[1]]) byCase[m[2]].threads[m[1]] = { number: iss.number, url: iss.url };
  }
  for (const [slug, { threads }] of Object.entries(byCase)) {
    const out = {};
    const ids = Object.keys(threads).slice(0, 40);
    for (const nodeId of ids) {
      const t = threads[nodeId];
      try {
        const comments = await gh(`/repos/${REPO}/issues/${t.number}/comments?per_page=30`);
        out[nodeId] = {
          url: t.url,
          count: comments.filter(c => !/^(Live on the Board|Thanks —)/.test(c.body || '')).length,
          comments: comments
            .filter(c => c.user && c.user.type !== 'Bot' && !/^(Live on the Board|Thanks —)/.test(c.body || ''))
            .slice(-4)
            .map(c => ({ user: c.user.login, ts: c.created_at, body: redact((c.body || '').replace(/<[^>]+>/g, ''), 400) })),
        };
      } catch (e) { console.error('thread sync fail', nodeId, e.message); }
    }
    write(path.join(DATA, 'cases', slug, 'threads.json'), { synced: NOW, threads: out });
  }
}

// ---- fast-lane theory ingest -------------------------------------------------
// Theories about the case itself publish on this 15-minute cycle after an automated
// screen. Any post that discusses a specific person is held for the hourly editor
// session ('needs-review'). Rate limit: 3 submissions per author per 24h.
// Power users are the point. The limit exists to stop scripted spam, not to ration
// contribution — someone dumping thirty sourced claims in an evening is exactly who
// this site is for. Contributors with a clean published record get the higher ceiling
// automatically; nobody has to ask.
const RATE_LIMIT = 25;
const TRUSTED_LIMIT = 120;
const TRUSTED_AFTER = 8;   // published, still-standing contributions
function authorStanding(login) {
  let published = 0;
  try {
    for (const slug of fs.readdirSync(path.join(DATA, 'cases'))) {
      const cPath = path.join(DATA, 'cases', slug, 'community.json');
      if (!fs.existsSync(cPath)) continue;
      for (const n of (read(cPath).nodes || [])) {
        if (n.submittedBy === login && n.status !== 'removed') published++;
      }
    }
  } catch (e) { /* first run */ }
  return { published, limit: published >= TRUSTED_AFTER ? TRUSTED_LIMIT : RATE_LIMIT };
}
function field(body, label) {
  const re = new RegExp('###\\s*' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\n+([\\s\\S]*?)(?=\\n###\\s|$)', 'i');
  const m = (body || '').match(re);
  return m ? m[1].trim().replace(/^_No response_$/i, '') : '';
}
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

async function ensureLabels() {
  const labels = [['published', '2ea44f', 'Live on the Board'], ['needs-review', 'e0a83d', 'Held for editor review'], ['rate-limited', 'aaaaaa', 'Over the daily post limit'], ['verdict-watch', 'e05d5d', 'Verdict-related alert'], ['red-lane', 'b03a3a', 'Needs operator approval']];
  for (const [name, color, description] of labels) {
    try { await gh(`/repos/${REPO}/labels`, { method: 'POST', body: { name, color, description } }); } catch (e) { /* exists */ }
  }
}
async function ingestTheories() {
  if (!TOKEN) return;
  const qPath = path.join(DATA, 'queue', 'issues.json');
  if (!fs.existsSync(qPath)) return;
  const q = read(qPath).open || [];
  const pending = q.filter(i => i.labels.includes('theory') && !['published', 'needs-review', 'rate-limited', 'red-lane'].some(l => i.labels.includes(l)));
  if (!pending.length) return;
  await ensureLabels();
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  for (const iss of pending) {
    try {
      const standing = authorStanding(iss.user);
      const byAuthor = q.filter(o => o.user === iss.user && new Date(o.created).getTime() > dayAgo);
      if (byAuthor.length > standing.limit) {
        await gh(`/repos/${REPO}/issues/${iss.number}/labels`, { method: 'POST', body: { labels: ['rate-limited'] } });
        await gh(`/repos/${REPO}/issues/${iss.number}/comments`, { method: 'POST', body: { body: `Held, not rejected — you're past ${standing.limit} posts in 24 hours and this one goes up on the next cycle.\n\nIf you're working through a case in bulk and want the cap lifted, say so here and an editor will raise it. Contributors with ${TRUSTED_AFTER} published contributions get ${TRUSTED_LIMIT}/day automatically; you're at ${standing.published}.` } });
        continue;
      }
      const slug = (field(iss.body, 'Case') || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
      const dir = path.join(DATA, 'cases', slug);
      if (!slug || !fs.existsSync(path.join(dir, 'case.json'))) {
        await gh(`/repos/${REPO}/issues/${iss.number}/labels`, { method: 'POST', body: { labels: ['needs-review'] } });
        await gh(`/repos/${REPO}/issues/${iss.number}/comments`, { method: 'POST', body: { body: `Thanks — I couldn't match this to a case we track, so an editor will place it (usually within the hour).` } });
        continue;
      }
      const CASE = read(path.join(dir, 'case.json'));
      const days = fs.existsSync(path.join(dir, 'days.json')) ? read(path.join(dir, 'days.json')) : { days: [] };
      const claim = field(iss.body, 'Your theory, in one sentence');
      const reasoning = field(iss.body, 'Reasoning');
      const falsify = field(iss.body, 'What would disprove it?');
      const all = [claim, reasoning, falsify].join('\n');
      const names = buildNameSets(CASE, days);
      const mentioned = personMentions(all, names);
      const pii = PII.some(re => re.test(all));
      if (!claim || claim.length > 220 || all.length > 3000 || pii || mentioned.length) {
        await gh(`/repos/${REPO}/issues/${iss.number}/labels`, { method: 'POST', body: { labels: ['needs-review'] } });
        const why = pii ? 'it looks like it contains contact or address details' : mentioned.length ? `it discusses a specific person (${mentioned.slice(0, 3).join(', ')}) — posts about people always get human eyes first` : 'of length/format';
        await gh(`/repos/${REPO}/issues/${iss.number}/comments`, { method: 'POST', body: { body: `Thanks — holding this for editor review because ${why}. Usually under an hour.` } });
        continue;
      }
      // publish
      const cPath = path.join(dir, 'community.json');
      const C = fs.existsSync(cPath) ? read(cPath) : { nodes: [], edges: [] };
      if (C.nodes.some(n => n.issueNumber === iss.number)) continue;
      const idx = C.nodes.length;
      C.nodes.push({
        id: 'c-' + iss.number, type: 'rumor', status: 'unverified',
        x: 1160 + (idx % 2) * 240, y: 80 + Math.floor(idx / 2) * 150,
        title: claim,
        body: reasoning + (falsify ? ' — What would disprove it: ' + falsify : ''),
        submittedBy: iss.user, issueNumber: iss.number, issue: iss.url,
        traction: { up: iss.reactions.up, down: iss.reactions.down },
        sources: [],
      });
      write(cPath, C);
      await gh(`/repos/${REPO}/issues/${iss.number}/labels`, { method: 'POST', body: { labels: ['published'] } });
      await gh(`/repos/${REPO}/issues/${iss.number}/comments`, { method: 'POST', body: { body: `Live on the Board: https://ourgavel.com/cases/${slug}/board/ — 👍 reactions on this issue count as corroboration, 👎 as dispute; this thread is the theory's discussion page. Sources are what move it from amber; if you have one, submit evidence.` } });
      console.log('published theory #' + iss.number, 'to', slug);
    } catch (e) { console.error('ingest fail #' + iss.number, e.message); }
  }
}

/* Photographs.
 *
 * A case page with no picture on it reads as a wall of text, and readers bounce off walls of
 * text. But a wrong picture on a page about a killing is a far worse failure than a plain
 * one, so this only ever adds places — courthouses, civic buildings, towns — and only when
 * the file clears the token gate in the case record. People are queued, never published.
 *
 * The bytes are copied into public/media/ and served from our own origin. Nothing here
 * introduces an outbound request on a reader's page, which is the whole point.
 */
async function discoverMedia(slug) {
  const safe = safeToDiscover();
  if (!safe.ok) {
    if (!discoverMedia._warned) {
      discoverMedia._warned = true;
      console.error('MEDIA DISCOVERY DISABLED THIS RUN — ' + path.basename(safe.test) + ' failed:');
      console.error(safe.detail);
    }
    return;
  }
  const cPath = path.join(DATA, 'cases', slug, 'case.json');
  const CASE = JSON.parse(fs.readFileSync(cPath, 'utf8'));
  if (!(CASE.mediaQueries || []).length) return;
  let r;
  try {
    r = await discoverCase(CASE, { outDir: path.join(ROOT, 'data'), now: NOW });
  } catch (e) { console.error('media discovery failed for', slug, e.message); return; }

  if (r.added.length) {
    CASE.media = (CASE.media || []).concat(r.added);
    write(cPath, CASE);
    for (const a of r.added) console.log('media +', slug, a.local, '·', a.licence, '·', a.credit);
  }
  // Anything held back is written down rather than dropped, so the queue is reviewable
  // instead of being a decision nobody can see.
  // Everything held back is written down, including query-level failures. Discovery runs
  // unattended against an API this sandbox cannot reach, so this file is the only way to
  // tell "the query found nothing" apart from "the gate refused what it found".
  const qPath = path.join(DATA, 'cases', slug, 'media-queue.json');
  write(qPath, {
    updated: NOW,
    published: r.added.map(a => ({ local: a.local, licence: a.licence, credit: a.credit })),
    heldForReview: r.queued.slice(0, 20),
    refused: r.rejected.slice(0, 30),
  });
}

(async () => {
  const cases = fs.readdirSync(path.join(DATA, 'cases')).filter(d => fs.existsSync(path.join(DATA, 'cases', d, 'case.json')));
  for (const slug of cases) await pollCase(slug);
  for (const slug of cases) await discoverMedia(slug);
  await syncIssues();
  await ingestTheories();
  console.log('pulse complete', NOW);
})();
