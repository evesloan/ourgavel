/* board-correction.test.js — does a board card keep the promise the site makes about it?
 * Run: node scripts/board-correction.test.js   (no browser; builds into a throwaway temp tree)
 *
 * The site tells readers, in three places (/about/, the case-page footer, and the correction
 * composer): "We fix it in place, in public, with a note saying what changed. No quiet edits."
 * That promise is about the BOARD cards — the shared artifact other people embed. Until this
 * suite existed, build.js rendered a correction only on the legal explainer
 * (legalStandard.correction), never on a board node. A factual fix to a card therefore WAS the
 * quiet edit the page swears off, and an embedder's copy would show the changed fact with no
 * trace that it had changed.
 *
 * This suite fails if a board node carrying { correction: { date, note } } does not show that
 * note on every surface the node appears: the reader-visible card list, the interactive detail
 * panel's escaped data blob, and the machine-readable board/data.json that embedders reuse.
 *
 * Behavioral and isolated: it copies the tree to a temp ROOT, injects ONE correction, runs the
 * real build, and reads the output. No real case data is mutated. The injected note is laced
 * with HTML metacharacters, so "it renders" also proves "it escapes".
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL  ' + m)); };

const NOTE = 'Earlier said <b>May 2026</b>; the filing says May 2027. "Corrected" & confirmed.';
const DATE = '2026-08-28';
const ESCAPED = '&lt;b&gt;May 2026&lt;/b&gt;'; // what the raw <b>May 2026</b> must become

console.log('\n--- the board must keep the "no quiet edits" promise the site prints ---');

// 1. the promise actually exists in the site copy (read out of build.js, not assumed here)
const BUILD = fs.readFileSync(path.join(ROOT, 'scripts', 'build.js'), 'utf8');
ok(/fix it in place, in public, with a note saying what changed/i.test(BUILD),
  'the site still prints the "no quiet edits" promise the board is on the hook for');

// 2. build a throwaway copy with exactly one corrected board node
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-corr-'));
try {
  // Copy only what build.js reads (data/, scripts/, and the three root marker files) — not the
  // whole tree, so this stays cheap when it runs inside the gate on every future handoff.
  execFileSync('cp', ['-r', path.join(ROOT, 'data'), path.join(tmp, 'data')]);
  execFileSync('cp', ['-r', path.join(ROOT, 'scripts'), path.join(tmp, 'scripts')]);
  for (const f of ['CNAME', 'INDEXNOW_KEY', 'SUBMIT_ENDPOINT']) {
    if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
  }
  const casesDir = path.join(tmp, 'data', 'cases');
  const slug = fs.readdirSync(casesDir).find(s => {
    const bj = path.join(casesDir, s, 'board.json');
    return fs.existsSync(bj) && (JSON.parse(fs.readFileSync(bj, 'utf8')).nodes || []).length;
  });
  ok(!!slug, 'found a case with at least one board node to correct');

  const boardPath = path.join(casesDir, slug, 'board.json');
  const board = JSON.parse(fs.readFileSync(boardPath, 'utf8'));
  const nodeId = board.nodes[0].id;
  board.nodes[0].correction = { date: DATE, note: NOTE };
  fs.writeFileSync(boardPath, JSON.stringify(board, null, 2));

  execFileSync('node', [path.join(tmp, 'scripts', 'build.js')], { cwd: tmp, stdio: 'pipe' });

  const boardHtml = fs.readFileSync(
    path.join(tmp, 'public', 'cases', slug, 'board', 'index.html'), 'utf8');
  const dataJson = JSON.parse(fs.readFileSync(
    path.join(tmp, 'public', 'cases', slug, 'board', 'data.json'), 'utf8'));

  // 3. it shows on the reader-visible card list, labelled with its formatted date, escaped
  ok(boardHtml.includes('Correction, Aug 28, 2026.'),
    'the reader card labels the correction with its formatted date');
  ok(boardHtml.includes(ESCAPED),
    'the reader card shows the correction note HTML-escaped');

  // 4. it also rides in the interactive detail-panel data blob (which the client renders on
  //    click). That blob is JSON embedded in <script>, so its values are unicode-escaped
  //    (&lt; not &lt;) — a distinct surface from the card list above.
  ok(boardHtml.includes('"date":"Aug 28, 2026"'),
    'the detail-panel data carries the correction date for the interactive board');
  ok(boardHtml.includes('\\u0026lt;b\\u0026gt;May 2026'),
    'the detail-panel data carries the correction note, script-safe escaped');

  // 5. never as raw markup, on any surface
  ok(!boardHtml.includes('<b>May 2026</b>'),
    'no raw markup from the note reaches the page (it is escaped, not injected)');

  // 5. the embed feed carries the correction so reused/embedded boards show it too
  const corrected = (dataJson.nodes || []).find(n => n.id === nodeId);
  ok(corrected && corrected.correction && corrected.correction.note === NOTE,
    'board/data.json carries the correction note for embedders (JSON string is inert)');
  ok(corrected && corrected.correction.date === DATE,
    'the embed feed keeps the correction date');

  // 6. nodes without a correction stay clean — no phantom notes anywhere
  const clean = (dataJson.nodes || []).filter(n => n.id !== nodeId);
  ok(clean.every(n => !('correction' in n)),
    'nodes without a correction carry none in the embed feed');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nboard-correction.test.js: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
