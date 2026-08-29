/* Weekly UX walkthrough — scripted first-time-reader journey, real browser.
 * home -> case -> board -> open a card -> every composer mode -> embed.
 * Run at 390px and 1280px. Zero console errors, zero CSP violations, no horizontal scroll.
 * Screenshots to /tmp/ux/. Not a gated test — a manual walkthrough harness.
 */
const fs = require('fs'), path = require('path'), http = require('http');
const { launch } = require('./test-browser.js');
const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const PORT = 8971;
const SLUG = 'lindsay-clancy';
const OUT = '/tmp/ux';
const TYPES = { '.html':'text/html','.png':'image/png','.json':'application/json','.svg':'image/svg+xml','.js':'text/javascript','.css':'text/css','.xml':'application/xml','.txt':'text/plain' };
const MODES = ['question','theory','comment','report','correction','evidence','connection','request'];

fs.mkdirSync(OUT, { recursive: true });
let fails = [];
const flag = (w, msg) => { fails.push('[' + w + '] ' + msg); console.log('  DEFECT [' + w + '] ' + msg); };

(async () => {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    const f = path.join(PUB, rel.endsWith('/') || !rel ? rel + 'index.html' : rel);
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  await new Promise(r => server.listen(PORT, r));
  const b = await launch();
  if (!b) { console.log('NO BROWSER — cannot run walkthrough'); process.exit(2); }
  const base = 'http://localhost:' + PORT;

  for (const [w, h, label, mob] of [[1280,900,'desktop',false],[390,844,'mobile',true]]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob });
    const errs = [], csp = [];
    p.on('pageerror', e => errs.push(e.message.slice(0,100)));
    p.on('console', m => { const t = m.text(); if (/content security policy|refused to|violat/i.test(t)) csp.push(t.slice(0,120)); });
    await p.addInitScript(() => { document.addEventListener('securitypolicyviolation', e => { (window.__csp=window.__csp||[]).push(e.violatedDirective + ' ' + e.blockedURI); }); });

    const noScroll = async (where) => {
      const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 1) flag(label, where + ': horizontal scroll, scrollWidth overflows by ' + over + 'px');
    };
    const drain = async (where) => {
      const pageCsp = await p.evaluate(() => window.__csp || []);
      if (errs.length) { flag(label, where + ': console errors — ' + errs.join(' | ')); errs.length = 0; }
      if (csp.length || pageCsp.length) { flag(label, where + ': CSP violation — ' + csp.concat(pageCsp).join(' | ')); csp.length = 0; }
    };

    // 1. HOME
    await p.goto(base + '/', { waitUntil: 'networkidle' });
    await noScroll('home'); await drain('home');
    const cases = await p.$$eval('a[href*="/cases/"]', a => a.length);
    if (cases < 6) flag(label, 'home: expected >=6 case links, found ' + cases);
    await p.screenshot({ path: OUT + '/' + label + '-1-home.png' });

    // 2. CASE
    await p.goto(base + '/cases/' + SLUG + '/', { waitUntil: 'networkidle' });
    await noScroll('case'); await drain('case');
    const hasBoard = await p.$('a[href*="/board/"]');
    if (!hasBoard) flag(label, 'case: no link to the board');
    await p.screenshot({ path: OUT + '/' + label + '-2-case.png' });

    // 3. BOARD
    await p.goto(base + '/cases/' + SLUG + '/board/', { waitUntil: 'networkidle' });
    await noScroll('board'); await drain('board');
    const nodes = await p.$$('.node');
    if (nodes.length < 3) flag(label, 'board: expected board nodes, found ' + nodes.length);
    await p.screenshot({ path: OUT + '/' + label + '-3-board.png' });

    // 4. OPEN A CARD
    if (nodes.length) {
      await nodes[0].click();
      await p.waitForTimeout(150);
      const open = await p.evaluate(() => { const d = document.getElementById('detail'); if (!d) return null; const s = getComputedStyle(d); return s.display !== 'none' && s.visibility !== 'hidden'; });
      if (open === null) flag(label, 'card: no #detail panel in DOM');
      else if (!open) flag(label, 'card: clicking a node did not open the detail panel');
      await noScroll('card-open'); await drain('card-open');
      await p.screenshot({ path: OUT + '/' + label + '-4-card.png' });
      const close = await p.$('#detail-close'); if (close) { await close.click(); await p.waitForTimeout(80); }
    }

    // 5. COMPOSER — every mode opens and validates
    await p.evaluate(() => {
      window.__sent = [];
      try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { window.__sent.push(t); return Promise.resolve(); } }, configurable: true }); } catch (e) {}
      window.fetch = (u, o) => { if (o && o.body) window.__sent.push(String(o.body)); return Promise.resolve(new Response(JSON.stringify({ ok:true, url:'https://example.invalid/1', number:1 }), { status:200, headers:{'content-type':'application/json'} })); };
    });
    for (const m of MODES) {
      const rendered = await p.evaluate(mode => {
        try { window.gbCompose(mode, { caseSlug:'x', node:'n1', nodeTitle:'A card', from:'a', to:'b' }); } catch (e) { return { err: String(e.message) }; }
        return { ids: [...document.querySelectorAll('[id^=gbcf-]')].map(e => e.id.replace('gbcf-','')) };
      }, m);
      if (rendered.err) flag(label, 'composer/' + m + ': threw ' + rendered.err);
      else if (!rendered.ids || !rendered.ids.length) flag(label, 'composer/' + m + ': opened but rendered no fields');
      await p.waitForTimeout(40);
    }
    await drain('composer');
    await p.screenshot({ path: OUT + '/' + label + '-5-composer.png' });

    // 6. EMBED
    await p.goto(base + '/cases/' + SLUG + '/board/embed/', { waitUntil: 'networkidle' });
    await p.waitForTimeout(200);
    await noScroll('embed'); await drain('embed');
    const embedBody = await p.evaluate(() => document.body ? document.body.innerText.trim().length : 0);
    if (embedBody < 20) flag(label, 'embed: board embed rendered little/no content (' + embedBody + ' chars)');
    await p.screenshot({ path: OUT + '/' + label + '-6-embed.png' });

    await p.close();
  }

  await b.close();
  await new Promise(r => server.close(r));
  console.log('\n' + (fails.length ? fails.length + ' DEFECT(S)' : 'CLEAN — no defects') + '\nScreenshots in ' + OUT);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('WALKTHROUGH ERROR', e); process.exit(3); });
