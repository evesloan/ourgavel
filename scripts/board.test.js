/* board.test.js — is the shared artifact structurally honest?
 * Run: node scripts/board.test.js   (no browser, no build required)
 *
 * The board is the one thing we ask other people to embed on their own sites, and until this
 * suite existed nothing checked it. `build.js` renders whatever `board.json` says. `audit.js`
 * only checks where readers get sent. `preflight.js` only checks that the JSON parses. A
 * dangling edge, a card floating unconnected, or a claim with no citation would all have
 * rendered normally, on a creator's page, looking exactly as authoritative as a sound one.
 *
 * SCOPE. This is the INTEGRITY half only. Geometry — overlap, coordinates, the reader-zone
 * columns — belongs to `scripts/board-layout.test.js` and is deliberately not repeated here.
 * The single exception is the reserved reader lane (x >= 1100), which is an editorial rule
 * from AGENT.md about whose space that is, not a collision check.
*
 * Written as promises rather than as functions, because four times running the site's bugs
 * have turned out to live inside the promises it makes. The promises here are: every card is
 * a real card; every line goes somewhere real; nothing on the record side is uncited; and no
 * card is stranded.
 *
 * Vocabularies are READ OUT of the code that renders them (`build.js`'s verb map, AGENT.md's
 * reserved lane) rather than restated here. A list written in two places is the single most
 * common defect in this codebase — five instances found so far — and a test that restates one
 * is just a sixth copy waiting to drift.
 *
 * Single-sourced nodes are REPORTED, not failed. Sometimes one outlet is all there is, and a
 * test that demanded two would push someone toward padding a citation to satisfy it.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CASES = path.join(ROOT, 'data', 'cases');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL  ' + m)); };

// ---------------------------------------------------------------- vocabularies, read not restated
const BUILD = fs.readFileSync(path.join(ROOT, 'scripts', 'build.js'), 'utf8');

// The edge types build.js can actually draw. Anything else renders as a blank connector.
const verbLine = BUILD.match(/const verb = \{.*\};/);
const EDGE_TYPES = verbLine ? [...verbLine[0].matchAll(/(\w+):\s*\[/g)].map(m => m[1]) : [];

// The lane AGENT.md reserves for readers.
const agent = fs.readFileSync(path.join(ROOT, 'AGENT.md'), 'utf8');
const laneM = agent.match(/never place a node at x\s*[>≥]=?\s*(\d+)/i);
const READER_LANE = laneM ? Number(laneM[1]) : null;

// The record-side card types build.js knows how to colour.
const NODE_TYPES = ['fact', 'testimony', 'exhibit', 'question', 'resolved', 'rumor'];
const STATUSES = ['verified', 'open', 'resolved', 'unverified'];

console.log('\n--- the suite reads the code, not a copy of it ---');
ok(EDGE_TYPES.length >= 4, `read ${EDGE_TYPES.length} edge types out of build.js: ${EDGE_TYPES.join(', ')}`);
ok(READER_LANE !== null, `read the reserved reader lane out of AGENT.md: x >= ${READER_LANE}`);

const slugs = fs.readdirSync(CASES)
  .filter(s => fs.existsSync(path.join(CASES, s, 'board.json'))).sort();
ok(slugs.length > 0, `found ${slugs.length} board(s) to check`);

const MARKERS = /^(<{7}|={7}|>{7})/m;   // a merge conflict committed into rendered prose
const thin = [];                         // single-sourced nodes: reported, never failed
let nodesSeen = 0, edgesSeen = 0;

for (const slug of slugs) {
  const read = f => {
    const p = path.join(CASES, slug, f);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { nodes: [], edges: [] };
  };
  const board = read('board.json');
  const community = read('community.json');

  // A reader's card is on the same board as ours and rendered by the same code, so structure
  // and connection are checked across both. Only CITATION differs: see promise 3.
  const record = board.nodes || [];
  const reader = community.nodes || [];
  const nodes = [...record, ...reader];
  const edges = [...(board.edges || []), ...(community.edges || [])];
  nodesSeen += nodes.length; edgesSeen += edges.length;

  console.log(`\n--- ${slug} — ${record.length} record + ${reader.length} reader cards, ${edges.length} lines ---`);

  // ---------------------------------------------------- PROMISE 1: every card is a real card
  const ids = nodes.map(n => n.id);
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  ok(dupes.length === 0, `${slug}: card ids are unique${dupes.length ? ' — DUPLICATED: ' + dupes.join(', ') : ''}`);

  const missing = nodes.filter(n => !n.id || !n.title || !n.body || !n.type || !n.status);
  ok(missing.length === 0, `${slug}: every card has an id, type, status, title and body${missing.length ? ' — missing on: ' + missing.map(n => n.id || '(no id)').join(', ') : ''}`);

  const badType = nodes.filter(n => n.type && !NODE_TYPES.includes(n.type));
  ok(badType.length === 0, `${slug}: every card is a type the renderer can colour${badType.length ? ' — unknown: ' + badType.map(n => n.id + '=' + n.type).join(', ') : ''}`);

  const badStatus = nodes.filter(n => n.status && !STATUSES.includes(n.status));
  ok(badStatus.length === 0, `${slug}: every card carries a known status${badStatus.length ? ' — unknown: ' + badStatus.map(n => n.id + '=' + n.status).join(', ') : ''}`);

  // A merge marker in a title reaches a reader looking like part of the record.
  const prose = [board.note || '', community.note || '',
    ...nodes.flatMap(n => [n.title, n.body, ...(n.sources || []).map(s => s.outlet)]),
    ...edges.map(e => e.label)].filter(Boolean);
  const marked = prose.filter(t => MARKERS.test(t));
  ok(marked.length === 0, `${slug}: no merge-conflict marker in anything a reader sees${marked.length ? ' — in: ' + JSON.stringify(marked[0].slice(0, 60)) : ''}`);

  // ------------------------------------------------ PROMISE 2: every line goes somewhere real
  const byId = new Set(ids);
  const dangling = edges.filter(e => !byId.has(e.from) || !byId.has(e.to));
  ok(dangling.length === 0, `${slug}: every line connects two cards that exist${dangling.length ? ' — dangling: ' + dangling.map(e => e.from + '->' + e.to).join(', ') : ''}`);

  const loops = edges.filter(e => e.from === e.to);
  ok(loops.length === 0, `${slug}: no card argues with itself${loops.length ? ' — self-loop on: ' + loops.map(e => e.from).join(', ') : ''}`);

  const badEdge = edges.filter(e => !EDGE_TYPES.includes(e.type));
  ok(badEdge.length === 0, `${slug}: every line is a relation build.js can draw${badEdge.length ? ' — unknown: ' + badEdge.map(e => e.from + '-' + e.type + '->' + e.to).join(', ') : ''}`);

  const unlabelled = edges.filter(e => !e.label || !String(e.label).trim());
  ok(unlabelled.length === 0, `${slug}: every line says what it means${unlabelled.length ? ' — unlabelled: ' + unlabelled.map(e => e.from + '->' + e.to).join(', ') : ''}`);

  const seenE = new Set(), dupE = [];
  for (const e of edges) { const k = e.from + '|' + e.type + '|' + e.to; seenE.has(k) ? dupE.push(k) : seenE.add(k); }
  ok(dupE.length === 0, `${slug}: no line is drawn twice${dupE.length ? ' — duplicated: ' + dupE.join(', ') : ''}`);

  // ------------------------------------ PROMISE 3: nothing on the RECORD side is uncited
  // Reader cards are exempt on purpose. A reader theory is labelled as a theory precisely
  // because it has no citation yet; demanding one would delete the reader lane.
  const uncited = record.filter(n => !(n.sources || []).length);
  ok(uncited.length === 0, `${slug}: every record card cites something${uncited.length ? ' — uncited: ' + uncited.map(n => n.id).join(', ') : ''}`);

  const badSrc = [];
  for (const n of record) for (const s of (n.sources || [])) {
    if (!s.outlet || !String(s.outlet).trim()) badSrc.push(n.id + ': source with no outlet');
    else if (!/^https:\/\/\S+$/.test(String(s.url || ''))) badSrc.push(n.id + ': ' + s.outlet + ' -> ' + JSON.stringify(s.url));
  }
  ok(badSrc.length === 0, `${slug}: every citation names an outlet and an absolute https link${badSrc.length ? ' — ' + badSrc.join('; ') : ''}`);

  record.filter(n => (n.sources || []).length === 1).forEach(n => thin.push(slug + '/' + n.id));

  // --------------------------------------------------- PROMISE 4: no card is stranded
  // A board's whole value is what connects to what. An unconnected card is a claim with no
  // argument around it — which is how `r-mclean` sat on the Clancy board reading as evidence.
  const touched = new Set(edges.flatMap(e => [e.from, e.to]));
  const orphans = nodes.filter(n => !touched.has(n.id));
  ok(orphans.length === 0, `${slug}: no card floats unconnected${orphans.length ? ' — ORPHAN: ' + orphans.map(n => n.id).join(', ') : ''}`);

  // ------------------------------------ PROMISE 5: the reader lane belongs to readers
  if (READER_LANE !== null) {
    const trespass = record.filter(n => typeof n.x === 'number' && n.x >= READER_LANE);
    ok(trespass.length === 0, `${slug}: no record card sits in the reader lane (x >= ${READER_LANE})${trespass.length ? ' — ' + trespass.map(n => n.id + '@' + n.x).join(', ') : ''}`);
  }
}

console.log('\n--- reported, not failed ---');
console.log(`  ${thin.length} record card(s) rest on a single source. That is allowed; it is not`);
console.log('  invisible. Sometimes one outlet is all there is — but it should be a decision.');
thin.forEach(t => console.log('    · ' + t));

console.log(`\n  ${nodesSeen} cards and ${edgesSeen} lines checked across ${slugs.length} boards.`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log(fail ? '  The shared artifact is not sound. Do not ship it to a creator.' : '  The boards hold.');
process.exit(fail ? 1 : 0);
