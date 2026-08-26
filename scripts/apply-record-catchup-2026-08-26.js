#!/usr/bin/env node
/* OurGavel — RECORD catch-up, 2026-08-26 (development & record lane).
 *
 * Four dark days (Aug 22-26) over four active trials during the usage-limit freeze. This
 * idempotent script refreshes the stale homepage chips (phase/statusNow) and backfills the
 * trial days that happened while the fleet was down. Every factual line is sourced to
 * outlets fetched this session (EDITORIAL.md §1). Re-running it is a no-op: chips are set to
 * fixed values and day entries are appended only if that day number is not already present.
 *
 * NOT touched, deliberately (see review/dev-log-2026-08-26.md and the report to the lead):
 *   - Mario Fernandez was CONVICTED on both counts on Aug 26. This script records the verdict
 *     as a day entry and in statusNow (fair report, EDITORIAL.md §2 — "convicted of X" is
 *     correct after a guilty verdict). It does NOT write case.json.verdict (the verdict
 *     banner) and does NOT resolve the board's central question: EDITORIAL.md §3b reserves the
 *     verdict banner for the autonomous engine in the pulse, and board resolution is verdict
 *     aftermath tied to that publication. Both are flagged to the lead.
 *   - alex-murdaugh-retrial: pretrial chip reviewed, still accurate (Nov 13 hearing, Apr 2027
 *     retrial), left unchanged.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const CASES = path.join(__dirname, '..', 'data', 'cases');
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJSON = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n');

// --- chip (phase / statusNow / statusNowSources) updates, keyed by slug ---
const CHIPS = {
  'lindsay-clancy': {
    phase: 'Rebuttal case rested — closing arguments Thursday, then the jury',
    statusNow:
      "The prosecution rested its rebuttal on Wednesday, Aug. 26, after its final expert — Dr. Gregory Saathoff, a senior forensic psychiatrist with the FBI's Behavioral Analysis Unit — testified that Clancy was \"criminally responsible\" and that command hallucinations \"do not propel an individual to automatically obey them.\" Over 21 days of testimony the jury heard from 84 witnesses. Judge William Sullivan has set closing arguments for Thursday, Aug. 27; the case then goes to the jury, which will weigh the defense's lack-of-criminal-responsibility claim (postpartum psychosis) against the prosecution's rebuttal that she knew her actions were wrong.",
    statusNowSources: [
      { outlet: 'ABC News', url: 'https://abcnews.com/GMA/News/live-updates/lindsay-clancy-trial-live-updates/?id=135813828' },
      { outlet: 'Boston Globe', url: 'https://www.bostonglobe.com/2026/08/26/metro/lindsay-clancy-trial-live-updates/' },
    ],
  },
  'lil-durk-murder-for-hire': {
    phase: 'Trial underway — opening statements delivered, prosecution case begins',
    statusNow:
      "Opening statements were delivered Monday, Aug. 24, in the federal murder-for-hire trial of Durk Banks (\"Lil Durk\") in Los Angeles. Assistant U.S. Attorney Daniel Weiner told jurors Banks was \"consumed with revenge\" after the 2020 killing of his friend King Von and put a bounty on Atlanta rapper Quando Rondo (Tyquian Bowman); an August 2022 ambush near the Beverly Center killed Bowman's 24-year-old cousin, Saviay'a Robinson, while Bowman survived. Defense attorney Marissa Goldberg countered that \"Mr. Banks had nothing to do with it,\" pointing to former assistant Kavon Grant, who has pleaded guilty. Banks, 33, is tried alongside David Lindsey and Deondre Wilson and faces a possible life sentence; the court has told jurors to expect three weeks or more.",
    statusNowSources: [
      { outlet: 'ABC7 Los Angeles', url: 'https://abc7.com/post/opening-statements-begin-murder-hire-trial-alleging-lil-durk-put-bounty-life-quando-rondo/19729915/' },
      { outlet: 'TheGrio', url: 'https://thegrio.com/2026/08/25/lil-durk-murder-for-hire-trial-revenge-plot/' },
    ],
  },
  'duane-davis-tupac': {
    phase: 'Prosecution case, week two — testimony continues',
    statusNow:
      "Week two of testimony is underway. On Monday, Aug. 24, jurors heard 2017 \"Death Row Chronicles\" recordings in which Davis reflected on Shakur's killing, and on Tuesday, Aug. 25, they heard from Outlawz rapper Malcolm \"E.D.I. Mean\" Greenidge — who was in the caravan the night Shakur was shot — and from LVMPD crime-scene and firearms analysts. Testimony continued Wednesday, Aug. 26. The trial is scheduled to run four to five weeks, which would put a verdict near mid-September.",
    statusNowSources: [
      { outlet: 'FOX5 Vegas', url: 'https://www.fox5vegas.com/2026/08/25/live-testimony-continues-week-two-tupac-murder-trial/' },
      { outlet: 'News 3 Las Vegas', url: 'https://news3lv.com/news/local/testimony-continues-tupac-shakur-murder-trial-jury-duane-davis-keffe-d-crime-court-las-vegas-nevada-livestream' },
    ],
  },
  'mario-fernandez-bridegan': {
    phase: 'Convicted — jury found Fernandez guilty on both counts (Aug. 26); sentencing to be scheduled',
    statusNow:
      "On Wednesday, Aug. 26, a Duval County jury convicted Mario Fernandez Saldana of first-degree murder and solicitation to commit a capital felony in the 2022 ambush killing of Jared Bridegan, after about three and a half hours of deliberation. Fernandez, who did not take the stand, was the first of three defendants to stand trial in the case; his ex-wife Shanna Gardner and the admitted gunman Henry Tenon face separate proceedings. A sentencing date has not been set. The conviction was reported by multiple national newsrooms.",
    statusNowSources: [
      { outlet: 'News4Jax', url: 'https://www.news4jax.com/news/local/2026/08/26/jury-to-begin-deliberations-in-mario-fernandez-murder-trial-in-february-2022-ambush-shooting-of-jared-bridegan/' },
      { outlet: 'East Idaho News', url: 'https://www.eastidahonews.com/2026/08/jurors-to-begin-deliberations-wednesday-in-mario-fernandez-saldanas-trial-for-the-murder-of-jared-bridegan/' },
    ],
  },
};

// --- new day entries, keyed by slug. Appended only if the day number is absent. ---
const DAYS = {
  'lindsay-clancy': [
    {
      day: 19,
      date: '2026-08-24',
      phase: 'rebuttal',
      headline: 'Prosecution rebuttal: not psychosis, and a mistrial motion denied',
      summary:
        "The Commonwealth's rebuttal continued. Dr. Avram Mack maintained Clancy had a major depressive disorder rather than psychosis and that psychosis alone would not necessarily prevent someone from knowing right from wrong. Dr. Kirk Heilbrun, a forensic psychologist, told jurors the killings were part of a suicide attempt — that Clancy wanted her children \"to be with her so they wouldn't suffer\" — called the act out of character, and pointed to inconsistencies in her accounts of hearing a voice. Defense attorney Kevin Reddington moved for a mistrial over Heilbrun's remark that the Catholic Church treats murder as a mortal sin; Judge William Sullivan denied the motion and instructed jurors to disregard the remark as irrelevant.",
      witnesses: [
        { name: 'Dr. Avram Mack', role: 'Forensic psychiatrist (prosecution rebuttal)', gist: 'Major depressive disorder, not psychosis; psychosis alone would not necessarily prevent knowing right from wrong.' },
        { name: 'Dr. Kirk Heilbrun', role: 'Forensic psychologist (prosecution rebuttal)', gist: 'The killings were part of a suicide attempt; she wanted her children with her; called it out of character and cited inconsistencies in her voice accounts.' },
      ],
      sources: [
        { outlet: 'Boston 25 News', url: 'https://www.boston25news.com/news/local/lindsay-clancy-trial-live-updates-prosecutors-expected-call-final-rebuttal-witnesses/BBNWTJG34VFCFNKSHU26BIEHTA/' },
      ],
    },
    {
      day: 20,
      date: '2026-08-25',
      phase: 'rebuttal',
      headline: "Heilbrun: 'criminally responsible'; the FBI's Saathoff takes the stand",
      summary:
        "Dr. Kirk Heilbrun concluded that Clancy was criminally responsible for the deaths of her three children. The Commonwealth then called its final rebuttal witness, Dr. Gregory Saathoff, a forensic psychiatrist with the FBI's Behavioral Analysis Unit, who began questioning Clancy's account of her mental state and was still testifying when court adjourned. The judge signaled closing arguments were likely later in the week.",
      witnesses: [
        { name: 'Dr. Kirk Heilbrun', role: 'Forensic psychologist (prosecution rebuttal)', gist: 'Concluded Clancy was criminally responsible for the deaths of her three children.' },
        { name: 'Dr. Gregory Saathoff', role: 'FBI forensic psychiatrist (prosecution rebuttal)', gist: "The state's final rebuttal witness; began challenging her account of her mental state and was still on the stand at day's end." },
      ],
      sources: [
        { outlet: 'NBC10 Boston', url: 'https://www.nbcboston.com/news/local/lindsay-clancy-trial-day-20-live-updates/4003382/' },
      ],
    },
    {
      day: 21,
      date: '2026-08-26',
      phase: 'rebuttal-rests',
      headline: 'Prosecution rests its rebuttal; closings set for Thursday',
      summary:
        "Dr. Gregory Saathoff, the FBI Behavioral Analysis Unit psychiatrist, finished as the Commonwealth's final rebuttal witness, testifying that Clancy \"had the capacity to appreciate right from wrong,\" that she was \"criminally responsible,\" and that command hallucinations \"do not propel an individual to automatically obey them.\" With that the prosecution rested its rebuttal, closing an evidentiary phase that ran 21 days and 84 witnesses. Judge William Sullivan set closing arguments for Thursday, Aug. 27, after which the case goes to the jury.",
      witnesses: [
        { name: 'Dr. Gregory Saathoff', role: 'FBI forensic psychiatrist (prosecution rebuttal)', gist: "Final rebuttal witness; testified she could appreciate right from wrong and was criminally responsible, and that command hallucinations do not force a person to act." },
      ],
      sources: [
        { outlet: 'ABC News', url: 'https://abcnews.com/GMA/News/live-updates/lindsay-clancy-trial-live-updates/?id=135813828' },
        { outlet: 'Boston Globe', url: 'https://www.bostonglobe.com/2026/08/26/metro/lindsay-clancy-trial-live-updates/' },
      ],
    },
  ],
  'duane-davis-tupac': [
    {
      day: 6,
      date: '2026-08-24',
      phase: 'prosecution',
      headline: "Jurors hear Davis's 2017 recordings; a witness clashes with the defense",
      summary:
        "Michael Dorsay returned to the stand to authenticate 2017 \"Death Row Chronicles\" recordings the state played for the jury, in which Davis called Shakur \"an ignorant kid in the prime of his life\" and, asked whether he wanted to apologize to Shakur's family, said \"No... I didn't do nothing.\" On cross-examination Dorsay pushed back that the defense's questions were \"based off conspiracy theories,\" and the judge reminded him that a witness answers questions rather than asks them. The defense objected that jurors should not have heard the recordings' references to other crimes.",
      witnesses: [
        { name: 'Michael Dorsay', role: "Producer, 2017 \"Death Row Chronicles\" (prosecution)", gist: 'Authenticated the 2017 recordings of Davis played to the jury; on cross clashed with the defense over what he called conspiracy-theory questions.' },
      ],
      sources: [
        { outlet: 'FOX5 Vegas', url: 'https://www.fox5vegas.com/2026/08/24/witness-testimony-continues-week-two-tupac-murder-trial/' },
        { outlet: 'WTOC', url: 'https://www.wtoc.com/2026/08/25/week-two-testimony-tupac-murder-trial-begins-with-clashing-testimony-explosive-audio/' },
      ],
    },
    {
      day: 7,
      date: '2026-08-25',
      phase: 'prosecution',
      headline: "An Outlaw's eyewitness account; LVMPD analysts detail the searches",
      summary:
        "Malcolm \"E.D.I. Mean\" Greenidge of the Outlawz, who was in the caravan with Shakur the night he was shot, described a light-colored Cadillac pulling alongside and gunfire — \"an arm and a gun\" he could not identify — and said no one in their group returned fire. LVMPD crime-scene analysts Jeffrey Scott and Steavie Felabom described the 2023 search of Davis's home, and Det. Justine Gatus testified about bins of newspaper and magazine clippings about the killing found there. Officer Mark Hatton, a NIBIN firearms examiner, testified that the seven cartridge casings from the 1996 scene bore marks consistent with a single firearm.",
      witnesses: [
        { name: 'Malcolm Greenidge', role: 'Rapper, the Outlawz (\"E.D.I. Mean\") — eyewitness (prosecution)', gist: 'In the caravan with Shakur; saw a light-colored Cadillac pull alongside and an arm and a gun, could not identify the shooter, and said no one in their group returned fire.' },
        { name: 'Jeffrey Scott', role: 'Senior crime-scene analyst, LVMPD', gist: "Documented the 2023 search of Davis's home, photographing papers found in a Dodge Challenger in the garage." },
        { name: 'Steavie Felabom', role: 'Crime-scene analyst, LVMPD', gist: 'Photographed items from the garage including a \"Compton Street Legend\" book and a 1996 VIBE magazine featuring Shakur.' },
        { name: 'Det. Justine Gatus', role: 'Homicide detective, LVMPD', gist: 'Testified about bins of newspaper and magazine clippings about the killing found in the home; could not say who assembled them.' },
        { name: 'Officer Mark Hatton', role: 'Firearms/NIBIN examiner, LVMPD (prosecution)', gist: 'Examined seven casings from the 1996 scene and testified they bore characteristics consistent with a single firearm.' },
      ],
      sources: [
        { outlet: 'FOX5 Vegas', url: 'https://www.fox5vegas.com/2026/08/25/live-testimony-continues-week-two-tupac-murder-trial/' },
        { outlet: 'News 3 Las Vegas', url: 'https://news3lv.com/news/local/testimony-continues-tupac-shakur-murder-trial-jury-duane-davis-keffe-d-crime-court-las-vegas-nevada-livestream' },
      ],
    },
  ],
  'mario-fernandez-bridegan': [
    {
      day: 6,
      date: '2026-08-24',
      phase: 'prosecution-rests',
      headline: 'The state rests its murder-for-hire case',
      summary:
        "Prosecutors rested Monday, Aug. 24, closing a week of evidence that ran from the ambush itself to the tire left in the road, DNA, bank records and cellphone tracking. The defense case would follow the next day.",
      witnesses: [],
      sources: [
        { outlet: 'News4Jax', url: 'https://www.news4jax.com/news/local/2026/08/25/defense-to-call-witnesses-in-mario-fernandez-murder-trial-in-february-2022-ambush-shooting-of-jared-bridegan/' },
        { outlet: 'Action News Jax', url: 'https://www.actionnewsjax.com/news/local/murder-hire-trial-state-rests-case-final-witnesses-testify-watch-live/LBXHCQCM2VFWPLP2HMWAKODETU/' },
      ],
    },
    {
      day: 7,
      date: '2026-08-25',
      phase: 'closings',
      headline: 'Defense rests after a brief case; both sides give closings',
      summary:
        "The defense put on a short case Tuesday, Aug. 25 — two teachers from the school the Bridegan and Gardner children attended, speaking to the custody strain and Fernandez's role in the stepchildren's lives — then rested; Fernandez did not take the stand. In closing, Assistant State Attorney Christina Stifler urged the jury to \"find him guilty as charged,\" arguing Florida treats the person who hires a killing as it treats the shooter. Defense attorney Jesse Dreicer answered \"It did not happen. There was no evidence,\" pointing to the absence of DNA, fingerprints or surveillance tying Fernandez to the truck. On rebuttal, Assistant State Attorney Alan Mizrahi said circumstantial proof is expected in a murder-for-hire case: \"That's why you hire somebody else.\"",
      witnesses: [],
      sources: [
        { outlet: 'News4Jax', url: 'https://www.news4jax.com/news/local/2026/08/25/defense-to-call-witnesses-in-mario-fernandez-murder-trial-in-february-2022-ambush-shooting-of-jared-bridegan/' },
        { outlet: 'Action News Jax', url: 'https://www.actionnewsjax.com/news/local/murder-hire-trial-state-rests-case-final-witnesses-testify-watch-live/LBXHCQCM2VFWPLP2HMWAKODETU/' },
      ],
    },
    {
      day: 8,
      date: '2026-08-26',
      phase: 'verdict',
      headline: 'Jury convicts Fernandez on both counts',
      summary:
        "After Judge London Kite instructed the jury Wednesday morning, Aug. 26, the panel deliberated about three and a half hours — asking for an itemized evidence list and about trust language on \"benefits for Shanna if the legal entanglements with Jared were resolved\" — and returned its verdict about 1:20 p.m.: guilty of first-degree murder and guilty of solicitation to commit a capital felony. Fernandez is the first of three defendants to be tried in the 2022 killing of Jared Bridegan; sentencing has not yet been scheduled.",
      witnesses: [],
      sources: [
        { outlet: 'News4Jax', url: 'https://www.news4jax.com/news/local/2026/08/26/jury-to-begin-deliberations-in-mario-fernandez-murder-trial-in-february-2022-ambush-shooting-of-jared-bridegan/' },
        { outlet: 'East Idaho News', url: 'https://www.eastidahonews.com/2026/08/jurors-to-begin-deliberations-wednesday-in-mario-fernandez-saldanas-trial-for-the-murder-of-jared-bridegan/' },
      ],
    },
  ],
  'lil-durk-murder-for-hire': [
    {
      day: 1,
      date: '2026-08-24',
      phase: 'openings',
      headline: 'Opening statements: a bounty for revenge, or the wrong man',
      summary:
        "Opening statements opened the federal murder-for-hire trial of Durk Banks (\"Lil Durk\") in Los Angeles. Assistant U.S. Attorney Daniel Weiner told jurors Banks was \"consumed with revenge\" after the 2020 killing of his friend King Von and put a bounty on Atlanta rapper Quando Rondo (Tyquian Bowman); an August 2022 ambush near the Beverly Center killed Bowman's 24-year-old cousin, Saviay'a Robinson, while Bowman survived. Defense attorney Marissa Goldberg told jurors \"Mr. Banks had nothing to do with it,\" pointing to former assistant Kavon Grant — who has pleaded guilty and organized the trip — as the man behind the plot. Banks, 33, is tried alongside David Lindsey and Deondre Wilson.",
      witnesses: [],
      sources: [
        { outlet: 'ABC7 Los Angeles', url: 'https://abc7.com/post/opening-statements-begin-murder-hire-trial-alleging-lil-durk-put-bounty-life-quando-rondo/19729915/' },
        { outlet: 'TheGrio', url: 'https://thegrio.com/2026/08/25/lil-durk-murder-for-hire-trial-revenge-plot/' },
      ],
    },
  ],
};

let chipsSet = 0, daysAdded = 0;
const report = [];

for (const [slug, chip] of Object.entries(CHIPS)) {
  const p = path.join(CASES, slug, 'case.json');
  const c = readJSON(p);
  c.phase = chip.phase;
  c.statusNow = chip.statusNow;
  c.statusNowSources = chip.statusNowSources;
  writeJSON(p, c);
  chipsSet++;
  report.push(`chip: ${slug}`);
}

for (const [slug, entries] of Object.entries(DAYS)) {
  const p = path.join(CASES, slug, 'days.json');
  const d = readJSON(p);
  if (!Array.isArray(d.days)) d.days = [];
  const have = new Set(d.days.map(x => x.day));
  for (const e of entries) {
    if (have.has(e.day)) continue;
    d.days.push(e);
    have.add(e.day);
    daysAdded++;
    report.push(`day: ${slug} #${e.day} (${e.date})`);
  }
  d.days.sort((a, b) => a.day - b.day);
  writeJSON(p, d);
}

console.log(`[record-catchup 2026-08-26] chips set: ${chipsSet}, day entries added: ${daysAdded}`);
for (const r of report) console.log('  ' + r);
