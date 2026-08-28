/* The embeddable board, on somebody else's website, in a real browser.
 * Run: node scripts/embed.test.js
 *
 * Why this exists. The embed is the one thing we offer creators: "Paste this anywhere that
 * accepts HTML. The board stays live: reader theories, new evidence and every update appear in
 * your embed automatically, and each card keeps its sources." That is a promise made on our
 * board page to someone who is about to put our code on their site. Nothing checked it.
 *
 * It was false. The freshness poll fetched './board-data.json'; the embed lives one directory
 * deeper than the board, so on every embed it 404'd every sixty seconds, in the creator's
 * readers' browsers, forever — and the "Load the latest" toast could never fire. Found by
 * loading the real embed code in a real cross-origin page and watching the network, which is
 * the only place it was ever visible.
 *
 * So the halves are: MUST HAND OUT (the code on the board page is correct and self-consistent
 * for all five cases) and MUST WORK EMBEDDED (it renders, keeps its sources, links home, leaks
 * nobody, and actually goes live). Assertions here are about the promise, not the markup.
 */
const fs = require('fs'), path = require('path'), http = require('http');
const { execFileSync } = require('child_process');
const { skipUnlessBrowser, launch } = require('./test-browser.js');
skipUnlessBrowser('embed.test.js');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const SITE_PORT = 8908, CREATOR_PORT = 8909;
const SITE_ORIGIN = `http://127.0.0.1:${SITE_PORT}`;      // deliberately different hosts, so the
const CREATOR_ORIGIN = `http://localhost:${CREATOR_PORT}`; // iframe is genuinely cross-origin

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  FAIL: ' + m); } };
const eq = (a, b, m) => ok(a === b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function serve(root, port) {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      let p = decodeURIComponent(q.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(root, p);
      if (!f.startsWith(root)) { r.writeHead(403); return r.end(); }
      fs.readFile(f, (e, d) => {
        if (e) { r.writeHead(404, { 'content-type': 'text/plain' }); return r.end('not found'); }
        const ext = path.extname(f);
        r.writeHead(200, { 'content-type': ext === '.json' ? 'application/json'
          : ext === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream' });
        r.end(d);
      });
    });
    s.listen(port, () => res(s));
  });
}

const slugs = fs.readdirSync(path.join(ROOT, 'data', 'cases'))
  .filter(s => fs.existsSync(path.join(ROOT, 'data', 'cases', s, 'board.json'))).sort();

