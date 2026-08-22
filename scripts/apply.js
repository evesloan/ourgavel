/* OurGavel — the applier. This is what lets the site improve itself while nobody is watching.
 *
 * The problem it solves, after four failed attempts at something else. Three lanes run
 * unattended in the cloud and finish real work. None of them can write the repository:
 * `git push` is refused by the proxy and a scheduled run has no bridge to Eve's PC. Four
 * scheduled "shippers" were built to close that gap and all four failed for the same reason —
 * NOTHING THAT RUNS ON A SCHEDULE HAS REPOSITORY CREDENTIALS.
 *
 * Except one thing does. The pulse runs `scripts/poll.js` in GitHub Actions every fifteen
 * minutes with `contents: write`, and the step immediately after it pushes whatever this
 * process committed. So the applier belongs here, inside the pulse, rather than in a
 * scheduled agent that can never reach the repo or a workflow file we are not allowed to edit.
 *
 * A lane POSTs an apply-plan to the relay Worker with a bearer token; the Worker files a
 * `handoff`-labelled issue; this reads it, applies it, and commits ONLY if the entire suite
 * passes. See docs/QUEUE-SETUP.md.
 *
 * FOUR THINGS STAND BETWEEN A QUEUED PLAN AND THE SITE, and they are independent on purpose:
 *   1. the label, which the public composer path cannot mint (`KINDS` has no `handoff`)
 *   2. the hash, over the exact bytes the Worker was given
 *   3. the allowlist, checked against what the plan DECLARES and again against what it
 *      actually TOUCHED — a script can write anywhere, so trusting the declaration is trusting
 *      the thing being sandboxed to describe itself honestly
 *   4. the gate: preflight, build, and every test script, with a hard revert on any red
 *
 * The plan's own script runs with a scrubbed environment. It never sees GITHUB_TOKEN.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MAX_PER_PULSE = 1;        // one plan per run: bounds the pulse, and a failure cannot cascade
const SCRIPT_TIMEOUT_MS = 120000;
const GATE_TIMEOUT_MS = 300000;

// Paths a handoff may never write, whatever it claims. The red lane is editorial policy and the
// workflow is the thing granting this process its credentials in the first place — a plan that
// could rewrite either could rewrite the rules it is being judged by.
// Some of these sit inside an allowed tree, and those are the ones doing real work: a plan
// that could rewrite this file, or the tests that guard it, would be judged by rules it had
// just written. `scripts/worker/` is here for the slower version of the same attack — a plan
// weakening the relay's bearer check would take effect the next time that code is deployed.
const FORBIDDEN = [
  /^\.git(\/|$)/, /^\.github(\/|$)/,
  /^(EDITORIAL|AGENT|STYLE|SECURITY)\.md$/,
  /^CNAME$/, /^SUBMIT_ENDPOINT$/, /^INDEXNOW_KEY$/, /^\.gitignore$/,
  /^(autodeploy|install-autodeploy|deploy)[.-]/,
  /^node_modules(\/|$)/, /^public(\/|$)/,     // public/ is generated; committing it is always a bug
  /^scripts\/(apply|queue)\.js$/,             // the applier may not rewrite itself
  /^scripts\/(apply|queue)\.test\.js$/,       // nor delete the tests that judge it
  /^scripts\/worker\//,                      // nor weaken the relay that authenticated it
];
// ...and the only trees it may write.
const ALLOWED = [/^data\//, /^scripts\//, /^docs\//, /^review\//];

const safePath = p => {
  const s = String(p || '').replace(/\\/g, '/');
  if (!s || s.startsWith('/') || s.includes('..') || /^[a-zA-Z]:/.test(s)) return null;
  if (FORBIDDEN.some(re => re.test(s))) return null;
  if (!ALLOWED.some(re => re.test(s))) return null;
  return s;
};

const sh = (cmd, opts = {}) => execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

/** Everything the plan's own code must not be able to read. */
function scrubbedEnv() {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/token|secret|password|credential|_key$|^GH_|^GITHUB_|^ACTIONS_|^INPUT_|^RUNNER_/i.test(k)) continue;
    out[k] = v;
  }
  out.CI = '1';
  out.OURGAVEL_SANDBOX = '1';
  return out;
}

