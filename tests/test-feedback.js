// Fake accounts and REST responses only; no real Google or patient data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
let browser, count = 0;
const pass = s => { count++; console.log('PASS ' + s); };
(async () => {
  browser = await chromium.launch({executablePath:process.env.VHM_CHROMIUM || '/usr/bin/chromium',args:['--no-sandbox']});
  const page = await browser.newPage();
  let writes = [], queries = [], fail = false;
  const name = 'projects/fake-project/databases/(default)/documents/feedback/sample';
  const fields = {authorId:{stringValue:'user-one'},authorEmail:{stringValue:'user@example.test'},title:{stringValue:'<img src=x onerror=alert(1)>'},body:{stringValue:'가상 피드백'},category:{stringValue:'개선 제안'},status:{stringValue:'접수'},reply:{stringValue:''},createdAt:{timestampValue:'2026-11-15T00:00:00Z'},updatedAt:{timestampValue:'2026-11-15T00:00:00Z'}};
  await page.route('https://feedback.test/**', r => r.fulfill({contentType:'text/html',body:'<head></head><body><button data-tab="feedback">피드백</button><button data-tab="feedback-admin" hidden>피드백 관리</button><section id="tab-feedback"></section><section id="tab-feedback-admin"></section></body>'}));
  await page.route('https://identitytoolkit.googleapis.com/**', async r => {
    const body = r.request().postDataJSON();
    const admin = body.postBody.includes('admin-token');
    await r.fulfill({json:{idToken:admin?'firebase-admin':'firebase-user',localId:admin?'admin-one':'user-one',email:admin?'dltmdwo369@gmail.com':'user@example.test',expiresIn:'3600'}});
  });
  await page.route('https://firestore.googleapis.com/**', async r => {
    const url = r.request().url();
    if (url.includes('/feedbackAdmins/')) return r.fulfill({status:url.endsWith('/admin-one') ? 200 : 404,json:{}});
    const body = r.request().postDataJSON();
    if (url.endsWith(':runQuery')) { queries.push(body); return r.fulfill({json:[{document:{name,fields,updateTime:'2026-11-15T00:00:00Z'}}]}); }
    if (url.endsWith(':commit')) {
      writes.push(body);
      if (fail) return r.fulfill({status:503,json:{}});
      return r.fulfill({json:{writeResults:[{}]}});
    }
    throw new Error('Unexpected request: ' + url);
  });
  async function setup(admin, configured = true) {
    await page.goto('https://feedback.test/');
    await page.evaluate(({admin,configured}) => {
      window.VHM_CONFIG = {feedback:configured?{apiKey:'fake-key',projectId:'fake-project'}:{}};
      window.VHM_AUTH = {token:admin?'admin-token':'user-token',valid(){return !!this.token;}};
    }, {admin,configured});
    await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../src/feedback.js'),'utf8')});
    await page.evaluate(() => FEEDBACK.open(false));
  }
  await setup(false, false);
  assert(await page.locator('#fbForm [name="title"]').isDisabled());
  assert.match(await page.textContent('#tab-feedback'),/준비 중/); pass('unconfigured backend explicitly disables submission');
  await setup(false);
  assert(await page.locator('[data-tab="feedback-admin"]').isHidden());
  assert.equal(queries.at(-1).structuredQuery.where.fieldFilter.value.stringValue,'user-one');
  assert.equal(await page.locator('.fb-item img').count(),0); pass('user list queries own UID, hides admin controls and escapes HTML');
  await page.fill('[name="title"]','가상 오류'); await page.fill('[name="body"]','가상 동작 설명'); await page.check('[name="consent"]');
  await page.click('#fbForm button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('[role="status"]').textContent.includes('접수되었습니다'));
  const create = writes.at(-1).writes[0];
  assert.equal(create.update.fields.status.stringValue,'접수');
  assert.equal(create.update.fields.authorId.stringValue,'user-one');
  assert.deepEqual(create.currentDocument,{exists:false});
  assert.equal(create.updateTransforms[0].setToServerValue,'REQUEST_TIME');
  assert.deepEqual(Object.keys(create.update.fields).sort(),['authorEmail','authorId','body','category','reply','status','title']);
  pass('submission starts as 접수, writes only explicit feedback fields and uses server timestamps');
  fail = true;
  await page.fill('[name="title"]','재시도'); await page.fill('[name="body"]','가상 내용'); await page.check('[name="consent"]');
  await page.click('#fbForm button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('[role="status"]').textContent.includes('실패'));
  const failedName = writes.at(-1).writes[0].update.name;
  assert.equal(await page.inputValue('[name="body"]'),'가상 내용');
  await page.check('[name="consent"]'); await page.click('#fbForm button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('[role="status"]').textContent.includes('실패'));
  assert.equal(writes.at(-1).writes[0].update.name,failedName); pass('failed send retains draft and retries with the same document ID');
  fail = false;
  await page.evaluate(() => FEEDBACK.open(true));
  assert.match(await page.textContent('#tab-feedback-admin'),/관리자만/);
  assert.equal(await page.locator('[data-fb-item]').count(),0); pass('ordinary account cannot open management');
  await setup(true);
  assert(!(await page.locator('[data-tab="feedback-admin"]').isHidden()));
  await page.evaluate(() => FEEDBACK.open(true));
  assert.equal(queries.at(-1).structuredQuery.where,undefined);
  assert.equal(await page.locator('#fbForm').count(),0);
  for (const status of ['미해결','해결완료','접수']) {
    await page.selectOption('[data-fb-item] [name="status"]',status);
    await page.fill('[name="reply"]','가상 답변');
    await page.click('[data-fb-item] button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('[role="status"]').textContent.includes('저장했습니다'));
    const update = writes.at(-1).writes[0];
    assert.equal(update.update.fields.status.stringValue,status);
    assert.deepEqual(update.updateMask.fieldPaths,['status','reply']);
    assert(update.currentDocument.updateTime);
  }
  pass('admin sees all feedback and can save all three statuses with concurrency protection');
  await page.evaluate(() => {VHM_AUTH.token = null; FEEDBACK.signOut();});
  assert(await page.locator('[data-tab="feedback-admin"]').isHidden());
  assert.equal(await page.textContent('#tab-feedback-admin'),'');
  await page.evaluate(() => FEEDBACK.open(false));
  assert(await page.locator('#fbForm [name="title"]').isDisabled()); pass('sign-out clears private data and disables sending');
  await setup(false);
  await page.setViewportSize({width:320,height:740});
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)); pass('feedback fits 320px viewport');
  console.log('PASS feedback suite: ' + count + ' checks');
})().catch(e => {console.error(e);process.exitCode=1;}).finally(async () => {if(browser)await browser.close();});
