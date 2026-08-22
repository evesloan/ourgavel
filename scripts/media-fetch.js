/* OurGavel — media acquisition.
 *
 * media.js answers "may we publish this file?". This answers two harder questions:
 * "should we?" and "how do we show it without handing the reader to a third party?".
 *
 * The second one drives the whole design. A hotlinked image is still an outbound request:
 * every reader of a murder-trial page would be logged by whoever hosts the file. So nothing
 * is hotlinked. Verified files are copied onto our own origin at build time, which is why
 * the policy can stay `img-src 'self'` and why a case page still makes zero external
 * requests after this runs.
 *
 * The first question is where the real risk lives. Commons will happily return a photograph
 * of *a* Lindsay Clancy. Publishing the wrong person's face on a page about a killing is not
 * a bug we get to fix with a correction note, so:
 *
 *   AUTO   places, buildings, institutions, objects — a courthouse has one identity and the
 *          file title says so. Every hit must additionally clear a token gate written into
 *          the case file by hand.
 *   QUEUE  anything depicting a named individual. No exceptions, no confidence threshold.
 *          Identity cannot be established from a filename and we will not pretend otherwise.
 *
 * No dependencies. Node 18+.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { commonsSearch, commonsVerify } = require('./media.js');

const MAX_BYTES = 3_000_000;    // a 1200px JPEG lands far under this; anything bigger is wrong
const MIN_WIDTH = 640;          // below this it renders as a smudge in the grid
const PER_CASE_CAP = 8;         // the section is "recent photos", not an archive
const PER_RUN_ADD = 2;          // drip, so one bad query can't flood a case in a single pulse
const PER_QUERY_ADD = 1;        // one subject per query per run, so a case gains variety not duplicates

// Subjects whose identity a filename can actually establish.
const AUTO_KINDS = ['place', 'institution', 'object', 'document-scan'];

// A photograph can be of the right building and still be wrong. Commons holds a great deal
// of archival material, and a 1905 street scene captioned "the Los Angeles courthouse" reads
// on a 2026 case page as the courthouse the trial is in — one got through on the first live
// run. These markers describe the PHOTOGRAPH as historical, not the building: a current photo
// of an 1822 courthouse mentioning its construction date is fine and must stay fine.
const ARCHIVAL = [
  /\bca\.?\s*1[89]\d\d\b/i,          // "ca.1905"
  /\bcirca\s*1[89]\d\d\b/i,
  /\bc\.\s*1[89]\d\d\b/i,
  /\b(?:photo(?:graph)?|view|image)\s+(?:from|taken|dated)\s+1[89]\d\d\b/i,
  /\bhistoric(?:al)?\s+(?:photo|photograph|view|image|postcard)\b/i,
  /\bpostcard\b/i,
  /\b(?:glass\s+negative|daguerreotype|lithograph|engraving)\b/i,
];
// A bare year in the FILENAME is the photographer's own dating of the shot.
const TITLE_YEAR = /\b(1[89]\d\d|19[0-7]\d)\b/;

const MAGIC = [
  ['jpg', [0xff, 0xd8, 0xff]],
  ['png', [0x89, 0x50, 0x4e, 0x47]],
  ['gif', [0x47, 0x49, 0x46, 0x38]],
];
function sniff(buf) {
  for (const [ext, sig] of MAGIC) {
    if (sig.every((b, i) => buf[i] === b)) return ext;
  }
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF'
    && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/**
 * Would this hit actually illustrate the case, or merely match some words?
 * `q.must` tokens must ALL appear in the file's title/description/categories.
 * `q.deny` tokens disqualify outright.
 */
