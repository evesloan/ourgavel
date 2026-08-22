#!/usr/bin/env node
/* OurGavel static site generator. No dependencies. Node 18+.
   Multi-case: every directory under data/cases/<slug>/ with a case.json becomes a full
   case section (hub, timeline, witnesses, standard, board). Adding a case = adding data. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const BUILT_AT = new Date().toISOString();
const REPO = process.env.GB_REPO || 'evesloan/ourgavel';
// A CNAME file is the single source of truth for where this site lives. If one exists we are
// on a custom domain: links are root-relative and absolute URLs use it. Otherwise we fall back
// to the project-pages subpath. This deliberately outranks GB_BASE so the domain can be switched
// on by adding one file, without touching the workflow.
const CNAME = (() => {
  for (const p of [path.join(ROOT, 'CNAME'), path.join(ROOT, 'public', 'CNAME')]) {
    if (fs.existsSync(p)) {
      const d = fs.readFileSync(p, 'utf8').trim().split(/\s+/)[0];
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)) return d;
    }
  }
  return '';
})();
const BASE = CNAME ? '' : (process.env.GB_BASE || '');
const SITE = CNAME ? `https://${CNAME}` : (process.env.GB_SITE || 'https://evesloan.github.io/ourgavel'); // '/ourgavel' when served from project-pages subpath; '' on the custom domain
const SITE_NAME = 'OurGavel';
const TAGLINE = 'The record. The rumors. The line between.';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const fmtDate = iso => new Date(iso + (iso.length === 10 ? 'T12:00:00Z' : '')).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
const fmtTs = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';

// Only http(s) URLs may reach an href — blocks javascript:/data: from community submissions.
const safeUrl = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : '#';
// JSON embedded in a <script> block: neutralize tag breakout and JS line terminators.
const jsonScript = o => JSON.stringify(o)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/* ---- Pip, Clerk of the Board -------------------------------------------------
   OurGavel's mascot: a courtroom mouse in a powdered wig and jabot. Cute, but
   politely curt. Fixed colours (not theme vars) so he is the same creature on
   parchment and in the dark. Never redraw him ad hoc — use pip(). See STYLE.md. */
function pip(size, opts) {
  opts = opts || {};
  const s = size || 28;
  const tiny = s < 34;
  const gavel = opts.gavel ? `
    <g transform="translate(46,40) rotate(-24)">
      <rect x="0" y="0" width="15" height="7" rx="1.6" fill="#7a5a2e"/>
      <rect x="5.5" y="6" width="3.4" height="12" rx="1.2" fill="#9a7440"/>
    </g>` : '';
  return `<svg class="pip" width="${s}" height="${s}" viewBox="0 0 64 64" role="img" aria-label="${esc(opts.alt || 'Pip, clerk of the board')}" focusable="false">
  <ellipse cx="17" cy="24" rx="9.5" ry="9" fill="#a4907a"/><ellipse cx="17" cy="24" rx="5.4" ry="5" fill="#c99f97"/>
  <ellipse cx="47" cy="24" rx="9.5" ry="9" fill="#a4907a"/><ellipse cx="47" cy="24" rx="5.4" ry="5" fill="#c99f97"/>
  <path d="M14 30c0-9 8-14 18-14s18 5 18 14c0 4-1.5 7-4 9.4-1.6 6-7.4 9.6-14 9.6s-12.4-3.6-14-9.6C15.5 37 14 34 14 30z" fill="#f7f2e6"/>
  <ellipse cx="32" cy="36" rx="14" ry="13" fill="#a4907a"/>
  <ellipse cx="15.5" cy="33" rx="4.6" ry="6" fill="#f7f2e6"/><ellipse cx="48.5" cy="33" rx="4.6" ry="6" fill="#f7f2e6"/>
  <ellipse cx="15.5" cy="38.5" rx="4" ry="4.6" fill="#e2d9c6"/><ellipse cx="48.5" cy="38.5" rx="4" ry="4.6" fill="#e2d9c6"/>
  <ellipse cx="26" cy="35" rx="2.5" ry="2.9" fill="#2b2119"/><ellipse cx="38" cy="35" rx="2.5" ry="2.9" fill="#2b2119"/>
  ${tiny ? '' : '<ellipse cx="26.9" cy="34" rx=".9" ry="1" fill="#fbf7ec"/><ellipse cx="38.9" cy="34" rx=".9" ry="1" fill="#fbf7ec"/>'}
  <ellipse cx="32" cy="41.5" rx="2.6" ry="2" fill="#8d4f4a"/>
  <path d="M30 45.5c.8 1 3.2 1 4 0" stroke="#6b5445" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  ${tiny ? '' : '<path d="M20 40.5l-8-2M20 43.5l-8 1.6M44 40.5l8-2M44 43.5l8 1.6" stroke="#7d6c58" stroke-width="1.1" stroke-linecap="round" opacity=".75"/>'}
  <path d="M32 49c5 0 8 2 8 2-1.4 4.4-4.2 6.4-8 6.4S25.4 55.4 24 51c0 0 3-2 8-2z" fill="#fbf7ec" stroke="#d9cfb8" stroke-width="1"/>
  ${tiny ? '' : '<path d="M32 49.5v7.6M28.6 50.6l1.6 6M35.4 50.6l-1.6 6" stroke="#d9cfb8" stroke-width=".9"/>'}
  ${gavel}
</svg>`;
}
// Pip speaks in short, courteous, clipped lines. Never chatty, never cute-talk.
const PIP = {
  tapCard: 'Order, please. Tap a card to see its sources.',
  pinch: 'Pinch to zoom, drag to explore. Or switch to List and read it all.',
  reset: 'View reset. Thank you.',
  connecting: 'Very good. Now tap the card it relates to.',
  connected: 'Noted. It joins the Board after review.',
  updated: 'The Board has been amended.',
  emptyZone: 'No reader theories yet. Yours would be first.',
};

function srcLinks(sources) {
  if (!sources || !sources.length) return '';
  return `<span class="srcs">— ${sources.map(s => `<a href="${esc(safeUrl(s.url))}" rel="noopener" target="_blank">${esc(s.outlet)}</a>`).join(' · ')}</span>`;
}