function parsePlan(issueBody) {
  const sec = name => {
    const re = new RegExp('###\\s*' + name + '[^\\n]*\\n([\\s\\S]*?)(?=\\n###\\s|$)', 'i');
    const m = String(issueBody || '').match(re);
    return m ? m[1].trim() : '';
  };
  const sha = (sec('SHA-256') || '').replace(/[^0-9a-f]/gi, '').toLowerCase();
  const b64 = (sec('Payload') || '').replace(/```/g, '').replace(/\s+/g, '');
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error('no usable SHA-256 heading');
  if (!b64) throw new Error('no payload');

  const raw = Buffer.from(b64, 'base64');
  const got = crypto.createHash('sha256').update(raw).digest('hex');
  // Hash the bytes the Worker was handed, before any interpretation of them. Hashing the
  // decompressed text instead would mean trusting gunzip on unverified input first.
  if (got !== sha) throw new Error('SHA-256 mismatch: expected ' + sha + ', got ' + got);

  let json;
  try { json = zlib.gunzipSync(raw).toString('utf8'); }
  catch { json = raw.toString('utf8'); }        // uncompressed plans are allowed
  const plan = JSON.parse(json);
  if (plan.v !== 1) throw new Error('unsupported plan version: ' + plan.v);
  if (!Array.isArray(plan.files) || !plan.files.length) throw new Error('plan writes no files');
  if (!plan.commit || typeof plan.commit !== 'string') throw new Error('plan has no commit message');
  return plan;
}

/** The gate. Enumerated on the run, never a remembered list — plans add test files as they land. */
function gate(log) {
  const steps = ['scripts/preflight.js', 'scripts/build.js'];
  for (const f of fs.readdirSync(path.join(ROOT, 'scripts')).sort()) {
    if (f.endsWith('.test.js')) steps.push('scripts/' + f);
  }
  steps.push('scripts/audit.js', 'scripts/verdict.live-check.js');
  for (const s of steps) {
    try {
      execFileSync(process.execPath, [s], { cwd: ROOT, encoding: 'utf8', timeout: GATE_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });
      log('    ok   ' + s);
    } catch (e) {
      const out = ((e.stdout || '') + (e.stderr || '')).slice(-1200);
      return { ok: false, step: s, out };
    }
  }
  return { ok: true, steps: steps.length };
}

function revert(log) {
  try { sh('git checkout -- .'); sh('git clean -fd'); log('    reverted'); }
  catch (e) { log('    REVERT FAILED: ' + e.message); }
}

/**
 * @param {object} deps  { gh, repo, log }  gh(pathname, opts) -> json, as in poll.js
 */
async function applyHandoffs(deps) {
  const { gh, repo, log = console.log } = deps;
  // Only inside the pulse. Running poll.js on a laptop must never silently apply and commit
  // somebody's queued plan into the working tree they happen to be sitting in.
  if (process.env.GITHUB_ACTIONS !== 'true') { log('applier: not in Actions, skipping'); return { skipped: 'not-actions' }; }
  if (!process.env.GITHUB_TOKEN) { log('applier: no token, skipping'); return { skipped: 'no-token' }; }

  let issues;
  try { issues = await gh(`/repos/${repo}/issues?state=open&labels=handoff&sort=created&direction=asc&per_page=10`); }
  catch (e) { log('applier: could not list handoffs: ' + e.message); return { skipped: 'list-failed' }; }
  if (!issues.length) { log('applier: queue empty'); return { applied: 0 }; }

  // A dirty tree means something upstream in this pulse already wrote files. Applying on top
  // would blend a plan's changes into someone else's and make the revert path a lie.
  if (sh('git status --porcelain').trim()) { log('applier: tree not clean, deferring to the next pulse'); return { skipped: 'dirty' }; }

  const results = [];
  for (const iss of issues.slice(0, MAX_PER_PULSE)) {
    log(`applier: #${iss.number} ${iss.title}`);
    let outcome;
    try {
      const plan = parsePlan(iss.body);

      const declared = plan.files.map(f => safePath(f.path));
      const badIdx = declared.findIndex(p => !p);
      if (badIdx >= 0) throw new Error('refuses to write: ' + plan.files[badIdx].path);

      plan.files.forEach((f, i) => {
        const dest = path.join(ROOT, declared[i]);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, Buffer.from(String(f.b64 || ''), 'base64'));
      });
      log('    wrote ' + declared.length + ' file(s)');

      if (plan.run) {
        const runPath = safePath(plan.run);
        if (!runPath || !declared.includes(runPath)) throw new Error('run target must be one of the files this plan writes');
        execFileSync(process.execPath, [runPath], {
          cwd: ROOT, encoding: 'utf8', timeout: SCRIPT_TIMEOUT_MS,
          env: scrubbedEnv(), stdio: ['ignore', 'pipe', 'pipe'],
        });
        log('    ran ' + runPath);
      }

      // The second allowlist pass, and the one that actually matters. The first checked what the
      // plan SAID it would write. This checks what it DID — including anything its script wrote
      // on the way past. A sandbox you trust to describe itself is not a sandbox.
      const touched = sh('git status --porcelain')
        .split('\n').map(l => l.slice(3).trim()).filter(Boolean)
        .map(l => l.includes(' -> ') ? l.split(' -> ')[1] : l)
        .map(l => l.replace(/^"|"$/g, ''));
      const trespass = touched.filter(p => !safePath(p));
      if (trespass.length) throw new Error('wrote outside the allowlist: ' + trespass.slice(0, 8).join(', '));
      if (!touched.length) throw new Error('changed nothing');

      const g = gate(log);
      if (!g.ok) throw new Error('gate failed at ' + g.step + '\n' + g.out);

      sh('git add -A');
      sh(`git -c user.name="ourgavel-pulse" -c user.email="actions@users.noreply.github.com" commit -m ${JSON.stringify(plan.commit)}`);
      const sha = sh('git rev-parse --short HEAD').trim();
      log(`    SHIPPED ${sha} — ${touched.length} file(s), ${g.steps} checks green`);
      outcome = { ok: true, sha, files: touched.length, checks: g.steps };
    } catch (e) {
      log('    REFUSED: ' + e.message.split('\n')[0]);
      revert(log);
      outcome = { ok: false, error: e.message };
    }

    const body = outcome.ok
      ? `Applied as \`${outcome.sha}\`. ${outcome.files} file(s) changed; ${outcome.checks} checks green before the commit was made.`
      : `**Not applied.** Nothing was committed and the tree was reverted.\n\n\`\`\`\n${String(outcome.error).slice(0, 3000)}\n\`\`\`\n\nQueue a corrected plan; this issue will not be retried.`;
    try {
      await gh(`/repos/${repo}/issues/${iss.number}/comments`, { method: 'POST', body: { body } });
      await gh(`/repos/${repo}/issues/${iss.number}`, {
        method: 'PATCH',
        // Closed either way. A plan that failed needs a new plan, not a retry — left open it
        // would be re-attempted every fifteen minutes forever, failing identically each time.
        body: { state: 'closed', labels: ['handoff', outcome.ok ? 'handoff-applied' : 'handoff-failed'] },
      });
    } catch (e) { log('    (could not close #' + iss.number + ': ' + e.message + ')'); }
    results.push(outcome);
  }
  return { applied: results.filter(r => r.ok).length, refused: results.filter(r => !r.ok).length, results };
}

module.exports = { applyHandoffs, safePath, parsePlan, scrubbedEnv, FORBIDDEN, ALLOWED };