function relevanceGate(hit, q) {
  const kind = q.kind || 'person';
  if (!AUTO_KINDS.includes(kind)) {
    return { ok: false, queue: true, reason: 'depicts a named individual — identity cannot be verified from metadata' };
  }
  const hay = String(hit.title + ' ' + (hit.text || '')).toLowerCase();
  const must = (q.must || []).map(s => s.toLowerCase());
  if (!must.length) return { ok: false, reason: 'query declares no must-tokens' };
  const missing = must.filter(t => !hay.includes(t));
  if (missing.length) return { ok: false, reason: 'missing required token(s): ' + missing.join(', ') };
  for (const d of (q.deny || [])) {
    if (hay.includes(String(d).toLowerCase())) return { ok: false, reason: 'matched deny token: ' + d };
  }
  if (hit.width && hit.width < MIN_WIDTH) return { ok: false, reason: 'too small: ' + hit.width + 'px' };
  if (!q.allowArchival) {
    for (const re of ARCHIVAL) {
      if (re.test(hay)) return { ok: false, reason: 'archival image — it would read as the present-day venue' };
    }
    const t = String(hit.title || '').replace(/^File:/, '');
    if (TITLE_YEAR.test(t)) return { ok: false, reason: 'filename dates the photograph to ' + t.match(TITLE_YEAR)[0] };
  }
  return { ok: true };
}

/**
 * The query's caption describes the subject, so it fits the first photograph of that subject
 * and reads as a mistake on the second — including when the second arrives from a different
 * query aimed at the same place. So the caption is claimed against the whole case, not the
 * query, and anything already spoken for falls back to the file's own title.
 */
function captionFor(hit, q, taken) {
  if (q.caption && !taken.has(q.caption)) return q.caption;
  const fromTitle = String(hit.title || '')
    .replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_]+/g, ' ').replace(/\s*-\s*panoramio\s*$/i, '')
    .replace(/\s+/g, ' ').trim();
  if (fromTitle && !taken.has(fromTitle)) return fromTitle;
  return fromTitle || q.caption || 'Untitled';
}

function localName(slug, hit, ext) {
  const h = crypto.createHash('sha1').update(hit.descriptionUrl || hit.url).digest('hex').slice(0, 12);
  return path.posix.join('media', slug, h + '.' + ext);
}

/** Pull the bytes onto our own disk. Refuses anything that isn't demonstrably an image. */
async function downloadImage(url, absDest, deps = {}) {
  const f = deps.fetch || fetch;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await f(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'OurGavelBot/1.0 (+https://ourgavel.com) media-cache' },
    });
    if (!r.ok) return { ok: false, reason: 'HTTP ' + r.status };
    const ct = String(r.headers.get('content-type') || '');
    if (!/^image\//i.test(ct)) return { ok: false, reason: 'not an image response: ' + ct };
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) return { ok: false, reason: 'oversized: ' + buf.length + ' bytes' };
    if (buf.length < 1024) return { ok: false, reason: 'suspiciously small: ' + buf.length + ' bytes' };
    const ext = sniff(buf);
    if (!ext) return { ok: false, reason: 'bytes are not a recognised image format' };
    fs.mkdirSync(path.dirname(absDest), { recursive: true });
    fs.writeFileSync(absDest, buf);
    return { ok: true, bytes: buf.length, ext };
  } catch (e) {
    return { ok: false, reason: String(e.message || e).slice(0, 120) };
  } finally { clearTimeout(t); }
}

/**
 * Run a case's declared queries and return entries ready to append to case.media.
 * Never mutates the case file — the caller decides whether to write.
 */