const CSS = `
/* OurGavel — colonial courtroom. Parchment by default, chambers-at-night in dark.
   Palette names are furniture, not hex: parchment, oak, brass, oxblood, bottle green,
   iron-gall ink. See STYLE.md — this palette is binding. */
:root{
  --bg:#f2ecdd;         /* parchment */
  --panel:#fbf7ec;      /* fresh paper */
  --panel2:#e9e0cb;     /* aged paper */
  --ink:#221a12;        /* iron-gall ink */
  --mut:#6a5a44;        /* faded ink */
  --line:#c8b795;       /* oak edge */
  --acc:#8a6410;        /* brass */
  --acc2:#28456e;       /* indigo — links */
  --green:#2c6444;      /* bottle green */
  --red:#8d2b25;        /* oxblood */
  --amber:#96681a;      /* tallow */
  --violet:#4f3f7a;     /* magistrate purple */
  --serif:'Iowan Old Style','Palatino Linotype',Palatino,Georgia,'Times New Roman',serif;
  --sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
  --rule:2px;
}
@media (prefers-color-scheme: dark){:root{
  --bg:#15110d;         /* chambers at night */
  --panel:#1e1811;
  --panel2:#2a2118;
  --ink:#f0e6d2;        /* candlelit parchment */
  --mut:#a4917a;
  --line:#3f3223;
  --acc:#c9a227;        /* polished brass */
  --acc2:#9dbadf;
  --green:#68a982;
  --red:#cf7a6c;
  --amber:#d9a544;
  --violet:#a993d8;
}}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:var(--serif);line-height:1.62;font-size:17px}
body{background-image:repeating-linear-gradient(0deg,transparent,transparent 27px,rgba(120,95,55,.045) 27px,rgba(120,95,55,.045) 28px)}
a{color:var(--acc2);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px}
header.mast{border-bottom:3px double var(--line);padding:18px 0 12px;background:var(--panel)}
.mast .wrap{display:flex;align-items:baseline;gap:18px;flex-wrap:wrap}
.logo{font-family:var(--serif);font-size:30px;font-weight:700;letter-spacing:.3px;color:var(--ink);display:flex;align-items:center;gap:9px}
.logo a{color:inherit}.logo .gb{color:var(--acc)}
.tag{color:var(--mut);font-size:13px;font-style:italic}
nav.crumbs{font-size:13px;color:var(--mut);margin:14px 0 4px}
nav.sitenav{display:flex;gap:4px;flex-wrap:wrap;margin-left:auto}
nav.sitenav a{font-family:var(--sans);font-size:12px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;color:var(--mut);padding:6px 11px;border-radius:2px}
nav.sitenav a.on,nav.sitenav a:hover{color:var(--ink);background:var(--panel2);text-decoration:none}
main{padding:24px 0 60px}
h1{font-family:var(--serif);font-size:34px;line-height:1.16;margin:10px 0 6px;letter-spacing:-.2px}
h2{font-family:var(--serif);font-size:23px;margin:36px 0 12px;padding-bottom:7px;border-bottom:3px double var(--line)}
h3{font-family:var(--serif);font-size:17px;margin:18px 0 6px}
.sub{color:var(--mut);font-size:15px;margin-bottom:18px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:3px;padding:20px 22px;margin:16px 0;box-shadow:inset 0 0 0 1px rgba(255,255,255,.35),0 1px 0 rgba(90,70,40,.10)}
@media (prefers-color-scheme: dark){.card{box-shadow:inset 0 0 0 1px rgba(255,240,210,.045),0 1px 0 rgba(0,0,0,.3)}}
.badge{display:inline-block;font-family:var(--sans);font-size:10.5px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;padding:3px 9px;border-radius:2px;vertical-align:middle}
.badge.live{background:var(--red);color:#fff;animation:pulse 2.2s infinite}
.badge.phase{background:var(--panel2);color:var(--amber);border:1px solid var(--amber)}
.badge.archived{background:var(--panel2);color:var(--mut);border:1px solid var(--line)}
.badge.soon{background:var(--panel2);color:var(--amber);border:1px solid var(--amber)}
.badge.verified{color:var(--green);border:1px solid var(--green);background:transparent}
.badge.unverified{color:var(--amber);border:1px solid var(--amber);background:transparent}
.badge.disproven{color:var(--red);border:1px solid var(--red);background:transparent}
.badge.open{color:var(--violet);border:1px solid var(--violet);background:transparent}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.55}}
.ticker{border-left:3px solid var(--acc);padding-left:0;list-style:none}
.ticker li{padding:10px 0 10px 16px;border-bottom:1px solid var(--line)}
.ticker li:last-child{border-bottom:none}
.ticker .t{color:var(--mut);font-size:12px;white-space:nowrap}
.ticker .o{color:var(--acc);font-family:var(--sans);font-weight:700;font-size:11.5px;letter-spacing:1px;text-transform:uppercase}
.srcs{color:var(--mut);font-size:12.5px}
.srcs a{color:var(--mut);text-decoration:underline dotted}
.day{margin:0 0 10px;border-left:3px solid var(--line);padding:2px 0 14px 18px;position:relative}
.day::before{content:'';position:absolute;left:-7px;top:8px;width:11px;height:11px;border-radius:50%;background:var(--bg);border:2px solid var(--acc)}
.day .dh{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.day .dn{font-family:var(--serif);font-weight:700;font-size:17px}
.day .dd{color:var(--mut);font-size:13px}
.wit{margin:8px 0 0;padding-left:0;list-style:none}
.wit li{padding:8px 11px;margin:6px 0;background:var(--panel2);border-radius:2px;font-size:14.5px;border-left:2px solid var(--line)}
.wit .wn{font-weight:700}.wit .wr{color:var(--mut);font-size:12.5px}
table.witx{width:100%;border-collapse:collapse;font-size:14px}
table.witx th,table.witx td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
table.witx th{color:var(--mut);font-family:var(--sans);font-size:11px;text-transform:uppercase;letter-spacing:1.2px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:760px){.grid2{grid-template-columns:1fr}}
.vopt{border:1px solid var(--line);border-radius:3px;padding:13px 15px;background:var(--panel);box-shadow:inset 0 0 0 1px rgba(255,255,255,.3)}
.vopt b{font-family:var(--serif)}
footer{border-top:3px double var(--line);padding:22px 0 40px;color:var(--mut);font-size:13px;background:var(--panel)}
footer .hb{color:var(--green)}
.disc{font-size:12.5px;color:var(--mut);border-top:1px dashed var(--line);margin-top:16px;padding-top:10px}
.btn{display:inline-block;font-family:var(--sans);background:var(--acc);color:#fbf7ec;font-weight:700;letter-spacing:.4px;padding:10px 18px;border-radius:2px;font-size:14px;border:1px solid rgba(0,0,0,.18);box-shadow:inset 0 1px 0 rgba(255,255,255,.22)}
.btn:hover{text-decoration:none;filter:brightness(1.08)}
.btn.ghost{background:transparent;color:var(--acc);border:1px solid var(--acc);box-shadow:none}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:var(--mut);margin:10px 0}
.legend span::before{content:'';display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.lg-q::before{background:var(--violet)}.lg-f::before{background:var(--acc2)}.lg-c::before{background:var(--amber)}
#boardwrap{position:relative;border:1px solid var(--line);border-radius:3px;overflow:hidden;height:clamp(420px,68vh,700px);cursor:grab;touch-action:none;background-color:var(--panel);background-image:repeating-linear-gradient(0deg,transparent,transparent 25px,rgba(120,95,55,.07) 25px,rgba(120,95,55,.07) 26px),repeating-linear-gradient(90deg,transparent,transparent 25px,rgba(120,95,55,.05) 25px,rgba(120,95,55,.05) 26px);box-shadow:inset 0 0 0 1px rgba(255,255,255,.3),inset 0 0 44px rgba(120,95,55,.09)}
.node rect{transition:filter .18s ease,stroke-width .18s ease}
.node.sel rect{filter:brightness(1.3) drop-shadow(0 0 10px rgba(201,162,39,.55))}
.node.hi rect{filter:brightness(1.12)}
.node.dim{opacity:.28}
.node{transition:opacity .25s ease}
path.edge{transition:opacity .25s ease,stroke-width .2s ease}
path.edge.dim{opacity:.12}
path.edge.hi{opacity:1;stroke-width:3.4}
.bctrl button{width:42px;height:42px;font-size:19px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.25)}
.bctrl button:active{transform:scale(.94)}
#btoast{display:block;opacity:0;pointer-events:none;transform:translateX(-50%) translateY(8px);transition:opacity .22s ease,transform .22s ease}
#btoast.on{opacity:1;pointer-events:auto;transform:translateX(-50%) translateY(0)}

#boardwrap:active{cursor:grabbing}
#boardwrap.connecting .node{cursor:crosshair}
.node{cursor:move}
#btoast{display:none;position:absolute;left:50%;transform:translateX(-50%);bottom:14px;background:var(--panel);border:1px solid var(--acc);border-left:4px solid var(--acc);border-radius:2px;padding:10px 16px 10px 12px;font-size:13.5px;z-index:6;box-shadow:0 6px 24px rgba(60,45,25,.3);max-width:90%;display:flex;gap:9px;align-items:flex-start;text-align:left}
.linkbtn{border:1px solid var(--acc);background:transparent;color:var(--acc);border-radius:2px;padding:7px 13px;font-size:12px;cursor:pointer;font-weight:700;font-family:var(--sans);letter-spacing:.8px;text-transform:uppercase}
.linkbtn:hover{background:var(--acc);color:#fbf7ec}
@media (prefers-reduced-motion: reduce){.badge.live{animation:none}}
#detail{position:absolute;right:12px;top:12px;width:342px;max-height:calc(100% - 24px);overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:3px;padding:16px 18px;font-size:14.5px;box-shadow:0 10px 34px rgba(60,45,25,.28),inset 0 0 0 1px rgba(255,255,255,.4)}
#detail h4{font-family:var(--serif);margin:6px 0}
#detail .x{float:right;cursor:pointer;color:var(--mut);font-size:18px;line-height:1}
.node{cursor:pointer}
.node rect{transition:filter .15s}
.node:hover rect{filter:brightness(1.25)}
.edge-supports{stroke:var(--green)}.edge-contradicts{stroke:var(--red)}.edge-contested{stroke:var(--amber);stroke-dasharray:6 4}.edge-explains{stroke:var(--mut);stroke-dasharray:2 4}.edge-disproves{stroke:var(--red);stroke-width:3}
.notice{background:var(--panel2);border:1px solid var(--line);border-left:4px solid var(--acc);border-radius:2px;padding:13px 17px;font-size:14.5px;margin:16px 0}
.qa{margin:12px 0}.qa dt{font-weight:700;font-family:var(--serif);margin-top:14px}.qa dd{margin:4px 0 0;color:var(--ink)}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:18px 0}
@media(max-width:760px){.steps{grid-template-columns:1fr}}
.step{background:var(--panel);border:1px solid var(--line);border-radius:3px;padding:17px 19px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)}
.step .n{font-family:var(--serif);font-size:26px;color:var(--acc);font-weight:700}
.step h3{margin:6px 0 4px}.step p{font-size:14px;color:var(--mut)}
.bctrl{position:absolute;left:12px;top:12px;display:flex;flex-direction:column;gap:6px;z-index:5}
.bctrl button{width:34px;height:34px;border-radius:2px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font-size:17px;cursor:pointer}
.bctrl button:hover{border-color:var(--acc)}
.vtoggle{display:inline-flex;border:1px solid var(--line);border-radius:2px;overflow:hidden;margin:0 0 10px}
.vtoggle button{border:0;background:var(--panel);color:var(--mut);padding:9px 18px;font-size:12.5px;cursor:pointer;font-weight:700;font-family:var(--sans);letter-spacing:1px;text-transform:uppercase}
.vtoggle button.on{background:var(--acc);color:#fbf7ec}
#boardlist{display:none}
#boardlist .card{margin:10px 0}
#boardlist h3{margin-top:22px}
.conns{margin-top:8px;padding-top:8px;border-top:1px dashed var(--line);font-size:12.5px;color:var(--mut)}
.conns b.sup{color:var(--green)}.conns b.con{color:var(--red)}.conns b.mix{color:var(--amber)}
details.howto{background:var(--panel2);border:1px solid var(--line);border-radius:2px;padding:11px 17px;font-size:14.5px;margin:14px 0}
details.howto summary{cursor:pointer;font-weight:700;color:var(--acc);font-family:var(--sans);font-size:13px;letter-spacing:.7px;text-transform:uppercase}
details.howto p{margin:8px 0}
details.fold{border-top:1px solid var(--line);padding:10px 0 4px;font-size:14.5px}
details.fold summary{cursor:pointer;font-family:var(--serif);font-weight:700;font-size:17px;padding:4px 0;list-style-position:outside}
details.fold summary:hover{color:var(--acc)}
nav.casenav{display:flex;gap:8px;margin:14px 0 6px;flex-wrap:wrap}
nav.casenav a{font-family:var(--sans);font-size:13px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:9px 17px;border-radius:2px 2px 0 0;border:1px solid var(--line);border-bottom:2px solid var(--line);color:var(--mut);background:var(--panel)}
nav.casenav a.on{background:var(--acc);color:#fbf7ec;border-color:var(--acc);border-bottom-color:var(--acc)}
nav.casenav a:hover{text-decoration:none;border-color:var(--acc);color:var(--ink)}
nav.casenav a.on:hover{color:#14161a}
.factline{font-size:13.5px;color:var(--mut);line-height:1.9}
.factline b{color:var(--ink);font-weight:600}
.btn.sm{padding:6px 12px;font-size:13px}
.howstrip{display:flex;gap:10px;flex-wrap:wrap;align-items:center;color:var(--mut);font-size:13.5px;margin:16px 0 6px}
.howstrip b{color:var(--ink)}
.howstrip .sep{color:var(--acc)}
.wit-details summary{cursor:pointer;font-size:13px;color:var(--acc2);padding:4px 0}
.boardbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:12px 0 8px}
.boardbar .vtoggle{margin:0}
.boardbar .legend{margin:0}
@media(max-width:760px){
  header.mast{padding:10px 0 8px}
  .mast .wrap{gap:10px}
  .logo{font-size:22px}
  .tag{display:none}
  nav.sitenav{margin-left:auto;gap:2px}
  nav.sitenav a{padding:6px 10px;font-size:13px}
  nav.crumbs{margin:8px 0 2px;font-size:12px}
  main{padding:12px 0 40px}
  h1{font-size:24px;margin:6px 0 4px}
  h2{font-size:19px;margin:24px 0 10px}
  .sub{font-size:14px;margin-bottom:12px}
  .wrap{padding:0 14px}
  nav.casenav{gap:6px;margin:10px 0 4px}
  nav.casenav a{padding:8px 14px;font-size:13px}
  .card{padding:14px 16px}
  .steps{gap:10px}
  .boardbar{gap:8px;margin:8px 0 6px}
  .legend{font-size:11.5px;gap:8px}
}
.pip{display:inline-block;vertical-align:-.22em;flex:0 0 auto}
.pipwrap{flex:0 0 auto;line-height:0;margin-top:1px}
.logo a{text-decoration:none}
.logo a:hover{text-decoration:none}
.logo a:hover .pip{transform:rotate(-6deg)}
.pip{transition:transform .2s ease}
@media (prefers-reduced-motion: reduce){.pip{transition:none}}
.feedhead{display:flex;align-items:center;gap:8px;font-family:var(--sans);font-size:11.5px;letter-spacing:.9px;text-transform:uppercase;color:var(--mut);margin:0 0 8px}
.pulsedot{width:8px;height:8px;border-radius:50%;background:var(--red);box-shadow:0 0 0 0 rgba(141,43,37,.6);animation:livepulse 2.4s infinite}
@keyframes livepulse{0%{box-shadow:0 0 0 0 rgba(141,43,37,.55)}70%{box-shadow:0 0 0 7px rgba(141,43,37,0)}100%{box-shadow:0 0 0 0 rgba(141,43,37,0)}}
.ticker li.fresh{animation:slidein .5s ease}
@keyframes slidein{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
.newflag{font-family:var(--sans);font-size:9.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--panel);background:var(--red);padding:2px 6px;border-radius:2px;vertical-align:1px}
@media (prefers-reduced-motion: reduce){.pulsedot{animation:none}.ticker li.fresh{animation:none}}
.watchgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:12px}
@media(max-width:760px){.watchgrid{grid-template-columns:1fr;gap:12px}}
.wh{font-family:var(--sans);font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:var(--mut);margin:0 0 6px}
.linklist{list-style:none;margin:0;padding:0}
.linklist li{padding:6px 0;border-bottom:1px solid var(--line);font-size:14px}
.linklist li:last-child{border-bottom:none}
.lnote{color:var(--mut);font-size:12.5px}
.afflabel{font-family:var(--sans);font-size:9px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;color:var(--mut);border:1px solid var(--line);border-radius:2px;padding:1px 5px;vertical-align:1px}
/* --- board interaction + mobile sheet: last in the cascade so these win --- */
#detail{transform:translateY(6px) scale(.99);opacity:0;pointer-events:none;transition:opacity .2s ease,transform .2s ease;display:block}
#detail.open{opacity:1;pointer-events:auto;transform:none}
#detail .grab{display:none}
@media(max-width:760px){
  #boardwrap{height:clamp(360px,58vh,520px);border-radius:8px}
  #detail{left:0;right:0;bottom:0;top:auto;width:auto;max-height:72%;border-radius:14px 14px 0 0;border-left:0;border-right:0;border-bottom:0;padding:8px 16px 18px;transform:translateY(100%);box-shadow:0 -10px 34px rgba(0,0,0,.5)}
  #detail.open{transform:translateY(0)}
  #detail .grab{display:block;width:42px;height:4px;border-radius:2px;background:var(--line);margin:2px auto 10px}
  #detail .x{font-size:26px;padding:0 4px;margin-top:-4px}
  #detail h4{font-size:17px}
  .bctrl{left:10px;top:10px}
  .bctrl button{width:44px;height:44px}
  .vtoggle button{padding:10px 20px;font-size:14px}
  .legend{font-size:12px;gap:10px}
  .legend span[style]{margin-left:0 !important;width:100%}
}
@media (prefers-reduced-motion: reduce){.node,path.edge,#detail,#btoast{transition:none !important}}
`;