(async () => {
  console.log('Building so nothing is tested against stale output...');
  execFileSync('node', [path.join(__dirname, 'build.js')], { cwd: ROOT, stdio: 'pipe' });

  /* ============ HALF 1 — the code we hand out ============================================= */
  console.log('\nMUST HAND OUT — the embed code on the board page, all cases');
  const codes = {};
  for (const slug of slugs) {
    const boardFile = path.join(PUB, 'cases', slug, 'board', 'index.html');
    const embedFile = path.join(PUB, 'cases', slug, 'board', 'embed', 'index.html');
    ok(fs.existsSync(boardFile), `${slug}: board page built`);
    ok(fs.existsSync(embedFile), `${slug}: embed page built`);
    if (!fs.existsSync(boardFile) || !fs.existsSync(embedFile)) continue;

    const board = fs.readFileSync(boardFile, 'utf8');
    const embed = fs.readFileSync(embedFile, 'utf8');

    // The code a creator actually copies, read out of the page rather than written here.
    const m = board.match(/<textarea id="embedcode"[^>]*>([\s\S]*?)<\/textarea>/);
    ok(m, `${slug}: board page offers an embed code`);
    if (!m) continue;
    const code = unesc(m[1]).trim();
    codes[slug] = code;
    const src = (code.match(/src="([^"]+)"/) || [])[1] || '';
    ok(/^https:\/\//.test(src), `${slug}: embed src is absolute https (got ${src})`);
    ok(src.endsWith(`/cases/${slug}/board/embed/`), `${slug}: embed src points at this case's embed`);
    ok(/title="[^"]+"/.test(code), `${slug}: iframe carries a title for screen readers`);
    ok(/loading="lazy"/.test(code), `${slug}: iframe is lazy — we do not slow a creator's page`);
    ok(!/onload=|onerror=|<script/i.test(code), `${slug}: embed code is inert markup, no script`);

    // The promise printed directly above that code: the embed stays live.
    for (const [label, html, dir] of [
      ['embed', embed, path.join(PUB, 'cases', slug, 'board', 'embed')],
      ['board', board, path.join(PUB, 'cases', slug, 'board')],
    ]) {
      const f = html.match(/fetch\('([^']*board-data\.json)'/);
      ok(f, `${slug}/${label}: page polls for freshness`);
      if (!f) continue;
      const target = path.resolve(dir, f[1]);
      ok(fs.existsSync(target),
        `${slug}/${label}: its freshness poll '${f[1]}' resolves to a file that exists`);
      if (!fs.existsSync(target)) continue;
      let j = null; try { j = JSON.parse(fs.readFileSync(target, 'utf8')); } catch (e) {}
      ok(j && typeof j.serial === 'string' && j.serial,
        `${slug}/${label}: freshness endpoint returns a serial`);
      const baked = (html.match(/var SERIAL=("[^"]*")/) || [])[1];
      ok(baked && JSON.parse(baked) === j.serial,
        `${slug}/${label}: page and endpoint agree on the current serial`);
    }

    // An embed with no way home is charity, not distribution.
    const back = embed.match(/<a class="eb" href="([^"]+)"/);
    ok(back, `${slug}: embed links back to OurGavel`);
    ok(back && back[1].endsWith(`/cases/${slug}/board/`), `${slug}: backlink goes to the full board`);
    ok(back && /<a class="eb" [^>]*rel="noopener"/.test(embed),
      `${slug}: backlink is rel=noopener — we do not hand a creator's tab to ourselves`);
    ok(/<link rel="canonical" href="[^"]*\/cases\/[^"]*\/board\/"/.test(embed),
      `${slug}: embed canonicalises to the board, not to itself`);
    ok(!/src="http(?!:\/\/127\.0\.0\.1)/.test(embed.replace(/<a [^>]*>/g, '')),
      `${slug}: embed page hotlinks nothing`);
  }
  // This asserted the opposite until 2026-08-22, and it was wrong — not about the embed, which
  // is what this suite is for, but about how duplicates are consolidated. robots.txt cannot
  // canonicalise. Google: "Don't use the robots.txt file for canonicalization purposes." A
  // disallowed URL can still be indexed with no content attached, and its canonical is never
  // read — so the block stranded both the canonical above and the embed's one link home, which
  // is the only inbound link surface we have. The canonical does this job; the Disallow undid it.
  const robots = fs.readFileSync(path.join(PUB, 'robots.txt'), 'utf8');
  ok(!/Disallow:.*board\/embed/.test(robots),
    'robots.txt must NOT block the embeds — a disallowed URL\'s canonical is never read');

  /* ============ HALF 2 — on somebody else's website ======================================= */
  console.log('\nMUST WORK EMBEDDED — real browser, real cross-origin page');
  fs.mkdirSync('/tmp/ourgavel-creator', { recursive: true });
  fs.writeFileSync('/tmp/ourgavel-creator/index.html',
    // data: favicon suppresses the browser's implicit /favicon.ico fetch, whose 404 against
    // this bare test server surfaces as a console error on whichever case runs FIRST (then
    // caches) — a timing-flaky false red that once failed the suite on alex-murdaugh only.
    '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>A creator page</title>' +
    '<body style="font-family:system-ui"><h1>My trial coverage</h1><div id="slot"></div>');

  const siteSrv = await serve(PUB, SITE_PORT);
  const creatorSrv = await serve('/tmp/ourgavel-creator', CREATOR_PORT);
  const browser = await launch();
  try {
    for (const slug of slugs.slice(0, 2)) {
      if (!codes[slug]) continue;
      const board = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'cases', slug, 'board.json'), 'utf8'));
      const page = await browser.newPage();
      const errs = [], bad = [], foreign = [];
      page.on('console', c => { if (c.type() === 'error') errs.push(c.text()); });
      page.on('pageerror', e => errs.push('pageerror: ' + e.message));
      page.on('response', r => {
        if (r.status() >= 400) bad.push(r.status() + ' ' + r.url());
        if (!r.url().startsWith(SITE_ORIGIN) && !r.url().startsWith(CREATOR_ORIGIN)
            && !r.url().startsWith('data:')) foreign.push(r.url());
      });

      await page.goto(CREATOR_ORIGIN + '/', { waitUntil: 'load' });
      await page.evaluate(c => { document.getElementById('slot').innerHTML = c; },
        codes[slug].replace(/https:\/\/[^/]+/, SITE_ORIGIN));
      await page.waitForTimeout(1800);

      const frame = page.frames().find(f => f.url().includes(`/cases/${slug}/board/embed/`));
      ok(frame, `${slug}: the iframe is not blocked from a third-party origin`);
      if (!frame) { await page.close(); continue; }

      const nodes = await frame.locator('svg g.node').count();
      eq(nodes, board.nodes.length, `${slug}: every board node renders inside the embed`);
      ok(await frame.locator('.ebar .et').isVisible(), `${slug}: case title bar is visible`);
      ok((await frame.locator('.eb').getAttribute('href') || '').includes(`/cases/${slug}/board/`),
        `${slug}: the visible backlink points home`);

      // "each card keeps its sources" — the whole reason a creator would trust the thing.
      const sourced = board.nodes.find(n => (n.sources || []).length);
      await frame.locator(`svg g.node[data-id="${sourced.id}"]`).click({ force: true });
      await page.waitForTimeout(700);
      ok(await frame.locator('#detail').isVisible(), `${slug}: a card opens inside the embed`);
      const links = await frame.locator('#detail-in a[href^="https://"]').count();
      ok(links > 0, `${slug}: the open card shows at least one source link`);
      const href = await frame.locator('#detail-in a[href^="https://"]').first().getAttribute('href');
      ok(href && href === sourced.sources[0].url,
        `${slug}: that link is the node's own cited source`);

      // The live promise, exercised rather than waited for.
      const embedHtml = fs.readFileSync(path.join(PUB, 'cases', slug, 'board', 'embed', 'index.html'), 'utf8');
      const pollPath = embedHtml.match(/fetch\('([^']*board-data\.json)'/)[1];
      const bakedSerial = JSON.parse(embedHtml.match(/var SERIAL=("[^"]*")/)[1]);
      const before = await frame.evaluate(p => fetch(p, { cache: 'no-store' })
        .then(r => r.ok ? r.json().then(j => ({ status: r.status, serial: j.serial }))
                        : ({ status: r.status, serial: null })).catch(e => ({ status: 0, serial: null })), pollPath);
      eq(before.status, 200, `${slug}: the embed's own freshness poll succeeds from inside the frame`);
      eq(before.serial, bakedSerial, `${slug}: it reports the serial this embed was built with`);

      // Rebuild — a pulse — and the embed must be able to notice.
      await new Promise(r => setTimeout(r, 1100));
      execFileSync('node', [path.join(__dirname, 'build.js')], { cwd: ROOT, stdio: 'pipe' });
      const after = await frame.evaluate(p => fetch(p, { cache: 'no-store' })
        .then(r => r.ok ? r.json().then(j => ({ status: r.status, serial: j.serial }))
                        : ({ status: r.status, serial: null })).catch(e => ({ status: 0, serial: null })), pollPath);
      eq(after.status, 200, `${slug}: still succeeds after a rebuild`);
      ok(after.serial && after.serial !== bakedSerial,
        `${slug}: the embed can see that the board moved on — "Load the latest" can fire`);

      eq(bad.length, 0, `${slug}: no failed requests on the creator's page (${bad.join(', ')})`);
      eq(errs.length, 0, `${slug}: no console errors on the creator's page (${errs.join(' | ')})`);
      eq(foreign.length, 0, `${slug}: the embed sends the creator's readers to nobody (${foreign.join(', ')})`);
      await page.close();
    }
  } finally {
    await browser.close(); siteSrv.close(); creatorSrv.close();
    fs.rmSync('/tmp/ourgavel-creator', { recursive: true, force: true });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