async function discoverCase(caseObj, opts = {}) {
  const root = opts.root || process.cwd();
  // Under data/, deliberately. public/ is gitignored and rebuilt from nothing on every CI
  // run, so a photograph left there would be gone by the next pulse while case.json still
  // claimed it. data/ is what the workflow commits (`git add data`), so the bytes and the
  // record that describes them travel together — and no workflow change is needed to do it.
  const outDir = opts.outDir || path.join(root, 'data');
  const deps = opts.deps || {};
  const search = deps.search || commonsSearch;
  const verify = deps.verify || commonsVerify;
  const queries = caseObj.mediaQueries || [];
  const media = caseObj.media || [];
  const have = new Set(media.map(m => m.source || m.url).filter(Boolean));
  const takenCaptions = new Set(media.map(m => m.caption).filter(Boolean));
  const haveLocal = new Set(media.map(m => m.local).filter(Boolean));
  const imageCount = media.filter(m => m.type === 'image').length;

  const added = [], queued = [], rejected = [];
  if (imageCount >= PER_CASE_CAP) return { added, queued, rejected, note: 'case already at image cap' };

  let budget = Math.min(PER_RUN_ADD, PER_CASE_CAP - imageCount);

  for (const q of queries) {
    if (budget <= 0) break;
    let fromThisQuery = 0;
    if ((q.kind || 'person') && !AUTO_KINDS.includes(q.kind || 'person')) {
      queued.push({ query: q.q, reason: 'person subject — held for human confirmation' });
      continue;
    }
    let titles = [];
    try { titles = await search(q.q, q.limit || 8); }
    catch (e) { rejected.push({ query: q.q, reason: 'search failed: ' + e.message }); continue; }
    if (!titles.length) { rejected.push({ query: q.q, reason: 'no results' }); continue; }

    let hits = [];
    try { hits = await verify(titles); }
    catch (e) { rejected.push({ query: q.q, reason: 'verify failed: ' + e.message }); continue; }

    for (const hit of hits) {
      if (budget <= 0 || fromThisQuery >= PER_QUERY_ADD) break;
      if (!hit.ok) { rejected.push({ title: hit.title, reason: hit.reason }); continue; }
      if (have.has(hit.descriptionUrl) || have.has(hit.url)) continue;
      const gate = relevanceGate(hit, q);
      if (!gate.ok) {
        (gate.queue ? queued : rejected).push({ title: hit.title, reason: gate.reason });
        continue;
      }
      const rel = localName(caseObj.slug, hit, 'tmp');
      const got = await downloadImage(hit.thumb || hit.url, path.join(outDir, rel), deps);
      if (!got.ok) { rejected.push({ title: hit.title, reason: got.reason }); continue; }
      const finalRel = rel.replace(/\.tmp$/, '.' + got.ext);
      fs.renameSync(path.join(outDir, rel), path.join(outDir, finalRel));
      if (haveLocal.has(finalRel)) continue;
      haveLocal.add(finalRel);
      have.add(hit.descriptionUrl);
      const cap = captionFor(hit, q, takenCaptions);
      takenCaptions.add(cap);
      added.push({
        type: 'image',
        local: finalRel,
        url: hit.descriptionUrl,
        source: hit.descriptionUrl,
        caption: cap,
        alt: (cap === q.caption ? (q.alt || q.caption) : cap) || '',
        credit: hit.attribution,
        rights: hit.rights,
        licence: hit.licence,
        licenceUrl: hit.licenceUrl || '',
        bytes: got.bytes,
        addedAt: opts.now || new Date().toISOString(),
        verified: 'commons-api',
      });
      budget--;
      fromThisQuery++;
    }
    // A query that searched, verified, and yielded nothing usable used to leave no trace at
    // all — the one case where the queue could not tell me whether the query text was wrong
    // or the gate was too tight. Now it says so.
    if (!fromThisQuery && !hits.some(h => !h.ok)) {
      rejected.push({
        query: q.q,
        reason: hits.length
          ? 'nothing publishable: ' + hits.length + ' file(s) verified, none cleared the gate'
          : titles.length + ' search result(s), none were usable images (wrong file type, or no image data)',
      });
    }
  }
  return { added, queued, rejected };
}

/**
 * CI has no test step and the workflow file is protected, so the safety gate is enforced in
 * code instead. If the rights logic or the relevance gate is broken, discovery does not run
 * — the site still builds and still deploys, it simply stops adding photographs. Failing
 * safe beats failing loud when the alternative is publishing a stranger's face.
 * Memoised: the tests run once per process, not once per case.
 */
let _safe = null;
function safeToDiscover(opts = {}) {
  if (_safe !== null && !opts.force) return _safe;
  const run = opts.run || ((f) => require('child_process').execFileSync(process.execPath, [f], { stdio: 'pipe' }));
  const tests = opts.tests || ['media.test.js', 'media-fetch.test.js'].map(t => path.join(__dirname, t));
  for (const t of tests) {
    try { run(t); }
    catch (e) {
      const detail = String((e && (e.stdout || '')) + (e && (e.stderr || '')) || e.message || e).slice(-600);
      return (_safe = { ok: false, test: t, detail });
    }
  }
  return (_safe = { ok: true });
}

module.exports = {
  safeToDiscover,
  relevanceGate, downloadImage, discoverCase, localName, sniff,
  MAX_BYTES, MIN_WIDTH, PER_CASE_CAP, PER_RUN_ADD, AUTO_KINDS,
};
