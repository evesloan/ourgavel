#!/usr/bin/env node
/* OurGavel — the implication screen.
 *
 * `personMentions()` in poll.js catches NAMES. It is good at that and blind to everything else.
 * Tested against real submissions and the live case data, it waves through every one of these:
 *
 *     "Could it have been her husband at the time?"
 *     "the father was never properly investigated"
 *     "What about P.C.? He was the one who left the house."
 *     "Why has nobody asked the neighbour what he saw that night?"
 *
 * Each points at one identifiable living person who has not been charged, and each would have
 * gone onto a public board inside fifteen minutes. EDITORIAL.md §5 does not care whether the
 * accusation arrives as a proper noun. Neither does the person it lands on.
 *
 * So this file screens on IDENTIFIABILITY rather than capitalisation: relationship words fixed
 * to one person by a determiner or a possessive ("the husband" and "Clancy's brother" are
 * people; "husbands" is a category), the coded references people reach for precisely because
 * they know naming is not allowed, initials, jurors (§10, never, in any lane), and the
 * interrogative form of an accusation — which EDITORIAL.md names outright: "just asking
 * questions" fails.
 *
 * A hit is not a rejection. A hit means a human looks first, and `cleared[]` in
 * data/queue/held-comments.json is how that human puts one back. The cost of a false positive
 * is that an editor reads one extra sentence; the cost of a false negative is a bereaved father
 * reading on a public website that a stranger thinks he told his wife to kill their children.
 * Those costs are not comparable, and this file is tuned accordingly.
 *
 * Deliberately NOT screened: conduct and institutions. EDITORIAL.md §5 declares those open
 * season, so the prosecution, the defence, the judge, the detective, the hospital, the agency
 * and the medical examiner are absent from the vocabulary below on purpose. A screen that holds
 * "the hospital never escalated" would be a worse failure than the one it replaces, just a
 * quieter one — it would push every institutional question into a queue, and an editor who is
 * rubber-stamping is not moderating. That is what the must-PASS half of screen.test.js defends.
 *
 * Provenance: an earlier session drafted a screen with this same purpose. Its patch never landed
 * and had gone stale against main (it predated the `question` submission kind and would have
 * silently reverted it). Its better ideas — jurors, possessives, the escalate flag, `cleared[]` —
 * are carried here rather than lost, and this file supersedes it.
 */

// Relationship nouns. These denote a specific private individual once a determiner or a
// possessive fixes them to one.
const RELATION_NOUNS = [
  'husbands?', 'wi(?:fe|ves)', 'spouses?', 'exes', 'ex', 'boyfriends?', 'girlfriends?',
  'fianc(?:e|é)(?:e|és|es)?', 'partners?', 'lovers?', 'mistress(?:es)?', 'widows?', 'widowers?',
  'fathers?', 'mothers?', 'dads?', 'mums?', 'moms?', 'parents?', 'stepfathers?', 'stepmothers?',
  'stepdads?', 'stepmoms?', 'brothers?', 'sisters?', 'siblings?', 'twins?', 'sons?', 'daughters?',
  'grand(?:mother|father|parent|ma|pa)s?', 'uncles?', 'aunts?', 'cousins?', 'nephews?', 'nieces?',
  'in-laws?', 'family members?', 'relatives?', 'next of kin',
  'neighbou?rs?', 'roommates?', 'housemates?', 'flatmates?', 'landlords?', 'tenants?',
  'babysitters?', 'nannies|nanny', 'au pairs?', 'housekeepers?', 'carers?', 'caregivers?',
  'co-?workers?', 'colleagues?', 'bosses|boss', 'employers?', 'assistants?', 'bodyguards?',
  'best friends?', 'friends?',
];
const REL_ALT = RELATION_NOUNS.join('|');
// Determiners that fix a noun to one identifiable person, plus up to two modifiers
// ("her ex husband", "the second wife", "his new girlfriend").
const MODS = '(?:(?:ex|step|half|former|current|first|second|third|new|old|estranged|late|other|real|so-called)[-\\s]+){0,2}';
const REL_RE = new RegExp('\\b(?:the|her|his|their|its|our|my|that|this|a|an|one)\\s+' + MODS + '(' + REL_ALT + ')\\b', 'i');
// "Clancy's brother", "the defendant's mother" — a possessive identifies just as precisely.
const POSSESSIVE_RE = new RegExp("\\b[A-Za-z]+['\u2019]s\\s+" + MODS + '(' + REL_ALT + ')\\b', 'i');

