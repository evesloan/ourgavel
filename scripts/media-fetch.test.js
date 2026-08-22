(async()=>{
/* Acquisition tests. Run: node scripts/media-fetch.test.js
 *
 * Commons is unreachable from the build sandbox, so discovery runs unattended in CI with
 * nobody watching the first result. That makes these tests the only thing standing between
 * a bad query and a stranger's face on a murder-trial page. Treat a failure as blocking.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('./media-fetch.js');

let pass = 0, fail = 0;
const ok = (cond, label) => { cond ? pass++ : (fail++, console.log('  FAIL  ' + label)); };

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
const bigPNG = Buffer.concat([PNG, Buffer.alloc(4000, 7)]);
const res = (body, ct = 'image/png', status = 200) => ({
  ok: status === 200, status,
  headers: { get: k => (k.toLowerCase() === 'content-type' ? ct : null) },
  arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
});

console.log('\n--- The gate: what may be published without a human ---');
const court = { title: 'File:Plymouth County Superior Court Brockton MA.jpg', text: 'Courthouse in Brockton, Massachusetts', width: 2000 };
ok(M.relevanceGate(court, { kind: 'place', must: ['court', 'brockton'] }).ok, 'a courthouse matching its tokens should publish');

const personQ = { kind: 'person', must: ['clancy'] };
const g1 = M.relevanceGate({ title: 'File:Lindsay Clancy.jpg', text: 'portrait', width: 2000 }, personQ);
ok(!g1.ok && g1.queue, 'a person must NEVER auto-publish — it should queue instead');

const wrongPlace = { title: 'File:Clancy family portrait 1908.jpg', text: 'A family in Ireland', width: 2000 };
ok(!M.relevanceGate(wrongPlace, { kind: 'place', must: ['courthouse'] }).ok, 'a word-match with no subject token must be refused');

ok(!M.relevanceGate(court, { kind: 'place', must: ['court'], deny: ['brockton'] }).ok, 'a deny token must disqualify');
ok(!M.relevanceGate({ title: 'File:x.jpg', text: 'courthouse', width: 120 }, { kind: 'place', must: ['courthouse'] }).ok, 'an image below the legibility floor must be refused');
ok(!M.relevanceGate(court, { kind: 'place' }).ok, 'a query with no must-tokens must be refused, not treated as "match anything"');
ok(!M.relevanceGate(court, { kind: 'place', must: ['court', 'plymouth', 'exterior'] }).ok, 'one missing token is enough to refuse');
ok(M.relevanceGate({ title: 'File:DSC_4471.jpg', text: 'Superior Court building, Brockton', width: 1800 }, { kind: 'place', must: ['court', 'brockton'] }).ok,
  'subject found in the description (not the filename) should still count');

console.log('--- Archival photographs must not pose as the present-day venue ---');
const pq = { kind: 'place', must: ['courthouse', 'los angeles'] };
ok(!M.relevanceGate({ title: 'File:Panoramic view.jpg', text: 'downtown Los Angeles from the Courthouse, ca.1905', width: 3000 }, pq).ok,
  'a "ca.1905" description must be refused — this one shipped on the first live run');
ok(!M.relevanceGate({ title: 'File:Los Angeles Courthouse 1932.jpg', text: 'courthouse', width: 3000 }, pq).ok,
  'a year in the filename must be refused');
ok(!M.relevanceGate({ title: 'File:LA courthouse postcard.jpg', text: 'courthouse los angeles postcard', width: 3000 }, pq).ok,
  'a postcard must be refused');
ok(M.relevanceGate({ title: 'File:Colleton County Courthouse.jpg', text: 'The courthouse in Walterboro, built in 1822 and still in use', width: 3000 },
  { kind: 'place', must: ['courthouse', 'walterboro'] }).ok,
  'a CURRENT photo that merely mentions the building\'s age must still publish');
ok(M.relevanceGate({ title: 'File:Old Courthouse.jpg', text: 'courthouse los angeles', width: 3000 }, { ...pq, allowArchival: true }).ok,
  'a query may opt in to archival material deliberately');

console.log('--- The download: only real image bytes reach disk ---');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'og-media-'));
const dl = (body, ct, status) => M.downloadImage('https://x/y.png', path.join(tmp, 'a.png'), { fetch: async () => res(body, ct, status) });

ok((await dl(Buffer.from('<html>nope</html>'), 'text/html')).ok === false, 'an HTML response must be refused');
ok((await dl(Buffer.from('<html>nope</html>'), 'image/png')).ok === false, 'HTML wearing an image content-type must fail the magic-byte check');
ok((await dl(Buffer.alloc(M.MAX_BYTES + 10, 1), 'image/png')).ok === false, 'an oversized file must be refused');
ok((await dl(PNG, 'image/png')).ok === false, 'a file too small to be a real photo must be refused');
ok((await dl(bigPNG, 'image/png')).ok === true, 'a genuine PNG should be accepted');
ok(fs.existsSync(path.join(tmp, 'a.png')), 'the accepted file should actually be on disk');
ok((await dl(bigPNG, 'image/png', 404)).ok === false, 'a 404 must be refused');
ok(M.sniff(Buffer.from([0xff, 0xd8, 0xff, 0x00])) === 'jpg', 'JPEG magic bytes should be recognised');

console.log('--- End to end, with Commons faked ---');
const HITS = {
  'Plymouth County Superior Court': [{
    ok: true, title: 'File:Plymouth Superior Court.jpg', url: 'https://upload/x.jpg', thumb: 'https://upload/t.jpg',
    descriptionUrl: 'https://commons.wikimedia.org/wiki/File:Plymouth_Superior_Court.jpg',
    width: 2400, text: 'Superior courthouse in Brockton, Massachusetts',
    rights: 'cc-licensed', licence: 'CC BY-SA 4.0', licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0', attribution: 'A Photographer',
  }],
  'Lindsay Clancy': [{
    ok: true, title: 'File:Lindsay Clancy.jpg', url: 'https://upload/p.jpg', thumb: 'https://upload/p.jpg',
    descriptionUrl: 'https://commons.wikimedia.org/wiki/File:Lindsay_Clancy.jpg',
    width: 1200, text: 'portrait of a woman', rights: 'public-domain', licence: 'CC0', attribution: 'Someone',
  }],
};
const deps = {
  search: async q => [q],
  verify: async titles => HITS[titles[0]] || [],
  fetch: async () => res(bigPNG, 'image/png'),
};
const out = path.join(tmp, 'site');
const caseObj = {
  slug: 'lindsay-clancy', media: [],
  mediaQueries: [
    { q: 'Plymouth County Superior Court', kind: 'place', must: ['court', 'brockton'], caption: 'Plymouth County Superior Court' },
    { q: 'Lindsay Clancy', kind: 'person', must: ['clancy'] },
  ],
};
const r = await M.discoverCase(caseObj, { outDir: out, deps, now: '2026-08-22T00:00:00Z' });
ok(r.added.length === 1, 'exactly the courthouse should be added, got ' + r.added.length);
ok(r.queued.length === 1, 'the person query should be queued for a human');
ok(!r.added.some(a => /clancy\.jpg/i.test(a.url)), 'no person photo may appear in the published set');

const a = r.added[0];
ok(/^media\/lindsay-clancy\/[0-9a-f]{12}\.png$/.test(a.local), 'file should land on our own origin, got ' + a.local);
ok(fs.existsSync(path.join(out, a.local)), 'the bytes should exist where the page will look for them');
ok(!/^https?:/i.test(a.local), 'the rendered source must never be an off-site URL');
ok(a.licenceUrl.includes('creativecommons.org'), 'CC attribution data must survive into the entry');
ok(a.credit === 'A Photographer', 'the photographer must be credited');
ok(a.source.includes('commons.wikimedia.org'), 'the licence provenance must be linkable');

console.log('--- Two photographs of the same place must not share one caption ---');
const twoHits = [
  { ok: true, title: 'File:Colleton County Courthouse Walterboro SC - panoramio.jpg', url: 'https://u/1.png', thumb: 'https://u/1.png', descriptionUrl: 'https://commons/1', width: 2000, text: 'courthouse walterboro', rights: 'public-domain', licence: 'CC0', attribution: 'A' },
  { ok: true, title: 'File:Colleton_County_Courthouse_-_Walterboro,_SC.jpg', url: 'https://u/2.png', thumb: 'https://u/2.png', descriptionUrl: 'https://commons/2', width: 2000, text: 'courthouse walterboro', rights: 'public-domain', licence: 'CC0', attribution: 'B' },
];
const capQ = { q: 'Colleton', kind: 'place', must: ['courthouse'], caption: 'The Colleton County Courthouse, Walterboro' };
const capRun = await M.discoverCase({ slug: 'cap', media: [], mediaQueries: [capQ, { ...capQ, q: 'Colleton two' }] },
  { outDir: out, deps: { ...deps, verify: async () => twoHits } });
ok(capRun.added.length === 2, 'both should publish, got ' + capRun.added.length);
ok(capRun.added[0].caption !== capRun.added[1].caption, 'the second photograph must not repeat the first caption');
ok(!/_|File:|\.jpg/i.test(capRun.added[1].caption), 'a caption built from a filename must read like prose: ' + capRun.added[1].caption);

console.log('--- A query that finds nothing usable must say so ---');
const silent = await M.discoverCase({ slug: 'q', media: [], mediaQueries: [{ q: 'Plymouth Superior Court', kind: 'place', must: ['court'], caption: 'x' }] },
  { outDir: out, deps: { ...deps, search: async () => ['File:A map.svg'], verify: async () => [] } });
ok(silent.rejected.length === 1, 'a query yielding no usable files must leave a trace, not vanish');
ok(/usable images/.test(silent.rejected[0].reason || ''), 'the trace must distinguish "found nothing" from "gate refused it": ' + (silent.rejected[0] || {}).reason);

console.log('--- Captions built from filenames must read like captions ---');
const capsFrom = async title => (await M.discoverCase({ slug: 'c', media: [{ caption: 'taken' }], mediaQueries: [{ q: 'x', kind: 'place', must: ['court'], caption: 'taken' }] },
  { outDir: out, deps: { ...deps, verify: async () => [{ ok: true, title, url: 'https://u/z', thumb: 'https://u/z', descriptionUrl: 'https://commons/' + title, width: 2000, text: 'court', rights: 'public-domain', licence: 'CC0', attribution: 'X' }] } })).added[0].caption;
ok(await capsFrom('File:Los Angeles Federal Courthouse 127 S Broadway dllu.jpg') === 'Los Angeles Federal Courthouse 127 S Broadway',
  'an uploader handle must be stripped, got: ' + await capsFrom('File:Los Angeles Federal Courthouse 127 S Broadway dllu.jpg'));
ok(await capsFrom('File:Duval_County_Courthouse_from_Clay_St.jpg') === 'Duval County Courthouse from Clay St',
  'a real trailing word must be kept, got: ' + await capsFrom('File:Duval_County_Courthouse_from_Clay_St.jpg'));
ok(!/\(\d{6,}\)/.test(await capsFrom('File:Some Courthouse (50027024252).jpg')), 'an upload id must be stripped');
ok(!/_|\.jpg/i.test(await capsFrom('File:A_Courthouse_somewhere.jpg')), 'underscores and extensions must never reach a caption');

console.log('--- One query must not take the whole case ---');
const oneQ = { q: 'Clark County Government Center', kind: 'place', must: ['courthouse'], caption: 'Clark County Government Center' };
let acc = { slug: 'z', media: [], mediaQueries: [oneQ] };
for (let run = 0; run < 5; run++) {
  const r = await M.discoverCase(acc, { outDir: out, deps: { ...deps, verify: async () => Array.from({ length: 6 }, (_, i) => ({
    ok: true, title: 'File:Clark County Courthouse angle ' + run + i + '.jpg', url: 'https://u/' + run + i, thumb: 'https://u/' + run + i,
    descriptionUrl: 'https://commons/' + run + '-' + i, width: 2000, text: 'courthouse', rights: 'public-domain', licence: 'CC0', attribution: 'X' })) } });
  acc = { ...acc, media: acc.media.concat(r.added) };
}
ok(acc.media.length === M.PER_QUERY_TOTAL, 'a single query must stop at ' + M.PER_QUERY_TOTAL + ' photographs ever, got ' + acc.media.length);
ok(acc.media.every(m => m.query === oneQ.q), 'each entry must record which query found it, so the cap survives a restart');

console.log('--- Limits hold ---');
const dedupe = await M.discoverCase({ ...caseObj, media: r.added }, { outDir: out, deps });
ok(dedupe.added.length === 0, 'a second run must not re-add the same file');

const capped = await M.discoverCase({ slug: 'x', media: Array(M.PER_CASE_CAP).fill({ type: 'image' }), mediaQueries: caseObj.mediaQueries },
  { outDir: out, deps });
ok(capped.added.length === 0, 'a case at the image cap must add nothing');

const many = { q: 'Plymouth County Superior Court', kind: 'place', must: ['court'], limit: 20 };
const flood = await M.discoverCase({ slug: 'y', media: [], mediaQueries: [many, many, many, many] },
  { outDir: out, deps: { ...deps, verify: async () => Array(20).fill(HITS['Plymouth County Superior Court'][0]) } });
ok(flood.added.length <= M.PER_RUN_ADD, 'one pulse must not flood a case, got ' + flood.added.length);

console.log('--- The safety gate ---');
const bad = M.safeToDiscover({ force: true, tests: ['fake.js'], run: () => { const e = new Error('x'); e.stdout = 'RIGHTS LOGIC BROKEN'; throw e; } });
ok(bad.ok === false, 'a failing rights test must stop discovery');
ok(/BROKEN/.test(bad.detail || ''), 'the reason must be reported, not swallowed');
ok(M.safeToDiscover({ force: true, tests: ['fake.js'], run: () => { } }).ok === true, 'a passing suite must allow discovery');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\n  DISCOVERY MUST NOT SHIP WITH FAILING TESTS.\n'); process.exit(1); }
console.log('  Acquisition safe to run unattended.\n');

})();
