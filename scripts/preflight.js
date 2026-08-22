/* Refuse to build on a corrupted record. Run: node scripts/preflight.js
 *
 * On 2026-08-22 merge-conflict markers were committed into a case.json and the site build
 * died with a JSON stack trace forty lines long. The cause was upstream — an autostash pop
 * that conflicted, staged blindly — but the failure surfaced here, unreadably, and STYLE.md
 * had been carrying the same wreckage for days without anyone noticing.
 *
 * So: check first, say plainly what is wrong, and name the file and line.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// `<<<<<<< ` and `>>>>>>> ` at column 0 are unambiguous. A bare `=======` is NOT: in Markdown
// it is a level-one heading underline, and flagging it would take the whole site down over a
// correctly formatted document. So it only counts as a marker in a file that has one of the
// other two.
const OPEN = /^(<<<<<<< |>>>>>>> )/;
const MIDDLE = /^=======\s*$/;
const SKIP = new Set(['node_modules', '.git', 'public']);

const problems = [];

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(json|md|js|ya?ml|html|txt)$/i.test(e.name)) continue;
    let text;
    try { text = fs.readFileSync(p, 'utf8'); } catch (err) { continue; }
    // preflight.js itself names the markers in prose; do not flag the checker.
    if (path.resolve(p) !== path.resolve(__filename)) {
      const lines = text.split('\n');
      const conflicted = lines.some(l => OPEN.test(l));
      lines.forEach((line, i) => {
        if (OPEN.test(line) || (conflicted && MIDDLE.test(line))) {
          problems.push({ file: path.relative(ROOT, p), line: i + 1, why: 'merge-conflict marker: ' + line.slice(0, 40) });
        }
      });
    }
    if (/\.json$/i.test(e.name)) {
      try { JSON.parse(text); }
      catch (err) { problems.push({ file: path.relative(ROOT, p), line: 0, why: 'invalid JSON — ' + String(err.message).slice(0, 90) }); }
    }
  }
}
walk(ROOT);

if (problems.length) {
  console.error('\n  THE RECORD IS CORRUPTED — refusing to build.\n');
  for (const p of problems) console.error('    ' + p.file + (p.line ? ':' + p.line : '') + '  ' + p.why);
  console.error('\n  This is almost always a conflicted `git pull --rebase --autostash` that got');
  console.error('  staged and committed. Resolve the file by hand, then re-run.\n');
  if (require.main === module) process.exit(1);
  throw new Error('preflight failed: ' + problems.length + ' problem(s)');
}
if (require.main === module) console.log('\n  Record intact: every JSON file parses, no conflict markers.\n');
module.exports = { problems };
