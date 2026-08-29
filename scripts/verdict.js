/* OurGavel — verdict detection.
 *
 * Publishing a verdict is the most damaging thing this site can get wrong, and as of
 * 2026-08-22 it publishes without a human. So the standard got STRICTER, not looser:
 * removing the operator means the evidence has to carry the weight the operator used to.
 *
 * Three gates, all of which must pass:
 *   1. LANGUAGE  — the headline must state an outcome that has ALREADY happened, in the
 *                  indicative. "Jury begins deliberating verdict", "if found guilty" and
 *                  "faces a guilty verdict" are evidence of nothing.
 *   2. CONSENSUS — at least MIN_OUTLETS independent newsrooms must agree on the SAME
 *                  outcome, with zero credentialed outlets asserting a different one.
 *                  Two bylines from one newsroom is one source.
 *   3. SETTLING  — that consensus must survive a second polling cycle. A wire error that
 *                  gets pulled within fifteen minutes never reaches the site.
 *
 * Anything short of all three escalates to an issue instead of publishing. The engine is
 * tuned to hold when it could publish rather than publish when it should hold.
 *
 * No dependencies beyond outlets.js. Node 18+.
 */

const { familyFor, familyFromLabel } = require('./outlets.js');
const { copyKey } = require('./canonical.js');   // one wire story on five mastheads is one story

const MIN_OUTLETS = 3;      // independent newsrooms that must agree
const WINDOW_HOURS = 12;    // how far back agreeing reports may be drawn from

// Language meaning the outcome has not happened, or is conditional, or is somebody's
// argument rather than the jury's finding. If any of this sits in the same clause as the
// outcome phrase, the item proves nothing.
const HYPOTHETICAL = new RegExp([
  'could', 'would', 'might', 'may', 'if', 'whether', 'expect\\w*', 'await\\w*', 'pending',
  'prepar\\w*', 'set to', 'due to', 'begin\\w*', 'began', 'resum\\w*', 'continu\\w*',
  'deliberat\\w*', 'closing', 'opening', 'watch', 'when', 'ahead of', 'brace\\w*',
  'anticipat\\w*', 'possible', 'potential', 'face[sd]?', 'facing', 'risk\\w*',
  'seek\\w*', 'sought', 'ask\\w*', 'urge\\w*', 'argu\\w*', 'claim\\w*', 'alleg\\w*',
  'testif\\w*', 'what happens', 'explainer', 'analysis', 'how to', 'live updates?',
  'recap', 'preview', 'poll', 'predict\\w*', 'jurors? (will|must)', 'instruct\\w*',
].map(w => '\\b' + w + '\\b').join('|'), 'i');

// Real headlines put a NAME between the verb and the outcome — "Jury finds Duane Davis
// guilty" — so the verb and the outcome are allowed to be a few words apart. Kept short
// (max 5 tokens) so the two halves must plausibly belong to the same clause.
const SUBJ = "(?:[\\w.'\\u2019-]+\\s+){0,5}";

// Outcome patterns, most specific first — "not guilty by reason of" must be tested
// before "not guilty", and "not guilty" before "guilty". The negative lookbehind on
// GUILTY is belt-and-braces: "not guilty" must never be read as a conviction.
const OUTCOMES = [
  ['NGRI', new RegExp('\\b(?:not criminally responsible|not guilty by reason of (?:insanity|mental illness|lack of criminal responsibility)|(?:found|finds)\\s+' + SUBJ + 'not criminally responsible)\\b', 'i')],
  ['MISTRIAL', /\b(mistrial (was )?(declared|granted)|declare[sd]? a mistrial|hung jury|deadlocked jury|jury (was |is )?(hung|deadlocked))\b/i],
  ['NOT_GUILTY', new RegExp('\\b(?:(?:found|finds|find)\\s+' + SUBJ + 'not guilty|acquitted|acquits|acquitting|verdict of not guilty|cleared of all charges)\\b', 'i')],
  // 'convicted in' is AP's standard wire phrasing ("Man convicted in murder-for-hire killing…")
  // and was under-detected until the Fernandez verdict (2026-08-26), when six newsroom families
  // reported a real conviction and only one classified. The existing guards already cover the
  // risky shapes: 'convicted in 2023' (datesThePastVerdict), 'convicted in first trial/retrial/
  // appeal' (HISTORICAL), 'could be convicted in' (HYPOTHETICAL). Proven against every stored
  // headline across all cases before shipping: no new false positive.
  ['GUILTY', new RegExp('\\b(?:(?:found|finds|find|convicts?|convicted)\\s+' + SUBJ + '(?<!not\\s)guilty|convicted (?:of|on|in)\\b|guilty verdict|verdict of guilty)', 'i')],
];

