#!/usr/bin/env node
/* Tests for scripts/canonical.js and its wiring into the pulse.

   The defect this guards against was invisible for the same reason the SEO
   defects were: nothing ever looked. The ticker rendered, the links worked, and
   the page was quietly showing the same headline four times.

   Two halves, deliberately:
     MUST UNWRAP   redirector links resolve to the newsroom, duplicates collapse
     MUST NOT TOUCH ordinary links come back byte-identical
   The second half is the one that stops this turning into a URL mangler. */
'use strict';
const fs = require('fs');
const path = require('path');
const { resolveUrl, itemKey, dedupeItems, decodeEntities, isOffTopic, matchesCaseKeywords } = require('./canonical.js');

let pass = 0; const fails = [];
const eq = (got, want, label) => {
  if (got === want) pass++;
  else fails.push(label + '\n    got:  ' + got + '\n    want: ' + want);
};
const ok = (cond, label) => { if (cond) pass++; else fails.push(label); };

// ---- decodeEntities --------------------------------------------------------
eq(decodeEntities('a&amp;b'), 'a&b', 'decode &amp;');
eq(decodeEntities('a&amp;amp;b'), 'a&b', 'decode double-escaped &amp;amp;');
eq(decodeEntities('a&#38;b'), 'a&b', 'decode numeric &#38;');
eq(decodeEntities('plain'), 'plain', 'decode leaves plain text alone');

// ---- MUST UNWRAP -----------------------------------------------------------
const BING = 'http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=6a89866baa504d4b9ee20f4538fd9fd9&amp;url=https%3a%2f%2flamag.com%2fcrimeinla%2flil-durk-trial-underway%2f&amp;c=9789955331491922838&amp;mkt=en-us';
const BING2 = BING.replace('6a89866baa504d4b9ee20f4538fd9fd9', '6a897effa1d44a6cbf070068a5039c90');
eq(resolveUrl(BING), 'https://lamag.com/crimeinla/lil-durk-trial-underway/', 'bing redirector unwraps to the newsroom');
ok(!resolveUrl(BING).includes('bing.com'), 'reader is not sent through bing.com');
eq(itemKey(BING), itemKey(BING2), 'THE BUG: same article, rotated tid, same identity');
ok(itemKey(BING) !== itemKey(BING.replace('lil-durk-trial-underway', 'some-other-story')),
  'different articles keep different identities');
eq(resolveUrl('https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fa'), 'https://example.com/a',
  'facebook l.php unwraps');
eq(resolveUrl('https://example.com/a?utm_source=x&utm_medium=y'), 'https://example.com/a',
  'tracking params stripped, no dangling ?');
eq(resolveUrl('https://example.com/a?id=7&utm_source=x'), 'https://example.com/a?id=7',
  'tracking stripped, real params kept');
eq(resolveUrl('https://example.com/a#top'), 'https://example.com/a', 'fragment dropped');

// ---- MUST NOT TOUCH --------------------------------------------------------
for (const u of [
  'https://www.courttv.com/news/some-story/',
  'https://www.news4jax.com/news/local/2026/08/21/a-story/',
  'https://www.postandcourier.com/murdaugh/a-story/',
  'https://example.com/a?p=1234',
  'https://example.com/search?q=alex+murdaugh&page=2',
  'https://www.bing.com/news/search?q=murdaugh',
]) eq(resolveUrl(u), u, 'left untouched: ' + u);
eq(resolveUrl(''), '', 'empty string survives');
eq(resolveUrl('not a url'), 'not a url', 'garbage returned unchanged, never thrown');
eq(resolveUrl('javascript:alert(1)'), 'javascript:alert(1)',
  'non-http scheme is returned as-is, never rewritten into an href we vouch for');
ok(!resolveUrl('https://bing.com.evil.example/news/apiclick.aspx?url=https%3A%2F%2Fattacker.example')
  .startsWith('https://attacker.example'), 'look-alike host does not qualify as a redirector');

