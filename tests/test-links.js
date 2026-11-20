// 연계 안내 탭 테스트: 가짜 GIS + 가짜 Calendar + 가짜 Drive
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const { A: AUTH, install: installAuth, connectVia } = require('./fake-auth.js');
const SITE = require('path').join(__dirname, '..', 'site');
const R = []; const check = (n, ok, info = '') => R.push(`${ok ? 'PASS' : 'FAIL'} ${n}${info ? ' — ' + info : ''}`);
let seq = 0; const nid = p => p + (++seq).toString(36);
const G = { cals: [{ id: 'me@example.com', summary: 'me@example.com', primary: true, accessRole: 'owner' }], events: { 'me@example.com': [] }, files: [], grantDrive: true, log: [], conflictOnPatch:false, omitEtag:false };
function nowIso() { return new Date(Date.now() + seq * 1000).toISOString(); }
function parseMultipart(buf, ctype) {
  const b = /boundary=([^;]+)/.exec(ctype)[1]; const s = buf.toString('binary'); const parts = s.split('--' + b).slice(1, -1);
  const out = parts.map(p => { const i = p.indexOf('\r\n\r\n'); return p.slice(i + 4, p.length - 2); });
  return { meta: JSON.parse(Buffer.from(out[0], 'binary').toString('utf8')), content: Buffer.from(out[1], 'binary') };
}
function api(method, url, headers, buf) {
  const u = new URL(url); const p = u.pathname; G.log.push(method + ' ' + p + (u.searchParams.get('uploadType') ? '?' + u.searchParams.get('uploadType') : ''));
  if (!(headers['authorization'] || '').startsWith('Bearer tok')) return [401, { error: { message: 'no auth' } }];
  const json = () => JSON.parse(buf.toString('utf8'));
  // Calendar (최소)
  if (p === '/calendar/v3/users/me/calendarList') return [200, { items: G.cals }];
  if (method === 'POST' && p === '/calendar/v3/calendars') { const c = { id: nid('cal') + '@group', summary: json().summary, accessRole: 'owner' }; G.cals.push(c); G.events[c.id] = []; return [200, c]; }
  let m;
  if ((m = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(p))) { const cid = decodeURIComponent(m[1]);
    if (method === 'GET') return [200, { items: G.events[cid] || [] }];
    const ev = Object.assign({ id: nid('ev'), etag: '"' + seq + '"', status: 'confirmed' }, json()); G.events[cid].push(ev); return [200, ev]; }
  // Drive
  if(p==='/drive/v3/about')return [200,{user:{emailAddress:'large-drive@example.test'},storageQuota:{}}];
  if (p === '/drive/v3/files' && method === 'GET') {
    const q = u.searchParams.get('q'); const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)[1].replace(/\\'/g, "'"); const mime = (/mimeType = '([^']+)'/.exec(q) || [])[1]; const par = (/'([^']+)' in parents/.exec(q) || [])[1];
    return [200, { files: G.files.filter(f => !f.trashed && f.name === name && (!mime || f.mimeType === mime) && (!par || f.parents.includes(par))).map(f => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, mimeType: f.mimeType })) }];
  }
  if (p === '/drive/v3/files' && method === 'POST') { const md = json(); const f = { id: nid('f'), name: md.name, mimeType: md.mimeType, parents: md.parents || [], modifiedTime: nowIso(), content: Buffer.alloc(0) }; G.files.push(f); return [200, { id: f.id }]; }
  if (p === '/upload/drive/v3/files' && method === 'POST') { if (G.failUpload) { G.failUpload=false; return [503,{error:{message:'mock upload failed'}}]; } const mp = parseMultipart(buf, headers['content-type']);
    const f = { id: nid('f'), name: mp.meta.name, mimeType: mp.meta.mimeType || 'application/octet-stream', parents: mp.meta.parents || [], modifiedTime: nowIso(), content: mp.content }; G.files.push(f);
    return [200, { id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, webViewLink: 'https://drive.google.com/file/d/' + f.id + '/view' }]; }
  if ((m = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(p)) && method === 'PATCH') { const f = G.files.find(x => x.id === m[1]); if (f.name === 'vhm-links.json' && G.conflictOnPatch) { G.conflictOnPatch = false; f.modifiedTime = 'race-' + (++seq); return [412, {error:{message:'revision changed'}}]; } if (f.name === 'vhm-links.json' && headers['if-match'] !== '"' + f.modifiedTime + '"') return [412,{error:{message:'etag mismatch'}}]; f.content = buf; f.modifiedTime = nowIso(); return [200, { id: f.id, modifiedTime: f.modifiedTime }]; }
  if ((m = /^\/drive\/v3\/files\/([^/]+)$/.exec(p))) { const f = G.files.find(x => x.id === m[1]); if (!f) return [404, { error: { message: 'nf' } }];
    if (method === 'GET' && u.searchParams.get('alt') === 'media') return [200, f.content, f.mimeType];
    if (method === 'GET') return [200, { modifiedTime: f.modifiedTime, trashed: !!f.trashed }];
    if (method === 'PATCH') { Object.assign(f, json()); return [200, { id: f.id }]; } }
  return [400, { error: { message: 'unknown ' + method + ' ' + p } }];
}
const server = http.createServer((req, res) => {
  const f = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
  if (f === '/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end("window.VHM_CONFIG={clientId:'t.apps.googleusercontent.com'};"); }
  const fp = path.join(SITE, decodeURIComponent(f)); if (!fs.existsSync(fp)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); fs.createReadStream(fp).pipe(res);
});
(async () => {
  await new Promise(r => server.listen(0, r)); const BASE = 'http://localhost:' + server.address().port + '/';
  const b = await chromium.launch({ executablePath: process.env.VHM_CHROMIUM || '/usr/bin/chromium' });
  async function newPage(drive = true) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage(); page.errors = []; page.on('pageerror', e => page.errors.push(e.message)); page.on('dialog', d => d.accept());
    AUTH.driveOk = drive; AUTH.granted.clear(); AUTH.log = []; await installAuth(page);
    await page.route('https://www.googleapis.com/**', async r => { const q = r.request(); const [st, js, ct] = api(q.method(), q.url(), q.headers(), q.postDataBuffer() || Buffer.alloc(0));
      const match = /\/drive\/v3\/files\/([^/?]+)/.exec(q.url()); const file = match && G.files.find(f => f.id === match[1]);
      await r.fulfill({ status: st, headers: file && !G.omitEtag ? {etag:'"' + file.modifiedTime + '"','access-control-expose-headers':'etag'} : {}, contentType: ct || 'application/json', body: Buffer.isBuffer(js) ? js : (js == null ? '' : JSON.stringify(js)) }); });
    await page.goto(BASE); await connectVia(page, '#btnConnect'); await page.waitForSelector('#connectBox[hidden]', { state: 'attached' });
    await page.evaluate(()=>VHM_AUTH.setDriveTarget('large-drive@example.test'));
    return page;
  }
  const idle = p => p.waitForFunction(() => !document.querySelector('#sync .spin'), null, { timeout: 10000 });
  async function selectNeed(p, label) {
    const input = p.locator('#tab-link').getByRole('checkbox',{name:label,exact:true,includeHidden:true});
    await input.evaluate(el => { const d = el.closest('details'); if (d && !d.open) d.querySelector('summary').click(); });
    await input.check();
  }
  async function openLinks(p) { await p.click('[data-tab="link"]'); await p.waitForSelector('#lkDrive'); await connectVia(p, '#lkDrive'); await p.waitForSelector('.lk-bar'); await idle(p); }

  // 0. 드라이브 권한 없이 연결
  let page = await newPage(false); await idle(page);
  const req0 = AUTH.log.map(x => x.scope);
  check('일정 로그인은 캘린더 권한만 요청', req0.length === 1 && req0[0] === 'https://www.googleapis.com/auth/calendar', JSON.stringify(req0));
  await page.click('[data-tab="link"]'); await page.waitForSelector('#lkDrive');
  await connectVia(page, '#lkDrive'); await page.waitForFunction(() => /드라이브 권한이 허용되지/.test(document.body.textContent)); await page.waitForSelector('#lkDrive');
  const dbg0 = [!!(await page.$('#lkDrive')), await page.$eval('#connectBox', x => x.hidden), await page.textContent('#sync')];
  check('드라이브 거부해도 일정은 정상, 연계 탭에 ‘드라이브 연결’ 버튼', dbg0[0] && dbg0[1] && /구글 캘린더/.test(dbg0[2]), JSON.stringify(dbg0));
  await page.context().close();

  // 1. 처음 사용: 폴더·목록 파일 생성, 기본 항목 + 임시 표시
  page = await newPage(true); await idle(page);
  await openLinks(page);
  const prompts = AUTH.log.map(x => x.prompt), reqs = AUTH.log.map(x => x.scope);
  const folder = G.files.find(f => f.mimeType === 'application/vnd.google-apps.folder'), listFile = G.files.find(f => f.name === 'vhm-links.json');
  const onLinkTab = await page.$eval('#tab-link', x => !x.hidden);
  check('드라이브는 따로 요청 (드라이브 권한만, 처음엔 동의 화면) → 돌아오면 연계 탭', reqs[1] === 'https://www.googleapis.com/auth/drive.file' && prompts.join() === 'consent,select_account consent' && onLinkTab, JSON.stringify(reqs) + JSON.stringify(prompts));
  check('열람만으로 개인 Drive 폴더·목록 파일을 생성하지 않음', !folder && !listFile && !G.log.some(x => x.startsWith('POST /drive') || x.startsWith('POST /upload')));
  const nChips = await page.$$eval('.lk-chip input[data-need]', x => x.length);
  check('기본 요구 항목 표시 + ‘임시 기본값’ 안내', nChips >= 25 && /임시 기본값/.test(await page.textContent('#tab-link')), String(nChips));

  // 2. 서비스 추가 (양식 파일 + 링크)
  await page.click('[data-lkview="list"]'); await page.click('#lkAdd'); await page.waitForSelector('#svcDlg[open]');
  await page.fill('#svcForm [name=name]', '가상 노인맞춤돌봄'); await page.fill('#svcForm [name=org]', '가상 복지관');
  await page.selectOption('#svcForm [name=field]', '돌봄');
  for (const l of ['독거', '사회적 고립', '일상생활 도움 필요']) await page.click(`#svcForm .lk-chip:has-text("${l}")`);
  await page.fill('#svcForm [name=conditions]', '65세 이상 (가상)'); await page.fill('#svcForm [name=contact]', '000-0000 (가상)');
  fs.writeFileSync(path.join(__dirname, 'referral-form.txt'), '가상 의뢰서 양식');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#svcAddFile')]); await fc.setFiles(path.join(__dirname, 'referral-form.txt')); await idle(page);
  await page.waitForFunction(() => document.querySelector('#svcForms').textContent.includes('referral-form'));
  await page.fill('#svcLinkName', '신청 안내'); await page.fill('#svcLinkUrl', 'https://example.org/apply'); await page.click('#svcAddLink');
  await page.click('#svcSave'); await idle(page); await page.waitForSelector('#svcDlg:not([open])', { state: 'attached' });
  const saved = JSON.parse(G.files.find(f => f.name === 'vhm-links.json').content.toString('utf8'));
  const svc = saved.services[0]; const upFile = G.files.find(f => f.name === 'referral-form.txt');
  check('서비스 저장 → 드라이브 목록 파일에 기록', saved.services.length === 1 && svc.name === '가상 노인맞춤돌봄' && svc.needs.length === 3 && svc.field === '돌봄');
  check('양식 파일은 같은 폴더에 업로드, 링크도 저장', upFile && upFile.parents[0] === G.files.find(f => f.mimeType === 'application/vnd.google-apps.folder').id && upFile.content.toString() === '가상 의뢰서 양식' && svc.forms.length === 2 && svc.forms[1].url === 'https://example.org/apply');

  // 3. 엑셀 붙여넣기 가져오기
  await page.click('[data-lkview="io"]');
  const tsv = '서비스명\t기관\t분야\t해당 요구\t대상 조건\t연락처\t신청 방법\t필요 서류\t양식 링크\t메모\n'
    + '가상 치매안심센터 검진\t가상 치매안심센터\t보건의료\t인지 저하·치매 의심\t60세 이상\t111\t전화 예약\t신분증\thttps://example.org/dem\t\n'
    + '가상 주거개선 사업\t가상 구청\t주거·안전\t주거환경 불량(위생·수리), 독거\t저소득\t222\t방문\t\t\t"여러 줄\n메모"\n'
    + '가상 우울 상담\t가상 정신건강센터\t정신건강\t우울감·정서 지원 필요, 새요구테스트\t\t333\t\t\t\t\n'
    + '가상 노인맞춤돌봄\t가상 복지관\t돌봄\t독거\t\t\t\t\t\t\n';
  await page.fill('#lkPaste', tsv); await page.click('#lkPreview');
  const pm = await page.textContent('#lkPrevMsg');
  await page.click('#lkImport'); await idle(page);
  const saved2 = JSON.parse(G.files.find(f => f.name === 'vhm-links.json').content.toString('utf8'));
  const etc = saved2.categories.find(c => c.name === '기타');
  const house = saved2.services.find(s => s.name === '가상 주거개선 사업');
  check('엑셀 붙여넣기: 3건 추가, 중복 1건 제외, 새 요구는 ‘기타’에', saved2.services.length === 4 && /새 서비스 3건/.test(pm) && /이미 있는 1건/.test(pm) && etc && etc.items[0].label === '새요구테스트', pm);
  check('따옴표 안 여러 줄 메모·쉼표 구분 요구 처리', house.memo === '여러 줄\n메모' && house.needs.length === 2);

  // 4. 요구 체크 → 추천 순서
  await page.click('[data-lkview="match"]');
  for (const l of ['독거', '사회적 고립', '주거환경 불량(위생·수리)']) await selectNeed(page,l);
  const order = await page.$$eval('.lk-svc', x => x.map(e => e.querySelector('.lk-name').textContent + ':' + e.querySelector('.lk-score').textContent));
  check('많이 해당하는 순서로 추천', order.join(',') === '가상 노인맞춤돌봄:2개 해당,가상 주거개선 사업:2개 해당' || order[0].includes('2개'), order.join(', '));
  check('연계 전 확인(제3자 제공 동의) 안내 표시', /개인정보 제3자 제공 동의/.test(await page.textContent('#tab-link')));
  const ls = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
  const before = G.log.filter(x => x.startsWith('PATCH /upload')).length;
  check('요구 체크는 저장되지 않음 (브라우저·드라이브 모두)', !/독거/.test(ls) && G.log.filter(x => x.startsWith('PATCH /upload')).length === before);

  // 5. 양식 내려받기
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.lk-svc [data-dl]')]);
  const dpath = path.join(__dirname, 'dl.txt'); await dl.saveAs(dpath);
  check('양식 내려받기 (드라이브 API 경유)', fs.readFileSync(dpath, 'utf8') === '가상 의뢰서 양식' && dl.suggestedFilename() === 'referral-form.txt', dl.suggestedFilename());

  // 6. 연계 일정 등록 → 일정 탭에 ‘연계’ 일정 작성창
  await page.click('.lk-svc:has-text("가상 노인맞춤돌봄") [data-sched]'); await page.waitForSelector('#eventDlg[open]');
  const ty = await page.inputValue('#eventForm select[name=type]'), memo = await page.inputValue('#eventForm textarea[name=memo]');
  check('연계 일정 등록 → 유형 ‘연계’, 메모에 서비스명', ty === '연계' && /연계: 가상/.test(memo), ty + ' / ' + memo);
  await page.click('#eventDlg [data-close]');

  // 7. 요구 항목 편집 (이름 바꾸기·삭제·추가) + 확인 완료
  await page.click('[data-tab="link"]'); await page.click('[data-lkview="needs"]');
  await page.fill('.lk-itemname >> nth=0', '만성질환 관리(수정)');
  await page.click('[data-additem="0"]'); await page.fill('.lk-itemname >> nth=0', '만성질환 관리(수정)');
  const delBtn = await page.$('[data-delitem]'); await page.click('#lkSaveNeeds'); await idle(page);
  await page.click('#lkConfirmDefaults'); await idle(page);
  const saved3 = JSON.parse(G.files.find(f => f.name === 'vhm-links.json').content.toString('utf8'));
  check('요구 항목 이름 수정·추가 저장, 임시 표시 해제', saved3.categories[0].items[0].label === '만성질환 관리(수정)' && saved3.categories[0].items.some(i => i.label === '새 항목') && saved3.defaultsPending === false);
  // 지정된 항목 삭제 → 서비스에서도 빠짐
  const dokgeoIdx = await page.evaluate(() => { const c = LINKS._state.data.categories; for (let ci = 0; ci < c.length; ci++) for (let ii = 0; ii < c[ci].items.length; ii++) if (c[ci].items[ii].label === '독거') return ci + ':' + ii; });
  await page.click(`[data-delitem="${dokgeoIdx}"]`); await page.click('#lkSaveNeeds'); await idle(page);
  const saved4 = JSON.parse(G.files.find(f => f.name === 'vhm-links.json').content.toString('utf8'));
  const allNeedIds = new Set(saved4.categories.flatMap(c => c.items.map(i => i.id)));
  check('항목 삭제 시 서비스 지정에서도 제거', saved4.services.every(s => s.needs.every(n => allNeedIds.has(n))) && !saved4.categories.some(c => c.items.some(i => i.label === '독거')));

  // 8. 다른 기기에서 수정 → 충돌 안내
  const lf = G.files.find(f => f.name === 'vhm-links.json'); lf.modifiedTime = new Date(Date.now() + 99e6).toISOString();
  await page.click('[data-lkview="list"]'); await page.click('[data-edit] >> nth=0'); await page.waitForSelector('#svcDlg[open]');
  await page.fill('#svcForm [name=memo]', '충돌 테스트'); await page.click('#svcSave');
  await page.waitForSelector('#chooseDlg[open]'); const ctext = await page.textContent('#chooseBody');
  await page.click('#chooseBtns button:has-text("다시 불러오기")'); await idle(page);
  check('다른 기기 수정 감지 → 다시 불러오기 (덮어쓰지 않음)', /다른 기기/.test(ctext) && !JSON.parse(lf.content.toString('utf8')).services.some(s => s.memo === '충돌 테스트'));
  await page.evaluate(() => document.querySelector('#svcDlg').open && document.querySelector('#svcDlg').close());

  // 9. 다른 기기(새 브라우저)에서 같은 목록
  const p2 = await newPage(true); await idle(p2); await openLinks(p2);
  const n2 = await p2.evaluate(() => LINKS._state.data.services.length);
  check('다른 기기에서 열어도 같은 목록 (드라이브 공유)', n2 === 4 && G.files.filter(f => f.name === 'vhm-links.json').length === 1, String(n2));
  await page.screenshot({ path: path.join(__dirname, 'lk-list.png'), fullPage: true });
  await p2.click('[data-lkview="match"]');
  for (const l of ['사회적 고립', '우울감·정서 지원 필요', '인지 저하·치매 의심']) await selectNeed(p2,l);
  await p2.screenshot({ path: path.join(__dirname, 'lk-match.png'), fullPage: true });
  // 상담 메모 틀: 드라이브 연결된 기기에서 고치면 다른 기기에도
  await page.click('[data-tab="note"]'); await page.waitForSelector('#ntOut'); await page.waitForFunction(() => /구글 드라이브와/.test(document.querySelector('#tab-note').textContent));
  await page.click('[data-ntview="edit"]'); await page.click('.lk-row:has-text("수면")'); await page.fill('#ntDlgBody input[data-o="0"][data-f="text"]', '드라이브 공유 문장.'); await page.click('#ntSave'); await idle(page);
  const nf = G.files.filter(f => f.name === 'vhm-notes.json');
  await p2.evaluate(() => localStorage.removeItem('vhm-notes-tpl'));
  await p2.click('[data-tab="note"]'); await p2.waitForFunction(() => window.NOTES && NOTES._state.synced, null, { timeout: 15000 });
  const p2txt = await p2.evaluate(() => JSON.stringify(NOTES._state.tpl));
  check('상담 메모 틀은 드라이브에 1개 파일로 저장 → 다른 기기에서도 같은 틀 (체크 내용은 없음)', nf.length === 1 && nf[0].parents.length === 1 && /드라이브 공유 문장/.test(p2txt), String(nf.length));
  // 휴대폰 폭
  await p2.setViewportSize({ width: 390, height: 844 });
  check('휴대폰 폭 가로 스크롤 없음', !(await p2.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  check('스크립트 오류 없음', page.errors.length === 0 && p2.errors.length === 0, page.errors.concat(p2.errors).join(' | '));
  // New catalog + migration integration: all records are synthetic or public institution metadata.
  await p2.click('[data-tab="link"]'); await p2.click('#lkDrive'); await idle(p2);
  const beforeImport = Buffer.from(lf.content), rawLegacy = JSON.parse(lf.content);
  rawLegacy.futureTop = {preserve:'yes'}; rawLegacy.schema = 1;
  rawLegacy.services[0].futureField = {nested:['retained']};
  lf.content = Buffer.from(JSON.stringify(rawLegacy)); lf.modifiedTime = 'legacy-' + (++seq);
  await p2.click('#lkDrive'); await idle(p2);
  check('v1 로드 마이그레이션은 원격 파일에 쓰지 않음', JSON.parse(lf.content).schema === 1 && await p2.evaluate(() => LINKS._state.data.schema === 2));
  const rawBeforeRead = Buffer.from(lf.content), requestsBeforeChecks = G.log.length;
  await p2.click('[data-lkview="match"]'); await p2.locator('input[data-need]').first().check();
  await p2.click('[data-lkview="list"]'); await p2.selectOption('[data-lkfilter="group"]','medical');
  check('요구·자격 필터는 Google 호출·원격 저장 없이 동작', rawBeforeRead.equals(lf.content) && G.log.length === requestsBeforeChecks);
  await p2.click('#lkFilterClear');
  await p2.click('[data-lkview="io"]'); await p2.locator('[data-catalog-select="eye-surgery"]').check();
  await p2.locator('[data-catalog-select="smile-dental"]').check();
  await p2.click('#lkCatalogPreview'); await p2.waitForSelector('#lkCatalogCommit');
  check('공개자료 선택 미리보기만으로 원격 변경 없음', /추가 2건/.test(await p2.textContent('#lkCatalogPreviewBox')) && rawBeforeRead.equals(lf.content));
  await p2.click('#lkCatalogCancel');
  check('가져오기 취소 시 자료 보존', rawBeforeRead.equals(lf.content));
  await p2.click('#lkCatalogPreview'); await p2.waitForSelector('#lkCatalogCommit');
  await p2.click('#lkCatalogCommit');
  check('백업 없이는 병합 저장 차단', rawBeforeRead.equals(lf.content));
  const [backup] = await Promise.all([p2.waitForEvent('download'),p2.click('#lkCatalogBackup')]);
  const backupPath = await backup.path(); const backupData = JSON.parse(fs.readFileSync(backupPath,'utf8'));
  check('병합 전 백업에 구형 목록·미래 필드 보존', backupData.schema === 1 && backupData.futureTop.preserve === 'yes' && backupData.services[0].futureField.nested[0] === 'retained');
  await p2.check('#lkBackupSaved'); if (await p2.$('#lkMissingConsent')) await p2.check('#lkMissingConsent');
  await p2.click('#lkCatalogCommit'); await idle(p2); await p2.waitForFunction(() => LINKS._state.data.services.some(s => s.catalogId === 'eye-surgery'));
  const merged = JSON.parse(lf.content);
  const imported = merged.services.find(s => s.catalogId === 'eye-surgery');
  check('선택 병합은 기존 서비스·신필드·미래 필드를 보존', merged.services.length === rawLegacy.services.length + 2 && merged.futureTop.preserve === 'yes' && merged.services[0].futureField.nested[0] === 'retained' && imported.officialGuideUrl && imported.preapprovalStatus && imported.checkedAt);
  check('공개 라벨은 기존 요구 ID로 매핑', imported.needs.every(id => merged.categories.some(c => c.items.some(i => i.id === id))) && imported.catalogNeedLabels.includes('의료비 부담'));
  await p2.click('[data-lkview="io"]'); await p2.check('[data-catalog-select="eye-surgery"]');
  await p2.click('#lkCatalogPreview'); await p2.waitForSelector('#lkCatalogCommit');
  check('중복 가져오기 멱등성', /추가 0건 · 중복 제외 1건/.test(await p2.textContent('#lkCatalogPreviewBox')) && await p2.isDisabled('#lkCatalogCommit'));
  await p2.click('#lkCatalogCancel'); await p2.uncheck('[data-catalog-select="eye-surgery"]'); await p2.check('[data-catalog-select="rare-disease"]');
  await p2.click('#lkCatalogPreview'); await p2.waitForSelector('#lkCatalogCommit');
  check('알 수 없는 요구는 미리보기에서 보고', /희귀질환 치료·관리/.test(await p2.textContent('#lkCatalogPreviewBox')) && !!(await p2.$('#lkMissingConsent')));
  const [b2] = await Promise.all([p2.waitForEvent('download'),p2.click('#lkCatalogBackup')]); await b2.path();
  await p2.check('#lkBackupSaved'); await p2.check('#lkMissingConsent');
  lf.modifiedTime = 'remote-' + (++seq); const remoteSaved = Buffer.from(lf.content);
  await p2.click('#lkCatalogCommit'); await idle(p2); await p2.waitForFunction(() => LINKS._state.notice === '' && !LINKS._state.importSnapshot);
  check('미리보기 이후 다른 기기 수정 시 병합 중단·원격 보존', remoteSaved.equals(lf.content) && !JSON.parse(lf.content).services.some(s => s.catalogId === 'rare-disease'));
  await p2.click('[data-lkview="io"]'); await p2.click('#lkCatalogPreview'); await p2.waitForSelector('#lkCatalogCommit');
  const [b3] = await Promise.all([p2.waitForEvent('download'),p2.click('#lkCatalogBackup')]); await b3.path();
  await p2.check('#lkBackupSaved'); if (await p2.$('#lkMissingConsent')) await p2.check('#lkMissingConsent');
  G.conflictOnPatch = true;
  await p2.click('#lkCatalogCommit'); await idle(p2); await p2.waitForFunction(() => !LINKS._state.importSnapshot);
  check('메타데이터 확인 후 PATCH 경합도 If-Match로 차단', remoteSaved.equals(lf.content) && !JSON.parse(lf.content).services.some(s => s.catalogId === 'rare-disease'));
  await p2.waitForFunction(expected => LINKS._state.modified === expected, lf.modifiedTime);
  G.omitEtag = true;
  const noEtagContent = Buffer.from(lf.content);
  const noEtag = await p2.evaluate(async () => { try { await SERVER.linksSave(LINKS._state.data, LINKS._state.modified, false); return ''; } catch(e) { return e.message; } });
  check('ETag 누락 시 저장을 중단하여 기존 원격 자료 보호', /ETag/.test(noEtag) && noEtagContent.equals(lf.content), noEtag);
  G.omitEtag = false;
  const duplicate = Object.assign({},lf,{id:'duplicate-mock-list'}); G.files.push(duplicate);
  const duplicateMessage = await p2.evaluate(async () => { try { await SERVER.linksLoad(); return ''; } catch(e) { return e.message; } });
  check('동일 이름 원격 파일 여러 개면 임의 선택·덮어쓰기 중단', /여러 개/.test(duplicateMessage) && noEtagContent.equals(lf.content));
  G.files.splice(G.files.indexOf(duplicate),1); await p2.click('#lkDrive'); await idle(p2);
  // Record verification without promoting pending research.
  await p2.click('[data-lkview="pending"]'); await p2.locator('[data-detail="personal:catalog-copy-smile-dental"]').click();
  await p2.click('[data-review="smile-dental"]');
  await p2.fill('[data-review-field="operation"]','운영 여부 전화 확인 필요 (가상 기록)');
  await p2.fill('[data-review-field="gangseo"]','강서구 의뢰 가능 여부 확인 중');
  await p2.fill('[data-review-field="agency"]','가상 담당부서');
  await p2.fill('[data-review-field="recommendation"]','추천서 최신본 요청 중');
  await p2.fill('[data-review-field="checkedAt"]','2026-11-15');
  await p2.click('#lkReviewSave'); await p2.waitForSelector('#referralReviewDlg:not([open])',{state:'attached'});
  const withReview = JSON.parse(lf.content);
  check('확인 기록 저장 후에도 확인 필요 상태 유지', withReview.catalogReviews['smile-dental'].gangseo.includes('강서구') && withReview.services.find(s => s.catalogId === 'smile-dental').verificationStatus === 'needs_contact');
  // Backup restore round trip (synthetic data, full metadata).
  await p2.click('[data-lkview="io"]');
  await p2.setInputFiles('#lkFile',{name:'mock-restore.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(withReview))}); await idle(p2);
  check('백업 복원 시 새 메타데이터·확인 기록 왕복', JSON.parse(lf.content).catalogReviews['smile-dental'].checkedAt === '2026-11-15' && JSON.parse(lf.content).services.find(s => s.catalogId === 'eye-surgery').officialGuideUrl === imported.officialGuideUrl);
  // Evidence attachments complete only this account's pending workflow.
  const evidenceFile={name:'mock-official-letter.pdf',mimeType:'application/pdf',buffer:Buffer.from('synthetic blank official form')};
  const uploadInEditor=async(file=evidenceFile)=>{
    await p2.setInputFiles('#svcFile',file);
    await p2.waitForFunction(()=>document.querySelector('#svcUploadStatus').textContent.startsWith('파일 업로드 완료'));
    await p2.waitForFunction(()=>!document.querySelector('#svcSave').disabled);
  };
  await p2.click('[data-lkview="pending"]');
  await p2.locator('#tab-link [data-attach="personal:catalog-copy-smile-dental"]').click();
  const originalPending=Buffer.from(lf.content);
  await uploadInEditor();
  check('파일 업로드만 하고 저장 전이면 원격 목록·상태는 그대로', originalPending.equals(lf.content));
  await p2.click('#svcDlg [data-close]');
  check('업로드 후 편집 취소 시 확인 대기 유지', originalPending.equals(lf.content) && !!(await p2.$('#tab-link [data-attach="personal:catalog-copy-smile-dental"]')));
  await p2.locator('#tab-link [data-attach="personal:catalog-copy-smile-dental"]').click();await uploadInEditor();
  G.omitEtag=true;await p2.click('#svcSave');await p2.waitForFunction(()=>!document.querySelector('#svcSave').disabled);
  check('메타데이터 저장 실패면 파일이 있어도 완료 상태로 표시하지 않음', originalPending.equals(lf.content) && await p2.evaluate(()=>!VHM_REFERRALS.attachmentState(LINKS._state.data.services.find(s=>s.catalogId==='smile-dental'),VHM_PUBLIC_REFERRALS.services.find(s=>s.id==='smile-dental'))._attachmentReady));
  G.omitEtag=false;await p2.click('#svcSave');await p2.waitForSelector('#svcDlg:not([open])',{state:'attached'});
  check('첨부 저장으로 개인 확인 대기 해제, 공개 원본 상태·연락처·의뢰 요건 보존', !(await p2.$('#tab-link [data-attach="personal:catalog-copy-smile-dental"]')) && await p2.evaluate(()=>VHM_PUBLIC_REFERRALS.services.find(s=>s.id==='smile-dental').verificationStatus==='needs_contact') && JSON.parse(lf.content).services.find(s=>s.catalogId==='smile-dental').referralCode===4);
  await p2.click('[data-lkview="list"]');await p2.fill('#lkQ','스마일재단');await p2.click('[data-detail="personal:catalog-copy-smile-dental"]');
  check('자료 등록 완료는 공식 검증과 구분해 표시', /개인 자료 등록 완료 \(공식 검증 아님\)/.test(await p2.textContent('#referralBody')) && /미확인/.test(await p2.textContent('#referralBody')));
  const [evidenceDownload]=await Promise.all([p2.waitForEvent('download'),p2.locator('#referralBody [data-dl]').click()]);
  check('공문·양식 내려받기 내용 보존', fs.readFileSync(await evidenceDownload.path(),'utf8')==='synthetic blank official form');
  await p2.click('[data-refclose="referralDlg"]');await p2.click('[data-edit="catalog-copy-smile-dental"]');
  const trashBefore=G.log.filter(x=>x.startsWith('PATCH /drive')).length;
  await p2.click('[data-rmform="0"]');await p2.click('#svcSave');await p2.waitForSelector('#svcDlg:not([open])',{state:'attached'});
  check('마지막 파일 연결 제거 시 확인 대기로 복귀, 파일을 원격 삭제하지 않음', await p2.evaluate(()=>!VHM_REFERRALS.attachmentState(LINKS._state.data.services.find(s=>s.catalogId==='smile-dental'),VHM_PUBLIC_REFERRALS.services.find(s=>s.id==='smile-dental'))._attachmentReady) && G.log.filter(x=>x.startsWith('PATCH /drive')).length===trashBefore);
  await p2.click('#lkFilterClear');await p2.click('#lkAdd');
  await uploadInEditor({name:'synthetic-new-service.hwp',mimeType:'application/octet-stream',buffer:Buffer.from('synthetic blank hwp placeholder')});
  check('개인 서비스는 파일만 첨부해도 이름 자동 입력', await p2.inputValue('#svcForm [name=name]')==='synthetic-new-service');
  await p2.click('#svcSave');await p2.waitForSelector('#svcDlg:not([open])',{state:'attached'});
  const newService=JSON.parse(lf.content).services.find(s=>s.name==='synthetic-new-service');
  check('추가 필수 조건 없이 파일만으로 개인 등록 완료·스키마 보존', newService.forms[0].fileId && newService.attachmentReviewEnabled && newService.attachmentRegisteredAt && await p2.evaluate(id=>VHM_REFERRALS.attachmentState(LINKS._state.data.services.find(s=>s.id===id))._attachmentReady,newService.id));
  await p2.click('#lkAdd');G.failUpload=true;
  await p2.setInputFiles('#svcFile',evidenceFile);await p2.waitForFunction(()=>document.querySelector('#svcUploadStatus').textContent.startsWith('업로드 실패'));
  await p2.fill('#svcForm [name=name]','mock-upload-failed');await p2.click('#svcSave');await p2.waitForSelector('#svcDlg:not([open])',{state:'attached'});
  check('업로드 실패 후에는 등록 완료로 처리하지 않음', await p2.evaluate(()=>{const s=LINKS._state.data.services.find(s=>s.name==='mock-upload-failed');return !s.forms.length && VHM_REFERRALS.attachmentState(s).verificationStatus==='needs_contact';}));
  await p2.click('#lkAdd');await p2.fill('#svcForm [name=name]','mock-link-only');await p2.fill('#svcLinkUrl','https://example.org/guide');await p2.click('#svcAddLink');await p2.click('#svcSave');await p2.waitForSelector('#svcDlg:not([open])',{state:'attached'});
  check('링크만 등록한 새 개인 서비스는 확인 필요 유지', await p2.evaluate(()=>VHM_REFERRALS.attachmentState(LINKS._state.data.services.find(s=>s.name==='mock-link-only')).verificationStatus==='needs_contact'));
  await p2.click('[data-lkview="pending"]');await p2.locator('#tab-link [data-attach="public:boas-dental"]').click();await uploadInEditor();await p2.click('#svcSave');await p2.waitForSelector('#svcDlg:not([open])',{state:'attached'});
  const boas=JSON.parse(lf.content).services.filter(s=>s.catalogId==='boas-dental');
  check('공개 확인 필요 사업에도 직접 첨부 가능, 개인 복사본 1개로 보존', boas.length===1 && boas[0].catalogVersion && boas[0].forms[0].fileId && boas[0].catalogNeedLabels.includes('구강 문제'));
  await p2.click('[data-lkview="list"]');await p2.fill('#lkQ','보아스');await p2.locator('#tab-link [data-attach="personal:'+boas[0].id+'"]').click();await p2.click('#svcSave');await p2.waitForSelector('#svcDlg:not([open])',{state:'attached'});
  check('자료 재저장에도 동일 사업 중복 생성 없음', JSON.parse(lf.content).services.filter(s=>s.catalogId==='boas-dental').length===1);
  const p3=await newPage(true);await openLinks(p3);
  check('다른 기기에서도 첨부·등록 완료 상태 복원', await p3.evaluate(id=>{const s=LINKS._state.data.services.find(s=>s.catalogId===id);return s.forms[0].fileId && VHM_REFERRALS.attachmentState(s,VHM_PUBLIC_REFERRALS.services.find(s=>s.id===id))._attachmentReady;},'boas-dental'));
  await p3.context().close();

  await p2.click('[data-tab="set"]'); await p2.click('#btnSignOut'); await p2.click('[data-tab="link"]');
  check('연결 해제 시 개인 목록과 요구 체크 초기화, 공개자료 유지', await p2.evaluate(() => !LINKS._state.personalLoaded && LINKS._state.data.services.length === 0 && LINKS._state.checks.size === 0) && /공개자료 69건/.test(await p2.textContent('#tab-link')));

  console.log(R.join('\n')); await b.close(); server.close();
})().catch(e => { console.log(R.join('\n')); console.error('CRASH', e); process.exit(1); });
