#!/usr/bin/env node
/* GavelBoard static site generator. No dependencies. Node 18+. */
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
.lg-q::before{background:var(--violet)}.lg-f::before{background:var(--acc2)}.lg-c::before{background:var(--amber)}.lg-r::before{background:var(--green)}.lg-x::before{background:var(--red)}
#boardwrap{position:relative;border:1px solid var(--line);border-radius:8px;background:var(--panel);overflow:hidden;height:640px;cursor:grab}
#boardwrap:active{cursor:grabbing}
#detail{position:absolute;right:12px;top:12px;width:330px;max-height:calc(100% - 24px);overflow:auto;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:14px;display:none;font-size:14px;box-shadow:0 8px 30px rgba(0,0,0,.35)}
#detail h4{font-family:var(--serif);margin:6px 0}
#detail .x{float:right;cursor:pointer;color:var(--mut);font-size:18px;line-height:1}
.node{cursor:pointer}
.node rect{transition:filter .15s}
.node:hover rect{filter:brightness(1.25)}
.edge-supports{stroke:var(--green)}.edge-contradicts{stroke:var(--red)}.edge-contested{stroke:var(--amber);stroke-dasharray:6 4}.edge-explains{stroke:var(--mut);stroke-dasharray:2 4}.edge-disproves{stroke:var(--red);stroke-width:3}
.notice{background:var(--panel2);border:1px solid var(--line);border-left:4px solid var(--acc);border-radius:6px;padding:12px 16px;font-size:14px;margin:14px 0}
.qa{margin:12px 0}.qa dt{font-weight:700;font-family:var(--serif);margin-top:14px}.qa dd{margin:4px 0 0;color:var(--ink)}
`;

function page({ title, desc, crumbs, body, active, canonicalPath }) {
  const nav = [
    ['/', 'Home'], ['/cases/lindsay-clancy/', 'Clancy Trial'], ['/cases/lindsay-clancy/board/', 'The Board'], ['/submit/', 'Contribute'], ['/about/', 'About']
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
  <p><b>${SITE_NAME}</b> is a structured, continuously re-verified record of high-attention court cases. Every factual line links to its source. <span class="hb">◉ Last build: ${esc(BUILT_AT)}</span></p>
  <p class="disc">GavelBoard reports on allegations and court proceedings; every defendant is presumed innocent unless and until proven guilty. Community items marked UNVERIFIED are submitted theories, not established facts, and are labeled as such. This site summarizes and links to coverage by credentialed news organizations and to primary legal sources; quoted material belongs to the cited outlets. Corrections: open an issue at <a href="https://github.com/${REPO}/issues">github.com/${REPO}</a>. Some outbound links may become affiliate links; if that happens they will be labeled. Nothing here is legal advice.</p>
</div></footer>
</body></html>`;
}

// ---------- load data ----------
const caseDir = path.join(DATA, 'cases', 'lindsay-clancy');
const CASE = read(path.join(caseDir, 'case.json'));
const DAYS = read(path.join(caseDir, 'days.json'));
const BOARD = read(path.join(caseDir, 'board.json'));
const COMMUNITY = read(path.join(caseDir, 'community.json'));
const TICKER = read(path.join(caseDir, 'ticker.json'));

// ---------- home ----------
function tickerHtml(items, n = 12) {
  const rows = items.slice(0, n).map(i => `<li><span class="t">${esc(fmtTs(i.ts))}</span> · <span class="o">${esc(i.outlet)}</span><br><a href="${esc(i.url)}" rel="noopener" target="_blank">${esc(i.headline)}</a>${i.flag === 'verdict-watch' ? ' <span class="badge disproven">verdict watch</span>' : ''}</li>`).join('\n');
  return `<ul class="ticker">${rows}</ul>`;
}

