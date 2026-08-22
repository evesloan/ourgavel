/* Adversarial tests for the verdict engine.
 * Run: node scripts/verdict.test.js
 * These are the headlines that would destroy the site if published wrongly. Every one of
 * them is real-shaped: the phrasing newsrooms actually use while a jury is still out.
 * If this file does not exit 0, verdict publishing must not ship.
 */
const { classify, assess } = require('./verdict.js');

let pass = 0, fail = 0;
const ok = (cond, label) => { cond ? pass++ : (fail++, console.log('  FAIL  ' + label)); };

console.log('\n--- Gate 1: language. Must NOT read as a verdict ---');
const mustNotFire = [
  'Jury begins deliberating verdict in Lindsay Clancy trial',
  'Lindsay Clancy could be found guilty of first-degree murder',
  'If found guilty, Clancy faces life without parole',
  'Clancy faces guilty verdict as jury weighs her fate',
  'What happens if the jury finds her not guilty by reason of insanity',
  'Closing arguments expected before verdict',
  'Live updates: jury deliberations continue in murder trial',
  'Analysis: how a not guilty verdict would actually work',
  'Prosecutors say Duane Davis is guilty of murder',
  'Defense argues she was not criminally responsible',
  'Jury deadlocked? What a mistrial would mean for the case',
  'Judge instructs jurors ahead of deliberations',
  'Poll: do you think he will be found guilty?',
  'Trial preview: the case against Durk Banks',
  'Jury resumes deliberations for a third day',
  'Family braces for a guilty verdict',
  'Expert predicts he could be acquitted',
];
for (const h of mustNotFire) ok(classify(h) === null, 'fired on: ' + h + '  (got ' + classify(h) + ')');

console.log('--- Gate 1: language. MUST read as a verdict ---');
const mustFire = [
  ['Lindsay Clancy found not guilty by reason of insanity', 'NGRI'],
  ['Jury finds Duane Davis guilty of first-degree murder', 'GUILTY'],
  ['Mario Fernandez Saldana acquitted of all charges', 'NOT_GUILTY'],
  ['Judge declares a mistrial after hung jury', 'MISTRIAL'],
  ['Durk Banks convicted of murder-for-hire', 'GUILTY'],
  ['Clancy found not guilty on all counts', 'NOT_GUILTY'],
  ['Jury found her not criminally responsible', 'NGRI'],
];
for (const [h, want] of mustFire) ok(classify(h) === want, 'want ' + want + ', got ' + classify(h) + ': ' + h);

const now = Date.parse('2026-08-22T12:00:00Z');
const at = (mins, outlet, headline) =>
  ({ ts: new Date(now - mins * 60000).toISOString(), outlet, headline, url: 'https://x/' + Math.random() });

console.log('--- Gate 2: consensus ---');
ok(assess([], now).status === 'none', 'empty feed should be none');

ok(assess([at(10, 'Court TV', 'Jury finds Duane Davis guilty of murder')], now).status === 'watch',
   'one outlet alone must not be ready');

ok(assess([
  at(10, 'Court TV', 'Jury finds Davis guilty of murder'),
  at(9, 'Court TV', 'Davis convicted of first-degree murder'),
  at(8, 'CourtTV.com', 'Guilty verdict for Davis'),
], now).status === 'watch', 'one newsroom filing three times is still one source');

ok(assess([
  at(10, 'Bing News', 'Jury finds Davis guilty'),
  at(9, 'Google News', 'Davis convicted'),
  at(8, 'News Search', 'Guilty verdict'),
], now).status === 'none', 'aggregators must never count as sources');

const consensus = [
  at(10, 'Court TV', 'Jury finds Duane Davis guilty of first-degree murder'),
  at(9, 'AP', 'Davis convicted of murder in Tupac Shakur killing'),
  at(8, '8 News Now', 'Guilty verdict returned in Tupac murder trial'),
];
ok(assess(consensus, now).status === 'ready', 'three independent newsrooms should be ready');
ok(assess(consensus, now).outcome === 'GUILTY', 'consensus outcome should be GUILTY');

console.log('--- Gate 2: disagreement stops everything ---');
const split = consensus.concat([at(7, 'NBC', 'Jury acquits Davis on all counts')]);
ok(assess(split, now).status === 'conflict', 'contradicting outlets must produce conflict, never publish');

console.log('--- Window ---');
ok(assess(consensus.map(i => ({ ...i, ts: new Date(now - 40 * 3600 * 1000).toISOString() })), now).status === 'none',
   'reports older than the window must not trigger');

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\n  VERDICT PUBLISHING MUST NOT SHIP WITH FAILING TESTS.\n'); process.exit(1); }
console.log('  Engine safe to ship.\n');
