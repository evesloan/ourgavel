/* OurGavel — canonical source links.

   Why this exists, from a real defect found 2026-08-22:

   Our Bing News feeds do not give us the article. They give us a redirector,
   `bing.com/news/apiclick.aspx?...&tid=<token>&url=<the real article>`, and the
   `tid` token is regenerated on EVERY request. `pollCase()` dedupes by hashing
   `it.link`, so the same article arrived as a brand-new item every 15 minutes.

   Measured on live data at commit eae7a31:
     lil-durk-murder-for-hire   42 items,   4 distinct headlines
     alex-murdaugh-retrial     100 items,  23 distinct headlines

   The Durk case page — an active trial — rendered the same two headlines four
   times each in its eight-row ticker. Worse, the ticker is capped at 100 items,
   so on Murdaugh real headlines were being evicted by copies of themselves.

   The link we showed the reader was also the redirector, so every click on a
   murder-trial citation went through a Microsoft click-tracker before reaching
   the newsroom. That is the same objection SECURITY.md already records against
   hotlinked images and social embeds, and the same answer applies: deep-link to
   the outlet, make the destination visible in the href, add no third party.

   Two functions, deliberately separate:
     resolveUrl(link)  what the reader is sent to. Conservative: unwrap known
                       redirectors, decode XML entities, strip tracking params.
                       Anything unrecognised is returned unchanged.
     itemKey(link)     the dedupe identity. Normalises harder (case, trailing
                       slash, remaining query) because it is never rendered.
*/
'use strict';

const { isAggregatorUrl } = require('./outlets.js');

