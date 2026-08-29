/* Adversarial tests for the verdict engine.
 * Run: node scripts/verdict.test.js
 * These are the headlines that would destroy the site if published wrongly. Every one of
 * them is real-shaped: the phrasing newsrooms actually use while a jury is still out.
 * If this file does not exit 0, verdict publishing must not ship.
 */
const { classify, assess, copyKey } = require('./verdict.js');

let pass = 0, fail = 0;
const ok = (cond, label) => { cond ? pass++ : (fail++, console.log('  FAIL  ' + label)); };

console.log('\n--- Gate 1: language. Must NOT read as a verdict ---');
const mustNotFire = [
  // the risky shapes of 'convicted in' — each caught by an existing guard, not by luck
  'Smith was convicted in 2019 of fraud',
  'Fernandez convicted in first trial, retrial ordered',
  'Man convicted in 1994 killing exonerated after appeal',
  'Man could be convicted in the killing, experts say',
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
  // AP wire phrasing — under-detected until the Fernandez verdict (2026-08-26): six families
  // reported a real conviction, one classified. 'convicted in' must fire when it is not
  // year-dated, historical, or hypothetical (those stay in mustNotFire below).
  ["Suspect in Microsoft executive Jared Bridegan's murder convicted in roadside ambush", 'GUILTY'],
  ['Man convicted in murder-for-hire killing of Microsoft manager on Florida road', 'GUILTY'],
];
for (const [h, want] of mustFire) ok(classify(h) === want, 'want ' + want + ', got ' + classify(h) + ': ' + h);

const now = Date.parse('2026-08-22T12:00:00Z');
const at = (mins, outlet, headline) =>
  ({ ts: new Date(now - mins * 60000).toISOString(), outlet, headline, url: 'https://x/' + Math.random() });

console.log('--- Gate 1b: retrial coverage of a VACATED verdict must never publish ---');
// Found by running the classifier over real Murdaugh coverage: retrospectives about the
// overturned 2023 conviction read exactly like a fresh one. Three newsrooms running the
// same retrospective would have reached "consensus" on a verdict that has not happened.
const historical = [
  'Alex Murdaugh was convicted of murdering his wife and son in 2023',
  'Murdaugh found guilty in 2023; conviction thrown out in 2026',
  'Why the South Carolina Supreme Court vacated the guilty verdict',
  'Murdaugh retrial: how the first jury found him guilty',
  'Appeals court reverses guilty verdict',
  'Retrial set after conviction overturned',
  'Davis was convicted in 2009 after a lengthy trial',
];
for (const h of historical) ok(classify(h) === null, 'read a past verdict as current: ' + h);

console.log('--- and a real verdict citing the CRIME year must still publish ---');
const withCrimeYear = [
  ['Jury finds Duane Davis guilty in the 1996 killing of Tupac Shakur', 'GUILTY'],
  ['Fernandez convicted of murder in the 2022 Bridegan shooting', 'GUILTY'],
  ['Jury finds Alex Murdaugh guilty at retrial', 'GUILTY'],
  ['Murdaugh acquitted at retrial', 'NOT_GUILTY'],
];
for (const [h, want] of withCrimeYear) ok(classify(h) === want, 'want ' + want + ', got ' + classify(h) + ': ' + h);

console.log('--- Gate 1c: split / partial verdicts must HOLD (never a single outcome) ---');
// The Clancy failure mode, found by running the classifier over realistic verdict-day phrasings:
// a five-option jury can acquit on the top charge and convict on a lesser one, and outlets write
// that as ONE headline. classify() tested NOT_GUILTY before GUILTY, so it returned NOT_GUILTY —
// three newsrooms phrasing a real manslaughter conviction that way would have published a FALSE
// ACQUITTAL. A headline asserting both an acquittal and a conviction is ambiguous by construction
// and must classify as null so the engine holds for a human.
const splitVerdicts = [
  'Lindsay Clancy found not guilty of first-degree murder, guilty of manslaughter',
  'Clancy acquitted of first-degree murder but convicted of manslaughter',
  'Jury finds Clancy not guilty of murder, guilty on lesser charge',
  'Clancy cleared of first-degree murder; convicted of involuntary manslaughter',
  'Guilty of manslaughter, not guilty of first-degree murder: the Clancy verdict',
  'Jury acquits Davis of murder but convicts him of a lesser count',
];
for (const h of splitVerdicts) ok(classify(h) === null, 'split verdict must hold, got ' + classify(h) + ': ' + h);

console.log('--- and a CLEAN single-outcome verdict must still pass the split guard ---');
// The guard is subtractive: it must never turn a real one-outcome verdict into a hold.
const cleanThroughSplitGuard = [
  ['Lindsay Clancy found not guilty by reason of insanity', 'NGRI'],
  ['Clancy found not guilty on all counts', 'NOT_GUILTY'],
  ['Mario Fernandez Saldana acquitted of all charges', 'NOT_GUILTY'],
  ['Jury found her not criminally responsible', 'NGRI'],
  ['Lindsay Clancy convicted of manslaughter in deaths of her three children', 'GUILTY'],
  ['Jury finds Lindsay Clancy guilty of second-degree murder', 'GUILTY'],
  ['Durk Banks convicted of murder-for-hire', 'GUILTY'],
];
for (const [h, want] of cleanThroughSplitGuard) ok(classify(h) === want, 'split guard ate a clean verdict, want ' + want + ' got ' + classify(h) + ': ' + h);

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

