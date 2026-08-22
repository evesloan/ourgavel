#!/usr/bin/env node
/* Tests for the implication screen (scripts/screen.js).
 *
 * Two corpora, and the second matters as much as the first. MUST_HOLD is the set of sentences
 * that point at a living person who has not been charged — every one of these was verified to
 * pass poll.js's name screen untouched before this file existed. MUST_PASS is the set that
 * criticises conduct, institutions and the proceeding, which EDITORIAL.md §5 declares open
 * season. A screen that eats those is not cautious, it is broken: it turns the review queue
 * into noise, and an editor who is rubber-stamping is not moderating.
 */
const assert = require('assert');
const { implicationHits, implicationReason, shouldEscalate } = require('./screen.js');

// Points at one identifiable uncharged person. Must never reach a public board unreviewed.
const MUST_HOLD = [
  ['Could it have been her husband at the time?', 'relation'],
  ['the husband knew what was coming and did nothing', 'relation'],
  ['the father was never properly investigated', 'relation'],
  ['Why has nobody asked the neighbour what he saw that night?', 'relation'],
  ['his ex girlfriend had a motive nobody talks about', 'relation'],
  ['a family member had access to the medication cabinet', 'relation'],
  ['ask the babysitter where she was', 'relation'],
  ['her estranged brother benefited from the will', 'relation'],
  ["Clancy's brother was in the house that morning.", 'relation'],
  ['What about P.C.? He was the one who left the house.', 'initials'],
  ['P. Clancy was home earlier than he claimed', 'initials'],
  ['The U.S. Attorney knew, and so did P.C.', 'initials'],
  ['you know who I mean, the one who went to the pharmacy', 'coded'],
  ['a certain someone changed their story twice', 'coded'],
  ['no names, but the phone records tell you everything', 'coded'],
  ['someone in the house made that call', 'coded'],
  ['when do we talk about the real killer', 'coded'],
  ['What if it was the other adult in the house?', 'coded'],
  ['His name rhymes with a fish.', 'coded'],
  ['Juror 7 was asleep during the expert testimony.', 'juror'],
  ['The foreman clearly made his mind up in week one.', 'juror'],
  ['Ask him yourself, his email is tips@example.com', 'pii'],
  ['Reachable on 617-555-0142 if anyone wants to ask.', 'pii'],
  ['He posts about it constantly, @somequiethandle', 'pii'],
  ['Why was he never charged if the DNA was there?', 'just-asking'],
  ['How come nobody ever questioned the person who found the bodies?', 'just-asking'],
  ['Why has his alibi never been checked?', 'just-asking'],
];

// Hard scrutiny of conduct, institutions and the record. Must publish without an editor.
const MUST_PASS = [
  'The prosecution rested too early and never closed the timeline gap.',
  'The judge should not have admitted the search testimony under this standard.',
  'The hospital discharged her without a follow-up appointment, which the record shows.',
  'Defence counsel never impeached the medical examiner on the time of death.',
  'The detective testified he did not preserve the original notes.',
  'Dr. Zeizel contradicted himself on cross about the dosage.',
  'The state police failed to log the device for eleven days.',
  'Massachusetts uses the McHoul standard, which puts the burden on the Commonwealth.',
  'Postpartum psychosis is not the same diagnosis as postpartum depression.',
  'Coverage of this trial has been sloppy about what the charges actually are.',
  'The defendant was charged with three counts; the fourth was dropped before trial.',
  'What would disprove this is the pharmacy log for that afternoon.',
  'The U.S. Attorney had the F.B.I. wiretaps before the indictment came down.',
  'The D.A. and the M.E. disagreed about the time of death.',
  'The D.C. Circuit reversed on the suppression question.',
  'The agency had three chances to act on the referral and did nothing.',
  'Allowing that exhibit in over objection is the ruling most likely to be appealed.',
  'A manslaughter instruction would let the jury split the difference.',
  'Will the jury get a middle option, or is it all-or-nothing on murder?',
];

let fail = 0;
for (const [text, rule] of MUST_HOLD) {
  const hits = implicationHits(text);
  if (!hits.length) { console.error('MISSED (would auto-publish): ' + JSON.stringify(text)); fail++; continue; }
  if (!hits.some(h => h.rule === rule)) {
    console.error(`WRONG RULE for ${JSON.stringify(text)}: expected ${rule}, got ${hits.map(h => h.rule).join(',')}`); fail++;
  }
}
for (const text of MUST_PASS) {
  const hits = implicationHits(text);
  if (hits.length) { console.error(`OVER-BLOCKED: ${JSON.stringify(text)} -> ${hits.map(h => h.rule + ':' + h.match).join(', ')}`); fail++; }
}

// The reason string is what a reader sees when their post is held. It must say something.
assert.ok(implicationReason(MUST_HOLD[0][0]).length > 10, 'held posts need an explainable reason');
assert.strictEqual(implicationReason(MUST_PASS[0]), '', 'clean text yields no reason');
// escalate marks the "just asking questions" shape so an editor reads it first. It never
// changes whether something is held — only the order the queue is worked.
assert.ok(shouldEscalate('Could it have been her husband at the time?'), 'insinuation + a person escalates');
assert.ok(shouldEscalate('Just asking — why would her partner delete those messages?'), 'insinuation + a person escalates');
assert.ok(!shouldEscalate('Makes you wonder why the hospital never escalated the referral.'), 'insinuation about an institution does not escalate');
assert.ok(!shouldEscalate(MUST_PASS[0]), 'clean text does not escalate');
// Empty and junk input must not throw — this runs on every comment the pulse syncs.
for (const junk of ['', null, undefined, 0, '   ', '###', 'a'.repeat(5000)]) implicationHits(junk);

/* Wiring. The screen is worthless sitting in a file nobody calls, and both call sites are far
   from here — same reasoning as submit.test.js, which guards heading drift the same way. */
const fs = require('fs');
const path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const poll = src('poll.js'), build = src('build.js');
const ingest = poll.slice(poll.indexOf('async function ingestTheories'));
const threads = poll.slice(poll.indexOf('async function syncThreads'), poll.indexOf('async function ingestTheories'));
let wiring = 0;
function wired(cond, msg) { wiring++; if (!cond) { console.error('UNWIRED: ' + msg); fail++; } }
wired(/implicationReason/.test(ingest.slice(0, ingest.indexOf('// publish'))),
  'the fast lane must screen submissions before it auto-publishes them');
wired(/implicationReason/.test(threads), 'thread comments must be screened before they render');
wired(/personMentions\(body, names\)/.test(threads), 'thread comments must run the name screen too');
wired(/held/.test(threads) && /held:/.test(threads), 'syncThreads must publish a held count');
wired(/cleared\.has\(String\(c\.id\)\)/.test(threads) && /cleared: \[\.\.\.cleared\]/.test(threads),
  'a held comment must be re-approvable by a human via cleared[] — hold is not reject');
wired(/heldSeeds/.test(threads) && threads.indexOf('implicationReason(seed)') > -1,
  'a thread seed that implicates an uncharged person must not open a discussion page');
wired(/held: Number\(th\.held\)/.test(build), 'build.js must carry the held count to the page');
wired(/held for editor review/.test(build), 'the board must say when replies are held');

const total = MUST_HOLD.length + MUST_PASS.length + 7 + wiring;
if (fail) { console.error(`\nscreen.test.js: ${fail} FAILED of ${total}`); process.exit(1); }
console.log(`screen.test.js: ${total} passed (${MUST_HOLD.length} held, ${MUST_PASS.length} published, 7 assertions, ${wiring} wiring)`);
