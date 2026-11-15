const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {chromium} = require('playwright');
let browser;
(async()=>{
  browser = await chromium.launch({executablePath:process.env.VHM_CHROMIUM || '/usr/bin/chromium',args:['--no-sandbox']});
  const page = await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://features.test/**',r=>r.fulfill({contentType:r.request().url().endsWith('config.js')?'text/javascript':'text/html',body:r.request().url().endsWith('config.js')?'window.VHM_CONFIG={clientId:"fake-client"};':fs.readFileSync(path.join(__dirname,'../site/index.html'),'utf8')}));
  await page.goto('https://features.test/');await page.click('[data-tab="set"]');
  assert.equal(await page.locator('[role="switch"]').count(),6);
  await page.evaluate(()=>localStorage.setItem('vhm-settings',JSON.stringify({defaultReminder:30})));
  for(const id of ['cal','note','link','box','edu','feedback']){
    await page.locator('[data-feature="'+id+'"]').uncheck();
    assert(await page.locator('[data-tab="'+id+'"]').isHidden());
  }
  assert(await page.locator('[data-tab="set"]').isVisible());
  await page.evaluate(()=>showTab('cal'));
  assert(await page.locator('#tab-set').isVisible());
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('vhm-settings')).defaultReminder),30);
  console.log('PASS all six features can be disabled; settings stays reachable and data is preserved');
  await page.reload();assert(await page.locator('#tab-set').isVisible());
  assert.equal(await page.locator('[data-feature]:checked').count(),0);
  await page.locator('[data-feature="note"]').focus();await page.keyboard.press('Space');
  assert(await page.locator('[data-tab="note"]').isVisible());
  await page.click('[data-tab="note"]');assert(await page.locator('#tab-note').isVisible());
  console.log('PASS toggles survive reload and support keyboard re-enabling');
  await page.evaluate(()=>FEATURES.setAccount('alice@example.test'));await page.click('[data-tab="set"]');
  assert.equal(await page.locator('[data-feature]:checked').count(),6);
  await page.locator('[data-feature="cal"]').uncheck();
  await page.evaluate(()=>FEATURES.setAccount('bob@example.test'));
  assert(await page.locator('[data-feature="cal"]').isChecked());
  await page.evaluate(()=>FEATURES.setAccount('alice@example.test'));
  assert(!(await page.locator('[data-feature="cal"]').isChecked()));
  console.log('PASS Google account feature preferences are isolated');
  await page.evaluate(()=>VHM_AUTH.signOut());
  assert(await page.locator('[data-feature="note"]').isChecked());
  assert(!(await page.locator('[data-feature="cal"]').isChecked()));
  await page.evaluate(()=>{window.requestKind='';VHM_AUTH.request=kind=>{window.requestKind=kind;return Promise.resolve();};});
  await page.click('#featuresConnect');assert.equal(await page.evaluate(()=>window.requestKind),'base');
  console.log('PASS sign-out restores guest settings and Google connection works with calendar hidden');
  await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('blocked');};});
  await page.locator('[data-feature="cal"]').click();
  assert(!(await page.locator('[data-feature="cal"]').isChecked()));
  assert.match(await page.textContent('#featureNotice'),/저장할 수 없습니다/);
  console.log('PASS storage failure is reported and the toggle is reverted');
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  assert.deepEqual(errors,[]);console.log('PASS settings fit mobile and desktop without script errors');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();});