// Feeds are XML; `&` arrives as `&amp;`. Left encoded, the query string parses
// as `amp;url=` — no `url` param at all — which is how the redirector survived
// every previous eyeball.
function decodeEntities(s) {
  let t = String(s || '');
  // Bounded loop: the feed is escaped once, but the same string escaped again on
  // the way into an href arrives as `&amp;amp;`. Three passes settles both and
  // cannot run away on hostile input.
  for (let i = 0; i < 3; i++) {
    const next = t
      .replace(/&amp;/gi, '&')
      .replace(/&#3[89];/g, m => (m === '&#38;' ? '&' : "'"))
      .replace(/&quot;/gi, '"')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>');
    if (next === t) break;
    t = next;
  }
  return t;
}

// Redirectors we know carry the destination in a query parameter. Host suffix
// match, so a look-alike host (bing.com.evil.example) does not qualify.
const REDIRECTORS = [
  { host: 'bing.com', path: /apiclick/i, param: 'url' },
  { host: 'news.google.com', path: /\/rss\//i, param: 'url' },
  { host: 'l.facebook.com', path: /./, param: 'u' },
  { host: 't.co', path: /./, param: null }, // shortener with no param: leave alone
];

// Params that identify the reader or the campaign, never the article.
const TRACKING = /^(utm_[a-z_]+|fbclid|gclid|msclkid|igshid|mc_cid|mc_eid|ocid|cvid|mkt|ref_src|ref_url|_gl)$/i;

function hostMatches(hostname, suffix) {
  const h = hostname.toLowerCase();
  return h === suffix || h.endsWith('.' + suffix);
}

function stripTracking(u) {
  const keys = [...u.searchParams.keys()];
  for (const k of keys) if (TRACKING.test(k)) u.searchParams.delete(k);
  return u;
}

/** The URL a reader should actually be sent to. Never throws. */
function resolveUrl(link) {
  const raw = decodeEntities(link).trim();
  if (!raw) return '';
  let u;
  try { u = new URL(raw); } catch { return raw; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return raw;

  // Unwrap at most a few hops — a redirector pointing at a redirector is real,
  // a cycle is not, and an unbounded loop on feed data is not worth the risk.
  for (let hop = 0; hop < 3; hop++) {
    const r = REDIRECTORS.find(x => hostMatches(u.hostname, x.host) && x.path.test(u.pathname));
    if (!r || !r.param) break;
    const inner = u.searchParams.get(r.param);
    if (!inner) break;
    let next;
    try { next = new URL(decodeURIComponent(inner)); } catch { break; }
    if (next.protocol !== 'http:' && next.protocol !== 'https:') break;
    if (next.href === u.href) break;
    u = next;
  }
  stripTracking(u);
  // A query that is now empty should not leave a dangling '?'.
  if (![...u.searchParams.keys()].length) u.search = '';
  u.hash = '';
  return u.href;
}

// MSN gives one article several slugs. Live on 2026-08-22 the Murdaugh ticker held
//   .../alex-murdaugh-s-retrial-will-be-relocated.../ar-AA2a5Bz6
//   .../alex-murdaugh-s-testimony-at-first-murder-trial.../ar-AA2a5Bz6
// -- three rows, one article, because the path differs and the `ar-` id does not.
// The id is MSN's own identity for the piece, so key on it and let the slug vary.
const MSN_ID = /\/(ar-[A-Za-z0-9]{6,})(?:[/?#]|$)/;

// The copy itself, normalised, for "is this the same STORY, filed by someone else?".
// Distinct from itemKey, which answers "is this the same URL?" -- a wire story on five
// affiliates has five perfectly good URLs and is still one piece of reporting.
// The six-word floor is deliberate: "Guilty verdict returned" is a phrase two newsrooms
// can reach independently; a fourteen-word sentence is not.
const COPY_MIN_WORDS = 6;
function copyKey(headline) {
  const t = String(headline || '')
    .replace(/\s*[|\u2013\u2014-]\s*[A-Za-z0-9 .'&]{2,30}$/, '')   // trailing " | WLTX News19"
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.split(' ').filter(Boolean).length >= COPY_MIN_WORDS ? t : '';
}

/** Stable identity for "is this the same article we already have?" */
function itemKey(link) {
  const resolved = resolveUrl(link);
  let u;
  try { u = new URL(resolved); } catch { return resolved.toLowerCase(); }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const msn = (host === 'msn.com' || host.endsWith('.msn.com')) && MSN_ID.exec(u.pathname);
  if (msn) return 'msn.com/' + msn[1].toLowerCase();
  const pathname = u.pathname.replace(/\/+$/, '') || '/';
  const q = [...u.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => k + '=' + v).join('&');
  return host + pathname.toLowerCase() + (q ? '?' + q : '');
}

/** Canonicalise and de-duplicate a ticker list in place-safe fashion.
    First occurrence wins, order preserved — the list is already newest-first
    and the oldest copy of a duplicate is the one with the true first-seen ts. */
function dedupeItems(items) {
  // Two passes, because the newest copy of a story is often the WORST one. A repost lands
  // on msn.com minutes after the newsroom files, sorts first, and under one-pass first-wins
  // it would evict the original -- sending every reader to an aggregator that names no
  // author, and handing the verdict engine a row it is required to ignore.
  const originals = new Set();
  for (const it of items || []) {
    if (isAggregatorUrl(resolveUrl(it.url))) continue;
    const c = copyKey(it.headline);
    if (c) originals.add(c);
  }
  const out = [];
  const seen = new Set();
  for (const it of items || []) {
    const url = resolveUrl(it.url);
    const k = itemKey(url);
    if (!k || seen.has(k)) continue;
    // Drop a repost only when we hold the newsroom's own copy of the same story. A repost
    // we have no original for still earns its place: it is coverage, just weaker coverage.
    if (isAggregatorUrl(url)) {
      const c = copyKey(it.headline);
      if (c && originals.has(c)) continue;
    }
    seen.add(k);
    out.push(url === it.url ? it : { ...it, url });
  }
  return out;
}

module.exports = { resolveUrl, itemKey, dedupeItems, decodeEntities, copyKey };
