#!/usr/bin/env node
/* GavelBoard static site generator. No dependencies. Node 18+.
   Multi-case: every directory under data/cases/<slug>/ with a case.json becomes a full
   case section (hub, timeline, witnesses, standard, board). Adding a case = adding data. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const BUILT_AT = new Date().toISOString();
const REPO = process.env.GB_REPO || 'evesloan/gavelboard';
const SITE_NAME = 'GavelBoard';
const TAGLINE = 'The record. The rumors. The line between.';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const fmtDate = iso => new Date(iso + (iso.length === 10 ? 'T12:00:00Z' : '')).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
const fmtTs = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';

function srcLinks(sources) {
  if (!sources || !sources.length) return '';
  return `<span class="srcs">— ${sources.map(s => `<a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.outlet)}</a>`).join(' · ')}</span>`;
}

const CSS = `
:root{--bg:#0e1116;--panel:#161b23;--panel2:#1b212b;--ink:#e8e6e1;--mut:#9aa3af;--line:#2a3240;--acc:#c9a227;--acc2:#8ab4f8;--green:#4caf7d;--red:#e05d5d;--amber:#e0a83d;--violet:#a78bfa;--serif:Georgia,'Times New Roman',serif;--sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
@media (prefers-color-scheme: light){:root{--bg:#f7f5f0;--panel:#ffffff;--panel2:#f0ede6;--ink:#1a1d23;--mut:#5b6470;--line:#ddd8cc;--acc:#8a6d1d;--acc2:#2b5cad;--green:#25784f;--red:#b03a3a;--amber:#9a6d15;--violet:#6d4fc4}}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.55;font-size:16px}
a{color:var(--acc2);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1080px;margin:0 auto;padding:0 20px}
header.mast{border-bottom:3px double var(--line);padding:18px 0 12px;background:var(--panel)}
.mast .wrap{display:flex;align-items:baseline;gap:18px;flex-wrap:wrap}
.logo{font-family:var(--serif);font-size:30px;font-weight:700;letter-spacing:.5px;color:var(--ink)}
.logo a{color:inherit}.logo .gb{color:var(--acc)}
.tag{color:var(--mut);font-size:13px;font-style:italic}
nav.crumbs{font-size:13px;color:var(--mut);margin:14px 0 4px}
nav.sitenav{display:flex;gap:4px;flex-wrap:wrap;margin-left:auto}
nav.sitenav a{font-size:13px;color:var(--mut);padding:4px 10px;border-radius:4px}
nav.sitenav a.on,nav.sitenav a:hover{color:var(--ink);background:var(--panel2);text-decoration:none}
main{padding:24px 0 60px}
h1{font-family:var(--serif);font-size:32px;line-height:1.2;margin:10px 0 6px}
h2{font-family:var(--serif);font-size:22px;margin:34px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h3{font-size:16px;margin:18px 0 6px}
.sub{color:var(--mut);font-size:15px;margin-bottom:18px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:18px 20px;margin:14px 0}
.badge{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;padding:2px 8px;border-radius:3px;vertical-align:middle}
.badge.live{background:var(--red);color:#fff;animation:pulse 2.2s infinite}
.badge.phase{background:var(--panel2);color:var(--amber);border:1px solid var(--amber)}
.badge.archived{background:var(--panel2);color:var(--mut);border:1px solid var(--line)}
.badge.verified{color:var(--green);border:1px solid var(--green);background:transparent}
.badge.unverified{color:var(--amber);border:1px solid var(--amber);background:transparent}
.badge.disproven{color:var(--red);border:1px solid var(--red);background:transparent}
.badge.open{color:var(--violet);border:1px solid var(--violet);background:transparent}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.55}}
.ticker{border-left:3px solid var(--acc);padding-left:0;list-style:none}
.ticker li{padding:10px 0 10px 16px;border-bottom:1px solid var(--line)}
.ticker li:last-child{border-bottom:none}
.ticker .t{color:var(--mut);font-size:12px;white-space:nowrap}
.ticker .o{color:var(--acc);font-weight:600;font-size:13px}
.srcs{color:var(--mut);font-size:12.5px}
.srcs a{color:var(--mut);text-decoration:underline dotted}
.day{margin:0 0 10px;border-left:3px solid var(--line);padding:2px 0 14px 18px;position:relative}
.day::before{content:'';position:absolute;left:-7px;top:8px;width:11px;height:11px;border-radius:50%;background:var(--bg);border:2px solid var(--acc)}
.day .dh{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.day .dn{font-family:var(--serif);font-weight:700;font-size:17px}
.day .dd{color:var(--mut);font-size:13px}
.wit{margin:8px 0 0;padding-left:0;list-style:none}
.wit li{padding:7px 10px;margin:6px 0;background:var(--panel2);border-radius:6px;font-size:14px}
.wit .wn{font-weight:700}.wit .wr{color:var(--mut);font-size:12.5px}
table.witx{width:100%;border-collapse:collapse;font-size:14px}
table.witx th,table.witx td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
table.witx th{color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.6px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:760px){.grid2{grid-template-columns:1fr}}
.vopt{border:1px solid var(--line);border-radius:8px;padding:12px 14px;background:var(--panel)}
.vopt b{font-family:var(--serif)}
footer{border-top:3px double var(--line);padding:22px 0 40px;color:var(--mut);font-size:13px;background:var(--panel)}
footer .hb{color:var(--green)}
.disc{font-size:12.5px;color:var(--mut);border-top:1px dashed var(--line);margin-top:16px;padding-top:10px}
.btn{display:inline-block;background:var(--acc);color:#14161a;font-weight:700;padding:9px 16px;border-radius:6px;font-size:14px}
.btn:hover{text-decoration:none;filter:brightness(1.08)}
.btn.ghost{background:transparent;color:var(--acc);border:1px solid var(--acc)}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12.5px;color:var(--mut);margin:10px 0}
.legend span::before{content:'';display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.lg-q::before{background:var(--violet)}.lg-f::before{background:var(--acc2)}.lg-c::before{background:var(--amber)}
#boardwrap{position:relative;border:1px solid var(--line);border-radius:8px;overflow:hidden;height:640px;cursor:grab;touch-action:none;background-color:var(--panel);background-image:radial-gradient(var(--line) 1px, transparent 1px);background-size:22px 22px}
#boardwrap:active{cursor:grabbing}
#boardwrap.connecting .node{cursor:crosshair}
.node{cursor:move}
#btoast{display:none;position:absolute;left:50%;transform:translateX(-50%);bottom:14px;background:var(--panel2);border:1px solid var(--acc);border-radius:8px;padding:9px 16px;font-size:13.5px;z-index:6;box-shadow:0 6px 24px rgba(0,0,0,.4);max-width:88%}
.linkbtn{border:1px solid var(--acc);background:transparent;color:var(--acc);border-radius:6px;padding:6px 12px;font-size:13px;cursor:pointer;font-weight:600}
.linkbtn:hover{background:var(--acc);color:#14161a}
@media (prefers-reduced-motion: reduce){.badge.live{animation:none}}
#detail{position:absolute;right:12px;top:12px;width:330px;max-height:calc(100% - 24px);overflow:auto;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:14px;display:none;font-size:14px;box-shadow:0 8px 30px rgba(0,0,0,.35)}
#detail h4{font-family:var(--serif);margin:6px 0}
#detail .x{float:right;cursor:pointer;color:var(--mut);font-size:18px;line-height:1}
.node{cursor:pointer}
.node rect{transition:filter .15s}
.node:hover rect{filter:brightness(1.25)}
.edge-supports{stroke:var(--green)}.edge-contradicts{stroke:var(--red)}.edge-contested{stroke:var(--amber);stroke-dasharray:6 4}.edge-explains{stroke:var(--mut);stroke-dasharray:2 4}.edge-disproves{stroke:var(--red);stroke-width:3}
.notice{background:var(--panel2);border:1px solid var(--line);border-left:4px solid var(--acc);border-radius:6px;padding:12px 16px;font-size:14px;margin:14px 0}
.qa{margin:12px 0}.qa dt{font-weight:700;font-family:var(--serif);margin-top:14px}.qa dd{margin:4px 0 0;color:var(--ink)}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:18px 0}
@media(max-width:760px){.steps{grid-template-columns:1fr}}
.step{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px 18px}
.step .n{font-family:var(--serif);font-size:26px;color:var(--acc);font-weight:700}
.step h3{margin:6px 0 4px}.step p{font-size:14px;color:var(--mut)}
.bctrl{position:absolute;left:12px;top:12px;display:flex;flex-direction:column;gap:6px;z-index:5}
.bctrl button{width:34px;height:34px;border-radius:8px;border:1px solid var(--line);background:var(--panel2);color:var(--ink);font-size:17px;cursor:pointer}
.bctrl button:hover{border-color:var(--acc)}
.vtoggle{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;margin:0 0 10px}
.vtoggle button{border:0;background:var(--panel);color:var(--mut);padding:8px 16px;font-size:13.5px;cursor:pointer;font-weight:600}
.vtoggle button.on{background:var(--acc);color:#14161a}
#boardlist{display:none}
#boardlist .card{margin:10px 0}
#boardlist h3{margin-top:22px}
.conns{margin-top:8px;padding-top:8px;border-top:1px dashed var(--line);font-size:12.5px;color:var(--mut)}
.conns b.sup{color:var(--green)}.conns b.con{color:var(--red)}.conns b.mix{color:var(--amber)}
details.howto{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px 16px;font-size:14px;margin:12px 0}
details.howto summary{cursor:pointer;font-weight:700;color:var(--acc)}
details.howto p{margin:8px 0}
@media(max-width:760px){#detail{left:8px;right:8px;top:auto;bottom:8px;width:auto;max-height:46%}}
`;

function page({ title, desc, crumbs, body, active }) {
  const nav = [
    ['/', 'Home'], ['/cases/', 'Cases'], ['/submit/', 'Share'], ['/about/', 'About']
  ].map(([href, label]) => `<a href="${href}" class="${active === href ? 'on' : ''}">${label}</a>`).join('');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — ${SITE_NAME}</title>
<meta name="description" content="${esc(desc)}">
<style>${CSS}</style>
</head><body>
<header class="mast"><div class="wrap">
  <div class="logo"><a href="/"><span class="gb">Gavel</span>Board</a></div>
  <div class="tag">${TAGLINE}</div>
  <nav class="sitenav">${nav}</nav>
</div></header>
<main><div class="wrap">
${crumbs ? `<nav class="crumbs">${crumbs}</nav>` : ''}
${body}
</div></main>
<footer><div class="wrap">
  <p><b>${SITE_NAME}</b> keeps a source-linked record of high-attention court cases, re-checked automatically around the clock. <span class="hb">◉ Last build: ${esc(BUILT_AT)}</span></p>
  <p class="disc">GavelBoard reports on allegations and court proceedings; every defendant is presumed innocent unless and until proven guilty. Community items marked UNVERIFIED are submitted theories, not established facts, and are labeled as such. This site summarizes and links to coverage by credentialed news organizations and to primary legal sources; quoted material belongs to the cited outlets. Corrections: open an issue at <a href="https://github.com/${REPO}/issues">github.com/${REPO}</a>. Some outbound links may become affiliate links; if that happens they will be labeled. Nothing here is legal advice.</p>
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
const ACTIVE = CASES.filter(c => c.case.status !== 'archived');

// ---------- shared bits ----------
function tickerHtml(items, n = 8, withCase = false) {
  const rows = items.slice(0, n).map(i => `<li><span class="t">${esc(fmtTs(i.ts))}</span> · <span class="o">${esc(i.outlet)}</span>${withCase && i._case ? ` · <span class="t">${esc(i._case)}</span>` : ''}<br><a href="${esc(i.url)}" rel="noopener" target="_blank">${esc(i.headline)}</a>${i.flag === 'verdict-watch' ? ' <span class="badge disproven">verdict watch</span>' : ''}</li>`).join('\n');
  return `<ul class="ticker">${rows}</ul>`;
}
const caseUrl = (c, sub = '') => `/cases/${c.slug}/${sub}`;

function caseCard(c, featured = false) {
  const cc = c.case;
  const badge = cc.status === 'archived' ? `<span class="badge archived">Concluded</span>` : `<span class="badge live">Now in court</span>`;
  return `<div class="card">
  ${badge} <span class="badge phase">${esc(cc.phase)}</span>
  <h2 style="border:none;margin:10px 0 4px"><a href="${caseUrl(c)}">${esc(cc.shortTitle)}</a></h2>
  <p style="max-width:640px">${esc(cc.plainSummary || cc.charges + '. ' + cc.court + '.')}</p>
  <p style="margin-top:12px">
    <a class="btn" href="${caseUrl(c)}">Follow the trial</a>
    <a class="btn ghost" href="${caseUrl(c, 'board/')}">Open the Board</a>
  </p>
</div>`;
}

// ---------- home ----------
const allItems = ACTIVE.flatMap(c => (c.ticker.items || []).map(i => ({ ...i, _case: c.case.shortTitle }))).sort((a, b) => b.ts.localeCompare(a.ts));
const home = page({
  title: "The facts of the trial, in everyone's hands",
  desc: 'GavelBoard follows the court cases everyone is watching and keeps the facts straight — every line linked to its source — with a community board for sharing and testing theories together.',
  active: '/',
  body: `
<h1>The facts of the trial,<br>in everyone's hands.</h1>
<p class="sub" style="font-size:17px;max-width:640px">GavelBoard follows the big court cases and keeps the record straight — what happened, who said what, what the evidence shows — with every line linked to its source. Then it's your turn: share what you think, back up what you know, and test theories with everyone else watching.</p>
<div class="steps">
  <div class="step"><span class="n">1</span><h3>Get the facts</h3><p>The whole trial, day by day — every witness, every ruling, every fact linked to where it came from. Catch up in minutes, not forty screens of liveblog.</p></div>
  <div class="step"><span class="n">2</span><h3>See the evidence</h3><p>The Board lays out what the jury must decide and the evidence pulling each way. Click anything to see its sources.</p></div>
  <div class="step"><span class="n">3</span><h3>Build the case file</h3><p>Post a theory, connect the dots, discuss every card. The community builds the board together — and the best boards teach a case faster than any article.</p></div>
</div>
${ACTIVE.slice(0, 3).map(c => caseCard(c, true)).join('\n')}
${CASES.length > 3 ? `<p><a href="/cases/">All cases →</a></p>` : ''}
<h2>Latest updates</h2>
<p class="sub">From the newsrooms covering each trial, linked to the original reporting. Refreshed every 15 minutes.</p>
${tickerHtml(allItems, 6, ACTIVE.length > 1)}
`});

// ---------- cases index ----------
const casesIndex = page({
  title: 'Cases',
  desc: 'Every case GavelBoard is following — active trials first.',
  active: '/cases/',
  crumbs: `<a href="/">Home</a> › Cases`,
  body: `
<h1>Cases</h1>
<p class="sub">Active trials first. Concluded cases stay up — the record doesn't expire.</p>
${[...ACTIVE, ...CASES.filter(c => c.case.status === 'archived')].map(c => caseCard(c)).join('\n')}
`});

// ---------- per-case pages ----------
function hubPage(c) {
  const cc = c.case;
  return page({
    title: cc.shortTitle,
    desc: `Follow ${cc.title}: what's happening now, the day-by-day record, the evidence board, and how the case can end.`,
    active: '/cases/',
    crumbs: `<a href="/">Home</a> › <a href="/cases/">Cases</a> › ${esc(cc.shortTitle)}`,
    body: `
<span class="badge live">Now in court</span> <span class="badge phase">${esc(cc.phase)}</span>
<h1>${esc(cc.title)}</h1>
<p class="sub">${esc(cc.court)} · ${esc(cc.judge)}</p>
<div class="card"><h3>Right now</h3>
<p>${esc(cc.statusNow || cc.phase)} ${srcLinks(cc.statusNowSources)}</p>
${cc.livestream ? `<p style="margin-top:8px"><b>Watch live:</b> ${cc.livestream.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.outlet)}</a>`).join(' · ')}</p>` : ''}</div>
<p style="margin-top:14px">
  <a class="btn" href="${caseUrl(c, 'timeline/')}">The record, day by day</a>
  <a class="btn" href="${caseUrl(c, 'board/')}">Open the Board</a>
</p>
<p class="sub" style="margin-top:8px">Also: <a href="${caseUrl(c, 'witnesses/')}">every witness, indexed</a> · <a href="${caseUrl(c, 'standard/')}">the law, in plain English</a></p>
<div class="card"><h3>The basics</h3>
<p><b>Defendant:</b> ${esc(cc.defendant)}<br>
<b>Charges:</b> ${esc(cc.charges)}<br>
<b>Plea & defense:</b> ${esc(cc.plea)}<br>
<b>Victims:</b> ${esc(cc.victims)}<br>
<b>Prosecution:</b> ${esc(cc.prosecution.join(', '))}<br>
<b>Defense:</b> ${esc(cc.defense.join(', '))}</p></div>
<h2>How this can end</h2>
<div class="grid2">
${cc.verdictOptions.map(v => `<div class="vopt"><b>${esc(v.option)}</b><br><span style="font-size:14px">${esc(v.consequence)}</span><br>${srcLinks(v.sources)}</div>`).join('\n')}
</div>
<h2>Latest updates</h2>
${tickerHtml(c.ticker.items, 8)}
`});
}

function dayBlock(c, d) {
  const wits = (d.witnesses || []).map(w => `<li><span class="wn">${esc(w.name)}</span> <span class="wr">— ${esc(w.role)}</span><br>${esc(w.gist)}</li>`).join('');
  return `<div class="day" id="day-${d.day}">
  <div class="dh"><span class="dn">Day ${d.day}</span><span class="dd">${fmtDate(d.date)}</span><span class="badge phase">${esc(d.phase)}</span></div>
  <h3 style="margin:6px 0 4px">${esc(d.headline)}</h3>
  <p style="font-size:14.5px">${esc(d.summary)} ${srcLinks(d.sources)}</p>
  ${wits ? `<ul class="wit">${wits}</ul>` : ''}
</div>`;
}
function timelinePage(c) {
  return page({
    title: 'Day-by-day — ' + c.case.shortTitle,
    desc: `Every trial day of ${c.case.title}: witnesses, testimony, rulings — each entry cited to its source.`,
    active: '/cases/',
    crumbs: `<a href="/">Home</a> › <a href="${caseUrl(c)}">${esc(c.case.shortTitle)}</a> › Day-by-day`,
    body: `
<h1>Day-by-day record</h1>
<p class="sub">${esc(c.days.note || '')}</p>
${c.days.pretrial.length ? `<h2>Before trial</h2>
${c.days.pretrial.map(p => `<div class="day"><div class="dh"><span class="dd">${fmtDate(p.date)}</span></div><p style="font-size:14.5px">${esc(p.event)} ${srcLinks(p.sources)}</p></div>`).join('\n')}` : ''}
<h2>The trial</h2>
${c.days.days.map(d => dayBlock(c, d)).join('\n')}
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
<p class="sub">${allWits.length} witnesses indexed from the day-by-day record. Click a day for full context.</p>
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
<p class="sub">Plain-English explainer, drawn only from the case law, the statute, and the model jury instruction. Not legal advice.</p>
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
function boardPage(c) {
  const nodes = [...c.board.nodes, ...(c.community.nodes || [])];
  const edges = [...c.board.edges, ...(c.community.edges || [])];
  const threads = (c.threads && c.threads.threads) || {};
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
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
  const svg = `<svg id="boardsvg" viewBox="${minX} ${minY} ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">${defs}<g id="viewport">${edgeEls}\n${nodeEls}</g></svg>`;

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

  const badgeFor = n => n.type === 'question' ? ['open', 'before the jury'] : n.status === 'disproven' ? ['disproven', 'disproven'] : n.type === 'rumor' ? ['unverified', 'community theory'] : n.type === 'resolved' ? ['verified', 'resolved'] : ['verified', 'from the record'];
  const listGroups = [
    ['The questions', nodes.filter(n => n.type === 'question')],
    ['The evidence and testimony', nodes.filter(n => ['fact', 'testimony', 'exhibit', 'resolved'].includes(n.type))],
    ['Community theories', nodes.filter(n => n.type === 'rumor')],
  ];
  const listHtml = listGroups.filter(([, ns]) => ns.length).map(([title, ns]) => `<h3>${title}</h3>` + ns.map(n => {
    const [bcls, blabel] = badgeFor(n);
    return `<div class="card"><span class="badge ${bcls}">${blabel}</span><h4 style="font-family:var(--serif);margin:8px 0 4px">${esc(n.title)}</h4><p style="font-size:14px">${esc(n.body)}</p>${n.sources && n.sources.length ? `<p style="margin-top:6px">${srcLinks(n.sources)}</p>` : ''}${connHtml(n.id)}${n.traction ? `<p style="color:var(--mut);font-size:12.5px;margin-top:6px">Corroborated by ${n.traction.up} · disputed by ${n.traction.down}${n.issue ? ` · <a href="${esc(n.issue)}" target="_blank" rel="noopener">discussion</a>` : ''}</p>` : ''}</div>`;
  }).join('\n')).join('\n');

  const detailData = JSON.stringify(Object.fromEntries(nodes.map(n => {
    const [bcls, blabel] = badgeFor(n);
    const th = threads[n.id] || null;
    return [n.id, { title: n.title, body: n.body, bcls, blabel, sources: n.sources || [], traction: n.traction || null, issue: n.issue || null, conns: connHtml(n.id), thread: th }];
  })));
  const central = nodes.find(n => n.central) || nodes.find(n => n.type === 'question');
  const edgeData = JSON.stringify(edges.filter(e => byId[e.from] && byId[e.to]).map(e => ({ f: e.from, t: e.to })));
  const newThreadUrl = id => `https://github.com/${REPO}/issues/new?title=${encodeURIComponent('Discussion: ' + (byId[id] ? byId[id].title.slice(0, 60) : id))}&body=${encodeURIComponent(`<!--node:${id} case:${c.slug}-->\n\n`)}`;
  const connectUrl = `https://github.com/${REPO}/issues/new?template=connection.yml&case=${c.slug}`;

  return page({
    title: 'The Board — ' + c.case.shortTitle,
    desc: `The evidence board for ${c.case.shortTitle}: what the jury must decide, the evidence on each side, and the community's theories — labeled until proven.`,
    active: '/cases/',
    crumbs: `<a href="/">Home</a> › <a href="${caseUrl(c)}">${esc(c.case.shortTitle)}</a> › The Board`,
    body: `
<h1>The Board</h1>
<p class="sub" style="max-width:680px">The case file, laid out: what the jury must decide, the evidence pulling on each question, and the community's theories — clearly labeled. Click any card for sources and discussion. Arrange it your way; your layout is remembered on this device.</p>
<details class="howto"><summary>How to work the Board</summary>
<p><b>Read it:</b> purple cards are the open questions the jury must decide. Blue cards are from the record — testimony, exhibits, rulings, each linked to its source. Amber cards are community theories, labeled unverified until real sourcing lands. Strings show the pull: <span style="color:var(--green)">green supports</span>, <span style="color:var(--red)">red disputes</span>, <span style="color:var(--amber)">amber is contested</span>. Disproven theories stay up, greyed — you can see what was tested and settled.</p>
<p><b>Build it:</b> drag cards to arrange your own reading of the case. Open a card and hit <b>Connect</b>, then click the card it relates to — your proposed string joins the Board once it clears the pulse. <b>Discuss</b> opens the card's thread. 👍 on a theory's thread corroborates it; 👎 disputes; sources settle.</p>
<p><b>Share it:</b> every board is public — send the link. The best-argued boards are how new readers learn a case fast. <a href="/submit/">Add your theory →</a></p>
</details>
<div class="vtoggle"><button id="vt-map" class="on">Map</button><button id="vt-list">List</button></div>
<div class="legend"><span class="lg-q">Open question</span><span class="lg-f">From the record</span><span class="lg-c">Community theory</span><span style="margin-left:auto"><span style="color:var(--green)">— supports</span> · <span style="color:var(--red)">— disputes</span> · <span style="color:var(--amber)">– – contested</span></span></div>
<div id="boardwrap">${svg}
<div class="bctrl"><button id="bz-in" title="Zoom in">+</button><button id="bz-out" title="Zoom out">−</button><button id="bz-fit" title="Reset view">⤢</button></div>
<div id="btoast"></div>
<div id="detail"><span class="x" onclick="document.getElementById('detail').style.display='none'">×</span><div id="detail-in"></div></div>
</div>
<div id="boardlist">${listHtml}</div>
<p style="margin-top:12px"><a class="btn" href="/submit/">Add your theory</a> <span style="color:var(--mut);font-size:13px">Drag cards to arrange · drag the felt to pan · scroll or buttons to zoom</span></p>
<script>
(function(){
var DATA=${detailData};
var EDGES=${edgeData};
var SLUG=${JSON.stringify(c.slug)},REPO=${JSON.stringify(REPO)},NW=${NW},NH=${NH};
var wrap=document.getElementById('boardwrap'),svg=document.getElementById('boardsvg'),vp=document.getElementById('viewport');
var toast=document.getElementById('btoast');
var tx=0,ty=0,scale=1;
var offsets={};try{offsets=JSON.parse(localStorage.getItem('gb-layout-'+SLUG)||'{}')}catch(e){offsets={}}
function saveOffsets(){try{localStorage.setItem('gb-layout-'+SLUG,JSON.stringify(offsets))}catch(e){}}
var nodeEls={};document.querySelectorAll('.node').forEach(function(g){nodeEls[g.getAttribute('data-id')]=g});
function posOf(id){var g=nodeEls[id];if(!g)return null;var o=offsets[id]||{x:0,y:0};return{x:+g.getAttribute('data-bx')+o.x,y:+g.getAttribute('data-by')+o.y}}
function applyNode(id){var g=nodeEls[id],p=posOf(id);if(g&&p)g.setAttribute('transform','translate('+p.x+','+p.y+')')}
var edgeEls=document.querySelectorAll('path.edge');
function drawEdges(){edgeEls.forEach(function(p){
  var a=posOf(p.getAttribute('data-from')),b=posOf(p.getAttribute('data-to'));if(!a||!b)return;
  var x1=a.x+NW/2,y1=a.y+NH/2,x2=b.x+NW/2,y2=b.y+NH/2;
  p.setAttribute('d','M'+x1+','+y1+' Q'+((x1+x2)/2)+','+((y1+y2)/2+28)+' '+x2+','+y2);
})}
Object.keys(nodeEls).forEach(applyNode);drawEdges();
function applyView(){vp.setAttribute('transform','translate('+tx+','+ty+') scale('+scale+')')}
function zoom(f){scale=Math.min(2.5,Math.max(0.35,scale*f));applyView()}
document.getElementById('bz-in').onclick=function(){zoom(1.25)};
document.getElementById('bz-out').onclick=function(){zoom(0.8)};
document.getElementById('bz-fit').onclick=function(){tx=0;ty=0;scale=1;offsets={};saveOffsets();Object.keys(nodeEls).forEach(applyNode);drawEdges();applyView()};
var mode=null,sx=0,sy=0,startOff=null,dragId=null,movedFar=false;
wrap.addEventListener('mousedown',function(e){
  var g=e.target.closest('.node');movedFar=false;sx=e.clientX;sy=e.clientY;
  if(g){mode='node';dragId=g.getAttribute('data-id');var o=offsets[dragId]||{x:0,y:0};startOff={x:o.x,y:o.y}}
  else{mode='pan';startOff={x:tx,y:ty}}
});
window.addEventListener('mousemove',function(e){
  if(!mode)return;var dx=e.clientX-sx,dy=e.clientY-sy;
  if(Math.abs(dx)+Math.abs(dy)>4)movedFar=true;
  if(mode==='pan'){tx=startOff.x+dx;ty=startOff.y+dy;applyView()}
  else{offsets[dragId]={x:startOff.x+dx/scale,y:startOff.y+dy/scale};applyNode(dragId);drawEdges()}
});
window.addEventListener('mouseup',function(){if(mode==='node'&&movedFar)saveOffsets();mode=null;dragId=null});
wrap.addEventListener('wheel',function(e){e.preventDefault();zoom(e.deltaY<0?1.1:0.9)},{passive:false});
var touch=null;
wrap.addEventListener('touchstart',function(e){if(e.touches.length===1){touch={x:e.touches[0].clientX-tx,y:e.touches[0].clientY-ty}}},{passive:true});
wrap.addEventListener('touchmove',function(e){if(touch&&e.touches.length===1){tx=e.touches[0].clientX-touch.x;ty=e.touches[0].clientY-touch.y;applyView()}},{passive:true});
wrap.addEventListener('touchend',function(){touch=null});
var connectFrom=null;
function say(html,sticky){toast.innerHTML=html;toast.style.display='block';if(!sticky){clearTimeout(say._t);say._t=setTimeout(function(){toast.style.display='none'},6000)}}
function esc2(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')}
function threadHtml(id,n){
  var t=n.thread;var out='<div class="conns" style="border-top-style:solid"><b>Discussion</b>';
  if(t&&t.comments&&t.comments.length){
    out+=t.comments.map(function(cm){return '<p style="margin:6px 0"><b style="color:var(--acc)">'+esc2(cm.user)+'</b> <span style="font-size:11px">'+cm.ts.slice(0,10)+'</span><br>'+esc2(cm.body)+'</p>'}).join('');
    out+='<a href="'+t.url+'" target="_blank" rel="noopener">Reply — '+t.count+' comment'+(t.count===1?'':'s')+' →</a>';
  } else if(t){out+='<br><a href="'+t.url+'" target="_blank" rel="noopener">Be the first to comment →</a>';}
  else{
    var u='https://github.com/'+REPO+'/issues/new?title='+encodeURIComponent('Discussion: '+n.title.slice(0,60))+'&body='+encodeURIComponent('<!--node:'+id+' case:'+SLUG+'-->\\n\\n');
    out+='<br><a href="'+u+'" target="_blank" rel="noopener">Start the discussion →</a>';
  }
  return out+'</div>';
}
function show(id){
  var n=DATA[id];if(!n)return;
  var el=document.getElementById('detail-in');
  var srcs=(n.sources||[]).map(function(s){return '<a href="'+s.url+'" target="_blank" rel="noopener">'+s.outlet+'</a>'}).join(' · ');
  var extra=n.traction?('<p style="color:var(--mut);font-size:12.5px;margin-top:6px">Corroborated by '+n.traction.up+' · disputed by '+n.traction.down+'</p>'):'';
  el.innerHTML='<span class="badge '+n.bcls+'">'+n.blabel+'</span><h4>'+n.title+'</h4><p>'+n.body+'</p>'
    +(srcs?'<p class="srcs" style="margin-top:8px">— '+srcs+'</p>':'')+n.conns+extra
    +'<p style="margin-top:10px"><button class="linkbtn" id="connect-btn">🔗 Connect this card</button></p>'
    +threadHtml(id,n);
  document.getElementById('detail').style.display='block';
  document.getElementById('connect-btn').onclick=function(){
    connectFrom=id;document.getElementById('detail').style.display='none';
    wrap.classList.add('connecting');
    say('<b>Connecting from:</b> '+esc2(n.title.slice(0,50))+'… — now click the card it relates to. <a href="#" id="cx">cancel</a>',true);
    document.getElementById('cx').onclick=function(ev){ev.preventDefault();connectFrom=null;wrap.classList.remove('connecting');toast.style.display='none'};
  };
}
svg.addEventListener('click',function(e){
  if(movedFar)return;
  var g=e.target.closest('.node');if(!g)return;
  var id=g.getAttribute('data-id');
  if(connectFrom&&connectFrom!==id){
    var u='https://github.com/'+REPO+'/issues/new?template=connection.yml&case='+SLUG
      +'&from='+encodeURIComponent(connectFrom+' — '+DATA[connectFrom].title.slice(0,60))
      +'&to='+encodeURIComponent(id+' — '+DATA[id].title.slice(0,60));
    window.open(u,'_blank');
    connectFrom=null;wrap.classList.remove('connecting');
    say('Proposed connection opened in a new tab — pick the relation, say why, submit. It joins the Board after the next pulse.');
    return;
  }
  show(id);
});
var map=document.getElementById('boardwrap'),list=document.getElementById('boardlist');
var bm=document.getElementById('vt-map'),bl=document.getElementById('vt-list');
bm.onclick=function(){map.style.display='block';list.style.display='none';bm.classList.add('on');bl.classList.remove('on')};
bl.onclick=function(){map.style.display='none';list.style.display='block';bl.classList.add('on');bm.classList.remove('on')};
var SERIAL=${JSON.stringify(BUILT_AT)};
setInterval(function(){
  fetch('./board-data.json',{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){
    if(d.serial&&d.serial!==SERIAL){say('The Board has been updated. <a href="#" onclick="location.reload();return false">Load the latest →</a>',true)}
  }).catch(function(){})
},60000);
${central ? `if(window.innerWidth>760){show(${JSON.stringify(central.id)});}` : ''}
})();
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
<h1>Share what you think — or what you know.</h1>
<p class="sub" style="max-width:640px">The Board runs on two things: the record, and you. Post your read on the case, corroborate someone else's, or knock a theory down with a fact.</p>
<div class="grid2">
<div class="card"><h3>🧵 Post a theory</h3><p>Your read on the case — what the evidence means, what a side is really doing, where this is heading. It joins the Board as a labeled theory for others to weigh in on.</p><p style="margin-top:10px"><a class="btn" href="https://github.com/${REPO}/issues/new?template=theory.yml">Post a theory</a></p></div>
<div class="card"><h3>📎 Back it up — or knock it down</h3><p>Found reporting or a court document that proves or disproves something on the Board? This is the move that settles arguments. Facts are the only thing that promote a theory — or retire one.</p><p style="margin-top:10px"><a class="btn" href="https://github.com/${REPO}/issues/new?template=evidence.yml">Submit evidence</a></p></div>
<div class="card"><h3>🔗 Connect the dots</h3><p>Think two things on the Board are linked — this testimony undercuts that question, this ruling explains that move? Propose the connection and say why.</p><p style="margin-top:10px"><a class="btn" href="https://github.com/${REPO}/issues/new?template=connection.yml">Propose a connection</a></p></div>
<div class="card"><h3>🚩 Report a problem</h3><p>Something that names a private person, shares personal info, fakes a source, or harasses anyone. Reports jump the queue.</p><p style="margin-top:10px"><a class="btn ghost" href="https://github.com/${REPO}/issues/new?template=report.yml">Report content</a></p></div>
</div>
<div class="notice"><b>How posting works:</b> theories about the case itself go live within about 15 minutes after an automated check. Anything that discusses a specific person is looked at by an editor first — usually within the hour. Three posts per day per account; posting uses a free GitHub account (reading never requires one). We don't publish accusations against people who haven't been charged, or anyone's personal information — <a href="/about/">here's why</a>.</div>
`});

// ---------- about ----------
const about = page({
  title: 'About',
  desc: 'What GavelBoard is, how verification works, and the rules the site operates under.',
  active: '/about/',
  crumbs: `<a href="/">Home</a> › About`,
  body: `
<h1>About GavelBoard</h1>
<p class="sub">Arming everyone watching a big trial with the same thing: the facts, sourced.</p>
<div class="card"><p>Liveblogs are written for the minute they're published. GavelBoard is written for the person who arrives on day 15 and asks: <i>what actually happened here?</i> We keep the running record — day by day, witness by witness, ruling by ruling — with every factual line linked to the credentialed outlet or primary legal source it came from. Around the record, the community explores what it might mean, on a Board where theories are labeled, tested together, and — when a fact lands — settled in public.</p></div>
<h2>The rules this site runs on</h2>
<div class="card"><p>
<b>Attribution, always.</b> Facts appear here only with a named source attached. If outlets disagree, we say so and show both.<br>
<b>The presumption of innocence is not a formality.</b> Nothing on this site asserts a defendant's guilt. We report what is alleged, argued, and decided.<br>
<b>Rumor and record never mix.</b> Community theories are amber and labeled wherever they appear. Popularity cannot promote them; only sourcing can.<br>
<b>Verdicts get special handling.</b> A verdict is published as established fact only once multiple independent credentialed outlets report it — before that, you'll see the attributed headlines and a verdict-watch notice.<br>
<b>Corrections are public.</b> Errors are fixed in place with a note, not silently.<br>
<b>Dignity.</b> These cases involve real grief. We cover the proceeding — not autopsy detail beyond the legal facts, not the victims' worst day as content.
</p></div>
<h2>Why we don't host accusations against the uncharged</h2>
<div class="card"><p>The hardest question a case like this raises is often about someone who isn't on trial — a spouse, an institution, an investigator. There's a right way and a wrong way to unpack that. The wrong way is a crowd naming a private person as a suspect: it's how an innocent student got named as the Boston Marathon bomber, and how a university professor with no connection to the Idaho murders ended up suing a TikTok sleuth for defamation — real damage, to real people, that no correction ever fully unwinds. So that's the one thing the Board doesn't do.</p>
<p style="margin-top:8px">The right way is here, and it's powerful: question <b>conduct and institutions</b> freely — the prosecution's charging choices, the defense's strategy, a hospital system's failures, what investigators missed; all of that is on the Board now. And when scrutiny of a person is already part of the public record — a cross-examination, a court filing, published reporting — bring it as <a href="/submit/">evidence</a>, and it enters the record with its source attached. Questions travel here on facts, not on names.</p></div>
<h2>Who runs this</h2>
<div class="card"><p>GavelBoard is operated by a small team using automated monitoring (updates refresh every 15 minutes), with editor review of community posts that discuss specific people, and removal power over everything. The site may run advertising and analytics; anything sponsored or affiliate-linked is labeled where it appears, and none of it touches the record. GavelBoard is independent and unaffiliated with any court, party, or outlet. Contact / corrections: <a href="https://github.com/${REPO}/issues">GitHub issues</a>.</p></div>
`});

// ---------- write ----------
const files = { 'index.html': home, 'cases/index.html': casesIndex, 'submit/index.html': submit, 'about/index.html': about };
for (const c of CASES) {
  files[`cases/${c.slug}/index.html`] = hubPage(c);
  files[`cases/${c.slug}/timeline/index.html`] = timelinePage(c);
  files[`cases/${c.slug}/witnesses/index.html`] = witnessesPage(c);
  files[`cases/${c.slug}/board/index.html`] = boardPage(c);
  const sp = standardPage(c);
  if (sp) files[`cases/${c.slug}/standard/index.html`] = sp;
}
for (const [rel, html] of Object.entries(files)) {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, html);
}
for (const c of CASES) {
  fs.writeFileSync(path.join(OUT, 'cases', c.slug, 'board', 'board-data.json'), JSON.stringify({ serial: BUILT_AT }));
}
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nAllow: /\n');
console.log('Built', Object.keys(files).length, 'pages,', CASES.length, 'case(s), at', BUILT_AT);