const home = page({
  title: 'Live court case tracking, with receipts',
  desc: 'GavelBoard: structured records of high-attention trials — live updates, witness indexes, evidence boards, and a hard line between facts and rumors.',
  active: '/',
  body: `
<h1>The trial, in order. <span style="color:var(--mut)">Not in 40 screens of liveblog.</span></h1>
<p class="sub">GavelBoard keeps a structured, source-linked record of the court cases everyone is watching — what happened each day, who testified, what the jury must decide — and a community board where theories meet the record.</p>
<div class="card">
  <span class="badge live">Active</span> <span class="badge phase">${esc(CASE.phase)}</span>
  <h2 style="border:none;margin:10px 0 4px"><a href="/cases/lindsay-clancy/">${esc(CASE.title)}</a></h2>
  <p>${esc(CASE.charges)}. ${esc(CASE.court)}. Trial began ${fmtDate(CASE.trialStart)}.</p>
  <p style="margin-top:10px">
    <a class="btn" href="/cases/lindsay-clancy/">Case hub</a>
    <a class="btn ghost" href="/cases/lindsay-clancy/board/">The Board</a>
    <a class="btn ghost" href="/cases/lindsay-clancy/timeline/">Day-by-day</a>
  </p>
</div>
<h2>Latest from the wire</h2>
<p class="sub">Headlines from credentialed outlets covering active cases, attributed and linked. Auto-refreshed every 15 minutes.</p>
${tickerHtml(TICKER.items)}
`});

// ---------- case hub ----------
const hub = page({
  title: CASE.shortTitle,
  desc: `Structured record of ${CASE.title}: day-by-day testimony, witness index, the legal standard, verdict options, and live updates.`,
  active: '/cases/lindsay-clancy/',
  crumbs: `<a href="/">Home</a> › ${esc(CASE.shortTitle)}`,
  body: `
<span class="badge live">Active</span> <span class="badge phase">${esc(CASE.phase)}</span>
<h1>${esc(CASE.title)}</h1>
<p class="sub">${esc(CASE.court)} · ${esc(CASE.judge)} · Incident: ${fmtDate(CASE.incidentDate)} · Trial began ${fmtDate(CASE.trialStart)}</p>
<div class="grid2">
<div class="card"><h3>The case</h3>
<p><b>Defendant:</b> ${esc(CASE.defendant)}<br>
<b>Charges:</b> ${esc(CASE.charges)}<br>
<b>Plea & defense:</b> ${esc(CASE.plea)}<br>
<b>Victims:</b> ${esc(CASE.victims)}<br>
<b>Prosecution:</b> ${esc(CASE.prosecution.join(', '))}<br>
<b>Defense:</b> ${esc(CASE.defense.join(', '))}</p></div>
<div class="card"><h3>Where things stand</h3>
<p>The defense rested Friday, Aug 21 after 10 witnesses, without calling the defendant. The Commonwealth's rebuttal is underway (Dr. Avram Mack testified Friday; three rebuttal experts expected). Closing arguments are expected Monday Aug 24 or Tuesday Aug 25, with deliberations to follow. ${srcLinks([{outlet:'WBUR',url:'https://www.wbur.org/news/2026/08/21/lindsay-clancy-defense-rests'},{outlet:'CBS Boston',url:'https://www.cbsnews.com/boston/news/lindsay-clancy-trial-watch-live-day-18-dr-phillip-resnick/'},{outlet:'Boston Globe',url:'https://www.bostonglobe.com/2026/08/21/metro/lindsay-clancy-trial-mack-resnick/'}])}</p>
<p style="margin-top:8px"><b>Watch live:</b> ${CASE.livestream.sources.map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.outlet)}</a>`).join(' · ')}</p></div>
</div>
<p style="margin-top:14px">
  <a class="btn" href="/cases/lindsay-clancy/board/">Open the Board</a>
  <a class="btn ghost" href="/cases/lindsay-clancy/timeline/">Day-by-day record</a>
  <a class="btn ghost" href="/cases/lindsay-clancy/witnesses/">Witness index</a>
  <a class="btn ghost" href="/cases/lindsay-clancy/standard/">The legal standard, explained</a>