// Coverage of a RETRIAL constantly references the verdict that was overturned, and a
// retrospective reads exactly like a fresh conviction. Three newsrooms running the same
// retrospective would otherwise reach "consensus" and publish a verdict that has not
// happened. Any of this vocabulary anywhere in the headline means it is about a past or
// undone outcome, so it proves nothing about today.
const HISTORICAL = new RegExp([
  'overturn\\w*', 'vacat\\w*', 'thrown out', 'tossed', 'revers\\w*', 'quash\\w*',
  'set aside', 'first trial', 'first jury', 'previous trial', 'prior conviction',
  'original (?:conviction|verdict|trial)', 'earlier conviction', 'new trial',
  'retrial(?:\\s*:|\\s+set|\\s+ordered|\\s+granted)', 'appeal\\w*', 'post-?conviction',
].map(w => '\\b' + w + '\\b').join('|'), 'i');

// A past year sitting right after the outcome usually dates the VERDICT ("convicted ... in
// 2023"). A past year followed by a crime noun dates the CRIME ("guilty in the 1996
// killing"), which is normal in a real verdict headline and must still pass.
// The crime noun often sits a few words after the year — "in the 2022 Bridegan shooting" —
// so allow a short run of words between. 'trial' and 'case' are deliberately NOT here:
// "convicted in 2023 after a long trial" dates the verdict, not the crime.
const CRIME_NOUN = /^\s*(?:[\w.'\u2019-]+\s+){0,3}(?:killing|killings|murder|murders|shooting|shootings|death|deaths|slaying|slayings|homicide|stabbing|crash|fire|disappearance|kidnapping|attack|assault|robbery|bombing)\b/i;
function datesThePastVerdict(text, at, len) {
  const tail = text.slice(at + len, at + len + 48);
  const m = tail.match(/\b(19|20)\d{2}\b/);
  if (!m) return false;
  const thisYear = new Date().getUTCFullYear();
  if (parseInt(m[0], 10) >= thisYear) return false;
  return !CRIME_NOUN.test(tail.slice(m.index + m[0].length));
}

// SPLIT / PARTIAL verdicts. A five-option case — Clancy's jury may return first-degree murder,
// second-degree murder, manslaughter, not guilty, OR not-guilty-by-reason-of-lack-of-criminal-
// responsibility — routinely produces headlines that ACQUIT on the top charge and CONVICT on a
// lesser one: "found not guilty of first-degree murder, guilty of manslaughter". classify() tests
// NOT_GUILTY before GUILTY, so it read the acquittal phrase and returned NOT_GUILTY — and three
// newsrooms phrasing a real conviction that way would have PUBLISHED A FALSE ACQUITTAL for a
// defendant who was in fact convicted. A single headline that asserts BOTH an acquittal and a
// conviction is ambiguous about the OVERALL outcome by construction; it proves nothing on its own.
// So it is classified as null and the engine holds — a human writes the nuanced split-verdict
// aftermath (AGENT.md), which is exactly the case a machine must not decide. Purely subtractive:
// this can only turn a would-be single tag into null, never invent a positive, so it cannot cause
// a publication — only ever a hold. (A clean verdict names one outcome and never trips both.)
const ACQUITTAL_SIGNAL  = /\bnot[\s-]+guilty\b|\bacquit(?:ted|tal|s)?\b|\bcleared\s+of\b|\bnot[\s-]+criminally[\s-]+responsible\b/i;
const CONVICTION_SIGNAL = /\bconvict(?:s|ed|ion)?\b|(?<!\bnot[\s-])\bguilty\b/i;
function isSplitVerdict(t) { return ACQUITTAL_SIGNAL.test(t) && CONVICTION_SIGNAL.test(t); }

const OUTCOME_LABEL = {
  GUILTY: 'Guilty',
  NOT_GUILTY: 'Not guilty',
  NGRI: 'Not guilty by reason of lack of criminal responsibility',
  MISTRIAL: 'Mistrial — no unanimous verdict',
};

// Independence is decided by WHO PUBLISHED IT, and that comes from the resolved host --
// never from the feed label, which is operator-typed configuration and can say anything.
// See scripts/outlets.js for the measurement that forced this change: on live data, items
// labelled "Bing News" resolved to apnews.com, postandcourier.com, wistv.com and wltx.com
// (thrown away as aggregator noise) and to msn.com and yahoo.com reposts (which the old
// label rule only excluded by luck -- a syndicated link arriving through a newsroom-labelled
// feed would have counted as an independent newsroom, three times over, in the engine that
// publishes a criminal verdict with nobody watching).
//
// Called with a bare label and no URL it behaves exactly as it did before.
function outletFamily(urlOrLabel, fallbackLabel) {
  const s = String(urlOrLabel || '');
  return /^https?:\/\//i.test(s) ? familyFor(s, fallbackLabel) : familyFromLabel(s || fallbackLabel);
}

/** Classify one piece of text. Returns an outcome tag, or null if it proves nothing. */
function classify(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  // A split/partial verdict (acquittal on one charge, conviction on another) is ambiguous about
  // the overall outcome — hold, never read the first phrase as THE verdict. See isSplitVerdict.
  if (isSplitVerdict(t)) return null;
  for (const [tag, re] of OUTCOMES) {
    const m = t.match(re);
    if (!m) continue;
    // Only the clause around the match matters — a story may legitimately mention
    // deliberations elsewhere in the same headline.
    const at = m.index || 0;
    const clause = t.slice(Math.max(0, at - 120), at + m[0].length + 70);
    if (HYPOTHETICAL.test(clause)) return null;
    if (HISTORICAL.test(t)) return null;
    if (datesThePastVerdict(t, at, m[0].length)) return null;
    return tag;
  }
  return null;
}

/**
 * Assess a case's recent ticker items.
 * Returns { status, outcome, outlets, items, conflict } where status is one of:
 *   'none'      nothing to see
 *   'watch'     some signal, below threshold — escalate, do not publish
 *   'conflict'  outlets disagree on the outcome — never publish, escalate loudly
 *   'ready'     consensus met; publish once it has survived a second cycle
 */
function assess(items, now = Date.now()) {
  const cutoff = now - WINDOW_HOURS * 3600 * 1000;
  const byOutcome = new Map();
  for (const it of items || []) {
    const ts = new Date(it.ts).getTime();
    if (!ts || ts < cutoff) continue;
    const tag = classify(it.headline);
    if (!tag) continue;
    const fam = outletFamily(it.url, it.outlet);
    if (!fam) continue;                       // aggregator, or unattributable
    if (!byOutcome.has(tag)) byOutcome.set(tag, { fams: new Map(), copies: new Set() });
    const bucket = byOutcome.get(tag);
    const copy = copyKey(it.headline);
    // Record the copy even when this item is not going to count, so a THIRD masthead
    // running the same story cannot slip past a check that already short-circuited.
    const already = bucket.fams.has(fam) || (copy && bucket.copies.has(copy));
    if (copy) bucket.copies.add(copy);
    if (already) continue;
    bucket.fams.set(fam, it);                 // first report from that newsroom
  }
  if (!byOutcome.size) return { status: 'none' };

  const ranked = [...byOutcome.entries()]
    .map(([outcome, b]) => ({ outcome, outlets: [...b.fams.keys()], items: [...b.fams.values()] }))
    .sort((a, b) => b.outlets.length - a.outlets.length);

  const top = ranked[0];
  const rivals = ranked.slice(1).filter(r => r.outlets.length > 0);

  // Any credentialed disagreement stops everything. A split newsroom picture is exactly
  // the situation where a machine should not be deciding.
  if (rivals.length) {
    return {
      status: 'conflict', outcome: top.outcome, outlets: top.outlets,
      items: top.items, conflict: rivals.map(r => ({ outcome: r.outcome, outlets: r.outlets })),
    };
  }
  if (top.outlets.length < MIN_OUTLETS) {
    return { status: 'watch', outcome: top.outcome, outlets: top.outlets, items: top.items };
  }
  return { status: 'ready', outcome: top.outcome, outlets: top.outlets, items: top.items };
}

module.exports = { classify, assess, outletFamily, copyKey, isSplitVerdict, OUTCOME_LABEL, MIN_OUTLETS, WINDOW_HOURS };
