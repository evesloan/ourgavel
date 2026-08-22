/* Regression test for the photo viewer.
 *
 * The operator hit a blocking bug: #lightbox{display:flex} overrode the [hidden] attribute,
 * so the viewer covered every case page on load with no way to close it. This proves both
 * halves stay fixed — it is closed on load, and it opens, navigates and closes by every
 * route once there is something to show.
 *
 * Needs a case with a hostable image. Build a throwaway fixture copy of the repo, serve
 * public/ on :8901, then run this. See review/dev-log for the fixture recipe.
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const URL = 'http://localhost:8901/cases/zz-lightbox/index.html';

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  let fail = 0;
  const check = (name, cond, extra) => { if (!cond) fail++; console.log('  ' + (cond ? 'ok  ' : 'FAIL') + '  ' + name + (extra ? ' — ' + extra : '')); };

  for (const [w, h, label, mob] of [[1280, 900, 'desktop', false], [390, 844, 'mobile', true]]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob });
    const errs = [];
    p.on('pageerror', e => errs.push(e.message.slice(0, 70)));
    await p.goto(URL);
    await p.waitForTimeout(700);
    console.log('\n  [' + label + ']');
    check('closed on load', !(await p.locator('#lightbox').isVisible()));

    await p.locator('.mcard[data-mi]').first().click();
    await p.waitForTimeout(300);
    check('opens on click', await p.locator('#lightbox').isVisible());
    const cap = await p.locator('#lbcap').innerText();
    const cred = await p.locator('#lbcredit').innerText();
    check('caption shown', cap.includes('Fixture image one'), cap);

    await p.locator('#lbnext').click();
    await p.waitForTimeout(250);
    const cred2 = await p.locator('#lbcredit').innerText();
    check('arrow advances and shows licence', cred2.includes('Creative Commons'), cred2);

    await p.keyboard.press('Escape');
    await p.waitForTimeout(250);
    check('Escape closes', !(await p.locator('#lightbox').isVisible()));

    await p.locator('.mcard[data-mi]').first().click();
    await p.waitForTimeout(250);
    await p.locator('#lbclose').click();
    await p.waitForTimeout(250);
    check('X closes', !(await p.locator('#lightbox').isVisible()));

    await p.locator('.mcard[data-mi]').first().click();
    await p.waitForTimeout(250);
    await p.mouse.click(6, 6);
    await p.waitForTimeout(250);
    check('click outside closes', !(await p.locator('#lightbox').isVisible()));

    check('page usable afterwards', await p.locator('nav.sitenav a').first().isVisible());
    check('no console errors', errs.length === 0, errs[0] || '');
    await p.close();
  }
  console.log('\n' + (fail ? '  ' + fail + ' FAILED' : '  viewer opens, navigates and closes by every route') + '\n');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
