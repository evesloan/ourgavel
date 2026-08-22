#!/usr/bin/env node
/* Builds a single-file clickable preview of the whole site for the Artifact viewer.
   Body-content only (the artifact host supplies the document skeleton). */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');

const SECTIONS = [
  // preview of the live site: one case (clancy), all surfaces
  ['home', 'index.html', 'Home'],
  ['cases', 'cases/index.html', 'All cases'],
  ['hub', 'cases/lindsay-clancy/index.html', 'Case hub'],
  ['board', 'cases/lindsay-clancy/board/index.html', 'The Board'],
  ['timeline', 'cases/lindsay-clancy/timeline/index.html', 'Day-by-day'],
  ['witnesses', 'cases/lindsay-clancy/witnesses/index.html', 'Witnesses'],
  ['standard', 'cases/lindsay-clancy/standard/index.html', 'Legal standard'],
  ['submit', 'submit/index.html', 'Contribute'],
  ['about', 'about/index.html', 'About'],
];
const LINKMAP = [
  [/href="\/cases\/(?!lindsay-clancy)[a-z-]+\/(?:board|timeline|witnesses|standard)?\/?"/g, 'href="#cases"'],
  [/href="\/cases\/lindsay-clancy\/timeline\/#(day-\d+)"/g, 'href="#$1"'],
  [/href="\/cases\/lindsay-clancy\/timeline\/"/g, 'href="#timeline"'],
  [/href="\/cases\/lindsay-clancy\/witnesses\/"/g, 'href="#witnesses"'],
  [/href="\/cases\/lindsay-clancy\/standard\/"/g, 'href="#standard"'],
  [/href="\/cases\/lindsay-clancy\/board\/"/g, 'href="#board"'],
  [/href="\/cases\/lindsay-clancy\/"/g, 'href="#hub"'],
  [/href="\/submit\/"/g, 'href="#submit"'],
  [/href="\/cases\/"/g, 'href="#cases"'],
  [/href="\/about\/"/g, 'href="#about"'],
  [/href="\/about\//g, 'href="#about"'],
  [/href="\/"/g, 'href="#home"'],
];

const first = fs.readFileSync(path.join(PUB, SECTIONS[0][1]), 'utf8');
let css = first.match(/<style>([\s\S]*?)<\/style>/)[1];
// The site is parchment-first with a dark media query. Artifact viewers may stamp an explicit
// theme, so: guard the media query against an explicit light choice, and mirror the dark tokens
// onto [data-theme="dark"] so the viewer's toggle wins in both directions.
css = css.replace('@media (prefers-color-scheme: dark){:root{', '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){');
const darkMatch = css.match(/@media \(prefers-color-scheme: dark\)\{:root:not\(\[data-theme="light"\]\)\{([\s\S]*?)\}\}/);
if (darkMatch) css += `\n:root[data-theme="dark"]{${darkMatch[1]}}\n`;
css += `
.pv-note{position:sticky;top:0;z-index:60;background:var(--acc);color:#fbf7ec;font-size:13px;font-weight:700;padding:7px 14px;text-align:center}
.pv-sec{border-top:6px solid var(--line);margin-top:50px;padding-top:6px}
.pv-sec:first-of-type{border-top:none;margin-top:0}
.pv-label{font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--mut);background:var(--panel2);display:inline-block;padding:3px 10px;border-radius:0 0 6px 6px;margin-left:20px}
body{background:var(--bg)}
`;

let body = `<div class="pv-note">Preview build — this is exactly what ships to ourgavel.com. Links navigate within this page.</div>\n`;
const mastMatch = first.match(/<header class="mast">[\s\S]*?<\/header>/)[0];
let mast = mastMatch;
for (const [re, sub] of LINKMAP) mast = mast.replace(re, sub);
mast = mast.replace(/class="(on )?"/g, 'class=""');
body += mast.replace('</div></header>', '</div></header>');

for (const [id, rel, label] of SECTIONS) {
  let html = fs.readFileSync(path.join(PUB, rel), 'utf8');
  let main = html.match(/<main><div class="wrap">([\s\S]*?)<\/div><\/main>/)[1];
  for (const [re, sub] of LINKMAP) main = main.replace(re, sub);
  body += `\n<section class="pv-sec" id="${id}"><span class="pv-label">${label}</span>\n<main><div class="wrap">${main}</div></main></section>\n`;
}
let foot = first.match(/<footer>[\s\S]*?<\/footer>/)[0];
for (const [re, sub] of LINKMAP) foot = foot.replace(re, sub);
body += foot;

const out = `<title>OurGavel</title>\n<style>${css}</style>\n${body}`;
fs.writeFileSync(path.join(ROOT, 'preview.html'), out);
console.log('preview.html', (out.length / 1024).toFixed(0) + 'KB');
