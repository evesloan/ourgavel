#!/usr/bin/env node
/* EMBED_FOOTER_LINK_V1 — a site-wide footer link to the /embed/ landing page.
 *
 * Ships as the SEO handoff plan's `run` target and composes its one change onto whatever
 * build.js is on origin at apply time, so build.js — the most contended file in the repo —
 * is never overwritten wholesale. Re-running is a no-op, guarded by the footer link itself.
 * If the footer anchor has moved or is no longer unique, it throws and the applier reverts:
 * a loud failure, never a silent bad build.
 *
 * node-18-safe on purpose: plain string ops only (indexOf/includes/replace), no node-21+
 * APIs — the applier gate runs node 20, and green-on-22/red-on-20 is a proven failure class.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const f = path.join(__dirname, 'build.js');
let s = fs.readFileSync(f, 'utf8');

// The link we insert doubles as the idempotency sentinel: present already => nothing to do.
const FOOTER_LINK = '<a href="/embed/">Embed a board</a>';
if (s.indexOf(FOOTER_LINK) >= 0) {
  console.log('embed-footer-link: already present, no-op');
  process.exit(0);
}

// Anchor on the footer's own "Full policies" link — one occurrence, in the shared page() footer.
const ANCHOR = '<a href="/about/">Full policies</a>';
const first = s.indexOf(ANCHOR);
if (first < 0) throw new Error('embed-footer-link: footer anchor not found');
if (s.indexOf(ANCHOR, first + 1) >= 0) throw new Error('embed-footer-link: footer anchor not unique');

// Insert " · Embed a board" immediately after Full policies, matching the footer's
// existing middot separators. · is written as an escape so the file stays ASCII-clean.
s = s.replace(ANCHOR, ANCHOR + ' · ' + FOOTER_LINK);

fs.writeFileSync(f, s);
console.log('embed-footer-link: added site-wide footer link to /embed/');
