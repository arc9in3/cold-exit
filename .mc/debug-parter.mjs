import pw from 'file:///C:/work/mission-control/node_modules/playwright/index.js';
const { chromium } = pw;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1024 } });
page.on('pageerror', e => console.log('[err]', e.message));

await page.goto('http://localhost:8080/tools/rig_tuner.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// Sample 1: read initial chestTopR
const before = await page.evaluate(() => window.__state.dims.torso.chestTopR);
console.log('chestTopR before:', before);

// Sample 2: directly set state.parter.scaleX and check if controllers respond
//          AND look at how lil-gui's controllers are wired.
const probe = await page.evaluate(() => {
  // Find the part scaler controllers
  const all = Array.from(document.querySelectorAll('.lil-gui .controller'));
  const scaleXctrl = all.find(c => c.textContent.includes('scale X'));
  if (!scaleXctrl) return { found: false };
  const input = scaleXctrl.querySelector('input');
  const inputType = input ? input.type : 'no-input';
  const inputClass = input ? input.className : '';
  const inputValue = input ? input.value : '';
  return {
    found: true,
    inputType,
    inputClass,
    inputValue,
    parentClass: scaleXctrl.className,
  };
});
console.log('scaleX controller probe:', JSON.stringify(probe, null, 2));

// Sample 3: try typing into the input via Playwright's keyboard
await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('.lil-gui .controller'));
  const scaleXctrl = all.find(c => c.textContent.includes('scale X'));
  const input = scaleXctrl?.querySelector('input');
  if (input) {
    input.focus();
    input.value = '1.5';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
});
await page.waitForTimeout(800);

const afterChange = await page.evaluate(() => window.__state.dims.torso.chestTopR);
console.log('chestTopR after change event:', afterChange);

// Sample 4: programmatically call applyPartAxis to verify the fn itself works
const applyResult = await page.evaluate(() => {
  // applyPartAxis is in module scope, not on window. Try to invoke via the
  // controller's setValue instead.
  const all = Array.from(document.querySelectorAll('.lil-gui .controller'));
  const scaleXctrl = all.find(c => c.textContent.includes('scale X'));
  // lil-gui stores the controller object on .__controller maybe? Or via DOM
  // walk. Let's just trigger an input event with a different value.
  const input = scaleXctrl?.querySelector('input');
  if (input) {
    input.focus();
    input.value = '2.0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();
  }
  return { triggered: true };
});
await page.waitForTimeout(500);
const afterBlur = await page.evaluate(() => window.__state.dims.torso.chestTopR);
console.log('chestTopR after input+change+blur events:', afterBlur);

await browser.close();
