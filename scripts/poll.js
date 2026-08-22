#!/usr/bin/env node
/* GavelBoard 15-minute pulse. Runs in GitHub Actions (unrestricted egress).
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
const REPO = process.env.GB_REPO || 'evesloan/gavelboard';
const TOKEN = process.env.GITHUB_TOKEN || '';
const NOW = new Date().toISOString();

const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n'); };
const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return (h >>> 0).toString(36); };

async function get(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'GavelBoardBot/1.0 (+https://gavelboard.com)', ...(opts.headers || {}) } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}
async function gh(pathname, opts = {}) {
  const r = await fetch('https://api.github.com' + pathname, {
    method: opts.method || 'GET',
    headers: { 'authorization': 'Bearer ' + TOKEN, 'accept': 'application/vnd.github+json', 'user-agent': 'GavelBoardBot/1.0', ...(opts.body ? { 'content-type': 'application/json' } : {}) },
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
      number: i.number, title: i.title, body: (i.body || '').slice(0, 4000),
      labels: i.labels.map(l => typeof l === 'string' ? l : l.name),
      user: i.user && i.user.login, created: i.created_at,
      reactions: { up: (i.reactions && i.reactions['+1']) || 0, down: (i.reactions && i.reactions['-1']) || 0 },
      url: i.html_url,
    }));
    write(path.join(DATA, 'queue', 'issues.json'), { synced: NOW, open: q });
    console.log('issue queue:', q.length, 'open');
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

(async () => {
  const cases = fs.readdirSync(path.join(DATA, 'cases')).filter(d => fs.existsSync(path.join(DATA, 'cases', d, 'case.json')));
  for (const slug of cases) await pollCase(slug);
  await syncIssues();
  console.log('pulse complete', NOW);
})();