</p>
<h2>What the jury can decide</h2>
<div class="grid2">
${CASE.verdictOptions.map(v => `<div class="vopt"><b>${esc(v.option)}</b><br><span style="font-size:14px">${esc(v.consequence)}</span><br>${srcLinks(v.sources)}</div>`).join('\n')}
</div>
<h2>Live wire</h2>
${tickerHtml(TICKER.items, 10)}
`});

// ---------- timeline ----------
function dayBlock(d) {
  const wits = (d.witnesses || []).map(w => `<li><span class="wn">${esc(w.name)}</span> <span class="wr">— ${esc(w.role)}</span><br>${esc(w.gist)}</li>`).join('');
  return `<div class="day" id="day-${d.day}">
  <div class="dh"><span class="dn">Day ${d.day}</span><span class="dd">${fmtDate(d.date)}</span><span class="badge phase">${esc(d.phase)}</span></div>
  <h3 style="margin:6px 0 4px">${esc(d.headline)}</h3>
  <p style="font-size:14.5px">${esc(d.summary)} ${srcLinks(d.sources)}</p>
  ${wits ? `<ul class="wit">${wits}</ul>` : ''}
</div>`;
}
const timeline = page({
  title: 'Day-by-day — ' + CASE.shortTitle,
  desc: 'Every trial day of Commonwealth v. Lindsay Clancy: witnesses, testimony, rulings — each entry cited to its source.',
  active: '/cases/lindsay-clancy/',
  crumbs: `<a href="/">Home</a> › <a href="/cases/lindsay-clancy/">${esc(CASE.shortTitle)}</a> › Day-by-day`,
  body: `
<h1>Day-by-day record</h1>
<p class="sub">${esc(DAYS.note)}</p>
<h2>Before trial</h2>
${DAYS.pretrial.map(p => `<div class="day"><div class="dh"><span class="dd">${fmtDate(p.date)}</span></div><p style="font-size:14.5px">${esc(p.event)} ${srcLinks(p.sources)}</p></div>`).join('\n')}
<h2>The trial</h2>
${DAYS.days.map(dayBlock).join('\n')}
`});

// ---------- witness index ----------
const allWits = [];
for (const d of DAYS.days) for (const w of (d.witnesses || [])) allWits.push({ ...w, day: d.day, date: d.date });
allWits.sort((a, b) => a.name.localeCompare(b.name));
const witnesses = page({
  title: 'Witness index — ' + CASE.shortTitle,
  desc: 'Alphabetical index of witnesses in the Lindsay Clancy trial, with role, day called, and a one-line summary of testimony.',
  active: '/cases/lindsay-clancy/',
  crumbs: `<a href="/">Home</a> › <a href="/cases/lindsay-clancy/">${esc(CASE.shortTitle)}</a> › Witnesses`,
  body: `
