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

const ROOT = path.join(__dirname, '..');
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

  // Verdict circuit-breaker: >=2 distinct outlets with verdict-flagged items in the last 3 hours.
  const cutoff = Date.now() - 3 * 3600 * 1000;
  const recentV = T.items.filter(i => i.flag === 'verdict-watch' && new Date(i.ts).getTime() > cutoff);
  const outlets = [...new Set(recentV.map(i => i.outlet))];
  if (outlets.length >= 2 && TOKEN) {
    const marker = path.join(dir, '.verdict-alerted');
    const key = hash(recentV.map(i => i.url).sort().join('|'));
    const prev = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : '';
    if (prev !== key) {
      try {
        await gh(`/repos/${REPO}/issues`, { method: 'POST', body: {
          title: `🚨 VERDICT WATCH: ${CASE.shortTitle} — ${outlets.length} outlets reporting verdict-related news`,
          body: `Automated alert from the 15-minute pulse.\n\nOutlets: ${outlets.join(', ')}\n\n` + recentV.map(i => `- [${i.outlet}] ${i.headline}\n  ${i.url}`).join('\n') + `\n\nPer EDITORIAL.md this is RED LANE: the site's own record must not state a verdict until the review session verifies 2+ independent credentialed reports AND the operator approves. The ticker already carries the attributed headlines.`,
          labels: ['verdict-watch', 'red-lane'] } });
        fs.writeFileSync(marker, key);
        console.log('VERDICT WATCH issue opened for', slug);
      } catch (e) { console.error('verdict issue fail', e.message); }
    }
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
const RATE_LIMIT = 3;
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
      const byAuthor = q.filter(o => o.user === iss.user && new Date(o.created).getTime() > dayAgo);
      if (byAuthor.length > RATE_LIMIT) {
        await gh(`/repos/${REPO}/issues/${iss.number}/labels`, { method: 'POST', body: { labels: ['rate-limited'] } });
        await gh(`/repos/${REPO}/issues/${iss.number}/comments`, { method: 'POST', body: { body: `Thanks — you're over the ${RATE_LIMIT}-posts-per-day limit, so this one will wait for tomorrow's cycle. It hasn't been rejected.` } });
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

(async () => {
  const cases = fs.readdirSync(path.join(DATA, 'cases')).filter(d => fs.existsSync(path.join(DATA, 'cases', d, 'case.json')));
  for (const slug of cases) await pollCase(slug);
  await syncIssues();
  await ingestTheories();
  console.log('pulse complete', NOW);
})();
