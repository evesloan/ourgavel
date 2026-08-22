/* OurGavel — who actually published this?

   The defect this file exists to fix, found on live data 2026-08-22:

   Two of our five cases discover stories through Bing News RSS. Bing does not
   publish anything; it points at whoever did. So a ticker row read

       "Bing News — Murdaugh retrial"  ->  https://www.msn.com/en-us/news/crime/...

   which is wrong twice over. It names a search engine as the source of record,
   and the search engine is not even where the reader lands. Measured across the
   live tickers: 32 of 81 items resolved to msn.com or yahoo.com reposts while
   claiming a feed label as their outlet. On a site whose banner promise is
   "No source, no sentence," that is the promise breaking in the most-read
   element on every case page.

   Worse, and invisibly: scripts/verdict.js counted newsroom independence off
   that same label. It excluded anything matching /bing/ as an aggregator, which
   is correct as far as it goes -- but the label is feed configuration, not
   evidence. It threw away Bing-discovered items that resolved to apnews.com,
   postandcourier.com, wistv.com and wltx.com (real newsrooms, real reporting),
   and it would have counted three copies of one wire story as three independent
   newsrooms the moment any non-Bing-labelled feed carried a syndicated link.
   That is the engine that publishes a criminal verdict with no human in the loop.

   So: attribution comes from the RESOLVED HOST, never from the feed label.
   The label survives only as a fallback for items with no usable URL.

   Two questions, deliberately separate, because they have different answers:

     nameFor(url, fallback)    what the reader is told. Never null -- a row with
                               no attribution is worse than an imperfect one.
     familyFor(url, fallback)  whether it counts towards MIN_OUTLETS. Null means
                               "do not count": aggregators, and anything we
                               cannot attribute to a newsroom at all.

   A note on what we cannot do. MSN and Yahoo do not disclose the original
   article URL, and msn.com disallows automated fetching, so the true publisher
   of a repost is not recoverable by us. We therefore label it honestly as a
   syndicated repost and never let it count towards a verdict. The real remedy
   is upstream -- carry the outlet's own feed so we ingest the original first --
   and that is a feed-configuration job, not a code one.
*/
'use strict';

// Republishers. They carry other newsrooms' work under their own domain without
// disclosing the source URL, so they can be neither named nor counted as one.
// Suffix-matched, so a look-alike host (msn.com.evil.example) does not qualify.
const AGGREGATORS = [
  ['msn.com', 'MSN'],
  ['yahoo.com', 'Yahoo News'],
  ['news.google.com', 'Google News'],
  ['bing.com', 'Bing News'],
  ['aol.com', 'AOL'],
  ['apple.news', 'Apple News'],
  ['flipboard.com', 'Flipboard'],
  ['newsbreak.com', 'NewsBreak'],
  ['smartnews.com', 'SmartNews'],
  ['headtopics.com', 'HeadTopics'],
  ['inkl.com', 'inkl'],
  ['pressreader.com', 'PressReader'],
];

