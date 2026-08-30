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

// isSplitVerdict tells classify() to HOLD, but holding silently is its own failure: if every
// newsroom phrases a real split verdict this way, assess() sees no outcome at all and the engine
// says NOTHING — no publish, and no alert either. Nobody learns a verdict landed. So a decided
// split must ESCALATE (open a verdict-watch issue), exactly like a conflict does. This never
// publishes and never invents an outcome — it only raises a hand so a human writes the aftermath.
//
// "Decided" is the same bar classify() uses for a single outcome: the split must be asserted, not
// somebody's hypothetical ("could be found not guilty of murder but guilty of manslaughter") and
// not a retrospective of an overturned verdict. Both signals must sit in indicative, present
// clauses. This is deliberately stricter than isSplitVerdict alone so a preview or explainer that
// merely mentions both possible outcomes never fires an alert.
function isDecidedSplit(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!isSplitVerdict(t)) return false;
  if (HISTORICAL.test(t)) return false;
  for (const re of [ACQUITTAL_SIGNAL, CONVICTION_SIGNAL]) {
    const m = t.match(re);
    if (!m) return false;
    const at = m.index || 0;
    const clause = t.slice(Math.max(0, at - 100), at + m[0].length + 70);
    if (HYPOTHETICAL.test(clause)) return false;   // conditional/anticipatory next to a signal
  }
  return true;
}

const SPLIT_MIN = 2;        // independent newsrooms carrying a decided split → escalate (never publish)

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

// ---- SUBJECT SCOPING ------------------------------------------------------------------------
// A case's ticker carries co-defendants and co-conspirators by name — Durk's carries Deandre
// Wilson, David Lindsey and "Bankroll Freddie"; Fernandez's carries Henry Tenon. If three
// newsrooms report a CO-DEFENDANT'S guilty verdict, the base engine would read three agreeing
// "convicted" headlines and publish it as THIS defendant's verdict. This scopes assess() to the
// case's own lead defendant.
//
// It is subtractive by construction: it can only DECLINE to count an item, never invent or publish
// one. It fires only when we are CONFIDENT the verdict is about a different, NAMED person — the
// headline mentions no token of this defendant's name anywhere AND names another person as the
// verdict's subject. A no-name wire ("Man convicted in murder-for-hire killing…", the real
// Fernandez AP headline) has no other-subject, so it is NEVER skipped and stays publishable. The
// worst an extraction error can do is skip a real verdict, which only makes the engine HOLD — the
// safe direction, resolved by the human aftermath path. Inert unless assess() is given tokens.
const TOK_STOP = new Set(['of','the','and','a','an','jr','sr','ii','iii','iv','de','van','von','only','family','otf']);
// Capitalized words that are roles/labels/places, never a person's identifying name.
const NAME_STOP = new Set([
  'Jury','Juror','Jurors','Judge','Justice','Court','Panel','Foreman','Man','Woman','Men','Women',
  'Suspect','Suspects','Defendant','Defendants','Accused','Ex','Former','Mother','Father','Son',
  'Daughter','Husband','Wife','Widow','Rapper','Singer','Star','Mogul','Executive','Manager','Boss',
  'State','Commonwealth','People','Prosecutor','Prosecutors','Prosecution','Defense','Grammy',
  'Only','Family','The','A','An','Trial','Verdict','Guilty','Not','Murder','Killing','Both','All',
  'Counts','Count','First','Second','Third','News','Live','Updates','Update','Analysis','What','How',
  'Why','Federal','United','States','Nevada','Florida','Virginia','Carolina','Georgia','Chicago','Las',
  'Vegas','County','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday','Appeal',
]);