let NAV_ITEMS = [['/', 'Home'], ['/cases/', 'Cases'], ['/about/', 'About']];
// ---- Content-Security-Policy ------------------------------------------------
// Every page ships exactly one inline <style> and at most one inline <script>,
// both authored here. We hash them and allow ONLY those hashes: markup injected
// through community content can never execute, even if escaping were bypassed.
// (frame-ancestors is not honoured in a meta CSP; framing is intentional for
// /board/embed/ and is covered in SECURITY.md.)
const crypto = require('crypto');
const sha = src => "'sha256-" + crypto.createHash('sha256').update(src, 'utf8').digest('base64') + "'";
function harden(html) {
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => sha(m[1]));
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => sha(m[1]));
  const csp = [
    "default-src 'none'",
    // Elements are hash-locked; attributes are governed separately below.
    "script-src " + (scripts.join(' ') || "'none'"),
    "script-src-elem " + (scripts.join(' ') || "'none'"),
    "script-src-attr 'none'",                 // no inline event handlers, ever
    "style-src " + (styles.join(' ') || "'none'"),
    "style-src-elem " + (styles.join(' ') || "'none'"),
    "style-src-attr 'unsafe-inline'",         // style="" attrs cannot execute script
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "manifest-src 'none'",
    "upgrade-insecure-requests",
  ].join('; ');
  return html.replace('<meta charset="utf-8">',
    '<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="' + csp + '">\n<meta name="referrer" content="strict-origin-when-cross-origin">');
}

// The wire, kept warm. Static hosting cannot push, so the page pulls: it re-reads its
// own feed every 30s and slides in anything new without a reload, and it re-renders
// timestamps as relative ("4 min ago") every 20s so the page never looks frozen.
const LIVE_SCRIPT = `(function(){
var ul=document.getElementById('ticker');if(!ul)return;
var feed=ul.getAttribute('data-feed'),withCase=ul.getAttribute('data-case')==='1';
var status=document.getElementById('feedstatus');
var lastOk=Date.now();
function rel(iso){
  var t=new Date(iso).getTime();if(!t)return '';
  var s=Math.max(0,(Date.now()-t)/1000);
  if(s<60)return 'just now';
  if(s<3600)return Math.floor(s/60)+' min ago';
  if(s<86400){var h=Math.floor(s/3600);return h+(h===1?' hour ago':' hours ago')}
  var d=Math.floor(s/86400);return d+(d===1?' day ago':' days ago');
}
function paintTimes(){
  ul.querySelectorAll('.t[data-ts]').forEach(function(el){var r=rel(el.getAttribute('data-ts'));if(r)el.textContent=r});
}
function esc(x){return String(x==null?'':x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function key(u){var h=0,s=String(u);for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return (h>>>0).toString(36)}
function safe(u){return /^https?:\\/\\//i.test(String(u||''))?String(u):'#'}
function row(i){
  var li=document.createElement('li');
  li.setAttribute('data-k',key(i.url));li.className='fresh';
  li.innerHTML='<span class="t" data-ts="'+esc(i.ts)+'">'+esc(rel(i.ts))+'</span> \\u00b7 <span class="o">'+esc(i.outlet)+'</span>'
    +(withCase&&i.case?' \\u00b7 <span class="t">'+esc(i.case)+'</span>':'')
    +'<br><a href="'+esc(safe(i.url))+'" rel="noopener" target="_blank">'+esc(i.headline)+'</a>'
    +(i.flag==='verdict-watch'?' <span class="badge disproven">verdict watch</span>':'')
    +' <span class="newflag">new</span>';
  return li;
}
// Only surface reports NEWER than the newest one already on screen. Backfilling the
// rest of the feed and calling it "new" would be a lie the first time anyone loads.
var newest=0;
ul.querySelectorAll('.t[data-ts]').forEach(function(el){var t=new Date(el.getAttribute('data-ts')).getTime();if(t>newest)newest=t});
function tick(){
  fetch(feed,{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){
    lastOk=Date.now();
    var have={};ul.querySelectorAll('li[data-k]').forEach(function(li){have[li.getAttribute('data-k')]=1});
    var added=0,top=newest;
    (d.items||[]).slice().reverse().forEach(function(i){
      var k=key(i.url),t=new Date(i.ts).getTime();
      if(have[k]||!(t>newest))return;
      ul.insertBefore(row(i),ul.firstChild);have[k]=1;added++;
      if(t>top)top=t;
    });
    newest=top;
    while(ul.children.length>14)ul.removeChild(ul.lastChild);
    paintTimes();
    if(status){
      status.textContent = added
        ? added+(added===1?' new report just landed':' new reports just landed')
        : 'Up to date \\u00b7 last checked just now';
    }
  }).catch(function(){
    if(status)status.textContent='Reconnecting\\u2026';
  });
}
paintTimes();
setInterval(paintTimes,20000);
setInterval(tick,30000);
setTimeout(tick,2500);
document.addEventListener('visibilitychange',function(){if(!document.hidden)tick()});
})();`;