// Newsrooms we actually encounter, or configure a feed for. host suffix -> [name, family].
//
// The family is the independence key: everything sharing one is ONE source, however
// many of them file. It is deliberately PER NEWSROOM, not per owner group. The first
// draft of this table collapsed by owner -- all TEGNA one family, all Gray one family --
// on the reasoning that station groups run the same national copy. Checked against the
// live data, that was wrong in the expensive direction: it made WLTX in Columbia (the
// Murdaugh venue's own station, filing original trial coverage) indistinguishable from
// 10TV in Columbus rewriting the wire, and it merged Gray's Charleston and Las Vegas
// stations across two unrelated cases.
//
// Shared national copy is real, but the honest signal for it is the COPY, not the owner:
// verdict.js collapses items whose headlines match, whoever filed them. That catches one
// AP story on five affiliates -- which owner-collapsing also caught -- without throwing
// away five newsrooms' genuinely separate local reporting, which owner-collapsing did.
//
// A family is shared here ONLY where two domains are literally the same newsroom.
const OUTLETS = [
  // wires and national
  ['apnews.com', 'AP', 'ap'],
  ['reuters.com', 'Reuters', 'reuters'],
  ['upi.com', 'UPI', 'upi'],
  ['npr.org', 'NPR', 'npr'],
  ['pbs.org', 'PBS NewsHour', 'pbs'],
  ['cnn.com', 'CNN', 'cnn'],
  ['nbcnews.com', 'NBC News', 'nbc'],
  ['cbsnews.com', 'CBS News', 'cbs'],
  ['abcnews.go.com', 'ABC News', 'abc'],
  ['foxnews.com', 'Fox News', 'fox'],
  ['usatoday.com', 'USA Today', 'usatoday'],
  ['people.com', 'People', 'people'],
  ['rollingstone.com', 'Rolling Stone', 'rollingstone'],

  // court and crime desks
  ['courttv.com', 'Court TV', 'courttv'],
  ['lawandcrime.com', 'Law & Crime', 'lawandcrime'],

  // South Carolina — Murdaugh
  ['postandcourier.com', 'The Post and Courier', 'postandcourier'],
  ['fitsnews.com', 'FITSNews', 'fitsnews'],
  ['thestate.com', 'The State', 'thestate'],
  ['greenvilleonline.com', 'The Greenville News', 'greenvillenews'],
  ['wistv.com', 'WIS News 10', 'wis'],
  ['live5news.com', 'WCSC Live 5 News', 'live5'],
  ['wltx.com', 'WLTX News19', 'wltx'],
  ['wciv.com', 'ABC News 4 Charleston', 'wciv'],
  ['counton2.com', 'WCBD News 2', 'wcbd'],

  // Massachusetts — Clancy
  ['bostonglobe.com', 'The Boston Globe', 'globe'],
  ['boston.com', 'Boston.com', 'globe'],   // same newsroom as bostonglobe.com
  ['bostonherald.com', 'Boston Herald', 'herald'],
  ['wbur.org', 'WBUR', 'wbur'],
  ['wcvb.com', 'WCVB', 'wcvb'],
  ['nbcboston.com', 'NBC10 Boston', 'nbcboston'],
  ['boston25news.com', 'Boston 25 News', 'boston25'],
  ['patriotledger.com', 'The Patriot Ledger', 'patriotledger'],

  // Nevada — Davis
  ['8newsnow.com', '8 News Now', '8newsnow'],
  ['reviewjournal.com', 'Las Vegas Review-Journal', 'reviewjournal'],
  ['fox5vegas.com', 'FOX5 Las Vegas', 'fox5vegas'],
  ['news3lv.com', 'News 3 Las Vegas', 'news3lv'],
  ['ktnv.com', 'KTNV Las Vegas', 'ktnv'],

  // Florida — Bridegan / Gardner
  ['news4jax.com', 'News4JAX', 'news4jax'],
  ['actionnewsjax.com', 'Action News Jax', 'actionnewsjax'],
  ['jacksonville.com', 'The Florida Times-Union', 'timesunion'],
  ['firstcoastnews.com', 'First Coast News', 'firstcoast'],

  // California — Banks
  ['ktla.com', 'KTLA', 'ktla'],
  ['abc7.com', 'ABC7 Los Angeles', 'abc7la'],
  ['latimes.com', 'Los Angeles Times', 'latimes'],
  ['lamag.com', 'Los Angeles Magazine', 'lamag'],
  ['allhiphop.com', 'AllHipHop', 'allhiphop'],

  // seen in the wild
  ['10tv.com', '10TV Columbus', '10tv'],
  ['krcrtv.com', 'KRCR', 'krcr'],
  ['dancehallmag.com', 'DancehallMag', 'dancehallmag'],
  ['primetimer.com', 'Primetimer', 'primetimer'],
];

