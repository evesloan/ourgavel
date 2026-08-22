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

// Subjects whose identity a filename can actually establish.
const AUTO_KINDS = ['place', 'institution', 'object', 'document-scan'];

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
  return { ok: true };
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
  const haveLocal = new Set(media.map(m => m.local).filter(Boolean));
  const imageCount = media.filter(m => m.type === 'image').length;

  const added = [], queued = [], rejected = [];
  if (imageCount >= PER_CASE_CAP) return { added, queued, rejected, note: 'case already at image cap' };

  let budget = Math.min(PER_RUN_ADD, PER_CASE_CAP - imageCount);

  for (const q of queries) {
    if (budget <= 0) break;
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
      if (budget <= 0) break;
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
      added.push({
        type: 'image',
        local: finalRel,
        url: hit.descriptionUrl,
        source: hit.descriptionUrl,
        caption: q.caption || String(hit.title).replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
        alt: q.alt || q.caption || '',
        credit: hit.attribution,
        rights: hit.rights,
        licence: hit.licence,
        licenceUrl: hit.licenceUrl || '',
        bytes: got.bytes,
        addedAt: opts.now || new Date().toISOString(),
        verified: 'commons-api',
      });
      budget--;
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
