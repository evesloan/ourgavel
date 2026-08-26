#!/usr/bin/env node
/* The instant board: a submission that passes the screen is visible to everyone in seconds,
 * one that fails is held AND SAYS SO, and nothing the screen has not passed is ever shown.
 * Run: node scripts/pending.test.js   (no network; the worker runs against stubs)
 *
 * Why this exists: on 2026-08-22 the operator posted a question and a theory through the live
 * composer. The question was screened and held — correctly — but the only feedback lived in a
 * GitHub issue comment no reader ever sees. The composer said success-shaped words and the
 * board showed nothing, forever. "It appears once reviewed" with no card, no timer and no
 * explanation is indistinguishable from a black hole, and the operator filed it as one.
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const screen = require('./screen.js');
const bundler = require('./worker/bundle-screen.js');

let pass = 0; const fails = [];
const ok = (name, cond, extra) => { if (cond) pass++; else fails.push(name + (extra ? ' — ' + extra : '')); };

// ---- 1. the worker's screen block IS screen.js, not a drifted copy ---------------------
const workerSrc = fs.readFileSync(path.join(__dirname, 'worker', 'ourgavel-submit.js'), 'utf8');
ok('worker screen block is current (regenerate with bundle-screen.js)', bundler.splice(workerSrc) === workerSrc);

// ---- 2. the pulse's local copies have not drifted from the canonical ones --------------
// poll.js deliberately kept its own personMentions/buildNameSets/PII on 2026-08-26 (a queued
// full-file handoff would have clobbered an edit). Until a lane dedupes them, they must stay
// byte-identical — if this fails, someone changed one copy: change both or finish the dedupe.
const pollSrc = fs.readFileSync(path.join(__dirname, 'poll.js'), 'utf8');
const screenSrc = fs.readFileSync(path.join(__dirname, 'screen.js'), 'utf8');
const fnText = (src, name, isConst) => {
  const startRe = isConst ? new RegExp('^const ' + name + ' = .*$', 'm') : new RegExp('^function ' + name + '\\(', 'm');
  const m = src.match(startRe);
  if (!m) return null;
  if (isConst) return m[0];
  let i = src.indexOf(m[0]), depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(i, j + 1);
};
for (const [name, isConst] of [['personMentions', false], ['buildNameSets', false], ['PII', true]]) {
  const a = fnText(pollSrc, name, isConst), b = fnText(screenSrc, name, isConst);
  ok('poll.js and screen.js agree on ' + name, !!a && !!b && a === b, a === null ? 'missing in poll.js' : b === null ? 'missing in screen.js' : 'texts differ');
}

// ---- 3. the worker, executed against stubs --------------------------------------------
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gbp-')), 'worker.mjs');
fs.copyFileSync(path.join(__dirname, 'worker', 'ourgavel-submit.js'), tmp);

// Real name sets from the real repo data — the same JSON build.js publishes.
const CASE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'cases', 'lindsay-clancy', 'case.json'), 'utf8'));
const DAYS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'cases', 'lindsay-clancy', 'days.json'), 'utf8'));
const NAMES = screen.serialiseNameSets(screen.buildNameSets(CASE, DAYS));

function kvStub() {
  const store = new Map();
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; },
  };
}

(async () => {
  const mod = await import('file://' + tmp);
  const worker = mod.default;
  let ghCalls = [];
  let issueCounter = 100;
  let namesAvailable = true;
  global.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('api.github.com')) {
      const body = JSON.parse(init.body);
      ghCalls.push({ url: u, body });
      issueCounter++;
      return { ok: true, json: async () => ({ html_url: 'https://github.com/evesloan/ourgavel/issues/' + issueCounter, number: issueCounter }) };
    }
    if (u.includes('/names.json')) {
      if (!namesAvailable || u.includes('no-such-case')) return { ok: false, status: 404 };
      return { ok: true, json: async () => NAMES };
    }
    throw new Error('unexpected fetch ' + u);
  };

  const post = async (payload, env) => {
    const res = await worker.fetch(new Request('https://relay.test/', {
      method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(payload),
    }), Object.assign({ REPO: 'evesloan/ourgavel', GH_TOKEN: 'gh', ORIGIN: 'https://ourgavel.com' }, env || {}));
    return { status: res.status, d: await res.json() };
  };
  const getPending = async (slug, env) => {
    const res = await worker.fetch(new Request('https://relay.test/?pending=' + slug, { method: 'GET' }),
      Object.assign({ REPO: 'evesloan/ourgavel', GH_TOKEN: 'gh', ORIGIN: 'https://ourgavel.com' }, env || {}));
    return { status: res.status, d: await res.json(), cors: res.headers.get('access-control-allow-origin') };
  };

  console.log('\n--- a clean theory publishes instantly, for everyone ---');
  let kv = kvStub(); ghCalls = [];
  let r = await post({ kind: 'theory', case: 'lindsay-clancy',
    claim: 'The timeline leaves a nineteen minute gap unaccounted for',
    reasoning: 'The prosecution exhibits place the run at 5:15 and the first call at 6:10' }, { RATE: kv });
  ok('published:true', r.d.published === true, JSON.stringify(r.d).slice(0, 120));
  ok('a node is returned for the poster to render', !!r.d.node && r.d.node.title.includes('nineteen'));
  ok('node id matches the issue', r.d.node && r.d.node.id === 'c-' + r.d.number);
  ok('mirrored into KV', [...kv.store.keys()].filter(k => k.startsWith('pend:')).length === 1 && [...kv.store.keys()].some(k => k.startsWith('pend:lindsay-clancy:')));
  ok('the issue was still filed (durable record)', ghCalls.length === 1);
  ok('no needs-review label on a passing post', !ghCalls[0].body.labels.includes('needs-review'), JSON.stringify(ghCalls[0].body.labels));
  let g = await getPending('lindsay-clancy', { RATE: kv });
  ok('GET pending returns it to every viewer', g.d.items.length === 1 && g.d.items[0].id === r.d.node.id);
  ok('GET pending carries CORS for the site', g.cors === 'https://ourgavel.com');
  ok('GET pending for another case is empty', (await getPending('duane-davis-tupac', { RATE: kv })).d.items.length === 0);

  console.log('--- the exact submission the operator lost: held, and TOLD so ---');
  kv = kvStub(); ghCalls = [];
  r = await post({ kind: 'question', case: 'lindsay-clancy',
    claim: "Why isn't the husband being looked into further?" }, { RATE: kv });
  ok('held:true', r.d.held === true, JSON.stringify(r.d).slice(0, 140));
  ok('the reader is told why', /human eyes|specific person|refers to/i.test(r.d.why || ''), r.d.why);
  ok('filed WITH needs-review so the pulse holds it too', ghCalls.length === 1 && ghCalls[0].body.labels.includes('needs-review'));
  ok('NOT mirrored — nothing unscreened is ever instant', ![...kv.store.keys()].some(k => k.startsWith('pend:')));

  console.log('--- a named private person is held ---');
  kv = kvStub(); ghCalls = [];
  r = await post({ kind: 'theory', case: 'lindsay-clancy',
    claim: 'I think Patrick Clancy knows more than he has said',
    reasoning: 'Look at the timeline of his statements to the police that night' }, { RATE: kv });
  ok('named-person theory held', r.d.held === true, JSON.stringify(r.d).slice(0, 140));
  ok('named-person theory not mirrored', ![...kv.store.keys()].some(k => k.startsWith('pend:')));

  console.log('--- PII is redacted before anything can mirror it ---');
  kv = kvStub();
  r = await post({ kind: 'theory', case: 'lindsay-clancy',
    claim: 'Someone should contact me about what I saw that evening',
    reasoning: 'Reach me at tipster@example.com and I will explain everything I know' }, { RATE: kv });
  ok('the address never survives into the mirror or the issue',
    JSON.stringify(r.d).indexOf('tipster@example.com') === -1 && ![...kv.store.values()].some(v => v.includes('tipster@example.com')),
    JSON.stringify(r.d).slice(0, 140));
  ok('what remains is the redaction marker', !r.d.node || r.d.node.body.includes('[email removed]'));

  console.log('--- fail closed: no names, or no KV, means queued — never a false instant ---');
  kv = kvStub();
  r = await post({ kind: 'theory', case: 'no-such-case', claim: 'A perfectly clean three word claim here', reasoning: 'more words to pass the floor' }, { RATE: kv });
  ok('unknown case → queued, not published', r.d.queued === true && !r.d.published, JSON.stringify(r.d).slice(0, 120));
  namesAvailable = false;
  r = await post({ kind: 'theory', case: 'duane-davis-tupac', claim: 'The exhibit list is missing an item', reasoning: 'Compare the docket to the filed list' }, { RATE: kv });
  ok('names.json down → queued (uncached case)', r.d.queued === true && !r.d.published, JSON.stringify(r.d).slice(0, 120));
  namesAvailable = true;
  r = await post({ kind: 'theory', case: 'lindsay-clancy', claim: 'The exhibit list is missing an item', reasoning: 'Compare the docket to the filed list' }, {});
  ok('no KV binding → queued', r.d.queued === true && !r.d.published, JSON.stringify(r.d).slice(0, 120));

  console.log('--- other kinds are untouched ---');
  kv = kvStub();
  // The composer puts a report's text in `reasoning` and leaves `claim` empty. The worker
  // used to validate `claim` here and refused every report the form had accepted.
  r = await post({ kind: 'report', case: 'lindsay-clancy', claim: '', reason: 'wrong date', reasoning: 'the date on day two is wrong' }, { RATE: kv });
  ok('a report shaped exactly like the composer sends it is accepted', r.d.ok === true, JSON.stringify(r.d).slice(0, 120));
  ok('report keeps its plain response', r.d.ok === true && !('published' in r.d) && !('held' in r.d) && !('queued' in r.d), JSON.stringify(r.d).slice(0, 120));
  ok('report never mirrored', ![...kv.store.keys()].some(k => k.startsWith('pend:')));

  console.log('--- GET validation ---');
  ok('GET without pending param → 400', (await getPending('', { RATE: kvStub() })).status === 400);

  // ---- 4. the client is wired ----------------------------------------------------------
  const build = fs.readFileSync(path.join(__dirname, 'build.js'), 'utf8');
  ok('board client can draw an instant card', build.includes('window.gbBoardAdd'));
  ok('board polls the pending feed', build.includes("PENDPOINT+'?pending='"));
  ok('composer handles published', build.includes('res.d.published'));
  ok('composer handles held, with the why', build.includes('res.d.held') && build.includes('Held for a human editor'));
  ok('composer handles queued honestly', build.includes('res.d.queued') && build.includes('next update cycle'));
  ok('board emits names.json for the relay screen', build.includes("'names.json'") && build.includes('serialiseNameSets'));
  ok('instant card position matches the pulse layout', build.includes('PCOL={theory:1160,question:1680}'));

  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  console.log('\npending.test.js: ' + pass + ' assertions passed' + (fails.length ? ', ' + fails.length + ' FAILED' : ''));
  if (fails.length) { fails.forEach(f => console.log('  FAIL  ' + f)); process.exit(1); }
})().catch(e => { console.error('pending.test.js threw:', e); process.exit(1); });
