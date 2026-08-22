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
 * No dependencies. Node 18+.
 */

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
  ['GUILTY', new RegExp('\\b(?:(?:found|finds|find|convicts?|convicted)\\s+' + SUBJ + '(?<!not\\s)guilty|convicted (?:of|on)\\b|guilty verdict|verdict of guilty)', 'i')],
];

const OUTCOME_LABEL = {
  GUILTY: 'Guilty',
  NOT_GUILTY: 'Not guilty',
  NGRI: 'Not guilty by reason of lack of criminal responsibility',
  MISTRIAL: 'Mistrial — no unanimous verdict',
};

// A newsroom publishing three times is one source. Map syndicates and station groups to
// one family so a single wire story cannot masquerade as consensus.
function outletFamily(outlet) {
  const o = String(outlet || '').toLowerCase();
  const map = [
    [/court ?tv/, 'courttv'], [/law ?(&|and) ?crime|lawandcrime/, 'lawandcrime'],
    [/\bap\b|associated press/, 'ap'], [/reuters/, 'reuters'],
    [/nbc/, 'nbc'], [/cbs/, 'cbs'], [/\babc\b/, 'abc'], [/\bfox\b/, 'fox'],
    [/cnn/, 'cnn'], [/\bnpr\b/, 'npr'], [/wbur/, 'wbur'], [/wcvb/, 'wcvb'],
    [/boston ?25|wfxt/, 'boston25'], [/globe/, 'globe'], [/herald/, 'herald'],
    [/patriot ledger|ledger/, 'ledger'], [/8 ?news ?now|klas/, 'klas'],
    [/review-?journal|\brj\b/, 'reviewjournal'], [/news ?4 ?jax|wjxt/, 'wjxt'],
    [/first ?coast/, 'firstcoast'], [/times-?union/, 'timesunion'],
    [/ktla/, 'ktla'], [/pbs/, 'pbs'], [/people/, 'people'], [/\bupi\b/, 'upi'],
  ];
  for (const [re, fam] of map) if (re.test(o)) return fam;
  // Aggregators are not newsrooms. They republish others and must never count as a source.
  if (/bing|google news|news ?search|aggregat/.test(o)) return null;
  return o.replace(/[^a-z0-9]/g, '').slice(0, 16) || null;
}

/** Classify one piece of text. Returns an outcome tag, or null if it proves nothing. */
function classify(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  for (const [tag, re] of OUTCOMES) {
    const m = t.match(re);
    if (!m) continue;
    // Only the clause around the match matters — a story may legitimately mention
    // deliberations elsewhere in the same headline.
    const at = m.index || 0;
    const clause = t.slice(Math.max(0, at - 120), at + m[0].length + 70);
    if (HYPOTHETICAL.test(clause)) return null;
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
    const fam = outletFamily(it.outlet);
    if (!fam) continue;                       // aggregator, or unattributable
    if (!byOutcome.has(tag)) byOutcome.set(tag, new Map());
    const fams = byOutcome.get(tag);
    if (!fams.has(fam)) fams.set(fam, it);    // first report from that newsroom
  }
  if (!byOutcome.size) return { status: 'none' };

  const ranked = [...byOutcome.entries()]
    .map(([outcome, fams]) => ({ outcome, outlets: [...fams.keys()], items: [...fams.values()] }))
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

module.exports = { classify, assess, outletFamily, OUTCOME_LABEL, MIN_OUTLETS, WINDOW_HOURS };
