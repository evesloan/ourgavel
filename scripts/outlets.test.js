#!/usr/bin/env node
/* Tests for scripts/outlets.js — who published this, and does it count?

   This module decides two things that nothing else double-checks: the source name a
   reader sees under every ticker row, and whether an item counts towards the three
   independent newsrooms that let scripts/verdict.js publish a criminal verdict with
   no human in the loop. Both were previously read off a feed label typed into
   case.json, which is why 32 of 81 live rows credited "Bing News" for reporting done
   by AP, The Post and Courier, WIS and WLTX — or by nobody identifiable at all.

   The half of this file that matters most is MUST NOT COUNT. A name that is merely
   ugly is a bad day; a repost that counts as a newsroom is a wrong verdict. */
'use strict';
const {
  outletFor, nameFor, familyFor, isAggregatorUrl, hostOf, registrable, familyFromLabel,
  OUTLETS, AGGREGATORS,
} = require('./outlets.js');

let pass = 0; const fails = [];
const ok = (cond, label) => { if (cond) pass++; else fails.push(label); };
const eq = (got, want, label) => {
  if (got === want) pass++;
  else fails.push(label + '\n    got:  ' + JSON.stringify(got) + '\n    want: ' + JSON.stringify(want));
};
const u = (host, p) => 'https://www.' + host + '/' + (p || 'story');

// ---- MUST NOT COUNT --------------------------------------------------------
for (const [host, label] of AGGREGATORS) {
  eq(familyFor(u(host), 'Court TV'), null, host + ' must never count as a newsroom');
  eq(nameFor(u(host), 'Court TV'), 'via ' + label, host + ' must be named for itself, not by its feed label');
  ok(/^via /.test(nameFor(u(host), 'AP')), host + ' must be marked to the reader as a route, not a reporter');
  ok(outletFor(u(host), 'AP').syndicated === true, host + ' must be flagged syndicated');
  ok(isAggregatorUrl(u(host)), 'isAggregatorUrl(' + host + ')');
}
// The label is not evidence, in either direction.
eq(familyFor(u('msn.com', 'x/ar-AA1'), 'AP'), null, 'a repost with a respectable label still must not count');
eq(familyFor(u('apnews.com'), 'Bing News — Murdaugh retrial'), 'ap', 'a real newsroom behind an aggregator label must count');

// Look-alike hosts must not inherit an aggregator's or a newsroom's identity.
for (const evil of ['msn.com.evil.example', 'notmsn.com', 'msn.com.attacker.test', 'evil-yahoo.com']) {
  ok(!isAggregatorUrl(u(evil)), evil + ' must not match an aggregator by substring');
}
eq(outletFor(u('fakecourttv.com')).known, false, 'fakecourttv.com must not be read as Court TV');
eq(outletFor(u('courttv.com.evil.example')).known, false, 'a courttv.com.* subdomain-suffix spoof must not be read as Court TV');

// A single-label host is not a domain and cannot be a newsroom.
for (const bad of ['https://x/1', 'https://localhost:8899/a', 'http://intranet/a']) {
  eq(outletFor(bad, 'Court TV').host, '', bad + ' must be treated as having no usable URL');
  eq(familyFor(bad, 'Bing News'), null, bad + ' must fall back to the label, which is an aggregator');
}
// Junk in, no crash, no phantom source out.
for (const bad of [null, undefined, '', 'not a url', 'javascript:alert(1)', 'ftp://h/a', 42, {}]) {
  eq(familyFor(bad, ''), null, 'no family from ' + JSON.stringify(bad) + ' with no label');
  ok(typeof nameFor(bad, '') === 'string', 'nameFor always returns a string for ' + JSON.stringify(bad));
}
eq(nameFor('', ''), 'Unattributed', 'nothing at all is named Unattributed, never blank');