// The pre-2026-08-22 map, kept EXACTLY as it was and used only when an item has no
// usable URL. It normalises feed labels, so "Court TV" and "CourtTV.com" -- two
// spellings one operator typed into two feed configs -- still collapse to one source.
// Stripping non-alphanumerics instead, which was the first thing tried here, silently
// turned those into two independent newsrooms and moved a one-source case a third of
// the way to auto-publishing a verdict. Do not "simplify" this away.
const LABEL_FAMILIES = [
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

// Labels that name a search engine or a feed reader rather than a newsroom.
const AGGREGATOR_LABEL = /bing|google news|news ?search|aggregat/i;

function familyFromLabel(label) {
  const o = String(label || '').toLowerCase();
  if (!o) return null;
  if (AGGREGATOR_LABEL.test(o)) return null;
  for (const [re, fam] of LABEL_FAMILIES) if (re.test(o)) return fam;
  return o.replace(/[^a-z0-9]/g, '').slice(0, 16) || null;
}

// Multi-part public suffixes we might plausibly meet. Not exhaustive by design:
// getting one wrong only affects the readable name we invent for an unknown host.
const MULTI_TLD = /\.(co|com|net|org|gov|edu|ac)\.[a-z]{2}$/i;

function hostOf(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch { return ''; }
}

const suffixMatch = (host, suffix) => host === suffix || host.endsWith('.' + suffix);

/** Last registrable label pair, e.g. news.bbc.co.uk -> bbc.co.uk. */
function registrable(host) {
  const parts = String(host || '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const take = MULTI_TLD.test(host) ? 3 : 2;
  return parts.slice(-take).join('.');
}

function findAggregator(host) {
  return host ? AGGREGATORS.find(([h]) => suffixMatch(host, h)) || null : null;
}
function findOutlet(host) {
  if (!host) return null;
  // Longest suffix wins, so abcnews.go.com beats a bare go.com if one is ever added.
  let best = null;
  for (const row of OUTLETS) if (suffixMatch(host, row[0]) && (!best || row[0].length > best[0].length)) best = row;
  return best;
}

/** Everything known about one item's source. Never throws. */
function outletFor(url, fallbackLabel) {
  const host = hostOf(url);
  const agg = findAggregator(host);
  // "via MSN", not "MSN". The reader is being told the route, not the reporter -- we do not
  // know who filed it, and MSN does not say. "MSN (syndicated)" was the first wording and it
  // read, in the ticker's small caps, as a masthead with an apologetic footnote.
  if (agg) return { host, name: 'via ' + agg[1], family: null, syndicated: true, known: true };

  const hit = findOutlet(host);
  if (hit) return { host, name: hit[1], family: hit[2], syndicated: false, known: true };

  // A single-label host (`http://x/`, `http://localhost/`, an intranet name) is not a
  // registrable domain and cannot be a newsroom. Treat it as no URL at all rather than
  // minting a family from it -- otherwise several such items collapse into one phantom
  // source, or worse, one becomes a source that no newsroom stands behind.
  if (host && host.includes('.')) {
    // An unknown newsroom is still a newsroom. Name it by its domain -- honest and
    // checkable -- and let it count once, keyed on the registrable domain so its
    // own subdomains cannot stack.
    const dom = registrable(host);
    return { host, name: dom, family: dom.replace(/[^a-z0-9]/g, '').slice(0, 24) || null, syndicated: false, known: false };
  }

  // No usable URL. Fall back to the configured feed label, which is all we have.
  const label = String(fallbackLabel || '').trim();
  if (!label) return { host: '', name: 'Unattributed', family: null, syndicated: false, known: false };
  return {
    host: '', name: label, known: false,
    syndicated: AGGREGATOR_LABEL.test(label),
    family: familyFromLabel(label),
  };
}

const nameFor = (url, fallback) => outletFor(url, fallback).name;
const familyFor = (url, fallback) => outletFor(url, fallback).family;
const isAggregatorUrl = url => !!findAggregator(hostOf(url));

module.exports = {
  outletFor, nameFor, familyFor, isAggregatorUrl, hostOf, registrable, familyFromLabel,
  AGGREGATORS, OUTLETS, AGGREGATOR_LABEL,
};