function nameToks(span) {
  const out = [];
  for (const w of String(span || '').split(/\s+/)) {
    const bare = w.replace(/[^A-Za-z’'-]/g, '');
    if (!bare || !/^[A-Z]/.test(bare) || NAME_STOP.has(bare)) continue;
    const t = bare.replace(/[^A-Za-z]/g, '').toLowerCase();
    if (t.length >= 3) out.push(t);
  }
  return out;
}

/** Lowercased name tokens for a case's LEAD defendant — from the "PLAINTIFF v. DEFENDANT" title
 * (parentheticals stripped) plus any quoted Title-Case alias in the bio BEFORE a co-defendant is
 * introduced. Co-defendants (named later in the bio) and the victim (shortTitle) are excluded. */
function defendantTokens(CASE) {
  const toks = new Set();
  const addRaw = s => { for (const w of String(s || '').split(/[^A-Za-z]+/)) { const t = w.toLowerCase(); if (t.length >= 3 && !TOK_STOP.has(t)) toks.add(t); } };
  const parts = String((CASE && CASE.title) || '').split(/\sv\.?\s/i);
  if (parts.length > 1) addRaw(parts[parts.length - 1].replace(/\([^)]*\)/g, ''));
  let bio = String((CASE && CASE.defendant) || '');
  const cut = bio.search(/co-?defendant|alongside|along with|co-?accused|two other/i);
  const head = cut >= 0 ? bio.slice(0, cut) : bio;
  for (const m of head.matchAll(/["“‘’”']([^"“‘’”']{2,30})["“‘’”']/g)) {
    const span = m[1].trim();
    const words = span.split(/\s+/);
    if (words.length <= 3 && words.every(w => /^[A-Z]/.test(w))) for (const t of nameToks(span)) toks.add(t);
  }
  return toks;
}

/** The proper name the verdict verb acts on, as a Set of lowercased tokens, or null if none. */
function verdictSubjectName(headline) {
  const t = String(headline || '').replace(/\s+/g, ' ').trim();
  const grab = span => { const n = nameToks(span); return n.length ? new Set(n) : null; };
  let m;
  m = t.match(/\b(?:finds?|found|convicts?|convicted|acquits?|acquitted|clears?|cleared|sentences?|sentenced)\s+((?:[A-Z][\w.’'-]+\s+){1,4})(?:guilty|not|of|on|in|to|after|at|—|,|$)/);
  if (m) { const n = grab(m[1]); if (n) return n; }
  m = t.match(/\b([A-Z][\w.’'-]+(?:\s+[A-Z][\w.’'-]+){0,3})\s+(?:is\s+|was\s+|has\s+been\s+)?(?:found|convicted|acquitted|cleared|sentenced)\b/);
  if (m) { const n = grab(m[1]); if (n) return n; }
  m = t.match(/\bverdict\s+(?:for|against)\s+((?:[A-Z][\w.’'-]+\s*){1,4})/);
  if (m) { const n = grab(m[1]); if (n) return n; }
  return null;
}

/** True only when CONFIDENT this verdict item is about a DIFFERENT named person than the case's
 * defendant. Subtractive: absent a positive other-subject it returns false (item stays counted). */
function subjectIsOther(headline, defTokens) {
  if (!defTokens || !defTokens.size) return false;
  const t = String(headline || '');
  for (const tok of defTokens) if (new RegExp('\\b' + tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(t)) return false;
  const subj = verdictSubjectName(t);
  if (!subj) return false;
  for (const s of subj) if (defTokens.has(s)) return false;
  return true;
}

/**
 * Assess a case's recent ticker items.
 * Returns { status, outcome, outlets, items, conflict } where status is one of:
 *   'none'      nothing to see
 *   'watch'     some signal, below threshold — escalate, do not publish
 *   'conflict'  outlets disagree on the outcome — never publish, escalate loudly
 *   'ready'     consensus met; publish once it has survived a second cycle
 */
function assess(items, now = Date.now(), opts = {}) {
  const cutoff = now - WINDOW_HOURS * 3600 * 1000;
  // Scope to this case's own defendant when tokens are supplied (poll.js passes them). Absent
  // tokens the guard is inert and assess() behaves exactly as before.
  const defTokens = (opts && opts.defendantTokens instanceof Set) ? opts.defendantTokens
    : (opts && Array.isArray(opts.defendantTokens)) ? new Set(opts.defendantTokens) : null;
  const byOutcome = new Map();
  const splitFams = new Map();               // family -> item, for DECIDED split-verdict headlines
  const splitCopies = new Set();             // one wire split story on many mastheads is one story
  for (const it of items || []) {
    const ts = new Date(it.ts).getTime();
    if (!ts || ts < cutoff) continue;
    // A co-defendant's or co-conspirator's verdict is NOT this defendant's. Skip before it can
    // count toward an outcome OR escalate a split. Subtractive — see subjectIsOther above.
    if (defTokens && subjectIsOther(it.headline, defTokens)) continue;
    const tag = classify(it.headline);
    if (!tag) {
      // classify() held. A decided split (asserted acquittal AND conviction, not hypothetical or
      // historical) proves nothing single but is a real event a human must resolve — track it so
      // an otherwise-silent picture can still raise an alert. Same family/copy dedupe as outcomes.
      if (isDecidedSplit(it.headline)) {
        const fam = outletFamily(it.url, it.outlet);
        if (!fam) continue;
        const copy = copyKey(it.headline);
        const already = splitFams.has(fam) || (copy && splitCopies.has(copy));
        if (copy) splitCopies.add(copy);
        if (!already) splitFams.set(fam, it);
      }
      continue;
    }
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
  // A decided split escalates only when there is no clean outcome to publish or conflict on. It
  // is computed once here so every early return can consider it.
  const split = splitFams.size >= SPLIT_MIN
    ? { status: 'split', outlets: [...splitFams.keys()], items: [...splitFams.values()] }
    : null;

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
  // A clean, publishable consensus wins outright — a real conviction on a lesser charge, phrased
  // cleanly by enough newsrooms, must still publish; the split alert never suppresses it.
  if (top && top.outlets.length >= MIN_OUTLETS) {
    return { status: 'ready', outcome: top.outcome, outlets: top.outlets, items: top.items };
  }
  // No publishable single outcome. If enough newsrooms report a decided split, raise the alert
  // (this outranks a lone below-threshold 'watch' — a split is the more actionable signal).
  if (split) return split;
  if (top) return { status: 'watch', outcome: top.outcome, outlets: top.outlets, items: top.items };
  return { status: 'none' };
}

module.exports = { classify, assess, outletFamily, copyKey, isSplitVerdict, isDecidedSplit, defendantTokens, verdictSubjectName, subjectIsOther, OUTCOME_LABEL, MIN_OUTLETS, SPLIT_MIN, WINDOW_HOURS };