// ---- MUST COUNT, AND BE NAMED CORRECTLY ------------------------------------
const named = [
  ['apnews.com', 'AP', 'ap'],
  ['postandcourier.com', 'The Post and Courier', 'postandcourier'],
  ['wistv.com', 'WIS News 10', 'wis'],
  ['wltx.com', 'WLTX News19', 'wltx'],
  ['courttv.com', 'Court TV', 'courttv'],
  ['8newsnow.com', '8 News Now', '8newsnow'],
  ['news4jax.com', 'News4JAX', 'news4jax'],
];
for (const [host, name, fam] of named) {
  eq(nameFor(u(host), 'Bing News'), name, host + ' names itself, not the feed');
  eq(familyFor(u(host), 'Bing News'), fam, host + ' family');
  eq(familyFor('https://' + host + '/a', ''), fam, host + ' matches without the www');
  eq(familyFor('https://sub.' + host + '/a', ''), fam, 'a subdomain of ' + host + ' is the same newsroom');
}

// An unknown newsroom is still a newsroom: named honestly, counted once.
eq(nameFor(u('somepaper.example'), 'Bing News'), 'somepaper.example', 'an unknown host is named by its domain');
ok(familyFor(u('somepaper.example'), '') !== null, 'an unknown newsroom still counts once');
eq(familyFor('https://a.somepaper.example/x', ''), familyFor('https://b.somepaper.example/y', ''),
   'two subdomains of one unknown domain are one source');
eq(registrable('news.bbc.co.uk'), 'bbc.co.uk', 'multi-part public suffix');
eq(registrable('a.b.c.example.com'), 'example.com', 'registrable domain');
eq(hostOf('https://WWW.Example.COM/x'), 'example.com', 'host is lowercased and de-www-ed');

// ---- THE LABEL FALLBACK MUST NOT REGRESS -----------------------------------
// Two spellings of one newsroom typed into two feed configs are still one source.
eq(familyFromLabel('Court TV'), familyFromLabel('CourtTV.com'), 'Court TV spellings collapse');
eq(familyFromLabel('Court TV — all news'), familyFromLabel('Court TV'), 'a per-tag Court TV feed is the same newsroom');
for (const agg of ['Bing News', 'Google News', 'News Search', 'Bing News — Murdaugh retrial']) {
  eq(familyFromLabel(agg), null, 'label "' + agg + '" is not a newsroom');
}
eq(familyFromLabel(''), null, 'an empty label is not a newsroom');

// ---- THE TABLE ITSELF ------------------------------------------------------
const hosts = OUTLETS.map(r => r[0]);
eq(hosts.length, new Set(hosts).size, 'no duplicate host in OUTLETS');
ok(OUTLETS.every(r => r.length === 3 && r.every(x => typeof x === 'string' && x)), 'every OUTLETS row is [host, name, family]');
ok(OUTLETS.every(r => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(r[0])), 'every OUTLETS host is a bare lowercase domain');
const aggHosts = new Set(AGGREGATORS.map(r => r[0]));
ok(hosts.every(h => !aggHosts.has(h)), 'no host is both a newsroom and an aggregator');

// Families are per-newsroom, not per owner group. When two domains share one, that is a
// claim they are literally the same newsroom — and it must be a deliberate, listed one.
// This guards the regression that owner-collapsing looks tidier than it is: it made
// WLTX in the trial's own venue indistinguishable from a Columbus station's wire rewrite.
const SAME_NEWSROOM = { globe: ['bostonglobe.com', 'boston.com'] };
const byFamily = {};
for (const [host, , fam] of OUTLETS) (byFamily[fam] = byFamily[fam] || []).push(host);
for (const [fam, hs] of Object.entries(byFamily)) {
  if (hs.length === 1) { pass++; continue; }
  eq(hs.slice().sort().join(','), (SAME_NEWSROOM[fam] || []).slice().sort().join(','),
     'family "' + fam + '" is shared by ' + hs.join(' + ') + ' — list it in SAME_NEWSROOM or give each its own');
}

console.log('outlets.test.js: ' + pass + ' assertions passed' + (fails.length ? ', ' + fails.length + ' FAILED' : ''));
if (fails.length) { fails.forEach(f => console.log('  FAIL  ' + f)); process.exit(1); }
