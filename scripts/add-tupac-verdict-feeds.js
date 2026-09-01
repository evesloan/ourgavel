#!/usr/bin/env node
/*
 * add-tupac-verdict-feeds.js — idempotent.
 *
 * WHY: the Duane Davis / Tupac verdict (GUILTY, murder w/ deadly weapon + gang enhancement)
 * was returned Aug 31 and confirmed across many newsroom families, but the autonomous verdict
 * engine never fired its banner. Cause: of the five feeds configured for this case, only two
 * carry a Vegas-local verdict headline (8newsnow / Nexstar, news3lv / Sinclair); the other three
 * (fox5vegas whole-site, npr 1001, pbs headlines) are broad national feeds that did not surface
 * the specific headline. assess() needs THREE independent families within a 12h window, so it
 * held at 2/3 and then the window closed. This does NOT write the verdict (§3b: the banner is the
 * engine's alone) — it only widens the family coverage with two verified independent Vegas
 * newsrooms so the engine can reach threshold on its own as fresh coverage lands.
 *
 * Both feeds were fetched and confirmed this run to be valid RSS carrying the Davis guilty item,
 * and to resolve to families distinct from the two already present (reviewjournal, ktnv).
 *
 * Idempotent: adds a feed only if its URL is absent. Safe to run repeatedly.
 */
const fs = require('fs');
const path = require('path');

const caseFile = path.join(__dirname, '..', 'data', 'cases', 'duane-davis-tupac', 'case.json');
const ADD = [
  { outlet: 'Las Vegas Review-Journal', url: 'https://www.reviewjournal.com/crime/courts/feed/', verified: true },
  { outlet: 'KTNV Las Vegas', url: 'https://www.ktnv.com/news.rss', verified: true },
];

const c = JSON.parse(fs.readFileSync(caseFile, 'utf8'));
if (!Array.isArray(c.feeds)) throw new Error('case.json has no feeds array');

const have = new Set(c.feeds.map(f => (f && f.url ? String(f.url).trim() : '')));
let added = 0;
for (const f of ADD) {
  if (!have.has(f.url)) { c.feeds.push(f); have.add(f.url); added++; }
}

if (added) {
  fs.writeFileSync(caseFile, JSON.stringify(c, null, 1) + '\n');
  console.log('add-tupac-verdict-feeds: added ' + added + ' feed(s); total ' + c.feeds.length);
} else {
  console.log('add-tupac-verdict-feeds: no change; both feeds already present (total ' + c.feeds.length + ')');
}
