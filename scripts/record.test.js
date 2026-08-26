#!/usr/bin/env node
/* The record keeps its own promises.
 * Run: node scripts/record.test.js
 *
 * Every other suite here guards a promise the site makes in prose — the composer's "appear once
 * reviewed", the embed's "stays live", robots.txt's "index the board instead". This one guards
 * the promise the record itself makes, which is EDITORIAL.md §1: every factual sentence carries a
 * named source with a working link, and §2: we say who testified and what they said.
 *
 * Five rules, in the order they have actually bitten us:
 *
 *   1. STRUCTURE — days are numbered without gaps, dated in order, and never dated in the future.
 *   2. SOURCING — every day carries a named outlet and an absolute https URL, no duplicates.
 *   3. WITNESSES — name, role and a gist that says something. No stubs, no repeats within a day.
 *   4. THE SUMMARY MUST NOT NAME A WITNESS THE DAY DOES NOT LIST. This is the one that matters.
 *      A summary reading "Dr. Jennifer Tufts testified" while `witnesses` holds a stub or nothing
 *      is the record telling a reader about a witness the witness index will never show them.
 *      Day 5 and Day 9 of the Clancy case were both in exactly that state before 2026-08-22.
 *   5. NO MERGE-CONFLICT MARKERS in anything that renders. A committed marker in
 *      alex-murdaugh-retrial/case.json took the whole pulse down for ten minutes on 2026-08-22.
 *
 * Two things are REPORTED, not failed, because both are legitimate states rather than defects:
 * a day with no witnesses at all (procedural days exist), and a day with a single source
 * (scheduling facts need only one, per AGENT.md). They are printed so a run can see them.
 *
 * This suite reads data/ only. It does not need a build, and it does not touch the network.
 */
const fs = require('fs');
const path = require('path');

const CASES = path.join(__dirname, '..', 'data', 'cases');
let pass = 0, fail = 0;
const notes = [];
const ok = (cond, label) => { cond ? pass++ : (fail++, console.log('  FAIL  ' + label)); };

const CONFLICT = /^(<{7}|={7}|>{7})/m;
const STUB = /^(tbd|n\/a|na|none|unknown|testimony began|continued|see day \d+)\.?$/i;

// A day that tells the reader someone testified owes the reader a witness list.
const SAYS_SOMEONE_TESTIFIED = /\b(testif\w*|took the stand|on the stand|witness(es)?|cross-examin\w*)\b/i;

// A gist made only of calendar words tells a reader nothing. "Testimony began; continued Day 10."
// stood on Clancy Day 9 for two weeks and is the exact shape this catches: strip the scheduling
// vocabulary and see whether any substance is left underneath.
// NOTE: "examination" is deliberately NOT in this list. A medical examiner's "External
// examination of Cora" is substance, not calendar — an earlier draft of this rule stripped it and
// failed a good entry. Only strip words that can carry no content of their own.
const SCHEDULING = /\b(testimony|testified|cross-examination|continued?|continues|resumed?|began|begins|start(ed|s)?|day \d+|next (week|day)|tomorrow|morning|afternoon)\b/gi;
const substanceOf = g => String(g || '').replace(SCHEDULING, ' ').replace(/[^a-z]/gi, '').length;

