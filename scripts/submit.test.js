/* Consistency across the submission chain. Run: node scripts/submit.test.js
 *
 * Three programs have to agree on this and none of them imports the others: the composer in
 * build.js names a kind, the Worker turns it into a GitHub issue under a set of headings, and
 * poll.js reads those headings back. Drift between them is silent — a Worker heading the pulse
 * cannot read does not error, it just holds every submission for review forever.
 *
 * This reads the three files as text and checks they still line up. Crude on purpose: it needs
 * no network, no deployment, and no GitHub.
 */
const fs = require('fs'), path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const build = R('build.js'), worker = R('worker/ourgavel-submit.js'), poll = R('poll.js');

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : (fail++, console.log('  FAIL  ' + n + (x ? ' — ' + x : ''))); };

// What the composer can send.
const modeBlock = build.slice(build.indexOf('var MODES={'), build.indexOf('};', build.indexOf('var MODES={')));
const modes = [...modeBlock.matchAll(/^\s*([a-z]+):\{t:/gm)].map(m => m[1]);
// What the Worker will accept.
const kindBlock = worker.slice(worker.indexOf('const KINDS = {'), worker.indexOf('};', worker.indexOf('const KINDS = {')));
const kinds = [...kindBlock.matchAll(/^\s*([a-z]+):\s*\{/gm)].map(m => m[1]);

console.log('\n  composer modes: ' + modes.join(', '));
console.log('  worker kinds:   ' + kinds.join(', '));
ok('every mode the composer offers, the relay accepts', modes.every(m => kinds.includes(m)),
  modes.filter(m => !kinds.includes(m)).join(', ') + ' would be rejected as "unknown kind"');
ok('the relay accepts nothing the composer cannot produce', kinds.every(k => modes.includes(k)),
  kinds.filter(k => !modes.includes(k)).join(', '));
ok('a question is one of them', modes.includes('question') && kinds.includes('question'));

// Headings: what the Worker writes, versus what the pulse can read.
const written = [...worker.matchAll(/### ([A-Z][^`\n]*?)`/g)].map(m => m[1].trim());
const readable = new Set([
  ...[...poll.matchAll(/\bfield\(\s*iss\.body\s*,\s*'([^']+)'/g)].map(m => m[1]),
  ...[...poll.matchAll(/firstField\(\s*iss\.body\s*,\s*([^)]+)\)/g)].flatMap(m => [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])),
  ...[...poll.matchAll(/claimLabels:\s*\[([^\]]+)\]/g)].flatMap(m => [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])),
  ...[...poll.matchAll(/\.\.\.KIND\.claimLabels/g)].map(() => null).filter(Boolean),
]);
// Structural headings the pulse does not need to parse.
const STRUCTURAL = new Set(['Card', 'From', 'To', 'Relation', 'What is wrong', 'Source']);
const unreadable = written.filter(h => !STRUCTURAL.has(h) && !readable.has(h));
console.log('  worker headings: ' + written.join(' | '));
ok('every heading the relay writes, the pulse can read', unreadable.length === 0,
  unreadable.join(', ') + ' — submissions under these would be held for review forever');

// The GitHub issue templates are the other producer.
const tplDir = path.join(__dirname, '..', '.github', 'ISSUE_TEMPLATE');
if (fs.existsSync(tplDir)) {
  for (const f of fs.readdirSync(tplDir).filter(f => /\.ya?ml$/.test(f))) {
    const y = fs.readFileSync(path.join(tplDir, f), 'utf8');
    for (const m of y.matchAll(/^\s*label:\s*(.+?)\s*$/gm)) {
      const l = m[1].replace(/^["']|["']$/g, '');
      if (/theory|know|question/i.test(l)) {
        ok('template ' + f + ' label "' + l + '" is readable by the pulse', readable.has(l));
      }
    }
  }
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\n  THE SUBMISSION CHAIN IS INCONSISTENT — posts would vanish into the review queue.\n'); process.exit(1); }
console.log('  Composer, relay and pulse still agree.\n');