<h1>Witness index</h1>
<p class="sub">${allWits.length} witnesses indexed from the day-by-day record (the Commonwealth called ~70 in total; days summarized only in aggregate by outlets are not itemized here). Click a day to jump to full context.</p>
<div class="card" style="overflow-x:auto"><table class="witx">
<tr><th>Witness</th><th>Role</th><th>Day</th><th>Testimony, in one line</th></tr>
${allWits.map(w => `<tr><td><b>${esc(w.name)}</b></td><td>${esc(w.role)}</td><td><a href="/cases/lindsay-clancy/timeline/#day-${w.day}">Day ${w.day}</a></td><td>${esc(w.gist)}</td></tr>`).join('\n')}
</table></div>
`});

// ---------- legal standard ----------
const std = CASE.legalStandard;
const standard = page({
  title: 'The legal standard — ' + CASE.shortTitle,
  desc: 'What "not guilty by reason of lack of criminal responsibility" actually requires in Massachusetts — the McHoul test, the burden of proof, and what happens after an NGRI verdict.',
  active: '/cases/lindsay-clancy/',
  crumbs: `<a href="/">Home</a> › <a href="/cases/lindsay-clancy/">${esc(CASE.shortTitle)}</a> › The legal standard`,
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

// ---------- the board ----------
function boardSvg() {
  const nodes = [...BOARD.nodes, ...(COMMUNITY.nodes || [])];
  const edges = [...BOARD.edges, ...(COMMUNITY.edges || [])];
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const W = 1080, H = 900, NW = 210, NH = 74;
  const colorFor = n => n.type === 'question' ? 'var(--violet)' : n.type === 'rumor' ? 'var(--amber)' : n.status === 'disproven' ? 'var(--red)' : n.type === 'resolved' ? 'var(--green)' : 'var(--acc2)';
  const edgeEls = edges.map(e => {
    const a = byId[e.from], b = byId[e.to];
    if (!a || !b) return '';
    const x1 = a.x + NW / 2, y1 = a.y + NH / 2, x2 = b.x + NW / 2, y2 = b.y + NH / 2;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 30;
    return `<path class="edge-${esc(e.type)}" d="M${x1},${y1} Q${mx},${my} ${x2},${y2}" fill="none" stroke-width="2" opacity="0.75"><title>${esc(e.type)}: ${esc(e.label || '')}</title></path>`;
  }).join('\n');
  const nodeEls = nodes.map(n => {
    const c = colorFor(n);
    const label = n.title.length > 66 ? n.title.slice(0, 63) + '…' : n.title;
    const lines = [];
    let cur = '';
    for (const word of label.split(' ')) {
      if ((cur + ' ' + word).trim().length > 30) { lines.push(cur.trim()); cur = word; } else cur += ' ' + word;
    }
    if (cur.trim()) lines.push(cur.trim());
    const tspans = lines.slice(0, 3).map((l, i) => `<tspan x="${n.x + 12}" dy="${i === 0 ? 0 : 15}">${esc(l)}</tspan>`).join('');
    return `<g class="node" data-id="${esc(n.id)}">
<rect x="${n.x}" y="${n.y}" width="${NW}" height="${NH}" rx="8" fill="var(--panel2)" stroke="${c}" stroke-width="2"></rect>
<text x="${n.x + 12}" y="${n.y + 24}" font-size="12.5" fill="var(--ink)" font-weight="600">${tspans}</text>
</g>`;
  }).join('\n');
  return { svg: `<svg id="boardsvg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%"><g id="viewport">${edgeEls}\n${nodeEls}</g></svg>`, nodes };
}
const { svg: boardSvgStr, nodes: allNodes } = boardSvg();
const boardData = JSON.stringify(Object.fromEntries(allNodes.map(n => [n.id, { title: n.title, body: n.body, status: n.status, type: n.type, sources: n.sources || [], traction: n.traction || null, issue: n.issue || null }])));

const board = page({
  title: 'The Board — ' + CASE.shortTitle,
  desc: 'The evidence board for the Lindsay Clancy trial: what the jury must decide, mapped against the testimony and exhibits on each side. Community theories join after review.',
  active: '/cases/lindsay-clancy/board/',
  crumbs: `<a href="/">Home</a> › <a href="/cases/lindsay-clancy/">${esc(CASE.shortTitle)}</a> › The Board`,
  body: `
