#!/usr/bin/env node
/* Backfills the witness lists for Lindsay Clancy trial Days 5 and 9.
 *
 * Run: node scripts/record-clancy-5-9.js
 *
 * A SCRIPT, NOT A PATCH — deliberately. Several queued patches already sit on scripts/build.js
 * and scripts/poll.js, and a diff against data/cases/lindsay-clancy/days.json would have to be
 * ordered against them. This anchors on two short literals instead, so it applies before or
 * after anything else in the queue.
 *
 * Idempotent. Run it twice and the second run reports "already applied" and writes nothing.
 * It refuses loudly rather than guessing: if either anchor is missing or appears more than once,
 * if the slice between anchors does not parse, or if the parsed day is not the day expected,
 * it exits non-zero having written nothing at all.
 *
 * WHY: Day 5 (2026-08-03) carried "witnesses": [] and a summary describing "a psychiatrist who
 * treated Clancy" — the psychiatrists who testified that day were hospital consult psychiatrists
 * at Brigham and Women's, not her treating psychiatrist, who first testified on Day 9. Day 9
 * (2026-08-07) carried one witness stub reading "Testimony began; continued Day 10." Both days
 * are now itemised from the day-of reporting of three credentialed newsrooms each.
 *
 * The Day 5 source link was also wrong: the NBC Boston URL was missing its article id and does
 * not resolve. EDITORIAL.md §1 — no source, no sentence — means the link has to work.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'cases', 'lindsay-clancy', 'days.json');

// ---------------------------------------------------------------- the record

const DAY5 = {
  day: 5,
  date: '2026-08-03',
  phase: 'prosecution',
  headline: "The journals read aloud, and the hospitals' account of that night",
  summary:
    "Prosecutor Shanan Buckingham read excerpts from Clancy's journals aloud through Trooper Cory Melo, who seized them in the home search: 'I'm completely overwhelmed trying to take care of the three kids. I feel like I'm drowning every day.' Kevin Reddington read on from the same pages for the defense: 'I don't know what's wrong with me. I want help. I want to be well.' The rest of the day was the medical response: ER and ICU doctors from three hospitals, two Brigham nurses, two hospital psychiatrists who evaluated Clancy while she was intubated, and the troopers who took her blood and searched the house.",
  witnesses: [
    { name: 'Cory Melo', role: 'Mass. State Police', gist: "Seized Clancy's journals in the home search; excerpts were read aloud as he testified." },
    { name: 'Capt. John Santos', role: 'Mass. State Police', gist: 'Described executing the search warrant; laptops, exercise bands, a phone and notebooks were seized.' },
    { name: 'Sgt. Robert Flynn', role: 'Duxbury police', gist: "Described securing the scene and Duxbury's part in the search warrant." },
    { name: 'Det. Mark Farioli', role: 'Mass. State Police', gist: "Collected Clancy's blood and urine samples for the state lab." },
    { name: "Trooper Leah O'Connell", role: 'Mass. State Police crime lab', gist: 'Received the blood and urine vials taken from Clancy.' },
    { name: 'Sgt. Rose Stoffers', role: 'Mass. State Police, crime scene services', gist: "Photographed and documented Clancy's injuries at the hospital." },
    { name: 'Dr. Jhilam Biswas', role: "Forensic psychiatrist, Brigham and Women's", gist: "Evaluated Clancy while she was intubated; she wrote 'horrified' when asked about her mood. Testified she saw no signs of psychosis in that evaluation." },
    { name: 'Dr. Sejal Shah', role: "Psychiatrist, Brigham and Women's", gist: "Evaluated whether Clancy could change her health care proxy; described her mood as 'OK' and her thoughts as 'organized.'" },
    { name: 'Rachelle Amedee', role: "Nurse, Brigham and Women's trauma ICU", gist: 'Cared for Clancy after she arrived; documented episodes of delirium and visual hallucinations, and communication by whiteboard.' },
    { name: 'Meghan Collins', role: "ICU nurse, Brigham and Women's", gist: "Testified to Clancy's care and recovery in the intensive care unit." },
    { name: 'Dr. Kelly McDonough', role: 'ER physician, South Shore Hospital', gist: "CT of Clancy's head showed nothing remarkable; she was treated for a thoracic spine injury." },
    { name: 'Dr. Andrew Capraro', role: "ER physician, Boston Children's Hospital", gist: "Described Callan's condition on arrival, including swelling of the brain." },
    { name: 'Dr. David Casavant', role: "ICU physician, Boston Children's Hospital", gist: "Described 'an enormous amount of brain swelling' and no response to basic testing." },
    { name: 'Dr. Michael Snyder', role: 'Physician, Beth Israel Deaconess - Plymouth', gist: "Treated Cora, who 'was not breathing on her own when she arrived'; declared her dead after resuscitation failed." },
  ],
  sources: [
    { outlet: 'NBC Boston', url: 'https://www.nbcboston.com/news/local/lindsay-clancy-trial-day-5-live-stream-live-updates/3991196/' },
    { outlet: 'The Boston Globe', url: 'https://www.bostonglobe.com/2026/08/03/metro/lindsay-clancy-trial-testimony/' },
    { outlet: 'Boston 25 News', url: 'https://www.boston25news.com/news/local/lindsay-clancy-murder-trial-live-updates-week-2-testimony-begins-monday/YJ3MDQFKPBE33IVST7PXM4DUJQ/' },
    { outlet: 'Boston.com', url: 'https://www.boston.com/news/crime/2026/08/03/lindsay-clancy-murder-trial-livestream-video-monday-august-3/' },
  ],
};

const DAY9 = {
  day: 9,
  date: '2026-08-07',
  phase: 'prosecution',
  headline: 'Her psychiatrists testify; a hot mic and a warning from the bench',
  summary:
    "Two psychiatrists who treated Clancy testified: Jennifer Tufts, who saw her from September 2022, and Alia Goodheart, from the voluntary inpatient stay at McLean over New Year's. A family friend and the woman who ran the childcare room at the family's club also took the stand. Before the testimony, Kevin Reddington told the court a prosecutor had been caught on a hot mic saying 'shut her up' while Clancy sobbed during Thursday's autopsy testimony. Judge William Sullivan warned that anyone making inappropriate comments would be escorted out and barred from the rest of the trial.",
  witnesses: [
    { name: 'Dr. Jennifer Tufts', role: 'Psychiatrist, Aster Mental Health', gist: "Clancy's psychiatrist from September 2022; testified to the appointments and medication changes running to January 23, 2023, and to her reluctance to take medication. Testimony continued Day 10." },
    { name: 'Dr. Alia Goodheart', role: 'Psychiatrist, McLean Hospital', gist: "Treated Clancy during the January 1-5, 2023 voluntary admission; testified she reported feeling numb and sleeping badly, denied any plan to harm herself, named her children as reasons to live, and showed no signs of psychosis. 'I had no reason to believe that she was not a reliable reporter.'" },
    { name: 'Sarah Carney', role: 'Family friend', gist: "A college friend of Patrick Clancy; said Clancy looked thinner and more frail by late 2022 but was 'quiet, but fairly normal' at a bonfire two days before the killings." },
    { name: 'Kimberlee Hardy', role: 'Former child services director, Kingsbury Club, Kingston', gist: "Supervised the two older children in the club playroom; described Clancy as 'very shy' at drop-off and the family as careful about exposing the infant to illness." },
  ],
  sources: [
    { outlet: 'NBC Boston', url: 'https://www.nbcboston.com/news/local/lindsay-clancy-trial-day-9-live-stream-live-updates/3993819/' },
    { outlet: 'The Boston Globe', url: 'https://www.bostonglobe.com/2026/08/07/metro/lindsay-clancy-trial-live-updates/' },
    { outlet: 'Boston.com', url: 'https://www.boston.com/news/crime/2026/08/07/lindsay-clancy-murder-trial-livestream-video-friday-august-7/' },
  ],
};

// ------------------------------------------------------- formatting (house style)
// days.json is hand-formatted: one line for the head, one for the summary, one line per
// witness, one for the sources. JSON.stringify on the whole file would reformat 144 lines and
// collide with anyone else touching it. So the block is rendered by hand, in the house style.

function renderDay(d) {
  const head = `    {"day": ${d.day}, "date": ${JSON.stringify(d.date)}, "phase": ${JSON.stringify(d.phase)}, "headline": ${JSON.stringify(d.headline)},`;
  const summary = `     "summary": ${JSON.stringify(d.summary)},`;
  const w1 = w => `{"name": ${JSON.stringify(w.name)}, "role": ${JSON.stringify(w.role)}, "gist": ${JSON.stringify(w.gist)}}`;
  const s1 = s => `{"outlet": ${JSON.stringify(s.outlet)}, "url": ${JSON.stringify(s.url)}}`;
  const ws = d.witnesses.map(w => `       ${w1(w)}`);
  const witnesses = `     "witnesses": [\n${ws.join(',\n')}],`;
  const sources = `     "sources": [${d.sources.map(s1).join(', ')}]},`;
  return [head, summary, witnesses, sources].join('\n') + '\n';
}

// ------------------------------------------------------------------- the apply

const die = m => { console.error('  REFUSED: ' + m + '\n  Nothing was written.'); process.exit(1); };

const raw = fs.readFileSync(FILE, 'utf8');
let before;
try { before = JSON.parse(raw); } catch (e) { die('days.json does not parse before we touch it: ' + e.message); }

function locate(dayNo, nextDayNo, nextDate, thisDate) {
  const a = `    {"day": ${dayNo}, "date": ${JSON.stringify(thisDate)},`;
  const b = `    {"day": ${nextDayNo}, "date": ${JSON.stringify(nextDate)},`;
  const na = raw.split(a).length - 1;
  const nb = raw.split(b).length - 1;
  if (na !== 1) die(`anchor for day ${dayNo} appears ${na} time(s), expected exactly 1`);
  if (nb !== 1) die(`anchor for day ${nextDayNo} appears ${nb} time(s), expected exactly 1`);
  const start = raw.indexOf(a);
  const end = raw.indexOf(b);
  if (end <= start) die(`day ${nextDayNo} appears before day ${dayNo} in the file`);
  let slice = raw.slice(start, end).trimEnd();
  if (slice.endsWith(',')) slice = slice.slice(0, -1);
  let parsed;
  try { parsed = JSON.parse(slice); } catch (e) { die(`the day ${dayNo} block does not parse: ${e.message}`); }
  if (parsed.day !== dayNo) die(`the block at the day ${dayNo} anchor reports day ${parsed.day}`);
  return { start, end, parsed };
}

const l5 = locate(5, 6, '2026-08-04', '2026-08-03');
const l9 = locate(9, 10, '2026-08-10', '2026-08-07');

const done5 = l5.parsed.witnesses.length >= DAY5.witnesses.length;
const done9 = l9.parsed.witnesses.length >= DAY9.witnesses.length;
if (done5 && done9) {
  console.log('  Already applied — Day 5 has ' + l5.parsed.witnesses.length + ' witnesses, Day 9 has ' + l9.parsed.witnesses.length + '. Nothing written.');
  process.exit(0);
}

// Splice the later block first so the earlier offsets stay valid.
let out = raw.slice(0, l9.start) + renderDay(DAY9) + raw.slice(l9.end);
out = out.slice(0, l5.start) + renderDay(DAY5) + out.slice(l5.end);

let after;
try { after = JSON.parse(out); } catch (e) { die('the rewritten file does not parse: ' + e.message); }

// The only thing that may have changed is days 5 and 9.
if (after.days.length !== before.days.length) die('day count changed');
for (let i = 0; i < before.days.length; i++) {
  const d = before.days[i], n = after.days[i];
  if (d.day !== n.day) die('day numbering changed at index ' + i);
  if (d.day !== 5 && d.day !== 9 && JSON.stringify(d) !== JSON.stringify(n)) die('day ' + d.day + ' changed and should not have');
}
if (JSON.stringify(before.pretrial) !== JSON.stringify(after.pretrial)) die('the pretrial timeline changed');
if (before.note !== after.note) die('the day-numbering note changed');
for (const d of [after.days.find(x => x.day === 5), after.days.find(x => x.day === 9)]) {
  if (!d.witnesses.length) die('day ' + d.day + ' came out with no witnesses');
  if (d.sources.length < 2) die('day ' + d.day + ' came out with fewer than 2 sources');
  for (const w of d.witnesses) if (!w.name || !w.role || !w.gist) die('a day ' + d.day + ' witness is missing a field');
  for (const s of d.sources) if (!s.outlet || !/^https:\/\//.test(s.url)) die('a day ' + d.day + ' source is not a named outlet with an https URL');
}

fs.writeFileSync(FILE, out);
console.log('  Day 5: ' + l5.parsed.witnesses.length + ' witnesses -> ' + DAY5.witnesses.length + ', ' + l5.parsed.sources.length + ' sources -> ' + DAY5.sources.length);
console.log('  Day 9: ' + l9.parsed.witnesses.length + ' witnesses -> ' + DAY9.witnesses.length + ', ' + l9.parsed.sources.length + ' sources -> ' + DAY9.sources.length);
console.log('  Written. Run `node scripts/build.js` next.');
