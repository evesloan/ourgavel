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
const { assess, watchWarrantsEscalation, defendantTokens, OUTCOME_LABEL, MIN_OUTLETS, WINDOW_HOURS } = require('./verdict.js');

const ROOT = path.join(__dirname, '..');
const { discoverCase, safeToDiscover } = require('./media-fetch.js');
const { implicationReason, shouldEscalate } = require('./screen.js');
const { resolveUrl, itemKey, dedupeItems, isOffTopic, matchesCaseKeywords } = require('./canonical.js');
const { nameFor } = require('./outlets.js');
const { applyHandoffs } = require('./apply.js');
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
  // Heal what the rotating-token bug already wrote: canonicalise and collapse the
  // stored list before polling, so a case that accumulated 100 copies of 23
  // stories converges on the next pulse instead of needing a data patch.
  const before = (T.items || []).length;
  T.items = dedupeItems(T.items);
  const healed = before - T.items.length;
  // Second heal, added 2026-08-22: attribution. Stored rows carry whatever feed label was
  // in case.json the day they arrived, and for two cases that label was "Bing News", which
  // publishes nothing. Relabel from the resolved host on every pulse, so the correction
  // reaches rows already on the site instead of only new ones.
  //
  // This lives in poll.js and NOT in build.js on purpose. The workflow commits `data`
  // BEFORE it builds, so anything build.js writes into data/ is thrown away. A relabel
  // done at build time would look right in the rendered page and silently never persist,
  // and the verdict engine reads the STORED rows.
  let relabelled = 0;
  for (const it of T.items) {
    const name = nameFor(it.url, it.outlet);
    if (name && name !== it.outlet) { it.outlet = name; relabelled++; }
  }
  // #22 veto sweep. A one-time manual scrub of an off-topic row is undone by the very next
  // poll, which re-ingests it from the still-live feed. So on EVERY pulse, drop stored rows
  // whose headline matches an exclude keyword — the durable partner to the ingest-time veto
  // below. Runs before the verdict engine reads T.items, so a separate-matter row can never
  // reach `assess()` either.
  const ekws = CASE.excludeKeywords || [];
  let vetoed = 0;
  if (ekws.length) {
    const kept = T.items.filter(it => !isOffTopic(it.headline, ekws));
    vetoed = T.items.length - kept.length;
    T.items = kept;
  }
  // `seen` is capped at 600 ids; the redirector churn used to blow that cap in a
  // few polls and take real dedupe memory with it. The stored list is the durable
  // second check.
  const have = new Set(T.items.map(i => itemKey(i.url)));
  const vkws = (CASE.verdictKeywords || []).map(k => k.toLowerCase());
  const fresh = [];
  for (const feed of CASE.feeds) {
    try {
      const xml = await get(feed.url);
      for (const it of parseRss(xml).slice(0, 40)) {
        const tl = it.title.toLowerCase();
        // A case match needs a STRONG keyword — a keyword listed in `geoKeywords` (a bare
        // county/city name) corroborates but never matches alone. See canonical.matchesCaseKeywords.
        if (!matchesCaseKeywords(it.title, CASE.keywords, CASE.geoKeywords)) continue;
        // #22: matched a case keyword, but the keyword is doing double duty (an agency name,
        // a defendant's name now attached to a separate prosecution). A declared exclude
        // keyword vetoes it at the door so it never enters the record. See canonical.isOffTopic.
        if (isOffTopic(it.title, ekws)) continue;
        // Identity is the ARTICLE, not the feed's link to it: Bing wraps every
        // item in a redirector whose token rotates each request, so hashing the
        // raw link re-ingested the same story every 15 minutes. See canonical.js.
        const url = resolveUrl(it.link);
        const id = hash(itemKey(url));
        if (seen.has(id) || have.has(itemKey(url))) continue;
        seen.add(id);
        const isVerdicty = vkws.some(k => tl.includes(k));
        const ts = it.date ? new Date(it.date).toISOString() : NOW;
        // The feed label says where we LOOKED. `url` is where the story actually lives,
        // and that is the only honest answer to "who published this?".
        fresh.push({ ts, outlet: nameFor(url, feed.outlet), headline: it.title, url, flag: isVerdicty ? 'verdict-watch' : null });
      }
      feed._ok = true;
    } catch (e) { feed._ok = false; console.error('feed fail', feed.outlet, e.message); }
  }
  if (fresh.length || healed || relabelled || vetoed) {
    fresh.sort((a, b) => b.ts.localeCompare(a.ts));
    // Sorted, not just prepended: the ticker is rendered as "latest", and with
    // duplicates gone a mis-ordered row is now plainly visible in a four-row list.
    T.items = dedupeItems([...fresh, ...T.items])
      .sort((a, b) => String(b.ts).localeCompare(String(a.ts))).slice(0, 100);
    T.seen = [...new Set([...seen, ...T.items.map(i => hash(itemKey(i.url)))])].slice(-600);
    write(tickerPath, T);
    console.log(slug + ':', fresh.length, 'new items'
      + (healed ? ', ' + healed + ' duplicate(s) collapsed' : '')
      + (relabelled ? ', ' + relabelled + ' source label(s) corrected' : '')
      + (vetoed ? ', ' + vetoed + ' off-topic row(s) vetoed' : ''));
  } else console.log(slug + ': no new items');

  // ---- verdict -------------------------------------------------------------
  // As of 2026-08-22 the site publishes verdicts without a human, so this is the most
  // consequential code here. Three gates (see scripts/verdict.js): the language must be
  // indicative, MIN_OUTLETS independent newsrooms must agree, and that agreement must
  // survive a second pulse cycle. Disagreement never publishes — it escalates.
  const statePath = path.join(dir, 'verdict-state.json');
  const state = fs.existsSync(statePath) ? read(statePath) : {};
  // Scoped to this case's own lead defendant, so a co-defendant's or co-conspirator's verdict in
  // this ticker can never publish as this defendant's (see verdict.js subjectIsOther).
  const v = assess(T.items, Date.now(), { defendantTokens: defendantTokens(CASE) });

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
  } else if (v.status === 'split') {
    // Newsrooms report a SPLIT/PARTIAL verdict (acquittal on one charge, conviction on another).
    // The engine holds — a machine must not decide the overall outcome — but it must NOT hold
    // silently: raise a verdict-watch issue so a human writes the nuanced aftermath (AGENT.md).
    // Never publishes, never sets pending. Fires once per case (gated on state.alerted), and not
    // at all once a verdict is on the record — the aftermath is already a human's job by then.
    if (!CASE.verdict && TOKEN && state.alerted !== 'split') {
      await gh(`/repos/${REPO}/issues`, { method: 'POST', body: {
        title: `SPLIT VERDICT: outlets report a partial ${CASE.shortTitle} verdict — nothing published`,
        body: `Newsrooms are reporting a SPLIT/PARTIAL verdict — an acquittal on one charge AND a `
          + `conviction on another in the same reporting. The engine has published NOTHING: a split `
          + `outcome is ambiguous about the overall result by construction and a human must write it.\n\n`
          + `Reported by: ${v.outlets.join(', ')}\n\n`
          + v.items.map(i => `- ${i.outlet}: ${i.headline}\n  ${i.url}`).join('\n')
          + `\n\nAction (AGENT.md verdict aftermath): read the sources, set the verdict per charge, `
          + `write the closing day entry, resolve the board's central question, update phase/statusNow.`,
        labels: ['verdict-watch', 'red-lane'] } });
    }
    write(statePath, { ...state, pending: null, alerted: 'split' });
    console.log(slug + ': VERDICT SPLIT — escalating, withholding');
  } else if (v.status === 'watch') {
    // A below-threshold signal usually IS below threshold — one stray "guilty" headline, noise.
    // But when WATCH_ESCALATE_MIN+ independent newsrooms assert the SAME outcome with zero rivals
    // and no verdict is on record, that is a real verdict the engine simply can't self-confirm (too
    // few families inside the window), not noise. Holding silently is exactly how the Tupac GUILTY
    // went unhandled on every pulse. Raise a verdict-watch issue so a human takes the red-lane
    // publish decision. NEVER publishes, NEVER sets a verdict; fires once per case (state.alerted).
    if (!CASE.verdict && TOKEN && state.alerted !== 'watch' && watchWarrantsEscalation(v)) {
      await gh(`/repos/${REPO}/issues`, { method: 'POST', body: {
        title: `VERDICT WATCH: ${v.outlets.length} newsrooms report a ${CASE.shortTitle} ${OUTCOME_LABEL[v.outcome] || v.outcome} verdict — engine can't self-confirm, nothing published`,
        body: `${v.outlets.length} independent newsrooms report the same outcome — **${OUTCOME_LABEL[v.outcome] || v.outcome}** — and no outlet asserts a different one, but that is below the ${MIN_OUTLETS}-family bar the engine requires to publish a criminal verdict on its own. The site has published NOTHING and set no verdict.\n\n`
          + `Reported by: ${v.outlets.join(', ')}\n\n`
          + v.items.map(i => `- ${i.outlet}: ${i.headline}\n  ${i.url}`).join('\n')
          + `\n\nThis is the RED LANE (AGENT.md §3b). A human confirms the outcome against the sources, then EITHER the aftermath is written on approval, OR the engine publishes on its own once a ${MIN_OUTLETS}th independent family drops a fresh report inside the ${WINDOW_HOURS}h window. The verdict is never inferred from this alert and never published automatically from it.`,
        labels: ['verdict-watch', 'red-lane'] } });
      write(statePath, { ...state, pending: null, alerted: 'watch' });
      console.log(slug + ': VERDICT WATCH — escalating (' + v.outlets.length + '/' + MIN_OUTLETS + '), withholding');
    } else {
      write(statePath, { ...state, pending: null });
      console.log(slug + ': verdict signal below threshold (' + v.outlets.length + '/' + MIN_OUTLETS + ')');
    }
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
    byCase[slug] = { threads: {}, live: new Set() };
    const C = fs.existsSync(cPath) ? read(cPath) : { nodes: [] };
    for (const n of C.nodes || []) {
      if (n.id) byCase[slug].live.add(n.id);
      if (n.issueNumber) byCase[slug].threads['c-' + n.issueNumber] = { number: n.issueNumber, url: n.issue };
    }
    // Record-lane nodes host threads too (the lazy <!--node:ID--> path below), so their ids
    // count as live. A thread may only ever attach to a node that is actually on a board: a
    // discussion opened on a node that moderation later REMOVED must not re-create a dangling
    // thread on the next cycle. That exact shape — discussion #13 on removed node c-7 — is what
    // burned the community lane's greener handoff at the gate on 2026-08-27.
    const bPath = path.join(DATA, 'cases', slug, 'board.json');
    if (fs.existsSync(bPath)) for (const n of (read(bPath).nodes || [])) if (n.id) byCase[slug].live.add(n.id);
  }
  // The question that opens a thread is held to the same rule as the replies in it. An issue
  // whose body implicates someone who has not been charged does not get to become a discussion
  // page on a public board and collect answers to itself.
  const heldSeeds = [];
  for (const iss of openIssues) {
    const m = (iss.body || '').match(/<!--node:([\w-]+)\s+case:([\w-]+)-->/);
    if (!(m && byCase[m[2]] && byCase[m[2]].live.has(m[1]) && !byCase[m[2]].threads[m[1]])) continue;
    const seed = (iss.body || '').replace(/<!--[\s\S]*?-->/g, '').trim();
    const why = implicationReason(seed);
    if (why) { heldSeeds.push({ kind: 'thread-opener', case: m[2], node: m[1], issue: iss.number, url: iss.url, user: iss.user, escalate: shouldEscalate(seed), why, body: seed.slice(0, 400) }); continue; }
    byCase[m[2]].threads[m[1]] = { number: iss.number, url: iss.url };
  }
  // Comments used to render with no screening at all: only the PII regexes in redact() stood
  // between a GitHub reply and a public board, on a 15-minute cycle. A theory saying "it was the
  // husband" was held for review; the identical sentence posted as a comment on the same node
  // published itself. The composer promises "Replies appear on this card once reviewed", so the
  // screen below is the code catching up with what the site already told readers it does.
  // Hold is not reject. `cleared` is how a human puts one back: an editor adds the comment id
  // to cleared[] in data/queue/held-comments.json and the next pulse renders it.
  const HELD_PATH = path.join(DATA, 'queue', 'held-comments.json');
  const prevHeld = fs.existsSync(HELD_PATH) ? read(HELD_PATH) : {};
  const cleared = new Set((prevHeld.cleared || []).map(String));
  const held = [];
  for (const [slug, { threads }] of Object.entries(byCase)) {
    const out = {};
    const ids = Object.keys(threads).slice(0, 40);
    const cDir = path.join(DATA, 'cases', slug);
    const names = buildNameSets(read(path.join(cDir, 'case.json')),
      fs.existsSync(path.join(cDir, 'days.json')) ? read(path.join(cDir, 'days.json')) : { days: [] });
    for (const nodeId of ids) {
      const t = threads[nodeId];
      try {
        const comments = await gh(`/repos/${REPO}/issues/${t.number}/comments?per_page=30`);
        const human = comments.filter(c => c.user && c.user.type !== 'Bot' && !/^(Live on the Board|Thanks —)/.test(c.body || ''));
        const shown = [];
        for (const c of human) {
          const body = redact((c.body || '').replace(/<[^>]+>/g, ''), 400);
          const mentioned = personMentions(body, names);
          const why = PII.some(re => re.test(body)) ? 'it looks like it contains contact or address details'
            : mentioned.length ? `it names a specific person (${mentioned.slice(0, 3).join(', ')})`
            : implicationReason(body);
          if (why && !cleared.has(String(c.id))) {
            // The body is stored because the reviewing session cannot read the GitHub API, and a
            // queue it cannot read is not a queue. It adds no exposure the public issue thread
            // does not already have, and nothing in data/queue/ is rendered onto the site.
            held.push({ kind: 'comment', case: slug, node: nodeId, issue: t.number, id: String(c.id),
              url: c.html_url || t.url, user: (c.user || {}).login || '?', ts: c.created_at,
              escalate: shouldEscalate(body), why, body: body.slice(0, 400) });
          } else {
            shown.push({ user: c.user.login, ts: c.created_at, body });
          }
        }
        out[nodeId] = {
          url: t.url,
          count: shown.length,
          held: human.length - shown.length,
          comments: shown.slice(-4),
        };
      } catch (e) { console.error('thread sync fail', nodeId, e.message); }
    }
    write(path.join(DATA, 'cases', slug, 'threads.json'), { synced: NOW, threads: out });
  }
  write(HELD_PATH, { synced: NOW, cleared: [...cleared], held, heldSeeds });
  if (held.length || heldSeeds.length) console.log('held ' + held.length + ' comment(s) and ' + heldSeeds.length + ' thread seed(s) for editor review');
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
// Two producers write these issues -- the composer's Worker and the GitHub issue templates --
// and they do not agree on headings. The reader accepts either rather than silently holding
// every Worker submission for review because it could not find the claim.
function firstField(body, ...labels) {
  for (const l of labels) { const v = field(body, l); if (v) return v; }
  return '';
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
  const labels = [['published', '2ea44f', 'Live on the Board'], ['question', '7a5cc4', 'A reader question for the board'], ['needs-review', 'e0a83d', 'Held for editor review'], ['rate-limited', 'aaaaaa', 'Over the daily post limit'], ['verdict-watch', 'e05d5d', 'Verdict-related alert'], ['red-lane', 'b03a3a', 'Needs operator approval']];
  for (const [name, color, description] of labels) {
    try { await gh(`/repos/${REPO}/labels`, { method: 'POST', body: { name, color, description } }); } catch (e) { /* exists */ }
  }
}
/* What a reader can put on a board.
 *
 * A theory asserts something. A question asserts nothing — it is the lowest bar to clearing
 * for someone who is following a case closely but has no thesis, and it is usually the more
 * useful contribution, because a question someone can answer with a filing turns into a fact.
 * Both run the same screening: a question can carry an accusation just as easily ("why was
 * <uncharged neighbour> never questioned"), so nothing is waved through for being interrogative.
 */
