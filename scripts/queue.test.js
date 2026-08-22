#!/usr/bin/env node
/* The handoff queue's security boundary, executed rather than read.
 * Run: node scripts/queue.test.js   (no network, no deployment, no GitHub)
 *
 * scripts/submit.test.js checks the submission chain as TEXT — it never runs the Worker. That
 * is fine for "do three programs agree on a heading". It is not fine here. This route is the
 * only one in the relay that can cause code to run anywhere: a lane POSTs an apply-plan, the
 * pulse applies it, and the result is committed to a public court record under our own byline.
 * A regression that opened it would not fail a text comparison, so this file imports the real
 * Worker, stubs `fetch`, and asserts on what it actually does.
 *
 * The property that matters most is NEGATIVE and it is the first block: without the right
 * bearer, no issue is created. Not "an error is returned" — nothing is filed at all.
 */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');

let pass = 0; const fails = [];
const ok = (name, cond, extra) => { if (cond) pass++; else fails.push(name + (extra ? ' — ' + extra : '')); };

const SRC = path.join(__dirname, 'worker', 'ourgavel-submit.js');
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gbq-')), 'worker.mjs');
fs.copyFileSync(SRC, tmp);

const TOKEN = 'test-token-' + 'x'.repeat(40);
const B64 = Buffer.from('{"files":[]}').toString('base64');
const SHA = 'a'.repeat(64);

(async () => {
  const mod = await import('file://' + tmp);
  const worker = mod.default;

  // Every call the Worker makes to GitHub lands here instead. If this array is empty after a
  // request, nothing was filed — which is the whole assertion for the unauthenticated cases.
  let filed = [];
  global.fetch = async (url, init) => {
    filed.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ html_url: 'https://x/1', number: 1 }) };
  };

  const call = async (body, headers, env) => {
    filed = [];
    const res = await worker.fetch(new Request('https://relay.test/', {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
      body: JSON.stringify(body),
    }), Object.assign({ REPO: 'evesloan/ourgavel', GH_TOKEN: 'gh', ORIGIN: 'https://ourgavel.com' }, env || {}));
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, json, filed: filed.slice() };
  };

  const good = { kind: 'handoff', lane: 'seo', title: 'one page per trial day', payload: B64, sha256: SHA };
  const bearer = { authorization: 'Bearer ' + TOKEN };
  const withToken = { QUEUE_TOKEN: TOKEN };

  // ---- NOTHING IS FILED WITHOUT THE TOKEN ---------------------------------
  console.log('\n--- the route does not exist unless you can prove you are us ---');
  for (const [label, headers, env] of [
    ['QUEUE_TOKEN unset on the Worker', bearer, {}],
    ['no authorization header at all', {}, withToken],
    ['empty bearer', { authorization: 'Bearer ' }, withToken],
    ['wrong token, same length', { authorization: 'Bearer ' + 'y'.repeat(TOKEN.length) }, withToken],
    ['right token with one character missing', { authorization: 'Bearer ' + TOKEN.slice(0, -1) }, withToken],
    ['right token with a character appended', { authorization: 'Bearer ' + TOKEN + 'z' }, withToken],
    ['token in the body instead of the header', {}, withToken],
    ['Basic auth carrying the token', { authorization: 'Basic ' + TOKEN }, withToken],
  ]) {
    const r = await call(Object.assign({}, good, { token: TOKEN }), headers, env);
    ok('NOTHING FILED: ' + label, r.filed.length === 0, r.filed.length + ' issue(s) were filed');
    ok('404, not 403: ' + label, r.status === 404, 'got ' + r.status + ' — a 403 confirms the route exists');
  }
  // A bare empty QUEUE_TOKEN must not match an empty presented token.
  ok('NOTHING FILED: empty token on both sides',
    (await call(good, { authorization: 'Bearer ' }, { QUEUE_TOKEN: '' })).filed.length === 0);

  // ---- WITH THE TOKEN, THE PAYLOAD IS STILL VALIDATED ---------------------
  console.log('--- authenticated, but the payload still has to be well formed ---');
  const bad = [
    ['unknown lane', { lane: 'marketing' }, 400],
    ['no lane', { lane: '' }, 400],
    ['no title', { title: '' }, 400],
    ['no payload', { payload: '' }, 400],
    ['no sha256', { sha256: '' }, 400],
    ['sha256 too short', { sha256: 'abc' }, 400],
    ['sha256 not hex', { sha256: 'z'.repeat(64) }, 400],
    ['payload is not base64', { payload: 'not base64 !!! <script>' }, 400],
    ['payload over the issue-body cap', { payload: 'A'.repeat(60001) }, 413],
  ];
  for (const [label, patch, want] of bad) {
    const r = await call(Object.assign({}, good, patch), bearer, withToken);
    ok('refused: ' + label, r.status === want, 'got ' + r.status);
    ok('NOTHING FILED: ' + label, r.filed.length === 0, r.filed.length + ' filed');
  }

  // ---- THE HAPPY PATH ------------------------------------------------------
  console.log('--- a real handoff ---');
  const r = await call(good, bearer, withToken);
  ok('accepted', r.status === 200, 'got ' + r.status + ' ' + JSON.stringify(r.json));
  ok('exactly one issue filed', r.filed.length === 1);
  const iss = r.filed[0] && r.filed[0].body;
  ok('labelled handoff', !!iss && iss.labels.includes('handoff'), JSON.stringify(iss && iss.labels));
  ok('labelled with its lane', !!iss && iss.labels.includes('lane:seo'));
  ok('NOT labelled via-composer', !!iss && !iss.labels.includes('via-composer'),
    'a handoff must never look like a reader submission');
  ok('title names the lane', !!iss && iss.title.startsWith('[handoff:seo]'), iss && iss.title);
  ok('body carries the sha', !!iss && iss.body.includes(SHA));
  ok('body carries the payload intact', !!iss && iss.body.includes(B64),
    'redact() or a length cap corrupted it');
  ok('filed against the configured repo', !!r.filed[0] && /repos\/evesloan\/ourgavel\/issues$/.test(r.filed[0].url));

  // A handoff must not be reachable through the reader path under a different name.
  console.log('--- the reader path cannot mint one ---');
  const kindBlock = fs.readFileSync(SRC, 'utf8');
  const kinds = kindBlock.slice(kindBlock.indexOf('const KINDS = {'), kindBlock.indexOf('};', kindBlock.indexOf('const KINDS = {')));
  ok('KINDS has no handoff entry', !/^\s*handoff\s*:/m.test(kinds),
    'the public composer path would then be able to create one');
  const reader = await call({ kind: 'theory', case: 'lindsay-clancy', claim: 'a b c', reasoning: 'a b c' }, {}, withToken);
  const rl = reader.filed[0] && reader.filed[0].body.labels;
  ok('a reader submission is never labelled handoff', !rl || !rl.includes('handoff'), JSON.stringify(rl));

  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  console.log('\nqueue.test.js: ' + pass + ' assertions passed' + (fails.length ? ', ' + fails.length + ' FAILED' : ''));
  if (fails.length) { fails.forEach(f => console.log('  FAIL  ' + f)); process.exit(1); }
})().catch(e => { console.error('queue.test.js threw:', e); process.exit(1); });
