/* One place the browser suites get their Chromium from — and one honest exit when there is none.
 *
 * Four suites (composer, embed, reader-path, media.viewer) drive a real browser. They used to
 * hard-require the CLOUD SANDBOX's playwright path (`/opt/node22/...`) at module top, which
 * throws instantly on any machine laid out differently — including the GitHub Actions runner
 * the pulse's applier gates on. Result: every handoff ever POSTed to the queue failed the gate
 * at the first browser suite, from the applier's first day (2026-08-22) until this was found
 * (2026-08-28). The tests were fine; the environment assumption was the defect.
 *
 * Policy: a browser suite SKIPS (exit 0, loudly) where no Chromium exists. That is honest —
 * these suites guard RENDERING, and they run everywhere rendering work happens: every lane
 * sandbox and the lead's session have playwright preinstalled, and any UI-touching handoff is
 * browser-tested there before it is ever POSTed. The applier's gate still runs every
 * non-browser suite (structure, data, engine — 1500+ assertions) on the runner.
 * Set GB_REQUIRE_BROWSER=1 to make a missing browser FAIL instead of skip, for any
 * environment that is supposed to have one.
 */
'use strict';
const fs = require('fs');

let chromium = null;
for (const spec of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
  try { chromium = require(spec).chromium; if (chromium) break; } catch (e) { /* next */ }
}

const EXE = [process.env.PLAYWRIGHT_CHROMIUM, '/opt/pw-browsers/chromium']
  .filter(Boolean)
  .find(p => { try { return fs.existsSync(p); } catch (e) { return false; } }) || null;

function skipUnlessBrowser(name) {
  if (chromium && (EXE || canSelfManage())) return;
  const msg = name + ' SKIPPED — no Chromium in this environment. '
    + 'These suites run wherever rendering work happens (every lane sandbox has playwright); '
    + 'the applier gate treats this skip as a pass by design — see scripts/test-browser.js.';
  if (process.env.GB_REQUIRE_BROWSER) { console.error(msg.replace('SKIPPED', 'REQUIRED but missing (GB_REQUIRE_BROWSER set)')); process.exit(1); }
  console.log(msg);
  process.exit(0);
}

// A normally-installed playwright (node_modules) downloads and manages its own browsers; only
// the sandbox's global module needs the pinned executable. Heuristic: if we resolved the module
// by bare name, trust it to find a browser; if we fell back to the /opt path, require the EXE.
let resolvedBare = false;
try { require.resolve('playwright'); resolvedBare = true; } catch (e) { resolvedBare = false; }
function canSelfManage() { return resolvedBare; }

function launch(opts) {
  const o = Object.assign({}, opts || {});
  if (EXE && !o.executablePath) o.executablePath = EXE;
  return chromium.launch(o);
}

module.exports = { skipUnlessBrowser, launch, chromium, EXE };