<h1>The Board</h1>
<p class="sub">${esc(BOARD.note)}</p>
<div class="legend"><span class="lg-q">Question before the jury</span><span class="lg-f">Record: testimony & exhibits</span><span class="lg-c">Community (unverified)</span><span class="lg-r">Resolved</span><span class="lg-x">Disproven</span></div>
<div class="legend"><span style="color:var(--green)">— supports</span><span style="color:var(--red)">— contradicts</span><span style="color:var(--amber)">-- contested</span><span>·· context</span></div>
<div id="boardwrap">${boardSvgStr}
<div id="detail"><span class="x" onclick="document.getElementById('detail').style.display='none'">×</span><div id="detail-in"></div></div>
</div>
<p style="margin-top:12px"><a class="btn" href="/submit/">Add a theory or connection</a> <span style="color:var(--mut);font-size:13px">Drag to pan · scroll to zoom · click a node for sources</span></p>
<div class="notice"><b>How promotion works here:</b> community items enter amber (UNVERIFIED). Corroboration by other users raises traction — it never makes something a fact. Only sourcing does: two independent credentialed reports, or the court record itself, moves a node to the record. One verified fact pointing the other way marks it DISPROVEN, and it stays on the board — greyed, struck through, honest about what got ruled out.</div>
<script>
(function(){
var DATA=${boardData};
var wrap=document.getElementById('boardwrap'),svg=document.getElementById('boardsvg'),vp=document.getElementById('viewport');
var tx=0,ty=0,scale=1,dragging=false,sx=0,sy=0;
function apply(){vp.setAttribute('transform','translate('+tx+','+ty+') scale('+scale+')')}
wrap.addEventListener('mousedown',function(e){dragging=true;sx=e.clientX-tx;sy=e.clientY-ty});
window.addEventListener('mousemove',function(e){if(dragging){tx=e.clientX-sx;ty=e.clientY-sy;apply()}});
window.addEventListener('mouseup',function(){dragging=false});
wrap.addEventListener('wheel',function(e){e.preventDefault();var d=e.deltaY<0?1.1:0.9;scale=Math.min(2.5,Math.max(0.4,scale*d));apply()},{passive:false});
var touch=null;
wrap.addEventListener('touchstart',function(e){if(e.touches.length===1){touch={x:e.touches[0].clientX-tx,y:e.touches[0].clientY-ty}}},{passive:true});
wrap.addEventListener('touchmove',function(e){if(touch&&e.touches.length===1){tx=e.touches[0].clientX-touch.x;ty=e.touches[0].clientY-touch.y;apply()}},{passive:true});
wrap.addEventListener('touchend',function(){touch=null});
svg.addEventListener('click',function(e){
  var g=e.target.closest('.node');if(!g)return;
  var n=DATA[g.getAttribute('data-id')];if(!n)return;
  var el=document.getElementById('detail-in');
  var badge=n.type==='question'?'open':(n.status==='disproven'?'disproven':(n.type==='rumor'?'unverified':'verified'));
  var srcs=(n.sources||[]).map(function(s){return '<a href="'+s.url+'" target="_blank" rel="noopener">'+s.outlet+'</a>'}).join(' · ');
  var extra=n.traction?('<p style="color:var(--mut);font-size:12.5px;margin-top:6px">Corroborated by '+n.traction.up+' · disputed by '+n.traction.down+(n.issue?' · <a href="'+n.issue+'" target="_blank" rel="noopener">discussion</a>':'')+'</p>'):'';
  el.innerHTML='<span class="badge '+badge+'">'+(n.type==='question'?'before the jury':(n.status||n.type))+'</span><h4>'+n.title+'</h4><p>'+n.body+'</p>'+(srcs?'<p class="srcs" style="margin-top:8px">— '+srcs+'</p>':'')+extra;
  document.getElementById('detail').style.display='block';
});
})();
</script>
`});

// ---------- submit ----------
const submit = page({
  title: 'Contribute to the Board',
  desc: 'Post a theory, propose a connection, or submit evidence to the GavelBoard community board. Everything is reviewed before it appears.',
  active: '/submit/',
  crumbs: `<a href="/">Home</a> › Contribute`,
  body: `
