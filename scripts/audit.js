#!/usr/bin/env node
/* Guards the rule that a reader is never sent to GitHub to do anything.
 * Exactly one transparency link is allowed, on the About page, framed as "read the receipts".
 * Everything else must be a composer trigger. Run: node scripts/audit.js
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public');
const pages = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    e.isDirectory() ? walk(p) : e.name.endsWith('.html') && pages.push(p);
  }
})(OUT);

const ALLOWED = [{ page: 'about/index.html', max: 1, why: 'transparency link to the public repo' }];
let fail = 0, links = 0;

for (const p of pages) {
  const rel = path.relative(OUT, p).split(path.sep).join('/');
  const html = fs.readFileSync(p, 'utf8');
  const found = (html.match(/href="https:\/\/github\.com[^"]*"/g) || []);
  links += found.length;
  const allow = ALLOWED.find(a => a.page === rel);
  const budget = allow ? allow.max : 0;
  if (found.length > budget) {
    fail++;
    console.log('  FAIL ' + rel + ' — ' + found.length + ' GitHub link(s), ' + budget + ' allowed');
    found.slice(0, 4).forEach(f => console.log('        ' + f.slice(0, 100)));
  }
  // A link that lands on the issue tracker is always a workflow redirect, never transparency.
  for (const f of found) {
    if (/\/issues/.test(f)) { fail++; console.log('  FAIL ' + rel + ' — sends a reader to the issue tracker: ' + f.slice(0, 90)); }
  }
}

// Every page must carry the composer, or its buttons do nothing.
const noComposer = pages.filter(p => {
  const rel = path.relative(OUT, p).split(path.sep).join('/');
  if (rel.includes('/embed/')) return false;             // embeds are read-only by design
  return !fs.readFileSync(p, 'utf8').includes('id="gbc"');
});
if (noComposer.length) {
  fail++;
  console.log('  FAIL pages missing the composer: ' + noComposer.map(p => path.relative(OUT, p)).join(', '));
}

// And every compose trigger must name a mode the composer actually knows.
const KNOWN = ['theory', 'evidence', 'connection', 'comment', 'report', 'correction', 'request'];
for (const p of pages) {
  const html = fs.readFileSync(p, 'utf8');
  for (const m of html.matchAll(/data-compose="([^"]+)"/g)) {
    if (!KNOWN.includes(m[1])) {
      fail++;
      console.log('  FAIL ' + path.relative(OUT, p) + ' — unknown composer mode "' + m[1] + '"');
    }
  }
}

console.log('\n  ' + pages.length + ' pages scanned, ' + links + ' GitHub link(s) total.');
console.log(fail ? '\n  AUDIT FAILED (' + fail + ')\n' : '  AUDIT PASSED — no reader is sent to GitHub to do anything.\n');
process.exit(fail ? 1 : 0);
