/* The composer, in a real browser. Run: node scripts/composer.test.js
 *
 * This exists because two of the six posting modes could not post at all and nobody noticed.
 * The fields a mode renders are keyed by their own names; the payload was read under fixed
 * names. So the comment box and the report detail came back empty, the "a little more detail,
 * please" guard fired, and every attempt to reply to a card or report a problem was refused —
 * silently, with the reader blamed for it.
 *
 * Nothing here talks to the network. With no SUBMIT_ENDPOINT the composer copies the text to
 * the clipboard instead of posting, which is exactly the point at which the payload can be
 * inspected.
 */
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const ROOT = path.join(__dirname, '..');
const PORT = 8908;
const TYPES = { '.html': 'text/html', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.css': 'text/css', '.xml': 'application/xml', '.txt': 'text/plain' };

// Every mode, what it must accept, and what must survive into the payload.
const MODES = [
  { mode: 'question', needs: ['question'], carries: 'claim' },
  { mode: 'theory', needs: ['claim'], carries: 'claim' },
  { mode: 'comment', needs: ['comment'], carries: 'reasoning' },
  { mode: 'report', needs: ['detail'], carries: 'reasoning' },
  { mode: 'correction', needs: ['claim', 'detail'], carries: 'reasoning' },
  { mode: 'evidence', needs: ['url', 'claim'], carries: 'claim' },
  { mode: 'connection', needs: ['reasoning'], carries: 'reasoning' },
  { mode: 'request', needs: ['claim'], carries: 'claim' },
];

let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : (fail++, console.log('  FAIL  ' + n + (x ? ' — ' + x : ''))); };

