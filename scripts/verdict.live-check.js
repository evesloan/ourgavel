#!/usr/bin/env node
/* Runs the verdict classifier over every REAL headline currently in the tickers.
 *
 * The unit tests use headlines I wrote, which means they test my imagination. This tests
 * the engine against what newsrooms actually published about live trials — the phrasing
 * that will decide whether the site publishes a verdict about a real person.
 *
 * Any hit here on a case that has NOT reached verdict is a false positive and must be
 * treated as a defect, not a curiosity. Run: node scripts/verdict.live-check.js
 */
const fs = require('fs');
const path = require('path');
const { classify, assess, outletFamily, MIN_OUTLETS } = require('./verdict.js');

const DATA = path.join(__dirname, '..', 'data', 'cases');
let total = 0, hits = 0, cases = 0, problems = 0;

for (const slug of fs.readdirSync(DATA).sort()) {
  const casePath = path.join(DATA, slug, 'case.json');
  const tickerPath = path.join(DATA, slug, 'ticker.json');
  if (!fs.existsSync(casePath) || !fs.existsSync(tickerPath)) continue;
  const CASE = JSON.parse(fs.readFileSync(casePath, 'utf8'));
  const items = JSON.parse(fs.readFileSync(tickerPath, 'utf8')).items || [];
  cases++;
  total += items.length;

  const fired = items.map(i => ({ i, tag: classify(i.headline) })).filter(x => x.tag);
  hits += fired.length;
  const verdictAlready = !!CASE.verdict;
  const a = assess(items);

  console.log('\n' + slug + '  (' + items.length + ' real headlines, verdict on file: ' + (verdictAlready ? 'YES' : 'no') + ')');
  console.log('  assess(): ' + a.status + (a.outcome ? '  outcome=' + a.outcome : '') +
    (a.outlets ? '  newsrooms=' + a.outlets.length + '/' + MIN_OUTLETS + ' [' + a.outlets.join(', ') + ']' : ''));

  if (!fired.length) {
    console.log('  no headline read as a verdict — correct for a trial still running');
  } else {
    for (const { i, tag } of fired) {
      const fam = outletFamily(i.url, i.outlet);
      console.log('  FIRED [' + tag + '] ' + (fam || 'UNATTRIBUTABLE') + ': ' + i.headline.slice(0, 96));
    }
    if (!verdictAlready) {
      problems++;
      console.log('  ^^ REVIEW THESE. If any is not a real, returned verdict, the classifier is too loose.');
    }
  }
  if (a.status === 'ready' && !verdictAlready) {
    problems++;
    console.log('  ** WOULD PUBLISH ON THE NEXT PULSE — confirm this case has genuinely reached verdict. **');
  }
}

console.log('\n' + '-'.repeat(70));
console.log(cases + ' cases, ' + total + ' real headlines scanned, ' + hits + ' read as a verdict.');
console.log(problems
  ? '\n  ' + problems + ' item(s) need a human eye before the next pulse.\n'
  : '\n  Clean: no live trial is misread as decided.\n');
process.exit(problems ? 1 : 0);
