/* The photo viewer, end to end, in a real browser. Run: node scripts/media.viewer-test.js
 *
 * This exists because the viewer shipped broken twice — once covering the whole screen with
 * no way out, once again after a CSS rule was reordered above it. Both were invisible to
 * every other check we run. So this builds a throwaway case with a real image on it, opens
 * it in Chromium, and proves the thing opens, navigates, closes by all three routes, and
 * never lets the page make an outbound request.
 *
 * The fixture is git-ignored and removed in a finally block. If a crash leaves one behind,
 * this refuses to run rather than testing against stale state.
 */
const fs = require('fs'), path = require('path'), zlib = require('zlib'), http = require('http');
const { execFileSync } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..');
const SLUG = 'zz-viewer-fixture';
const CASE_DIR = path.join(ROOT, 'data', 'cases', SLUG);
const OUT_DIR = path.join(ROOT, 'public', 'cases', SLUG);
const IMG_DIR = path.join(ROOT, 'data', 'media', SLUG);
const PORT = 8907;

// A real PNG, generated rather than downloaded — the sandbox has no network.
function png(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) { const i = o + 1 + x * 3; raw[i] = (x * 255 / w) | 0; raw[i + 1] = (y * 255 / h) | 0; raw[i + 2] = 120; }
  }
  const T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]);
}

const TYPES = { '.html': 'text/html', '.png': 'image/png', '.json': 'application/json', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain' };

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : (fail++, console.log('  FAIL  ' + n + (x ? ' — ' + x : ''))); };

