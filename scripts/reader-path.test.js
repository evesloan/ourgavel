/* reader-path.test.js — can a reader who arrives from an embed actually take part?
 *
 * The embed is the only thing we hand a creator. It renders three invitations to a creator's
 * readers ("+ Your theory goes here — be the first, tap to post", "Or just ask something",
 * "Start the discussion" on every card) and, until this suite existed, every one of them was a
 * dead button: the composer dialog and its script are not shipped to the embed at all, so the
 * tap did nothing, with NO console error, on the creator's own page. Invisible from our side.
 *
 * And on the full board, the composer's no-endpoint path told the reader "your text is copied
 * to your clipboard so nothing is lost" while copying a hardcoded four fields — losing a
 * report's category, a connection's relation, and, for every mode, any record of WHICH case or
 * WHICH card the words were about.
 *
 * Both are the same species as the composer that promised reviewed replies while comments
 * published unscreened, and the embed poll that fetched a path that never existed: the site's
 * promises are where its bugs live. So this suite is written as promises, not as functions.
 *
 * Run: node scripts/reader-path.test.js   (needs /opt/node22/lib/node_modules/playwright)
 * Cross-origin for real: localhost:8909 frames 127.0.0.1:8908.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, '..', 'public');
const SLUG = 'lindsay-clancy';
const T = {'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.txt':'text/plain','.xml':'application/xml'};

function serve(root, port){ return new Promise(r=>{ const s=http.createServer((q,res)=>{
  let u=decodeURIComponent(q.url.split('?')[0]); if(u.endsWith('/')) u+='index.html';
  const f=path.join(root,u);
  if(!f.startsWith(root)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('404')}
  res.writeHead(200,{'content-type':T[path.extname(f)]||'application/octet-stream'});
  res.end(fs.readFileSync(f)); }); s.listen(port,'127.0.0.1',()=>r(s)); }); }

let pass=0, fail=0;
const ok=(c,m)=>{ c?(pass++,console.log('  ok   '+m)):(fail++,console.log('  FAIL '+m)); };

(async ()=>{
  if (!fs.existsSync(path.join(ROOT,'cases',SLUG,'board','embed','index.html'))) {
    console.error('  build first: node scripts/build.js'); process.exit(1);
  }
  const site = await serve(ROOT, 8908);
  const host = http.createServer((q,res)=>{res.writeHead(200,{'content-type':'text/html'});
    res.end(`<!doctype html><meta charset=utf-8><title>Creator page</title><h1>A creator's article</h1>
<iframe src="http://127.0.0.1:8908/cases/${SLUG}/board/embed/" width="100%" height="620" loading="lazy" title="board"></iframe>`)});
  await new Promise(r=>host.listen(8909,'127.0.0.1',r));

  const browser = await chromium.launch();
  const csp = [];
  const watchCsp = pg => pg.on('console', m => {
    const t = m.text();
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(t)) csp.push(t);
  });

  // ---------------------------------------------------------------- 1. IN THE EMBED
  console.log('\n  MUST NOT HAND A CREATOR A DEAD BUTTON');
  const ctx1 = await browser.newContext();
  const page = await ctx1.newPage(); watchCsp(page);
  await page.goto('http://localhost:8909/', {waitUntil:'networkidle'});
  const frame = page.frames().find(f=>f.url().includes('/embed/'));
  ok(!!frame, 'the embed loads cross-origin at all');

  const invites = await frame.$$eval('[data-compose], a[href*="#post="], a[href*="#card="]', els => els.map(e=>{
    const a = e.closest ? e.closest('a') : null;
    const link = e.tagName.toLowerCase()==='a' ? e : a;
    return { text:(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,60),
             href: link?link.getAttribute('href'):null,
             target: link?link.getAttribute('target'):null,
             rel: link?link.getAttribute('rel'):null };
  }));
  const seen=new Set(); const uniq=invites.filter(i=>{const k=i.href||i.text; if(seen.has(k))return false; seen.add(k); return true});
  ok(uniq.length>0, 'the embed still invites the reader to take part ('+uniq.length+' invitation(s))');
  uniq.forEach(i=>{
    const what = '"'+i.text+'"';
    ok(!!i.href, 'invitation '+what+' goes somewhere a reader can actually post');
    if(i.href){
      ok(/^https?:\/\/[^/]+\/cases\//.test(i.href), what+' points at the full board, absolutely');
      ok(i.href.includes('#'), what+' carries what the reader asked for in the hash');
      ok(i.target==='_blank', what+' opens a new tab — it must not navigate the creator away from their own article');
      ok((i.rel||'').includes('noopener'), what+' is rel=noopener');
    }
  });

  // a card's discussion link, which only exists once a card is open
  const node = await frame.$('.node');
  if (node) {
    await node.click({force:true}); await page.waitForTimeout(350);
    const disc = await frame.$('a[href*="post=comment"], [data-compose="comment"]');
    ok(!!disc, 'an open card still offers the discussion');
    if (disc) {
      const tag = await disc.evaluate(e=>e.tagName.toLowerCase());
      const href = await disc.getAttribute('href');
      ok(tag==='a' && !!href, 'the discussion invitation is a real link, not a dead button');
      if (href) ok(/#card=[^&]+&post=comment/.test(href), 'it names the card the reader was reading: '+href.split('#')[1]);
    }
  }
  ok(csp.length===0, 'no CSP violation in the embed ('+csp.length+')');

  // -------------------------------------------------- 2. WHERE THOSE LINKS LAND
  console.log('\n  MUST LAND WHERE IT PROMISED');
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage(); const csp2=[];
  p2.on('console', m=>{const t=m.text(); if(/Content Security Policy|Refused to/i.test(t))csp2.push(t)});
  const cardId = await frame.$eval('.node', e=>e.getAttribute('data-id'));
  await p2.goto(`http://127.0.0.1:8908/cases/${SLUG}/board/#card=${encodeURIComponent(cardId)}&post=comment`, {waitUntil:'networkidle'});
  await p2.waitForTimeout(900);
  const composerOpen = await p2.evaluate(()=>{const b=document.getElementById('gbc');return !!(b&&!b.hidden)});
  ok(composerOpen, 'arriving with #post=comment opens the composer, not a cold board');
  const onCard = await p2.evaluate(()=>{const c=document.querySelector('.gbc-ctx');return c?c.textContent:''});
  ok(/./.test(onCard), 'the composer knows which card the reader came from: "'+onCard.replace(/\s+/g,' ').trim()+'"');
  const detailOpen = await p2.evaluate(()=>{const d=document.getElementById('detail');return !!(d&&d.classList.contains('open'))});
  ok(detailOpen, 'the card itself is open behind it');
  ok(csp2.length===0, 'no CSP violation on the board ('+csp2.length+')');

  // --------------------------------------------- 3. "NOTHING IS LOST"
  console.log('\n  MUST NOT PROMISE MORE THAN IT SAVES');
  const ctx3 = await browser.newContext({permissions:['clipboard-read','clipboard-write']});
  const p3 = await ctx3.newPage();
  await p3.goto(`http://127.0.0.1:8908/cases/${SLUG}/board/`, {waitUntil:'networkidle'});
  const CARD = 'The voice she says commanded her';
  const MODES = [
    {mode:'theory',    fill:{claim:'The dispatch timeline does not fit', reasoning:'The logs and the account disagree by twenty minutes', falsify:'A CAD printout showing one call'}},
    {mode:'question',  fill:{question:'Why was the dispatch audio never played?', context:'Both outlets say it exists'}},
    {mode:'comment',   fill:{comment:'This card needs the defence proffer attached'}},
    {mode:'report',    fill:{detail:'This card cites an outlet that does not say what is claimed'}},
    {mode:'correction',fill:{claim:'The date on this entry is wrong', url:'https://www.courttv.com/', detail:'The hearing was the 14th not the 11th'}},
    {mode:'evidence',  fill:{url:'https://www.courttv.com/', claim:'Court TV wrote up the week', reasoning:'It settles the sequence of week four'}},
  ];
  for (const t of MODES) {
    await p3.evaluate(m=>window.gbCompose(m,{caseSlug:'lindsay-clancy',node:'f-voice',nodeTitle:'The voice she says commanded her'}), t.mode);
    await p3.waitForTimeout(120);
    for (const [k,v] of Object.entries(t.fill)) { const sel='#gbcf-'+k; if (await p3.$(sel)) await p3.fill(sel,v); }
    const selects = await p3.$$eval('#gbc select', els=>els.map(e=>e.value)).catch(()=>[]);
    await p3.evaluate(()=>navigator.clipboard.writeText('__NOTHING__'));
    await p3.click('#gbc-post'); await p3.waitForTimeout(350);
    const status = ((await p3.textContent('#gbc-status').catch(()=>''))||'').trim();
    const clip = await p3.evaluate(()=>navigator.clipboard.readText());
    const typed = Object.values(t.fill);
    const lost = typed.filter(v=>!clip.includes(v)).concat(selects.filter(v=>v&&!clip.includes(v)));
    console.log('    ['+t.mode+'] said: "'+status.slice(0,64)+'…"');
    ok(clip!=='__NOTHING__', t.mode+': something was actually copied');
    ok(lost.length===0, t.mode+': every field the reader filled in survived'+(lost.length?' — LOST '+JSON.stringify(lost):''));
    ok(clip.includes(SLUG), t.mode+': the copy records which CASE');
    ok(clip.includes(CARD), t.mode+': the copy records which CARD');
    ok(/nothing is lost/i.test(status)===false || lost.length===0, t.mode+': it only claims "nothing is lost" when nothing was');
    await p3.evaluate(()=>{const c=document.getElementById('gbc-cancel');if(c)c.click()}); await p3.waitForTimeout(60);
  }

  await browser.close(); site.close(); host.close();
  console.log('\n  '+pass+' passed, '+fail+' failed');
  console.log(fail ? '  A creator\'s reader hits a dead end.' : '  The reader path holds, embed to post.');
  process.exit(fail?1:0);
})().catch(e=>{console.error('  HARNESS ERROR',e);process.exit(2)});