function page({ title, desc, crumbs, body, active }) {
  const nav = NAV_ITEMS.map(([href, label]) => `<a href="${href}" class="${active === href ? 'on' : ''}">${label}</a>`).join('');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — ${SITE_NAME}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:url" content="${SITE}">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(pip(64, { alt: 'OurGavel' }).replace(/ class="pip"/, '').replace(/ role="img"[^>]*?focusable="false"/, ''))}">
<style>${CSS}</style>
</head><body>
<header class="mast"><div class="wrap">
  <div class="logo"><a href="/" style="display:flex;align-items:center;gap:10px">${pip(38)}<span>Our<span class="gb">Gavel</span></span></a></div>
  <div class="tag">${TAGLINE}</div>
  <nav class="sitenav">${nav}</nav>
</div></header>
<main><div class="wrap">
${crumbs ? `<nav class="crumbs">${crumbs}</nav>` : ''}
${body}
</div></main>
${body.includes('id="ticker"') ? `<script>${LIVE_SCRIPT}</script>` : ''}
<footer><div class="wrap">
  <p class="disc" style="border:none;margin:0;padding:0">Every defendant is presumed innocent unless and until proven guilty. Community theories are labeled, not facts. Quoted material belongs to the cited outlets; nothing here is legal advice. <a href="/about/">Full policies & corrections</a> · <span class="hb">◉ ${esc(BUILT_AT.slice(0, 16).replace('T', ' '))} UTC</span></p>
</div></footer>
</body></html>`;
}

// ---------- load all cases ----------
const caseSlugs = fs.readdirSync(path.join(DATA, 'cases')).filter(d => fs.existsSync(path.join(DATA, 'cases', d, 'case.json')));
const CASES = caseSlugs.map(slug => {
  const dir = path.join(DATA, 'cases', slug);
  const load = (f, fb) => fs.existsSync(path.join(dir, f)) ? read(path.join(dir, f)) : fb;
  return {
    slug,
    case: read(path.join(dir, 'case.json')),
    days: load('days.json', { pretrial: [], days: [] }),
    board: load('board.json', { note: '', nodes: [], edges: [] }),
    community: load('community.json', { nodes: [], edges: [] }),
    ticker: load('ticker.json', { items: [] }),
    threads: load('threads.json', { threads: {} }),
  };
});
const TODAY = BUILT_AT.slice(0, 10);
// Docket order: cases in court now (longest-running first, i.e. nearest a verdict),
// then cases about to start, then everything further out. Archived always last.
function docketRank(c) {
  if (c.case.status === 'archived') return [3, ''];
  const ts = c.case.trialStart || '9999-12-31';
  return ts <= TODAY ? [0, ts] : [1, ts];
}
function byDocket(a, b) {
  const ra = docketRank(a), rb = docketRank(b);
  return ra[0] - rb[0] || ra[1].localeCompare(rb[1]);
}
CASES.sort(byDocket);
const ACTIVE = CASES.filter(c => c.case.status !== 'archived');
// Honest status chip: only say "now in court" when a trial is actually running.
function statusChip(c) {
  const cc = c.case, ts = cc.trialStart || '';
  if (cc.status === 'archived') return '<span class="badge archived">Concluded</span>';
  if (ts && ts <= TODAY) return '<span class="badge live">Now in court</span>';
  if (ts) {
    const days = Math.round((new Date(ts) - new Date(TODAY)) / 86400000);
    if (days <= 30) return `<span class="badge soon">Trial starts ${fmtDate(ts)}</span>`;
    return `<span class="badge archived">Pretrial · trial ${fmtDate(ts)}</span>`;
  }
  return '<span class="badge archived">Pretrial</span>';
}
const shortPhase = p => { const t = String(p || ''); return t.length > 58 ? t.slice(0, 55).replace(/[\s,—-]+$/, '') + '…' : t; };
// Simple menus: with one active case, the nav goes straight to it.
if (ACTIVE.length === 1) {
  NAV_ITEMS = [['/', 'Home'], [`/cases/${ACTIVE[0].slug}/`, 'The Trial'], [`/cases/${ACTIVE[0].slug}/board/`, 'The Board'], ['/creators/', 'Creators'], ['/about/', 'About']];
} else if (ACTIVE.length > 1) {
  NAV_ITEMS = [['/', 'Home'], ['/cases/', 'Cases'], ['/creators/', 'Creators'], ['/about/', 'About']];
}
const caseNav = (c, on) => `<nav class="casenav">
<a href="/cases/${c.slug}/" class="${on === 'overview' ? 'on' : ''}">Overview</a>
<a href="/cases/${c.slug}/timeline/" class="${on === 'record' ? 'on' : ''}">The Record</a>
<a href="/cases/${c.slug}/board/" class="${on === 'board' ? 'on' : ''}">The Board</a>
</nav>`;

// ---------- shared bits ----------
const itemKey = u => { let h = 0; const s2 = String(u); for (let i = 0; i < s2.length; i++) h = (h * 31 + s2.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
function tickerRow(i, withCase) {
  return `<li data-k="${itemKey(i.url)}"><span class="t" data-ts="${esc(i.ts)}">${esc(fmtTs(i.ts))}</span> · <span class="o">${esc(i.outlet)}</span>${withCase && i._case ? ` · <span class="t">${esc(i._case)}</span>` : ''}<br><a href="${esc(safeUrl(i.url))}" rel="noopener" target="_blank">${esc(i.headline)}</a>${i.flag === 'verdict-watch' ? ' <span class="badge disproven">verdict watch</span>' : ''}</li>`;
}
function tickerHtml(items, n = 8, withCase = false, feed = '/live.json') {
  const rows = items.slice(0, n).map(i => tickerRow(i, withCase)).join('\n');
  return `<div class="feedhead"><span class="pulsedot" aria-hidden="true"></span><span id="feedstatus">Checking for updates every 30 seconds</span></div>
<ul class="ticker" id="ticker" data-feed="${esc(feed)}" data-case="${withCase ? '1' : '0'}">${rows}</ul>`;
}
const caseUrl = (c, sub = '') => `/cases/${c.slug}/${sub}`;

function caseCard(c, featured = false) {
  const cc = c.case;
  return `<div class="card">
  ${statusChip(c)} <span class="badge phase">${esc(shortPhase(cc.phase))}</span>
  <h2 style="border:none;margin:10px 0 4px"><a href="${caseUrl(c)}">${esc(cc.shortTitle)}</a></h2>
  <p style="max-width:640px">${esc(cc.plainSummary || cc.charges + '. ' + cc.court + '.')}</p>
  <p style="margin-top:12px">
    <a class="btn" href="${caseUrl(c)}">Catch up</a>
    <a class="btn ghost" href="${caseUrl(c, 'board/')}">Open the Board</a>
  </p>
</div>`;
}

// ---------- home ----------
const allItems = ACTIVE.flatMap(c => (c.ticker.items || []).map(i => ({ ...i, _case: c.case.shortTitle }))).sort((a, b) => b.ts.localeCompare(a.ts));
const home = page({
  title: "The facts of the trial, in everyone's hands",
  desc: 'OurGavel follows the court cases everyone is watching and keeps the facts straight — every line linked to its source — with a community board for sharing and testing theories together.',
  active: '/',
  body: `
<h1>Read the trial,<br>not the takes.</h1>
<p class="sub" style="font-size:16.5px;max-width:600px">We keep the record of the cases people are arguing about. Who testified, what they said, what the jury has to decide. Every line says where it came from. Then you get a board to work out what it means.</p>
${ACTIVE.slice(0, 3).map(c => caseCard(c, true)).join('\n')}
${CASES.length > 3 ? `<p><a href="/cases/">All cases →</a></p>` : ''}
<div class="howstrip"><span><b>Three things here:</b></span><span>the record</span><span class="sep">·</span><span>the board</span><span class="sep">·</span><span>the people arguing about both</span></div>
<h2>Off the wire</h2>
${tickerHtml(allItems, 6, ACTIVE.length > 1, '/live.json')}
`});

// ---------- cases index ----------
const casesIndex = page({
  title: 'Cases',
  desc: 'Every case OurGavel is following — active trials first.',
  active: '/cases/',
  crumbs: `<a href="/">Home</a> › Cases`,
  body: `
<h1>Cases</h1>
<p class="sub">Active trials first. Concluded cases stay up — the record doesn't expire.</p>
${[...ACTIVE, ...CASES.filter(c => c.case.status === 'archived')].map(c => caseCard(c)).join('\n')}
`});

// ---------- per-case pages ----------
// Links out, in three groups readers actually ask for: where to watch, where the official
// record lives, and who is covering it minute to minute. Any link may carry affiliate:true
// and it renders a visible label — an unlabelled paid link is not something we ship.
function linkRow(l) {
  return `<li><a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(l.outlet)}</a>${l.affiliate ? ' <span class="afflabel">affiliate</span>' : ''}${l.note ? `<br><span class="lnote">${esc(l.note)}</span>` : ''}</li>`;
}
function watchBlock(c) {
  const cc = c.case;
  const stream = (cc.livestream && cc.livestream.sources) || [];
  const records = cc.courtRecords || [];
  const covering = (cc.watchPages || []).slice(0, 5);
  if (!stream.length && !records.length && !covering.length) return '';
  return `<details class="fold" open><summary>Watch it yourself</summary>
<div class="watchgrid">
  ${stream.length ? `<div><h4 class="wh">Live video</h4><ul class="linklist">${stream.map(linkRow).join('')}</ul></div>` : ''}
  ${records.length ? `<div><h4 class="wh">The official record</h4><ul class="linklist">${records.map(linkRow).join('')}</ul></div>` : ''}
  ${covering.length ? `<div><h4 class="wh">Who's covering it</h4><ul class="linklist">${covering.map(linkRow).join('')}</ul></div>` : ''}
</div>
<p class="lnote" style="margin-top:10px">We link out because you should be able to check us. Court schedules move without notice; a dead stream usually means the court recessed.</p>
</details>`;
}

function hubPage(c) {
  const cc = c.case;
  return page({
    title: cc.shortTitle,
    desc: `Follow ${cc.title}: what's happening now, the day-by-day record, the evidence board, and how the case can end.`,
    active: `/cases/${c.slug}/`,
    crumbs: `<a href="/">Home</a> › ${esc(cc.shortTitle)}`,
    body: `
${statusChip(c)} <span class="badge phase">${esc(shortPhase(cc.phase))}</span>
<h1>${esc(cc.shortTitle)}</h1>
${caseNav(c, 'overview')}
<div class="card" style="margin-top:16px">
<p>${esc(cc.statusNow || cc.phase)} ${srcLinks(cc.statusNowSources)}</p>
${cc.livestream ? `<p style="margin-top:8px"><b>Watch live:</b> ${cc.livestream.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.outlet)}</a>`).join(' · ')}</p>` : ''}
<p class="factline" style="margin-top:10px"><b>${esc(cc.defendant)}</b> · ${esc(cc.charges)}<br>${esc(cc.plea)}<br>${esc(cc.court)} · ${esc(cc.judge)} · Prosecution: ${esc(cc.prosecution.join(', '))} · Defense: ${esc(cc.defense.join(', '))}</p>
</div>
${watchBlock(c)}
<details class="fold"><summary>How this can end</summary>
<div class="grid2" style="margin-top:10px">
${cc.verdictOptions.map(v => `<div class="vopt"><b>${esc(v.option)}</b><br><span style="font-size:14px">${esc(v.consequence)}</span><br>${srcLinks(v.sources)}</div>`).join('\n')}
</div>
<p class="sub" style="margin-top:10px"><a href="${caseUrl(c, 'standard/')}">The law behind the verdict, in plain English →</a></p>
</details>
<h2>Latest updates</h2>
${tickerHtml(c.ticker.items, 8, false, `/cases/${c.slug}/live.json`)}
`});
}

function dayBlock(c, d) {
  const ws = d.witnesses || [];
  const wits = ws.map(w => `<li><span class="wn">${esc(w.name)}</span> <span class="wr">— ${esc(w.role)}</span><br>${esc(w.gist)}</li>`).join('');
  return `<div class="day" id="day-${d.day}">
  <div class="dh"><span class="dn">Day ${d.day}</span><span class="dd">${fmtDate(d.date)}</span><span class="badge phase">${esc(d.phase)}</span></div>
  <h3 style="margin:6px 0 4px">${esc(d.headline)}</h3>
  <p style="font-size:14.5px">${esc(d.summary)} ${srcLinks(d.sources)}</p>
  ${wits ? `<details class="wit-details"><summary>Who testified — ${ws.length} witness${ws.length === 1 ? '' : 'es'}</summary><ul class="wit">${wits}</ul></details>` : ''}
</div>`;
}
function timelinePage(c) {
  return page({
    title: 'The Record — ' + c.case.shortTitle,
    desc: `Every trial day of ${c.case.title}: witnesses, testimony, rulings — each entry cited to its source.`,
    active: '/cases/',
    crumbs: `<a href="/">Home</a> › <a href="${caseUrl(c)}">${esc(c.case.shortTitle)}</a> › The Record`,
    body: `
<h1>The Record</h1>
${caseNav(c, 'record')}
${c.case.storySoFar ? `<div class="card" style="margin-top:16px"><h3 style="margin-top:0">The story so far</h3><p style="font-size:14.5px">${esc(c.case.storySoFar)} ${srcLinks(c.case.storySoFarSources)}</p></div>` : ''}
<p class="sub" style="margin:10px 0"><a href="${caseUrl(c, 'witnesses/')}">Looking for a specific witness? The full index →</a></p>
${c.days.pretrial.length ? `<details class="fold"><summary>Before trial (${c.days.pretrial.length} entries)</summary>
${c.days.pretrial.map(p => `<div class="day" style="margin-top:10px"><div class="dh"><span class="dd">${fmtDate(p.date)}</span></div><p style="font-size:14.5px">${esc(p.event)} ${srcLinks(p.sources)}</p></div>`).join('\n')}</details>` : ''}
<h2>The trial, day by day</h2>
<p class="sub" style="font-size:13px">${esc(c.days.note || '')}</p>
${[...c.days.days].reverse().map(d => dayBlock(c, d)).join('\n')}
`});
}

function witnessesPage(c) {
  const allWits = [];
  for (const d of c.days.days) for (const w of (d.witnesses || [])) allWits.push({ ...w, day: d.day });
  allWits.sort((a, b) => a.name.localeCompare(b.name));
  return page({
    title: 'Witness index — ' + c.case.shortTitle,
    desc: `Alphabetical index of witnesses in ${c.case.shortTitle}, with role, day called, and a one-line summary of testimony.`,
    active: '/cases/',
    crumbs: `<a href="/">Home</a> › <a href="${caseUrl(c)}">${esc(c.case.shortTitle)}</a> › Witnesses`,
    body: `
<h1>Witness index</h1>
${caseNav(c, 'record')}
<p class="sub" style="margin-top:12px">${allWits.length} witnesses indexed from the day-by-day record. Click a day for full context.</p>
<div class="card" style="overflow-x:auto"><table class="witx">
<tr><th>Witness</th><th>Role</th><th>Day</th><th>Testimony, in one line</th></tr>
${allWits.map(w => `<tr><td><b>${esc(w.name)}</b></td><td>${esc(w.role)}</td><td><a href="${caseUrl(c, 'timeline/')}#day-${w.day}">Day ${w.day}</a></td><td>${esc(w.gist)}</td></tr>`).join('\n')}
</table></div>
`});
}

function standardPage(c) {
  const std = c.case.legalStandard;
  if (!std) return null;
  return page({
    title: 'The law, in plain English — ' + c.case.shortTitle,
    desc: std.name + ' — what the jury must decide, who has to prove what, and what each verdict means.',
    active: '/cases/',
    crumbs: `<a href="/">Home</a> › <a href="${caseUrl(c)}">${esc(c.case.shortTitle)}</a> › The law`,
    body: `