const SUBMISSION_KINDS = {
  theory: {
    label: 'theory',
    claimLabels: ['Your theory, in one sentence', 'In one sentence'],
    node: { type: 'rumor', status: 'unverified' },
    column: 1160,   // runs to 1160 + 240 + NW(210) = 1610
    published: (slug) => `Live on the Board: https://ourgavel.com/cases/${slug}/board/ — 👍 reactions on this issue count as corroboration, 👎 as dispute; this thread is the theory's discussion page. Sources are what move it from amber; if you have one, submit evidence.`,
  },
  question: {
    label: 'question',
    claimLabels: ['What do you want to know?', 'Your question', 'In one sentence'],
    node: { type: 'question', status: 'open' },
    // Theory nodes occupy 1160 and 1160+240, each NW=210 wide, so they run to 1610.
    // This was 1470, which put a question card straight through the second theory column --
    // a 140px overlap the moment a case had two theories and one question. Keep a gutter.
    column: 1680,
    published: (slug) => `Live on the Board: https://ourgavel.com/cases/${slug}/board/ — it sits in the reader zone as an open question. Anyone can answer it, and an answer backed by a filing or a report is what turns it into a card on the record side. This thread is where that discussion happens.`,
  },
};

async function ingestTheories() {
  if (!TOKEN) return;
  const qPath = path.join(DATA, 'queue', 'issues.json');
  if (!fs.existsSync(qPath)) return;
  const q = read(qPath).open || [];
  const kindOf = i => Object.values(SUBMISSION_KINDS).find(k => i.labels.includes(k.label));
  const pending = q.filter(i => kindOf(i) && !['published', 'needs-review', 'rate-limited', 'red-lane'].some(l => i.labels.includes(l)));
  if (!pending.length) return;
  await ensureLabels();
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  for (const iss of pending) {
    try {
      const KIND = kindOf(iss);
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
      const claim = firstField(iss.body, ...KIND.claimLabels);
      const reasoning = firstField(iss.body, 'Reasoning', 'What made you ask?', 'Comment');
      const falsify = KIND.label === 'theory' ? field(iss.body, 'What would disprove it?') : '';
      const all = [claim, reasoning, falsify].join('\n');
      const names = buildNameSets(CASE, days);
      const mentioned = personMentions(all, names);
      const pii = PII.some(re => re.test(all));
      // The name screen only catches proper nouns. "Her husband", "the neighbour", "P.C." and
      // "why was he never charged" all name somebody just as effectively, and all of them
      // cleared the name screen when this was tested against real text. See screen.js.
      const implied = implicationReason(all);
      if (!claim || claim.length > 220 || all.length > 3000 || pii || mentioned.length || implied) {
        await gh(`/repos/${REPO}/issues/${iss.number}/labels`, { method: 'POST', body: { labels: ['needs-review'] } });
        const why = pii ? 'it looks like it contains contact or address details' : mentioned.length ? `it discusses a specific person (${mentioned.slice(0, 3).join(', ')}) — posts about people always get human eyes first` : implied ? `it ${implied} — posts about people always get human eyes first, however they are phrased` : 'of length/format';
        await gh(`/repos/${REPO}/issues/${iss.number}/comments`, { method: 'POST', body: { body: `Thanks — holding this for editor review because ${why}. Usually under an hour.` } });
        continue;
      }
      // publish
      const cPath = path.join(dir, 'community.json');
      const C = fs.existsSync(cPath) ? read(cPath) : { nodes: [], edges: [] };
      if (C.nodes.some(n => n.issueNumber === iss.number)) continue;
      // Lay each kind out in its own column so the reader zone stays legible as it fills.
      const sameKind = C.nodes.filter(n => n.type === KIND.node.type).length;
      C.nodes.push({
        id: 'c-' + iss.number, ...KIND.node,
        x: KIND.column + (sameKind % 2) * 240, y: 80 + Math.floor(sameKind / 2) * 150,
        title: claim,
        body: reasoning + (falsify ? ' — What would disprove it: ' + falsify : ''),
        submittedBy: iss.user, issueNumber: iss.number, issue: iss.url,
        traction: { up: iss.reactions.up, down: iss.reactions.down },
        sources: [],
      });
      write(cPath, C);
      await gh(`/repos/${REPO}/issues/${iss.number}/labels`, { method: 'POST', body: { labels: ['published'] } });
      await gh(`/repos/${REPO}/issues/${iss.number}/comments`, { method: 'POST', body: { body: KIND.published(slug) } });
      console.log('published ' + KIND.label + ' #' + iss.number, 'to', slug);
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
  // Sweep files no case record points at any more. A photograph can be orphaned by a
  // download that succeeded while the case write failed, or by an entry an agent removed on
  // review — the archival 1905 street scene that got through on the first run was one. Left
  // alone they accumulate in the repo forever, and nothing else would ever notice them.
  try {
    const dir = path.join(DATA, 'media', slug);
    if (fs.existsSync(dir)) {
      const keep = new Set((CASE.media || []).map(m => m.local && path.posix.basename(m.local)).filter(Boolean));
      for (const f of fs.readdirSync(dir)) {
        if (f === 'README.md' || keep.has(f)) continue;
        fs.unlinkSync(path.join(dir, f));
        console.log('media - ' + slug + '/' + f + ' (no longer referenced)');
      }
    }
  } catch (e) { console.error('media sweep failed for', slug, e.message); }

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
  // FIRST, before anything writes to the tree. The applier requires a clean working copy —
  // it is the only way its revert path can be honest about what it undid — and the tree is
  // only clean at the very top of a pulse. Applying here also means a plan that lands is
  // built and deployed by this same run rather than waiting fifteen minutes for the next.
  try { await applyHandoffs({ gh, repo: REPO, log: console.log }); }
  catch (e) { console.error('applier failed (pulse continues):', e.message); }

  const cases = fs.readdirSync(path.join(DATA, 'cases')).filter(d => fs.existsSync(path.join(DATA, 'cases', d, 'case.json')));
  // One malformed case file used to kill the entire pulse on the first iteration — no feeds, no
  // verdict watch, no verdict publishing, for every other case too. That happened on 2026-08-22,
  // when a merge-conflict marker reached data/cases/alex-murdaugh-retrial/case.json: the pulse
  // crashed on JSON.parse before polling anything, and because the pulse is what rewrites these
  // files, it could not heal itself either. The verdict path is the last thing that should share
  // a fate with a caption. A broken case is now loud and isolated.
  const broken = [];
  for (const slug of cases) {
    try { await pollCase(slug); }
    catch (e) { broken.push(slug); console.error('CASE FAILED (skipped, pulse continues):', slug, e.message); }
  }
  for (const slug of cases) if (!broken.includes(slug)) await discoverMedia(slug);
  await syncIssues();
  await ingestTheories();
  console.log('pulse complete', NOW);
  // Deliberately exit 0 even when a case failed. The commit step runs after this one, so a
  // non-zero exit would throw away the data every HEALTHY case just polled — punishing four
  // cases for the fifth. Visibility comes from this file instead: it is committed, so the next
  // session reads the degradation on its first look rather than inferring it from silence.
  write(path.join(DATA, 'queue', 'health.json'), { checked: NOW, brokenCases: broken });
  if (broken.length) console.error('PULSE DEGRADED — broken case file(s): ' + broken.join(', '));
})();