(async () => {
  if (fs.existsSync(CASE_DIR)) {
    console.error('\n  A fixture from a previous crashed run is still present at data/cases/' + SLUG + '.');
    console.error('  Delete it and re-run — this will not test against stale state.\n');
    process.exit(1);
  }
  let server;
  try {
    const local = path.posix.join('media', SLUG, 'a'.repeat(12) + '.png');
    const local2 = path.posix.join('media', SLUG, 'b'.repeat(12) + '.png');
    fs.mkdirSync(IMG_DIR, { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'data', local), png(1200, 900));
    fs.writeFileSync(path.join(ROOT, 'data', local2), png(900, 1200));
    fs.mkdirSync(CASE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CASE_DIR, 'case.json'), JSON.stringify({
      slug: SLUG, title: 'Fixture v. Fixture', shortTitle: 'Viewer fixture', status: 'active', phase: 'Fixture',
      court: 'Nowhere', charges: [], defendant: 'Nobody', plainSummary: 'A fixture used to test the photo viewer.',
      media: [
        { type: 'image', local, url: 'https://commons.wikimedia.org/wiki/File:One', source: 'https://commons.wikimedia.org/wiki/File:One', caption: 'Fixture image one', alt: 'Fixture one', credit: 'A Photographer', rights: 'cc-licensed', licence: 'CC BY-SA 4.0', licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' },
        { type: 'image', local: local2, url: 'https://commons.wikimedia.org/wiki/File:Two', source: 'https://commons.wikimedia.org/wiki/File:Two', caption: 'Fixture image two', alt: 'Fixture two', credit: 'Public Records Office', rights: 'public-domain', licence: 'Public domain' },
        { type: 'document', url: 'https://www.law.cornell.edu/uscode/text/18/1958', caption: 'A statute', credit: 'Cornell LII', rights: 'public-record' },
        // A record claiming a file that isn't on disk. This happens for real: a pulse writes
        // the entry, a later checkout doesn't have the bytes. It must render as nothing,
        // never as a broken image on a page about a criminal trial.
        { type: 'image', local: 'media/' + SLUG + '/' + 'c'.repeat(12) + '.png', url: 'https://commons.wikimedia.org/wiki/File:Missing', caption: 'Bytes that do not exist', credit: 'Nobody', rights: 'public-domain' },
      ],
    }, null, 2));

    execFileSync('node', [path.join(ROOT, 'scripts', 'build.js')], { cwd: ROOT, stdio: 'pipe' });

    server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const f = path.join(ROOT, 'public', rel.endsWith('/') || !rel ? rel + 'index.html' : rel);
      if (!f.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      res.end(fs.readFileSync(f));
    });
    await new Promise(r => server.listen(PORT, r));
    const URL = 'http://localhost:' + PORT + '/cases/' + SLUG + '/';

    const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    for (const [w, h, label, mob] of [[1280, 900, 'desktop', false], [390, 844, 'mobile', true]]) {
      const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob });
      const errs = [], ext = [];
      p.on('pageerror', e => errs.push(e.message.slice(0, 80)));
      p.on('request', r => { const u = r.url(); if (!u.startsWith('http://localhost:' + PORT) && !u.startsWith('data:')) ext.push(u); });
      await p.goto(URL, { waitUntil: 'networkidle' });
      console.log('\n  [' + label + ']');

      // The bug that shipped twice: the viewer must be shut, and must not swallow clicks.
      ok('viewer is shut on load', !(await p.locator('#lightbox').isVisible()));
      const centre = await p.evaluate(() => { const e = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return e ? (e.closest('#lightbox') ? 'LIGHTBOX' : e.tagName.toLowerCase()) : 'none'; });
      ok('nothing invisible is covering the page', centre !== 'LIGHTBOX', centre);
      let navWorks = false;
      try { await p.locator('nav.sitenav a').first().click({ timeout: 2500 }); navWorks = true; } catch (e) { }
      ok('the page is still usable', navWorks);
      await p.goto(URL, { waitUntil: 'networkidle' });

      ok('no outbound requests', ext.length === 0, ext.slice(0, 2).join(' '));
      ok('photographs render', await p.locator('.prail .mcard img').count() === 2, 'got ' + await p.locator('.prail .mcard img').count());
      ok('a photo whose bytes are missing is not rendered at all', !(await p.content()).includes('Bytes that do not exist'));
      // Lazy images below the fold legitimately report !complete; only a finished load that
      // produced no pixels is a broken image.
      // An <img> with no src yet is inert and correct — the viewer's own element starts that
      // way. What must never happen is a src that finished loading and produced no pixels.
      ok('no image on the page is broken', await p.locator('img').evaluateAll(l =>
        l.filter(i => i.getAttribute('src')).every(i => !i.complete || i.naturalWidth > 0)));
      ok('the viewer does not ship an empty src', await p.locator('#lbimg').evaluate(i => i.getAttribute('src') === null));
      ok('the bytes load', await p.locator('.prail .mcard img').first().evaluate(i => i.naturalWidth) > 100);
      ok('documents are kept separate from photographs', await p.locator('.mdocs .mcard').count() === 1);

      await p.locator('.mcard[data-mi]').first().click(); await p.waitForTimeout(300);
      ok('opens on click', await p.locator('#lightbox').isVisible());
      ok('caption shown', (await p.locator('#lbcap').innerText()).includes('Fixture image one'));
      ok('licence named in the credit', (await p.locator('#lbcredit').innerText()).includes('CC BY-SA'), await p.locator('#lbcredit').innerText());
      ok('licence is reachable', /creativecommons\.org/.test(await p.locator('#lbsrc').getAttribute('href') || ''));
      await p.locator('#lbnext').click(); await p.waitForTimeout(250);
      ok('arrow advances', (await p.locator('#lbcap').innerText()).includes('two'));
      ok('a public-domain image still names its provenance', /commons\.wikimedia/.test(await p.locator('#lbsrc').getAttribute('href') || ''));

      await p.keyboard.press('Escape'); await p.waitForTimeout(250);
      ok('Escape closes', !(await p.locator('#lightbox').isVisible()));
      await p.locator('.mcard[data-mi]').first().click(); await p.waitForTimeout(250);
      await p.locator('#lbclose').click(); await p.waitForTimeout(250);
      ok('the X closes', !(await p.locator('#lightbox').isVisible()));
      await p.locator('.mcard[data-mi]').first().click(); await p.waitForTimeout(250);
      await p.mouse.click(6, 6); await p.waitForTimeout(250);
      ok('clicking away closes', !(await p.locator('#lightbox').isVisible()));
      ok('no console errors', errs.length === 0, errs[0] || '');
      await p.close();
    }

    // The policy must not have had to move to make any of this work.
    const p2 = await b.newPage();
    await p2.goto(URL);
    const csp = await p2.evaluate(() => (document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || '');
    console.log('');
    ok('img-src is still only our own origin', /img-src 'self' data:(;|$)/.test(csp), (csp.match(/img-src[^;]*/) || [''])[0]);
    ok('no third-party host was let in', !/wikimedia|twimg|tiktok|googleapis|cdn/i.test(csp));
    ok('frames are still forbidden', /frame-src 'none'/.test(csp));
    await p2.close();
    await b.close();
  } finally {
    if (server) server.close();
    fs.rmSync(CASE_DIR, { recursive: true, force: true });
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
    fs.rmSync(IMG_DIR, { recursive: true, force: true });
    try { execFileSync('node', [path.join(ROOT, 'scripts', 'build.js')], { cwd: ROOT, stdio: 'pipe' }); } catch (e) { }
  }
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('\n  THE VIEWER IS BROKEN. It has shipped broken before — do not deploy this.\n'); process.exit(1); }
  console.log('  Viewer opens, closes by every route, and leaks nothing.\n');
})();