// A person named in prose as having testified. Deliberately conservative: it only fires on a
// title plus at least two capitalised name parts, so "Judge Sullivan warned" and "the defense"
// never trip it, and neither does a bare surname.
const NAMED_IN_PROSE = /\b(Dr|Det|Sgt|Lt|Capt|Trooper|Officer|Nurse)\.? ([A-Z][a-z]+) ([A-Z][a-zA-Z'’-]+)/g;

const slugs = fs.readdirSync(CASES).filter(s => fs.statSync(path.join(CASES, s)).isDirectory()).sort();
ok(slugs.length > 0, 'there is at least one case on file');

const today = new Date().toISOString().slice(0, 10);

for (const slug of slugs) {
  const read = f => {
    const p = path.join(CASES, slug, f);
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    ok(!CONFLICT.test(raw), slug + '/' + f + ' — merge-conflict marker committed into the file');
    try { return JSON.parse(raw); } catch (e) { ok(false, slug + '/' + f + ' does not parse: ' + e.message); return null; }
  };

  const kase = read('case.json');
  const daysFile = read('days.json');
  if (!kase || !daysFile) continue;

  console.log('\n--- ' + slug + ' ---');

  // ---- the case chip and the docket order both read from these two strings
  ok(typeof kase.phase === 'string' && kase.phase.trim().length > 3, slug + ' — phase is missing or empty');
  ok(typeof kase.statusNow === 'string' && kase.statusNow.trim().length > 20, slug + ' — statusNow is missing or too thin to tell a reader anything');
  const sns = kase.statusNowSources || [];
  ok(sns.length >= 1, slug + ' — statusNow has no source (EDITORIAL.md §1)');
  for (const s of sns) ok(s && s.outlet && /^https:\/\//.test(s.url || ''), slug + ' — a statusNow source is not a named outlet with an absolute https URL');

  // ---- the legal explainer
  const ls = kase.legalStandard;
  if (ls) {
    for (const k of ['name', 'test', 'burden']) ok(typeof ls[k] === 'string' && ls[k].trim(), slug + ' — legalStandard.' + k + ' is empty');
    ok((ls.sources || []).length >= 1, slug + ' — legalStandard cites nothing');
    for (const s of (ls.sources || [])) ok(s && s.outlet && /^https:\/\//.test(s.url || ''), slug + ' — a legalStandard source is not a named authority with an absolute https URL');
    if (!ls.qa || !ls.qa.length) notes.push(slug + ' — legal explainer has no qa array');
    for (const q of (ls.qa || [])) ok(q && q.q && q.a, slug + ' — a legalStandard qa entry is missing its question or its answer');
  }

  // ---- structure
  const days = daysFile.days || [];
  let prevDay = 0, prevDate = '';
  for (const d of days) {
    const tag = slug + ' day ' + d.day;
    ok(d.day === prevDay + 1, tag + ' — day numbering jumps (previous was ' + prevDay + ')');
    ok(/^\d{4}-\d{2}-\d{2}$/.test(d.date || ''), tag + ' — date is not YYYY-MM-DD');
    ok(d.date > prevDate, tag + ' — date ' + d.date + ' does not advance on ' + prevDate);
    ok(d.date <= today, tag + ' — dated ' + d.date + ', which is in the future');
    ok(typeof d.headline === 'string' && d.headline.trim().length > 8, tag + ' — headline is missing or too short');
    ok(typeof d.summary === 'string' && d.summary.trim().length > 40, tag + ' — summary is missing or too thin');
    prevDay = d.day; prevDate = d.date;

    // ---- sourcing
    const srcs = d.sources || [];
    ok(srcs.length >= 1, tag + ' — no source at all (EDITORIAL.md §1: no source, no sentence)');
    if (srcs.length === 1) notes.push(tag + ' — single-sourced');
    const urls = new Set();
    for (const s of srcs) {
      ok(s && typeof s.outlet === 'string' && s.outlet.trim(), tag + ' — a source has no outlet name');
      ok(/^https:\/\/[^\s"]+$/.test(s.url || ''), tag + ' — source "' + (s.outlet || '?') + '" has no absolute https URL');
      ok(!urls.has(s.url), tag + ' — the same URL is cited twice (' + s.url + ')');
      urls.add(s.url);
      ok(!/^https:\/\/(www\.)?(bing|news\.google)\./.test(s.url || ''), tag + ' — an aggregator is cited as a source (EDITORIAL.md §3b: aggregators are never sources)');
    }

    // ---- witnesses
    const ws = d.witnesses || [];
    if (!ws.length) notes.push(tag + ' — no witnesses listed');
    // A procedural day may legitimately list nobody. A day that SAYS someone testified may not.
    if (SAYS_SOMEONE_TESTIFIED.test((d.headline || '') + ' ' + (d.summary || ''))) {
      ok(ws.length >= 1, tag + ' — the page says someone testified and then lists no witnesses: "' + d.headline + '"');
    }
    const names = new Set();
    for (const w of ws) {
      ok(w && typeof w.name === 'string' && w.name.trim().length > 2, tag + ' — a witness has no name');
      ok(w && typeof w.role === 'string' && w.role.trim().length > 2, tag + ' — witness "' + (w.name || '?') + '" has no role');
      ok(w && typeof w.gist === 'string' && w.gist.trim().length >= 15, tag + ' — witness "' + (w.name || '?') + '" has no gist worth reading');
      ok(!STUB.test((w.gist || '').trim()), tag + ' — witness "' + (w.name || '?') + '" carries a placeholder gist: "' + (w.gist || '') + '"');
      ok(substanceOf(w.gist) >= 15, tag + ' — witness "' + (w.name || '?') + '" has a gist made only of calendar words: "' + (w.gist || '') + '"');
      ok(!names.has(w.name), tag + ' — witness "' + (w.name || '?') + '" is listed twice');
      names.add(w.name);
    }

    // ---- RULE 4: the summary must not name a witness the day does not list
    const listed = ws.map(w => (w.name || '').toLowerCase());
    NAMED_IN_PROSE.lastIndex = 0;
    let m;
    while ((m = NAMED_IN_PROSE.exec(d.summary || '')) !== null) {
      const full = (m[2] + ' ' + m[3]).toLowerCase();
      const surname = m[3].toLowerCase();
      const found = listed.some(n => n.includes(full) || (n.includes(surname) && n.includes(m[2].toLowerCase())));
      ok(found, tag + ' — the summary names "' + m[0] + '" but the witness list does not carry them');
    }
  }
}

console.log('\n--- reported, not failed ---');
for (const n of notes) console.log('  note  ' + n);
if (!notes.length) console.log('  none');

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.log('\n  THE RECORD IS THE PRODUCT. Fix the data, not this file.\n');
  process.exit(1);
}
console.log('  The record keeps its promises.\n');