// ---- dedupeItems -----------------------------------------------------------
{
  const items = [
    { ts: '2026-08-21T11:05:00.000Z', url: BING, headline: 'A' },
    { ts: '2026-08-21T11:05:00.000Z', url: BING2, headline: 'A' },
    { ts: '2026-08-20T09:00:00.000Z', url: 'https://example.com/b', headline: 'B' },
  ];
  const out = dedupeItems(items);
  eq(out.length, 2, 'two copies of one article collapse to one');
  eq(out[0].ts, '2026-08-21T11:05:00.000Z', 'first occurrence wins, order preserved');
  eq(out[0].url, 'https://lamag.com/crimeinla/lil-durk-trial-underway/', 'stored url is healed to the newsroom');
  eq(JSON.stringify(dedupeItems(out)), JSON.stringify(out), 'dedupeItems is idempotent');
  eq(dedupeItems([]).length, 0, 'empty list survives');
  eq(dedupeItems(undefined).length, 0, 'missing list survives');
}

// ---- against the live record, not fixtures ---------------------------------
// Fixtures test imagination. This is the same discipline as verdict.live-check.js.
const CASES = path.join(__dirname, '..', 'data', 'cases');
for (const slug of fs.readdirSync(CASES)) {
  const p = path.join(CASES, slug, 'ticker.json');
  if (!fs.existsSync(p)) continue;
  const items = JSON.parse(fs.readFileSync(p, 'utf8')).items || [];
  const out = dedupeItems(items);
  const keys = new Set(out.map(i => itemKey(i.url)));
  eq(keys.size, out.length, slug + ': no duplicate identities survive deduping');
  ok(!out.some(i => /bing\.com\/news\/apiclick/i.test(i.url)),
    slug + ': no reader is left pointed at a click-tracker');
  ok(!out.some(i => /&amp;/i.test(i.url)),
    slug + ': no XML-escaped ampersand survives into an href');
  ok(out.every(i => /^https?:\/\//.test(i.url) || i.url === ''),
    slug + ': every healed url is still absolute');
  // The first eight rows are what a case page renders. They must be eight
  // different stories, which is the reader-visible symptom that started this.
  const top = out.slice(0, 8).map(i => itemKey(i.url));
  eq(new Set(top).size, top.length, slug + ': the eight rendered ticker rows are eight distinct stories');
}

// ---- isOffTopic (#22) ------------------------------------------------------
// A keyword doing double duty pulls a separate matter onto the record; excludeKeywords
// vetoes it. Behavioural, against the two live headlines this shipped for.
ok(isOffTopic("New molestation charges against Mario Fernandez-Saldana", ['molestation', 'new charges']),
  'isOffTopic: Fernandez separate-matter row is vetoed');
ok(isOffTopic("Attorney says new charges against Mario Fernandez have 'radically changed' the case", ['molestation', 'new charges']),
  'isOffTopic: Fernandez "new charges" row is vetoed');
ok(!isOffTopic("'Truth won today,' says Jared Bridegan's widow after Mario Fernandez convicted", ['molestation', 'new charges']),
  'isOffTopic: the verdict headline is NOT vetoed');
ok(isOffTopic("SLED charges 71-year-old man in Lexington parking lot assault", ['parking lot assault', 'orangeburg', 'anderson county']),
  'isOffTopic: Murdaugh unrelated-SLED blotter row is vetoed');
ok(!isOffTopic("Alex Murdaugh defense asks judge to move retrial to Richland County", ['parking lot assault', 'orangeburg', 'anderson county']),
  'isOffTopic: legitimate Murdaugh retrial coverage survives the veto');
ok(!isOffTopic("Anything at all", []) && !isOffTopic("Anything at all"),
  'isOffTopic: an empty or absent list vetoes nothing');
ok(!isOffTopic(null, ['x']) && !isOffTopic(undefined, ['x']),
  'isOffTopic: a missing headline never throws');
ok(isOffTopic("The ORANGEBURG story", ['orangeburg']) && isOffTopic("orangeburg", ['ORANGEBURG']),
  'isOffTopic: matching is case-insensitive both ways');
ok(!isOffTopic("a plain headline", ['', '   ']),
  'isOffTopic: blank keywords never match everything');

// ---- matchesCaseKeywords: geo keyword needs corroboration ------------------
// The live defect (community sweep 2026-08-30 14:41): a bare "duval county" match
// pulled a charity story onto Gardner's ticker. Behavioural, against the real headlines.
{
  const KW = ['shanna gardner', 'henry tenon', 'gardner bridegan', 'duval county'];
  const GEO = ['duval county'];
  ok(!matchesCaseKeywords(
    "'Two Dope Chicks Who Give A Care' organization pencils in year-round support for 4 Duval County schools", KW, GEO),
    'matchesCaseKeywords: THE BUG — a geo-only "duval county" charity row is NOT a case match');
  ok(matchesCaseKeywords(
    "Court filing gives window into new defense strategy for Shanna Gardner in Jared Bridegan murder trial", KW, GEO),
    'matchesCaseKeywords: a real Gardner headline still matches on the strong keyword');
  ok(matchesCaseKeywords("Shanna Gardner hearing set in Duval County court", KW, GEO),
    'matchesCaseKeywords: strong + geo together still matches (geo only ever corroborates)');
  ok(!matchesCaseKeywords("Duval County weather advisory issued", KW, GEO),
    'matchesCaseKeywords: another geo-only row is declined too, not just the one we scrubbed');
  // No geoKeywords → identical to the old keywords.some(includes); every other case is unchanged.
  ok(matchesCaseKeywords("Anything mentioning Duval County", KW, []),
    'matchesCaseKeywords: with no geoKeywords a keyword hit still matches (behaviour unchanged for other cases)');
  ok(matchesCaseKeywords("HENRY TENON change of plea", KW, GEO) && matchesCaseKeywords("henry tenon", ['Henry Tenon'], GEO),
    'matchesCaseKeywords: matching is case-insensitive both ways');
  ok(!matchesCaseKeywords("a plain headline", [], GEO) && !matchesCaseKeywords(null, KW, GEO) && !matchesCaseKeywords("x", ['', '  '], []),
    'matchesCaseKeywords: empty/blank keywords and a missing headline never match and never throw');
}

// The scrubbed row must be gone from the live record AND stay gone (ingest guard, not a patch).
{
  const gt = JSON.parse(fs.readFileSync(path.join(CASES, 'shanna-gardner', 'ticker.json'), 'utf8')).items || [];
  ok(!gt.some(i => /two dope chicks/i.test(i.headline)), 'Gardner ticker no longer carries the Duval-County charity row');
  const gcase = JSON.parse(fs.readFileSync(path.join(CASES, 'shanna-gardner', 'case.json'), 'utf8'));
  ok((gcase.geoKeywords || []).map(k => k.toLowerCase()).includes('duval county'),
    'Gardner declares "duval county" as a geoKeyword so re-ingest is blocked at the door');
  ok((gcase.keywords || []).map(k => k.toLowerCase()).includes('duval county'),
    'and "duval county" stays in keywords — it still corroborates a real Gardner row');
}

// ---- wiring ----------------------------------------------------------------
// Mutation-checked: reverting either line in poll.js fails these.
{
  const src = fs.readFileSync(path.join(__dirname, 'poll.js'), 'utf8');
  ok(/require\('\.\/canonical\.js'\)/.test(src), 'poll.js requires canonical.js');
  ok(/isOffTopic/.test(src), 'poll.js wires in the off-topic veto');
  ok(/matchesCaseKeywords\(it\.title, CASE\.keywords, CASE\.geoKeywords\)/.test(src),
    'poll.js gates ingest on matchesCaseKeywords with the case geoKeywords');
  ok(/excludeKeywords/.test(src), 'poll.js reads excludeKeywords from the case');
  ok(!/hash\(it\.link\)/.test(src), 'poll.js no longer hashes the raw feed link');
  ok(/hash\(itemKey\(/.test(src), 'poll.js hashes the article identity');
  ok(/url: url\b|url,/.test(src), 'poll.js stores the resolved url');
  ok(/T\.items = dedupeItems\(T\.items\)/.test(src), 'poll.js heals the stored list before polling');
  ok(/have\.has\(itemKey\(/.test(src), 'poll.js checks the durable stored list, not only the capped seen set');
}

console.log(fails.length
  ? 'canonical.test.js: ' + pass + ' passed, ' + fails.length + ' FAILED\n  - ' + fails.join('\n  - ')
  : 'canonical.test.js: ' + pass + ' assertions passed');
process.exit(fails.length ? 1 : 0);
