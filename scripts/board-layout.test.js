/* Board geometry. Run: node scripts/board-layout.test.js
 *
 * Cards on the board are positioned by absolute coordinates written in two different places:
 * `data/cases/<slug>/board.json` for the record side, and `scripts/poll.js` for reader
 * submissions, which lays them out in columns as they arrive. Nothing checked that the two
 * agree, and they did not.
 *
 * The reader zone put theories at x=1160 and 1160+240, each 210 wide — so out to 1610 — and
 * questions at 1470. A case with two theories and one question drew them on top of each other.
 * Nobody would see that until a real reader posted the third thing.
 *
 * The invitation cards had the same class of bug by hand: a leftover transparent hit-rect at
 * the theory card's coordinates sat inside the question group, so tapping "your theory goes
 * here" opened the question composer, and the mascot was drawn straight across the question
 * card.
 *
 * So this asserts the one thing that makes a board readable: no two things occupy the same
 * space. It reads the real data and the real generator constants, not fixtures.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NW = 210, NH = 78;          // must match boardPage() in build.js
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL  ' + m)); };

const hit = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
const box = n => ({ x: n.x, y: n.y, w: NW, h: NH, id: n.id });

console.log('\n--- No two cards may occupy the same space, on any live board ---');
const slugs = fs.readdirSync(path.join(ROOT, 'data', 'cases'))
  .filter(s => fs.existsSync(path.join(ROOT, 'data', 'cases', s, 'board.json'))).sort();

for (const slug of slugs) {
  const read = f => { const p = path.join(ROOT, 'data', 'cases', slug, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { nodes: [], edges: [] }; };
  const nodes = [...(read('board.json').nodes || []), ...(read('community.json').nodes || [])]
    .filter(n => typeof n.x === 'number' && typeof n.y === 'number');
  const clashes = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (hit(box(nodes[i]), box(nodes[j]))) clashes.push(nodes[i].id + ' / ' + nodes[j].id);
    }
  }
  ok(clashes.length === 0, slug + ': ' + clashes.length + ' overlapping pair(s) — ' + clashes.slice(0, 3).join(', '));
  if (!clashes.length) console.log('  ok    ' + slug.padEnd(28) + nodes.length + ' cards, none overlapping');
}

console.log('--- The reader zone must stay non-overlapping however many arrive ---');
// Read the real columns out of poll.js rather than restating them here — restating a constant
// in a test is how the two drift apart, which is the defect this file exists to catch.
const poll = fs.readFileSync(path.join(ROOT, 'scripts', 'poll.js'), 'utf8');
const block = poll.slice(poll.indexOf('const SUBMISSION_KINDS'), poll.indexOf('async function ingestTheories'));
const kinds = [...block.matchAll(/(\w+):\s*\{[\s\S]*?label:\s*'(\w+)'[\s\S]*?column:\s*(\d+)/g)]
  .map(m => ({ key: m[1], label: m[2], column: +m[3] }));
ok(kinds.length >= 2, 'read the submission kinds out of poll.js (got ' + kinds.length + ')');

// poll.js places the nth card of a kind at column + (n % 2) * 240, y = 80 + floor(n / 2) * 150.
const place = (col, n) => ({ x: col + (n % 2) * 240, y: 80 + Math.floor(n / 2) * 150, w: NW, h: NH });
const CAP = 12;   // far more than a case is likely to hold, and cheap to check
const placed = [];
for (const k of kinds) for (let n = 0; n < CAP; n++) placed.push({ kind: k.label, n, ...place(k.column, n) });
const zoneClashes = [];
for (let i = 0; i < placed.length; i++) {
  for (let j = i + 1; j < placed.length; j++) {
    if (hit(placed[i], placed[j])) zoneClashes.push(`${placed[i].kind}#${placed[i].n} / ${placed[j].kind}#${placed[j].n}`);
  }
}
ok(zoneClashes.length === 0, `${CAP} of each kind collide in ${zoneClashes.length} pair(s) — first: ${zoneClashes[0] || ''}`);
if (!zoneClashes.length) console.log('  ok    ' + CAP + ' of every kind (' + kinds.map(k => k.label).join(', ') + ') lay out clear of each other');

// And state the arithmetic, so a future column change fails here rather than on a live board.
for (const k of kinds) {
  const others = kinds.filter(o => o.label !== k.label);
  for (const o of others) {
    const kEnd = k.column + 240 + NW, oStart = o.column;
    if (o.column > k.column) ok(oStart >= kEnd, `${o.label} column (${oStart}) must start at or after ${k.label} ends (${kEnd})`);
  }
}

console.log('--- The two invitation cards, and the mascot between them ---');
const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build.js'), 'utf8');
ok(!/fill="none" stroke="var\(--(amber|violet)\)" stroke-width="2" stroke-dasharray/.test(build),
  'an invitation card must have a hit area — fill="none" is not hit-testable in SVG, so the card looks tappable and is not');
const strayRect = (build.match(/<rect x="\$\{zoneX\}" y="80"[^>]*fill="transparent"><\/rect>/g) || []).length;
ok(strayRect === 0, 'no stray hit-rect at the theory card position inside the question group (found ' + strayRect + ')');
ok(/translate\(\$\{zoneX \+ NW \/ 2 - 22\},\$\{80 \+ 2 \* \(NH \+ 14\) \+ 16\}\)/.test(build),
  'the mascot sits below both invitation cards, not across the second one');

console.log('--- The board must not trap a phone ---');
ok(/@media \(hover:none\) and \(pointer:coarse\)\{[^}]*#boardwrap\{touch-action:pan-y\}/.test(build.replace(/\s+/g, ' ').replace(/ \{/g, '{')),
  'on a touch device the page keeps the vertical axis, or a reader cannot scroll past the board');
ok(/#boardsvg g\.node,#boardsvg \.ctanode\{touch-action:none\}/.test(build),
  'cards keep touch-action:none so dragging one still works in every direction');
ok(/if\(!e\.cancelable\)\{pointerUp\(\);return\}/.test(build),
  'a non-cancelable touchmove means the browser owns the gesture — let go rather than calling preventDefault on it');

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\n  CARDS ARE OVERLAPPING OR THE BOARD TRAPS A PHONE.\n'); process.exit(1); }
console.log('  Board geometry is clear and the page can still scroll.\n');
