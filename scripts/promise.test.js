#!/usr/bin/env node
/* OurGavel — the /about/ page must describe the site we actually run.
 *
 * /about/ is the page whose whole job is to state, accurately, how this site works. It is also
 * the page nobody re-reads when the machinery under it changes — so its claims drift away from
 * the code silently. This suite pins every factual claim on the page to the source of truth it
 * describes: MIN_OUTLETS out of verdict.js, the autonomy and promotion language out of
 * EDITORIAL.md, and the source counts off the real board.json files. If the page and the code
 * disagree, the page loses and this test goes red.
 *
 * It reads the sources of truth rather than restating them, and — because a test that cannot
 * see is worse than no test — it PROBES that it can still see each source before asserting
 * anything against it. A probe firing is a bug in the test, not a pass.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const READER_TYPES = new Set(['theory', 'question', 'invite', 'poll', 'mascot']);

let failed = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failed++; console.log('  FAIL: ' + msg); } };
const die = m => { console.error('PROBE FAILED (the test cannot see what it judges): ' + m); process.exit(2); };

// --- sources of truth ---------------------------------------------------------------------
const MIN_OUTLETS = require(path.join(ROOT, 'scripts', 'verdict.js')).MIN_OUTLETS;
const editorial = fs.readFileSync(path.join(ROOT, 'EDITORIAL.md'), 'utf8').replace(/\s+/g, ' ');
const NUM = { 2: 'two', 3: 'three', 4: 'four', 5: 'five' };

// --- self-check probes: refuse to run blind -----------------------------------------------
if (!(Number.isInteger(MIN_OUTLETS) && MIN_OUTLETS >= 2)) die('MIN_OUTLETS is not a usable integer: ' + MIN_OUTLETS);
if (!NUM[MIN_OUTLETS]) die('no spelled-out form on file for MIN_OUTLETS=' + MIN_OUTLETS);
if (!/published autonomously/i.test(editorial)) die('EDITORIAL.md §3b autonomy phrase not found — cannot check the page against it');
if (!/two or more independent/i.test(editorial)) die('EDITORIAL.md §4 promotion phrase not found — cannot check the page against it');

// record-lane board cards, read off the real data
const cases = fs.readdirSync(path.join(ROOT, 'data', 'cases'));
let recordCards = 0;
const recordNoSource = [];
for (const c of cases) {
  const bp = path.join(ROOT, 'data', 'cases', c, 'board.json');
  if (!fs.existsSync(bp)) continue;
  const d = JSON.parse(fs.readFileSync(bp, 'utf8'));
  const nodes = d.nodes || d || [];
  for (const n of nodes) {
    if (READER_TYPES.has(n.type)) continue;
    recordCards++;
    if (!((n.sources || []).length > 0)) recordNoSource.push(c + '/' + n.id);
  }
}
if (recordCards < 20) die('found only ' + recordCards + ' record cards — board data missing, cannot judge the source claim');

// render the About page from the real build
execFileSync(process.execPath, ['scripts/build.js'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
const aboutPath = path.join(ROOT, 'public', 'about', 'index.html');
if (!fs.existsSync(aboutPath)) die('build did not produce public/about/index.html');
const about = fs.readFileSync(aboutPath, 'utf8');
const aboutText = about.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
if (!/verdict/i.test(aboutText)) die('About page rendered but has no verdict language — wrong page or empty render');

// --- the claims the page makes must match the code ----------------------------------------

// 1. Verdict threshold, in words, equals MIN_OUTLETS.
ok(new RegExp(NUM[MIN_OUTLETS] + '\\s+independent newsrooms', 'i').test(aboutText),
  'the page does not say "' + NUM[MIN_OUTLETS] + ' independent newsrooms" (MIN_OUTLETS=' + MIN_OUTLETS + ')');
for (const [n, w] of Object.entries(NUM)) {
  if (Number(n) === MIN_OUTLETS) continue;
  ok(!new RegExp('verdict[^.]{0,80}' + w + ' independent newsrooms', 'i').test(aboutText),
    'the page states a verdict threshold of "' + w + '" but MIN_OUTLETS is ' + MIN_OUTLETS);
}
ok(!/wait for two\b/i.test(aboutText), 'the page still says "wait for two" — verdicts wait for ' + MIN_OUTLETS);

// 2. No false human-sign-off claim — verdicts publish autonomously (EDITORIAL §3b).
ok(!/signs off before this site states a verdict/i.test(aboutText),
  'the page claims a person signs off on verdicts, which EDITORIAL.md §3b removed');
ok(/without a person in the loop/i.test(aboutText),
  'the page does not positively disclose that verdicts publish without a person in the loop');

// 3. No blanket "single source, ever" absolute (false against §1/§4, which this build satisfies).
ok(!/single source, ever/i.test(aboutText),
  'the page keeps the "single source, ever" absolute, false against EDITORIAL.md §1/§4');

// 4. The source claim the page makes is true of the record: every record card carries a source.
ok(recordNoSource.length === 0,
  'record cards with NO source exist, so any "every line is sourced" claim is false: ' + recordNoSource.slice(0, 6).join(', '));

console.log((failed ? '  ' : '') + 'promise.test.js — ' + checks + ' checks, ' + failed + ' failed'
  + '  (MIN_OUTLETS=' + MIN_OUTLETS + ', ' + recordCards + ' record cards all sourced)');
process.exit(failed ? 1 : 0);
