#!/usr/bin/env node
/* Checks the built site against the discoverability rules. Run after build.js:
 *   node scripts/build.js && node scripts/seo.test.js
 *
 * This file exists because two defects sat live for weeks and nothing noticed. Ten pages —
 * every witness index and every legal explainer — carried `<link rel="canonical">` pointing at
 * /cases/, because their page() call passed no canonical and the fallback used the nav path.
 * That is an instruction to Google to drop the URL. And og:url named the homepage on all 34
 * pages. Both are one missing argument, both are invisible in a browser, and both undo the
 * work of every page they touch.
 *
 * The other half is the markup-truth rule from AGENT.md: a page may only mark up claims it
 * visibly makes. Every FAQ question, witness name, verdict outcome and breadcrumb label below
 * is extracted from the JSON-LD and then looked for in the rendered text of the same page. A
 * block that claims something the reader cannot see fails here, which is the only way that
 * rule stays real.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public');
const SITE = 'https://ourgavel.com';

if (!fs.existsSync(OUT)) { console.log('\n  No public/ — run node scripts/build.js first.\n'); process.exit(1); }

let pass = 0, fail = 0;
const ok = (cond, label) => { cond ? pass++ : (fail++, console.log('  FAIL  ' + label)); };
const sha = s => "'sha256-" + crypto.createHash('sha256').update(s, 'utf8').digest('base64') + "'";

const pages = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    e.isDirectory() ? walk(p) : e.name.endsWith('.html') && pages.push(p);
  }
})(OUT);

// What a reader actually sees: scripts and styles gone, tags gone, entities decoded.
const textOf = h => h
  .replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');
const urlOf = p => '/' + path.relative(OUT, p).split(path.sep).join('/').replace(/index\.html$/, '');
const ldOf = h => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .map(m => { try { return JSON.parse(m[1].replace(/\\u003c/g, '<')); } catch (e) { return null; } })
  .filter(Boolean);

let ldBlocks = 0, breadcrumbs = 0, claims = 0;

console.log('\n--- Every page points at itself ---');
for (const p of pages) {
  const url = urlOf(p);
  const h = fs.readFileSync(p, 'utf8');
  // Embeds are deliberately excluded in robots.txt and carry no canonical of their own.
  if (url.includes('/board/embed/')) continue;
  const canon = (h.match(/<link rel="canonical" href="([^"]+)">/) || [])[1];
  ok(canon === SITE + url, `${url} canonical should be ${SITE}${url}, got ${canon}`);
  const og = (h.match(/<meta property="og:url" content="([^"]+)">/) || [])[1];
  ok(og === SITE + url, `${url} og:url should be ${SITE}${url}, got ${og}`);
}

console.log('--- Structured data parses, and is covered by the CSP ---');
for (const p of pages) {
  const url = urlOf(p);
  const h = fs.readFileSync(p, 'utf8');
  const csp = (h.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
  ok(!!csp, `${url} should carry a CSP`);
  for (const m of h.matchAll(/<script(?: type="application\/ld\+json")?>([\s\S]*?)<\/script>/g)) {
    ok(csp.includes(sha(m[1])), `${url} has an inline script the CSP does not hash`);
  }
  for (const m of h.matchAll(/<style>([\s\S]*?)<\/style>/g)) {
    ok(csp.includes(sha(m[1])), `${url} has an inline style the CSP does not hash`);
  }
  for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    ldBlocks++;
    try { JSON.parse(m[1].replace(/\\u003c/g, '<')); pass++; }
    catch (e) { fail++; console.log(`  FAIL  ${url} JSON-LD does not parse: ${e.message}`); }
  }
}

console.log('--- Nothing is marked up that the page does not say ---');
for (const p of pages) {
  const url = urlOf(p);
  const h = fs.readFileSync(p, 'utf8');
  const txt = textOf(h);
  for (const o of ldOf(h)) {
    if (o['@type'] === 'BreadcrumbList') {
      breadcrumbs++;
      for (const it of o.itemListElement) {
        claims++;
        ok(txt.includes(it.name), `${url} breadcrumb "${it.name}" is not in the rendered text`);
        ok(it.item.startsWith(SITE + '/'), `${url} breadcrumb item should be an absolute site URL, got ${it.item}`);
      }
    }
    if (o['@type'] === 'FAQPage') {
      for (const q of o.mainEntity) {
        claims += 2;
        ok(txt.includes(q.name), `${url} FAQ question is not on the page: ${q.name.slice(0, 60)}`);
        ok(txt.includes(q.acceptedAnswer.text), `${url} FAQ answer is not on the page: ${q.acceptedAnswer.text.slice(0, 60)}`);
      }
    }
    if (o['@type'] === 'ItemList' && Array.isArray(o.itemListElement)) {
      ok(o.itemListElement.length === (o.numberOfItems || o.itemListElement.length),
        `${url} ItemList numberOfItems disagrees with the list it carries`);
      for (const li of o.itemListElement) {
        // Two shapes in use: a ListItem wrapping a Person (witness index), and a bare
        // ListItem carrying its own name and description (verdict outcomes). Both are
        // claims about what the page says, so both are checked against the page.
        const nm = (li.item && li.item.name) || li.name;
        if (nm) { claims++; ok(txt.includes(nm), `${url} ItemList names "${nm}", which is not on the page`); }
        const ds = li.description;
        if (ds) { claims++; ok(txt.includes(ds), `${url} ItemList describes "${nm}" with text the page does not carry`); }
      }
    }
  }
}

console.log('--- Dates are read off the record, not off the clock ---');
for (const p of pages) {
  const url = urlOf(p);
  for (const o of ldOf(fs.readFileSync(p, 'utf8'))) {
    // A dateModified carrying a time-of-day is the build clock. The record is dated by day.
    if (o.dateModified) ok(/^\d{4}-\d\d-\d\d$/.test(o.dateModified),
      `${url} dateModified "${o.dateModified}" looks like a build timestamp, not a record date`);
  }
}

console.log('--- Every case page links to every other page of its case ---');
// The witness index and the legal explainer hold our most specific answers and were reachable
// from one sentence in the body of one other page. A page nothing links to is a page nobody
// crawls twice.
const caseDirs = fs.readdirSync(path.join(OUT, 'cases'), { withFileTypes: true })
  .filter(e => e.isDirectory()).map(e => e.name);
for (const slug of caseDirs) {
  const sub = ['', 'timeline/', 'witnesses/', 'board/'].concat(
    fs.existsSync(path.join(OUT, 'cases', slug, 'standard', 'index.html')) ? ['standard/'] : []);
  for (const from of sub) {
    const f = path.join(OUT, 'cases', slug, from, 'index.html');
    const h = fs.readFileSync(f, 'utf8');
    for (const to of sub) {
      if (to === from) continue;
      ok(h.includes(`href="/cases/${slug}/${to}"`),
        `/cases/${slug}/${from} does not link to /cases/${slug}/${to}`);
    }
  }
}

console.log('--- The sitemap describes pages that exist ---');
const sm = fs.readFileSync(path.join(OUT, 'sitemap.xml'), 'utf8');
const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
ok(locs.length > 0, 'sitemap should list some URLs');
for (const l of locs) {
  ok(fs.existsSync(path.join(OUT, l.replace(SITE, ''), 'index.html')), `sitemap lists ${l}, which does not build`);
  ok(l.startsWith(SITE + '/'), `sitemap URL should be absolute and on our host: ${l}`);
}
const mods = [...sm.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map(m => m[1]);
// Every date the same means the build stamped them, which is how a crawler learns to ignore
// lastmod entirely. Pages with nothing dated on them are expected to carry no lastmod at all.
ok(new Set(mods).size > 1 || mods.length === 0, 'lastmod dates should differ between pages, or be absent');
ok(mods.every(d => /^\d{4}-\d\d-\d\d$/.test(d)), 'every lastmod should be a plain date');
const robots = fs.readFileSync(path.join(OUT, 'robots.txt'), 'utf8');
ok(robots.includes('Sitemap: ' + SITE + '/sitemap.xml'), 'robots.txt should name the sitemap');
// The embed/board pair is de-duplicated by rel=canonical, not by robots.txt. Google:
// "Don't use the robots.txt file for canonicalization purposes." A disallowed URL can
// still be indexed without its content, and its canonical is never read — so blocking
// the embeds stranded both the canonical and every link an embed sends back to us.
ok(!robots.includes('Disallow: /*/board/embed/'), 'robots.txt should not block embeds - it strands their canonical');
for (const p of pages) {
  const u = urlOf(p);
  if (!u.includes('/board/embed/')) continue;
  const h = fs.readFileSync(p, 'utf8');
  const board = SITE + u.replace('embed/', '');
  const canon = (h.match(/<link rel="canonical" href="([^"]+)">/) || [])[1];
  ok(canon === board, `${u} should canonical to its board, got ${canon}`);
  ok(h.includes('href="' + board + '"'), `${u} should carry a link home to its board`);
}