// Ways of pointing at someone while making a show of not naming them. Somebody writing one of
// these knows the rule and is working around it, which is exactly why it routes to a human.
const CODED = [
  [/\byou[-\s]?know[-\s]?who\b/i, 'coded reference to a specific person'],
  [/\bwe all know who\b/i, 'coded reference to a specific person'],
  [/\ba certain (?:someone|person|individual|party|man|woman|family|relative|family member)\b/i, 'coded reference to a specific person'],
  [/\bthe (?:one|person|guy|man|woman) (?:we|you|i)\s+(?:all\s+)?(?:can'?t|cannot|won'?t|shouldn'?t|are not allowed to|aren'?t allowed to)\s+name\b/i, 'coded reference to a specific person'],
  [/\bwon'?t say (?:the|his|her|their) name\b/i, 'coded reference to a specific person'],
  [/\brhymes with\b/i, 'coded reference to a specific person'],
  [/\bnot? names?,? but\b/i, 'coded reference to a specific person'],
  [/\bnot naming (?:names|anyone|him|her|them)\b/i, 'coded reference to a specific person'],
  [/\bif you know,? you know\b/i, 'coded reference to a specific person'],
  [/\bthe other (?:one|person|parent|adult)\b/i, 'points at an unnamed specific person'],
  [/\bsomeone (?:else )?(?:close to|in|inside) (?:the|that|her|his|their)\s+\w+/i, 'points at an unnamed specific person'],
  [/\bsomeone (?:in|inside) (?:the )?(?:house|home|family|room|building)\b/i, 'points at an unnamed specific person'],
  [/\bwho (?:really|actually) (?:did it|did|killed|was behind)\b/i, 'implies an uncharged person committed the crime'],
  [/\bthe (?:real|actual) (?:killer|suspect|perpetrator|culprit|murderer|one)\b/i, 'implies an uncharged person committed the crime'],
];

// Initials standing in for a name. Institutional abbreviations are exempt — a federal case is
// full of them — but an acronym earlier in the text must not shield real initials later, so
// every occurrence is checked rather than only the first.
const INITIALS_RE = /(?:^|[^A-Za-z.])([A-Z]\.\s?[A-Z]\.?(?:\s?[A-Z]\.?)?)(?=$|[^A-Za-z])/g;
const ACRONYMS = new Set(['US', 'USA', 'UK', 'EU', 'DA', 'ME', 'PD', 'DC', 'FBI', 'ATF', 'DEA',
  'AM', 'PM', 'AG', 'EMS', 'ER', 'ICU', 'PTSD', 'DOJ', 'MGL', 'CV', 'JD', 'MD', 'PHD', 'RN',
  'LLC', 'INC', 'PS', 'BS', 'ID', 'TV', 'OK']);
const isAcronym = s => ACRONYMS.has(String(s).replace(/[^A-Za-z]/g, '').toUpperCase());
// An initial plus a surname ("P. Clancy") identifies as precisely as the full name. The
// lookbehind keeps "U.S. Attorney" and "D.C. Circuit" out of it — those are institutions.
const INITIAL_SURNAME_RE = /(?<![A-Za-z]\.)\b([A-Z])\.\s?([A-Z][a-z]{2,})\b/;

// EDITORIAL.md §10 — jurors. Never, in any lane, in any framing.
const JUROR_RE = /\bjuror\s*(?:#|no\.?|number)?\s*\d+|\bjuror\b|\bthe\s+(?:foreman|forewoman|forepersons?)\b|\bjury\s+members?\b/i;

// The interrogative form of an accusation. EDITORIAL.md §5 rejects it by name.
const JAQ = [
  [/\b(?:why|how come|how is it that)\b[^.?!]{0,110}?\b(?:never|not|n['’`]t|no ?one|nobody)\b[^.?!]{0,70}?\b(?:charged|arrested|questioned|interviewed|investigated|looked at|a suspect|suspected|searched|tested|polygraph\w*|indicted|prosecuted|on trial)\b/i,
    'asks why an uncharged person was not investigated — an accusation in question form'],
  [/\b(?:why|how come)\b[^.?!]{0,110}?\b(?:alibi|lie detector|polygraph|phone records|whereabouts)\b/i,
    'asks for an uncharged person to be investigated'],
];

// Framing that turns a person reference into an insinuation. On its own this is fine — asking
// hard questions is the point of the site. Combined with a person reference it is the shape the
// rubric fails by name, and the item is worth an editor's attention before the rest of the queue.
const IMPLICATION_RE = new RegExp([
  'could it (?:have )?(?:be|been)', 'what if (?:it|he|she|they|someone) (?:was|were|had|did)',
  "is(?:n'?t| not) it (?:odd|strange|suspicious|convenient|weird|interesting)",
  "why (?:did|would|has|have)(?:n'?t)? (?:he|she|they|nobody|no one)",
  'makes you wonder', 'just asking', 'no ?one (?:is|has) ask(?:ing|ed)',
  'nobody (?:is|has) ask(?:ing|ed)', 'has anyone (?:looked at|considered|asked about)',
  'seems awfully convenient', 'draw your own conclusion',
].join('|'), 'i');

const PII_RES = [
  [/\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i, 'an email address'],
  [/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/, 'a phone number'],
  [/\b\d{1,5}\s+[A-Z][a-z]+\s+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Blvd|Way)\b/, 'a street address'],
  [/(?:^|\s)@[a-z0-9_]{3,}\b/i, 'a social handle'],
  [/\b\d{3}-\d{2}-\d{4}\b/, 'an identification number'],
];

/** Screen free text for references to identifiable people other than the defendant.
 *  Returns [] when nothing fires. Each hit is { rule, why, match }. */
function implicationHits(text) {
  const t = String(text || '');
  const hits = [];
  for (const [re, why] of PII_RES) { const p = t.match(re); if (p) { hits.push({ rule: 'pii', why: 'it looks like it contains ' + why, match: p[0].trim() }); break; } }
  const j = t.match(JUROR_RE);
  if (j) hits.push({ rule: 'juror', why: 'it refers to a juror, which we never publish', match: j[0].trim() });
  const m = t.match(REL_RE) || t.match(POSSESSIVE_RE);
  if (m) hits.push({ rule: 'relation', why: `refers to a specific private individual ("${m[0].trim()}")`, match: m[0].trim() });
  for (const [re, why] of CODED) { const c = t.match(re); if (c) { hits.push({ rule: 'coded', why, match: c[0].trim() }); break; } }
  for (const [re, why] of JAQ) { const q = t.match(re); if (q) { hits.push({ rule: 'just-asking', why, match: q[0].trim().slice(0, 60) }); break; } }
  for (const i of t.matchAll(INITIALS_RE)) {
    if (!isAcronym(i[1])) { hits.push({ rule: 'initials', why: `initials stand in for a name ("${i[1].trim()}")`, match: i[1].trim() }); break; }
  }
  const s = t.match(INITIAL_SURNAME_RE);
  if (s) hits.push({ rule: 'initials', why: `an initial and a surname identify a person ("${s[0]}")`, match: s[0] });
  return hits;
}

/** One-line reason for the editor queue and for the submitter, or '' if the text is clear. */
function implicationReason(text) {
  const h = implicationHits(text);
  return h.length ? h.map(x => x.why).join('; ') : '';
}

/** True when a person reference arrives wrapped in insinuation — the "just asking questions"
 *  shape. Held either way; this only tells the editor which item to read first. */
function shouldEscalate(text) {
  const h = implicationHits(text);
  return h.some(x => x.rule !== 'pii') && (IMPLICATION_RE.test(String(text || '')) || h.some(x => x.rule === 'just-asking'));
}

// ---------------------------------------------------------------------------------
// The NAME screen, canonical copies. These moved here 2026-08-26 so that build.js and
// the relay Worker can share them with the pulse. poll.js still carries its own local
// copies (deliberately untouched that night: a queued handoff held a full-file poll.js
// and an edit here would have been silently clobbered when it applied). pending.test.js
// asserts the two copies stay byte-identical until a lane dedupes them; if that test is
// failing, someone changed one copy — change both, or finish the dedupe.
function personMentions(text, allowedNames) {
  const t = ' ' + text + ' ';
  const hits = new Set();
  // capitalized bigrams that look like names (not sentence-start artifacts alone)
  for (const m of t.matchAll(/\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})\b/g)) {
    const full = m[1] + ' ' + m[2];
    if (!allowedNames.stop.has(m[1].toLowerCase()) && !allowedNames.allowed.has(full.toLowerCase())) hits.add(full);
  }
  // known participant tokens (witnesses, family) — any mention routes to review
  for (const tok of allowedNames.participants) {
    if (tok.length > 3 && new RegExp('\\b' + tok + '\\b', 'i').test(text)) hits.add(tok);
  }
  return [...hits];
}
function buildNameSets(CASE, days) {
  const allowed = new Set(); // the defendant — the person the trial is about
  const parts = String(CASE.defendant || '').match(/[A-Z][a-z]+ [A-Z][a-z]+/);
  if (parts) allowed.add(parts[0].toLowerCase());
  const participants = new Set();
  for (const d of days.days || []) for (const w of d.witnesses || []) {
    for (const tok of w.name.replace(/["'.]/g, '').split(/\s+/)) if (/^[A-Z][a-z]{3,}$/.test(tok)) participants.add(tok);
  }
  // defendant's own tokens are allowed, remove from participant token set
  if (parts) for (const tok of parts[0].split(' ')) participants.delete(tok);
  const stop = new Set(['the', 'this', 'that', 'court', 'judge', 'jury', 'state', 'trial', 'county', 'superior', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'january', 'august', 'boston', 'massachusetts', 'commonwealth', 'defense', 'prosecution']);
  return { allowed, participants: [...participants], stop };
}
const PII = [/\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i, /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/, /\b\d{1,5}\s+[A-Z][a-z]+\s+(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Blvd)\b/, /(?:^|\s)@[a-z0-9_]{3,}\b/i];

// names.json round-trip: a name set serialised for the Worker, and hydrated back.
// The Worker cannot read data/; it fetches the built site's names.json instead.
function serialiseNameSets(ns) {
  return { allowed: [...ns.allowed], participants: [...ns.participants], stop: [...ns.stop] };
}
function hydrateNameSets(o) {
  return { allowed: new Set(o.allowed || []), participants: [...(o.participants || [])], stop: new Set(o.stop || []) };
}

module.exports = {
  implicationHits, implicationReason, shouldEscalate, RELATION_NOUNS,
  personMentions, buildNameSets, PII, serialiseNameSets, hydrateNameSets,
};
