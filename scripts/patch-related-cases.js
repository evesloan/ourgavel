#!/usr/bin/env node
/* One-shot, idempotent patch: internal cross-links between related cases.
 *
 * Ships via the SEO handoff pipeline as the plan's `run` target. It touches build.js (the most
 * contended file in the repo) and two case.json files, so it composes its change onto whatever
 * is on origin at apply time instead of overwriting whole files: build.js is patched by unique
 * anchors, and each case.json gets one key added only if absent. Re-running is a no-op, guarded
 * by the RELATED_CASES_V1 sentinel. If any anchor has moved it throws and the applier reverts.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const buildPath = path.join(__dirname, 'build.js');
let s = fs.readFileSync(buildPath, 'utf8');

const FN = Buffer.from('Ci8qIFJFTEFURURfQ0FTRVNfVjEg4oCUIGludGVybmFsIGNyb3NzLWxpbmtzIGJldHdlZW4gY2FzZXMgdGhhdCBzaGFyZSBvbmUgdW5kZXJseWluZyBtYXR0ZXIKICAgKGEgY29uY2x1ZGVkIGNhc2UgdG8gaXRzIHN0aWxsLXBlbmRpbmcgc3VjY2Vzc29yLCBhbmQgYmFjaykuIERhdGEtZHJpdmVuIGZyb20gY2FzZS5qc29uCiAgIGByZWxhdGVkQ2FzZXNgOyBhIGxpbmsgcmVuZGVycyBvbmx5IHdoZW4gdGhlIHRhcmdldCBjYXNlIGlzIGFjdHVhbGx5IGJ1aWx0IHRoaXMgcnVuLCBuZXZlcgogICB0byBpdHNlbGYsIGFuZCBldmVyeSByZWxhdGlvbnNoaXAgbmFtZXMgdGhlIHNvdXJjZSB0aGF0IGJhY2tzIGl0LiBTdGFuZGluZyBTRU8gcHJpb3JpdHk6CiAgIGRlbGliZXJhdGUgaW50ZXJuYWwgbGlua2luZyB0aGF0IGhhbmRzIGNyYXdsIGVxdWl0eSBiZXR3ZWVuIHJlbGF0ZWQgYm9hcmRzLiAqLwpmdW5jdGlvbiByZWxhdGVkQmxvY2soYykgewogIGNvbnN0IHJlbHMgPSAoYy5jYXNlLnJlbGF0ZWRDYXNlcyB8fCBbXSkKICAgIC5tYXAociA9PiAoeyByLCB0OiBDQVNFUy5maW5kKHggPT4geC5zbHVnID09PSByLnNsdWcpIH0pKQogICAgLmZpbHRlcih4ID0+IHgudCAmJiB4LnQuc2x1ZyAhPT0gYy5zbHVnKTsKICBpZiAoIXJlbHMubGVuZ3RoKSByZXR1cm4gJyc7CiAgY29uc3QgaXRlbXMgPSByZWxzLm1hcCgoeyByLCB0IH0pID0+IHsKICAgIGNvbnN0IGxhYmVsID0gci5sYWJlbCB8fCB0LmNhc2Uuc2hvcnRUaXRsZTsKICAgIHJldHVybiBgPHAgc3R5bGU9Im1hcmdpbjowIDAgMTBweCI+PGEgaHJlZj0iL2Nhc2VzLyR7dC5zbHVnfS8iPiR7ZXNjKGxhYmVsKX0gJnJhcnI7PC9hPjxicj48c3BhbiBzdHlsZT0iZm9udC1zaXplOjE0cHg7Y29sb3I6dmFyKC0tbXV0KSI+JHtlc2Moci5ub3RlKX08L3NwYW4+ICR7c3JjTGlua3Moci5zb3VyY2VzKX08L3A+YDsKICB9KS5qb2luKCcnKTsKICByZXR1cm4gYDxoMj5SZWxhdGVkIGNhc2U8L2gyPjxkaXYgY2xhc3M9ImNhcmQiPiR7aXRlbXN9PC9kaXY+YDsKfQo=', 'base64').toString('utf8');

function replaceOnce(hay, needle, repl, label) {
  const i = hay.indexOf(needle);
  if (i < 0) throw new Error('related-cases: ' + label + ' anchor not found');
  if (hay.indexOf(needle, i + 1) >= 0) throw new Error('related-cases: ' + label + ' anchor not unique');
  return hay.slice(0, i) + repl + hay.slice(i + needle.length);
}

if (s.includes('RELATED_CASES_V1')) {
  console.log('related-cases: build.js already patched, no-op');
} else {
  // 1) relatedCases coerced to a list like every other list-shaped field.
  const LF_OLD = "'mediaQueries', 'links'];";
  const LF_NEW = "'mediaQueries', 'links', 'relatedCases'];";
  s = replaceOnce(s, LF_OLD, LF_NEW, 'LIST_FIELDS');

  // 2) Define relatedBlock() just before dayBlock (top-level, hoisted).
  s = replaceOnce(s, 'function dayBlock(c, d) {', FN + '\nfunction dayBlock(c, d) {', 'fn-insert');

  // 3) Render it on the case overview, between the fact card and the media block.
  const BODY_OLD = "${mediaBlock(c)}\n${watchBlock(c)}";
  const BODY_NEW = "${relatedBlock(c)}\n${mediaBlock(c)}\n${watchBlock(c)}";
  s = replaceOnce(s, BODY_OLD, BODY_NEW, 'overview-body');

  fs.writeFileSync(buildPath, s);
  console.log('related-cases: build.js patched');
}

// 4) Add the relatedCases data to the two Bridegan co-defendant cases, only if absent.
const DATA = {
  'mario-fernandez-bridegan': [{
    slug: 'shanna-gardner',
    label: "Shanna Gardner's trial",
    note: "Bridegan's ex-wife is charged in the same murder-for-hire scheme; her trial is set for May 2027, to be tried alongside the accused gunman, Henry Tenon.",
    sources: [{ outlet: 'News4Jax/WJXT', url: 'https://www.news4jax.com/news/local/2026/08/27/judge-to-settle-final-motions-before-jury-selection-starts-monday-in-shanna-gardner-trial-in-jared-bridegan-murder/' }],
  }],
  'shanna-gardner': [{
    slug: 'mario-fernandez-bridegan',
    label: 'The Mario Fernandez verdict',
    note: "Gardner's husband was convicted of first-degree murder in the same case on Aug. 26, 2026.",
    sources: [{ outlet: 'News4JAX', url: 'https://www.news4jax.com/news/local/2026/08/26/truth-won-today-says-jared-bridegans-widow-after-mario-fernandez-convicted-of-murder-in-2022-shooting/' }],
  }],
};

let dataChanged = 0;
for (const [slug, rel] of Object.entries(DATA)) {
  const p = path.join(ROOT, 'data', 'cases', slug, 'case.json');
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (Array.isArray(c.relatedCases) && c.relatedCases.length) {
    console.log('related-cases: ' + slug + ' already has relatedCases, skipped');
    continue;
  }
  c.relatedCases = rel;
  fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
  dataChanged++;
  console.log('related-cases: ' + slug + ' relatedCases added');
}
console.log('related-cases: done (' + dataChanged + ' case file(s) updated)');