<h1>${esc(std.name)}</h1>
${caseNav(c, 'overview')}
<p class="sub" style="margin-top:12px">Plain-English explainer, drawn only from the case law, the statute, and the model jury instruction. Not legal advice.</p>
<div class="card"><h3>The test</h3><p>${esc(std.test)}</p></div>
<div class="card"><h3>Who has to prove what</h3><p>${esc(std.burden)} Under <i>Commonwealth v. Lawson</i> (2016), the mere fact that most people are sane is not, by itself, enough to carry that burden once mental-illness evidence is in the case — the Commonwealth may rely on the circumstances of the offense and the defendant's words and conduct before, during, and after.</p></div>
<dl class="qa card">
<dt>Does "she knew what she was doing" end the inquiry?</dt>
<dd>No. The test has two independent prongs. Even a defendant who appreciated wrongfulness is not responsible if disease left her without substantial capacity to <i>conform her conduct</i> to the law. That is the prong defense expert Dr. Zeizel invoked.</dd>
<dt>If the jury acquits on lack of criminal responsibility, does she walk free?</dt>
<dd>No. Under M.G.L. c.123 §16, the court may order up to 40 days of hospitalization for evaluation, and the DA or facility may petition for commitment — six months initially, renewable in one-year periods. The model instruction notes a person who remains mentally ill and dangerous "may remain committed for the duration of his [or her] life."</dd>
<dt>What are the jury's options here?</dt>
<dd>First-degree murder (life without parole), second-degree murder (life with parole eligibility), not guilty by reason of lack of criminal responsibility, or no unanimous verdict (mistrial; retrial possible). Whether involuntary manslaughter joins the slip is still being argued.</dd>
</dl>
<p>${srcLinks(std.sources)}</p>
`});
}

// ---------- the board ----------
function boardPage(c, opts = {}) {
  const EMBED = !!opts.embed;
  const nodes = [...c.board.nodes, ...(c.community.nodes || [])];
  const edges = [...c.board.edges, ...(c.community.edges || [])];
  const threads = (c.threads && c.threads.threads) || {};
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const communityNodes = nodes.filter(n => n.type === 'rumor');
  const NW = 210, NH = 78;
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const minX = Math.min(...xs) - 60, minY = Math.min(...ys) - 60;
  const w = Math.max(...xs) + NW - minX + 60, h = Math.max(...ys) + NH - minY + 60;
  const colorFor = n => n.type === 'question' ? 'var(--violet)' : (n.type === 'rumor' ? 'var(--amber)' : n.status === 'disproven' ? 'var(--red)' : n.type === 'resolved' ? 'var(--green)' : 'var(--acc2)');
  const markFor = t => t === 'supports' ? 'ah-sup' : (t === 'contradicts' || t === 'disproves') ? 'ah-con' : t === 'contested' ? 'ah-mix' : 'ah-ctx';
  const edgeEls = edges.map((e, i) => {
    const a = byId[e.from], b = byId[e.to];
    if (!a || !b) return '';
    return `<path class="edge edge-${esc(e.type)}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" fill="none" stroke-width="2.25" opacity="0.8" marker-end="url(#${markFor(e.type)})"><title>${esc(e.type)}${e.label ? ': ' + esc(e.label) : ''}</title></path>`;
  }).join('\n');
  const nodeEls = nodes.map(n => {
    const ccol = colorFor(n);
    const label = n.title.length > 66 ? n.title.slice(0, 63) + '…' : n.title;
    const lines = [];
    let cur = '';
    for (const word of label.split(' ')) {
      if ((cur + ' ' + word).trim().length > 30) { lines.push(cur.trim()); cur = word; } else cur += ' ' + word;
    }
    if (cur.trim()) lines.push(cur.trim());
    const tspans = lines.slice(0, 3).map((l, i) => `<tspan x="12" dy="${i === 0 ? 0 : 15}">${esc(l)}</tspan>`).join('');
    const tcount = threads[n.id] ? threads[n.id].count : 0;
    const commentChip = tcount ? `<g><rect x="${NW - 46}" y="${NH - 20}" width="38" height="16" rx="8" fill="var(--panel)" stroke="${ccol}" stroke-width="1"></rect><text x="${NW - 27}" y="${NH - 8}" font-size="10" fill="var(--mut)" text-anchor="middle">💬 ${tcount}</text></g>` : '';
    return `<g class="node" data-id="${esc(n.id)}" transform="translate(${n.x},${n.y})" data-bx="${n.x}" data-by="${n.y}">
<rect width="${NW}" height="${NH}" rx="6" fill="var(--panel2)" stroke="${ccol}" stroke-width="${n.central ? 3.5 : 2}" filter="url(#cardshadow)"></rect>
<circle cx="${NW / 2}" cy="0" r="5.5" fill="${ccol}" stroke="var(--bg)" stroke-width="1.5"></circle>
<text x="12" y="26" font-size="12.5" fill="var(--ink)" font-weight="600">${tspans}</text>
${commentChip}
</g>`;
  }).join('\n');
  const defs = `<defs>
<filter id="cardshadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity="0.35"/></filter>
<marker id="ah-sup" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--green)"/></marker>
<marker id="ah-con" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--red)"/></marker>
<marker id="ah-mix" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--amber)"/></marker>
<marker id="ah-ctx" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--mut)"/></marker>
</defs>`;
  // The reader zone: labeled, and never empty — an invitation card sits there until theories arrive.
  const zoneX = 1160;
  const zoneLabel = `<text x="${zoneX}" y="46" font-size="13" fill="var(--amber)" font-weight="700" letter-spacing="3" opacity="0.85">READER THEORIES</text><text x="${zoneX}" y="64" font-size="11" fill="var(--mut)">yours goes up here</text>`;
  const ctaCard = communityNodes.length ? '' : `<a href="https://github.com/${REPO}/issues/new?template=theory.yml&case=${c.slug}"><g class="ctanode" style="cursor:pointer">