(async () => {
  const slug = fs.readdirSync(path.join(ROOT, 'data', 'cases')).find(d => !d.startsWith('zz-'));
  const boardFile = path.join(ROOT, 'public', 'cases', slug, 'board', 'index.html');
  if (!fs.existsSync(boardFile)) { console.error('\n  Build first: node scripts/build.js\n'); process.exit(1); }

  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    const f = path.join(ROOT, 'public', rel.endsWith('/') || !rel ? rel + 'index.html' : rel);
    if (!f.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  try {
    for (const [w, h, label, mob] of [[1280, 900, 'desktop', false], [390, 844, 'mobile', true]]) {
      const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob });
      const errs = [];
      p.on('pageerror', e => errs.push(e.message.slice(0, 80)));
      await p.goto('http://localhost:' + PORT + '/cases/' + slug + '/board/', { waitUntil: 'networkidle' });
      // Capture what the composer would send instead of letting it reach a clipboard.
      // Capture BOTH channels. With no SUBMIT_ENDPOINT the composer copies the reader's text
      // to the clipboard; with one it POSTs to the relay. The promise under test is the same
      // either way -- nothing the reader typed is lost -- so the capture follows the channel
      // rather than the assertion being narrowed to whichever one happens to be wired today.
      // fetch is stubbed, so this never reaches the network and files no issue.
      await p.evaluate(() => {
        window.__sent = [];
        try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { window.__sent.push(t); return Promise.resolve(); } }, configurable: true }); }
        catch (e) { window.__clipFail = String(e.message); }
        window.__realFetch = window.fetch;
        window.fetch = (u, o) => {
          if (o && o.body) window.__sent.push(String(o.body));
          return Promise.resolve(new Response(JSON.stringify({ ok: true, url: 'https://example.invalid/issues/1', number: 1 }),
            { status: 200, headers: { 'content-type': 'application/json' } }));
        };
      });
      console.log('\n  [' + label + ']');

      for (const M of MODES) {
        await p.evaluate(m => window.gbCompose(m, { caseSlug: 'x', node: 'n1', nodeTitle: 'A card', from: 'a', to: 'b' }), M.mode);
        await p.waitForTimeout(90);
        const ids = await p.evaluate(() => [...document.querySelectorAll('[id^=gbcf-]')].map(e => e.id.replace('gbcf-', '')));
        for (const need of M.needs) {
          if (!ids.includes(need)) { fail++; console.log('  FAIL  ' + M.mode + ' should render a "' + need + '" field, rendered [' + ids.join(',') + ']'); }
          else pass++;
        }
        const marker = 'Typed into ' + M.mode + ' and it must survive to the payload.';
        await p.evaluate(([list, text]) => {
          for (const i of list) {
            const e = document.getElementById('gbcf-' + i);
            if (!e || e.tagName === 'SELECT') continue;
            e.value = i === 'url' ? 'https://example.gov/filing.pdf' : text;
          }
        }, [ids, marker]);
        await p.evaluate(() => { window.__sent = []; });
        await p.locator('#gbc-post').click();
        await p.waitForTimeout(150);
        const status = await p.evaluate(() => (document.getElementById('gbc-status') || {}).textContent || '');
        ok(M.mode + ' can be submitted', !/more detail|needs a link/i.test(status), status);
        const sent = await p.evaluate(() => (window.__sent || []).join(' '));
        ok(M.mode + ' carries the reader\'s words in "' + M.carries + '"', sent.includes(marker),
          sent ? 'sent: ' + sent.slice(0, 60) : 'nothing was sent');
        await p.keyboard.press('Escape'); await p.waitForTimeout(60);
      }

      // Eve's report: a short comment was refused over and over. Both causes are covered —
      // the field mapping above, and the floor here.
      await p.evaluate(() => window.gbCompose('comment', { caseSlug: 'x', node: 'n1', nodeTitle: 'A card' }));
      await p.waitForTimeout(90);
      await p.evaluate(() => { document.getElementById('gbcf-comment').value = 'The timeline does not fit.'; window.__sent = []; });
      await p.locator('#gbc-post').click(); await p.waitForTimeout(150);
      ok('a one-sentence comment is accepted', !/more detail|at least/i.test(await p.evaluate(() => (document.getElementById('gbc-status') || {}).textContent || '')));
      await p.keyboard.press('Escape'); await p.waitForTimeout(60);

      await p.evaluate(() => window.gbCompose('comment', { caseSlug: 'x', node: 'n1', nodeTitle: 'A card' }));
      await p.waitForTimeout(90);
      await p.evaluate(() => { document.getElementById('gbcf-comment').value = 'Agreed strongly here.'; window.__sent = []; });
      await p.locator('#gbc-post').click(); await p.waitForTimeout(150);
      ok('three words is enough', !/at least/i.test(await p.evaluate(() => (document.getElementById('gbc-status') || {}).textContent || '')));
      await p.keyboard.press('Escape'); await p.waitForTimeout(60);

      await p.evaluate(() => window.gbCompose('comment', { caseSlug: 'x', node: 'n1', nodeTitle: 'A card' }));
      await p.waitForTimeout(90);
      await p.evaluate(() => { document.getElementById('gbcf-comment').value = 'ok'; });
      await p.locator('#gbc-post').click(); await p.waitForTimeout(150);
      ok('one word is still refused, and says why', /at least/i.test(await p.evaluate(() => (document.getElementById('gbc-status') || {}).textContent || '')));
      await p.keyboard.press('Escape'); await p.waitForTimeout(60);

      ok('a question can be started from the board toolbar', await p.locator('[data-compose="question"]').first().isVisible());
      ok('no console errors', errs.length === 0, errs[0] || '');
      await p.close();
    }

    // Say which channel was exercised, so a green run cannot hide the fact that only one of
  // the two paths is reachable in this build.
  const board = fs.readFileSync(path.join(ROOT, 'public', 'cases', slug, 'board', 'index.html'), 'utf8');
  const endpoint = (board.match(/var ENDPOINT="([^"]*)"/) || [])[1] || '';
  console.log('\n  channel under test: ' + (endpoint ? 'relay POST -> ' + endpoint : 'clipboard fallback (no SUBMIT_ENDPOINT)'));

  const submitPage = fs.readFileSync(path.join(ROOT, 'public', 'submit', 'index.html'), 'utf8');
    ok('the submit page offers asking a question', /data-compose="question"/.test(submitPage));
  } finally {
    await b.close(); server.close();
  }

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('\n  A POSTING MODE IS BROKEN. Two shipped broken and silent — do not deploy this.\n'); process.exit(1); }
  console.log('  Every posting mode renders, validates and carries its text.\n');
})();
