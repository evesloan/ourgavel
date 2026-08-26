#!/usr/bin/env node
/* Splices scripts/screen.js into the Worker between the SCREEN markers, so the single
 * file Eve pastes into Cloudflare carries the exact same screen the pulse runs.
 *
 * Run after any change to screen.js:   node scripts/worker/bundle-screen.js
 * pending.test.js fails if the bundled block has drifted from screen.js — the block is
 * GENERATED; never edit it by hand inside the worker file.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'screen.js');
const WORKER = path.join(__dirname, 'ourgavel-submit.js');
const OPEN = '// ==== SCREEN (GENERATED from scripts/screen.js by bundle-screen.js — do not edit) ====';
const CLOSE = '// ==== END SCREEN ====';

function block() {
  const src = fs.readFileSync(SRC, 'utf8').replace(/^#![^\n]*\n/, '');
  return OPEN + '\nconst SCREEN = (() => { const module = { exports: {} };\n'
    + src + '\nreturn module.exports; })();\n' + CLOSE;
}
function splice(text) {
  const a = text.indexOf(OPEN), b = text.indexOf(CLOSE);
  if (a < 0 || b < 0) throw new Error('SCREEN markers not found in the worker file');
  return text.slice(0, a) + block() + text.slice(b + CLOSE.length);
}
if (require.main === module) {
  const w = fs.readFileSync(WORKER, 'utf8');
  const out = splice(w);
  if (out === w) { console.log('worker screen block: already current'); }
  else { fs.writeFileSync(WORKER, out); console.log('worker screen block: regenerated'); }
}
module.exports = { block, splice, OPEN, CLOSE };