<rect x="${zoneX}" y="80" width="${NW}" height="${NH}" rx="6" fill="none" stroke="var(--amber)" stroke-width="2" stroke-dasharray="7 5"></rect>
<text x="${zoneX + NW / 2}" y="112" font-size="13" fill="var(--amber)" font-weight="700" text-anchor="middle">+ Your theory goes here</text>
<text x="${zoneX + NW / 2}" y="130" font-size="11" fill="var(--mut)" text-anchor="middle">be the first — tap to post</text>
<g transform="translate(${zoneX + NW / 2 - 22},${NH + 92}) scale(0.7)">${pip(64).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")}</g>
</g></a>`;
  const svg = `<svg id="boardsvg" viewBox="${minX} ${minY} ${w + (communityNodes.length ? 0 : 320)} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">${defs}<g id="viewport">${zoneLabel}${ctaCard}${edgeEls}\n${nodeEls}</g></svg>`;

  const verb = { supports: ['sup', 'supports'], contradicts: ['con', 'disputes'], disproves: ['con', 'disproves'], contested: ['mix', 'is contested on'], explains: ['ctx', 'gives context to'] };
  const connsFor = id => {
    const out = edges.filter(e => e.from === id).map(e => ({ dir: 'out', other: byId[e.to], e }));
    const inn = edges.filter(e => e.to === id).map(e => ({ dir: 'in', other: byId[e.from], e }));
    return [...out, ...inn].filter(x => x.other);
  };
  const connHtml = id => {
    const cs = connsFor(id);
    if (!cs.length) return '';
    return `<div class="conns">${cs.map(({ dir, other, e }) => {
      const [cls, word] = verb[e.type] || ['mix', e.type];
      return dir === 'out'
        ? `<b class="${cls}">${word}</b> → ${esc(other.title)}${e.label ? ` <i>(${esc(e.label)})</i>` : ''}`
        : `← ${esc(other.title)} <b class="${cls}">${word}</b> this${e.label ? ` <i>(${esc(e.label)})</i>` : ''}`;
    }).join('<br>')}</div>`;
  };

  const badgeFor = n => n.type === 'question' ? ['open', 'before the jury'] : n.status === 'disproven' ? ['disproven', 'disproven'] : n.type === 'rumor' ? ['unverified', 'reader theory'] : n.type === 'resolved' ? ['verified', 'settled'] : ['verified', 'from the record'];
  const listGroups = [
    ['Reader theories', communityNodes],
    ['The questions', nodes.filter(n => n.type === 'question')],
    ['The evidence and testimony', nodes.filter(n => ['fact', 'testimony', 'exhibit', 'resolved'].includes(n.type))],
  ];
  const listHtml = listGroups.filter(([, ns]) => ns.length).map(([title, ns]) => `<h3>${title}</h3>` + ns.map(n => {
    const [bcls, blabel] = badgeFor(n);
    return `<div class="card"><span class="badge ${bcls}">${blabel}</span><h4 style="font-family:var(--serif);margin:8px 0 4px">${esc(n.title)}</h4><p style="font-size:14px">${esc(n.body)}</p>${n.sources && n.sources.length ? `<p style="margin-top:6px">${srcLinks(n.sources)}</p>` : ''}${connHtml(n.id)}${n.traction ? `<p style="color:var(--mut);font-size:12.5px;margin-top:6px">Corroborated by ${n.traction.up} · disputed by ${n.traction.down}${n.issue ? ` · <a href="${esc(safeUrl(n.issue))}" target="_blank" rel="noopener">discussion</a>` : ''}</p>` : ''}</div>`;
  }).join('\n')).join('\n');

  // Every field here is injected via innerHTML on the client, so it is escaped HERE,
  // and the whole blob is embedded with jsonScript() so no value can break out of <script>.
  const detailData = jsonScript(Object.fromEntries(nodes.map(n => {
    const [bcls, blabel] = badgeFor(n);
    const th = threads[n.id] || null;
    const safeThread = th ? {
      url: esc(safeUrl(th.url)), count: Number(th.count) || 0,
      comments: (th.comments || []).map(cm => ({ user: esc(cm.user), ts: esc(String(cm.ts || '')), body: esc(cm.body) })),
    } : null;
    return [n.id, {
      title: esc(n.title), body: esc(n.body), bcls, blabel,
      sources: (n.sources || []).map(s => ({ outlet: esc(s.outlet), url: esc(safeUrl(s.url)) })),
      traction: n.traction ? { up: Number(n.traction.up) || 0, down: Number(n.traction.down) || 0 } : null,
      issue: n.issue ? esc(safeUrl(n.issue)) : null,
      conns: connHtml(n.id), thread: safeThread,
    }];
  })));
  const central = nodes.find(n => n.central) || nodes.find(n => n.type === 'question');
  const edgeData = jsonScript(edges.filter(e => byId[e.from] && byId[e.to]).map(e => ({ f: e.from, t: e.to })));
  const newThreadUrl = id => `https://github.com/${REPO}/issues/new?title=${encodeURIComponent('Discussion: ' + (byId[id] ? byId[id].title.slice(0, 60) : id))}&body=${encodeURIComponent(`<!--node:${id} case:${c.slug}-->\n\n`)}`;
  const connectUrl = `https://github.com/${REPO}/issues/new?template=connection.yml&case=${c.slug}`;

  const boardUrl = `${SITE}/cases/${c.slug}/board/`;
  const embedUrl = `${SITE}/cases/${c.slug}/board/embed/`;
  const embedCode = `<iframe src="${embedUrl}" width="100%" height="620" style="border:1px solid #ddd;border-radius:8px" loading="lazy" title="${esc(c.case.shortTitle)} evidence board - OurGavel"></iframe>`;

  // Client script, shared verbatim by the full board page and the embeddable one.
  const scriptBlock = `(function(){
var DATA=${detailData};
var EDGES=${edgeData};
var SLUG=${JSON.stringify(c.slug)},REPO=${JSON.stringify(REPO)},NW=${NW},NH=${NH};
var SERIAL=${JSON.stringify(BUILT_AT)};
var wrap=document.getElementById('boardwrap'),svg=document.getElementById('boardsvg'),vp=document.getElementById('viewport');
var toast=document.getElementById('btoast'),detail=document.getElementById('detail');
var REDUCED=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var isTouch=window.matchMedia&&window.matchMedia('(pointer: coarse)').matches;
function mobile(){return window.innerWidth<=760}

/* ---------- layout memory ---------- */
var offsets={};try{offsets=JSON.parse(localStorage.getItem('gb-layout-'+SLUG)||'{}')}catch(e){offsets={}}
function saveOffsets(){try{localStorage.setItem('gb-layout-'+SLUG,JSON.stringify(offsets))}catch(e){}}
var nodeEls={},edgeEls=[];
document.querySelectorAll('.node').forEach(function(g){nodeEls[g.getAttribute('data-id')]=g});
document.querySelectorAll('path.edge').forEach(function(p){edgeEls.push(p)});
function posOf(id){var g=nodeEls[id];if(!g)return null;var o=offsets[id]||{x:0,y:0};return{x:+g.getAttribute('data-bx')+o.x,y:+g.getAttribute('data-by')+o.y}}
function applyNode(id){var g=nodeEls[id],p=posOf(id);if(g&&p)g.setAttribute('transform','translate('+p.x+','+p.y+')')}
function drawEdges(){edgeEls.forEach(function(p){
  var a=posOf(p.getAttribute('data-from')),b=posOf(p.getAttribute('data-to'));if(!a||!b)return;
  var x1=a.x+NW/2,y1=a.y+NH/2,x2=b.x+NW/2,y2=b.y+NH/2;
  p.setAttribute('d','M'+x1+','+y1+' Q'+((x1+x2)/2)+','+((y1+y2)/2+28)+' '+x2+','+y2);
})}
Object.keys(nodeEls).forEach(applyNode);drawEdges();

/* ---------- entrance ---------- */
if(!REDUCED){
  var order=Object.keys(nodeEls);
  order.forEach(function(id,i){var g=nodeEls[id];g.style.opacity='0';g.style.transition='opacity .45s ease, filter .2s ease';
    setTimeout(function(){g.style.opacity='1'},60+i*38)});
  edgeEls.forEach(function(p,i){try{var L=p.getTotalLength();p.style.strokeDasharray=L;p.style.strokeDashoffset=L;
    p.style.transition='stroke-dashoffset .9s ease '+(0.25+i*0.05)+'s, opacity .3s ease';
    setTimeout(function(){p.style.strokeDashoffset='0'},40)}catch(e){}});
}

/* ---------- view transform ----------
   The <g> transform lives in SVG USER units, not CSS pixels. Everything below
   works in user units and converts pointer deltas through base(), the ratio the
   viewBox is rendered at. Mixing the two silently skews panning and centring. */
var tx=0,ty=0,scale=1;
function vb(){return svg.getAttribute('viewBox').split(' ').map(Number)}
function base(){var r=wrap.getBoundingClientRect(),b=vb();return Math.min(r.width/b[2],r.height/b[3])||1}
function toUser(cx,cy){
  var r=wrap.getBoundingClientRect(),b=vb(),k=base();
  var offX=(r.width-b[2]*k)/2, offY=(r.height-b[3]*k)/2;
  return {x:b[0]+(cx-r.left-offX)/k, y:b[1]+(cy-r.top-offY)/k};
}
function applyView(){vp.setAttribute('transform','translate('+tx+','+ty+') scale('+scale+')')}
function clampScale(s){return Math.min(4,Math.max(0.3,s))}
function zoomAt(f,cx,cy){
  var ns=clampScale(scale*f);if(ns===scale)return;
  var b=vb(),u;
  if(cx===undefined){u={x:b[0]+b[2]/2,y:b[1]+b[3]/2}} else {u=toUser(cx,cy)}
  tx=u.x-(u.x-tx)*(ns/scale); ty=u.y-(u.y-ty)*(ns/scale);
  scale=ns; applyView();
}
function centreOn(id,targetScale){
  var p=posOf(id);if(!p)return;
  var b=vb();
  scale=clampScale(targetScale);
  tx=(b[0]+b[2]/2)-(p.x+NW/2)*scale;
  ty=(b[1]+b[3]/2)-(p.y+NH/2)*scale;
  applyView();
}
document.getElementById('bz-in').onclick=function(){zoomAt(1.3)};
document.getElementById('bz-out').onclick=function(){zoomAt(1/1.3)};
document.getElementById('bz-fit').onclick=function(){
  tx=0;ty=0;scale=1;offsets={};saveOffsets();
  Object.keys(nodeEls).forEach(applyNode);drawEdges();applyView();clearFocus();
  say(${JSON.stringify(PIP.reset)});
};

/* ---------- pointer: pan, node drag ---------- */
var mode=null,sx=0,sy=0,startOff=null,dragId=null,movedFar=false;
function pointerDown(e,target,cx,cy){
  var g=target.closest?target.closest('.node'):null;movedFar=false;sx=cx;sy=cy;
  if(g){mode='node';dragId=g.getAttribute('data-id');var o=offsets[dragId]||{x:0,y:0};startOff={x:o.x,y:o.y}}
  else{mode='pan';startOff={x:tx,y:ty}}
}
function pointerMove(cx,cy){
  if(!mode)return;var dx=cx-sx,dy=cy-sy;
  if(Math.abs(dx)+Math.abs(dy)>5)movedFar=true;
  var k=base();
  if(mode==='pan'){tx=startOff.x+dx/k;ty=startOff.y+dy/k;applyView()}
  else{offsets[dragId]={x:startOff.x+dx/(k*scale),y:startOff.y+dy/(k*scale)};applyNode(dragId);drawEdges()}
}
function pointerUp(){if(mode==='node'&&movedFar)saveOffsets();mode=null;dragId=null}
wrap.addEventListener('mousedown',function(e){pointerDown(e,e.target,e.clientX,e.clientY)});
window.addEventListener('mousemove',function(e){pointerMove(e.clientX,e.clientY)});
window.addEventListener('mouseup',pointerUp);
wrap.addEventListener('wheel',function(e){e.preventDefault();zoomAt(e.deltaY<0?1.12:1/1.12,e.clientX,e.clientY)},{passive:false});

/* ---------- touch: 1-finger pan/drag, 2-finger pinch, double-tap zoom ---------- */
var pinch=null,lastTap=0;
wrap.addEventListener('touchstart',function(e){
  if(e.touches.length===2){
    pinch={d:Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY),
           cx:(e.touches[0].clientX+e.touches[1].clientX)/2,cy:(e.touches[0].clientY+e.touches[1].clientY)/2};
    mode=null;return;
  }
  if(e.touches.length===1){
    var now=Date.now();
    if(now-lastTap<300){zoomAt(1.6,e.touches[0].clientX,e.touches[0].clientY);lastTap=0;return}
    lastTap=now;
    pointerDown(e,e.target,e.touches[0].clientX,e.touches[0].clientY);
  }
},{passive:true});
wrap.addEventListener('touchmove',function(e){
  if(pinch&&e.touches.length===2){
    e.preventDefault();
    var d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
    if(pinch.d>0)zoomAt(d/pinch.d,pinch.cx,pinch.cy);
    pinch.d=d;return;
  }
  if(e.touches.length===1&&mode){e.preventDefault();pointerMove(e.touches[0].clientX,e.touches[0].clientY)}
},{passive:false});
wrap.addEventListener('touchend',function(e){if(e.touches.length===0){pinch=null;pointerUp()}});

/* ---------- focus: highlight a card's argument ---------- */
var focused=null;
function clearFocus(){
  focused=null;
  Object.keys(nodeEls).forEach(function(id){nodeEls[id].classList.remove('dim','hi','sel')});
  edgeEls.forEach(function(p){p.classList.remove('dim','hi')});
}
function focusNode(id){
  focused=id;
  var keep={};keep[id]=1;
  edgeEls.forEach(function(p){
    var f=p.getAttribute('data-from'),t=p.getAttribute('data-to');
    if(f===id||t===id){p.classList.add('hi');p.classList.remove('dim');keep[f]=1;keep[t]=1}
    else{p.classList.add('dim');p.classList.remove('hi')}
  });
  Object.keys(nodeEls).forEach(function(nid){
    var g=nodeEls[nid];g.classList.remove('dim','hi','sel');
    if(nid===id)g.classList.add('sel');
    else if(keep[nid])g.classList.add('hi');
    else g.classList.add('dim');
  });
}

/* ---------- detail panel / bottom sheet ---------- */
var connectFrom=null;
var PIPMARK=${JSON.stringify(pip(22))};
function say(html,sticky){toast.innerHTML='<span class="pipwrap">'+PIPMARK+'</span><span>'+html+'</span>';toast.classList.add('on');
  var rl=toast.querySelector('[data-reload]');if(rl)rl.onclick=function(e){e.preventDefault();location.reload()};
  clearTimeout(say._t);if(!sticky){say._t=setTimeout(function(){toast.classList.remove('on')},5500)}}
function hush(){toast.classList.remove('on')}
function esc2(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')}
function closeDetail(){detail.classList.remove('open');clearFocus()}
function threadHtml(id,n){
  var t=n.thread;var out='<div class="conns" style="border-top-style:solid"><b>Discussion</b>';
  if(t&&t.comments&&t.comments.length){
    out+=t.comments.map(function(cm){return '<p style="margin:6px 0"><b style="color:var(--acc)">'+esc2(cm.user)+'</b> <span style="font-size:11px">'+cm.ts.slice(0,10)+'</span><br>'+esc2(cm.body)+'</p>'}).join('');
    out+='<a href="'+t.url+'" target="_blank" rel="noopener">Reply — '+t.count+' comment'+(t.count===1?'':'s')+' &rarr;</a>';
  } else if(t){out+='<br><a href="'+t.url+'" target="_blank" rel="noopener">Be the first to comment &rarr;</a>';}
  else{
    var u='https://github.com/'+REPO+'/issues/new?title='+encodeURIComponent('Discussion: '+n.title.slice(0,60))+'&body='+encodeURIComponent('<!--node:'+id+' case:'+SLUG+'-->')+'%0A%0A';
    out+='<br><a href="'+u+'" target="_blank" rel="noopener">Start the discussion &rarr;</a>';
  }
  return out+'</div>';
}
function show(id){
  var n=DATA[id];if(!n)return;
  focusNode(id);
  var el=document.getElementById('detail-in');
  var srcs=(n.sources||[]).map(function(s){return '<a href="'+s.url+'" target="_blank" rel="noopener">'+s.outlet+'</a>'}).join(' &middot; ');
  var extra=n.traction?('<p style="color:var(--mut);font-size:12.5px;margin-top:6px">Corroborated by '+n.traction.up+' &middot; disputed by '+n.traction.down+'</p>'):'';
  el.innerHTML='<span class="badge '+n.bcls+'">'+n.blabel+'</span><h4>'+n.title+'</h4><p>'+n.body+'</p>'
    +(srcs?'<p class="srcs" style="margin-top:8px">&mdash; '+srcs+'</p>':'')+n.conns+extra
    +'<p style="margin-top:10px"><button class="linkbtn" id="connect-btn">Connect this card</button></p>'
    +threadHtml(id,n);
  detail.classList.add('open');
  detail.scrollTop=0;
  document.getElementById('connect-btn').onclick=function(){
    connectFrom=id;detail.classList.remove('open');
    wrap.classList.add('connecting');
    say('<b>Connecting from:</b> '+esc2(n.title.slice(0,44))+'&hellip; &mdash; '+${JSON.stringify(PIP.connecting)}+' <a href="#" id="cx">cancel</a>',true);
    var cx=document.getElementById('cx');
    if(cx)cx.onclick=function(ev){ev.preventDefault();connectFrom=null;wrap.classList.remove('connecting');clearFocus();hush()};
  };
}
document.getElementById('detail-close').onclick=closeDetail;
document.addEventListener('keydown',function(e){if(e.key==='Escape'){closeDetail();if(connectFrom){connectFrom=null;wrap.classList.remove('connecting');hush()}}});

svg.addEventListener('click',function(e){
  if(movedFar)return;
  var g=e.target.closest('.node');
  if(!g){if(!connectFrom){closeDetail()}return}
  var id=g.getAttribute('data-id');
  if(connectFrom&&connectFrom!==id){
    var u='https://github.com/'+REPO+'/issues/new?template=connection.yml&case='+SLUG
      +'&from='+encodeURIComponent(connectFrom+' - '+DATA[connectFrom].title.slice(0,60))
      +'&to='+encodeURIComponent(id+' - '+DATA[id].title.slice(0,60));
    window.open(u,'_blank','noopener,noreferrer');
    connectFrom=null;wrap.classList.remove('connecting');clearFocus();
    say(${JSON.stringify(PIP.connected)});
    return;
  }
  show(id);
});

/* ---------- copy embed ---------- */
var ce=document.getElementById('copyembed');
if(ce){ce.onclick=function(){var t=document.getElementById('embedcode');t.select();
  try{document.execCommand('copy')}catch(e){}
  if(navigator.clipboard)navigator.clipboard.writeText(t.value).catch(function(){});
  var d=document.getElementById('copied');d.style.display='inline';setTimeout(function(){d.style.display='none'},2000);};}

/* ---------- map / list toggle ---------- */
var map=document.getElementById('boardwrap'),list=document.getElementById('boardlist');
var bm=document.getElementById('vt-map'),bl=document.getElementById('vt-list');
if(bm&&bl&&list){
  bm.onclick=function(){map.style.display='block';list.style.display='none';bm.classList.add('on');bl.classList.remove('on')};
  bl.onclick=function(){map.style.display='none';list.style.display='block';bl.classList.add('on');bm.classList.remove('on')};
}

/* ---------- freshness ---------- */
setInterval(function(){
  fetch('./board-data.json',{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){
    if(d.serial&&d.serial!==SERIAL){say(${JSON.stringify(PIP.updated)}+' <a href="#" data-reload>Load the latest &rarr;</a>',true)}
  }).catch(function(){})
},60000);

${central ? `var CENTRAL=${JSON.stringify(central.id)};
if(!mobile()){setTimeout(function(){show(CENTRAL)},REDUCED?0:700);}
else{
  // A whole graph shrunk onto a phone is unreadable — open on the question, at reading size.
  setTimeout(function(){centreOn(CENTRAL,2.3);say(${JSON.stringify(PIP.pinch)});},REDUCED?0:500);
}` : ''}
})();`;
  if (EMBED) {
    return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(c.case.shortTitle)} — evidence board — ${SITE_NAME}</title>
<meta name="description" content="Interactive evidence board for ${esc(c.case.shortTitle)}, from ${SITE_NAME}.">
<link rel="canonical" href="${boardUrl}">
<style>${CSS}
html,body{height:100%;margin:0}
body{display:flex;flex-direction:column;background:var(--bg)}
.ebar{display:flex;align-items:center;gap:12px;padding:9px 14px;background:var(--panel);border-bottom:1px solid var(--line);flex-wrap:wrap}
.ebar .et{font-family:var(--serif);font-weight:700;font-size:15px;color:var(--ink)}
.ebar .ep{font-size:11.5px;color:var(--mut)}
.ebar .eb{margin-left:auto;font-size:13px;font-weight:700;color:var(--acc);white-space:nowrap;font-family:var(--serif)}
.ebar .eb .gb{color:var(--ink)}
#boardwrap{flex:1;border:0;border-radius:0;height:auto;min-height:0}
.efoot{display:flex;gap:12px;align-items:center;padding:7px 14px;background:var(--panel);border-top:1px solid var(--line);font-size:12px;color:var(--mut);flex-wrap:wrap}
.efoot a{font-weight:600;white-space:nowrap}
</style>
</head><body>
<div class="ebar">
  <div><div class="et">${esc(c.case.shortTitle)}</div><div class="ep">${esc(c.case.phase)}</div></div>
  <a class="eb" href="${boardUrl}" target="_blank" rel="noopener">Our<span class="gb">Gavel</span> ↗</a>
</div>
<div id="boardwrap">${svg}
<div class="bctrl"><button id="bz-in" title="Zoom in">+</button><button id="bz-out" title="Zoom out">−</button><button id="bz-fit" title="Reset view">⤢</button></div>
<div id="btoast"></div>
<div id="detail"><div class="grab"></div><span class="x" id="detail-close" role="button" tabindex="0" aria-label="Close">×</span><div id="detail-in"></div></div>
</div>
<div class="efoot">
  <span>Purple = open question · Blue = from the record · Amber = reader theory. Every card carries its sources.</span>
  <a href="${boardUrl}" target="_blank" rel="noopener" style="margin-left:auto">Full record & discussion →</a>
</div>
<script>
${scriptBlock}
</script>
</body></html>`;
  }

  return page({
    title: 'The Board — ' + c.case.shortTitle,
    desc: `The evidence board for ${c.case.shortTitle}: what the jury must decide, the evidence on each side, and the community's theories — labeled until proven.`,
    active: '/cases/',
    crumbs: `<a href="/">Home</a> › <a href="${caseUrl(c)}">${esc(c.case.shortTitle)}</a> › The Board`,
    body: `
<h1>The Board</h1>
${caseNav(c, 'board')}
<div class="boardbar">
  <div class="vtoggle"><button id="vt-map" class="on">Map</button><button id="vt-list">List</button></div>
  <div class="legend"><span class="lg-q">Question</span><span class="lg-f">Record</span><span class="lg-c">Reader</span></div>
</div>
<div id="boardwrap">${svg}
<div class="bctrl"><button id="bz-in" title="Zoom in">+</button><button id="bz-out" title="Zoom out">−</button><button id="bz-fit" title="Reset view">⤢</button></div>
<div id="btoast"></div>
<div id="detail"><div class="grab"></div><span class="x" id="detail-close" role="button" tabindex="0" aria-label="Close">×</span><div id="detail-in"></div></div>
</div>
<div id="boardlist">${listHtml}</div>
<details class="howto" id="embedbox"><summary>📺 Put this board on your own site — free</summary>
<p>Paste this anywhere that accepts HTML. The board stays live: reader theories, new evidence and every update appear in your embed automatically, and each card keeps its sources.</p>
<textarea id="embedcode" readonly rows="3" style="width:100%;font-family:ui-monospace,Consolas,monospace;font-size:12px;padding:10px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--ink);resize:vertical">${esc(embedCode)}</textarea>
<p><button class="linkbtn" id="copyembed">Copy embed code</button> <a class="linkbtn" href="${embedUrl}" target="_blank" rel="noopener" style="text-decoration:none">Preview it ↗</a> <span id="copied" style="color:var(--green);font-size:13px;display:none">Copied</span></p>
<p style="font-size:12.5px">Prefer the raw data? <a href="./data.json">board.json</a> is public and free to reuse with credit. Covering trials for a living? <a href="/creators/">There's more for you here.</a></p>
</details>
<p style="margin-top:12px">
  <a class="btn sm" href="https://github.com/${REPO}/issues/new?template=theory.yml&case=${c.slug}">🧵 Post a theory</a>
  <a class="btn sm ghost" href="https://github.com/${REPO}/issues/new?template=evidence.yml&case=${c.slug}">📎 Submit evidence</a>
  <a class="btn sm ghost" href="https://github.com/${REPO}/issues/new?template=report.yml">🚩 Report</a>
  <span style="color:var(--mut);font-size:12.5px">· 3 posts/day · posts about people get editor review first · <a href="/submit/">details</a></span>
</p>
<details class="howto"><summary>How to work the Board</summary>
<p><b>Read it:</b> purple cards are the open questions that have to be decided. Blue cards are from the record — testimony, exhibits, rulings, each linked to its source. Amber cards are reader theories — this is your zone. Post one and it goes up labeled until real sourcing settles it. Strings show the pull: <span style="color:var(--green)">green supports</span>, <span style="color:var(--red)">red disputes</span>, <span style="color:var(--amber)">amber is contested</span> — both sides claim it. Disproven theories stay up, greyed, so you can see what was tested and settled.</p>
<p><b>Build it:</b> tap a card to light up everything connected to it. Drag cards to arrange your own reading. Open a card and hit <b>Connect</b>, then tap the card it relates to — your proposed string joins the Board after review. 👍 on a theory's thread corroborates it; 👎 disputes; sources settle.</p>
<p><b>Share it:</b> every board is public — send the link, or <a href="#embedbox">put it on your own site</a>. The best-argued boards are how new readers learn a case fast.</p>
</details>
<script>
${scriptBlock}
</script>
`, extra: { serial: BUILT_AT } });
}

