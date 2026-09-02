/* Adversarial tests for the below-threshold WATCH escalation.
 * Run: node scripts/verdict-escalation.test.js
 *
 * The bug this guards: a real verdict that only ever reaches 2 of the 3 required independent
 * newsroom families inside the 12h window makes assess() return 'watch' on every pulse, and the
 * pulse used to swallow that silently — no publish (right) and no alert (wrong). That is exactly
 * how the flagship Tupac/Davis GUILTY verdict went unhandled. watchWarrantsEscalation(v) is the
 * pure predicate that says "this watch is strong enough to raise a hand"; poll.js turns a true here
 * into a red-lane verdict-watch issue and NOTHING else — it never publishes and never sets a verdict.
 *
 * Every fixture below is SYNTHETIC and self-contained. This suite deliberately does NOT read any
 * live ticker.json: the pulse rewrites those files every 15 minutes, so a test coupled to live data
 * is racy against the applier and could pass at build time and fail at apply time. Pure fixtures
 * assert the mechanism, not today's news.
 */
const { assess, watchWarrantsEscalation, WATCH_ESCALATE_MIN, MIN_OUTLETS, defendantTokens } = require('./verdict.js');

let pass = 0, fail = 0;
const ok = (cond, label) => { cond ? pass++ : (fail++, console.log('  FAIL  ' + label)); };

const now = Date.parse('2026-09-02T12:00:00Z');
// Same item shape verdict.test.js uses: a real-looking URL (unknown host falls back to the label
// for family resolution) plus the outlet label that decides the newsroom family.
const at = (mins, outlet, headline) =>
  ({ ts: new Date(now - mins * 60000).toISOString(), outlet, headline, url: 'https://x/' + Math.random() });

console.log('\n--- The predicate itself: only a one-sided watch of >= WATCH_ESCALATE_MIN families ---');
ok(WATCH_ESCALATE_MIN === 2, 'escalation bar is 2 independent families (below the ' + MIN_OUTLETS + ' publish bar)');
ok(watchWarrantsEscalation({ status: 'watch', outcome: 'GUILTY', outlets: ['courttv', 'ap'] }) === true,
   '2-family one-sided watch escalates');
ok(watchWarrantsEscalation({ status: 'watch', outcome: 'GUILTY', outlets: ['courttv', 'ap', 'npr'] }) === true,
   '3+ families in a watch object still escalate (status-gated, not count-capped)');
ok(watchWarrantsEscalation({ status: 'watch', outcome: 'GUILTY', outlets: ['courttv'] }) === false,
   'a lone-family watch does NOT escalate');
ok(watchWarrantsEscalation({ status: 'ready', outcome: 'GUILTY', outlets: ['a', 'b', 'c'] }) === false,
   'a READY consensus is not a watch — it publishes, it does not escalate as a watch');
ok(watchWarrantsEscalation({ status: 'conflict', outcome: 'GUILTY', outlets: ['a', 'b'] }) === false,
   'a CONFLICT is owned by the conflict path, not the watch path');
ok(watchWarrantsEscalation({ status: 'split', outlets: ['a', 'b'] }) === false,
   'a SPLIT is owned by the split path, not the watch path');
ok(watchWarrantsEscalation({ status: 'none' }) === false, 'nothing to see does not escalate');
ok(watchWarrantsEscalation({ status: 'watch', outcome: null, outlets: ['a', 'b'] }) === false,
   'a watch with no outcome does not escalate');
ok(watchWarrantsEscalation({ status: 'watch', outcome: 'GUILTY' }) === false,
   'a malformed watch with no outlets array does not escalate');
ok(watchWarrantsEscalation(null) === false && watchWarrantsEscalation(undefined) === false,
   'null / undefined never throw and never escalate');

console.log('--- End to end through assess(): the shapes the engine actually produces ---');

// THE TUPAC SHAPE: two independent families assert GUILTY inside the window, nobody disagrees, but
// it is one family short of the publish bar. assess() must return 'watch', and it must escalate.
const twoFamilyGuilty = [
  at(120, 'Court TV', 'Jury finds Duane Davis guilty of first-degree murder'),
  at(90, 'AP', 'Duane Davis convicted of murder in the 1996 killing of Tupac Shakur'),
];
let v = assess(twoFamilyGuilty, now);
ok(v.status === 'watch', 'two independent families, one outcome, no rival -> watch');
ok(v.outcome === 'GUILTY', 'and the outcome is carried through');
ok(watchWarrantsEscalation(v) === true, 'the two-family GUILTY watch ESCALATES (this is the Tupac miss)');