console.log('--- The IndexNow key is served if it is configured ---');
const keyFile = path.join(ROOT, 'INDEXNOW_KEY');
if (fs.existsSync(keyFile)) {
  const k = fs.readFileSync(keyFile, 'utf8').trim();
  ok(/^[a-f0-9]{8,128}$/i.test(k), 'INDEXNOW_KEY should be hex, 8-128 chars');
  ok(fs.existsSync(path.join(OUT, k + '.txt')), `IndexNow key file /${k}.txt should be built`);
  ok(fs.readFileSync(path.join(OUT, k + '.txt'), 'utf8').trim() === k, 'the key file should contain the key');
}

console.log('--- Day pages: emitted, in the sitemap, and navigable ---');
// One indexable page per trial day with a named witness. The emitter and the sitemap read
// the same helper, so the count on the page tree and the count in the sitemap must agree -
// a mismatch means a day URL is orphaned in one place or the other.
const dayPages = pages.filter(p => /\/day\/\d+\/index\.html$/.test(p));
const daySitemap = locs.filter(l => /\/day\/\d+\/$/.test(l));
ok(dayPages.length === daySitemap.length,
  `day-page count (${dayPages.length}) should equal day URLs in the sitemap (${daySitemap.length})`);
ok(dayPages.length > 0, 'at least one day page should build from the record');
for (const p of dayPages) {
  const u = urlOf(p);
  const h = fs.readFileSync(p, 'utf8');
  const txt = textOf(h);
  // A day page must link back into the record and out to the witness index - it is a leaf,
  // and a leaf with no way back up the tree bleeds crawl equity.
  const slug = u.split('/')[2];
  ok(h.includes(`href="/cases/${slug}/timeline/"`), `${u} should link back to the record`);
  ok(h.includes(`href="/cases/${slug}/witnesses/"`), `${u} should link to the witness index`);
  // Its NewsArticle must be dated to the day, never the build clock.
  const na = ldOf(h).find(o => o['@type'] === 'NewsArticle');
  ok(na && /^\d{4}-\d\d-\d\d$/.test(na.datePublished || ''),
    `${u} NewsArticle should carry a plain record date, not a build timestamp`);
  // Every witness the ItemList names must be visible on the page.
  ok(txt.includes('Who testified') || !ldOf(h).some(o => o['@type'] === 'ItemList'),
    `${u} marks up witnesses but does not show them`);
}

console.log('--- No inline event attributes ---');
for (const p of pages) {
  const url = urlOf(p);
  const h = fs.readFileSync(p, 'utf8').replace(/<script[\s\S]*?<\/script>/g, ' ');
  ok(!/<[^>]+\son[a-z]+=/i.test(h), `${url} carries an inline event handler attribute`);
}

console.log(`\n  ${pages.length} pages · ${ldBlocks} JSON-LD blocks · ${breadcrumbs} breadcrumb trails · ${claims} marked-up strings checked against the page`);
console.log('  ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\n  DO NOT SHIP: a page is describing itself wrongly to search engines.\n'); process.exit(1); }
console.log('  Every page points at itself and claims only what it shows.\n');
