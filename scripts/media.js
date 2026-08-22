/* OurGavel — media discovery.
 *
 * Finding images fast is easy. Finding images we are ALLOWED to publish is the whole
 * problem, and getting it wrong puts an infringement claim on the operator's name. So this
 * mirrors the verdict engine's shape: automate only where the evidence is machine-checkable,
 * and escalate everything else instead of guessing.
 *
 *   AUTO-PUBLISH  only from sources that return a machine-readable licence (Wikimedia
 *                 Commons), and only when that licence is on the allowlist, the file is not
 *                 marked non-free, and attribution is captured.
 *   PROPOSE       official court / sheriff / DA releases. A .gov domain is a strong prior,
 *                 not proof — government pages routinely carry wire photos they licensed.
 *                 These land in a queue for an agent to confirm.
 *   NEVER         anything else. No inference, no "probably fine".
 *
 * No dependencies. Node 18+.
 */

// Licences that permit republication with attribution. Deliberately conservative: anything
// not on this list is refused even if it looks permissive.
const FREE_LICENCES = [
  /^cc0/i, /^public domain/i, /^pd-/i, /^pd$/i,
  /^cc[ -]by(?:[ -]sa)?(?:[ -]\d(?:\.\d)?)?$/i,
  /^cc[ -]by[ -]\d(\.\d)?$/i, /^cc[ -]by[ -]sa[ -]\d(\.\d)?$/i,
];
// Phrases that mean "not ours to publish", checked before anything else.
const BLOCKED = [
  /non-?free/i, /fair use/i, /all rights reserved/i, /copyright/i, /permission/i,
  /nc\b/i, /noncommercial/i, /non-?commercial/i, /nd\b/i, /noderiv/i, /^unknown/i,
];

const strip = v => String(v == null ? '' : v).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Decide whether a Commons file may be published.
 * Takes the `extmetadata` object from the Commons imageinfo API.
 * Returns { ok, rights, licence, licenceUrl, attribution, reason }.
 */
function licenceDecision(ext) {
  const meta = ext || {};
  const get = k => strip((meta[k] || {}).value);
  const licence = get('LicenseShortName') || get('License');
  const licenceUrl = get('LicenseUrl');
  const attribution = get('Artist') || get('Credit') || 'Wikimedia Commons';
  const nonFree = get('NonFree');

  if (!licence) return { ok: false, reason: 'no licence stated' };
  if (nonFree === '1' || /^true$/i.test(nonFree)) return { ok: false, reason: 'marked non-free' };
  // NC and ND are on the blocked list, so test blockers before the allowlist.
  for (const re of BLOCKED) {
    if (re.test(licence)) return { ok: false, reason: 'licence not republishable: ' + licence };
  }
  if (!FREE_LICENCES.some(re => re.test(licence))) {
    return { ok: false, reason: 'licence not on the allowlist: ' + licence };
  }
  // CC BY and BY-SA require the licence to be identifiable to the reader.
  const isPD = /^cc0|^public domain|^pd/i.test(licence);
  if (!isPD && !licenceUrl) return { ok: false, reason: 'attribution licence with no licence URL' };

  return {
    ok: true,
    rights: isPD ? 'public-domain' : 'cc-licensed',
    licence, licenceUrl, attribution,
  };
}

async function api(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'OurGavelBot/1.0 (+https://ourgavel.com) media-discovery' },
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

const COMMONS = 'https://commons.wikimedia.org/w/api.php';

/** Search Commons for files matching a query. Returns file titles. */
async function commonsSearch(query, limit = 8) {
  const url = COMMONS + '?action=query&format=json&origin=*&list=search&srnamespace=6'
    + '&srlimit=' + limit + '&srsearch=' + encodeURIComponent(query);
  const j = await api(url);
  return ((j.query || {}).search || []).map(s => s.title);
}

/** Fetch licence metadata for file titles. Returns only files that pass licenceDecision. */
async function commonsVerify(titles) {
  if (!titles.length) return [];
  const url = COMMONS + '?action=query&format=json&origin=*&prop=imageinfo'
    + '&iiprop=url|extmetadata|mime|size&iiurlwidth=1200&titles=' + encodeURIComponent(titles.join('|'));
  const j = await api(url);
  const pages = (j.query || {}).pages || {};
  const out = [];
  for (const k of Object.keys(pages)) {
    const p = pages[k];
    const ii = (p.imageinfo || [])[0];
    if (!ii) continue;
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(ii.mime || '')) continue;
    const d = licenceDecision(ii.extmetadata);
    if (!d.ok) { out.push({ title: p.title, ok: false, reason: d.reason }); continue; }
    // Everything the relevance gate needs to judge WHAT the file depicts, not just whether
    // we may republish it. Title alone is too thin — a courthouse is often filed under a
    // photographer's naming scheme with the subject only in the description or categories.
    const em = ii.extmetadata || {};
    const text = [
      strip((em.ObjectName || {}).value),
      strip((em.ImageDescription || {}).value),
      strip((em.Categories || {}).value).replace(/\|/g, ' '),
    ].filter(Boolean).join(' ');
    out.push({
      ok: true,
      title: p.title,
      url: ii.url,
      thumb: ii.thumburl || ii.url,
      descriptionUrl: ii.descriptionurl,
      width: ii.width || 0,
      height: ii.height || 0,
      text,
      rights: d.rights,
      licence: d.licence,
      licenceUrl: d.licenceUrl,
      attribution: d.attribution,
    });
  }
  return out;
}

/** Turn a verified Commons hit into a case media entry. */
function toMediaEntry(hit, caption) {
  return {
    type: 'image',
    url: hit.url,
    thumb: hit.thumb,
    caption: caption || strip(hit.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '')),
    credit: hit.attribution,
    rights: hit.rights,
    licence: hit.licence,
    licenceUrl: hit.licenceUrl,
    source: hit.descriptionUrl,
    addedAt: new Date().toISOString(),
    verified: 'commons-api',
  };
}

/**
 * Official releases: court, sheriff and DA pages. A .gov domain is a strong prior but not
 * proof of rights, so these are PROPOSED, never auto-published.
 */
const OFFICIAL = /(^|\.)(gov|courts?\.[a-z]{2}\.us|uscourts\.gov)$/i;
function isOfficialHost(u) {
  try { return OFFICIAL.test(new URL(u).hostname); } catch (e) { return false; }
}

module.exports = {
  licenceDecision, commonsSearch, commonsVerify, toMediaEntry,
  isOfficialHost, FREE_LICENCES, BLOCKED,
};