<h1>Add to the Board</h1>
<p class="sub">The Board is built from the court record — and from you. Theories welcome. Accusations of uncharged people are not.</p>
<div class="grid2">
<div class="card"><h3>🧵 Post a theory</h3><p>A hypothesis about the case: what the evidence might mean, what a side's strategy is, what a ruling implies. It appears on the Board as an amber UNVERIFIED node after review.</p><p style="margin-top:10px"><a class="btn" href="https://github.com/${REPO}/issues/new?template=theory.yml">Post a theory</a></p></div>
<div class="card"><h3>🔗 Propose a connection</h3><p>Link two nodes: this testimony <i>supports</i> / <i>contradicts</i> / <i>explains</i> that question. Say why. Strong connections get drawn on the Board.</p><p style="margin-top:10px"><a class="btn" href="https://github.com/${REPO}/issues/new?template=connection.yml">Propose a connection</a></p></div>
<div class="card"><h3>📎 Submit evidence</h3><p>A published report or primary document that corroborates or disproves a node on the Board. This is the only thing that moves a node between UNVERIFIED, the record, and DISPROVEN.</p><p style="margin-top:10px"><a class="btn" href="https://github.com/${REPO}/issues/new?template=evidence.yml">Submit evidence</a></p></div>
<div class="card"><h3>🚩 Report something</h3><p>Doxxing, an accusation against a private person, fabricated sourcing, harassment. Reports are pulled every cycle and reviewed first.</p><p style="margin-top:10px"><a class="btn ghost" href="https://github.com/${REPO}/issues/new?template=report.yml">Report content</a></p></div>
</div>
<h2>House rules</h2>
<div class="card"><p>
1. <b>Theories are about the case, not the crowd.</b> Analyze the evidence, strategies, and rulings. Do not accuse private individuals of crimes, publish anyone's personal information, or speculate about uncharged people.<br>
2. <b>Corroboration is not verification.</b> Upvotes raise a theory's visibility. Only sources move it to the record.<br>
3. <b>Getting disproven is honorable.</b> Disproven nodes stay on the Board, greyed out. That is the site working.<br>
4. <b>Everything is reviewed before it appears.</b> Usually within the hour. Nothing posts to the Board unmoderated.<br>
5. <b>A GitHub account is required to post.</b> That's the launch-version tradeoff for a board with no ads, no tracking, and no spam.
</p></div>
`});

// ---------- about ----------
const about = page({
  title: 'About',
  desc: 'What GavelBoard is, how verification works, and the editorial rules the site operates under.',
  active: '/about/',
  crumbs: `<a href="/">Home</a> › About`,
  body: `
<h1>About GavelBoard</h1>
<p class="sub">A structured, continuously re-verified record of the court cases everyone is watching.</p>
<div class="card"><p>Liveblogs are written for the minute they're published. GavelBoard is written for the person who arrives on day 15 and asks: <i>what actually happened here?</i> We keep the running record — day by day, witness by witness, ruling by ruling — with every factual line linked to the credentialed outlet or primary legal source it came from. Around the record, the community explores what it might mean, on a Board where rumors are labeled, tested, and — when a fact lands — retired in public.</p></div>
<h2>The rules this site runs on</h2>
<div class="card"><p>
<b>Attribution, always.</b> Facts appear here only with a named source attached. If outlets disagree, we say so and show both.<br>
<b>The presumption of innocence is not a formality.</b> Nothing on this site asserts a defendant's guilt. We report what is alleged, argued, and decided.<br>
<b>Rumor and record never mix.</b> Community theories are amber and labeled UNVERIFIED wherever they appear. Popularity cannot promote them; only sourcing can.<br>
<b>Verdicts get special handling.</b> A verdict is published as established fact only once multiple independent credentialed outlets report it — before that, you'll see the attributed wire items and a verdict-watch notice.<br>
<b>Corrections are public.</b> Errors are fixed in place with a note, not silently.<br>
<b>Dignity.</b> These cases involve real grief. We cover the proceeding — not autopsy detail beyond the legal facts, not the victims' worst day as content.
</p></div>
<h2>Who runs this</h2>
<div class="card"><p>GavelBoard is operated by a small team using automated monitoring (the wire refreshes every 15 minutes) with human-reviewed publication for anything beyond attributed headlines. It is independent and unaffiliated with any court, party, or outlet. Contact / corrections: <a href="https://github.com/${REPO}/issues">GitHub issues</a>.</p></div>
`});

// ---------- write ----------
const files = {
  'index.html': home,
  'cases/lindsay-clancy/index.html': hub,
  'cases/lindsay-clancy/timeline/index.html': timeline,
  'cases/lindsay-clancy/witnesses/index.html': witnesses,
  'cases/lindsay-clancy/standard/index.html': standard,
  'cases/lindsay-clancy/board/index.html': board,
  'submit/index.html': submit,
  'about/index.html': about,
};
for (const [rel, html] of Object.entries(files)) {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, html);
}
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
fs.writeFileSync(path.join(OUT, 'robots.txt'), 'User-agent: *\nAllow: /\n');
console.log('Built', Object.keys(files).length, 'pages at', BUILT_AT);