console.log('--- Gate 2d: three newsrooms all running a SPLIT verdict must never publish ---');
// The end-to-end guarantee: even a full consensus of split-verdict headlines yields nothing to
// publish, so the engine holds and a human resolves the partial verdict.
ok(assess([
  at(10, 'Court TV', 'Clancy found not guilty of first-degree murder, guilty of manslaughter'),
  at(9, 'AP', 'Clancy acquitted of murder but convicted of manslaughter'),
  at(8, 'Boston Globe', 'Clancy cleared of first-degree murder, found guilty of manslaughter'),
], now).status === 'none', 'a consensus of split-verdict headlines must publish nothing');

console.log('--- Window ---');
ok(assess(consensus.map(i => ({ ...i, ts: new Date(now - 40 * 3600 * 1000).toISOString() })), now).status === 'none',
   'reports older than the window must not trigger');

console.log('--- Gate 2b: attribution comes from the RESOLVED HOST, not the feed label ---');
// Every case below is drawn from live ticker data on 2026-08-22. Before this gate existed,
// the first three of them were thrown away and the fourth would have published a verdict.
const url = (h, p) => 'https://www.' + h + '/' + (p || 'story');
const it = (mins, label, headline, u) =>
  ({ ts: new Date(now - mins * 60000).toISOString(), outlet: label, headline, url: u });

// Discovered through a Bing feed, but these are real newsrooms and must count.
ok(assess([
  it(10, 'Bing News — Murdaugh retrial', 'Jury finds Alex Murdaugh guilty at retrial', url('apnews.com', 'a')),
  it(9, 'Bing News — Murdaugh retrial', 'Murdaugh convicted of murder at retrial', url('postandcourier.com', 'b')),
  it(8, 'Bing News — Murdaugh retrial', 'Guilty verdict returned against Murdaugh on both counts', url('wistv.com', 'c')),
], now).status === 'ready', 'real newsrooms behind an aggregator label must count');

// Same three items, but the feed label is all we look at: the old behaviour, now a bug.
ok(assess([
  it(10, 'Bing News — Murdaugh retrial', 'Jury finds Alex Murdaugh guilty at retrial'),
  it(9, 'Bing News — Murdaugh retrial', 'Murdaugh convicted of murder at retrial'),
  it(8, 'Bing News — Murdaugh retrial', 'Guilty verdict returned against Murdaugh on both counts'),
], now).status === 'none', 'with no URL an aggregator label is still worth nothing');

// Syndicated reposts. The host is the evidence; the label claims a newsroom and is lying.
ok(assess([
  it(10, 'Court TV', 'Jury finds Alex Murdaugh guilty at retrial', url('msn.com', 'x/ar-AA1')),
  it(9, 'Law & Crime', 'Murdaugh convicted of murder at retrial', url('yahoo.com', 'news/y')),
  it(8, 'AP', 'Guilty verdict returned against Murdaugh on both counts', url('msn.com', 'z/ar-AA2')),
], now).status === 'none', 'reposts must not count however respectable the feed label is');

// One newsroom, three of its own domains.
ok(assess([
  it(10, 'Boston Globe', 'Lindsay Clancy found not guilty by reason of insanity', url('bostonglobe.com', 'a')),
  it(9, 'Boston.com', 'Clancy found not guilty by reason of lack of criminal responsibility', url('boston.com', 'b')),
], now).status === 'watch', 'the Globe and Boston.com are one newsroom');

console.log('--- Gate 2c: one wire story on many mastheads is one story ---');
const wire = 'Jury finds Alex Murdaugh guilty of murdering his wife and son at retrial';
ok(assess([
  it(10, 'WLTX News19', wire, url('wltx.com', 'a')),
  it(9, '10TV', wire, url('10tv.com', 'b')),
  it(8, 'KRCR', wire, url('krcrtv.com', 'c')),
], now).status === 'watch', 'three affiliates running identical copy is one source, not three');

// The masthead affiliates append must not defeat it.
ok(assess([
  it(10, 'WLTX News19', wire + ' | WLTX News19', url('wltx.com', 'a')),
  it(9, '10TV', wire + ' - 10TV', url('10tv.com', 'b')),
  it(8, 'KRCR', wire + ' \u2014 KRCR News', url('krcrtv.com', 'c')),
], now).status === 'watch', 'a trailing masthead must not make one story look like three');

// A FOURTH masthead must not slip past a check that already short-circuited on family.
ok(assess([
  it(11, 'WLTX News19', wire, url('wltx.com', 'a')),
  it(10, 'WLTX News19', wire, url('wltx.com', 'a2')),
  it(9, '10TV', wire, url('10tv.com', 'b')),
  it(8, 'KRCR', wire, url('krcrtv.com', 'c')),
], now).status === 'watch', 'a repeated family first must not let later copies through');

// But genuinely separate local reporting from the same owner group must still count.
ok(assess([
  it(10, 'WLTX News19', 'Jury finds Alex Murdaugh guilty at retrial', url('wltx.com', 'a')),
  it(9, '10TV', 'Murdaugh convicted on both murder counts, jury foreman says', url('10tv.com', 'b')),
  it(8, 'KRCR', 'Murdaugh found guilty on both murder counts', url('krcrtv.com', 'c')),
], now).status === 'ready', 'different copy from different newsrooms must still reach consensus');

// Short headlines two newsrooms could plausibly reach alone are NOT treated as one copy.
ok(copyKey('Guilty verdict returned') === '', 'a three-word headline is not a copy fingerprint');
ok(copyKey(wire) !== '', 'a full sentence is a copy fingerprint');

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\n  VERDICT PUBLISHING MUST NOT SHIP WITH FAILING TESTS.\n'); process.exit(1); }
console.log('  Engine safe to ship.\n');