// One family only -> below the escalation bar too. A single stray "guilty" headline is noise.
const oneFamilyGuilty = [at(60, 'Court TV', 'Jury finds Duane Davis guilty of first-degree murder')];
v = assess(oneFamilyGuilty, now);
ok(v.status === 'watch' && watchWarrantsEscalation(v) === false, 'a one-family watch does NOT escalate');

// One wire story reprinted on two mastheads of the SAME family is still one family: must not inflate
// its way over the escalation bar.
const oneFamilyTwoMastheads = [
  at(120, 'AP', 'Duane Davis convicted of murder in the 1996 killing of Tupac Shakur'),
  at(90, 'AP', 'Duane Davis convicted of murder in the 1996 killing of Tupac Shakur'),
];
v = assess(oneFamilyTwoMastheads, now);
ok(watchWarrantsEscalation(v) === false, 'two mastheads of one family do not clear the escalation bar');

// The SAME wire headline on two DIFFERENT families is one story (copy dedupe) — also must not escalate.
const sameCopyTwoFamilies = [
  at(120, 'Court TV', 'Duane Davis convicted of murder in the 1996 killing of Tupac Shakur'),
  at(90, 'AP', 'Duane Davis convicted of murder in the 1996 killing of Tupac Shakur'),
];
v = assess(sameCopyTwoFamilies, now);
ok(watchWarrantsEscalation(v) === false, 'one wire copy across two families is one story, does not escalate');

// THREE independent families -> READY, publishes on the settling cycle. Never an escalation.
const threeFamilyGuilty = [
  at(120, 'Court TV', 'Jury finds Duane Davis guilty of first-degree murder'),
  at(90, 'AP', 'Duane Davis convicted of murder in the 1996 killing of Tupac Shakur'),
  at(60, 'NPR', 'Duane Davis found guilty of first-degree murder in Tupac Shakur trial'),
];
v = assess(threeFamilyGuilty, now);
ok(v.status === 'ready', 'three independent families -> ready (publishable)');
ok(watchWarrantsEscalation(v) === false, 'a ready consensus never routes through the watch escalation');

// A real DISAGREEMENT (2 guilty, 1 acquittal) is a CONFLICT, owned by the conflict path.
const conflicting = [
  at(120, 'Court TV', 'Jury finds Duane Davis guilty of first-degree murder'),
  at(100, 'AP', 'Duane Davis convicted of murder in the 1996 killing of Tupac Shakur'),
  at(80, 'Reuters', 'Duane Davis acquitted of all charges in Tupac Shakur murder trial'),
];
v = assess(conflicting, now);
ok(v.status === 'conflict', 'credentialed disagreement -> conflict');
ok(watchWarrantsEscalation(v) === false, 'a conflict does not double-escalate through the watch path');

// A DECIDED SPLIT by two families is the split path, not the watch path.
const split = [
  at(120, 'Court TV', 'Davis found not guilty of first-degree murder, guilty of a lesser count'),
  at(90, 'AP', 'Davis acquitted of murder but convicted of a lesser charge'),
];
v = assess(split, now);
ok(v.status === 'split', 'a decided split -> split');
ok(watchWarrantsEscalation(v) === false, 'a split does not also escalate as a watch');

// STALE items (outside the 12h window) count for nothing — a watch cannot be built from old news.
const stale = [
  at(60 * 20, 'Court TV', 'Jury finds Duane Davis guilty of first-degree murder'),
  at(60 * 19, 'AP', 'Duane Davis convicted of murder in the 1996 killing of Tupac Shakur'),
];
v = assess(stale, now);
ok(v.status === 'none', 'reports older than the 12h window fall out of assessment');
ok(watchWarrantsEscalation(v) === false, 'a stale-only picture never escalates');

// SUBJECT SCOPING still holds: two families reporting a CO-DEFENDANT'S guilty verdict must not
// escalate as THIS defendant's watch. Uses a real case's defendant tokens.
let durkTok;
try { durkTok = defendantTokens(require('../data/cases/lil-durk-murder-for-hire/case.json')); }
catch (e) { durkTok = new Set(['durk', 'banks']); }
const coDefendant = [
  at(120, 'Court TV', 'Deandre Wilson found guilty of murder-for-hire'),
  at(90, 'AP', 'Jury convicts Deandre Wilson on all counts'),
];
v = assess(coDefendant, now, { defendantTokens: durkTok });
ok(watchWarrantsEscalation(v) === false, 'a co-defendant guilty verdict does not escalate as the lead defendant');

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\n  WATCH-ESCALATION MUST NOT SHIP WITH FAILING TESTS.\n'); process.exit(1); }
console.log('  Watch escalation safe to ship.\n');