// ---------- submit ----------
const submit = page({
  title: 'Share what you know',
  desc: 'Post a theory, back it up, or challenge it with a fact. Most posts appear on the Board within minutes.',
  active: '/submit/',
  crumbs: `<a href="/">Home</a> › Share`,
  body: `
<h1>Add what you've found.</h1>
<div class="grid2" style="margin-top:16px">
<div class="card"><h3 style="margin-top:0">🧵 Post a theory</h3><p style="font-size:14px">Your read on the case. Joins the Board, labeled, for others to weigh in on.</p><p style="margin-top:10px"><a class="btn sm" href="https://github.com/${REPO}/issues/new?template=theory.yml">Post a theory</a></p></div>
<div class="card"><h3 style="margin-top:0">📎 Submit evidence</h3><p style="font-size:14px">Reporting or a court document that proves — or disproves — something on the Board. This is what settles arguments.</p><p style="margin-top:10px"><a class="btn sm" href="https://github.com/${REPO}/issues/new?template=evidence.yml">Submit evidence</a></p></div>
<div class="card"><h3 style="margin-top:0">🔗 Propose a connection</h3><p style="font-size:14px">Two cards are linked — supports, disputes, explains? Say why. (Or use the Connect button on any card.)</p><p style="margin-top:10px"><a class="btn sm" href="https://github.com/${REPO}/issues/new?template=connection.yml">Connect two cards</a></p></div>
<div class="card"><h3 style="margin-top:0">🚩 Report a problem</h3><p style="font-size:14px">Names a private person, personal info, fake sourcing, harassment. Reports jump the queue.</p><p style="margin-top:10px"><a class="btn sm ghost" href="https://github.com/${REPO}/issues/new?template=report.yml">Report content</a></p></div>
</div>
<div class="notice"><b>How it works:</b> theories about the case go live in ~15 minutes after an automated check; posts that discuss a specific person get editor eyes first (usually under an hour). 3 posts/day; posting uses a free GitHub account, reading never needs one. We don't publish accusations against the uncharged or anyone's personal info — <a href="/about/">why</a>.</div>
`});

