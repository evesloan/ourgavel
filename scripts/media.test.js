/* Rights tests for media discovery.
 * Run: node scripts/media.test.js
 *
 * These use the real shape of Wikimedia Commons `extmetadata` payloads. The Commons API is
 * unreachable from the build sandbox but reachable from GitHub Actions, where discovery
 * actually runs — so the licence logic is tested here against recorded payload shapes rather
 * than left to run unverified in production.
 *
 * A failure here means we might publish someone else's photograph. Treat it as blocking.
 */
const { licenceDecision, isOfficialHost } = require('./media.js');

let pass = 0, fail = 0;
const ok = (cond, label) => { cond ? pass++ : (fail++, console.log('  FAIL  ' + label)); };
const ext = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v }]));

console.log('\n--- Licences we MAY publish ---');
const allowed = [
  ['CC0', ext({ LicenseShortName: 'CC0', Artist: 'Jane Doe' }), 'public-domain'],
  ['Public domain', ext({ LicenseShortName: 'Public domain', Artist: 'US Government' }), 'public-domain'],
  ['PD-USGov', ext({ LicenseShortName: 'PD-USGov', Artist: 'FBI' }), 'public-domain'],
  ['CC BY 4.0', ext({ LicenseShortName: 'CC BY 4.0', LicenseUrl: 'https://creativecommons.org/licenses/by/4.0', Artist: '<a href="#">A Photographer</a>' }), 'cc-licensed'],
  ['CC BY-SA 3.0', ext({ LicenseShortName: 'CC BY-SA 3.0', LicenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0', Artist: 'Someone' }), 'cc-licensed'],
];
for (const [label, meta, wantRights] of allowed) {
  const d = licenceDecision(meta);
  ok(d.ok && d.rights === wantRights, 'should allow ' + label + ' (' + (d.reason || d.rights) + ')');
}

console.log('--- Licences we MUST refuse ---');
const refused = [
  ['non-free flag set', ext({ LicenseShortName: 'CC BY 4.0', LicenseUrl: 'https://x', NonFree: '1' })],
  ['fair use', ext({ LicenseShortName: 'Fair use' })],
  ['all rights reserved', ext({ LicenseShortName: 'All rights reserved' })],
  ['CC BY-NC (noncommercial)', ext({ LicenseShortName: 'CC BY-NC 4.0', LicenseUrl: 'https://x' })],
  ['CC BY-ND (no derivatives)', ext({ LicenseShortName: 'CC BY-ND 4.0', LicenseUrl: 'https://x' })],
  ['unknown', ext({ LicenseShortName: 'Unknown' })],
  ['no licence at all', ext({ Artist: 'Someone' })],
  ['empty metadata', {}],
  ['attribution licence with no licence URL', ext({ LicenseShortName: 'CC BY 4.0', Artist: 'X' })],
  ['agency copyright', ext({ LicenseShortName: 'Copyrighted, Associated Press' })],
];
for (const [label, meta] of refused) {
  const d = licenceDecision(meta);
  ok(!d.ok, 'should refuse ' + label + ' — it allowed it as ' + d.rights);
}

console.log('--- Attribution must survive ---');
const cc = licenceDecision(ext({ LicenseShortName: 'CC BY-SA 4.0', LicenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0', Artist: '<a href="/wiki/User:X">Photographer X</a>' }));
ok(cc.ok && cc.attribution === 'Photographer X', 'attribution should be captured and de-marked-up, got: ' + cc.attribution);
ok(cc.licenceUrl === 'https://creativecommons.org/licenses/by-sa/4.0', 'licence URL should be kept for CC compliance');

console.log('--- Official hosts are PROPOSED, never auto-published ---');
ok(isOfficialHost('https://www.mass.gov/doc/x'), 'mass.gov should read as official');
ok(isOfficialHost('https://pacer.uscourts.gov/x'), 'uscourts.gov should read as official');
ok(!isOfficialHost('https://apnews.com/photo.jpg'), 'a wire service must not read as official');
ok(!isOfficialHost('https://www.courttv.com/x.jpg'), 'a broadcaster must not read as official');
ok(!isOfficialHost('https://notgov.example.com/x'), 'a lookalike domain must not read as official');

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\n  MEDIA DISCOVERY MUST NOT SHIP WITH FAILING RIGHTS TESTS.\n'); process.exit(1); }
console.log('  Rights logic safe to ship.\n');