// ---------- for creators ----------
const creators = page({
  title: 'For creators and newsrooms',
  desc: 'Put a live OurGavel board in your video, article or stream. Everything here is free to use.',
  active: '/creators/',
  crumbs: `<a href="/">Home</a> › For creators`,
  body: `
<h1>You do the show. We'll do the sourcing.</h1>
<p class="sub" style="max-width:640px">If you cover trials, the worst part of the job is checking what actually happened before you say it on camera. That's the part we already do, around the clock, with a source on every line.</p>

<div class="notice"><b>All of it is free.</b> Every board, every embed, the raw data, the alerts, the research requests. No account, no tier, no card. That isn't a launch promotion — there's nothing to buy here and nothing being held back for people who pay, because right now the only thing this site needs is for the record to be used.</div>

<h2>What you can take</h2>
<div class="grid2">
  <div class="card"><h3 style="margin-top:0">Embed a live board</h3>
    <p style="font-size:14.5px">One line of HTML in your article or show notes. It keeps updating after you publish, so a piece you wrote in week two still shows week four's evidence. Grab the code from the "Put this board on your own site" panel on any board.</p>
    <p style="margin-top:10px"><a class="btn sm" href="/cases/">Pick a board</a></p>
  </div>
  <div class="card"><h3 style="margin-top:0">Use the raw data</h3>
    <p style="font-size:14.5px">Every board publishes as JSON at <code>/board/data.json</code> — nodes, connections, sources, the lot. Reuse it for anything, including commercially. Credit OurGavel and link the board and we're square.</p>
    <p style="margin-top:10px"><a class="btn sm ghost" href="/cases/lindsay-clancy/board/data.json">See the format</a></p>
  </div>
  <div class="card"><h3 style="margin-top:0">Ask for a case</h3>
    <p style="font-size:14.5px">Covering a trial we don't track? Tell us and we'll build the record and the board for it. We're adding cases anyway; we'd rather add the ones someone is actually about to cover.</p>
    <p style="margin-top:10px"><a class="btn sm" href="https://github.com/${REPO}/issues/new?title=${encodeURIComponent('Case request')}&body=${encodeURIComponent('Case:\n\nCourt and where it stands:\n\nWhere you publish (optional):\n')}">Request a case</a></p>
  </div>
  <div class="card"><h3 style="margin-top:0">Get told first</h3>
    <p style="font-size:14.5px">We watch the newsrooms constantly and flag a verdict the moment two of them agree. If you want that in your inbox instead of finding out from a trending tab, say which cases and we'll wire you in.</p>
    <p style="margin-top:10px"><a class="btn sm ghost" href="https://github.com/${REPO}/issues/new?title=${encodeURIComponent('Verdict alerts')}&body=${encodeURIComponent('Cases you want alerts for:\n\nBest way to reach you:\n')}">Ask for alerts</a></p>
  </div>
</div>

<h2>Just take the facts</h2>
<div class="card"><p style="font-size:14.5px">You don't owe us a credit for reading a case off the record page and citing the outlet we cite. The reporters did that work, not us. Link them. If our board saved you an hour, a mention is nice, but nothing here is gated behind one.</p></div>

<h2>The one rule</h2>
<div class="card"><p style="font-size:14.5px">Nobody can add a claim, soften a fact, remove a source or get a theory promoted — not advertisers, not sponsors, not creators, not us. There's no money in the room to change that today, and when there is, that rule is the part that stays. It's the only reason a board is worth embedding.</p></div>

<h2>What we'd want back, eventually</h2>
<div class="card"><p style="font-size:14.5px">Nothing right now. Later, when enough people are using this to make it worth running, there'll probably be paid tooling for people who cover trials professionally — bulk exports, private working boards, an API. The record itself will stay free and open regardless. If you want a say in what that tooling looks like, use it now and tell us what's missing; the people here early are the ones who get to shape it.</p></div>
`});

// ---------- about ----------
const about = page({
  title: 'About',
  desc: 'What OurGavel is, how verification works, and the rules the site operates under.',
  active: '/about/',
  crumbs: `<a href="/">Home</a> › About`,
  body: `
<h1>About</h1>
<p class="sub" style="max-width:620px">Liveblogs are built for the minute they're posted. Come back on day 15 and you're scrolling forty screens to find out who testified on Tuesday. We keep the version you can actually read: the trial in order, with a source on every line.</p>
<h2>The rules</h2>
<div class="card"><p style="font-size:14.5px">
<b>No source, no sentence.</b> Every factual line here names where it came from. If outlets disagree, you get both.<br>
<b>We never say someone is guilty.</b> We report what is alleged, what is argued, and what gets decided. That is not a legal disclaimer, it is the whole job.<br>
<b>Rumour and record don't mix.</b> Reader theories are amber wherever they appear. Upvotes don't promote them. Sources do.<br>
<b>Verdicts wait for two.</b> A verdict becomes fact here when two independent newsrooms report it, not when the first one does.<br>
<b>Corrections stay visible.</b> We fix things in place and say what changed. No quiet edits.<br>
<b>We cover the proceeding, not the grief.</b> Nothing about a victim's last hours beyond what the charge itself requires.
</p></div>
<h2>Hard questions about people who aren't charged</h2>
<div class="card"><p style="font-size:14.5px">Ask them. Conduct and institutions are fair game here — charging decisions, defence strategy, what a hospital missed, what investigators didn't chase. What we won't host is a crowd deciding a private person did it. That is how an innocent student got named as the Boston bomber, and how a professor with no connection to the Idaho murders ended up suing a TikTok sleuth. If scrutiny of someone is already on the record — a cross-examination, a filing, published reporting — bring it as <a href="/submit/">evidence</a> and it goes up with the source attached. Questions travel on facts, not names.</p></div>
<h2>How this site is made</h2>
<div class="card"><p style="font-size:14.5px">Software watches the newsrooms covering each case around the clock and pulls in their headlines, attributed and linked. The record itself — the day-by-day, the witness index, the boards — is written from that published reporting and from court documents, and every claim carries its source so you can check the work rather than trust us.</p>
<p style="font-size:14.5px;margin-top:8px">Yes, a lot of that is automated. We think that's the honest way to run a court record: a machine can re-read every source every fifteen minutes and never get bored on day nineteen, which is exactly when most coverage gets sloppy. What automation does <i>not</i> do here is decide anything that matters. A person signs off before this site states a verdict, a plea, or a sentence in its own voice. A person reviews every reader post that names someone. And nothing goes up as fact on a single source, ever.</p>
<p style="font-size:14.5px;margin-top:8px">If we get something wrong, tell us and we'll fix it in public with a note saying what changed. <a href="https://github.com/${REPO}/issues">Corrections go here.</a> The whole site — every source, every edit, every commit — is public at <a href="https://github.com/${REPO}">github.com/${REPO}</a>. You can read the receipts.</p></div>
<h2>Who runs this</h2>
<div class="card"><p style="font-size:14.5px">OurGavel is independent. No court, no party, no newsroom has any say in what goes up. It is small and it is not pretending otherwise.</p>
<p style="font-size:14.5px;margin-top:8px">The site will carry advertising and analytics as it grows, and anything sponsored or affiliate-linked is labelled where it sits. None of it touches the record: no advertiser sees a case page before you do, and no paid link ever appears inside a board card.</p></div>
`});

// ---------- write ----------
const files = { 'index.html': home, 'cases/index.html': casesIndex, 'submit/index.html': submit, 'creators/index.html': creators, 'about/index.html': about };
for (const c of CASES) {
  files[`cases/${c.slug}/index.html`] = hubPage(c);
  files[`cases/${c.slug}/timeline/index.html`] = timelinePage(c);
  files[`cases/${c.slug}/witnesses/index.html`] = witnessesPage(c);
  files[`cases/${c.slug}/board/index.html`] = boardPage(c);
  files[`cases/${c.slug}/board/embed/index.html`] = boardPage(c, { embed: true });
  const sp = standardPage(c);
  if (sp) files[`cases/${c.slug}/standard/index.html`] = sp;
}
for (const [rel, html] of Object.entries(files)) {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, harden(BASE ? html.replace(/href="\//g, `href="${BASE}/`) : html));
}
const liveItem = i => ({ ts: i.ts, outlet: i.outlet, headline: i.headline, url: safeUrl(i.url), flag: i.flag || null, case: i._case || null });
fs.writeFileSync(path.join(OUT, 'live.json'), JSON.stringify({
  serial: BUILT_AT, checked: BUILT_AT, items: allItems.slice(0, 24).map(liveItem),
}));
for (const c of CASES) {
  fs.writeFileSync(path.join(OUT, 'cases', c.slug, 'live.json'), JSON.stringify({
    serial: BUILT_AT, checked: BUILT_AT, phase: c.case.phase,
    items: (c.ticker.items || []).slice(0, 24).map(liveItem),
  }));
  fs.writeFileSync(path.join(OUT, 'cases', c.slug, 'board', 'board-data.json'), JSON.stringify({ serial: BUILT_AT }));
  // Public board data — reusable with attribution.
  fs.writeFileSync(path.join(OUT, 'cases', c.slug, 'board', 'data.json'), JSON.stringify({
    case: { slug: c.slug, title: c.case.title, shortTitle: c.case.shortTitle, court: c.case.court, phase: c.case.phase, status: c.case.status },
    generated: BUILT_AT,
    source: `${SITE}/cases/${c.slug}/board/`,
    license: 'Free to reuse with visible attribution and a link back to the source URL.',
    nodes: [...c.board.nodes, ...(c.community.nodes || [])].map(n => ({ id: n.id, type: n.type, status: n.status, title: n.title, body: n.body, sources: n.sources || [], submittedBy: n.submittedBy || null })),
    edges: [...c.board.edges, ...(c.community.edges || [])],
  }, null, 2));
}
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
if (CNAME) fs.writeFileSync(path.join(OUT, 'CNAME'), CNAME + '\n');
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nAllow: /\n');
console.log('Built', Object.keys(files).length, 'pages,', CASES.length, 'case(s), at', BUILT_AT);
