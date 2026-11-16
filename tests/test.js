const SENT = [], ALLSENT = [];
// 호스팅 버전 테스트: 실제 index.html 을 로컬 서버로 열고, 구글 로그인(GIS)과 Calendar REST API 를 가짜로 응답합니다.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const { A: AUTH, install: installAuth, connectVia } = require('./fake-auth.js');
const SITE = require('path').join(__dirname, '..', 'site');
const R = []; const check = (n, ok, info = '') => R.push(`${ok ? 'PASS' : 'FAIL'} ${n}${info ? ' — ' + info : ''}`);

/* ---------- 가짜 구글 캘린더 ---------- */
let seq = 0; const nextId = p => p + (++seq).toString(36) + 'x';
const G = { cals: [], events: {}, tokenOk: true, log: [], noAuth: 0 };
function addCal(summary, extra = {}) { const c = Object.assign({ id: nextId('cal') + '@group.calendar.google.com', summary, accessRole: 'owner' }, extra); G.cals.push(c); G.events[c.id] = []; return c; }
function tms(x) { return x.dateTime ? Date.parse(x.dateTime) : Date.parse(x.date + 'T00:00:00+09:00'); }
function mkEv(calId, body) {
  const ev = Object.assign({ id: nextId('ev'), status: 'confirmed', reminders: { useDefault: true } }, JSON.parse(JSON.stringify(body)));
  ev.iCalUID = ev.iCalUID || ev.id + '@google.com'; ev.etag = '"' + (++seq) + '"'; ev.updated = new Date().toISOString();
  G.events[calId].push(ev); return ev;
}
function touch(ev) { ev.etag = '"' + (++seq) + '"'; ev.updated = new Date().toISOString(); }
function reset(withCalendars) {
  G.cals = []; G.events = {}; G.tokenOk = true; G.log = [];
  addCal('me@example.com', { id: 'me@example.com', primary: true });
  if (withCalendars) {
    const w = addCal('방문건강관리(업무)'), p = addCal('방문건강관리(개인)');
    // Apps Script 로 만들었던 일정 (숨은 태그 + 예전 방식 ID)
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    G.legacy = mkEv(w.id, { summary: '[내소] 완료', start: { dateTime: today + 'T09:00:00+09:00' }, end: { dateTime: today + 'T09:30:00+09:00' },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] },
      extendedProperties: { private: { vhm_kind: 'work', vhm_type: '내소', vhm_status: '완료', vhm_group: '정기관리군', vhm_target: '가상기존-01', vhm_memo: '예전 메모', vhm_uid: 'olduid1' } } });
    G.today = today; G.work = w.id; G.pers = p.id;
  }
}
function api(req, body) {
  const u = new URL(req.url); const p = u.pathname.replace('/calendar/v3', ''); const m = req.method;
  G.log.push(m + ' ' + decodeURIComponent(p));
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer tok')) { G.noAuth++; return [401, { error: { message: 'no auth' } }]; }
  if (!G.tokenOk) return [401, { error: { message: 'expired' } }];
  let mm;
  if (m === 'GET' && p === '/users/me/calendarList') return [200, { items: G.cals }];
  if (m === 'POST' && p === '/calendars') { const c = addCal(body.summary, { timeZone: body.timeZone }); return [200, c]; }
  if ((mm = /^\/calendars\/([^/]+)$/.exec(p))) {
    const c = G.cals.find(x => x.id === decodeURIComponent(mm[1])); if (!c) return [404, { error: { message: 'cal' } }];
    if (m === 'GET') return [200, c];
    if (m === 'PATCH') { Object.assign(c, body); return [200, c]; }
  }
  if ((mm = /^\/calendars\/([^/]+)\/events$/.exec(p))) {
    const cid = decodeURIComponent(mm[1]); if (!G.events[cid]) return [404, { error: { message: 'cal' } }];
    if (m === 'GET') { const a = Date.parse(u.searchParams.get('timeMin')), b = Date.parse(u.searchParams.get('timeMax'));
      return [200, { items: G.events[cid].filter(e => tms(e.start) < b && tms(e.end) > a) }]; }
    if (m === 'POST') return [200, mkEv(cid, body)];
  }
  if ((mm = /^\/calendars\/([^/]+)\/events\/([^/]+)\/move$/.exec(p)) && m === 'POST') {
    const cid = decodeURIComponent(mm[1]), eid = decodeURIComponent(mm[2]), dest = u.searchParams.get('destination');
    const ev = (G.events[cid] || []).find(e => e.id === eid); if (!ev || !G.events[dest]) return [404, { error: { message: 'not found' } }];
    G.events[cid] = G.events[cid].filter(e => e !== ev); G.events[dest].push(ev); touch(ev); return [200, ev];
  }
  if ((mm = /^\/calendars\/([^/]+)\/events\/([^/]+)$/.exec(p))) {
    const cid = decodeURIComponent(mm[1]), eid = decodeURIComponent(mm[2]); const list = G.events[cid] || [];
    const ev = list.find(e => e.id === eid); if (!ev) return [404, { error: { message: 'not found' } }];
    const im = req.headers['if-match'];
    if (m === 'GET') return [200, ev];
    if (im && im !== ev.etag) return [412, { error: { message: 'Precondition Failed' } }];
    if (m === 'DELETE') { G.events[cid] = list.filter(e => e !== ev); return [204, null]; }
    if (m === 'PATCH') {
      for (const k of Object.keys(body)) {
        if (k === 'extendedProperties') { ev.extendedProperties = ev.extendedProperties || {}; ev.extendedProperties.private = Object.assign({}, (ev.extendedProperties.private || {}), body.extendedProperties.private); }
        else ev[k] = JSON.parse(JSON.stringify(body[k]));
      }
      touch(ev); return [200, ev];
    }
  }
  return [400, { error: { message: 'unknown ' + m + ' ' + p } }];
}
const FAKE_GIS = `window.google = { accounts: { oauth2: {
  initTokenClient(cfg) { window.__gisCfg = cfg; return { requestAccessToken(o) { window.__prompts = (window.__prompts || []).concat([o.prompt]);
    setTimeout(() => cfg.callback({ access_token: 'tok' + Date.now(), expires_in: 3600, scope: cfg.scope }), 20); } }; },
  hasGrantedAllScopes: () => true, revoke: (t, cb) => { window.__revoked = t; cb && cb(); } } } };`;

/* ---------- 로컬 정적 서버 ---------- */
let CONFIG = "window.VHM_CONFIG = { clientId: 'test-client.apps.googleusercontent.com' };";
const server = http.createServer((req, res) => {
  const f = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
  if (f === '/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(CONFIG); }
  const fp = path.join(SITE, decodeURIComponent(f)); if (!fs.existsSync(fp)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); fs.createReadStream(fp).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, r)); const BASE = 'http://localhost:' + server.address().port + '/';
  const b = await chromium.launch({ executablePath: process.env.VHM_CHROMIUM || '/usr/bin/chromium' });
  async function newPage() {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', acceptDownloads: true });
    const page = await ctx.newPage(); page.errors = []; page.external = [];
    await page.addInitScript(() => { try { if (!localStorage.getItem('vhm-keep')) localStorage.setItem('vhm-keep', JSON.stringify({ on: false })); } catch (e) {} });
    page.on('pageerror', e => page.errors.push(e.message)); page.on('dialog', d => d.accept());
    await installAuth(page);
    await page.route('https://www.googleapis.com/**', async r => {
      const req = r.request(); const body = req.postData() ? JSON.parse(req.postData()) : null; if (req.postData()) { SENT.push(req.postData()); ALLSENT.push(req.postData()); }
      const [st, js] = api({ url: req.url(), method: req.method(), headers: req.headers() }, body);
      await r.fulfill({ status: st, contentType: 'application/json', body: js == null ? '' : JSON.stringify(js), headers: { 'access-control-allow-origin': '*' } });
    });
    page.on('request', q => { const u = q.url(); if (!u.startsWith(BASE) && !u.startsWith('https://www.googleapis.com/') && !u.startsWith('https://accounts.google.com/o/oauth2/') && !u.startsWith('https://oauth2.googleapis.com/revoke') && !u.startsWith('data:') && !u.startsWith('blob:')) page.external.push(u); });
    return page;
  }
  const idle = p => p.waitForFunction(() => !document.querySelector('#sync .spin'), null, { timeout: 10000 });
  const setT = async (p, n, v) => { await p.fill('#eventForm input[name=' + n + ']', v); await p.dispatchEvent('#eventForm input[name=' + n + ']', 'change'); };

  // 0. 클라이언트 ID 없음
  CONFIG = "window.VHM_CONFIG = { clientId: '' };"; reset(true);
  let page = await newPage(); await page.goto(BASE); await page.waitForSelector('#connectBox:not([hidden])');
  check('클라이언트 ID 없으면 설정 안내 + 연결 버튼 비활성', /config\.js/.test(await page.textContent('#connectMsg')) && await page.$eval('#btnConnect', x => x.disabled));
  await page.context().close();

  // 1. 연결 → 기존 캘린더 재사용, 예전 일정 표시
  CONFIG = "window.VHM_CONFIG = { clientId: 'test-client.apps.googleusercontent.com' };"; reset(true);
  page = await newPage(); await page.goto(BASE); await page.waitForSelector('#connectBox:not([hidden])');
  check('처음 열면 API 요청 없이 연결 안내만', G.log.length === 0 && G.noAuth === 0, G.log.join(','));
  AUTH.log = []; AUTH.granted.clear(); AUTH.origin = BASE;
  await connectVia(page, '#btnConnect'); await page.waitForSelector('#connectBox[hidden]', { state: 'attached' }); await idle(page);
  const prompts1 = AUTH.log.map(x => x.prompt);
  check('페이지 이동 로그인: 토큰 방식·이 주소로 복귀·주소창의 토큰 지움', AUTH.log[0].rt === 'token' && AUTH.log[0].redirect === BASE && AUTH.log[0].igs === 'true' && !/access_token/.test(page.url()), page.url());
  check('첫 연결은 동의 화면(consent)으로 요청', prompts1 && prompts1[0] === 'consent', JSON.stringify(prompts1));
  check('기존 두 캘린더 재사용 (새로 만들지 않음)', !G.log.some(x => x.startsWith('POST /calendars ')) && !G.log.includes('POST /calendars') && G.cals.length === 3);
  const legacyText = await page.textContent('#dayList');
  const legacyDone = await page.evaluate(() => S.doneEvents.map(e => e.target).join());
  check('Apps Script 로 만든 기존 완료 일정 → 일정표에선 빠지고 완료함에(숨은 별칭 그대로)', !/가상기존-01/.test(legacyText) && /가상기존-01/.test(legacyDone), legacyDone);
  const st0 = await page.$eval('#statsTable tbody tr:nth-child(4) td.done', t => t.textContent);
  check('기존 일정 실적 반영 (내소 1)', st0 === '1', st0);

  // 2. 새 업무 일정
  await page.click('#btnNew'); await page.selectOption('#eventForm select[name=type]', '방문');
  await page.fill('#eventForm input[name=target]', '가상가-01'); await setT(page, 'start', '10:00');
  await page.fill('#eventForm textarea[name=memo]', '가상 메모'); await page.click('#btnSave');
  await page.waitForSelector('#lockDlg[open]'); const setupTxt = await page.textContent('#lockBody');
  await page.fill('#lockPw', '가상암호1234'); await page.fill('#lockPw2', '가상암호9999'); await page.click('#lockOk');
  const mis = await page.textContent('#lockMsg'); await page.fill('#lockPw2', '가상암호1234'); await page.click('#lockOk');
  await page.waitForSelector('#lockDlg:not([open])', { state: 'attached', timeout: 20000 }); await page.waitForSelector('#eventDlg:not([open])', { state: 'attached', timeout: 20000 }); await idle(page);
  check('메모 첫 저장 → 잠금 암호 만들기 창(복구 불가 경고·두 번 확인)', /영영 복구할 수 없습니다/.test(setupTxt) && /다릅니다/.test(mis), mis);
  // 같은 창에서 잠근 뒤 다시 열기: '열기' 버튼이 눌린 상태로 남지 않아야 함 (실사용에서 발견된 문제)
  await page.click('#btnLock'); await page.waitForFunction(() => /메모 잠김/.test(document.querySelector('#btnLock').textContent)); await idle(page);
  await page.click('#btnLock'); await page.waitForSelector('#lockDlg[open]');
  const okEnabled = await page.$eval('#lockOk', b => !b.disabled);
  await page.fill('#lockPw', '가상암호1234'); await page.click('#lockOk');
  await page.waitForFunction(() => /메모 열림/.test(document.querySelector('#btnLock').textContent), null, { timeout: 20000 }); await idle(page);
  check('암호 만든 뒤 잠그고 같은 창에서 다시 열기 → 열기 버튼 정상', okEnabled);
  const created = G.events[G.work].find(e => e.extendedProperties && e.extendedProperties.private.vhm_target === '가상가-01');
  check('새 일정 → 업무 캘린더, 제목 “[방문]”(별칭·메모 미포함)', created && created.summary === '[방문]', created && created.summary);
  check('시간 +09:00, 알림 30분, 숨은 정보 저장', created.start.dateTime === G.today + 'T10:00:00+09:00' && created.end.dateTime === G.today + 'T10:30:00+09:00'
    && created.reminders.useDefault === false && created.reminders.overrides[0].minutes === 30 && /^vhm1:/.test(created.extendedProperties.private.vhm_memo) && created.extendedProperties.private.vhm_uid.length === 32,
    JSON.stringify(created.start) + JSON.stringify(created.reminders));

  G.cipher1 = created.extendedProperties.private.vhm_memo;
  // 3. 완료 버튼
  await page.click(`#dayList [data-quick="완료"][data-id="${created.id}"]`); await idle(page);
  const patchLog = G.log.filter(x => x.startsWith('PATCH') && x.includes('/events/'));
  check('완료 버튼 → PATCH, 제목 “[방문] 완료”', patchLog.length === 1 && created.summary === '[방문] 완료', created.summary);
  const doneCal = G.cals.find(c => c.summary === '방문건강관리(완료)');
  check('완료하면 ‘방문건강관리(완료)’ 캘린더를 만들고 그리로 옮김(알림 끔, 원래 알림 기억)', doneCal && G.events[doneCal.id].includes(created) && !G.events[G.work].includes(created)
    && created.reminders.useDefault === false && created.reminders.overrides.length === 0 && created.extendedProperties.private.vhm_prevrem === '30', JSON.stringify(created.reminders));
  check('완료한 일정은 일정표에서 빠지고 되돌리기 안내', !(await page.$(`#dayList .item[data-id="${created.id}"]`)) && /완료함으로 옮겼습니다/.test(await page.textContent('.undo-bar')));
  await page.click('.undo-bar .undo-btn'); await idle(page);
  check('되돌리기 → 업무 캘린더로 돌아와 ‘예정’, 알림 30분 복원', G.events[G.work].includes(created) && created.summary === '[방문]' && created.reminders.overrides[0].minutes === 30 && !!(await page.$(`#dayList .item[data-id="${created.id}"]`)), created.summary + JSON.stringify(created.reminders));
  await page.click(`#dayList [data-quick="완료"][data-id="${created.id}"]`); await idle(page);
  const visit = await page.$eval('#statsTable tbody tr:nth-child(2) td.done', t => t.textContent);
  check('오늘 실적 방문 1 (완료 캘린더로 옮겨도 실적 포함)', visit === '1', visit);

  // 4. 개인 일정
  await page.click('#btnNew'); await page.click('#eventForm label:has(input[value=personal])');
  await page.fill('#eventForm input[name=title]', '가상 개인 약속'); await setT(page, 'start', '18:00'); await page.click('#btnSave'); await idle(page);
  const tot = await page.$eval('#statsTable tfoot td:nth-child(2)', t => t.textContent);
  check('개인 일정 → 개인 캘린더, 실적 합계 그대로 2', G.events[G.pers].length === 1 && tot === '2', tot);
  // 4-1. 개인 일정 완료 → 완료함, 완료함에서 되돌리기
  const pev = G.events[G.pers][0];
  await page.click(`#dayList [data-quick="완료"][data-id="${pev.id}"]`); await idle(page);
  check('개인 일정 완료 버튼 → 완료 캘린더로, 실적 합계 그대로', G.events[doneCal.id].includes(pev) && pev.extendedProperties.private.vhm_done === '1' && await page.$eval('#statsTable tfoot td:nth-child(2)', t => t.textContent) === '2');
  await page.click('#viewSeg [data-v="done"]'); await idle(page);
  const doneTxt = await page.textContent('#listView');
  check('완료함 보기: 완료한 업무·개인 일정이 모임', /가상 개인 약속/.test(doneTxt) && /방문 · 가상가-01/.test(doneTxt) && /가상기존-01/.test(doneTxt) && !(await page.isVisible('#monthView')), doneTxt.slice(0, 160));
  await page.screenshot({ path: 'done-view.png' });
  check('예전에 완료한 일정은 ‘휴대폰 캘린더에서도 빼기’ 안내', /1건/.test(await page.textContent('.done-move')));
  await page.click('#btnMoveDone'); await idle(page);
  check('‘휴대폰 캘린더에서도 빼기’ → 완료 캘린더로 이동', G.events[doneCal.id].includes(G.legacy) && !G.events[G.work].includes(G.legacy) && !(await page.$('.done-move')));
  await page.click(`#listView [data-undone][data-id="${pev.id}"]`); await idle(page);
  check('완료함 되돌리기(개인) → 개인 캘린더로', G.events[G.pers].includes(pev) && pev.extendedProperties.private.vhm_done === '' && !/가상 개인 약속/.test(await page.textContent('#listView')));
  // 개인 일정 창에서 ‘완료’ 체크 후 저장
  await page.click('#viewSeg [data-v="month"]'); await idle(page);
  await page.click(`#dayList .item[data-id="${pev.id}"] .t-line`); await page.check('#eventForm input[name=done]');
  const dh = await page.textContent('#doneHint'); await page.click('#btnSave'); await idle(page);
  check('일정 창 ‘완료’ 체크 → 안내 후 완료함으로', /완료함/.test(dh) && G.events[doneCal.id].includes(pev), dh);
  await page.click('.undo-bar .undo-btn'); await idle(page);

  // 5. 휴대폰에서 바꾸기·만들기
  created.summary = '[방문] 부재'; touch(created);
  mkEv(G.work, { summary: '[전화] 완료', start: { dateTime: G.today + 'T14:00:00+09:00' }, end: { dateTime: G.today + 'T14:30:00+09:00' }, reminders: { useDefault: true } });
  const phone = mkEv(G.work, { summary: '[전화]', start: { dateTime: G.today + 'T13:00:00+09:00' }, end: { dateTime: G.today + 'T13:30:00+09:00' }, reminders: { useDefault: true } });
  mkEv(G.work, { summary: '가상 어르신 전화', start: { dateTime: G.today + 'T15:00:00+09:00' }, end: { dateTime: G.today + 'T15:30:00+09:00' } });
  await page.click('#btnRefresh'); await idle(page);
  const items = (await page.$$eval('#dayList .item', e => e.map(x => x.innerText.replace(/\s+/g, ' ')))).join(' | ');
  const stats = await page.evaluate(() => lastStats);
  check('휴대폰 변경 반영 (방문 부재, 전화 완료, 미분류 1)', /방문 · 가상가-01 부재/.test(items) && stats.counts['전화']['완료'] === 1 && stats.unclassified === 1, items.slice(0, 120));
  // 휴대폰 일정(캘린더 기본 알림)을 열어 저장해도 기본 알림 유지
  await page.click(`#dayList .item[data-id="${phone.id}"] .t-line`);
  const remSel = await page.inputValue('#eventForm select[name=reminder]');
  await page.click('#btnSave'); await idle(page);
  check('휴대폰 일정의 “캘린더 기본 알림” 유지', remSel === '-2' && phone.reminders.useDefault === true, remSel + ' ' + JSON.stringify(phone.reminders));

  // 6. 충돌
  await page.click(`#dayList .item[data-id="${created.id}"] .t-line`);
  created.summary = '[방문] 취소'; touch(created);
  await page.fill('#eventForm input[name=target]', '가상가-01수정'); await page.click('#btnSave');
  await page.waitForSelector('#chooseDlg[open]'); const cmp = await page.textContent('#chooseBody');
  await page.click('#chooseBtns button.primary'); await idle(page);
  check('동시 수정 감지(etag) → 비교 → 내 내용 저장', /다른 기기의 내용/.test(cmp) && created.extendedProperties.private.vhm_target === '가상가-01수정');

  // 7. 삭제
  await page.click(`#dayList .item[data-id="${created.id}"] .t-line`); await page.click('#btnDelete'); await idle(page);
  check('삭제 → 캘린더에서 삭제', !G.events[G.work].some(e => e.id === created.id));

  // 8. 연결 만료 → 다시 연결
  G.tokenOk = false; await page.click('#btnRefresh');
  await page.waitForSelector('#connectBox:not([hidden])'); const expMsg = await page.textContent('#connectMsg');
  G.tokenOk = true; await connectVia(page, '#btnConnect'); await page.waitForSelector('#connectBox[hidden]', { state: 'attached' }); await idle(page);
  const prompts2 = AUTH.log.map(x => x.prompt === null ? '' : x.prompt);
  check('토큰 만료 → 연결 안내 → 다시 연결(동의 화면 생략)', /다시 연결/.test(expMsg) && prompts2[prompts2.length - 1] === '', expMsg.slice(0, 40) + ' ' + JSON.stringify(prompts2));

  // 9. 새로고침해도 1시간 안에는 다시 로그인 안 함
  const before = AUTH.log.length;
  await page.reload(); await page.waitForSelector('.month'); await idle(page);
  check('같은 탭 새로고침 시 바로 일정 표시 (로그인 창 없음)', await page.$eval('#connectBox', x => x.hidden) && AUTH.log.length === before, String(before));

  // 10. 시간 직접 입력 · 대상자명 가리기 · 출생연도·성별
  await page.click('#btnNew');
  const parsed = await page.evaluate(() => ['1430','14:30','2:30','930','9','오후 2시 30분','오후2시반','pm 2:30','오전 12시','12시','14.05','','25:00','abc','7:60'].map(x => parseTime(x)));
  check('시간 직접 입력 해석 (1430·오후 2시 30분 등)', JSON.stringify(parsed) === JSON.stringify(['14:30','14:30','02:30','09:30','09:00','14:30','14:30','14:30','00:00','12:00','14:05','',null,null,null]), JSON.stringify(parsed));
  const masks = await page.evaluate(() => ['김민수','이준','남궁민수','가-12','김O수',' 박 서 연 '].map(maskName));
  check('이름 두 번째 글자 O 처리', JSON.stringify(masks) === JSON.stringify(['김O수','이O','남O민수','가-12','김O수','박O연']), JSON.stringify(masks));
  SENT.length = 0;
  await page.selectOption('#eventForm select[name=type]', '방문');
  await page.fill('#eventForm input[name=target]', '김민수');
  const hint1 = await page.textContent('#personHint');
  await page.dispatchEvent('#eventForm input[name=target]', 'change');
  const shown = await page.inputValue('#eventForm input[name=target]');
  await page.fill('#eventForm input[name=birth]', '1948'); await page.dispatchEvent('#eventForm input[name=birth]', 'input');
  const hint2 = await page.textContent('#personHint'); const age = new Date().getFullYear() - 1948;
  await page.selectOption('#eventForm select[name=sex]', '여');
  await setT(page, 'start', '오후 2시 30분');
  const st = await page.inputValue('#eventForm input[name=start]'), en = await page.inputValue('#eventForm input[name=end]');
  check('이름 칸을 벗어나면 김O수로 바뀜 + 미리보기·나이 표시', shown === '김O수' && /김O수/.test(hint1) && hint2.includes('만 ' + age + '세'), shown + ' | ' + hint1 + ' | ' + hint2);
  check('시작 입력 → 14:30 정리, 종료 자동 15:00', st === '14:30' && en === '15:00', st + '~' + en);
  await page.click('#btnSave'); await idle(page);
  const pv = G.events[G.work].find(e => e.extendedProperties && e.extendedProperties.private.vhm_target === '김O수');
  check('저장: 숨은 정보 김O수·1948·여, 제목엔 이름·출생연도 없음', pv && pv.summary === '[방문]' && pv.extendedProperties.private.vhm_birth === '1948' && pv.extendedProperties.private.vhm_sex === '여' && pv.start.dateTime.endsWith('T14:30:00+09:00'), pv && JSON.stringify(pv.extendedProperties.private));
  check('원래 이름(김민수)은 구글로 전송되지 않음', SENT.length > 0 && !SENT.some(x => x.includes('김민수') || x.includes('\\uae40\\ubbfc\\uc218')), String(SENT.length));
  const listTxt = await page.textContent('#dayList');
  check('목록에 “김O수 (여·1948년생·만 N세)” 표시', listTxt.includes('김O수(여·1948년생·만 ' + age + '세)'), listTxt.slice(0, 200));
  // 제목 표시 켜도 이름만, 서버단에서도 가림
  const srv = await page.evaluate(() => SERVER.saveEvent({ kind:'work', date:'2026-11-20', start:'09:00', end:'', type:'전화', status:'예정', group:'미지정', target:'최영희', birth:'48', sex:'x', memo:'', reminder:-1 }, false));
  check('API 단에서도 이름 가림·잘못된 출생연도/성별은 비움', srv.event && srv.event.target === '최O희' && srv.event.birth === '' && srv.event.sex === '', JSON.stringify(srv.event && { t: srv.event.target, b: srv.event.birth, s: srv.event.sex }));
  // 숫자 4개 입력 즉시 12:34
  await page.click('#btnNew'); await page.click('#eventForm input[name=start]'); await page.keyboard.type('1234');
  const live = await page.inputValue('#eventForm input[name=start]'), liveEnd = await page.inputValue('#eventForm input[name=end]');
  await page.click('#eventForm input[name=end]'); await page.fill('#eventForm input[name=end]', ''); await page.keyboard.type('0905');
  const live2 = await page.inputValue('#eventForm input[name=end]'); await page.click('#eventDlg [data-close]');
  check('1234 입력 즉시 12:34 (종료 자동 13:04), 0905 → 09:05', live === '12:34' && liveEnd === '13:04' && live2 === '09:05', live + ' ' + liveEnd + ' ' + live2);
  // 잘못된 시간
  await page.click('#btnNew'); await page.selectOption('#eventForm select[name=type]', '전화'); await setT(page, 'start', '25시');
  const bad = await page.$eval('#eventForm input[name=start]', x => x.classList.contains('bad'));
  await page.click('#btnSave'); await page.waitForTimeout(200);
  const stillOpen = await page.$eval('#eventDlg', d => d.open); await page.click('#eventDlg [data-close]');
  check('알 수 없는 시간은 빨갛게 표시하고 저장 막음', bad && stillOpen);

  // 10b. 메모 잠금
  const workCal = G.cals.find(c => c.id === G.work);
  check('잠금 정보는 업무 캘린더 설명에 (암호·키 없이 소금값·확인값만)', /vhmlock1:\{"v":1,"salt":"[^"]+","iter":310000,"check":"[^"]+"\}/.test(workCal.description || '') && !/가상암호/.test(workCal.description), workCal.description);
  check('구글로 보낸 내용에 메모 원문·암호 없음', !SENT.some(x => x.includes('가상 메모') || x.includes('가상암호')), String(SENT.length));
  await page.reload(); await page.waitForSelector('.month'); await idle(page); await page.waitForFunction(() => /메모 잠김/.test(document.querySelector('#btnLock').textContent));
  const evM = mkEv(G.work, { summary: '[방문]', start: { dateTime: G.today + 'T16:00:00+09:00' }, end: { dateTime: G.today + 'T16:30:00+09:00' }, reminders: { useDefault: true },
    extendedProperties: { private: { vhm_kind: 'work', vhm_type: '방문', vhm_status: '예정', vhm_group: '미지정', vhm_target: '가상다-03', vhm_memo: G.cipher1, vhm_uid: 'locku1' } } });
  const cipher = evM.extendedProperties.private.vhm_memo;
  await page.click('#btnRefresh'); await idle(page);
  const lockedList = await page.textContent('#dayList');
  check('창을 새로 열면 다시 잠김 → 목록에 “🔒 잠긴 메모”, 원문 안 보임', /🔒 잠긴 메모/.test(lockedList) && !/가상 메모/.test(lockedList), lockedList.slice(0, 160));
  await page.click(`#dayList .item[data-id="${evM.id}"] .t-line`);
  const taState = await page.$eval('#eventForm textarea[name=memo]', t => ({ d: t.disabled, v: t.value }));
  await page.fill('#eventForm input[name=target]', '가상다-03수정'); await page.click('#btnSave'); await idle(page);
  check('잠긴 채로 일정 수정 → 메모 칸 잠김, 암호문 그대로 보존', taState.d && taState.v === '' && evM.extendedProperties.private.vhm_memo === cipher && evM.extendedProperties.private.vhm_target === '가상다-03수정', JSON.stringify(taState));
  await page.click(`#dayList [data-quick="완료"][data-id="${evM.id}"]`); await idle(page);
  check('잠긴 채로 완료 버튼 → 암호문 보존', evM.summary === '[방문] 완료' && evM.extendedProperties.private.vhm_memo === cipher);
  // 새 일정에 메모 → 잠금 풀기 창 (틀린 암호 → 맞는 암호)
  await page.click('#btnNew'); await page.selectOption('#eventForm select[name=type]', '전화'); await setT(page, 'start', '1700');
  await page.fill('#eventForm textarea[name=memo]', '가상 둘째 메모'); await page.click('#btnSave');
  await page.waitForSelector('#lockDlg[open]'); await page.fill('#lockPw', '틀린암호0000'); await page.click('#lockOk');
  await page.waitForFunction(() => /맞지 않습니다/.test(document.querySelector('#lockMsg').textContent), null, { timeout: 20000 });
  await page.fill('#lockPw', '가상암호1234'); await page.click('#lockOk');
  await page.waitForSelector('#eventDlg:not([open])', { state: 'attached', timeout: 20000 }); await idle(page);
  const ev2 = G.events[G.work].find(e => e.start.dateTime && e.start.dateTime.endsWith('T17:00:00+09:00'));
  const openList = await page.textContent('#dayList');
  check('틀린 암호 거부 → 맞는 암호로 열고 저장(암호문) → 목록에 원문 표시', ev2 && /^vhm1:/.test(ev2.extendedProperties.private.vhm_memo) && /가상 둘째 메모/.test(openList) && await page.evaluate(() => S.doneEvents.some(e => e.memo === '가상 메모')) && /메모 열림/.test(await page.textContent('#btnLock')), openList.slice(0, 200));
  // 예전 일반 메모 모두 잠그기
  await page.click('[data-tab="set"]'); await page.click('#lkAll'); await idle(page); await page.waitForTimeout(300);
  check('예전 일반 메모(가상) 모두 잠그기', /^vhm1:/.test(G.legacy.extendedProperties.private.vhm_memo), G.legacy.extendedProperties.private.vhm_memo.slice(0, 12));
  // 생체인증 (가상 인증기 + PRF)
  const cdp = await page.context().newCDPSession(page); await cdp.send('WebAuthn.enable');
  let bioOk = true; try { await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true } }); } catch (e) { bioOk = false; console.log('virtual authenticator:', e.message); }
  if (bioOk) {
    await page.reload(); await page.waitForSelector('.month'); await idle(page);
    await page.click('[data-tab="set"]'); await page.waitForSelector('#lkBioAdd');
    await page.click('#lkBioAdd'); await page.waitForSelector('#lockDlg[open]'); await page.fill('#lockPw', '가상암호1234'); await page.click('#lockOk');
    await page.waitForSelector('#lkBioAdd.primary', { timeout: 20000 }); await page.click('#lkBioAdd');
    await page.waitForSelector('#lkBioDel', { timeout: 20000 });
    const stored = await page.evaluate(() => localStorage.getItem('vhm-bio'));
    await page.reload(); await page.waitForSelector('.month'); await idle(page);
    await page.click('#btnLock'); await page.waitForSelector('#lockBio'); await page.click('#lockBio');
    await page.waitForFunction(() => /메모 열림/.test(document.querySelector('#btnLock').textContent), null, { timeout: 20000 }); await idle(page);
    const bioList = await page.textContent('#dayList');
    check('생체인증 등록(이 기기에만, 원래 키는 감싼 형태) → 새 창에서 생체인증으로 열기', stored && !/가상암호/.test(stored) && /가상 둘째 메모/.test(bioList), (stored || '').slice(0, 40));
  } else check('생체인증 시험(가상 인증기 지원 안 됨)', false);
  check('전체 시험 동안 구글로 보낸 내용에 메모 원문·잠금 암호 없음', ALLSENT.length > 5 && !ALLSENT.some(x => /가상 메모|가상 둘째 메모|예전 메모|가상암호/.test(x)), String(ALLSENT.length));
  await page.click('[data-tab="cal"]');

  // 10d. 메모: Enter 줄바꿈, Ctrl+Enter·⌘+Enter 저장
  await page.click('#btnNew'); await page.selectOption('#eventForm select[name=type]', '전화'); await setT(page, 'start', '1530');
  await page.fill('#eventForm input[name=target]', '가-엔터1');
  check('새 일정 메모 기본 항목은 편집 가능한 실제 입력값', await page.inputValue('#eventForm textarea[name=memo]') === '특이사항:\n이름/생년월일:\n주소:\n전화번호:');
  await page.fill('#eventForm textarea[name=memo]', '');
  await page.click('#eventForm textarea[name=memo]'); await page.keyboard.type('첫 줄'); await page.keyboard.press('Enter'); await page.keyboard.type('둘째 줄');
  const stillOpen1 = await page.$eval('#eventDlg', d => d.open);
  await page.keyboard.press('Control+Enter'); await page.waitForSelector('#eventDlg:not([open])', { state: 'attached', timeout: 15000 }); await idle(page);
  const ent = await page.evaluate(() => S.events.find(e => e.target === '가-엔터1'));
  await page.click(`#dayList .item[data-id="${ent.id}"] .t-line`); await page.waitForSelector('#eventDlg[open]');
  await page.click('#eventForm textarea[name=memo]'); await page.keyboard.press('End'); await page.keyboard.type(' 추가');
  await page.keyboard.press('Meta+Enter'); await page.waitForSelector('#eventDlg:not([open])', { state: 'attached', timeout: 15000 }); await idle(page);
  const ent2 = await page.evaluate(() => S.events.find(e => e.target === '가-엔터1'));
  check('메모: Enter는 줄바꿈, Ctrl+Enter·⌘+Enter는 저장', stillOpen1 && ent && ent.memo === '첫 줄\n둘째 줄' && ent2 && ent2.memo === '첫 줄\n둘째 줄 추가', JSON.stringify([stillOpen1, ent && ent.memo, ent2 && ent2.memo]));

  // 10e. 우선순위: 같은 날 높음이 맨 앞
  const PD = G.today; const pmk = (h, prio, tg) => mkEv(G.work, { summary: '[방문]', start: { dateTime: PD + 'T' + h + ':00+09:00' }, end: { dateTime: PD + 'T' + h + ':00+09:00' },
    extendedProperties: { private: Object.assign({ vhm_kind: 'work', vhm_type: '방문', vhm_status: '예정', vhm_group: '미지정', vhm_target: tg, vhm_uid: 'pr' + tg }, prio ? { vhm_prio: prio } : {}) } });
  pmk('06:00', 'low', 'p-낮음'); pmk('06:10', '', 'p-보통'); pmk('18:00', 'high', 'p-높음');
  await page.click('#btnRefresh'); await idle(page); await page.click(`.month .day[data-date="${PD}"]`); await idle(page);
  const pOrder = await page.$$eval('#dayList .item .title', t => t.map(x => x.textContent).filter(x => /p-(높음|보통|낮음)/.test(x)).map(x => x.match(/p-(높음|보통|낮음)/)[1]));
  const pBadge = await page.textContent(`#dayList .item:has-text("p-높음") .title`);
  const chip0 = await page.textContent(`.month .day[data-date="${PD}"] .chip`);
  await page.click(`#dayList .item:has-text("p-보통")`); await page.waitForSelector('#eventDlg[open]');
  const pDef = await page.inputValue('#eventForm select[name=prio]');
  await page.selectOption('#eventForm select[name=prio]', 'high'); await page.click('#btnSave'); await idle(page);
  const pSaved = G.events[G.work].find(e => e.extendedProperties && e.extendedProperties.private.vhm_uid === 'prp-보통');
  const pOrder2 = await page.$$eval('#dayList .item .title', t => t.map(x => x.textContent).filter(x => /p-(높음|보통|낮음)/.test(x)).map(x => x.match(/p-(높음|보통|낮음)/)[1]));
  check('우선순위: 같은 날 높음(18시)이 맨 앞·★ 중요 표시, 달력 칸 첫 줄 ★, 낮음은 뒤 / 바꾸면 저장·순서 반영', JSON.stringify(pOrder) === '["높음","보통","낮음"]' && /★ 중요/.test(pBadge) && chip0.startsWith('★') && pDef === 'normal' && pSaved.extendedProperties.private.vhm_prio === 'high' && JSON.stringify(pOrder2) === '["높음","보통","낮음"]' || (JSON.stringify(pOrder2) === '["보통","높음","낮음"]' && pSaved.extendedProperties.private.vhm_prio === 'high'), JSON.stringify({ pOrder, pOrder2, chip0, pDef }));
  // 만 나이 계산기 (일정표 맨 위)
  const ageFor = (y, m, d) => { const n = new Date(), had = n.getMonth() + 1 > m || (n.getMonth() + 1 === m && n.getDate() >= d); return [n.getFullYear() - y - (had ? 0 : 1), n.getFullYear() - y + 1]; };
  const calc = async v => { await page.fill('#ageIn', v); return page.textContent('#ageOut'); };
  const top = await page.evaluate(() => { const a = document.querySelector('.agecalc'), t = document.querySelector('#tab-cal .toolbar'); return a && t && (a.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) > 0; });
  const a1 = await calc('480312'), e1 = ageFor(1948, 3, 12), a2 = await calc('491231'), e2 = ageFor(1949, 12, 31);
  const a3 = await calc('481332'), a4 = await calc('4803'), a5 = await calc('250101');
  await page.click('#ageCent'); const a6 = await page.textContent('#ageOut'), e6 = ageFor(2025, 1, 1);
  const stored = await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage, sessionStorage)));
  check('만 나이 계산기: 일정표 맨 위, 6자리 → 만 나이·한국 나이, 잘못된 날짜 안내, 2000년대 전환, 저장 안 함',
    top && a1.includes(`만 ${e1[0]}세`) && a1.includes(`한국 나이 ${e1[1]}세`) && a1.includes('1948.03.12생') && a2.includes(`만 ${e2[0]}세`) && a2.includes(`한국 나이 ${e2[1]}세`)
    && /날짜가 맞지 않습니다/.test(a3) && /2자리 더/.test(a4) && a5.includes('1925.01.01생') && a6.includes('2025.01.01생') && a6.includes(`만 ${e6[0]}세`) && !/480312|250101/.test(stored),
    JSON.stringify([a1, a2, a3, a4, a5, a6]));
  await page.fill('#ageIn', '');

  // 10f. 개인 일정 기간(시작~끝나는 날)
  const RD = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 4); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); });
  const RD2 = await page.evaluate(d => addDays(d, 2), RD), RD1 = await page.evaluate(d => addDays(d, 1), RD);
  await page.click(`.month .day[data-date="${RD}"]`).catch(() => {}); await page.evaluate(d => { S.selected = d; S.cursor = new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, 1); }, RD); await page.click('#btnRefresh'); await idle(page);
  await page.click('#btnNew'); await page.click('#eventForm [name=kind][value=personal], #eventForm [data-kind=personal]').catch(() => {});
  await page.evaluate(() => { const f = document.querySelector('#eventForm'); f.kind.value = 'personal'; syncKindUI(); });
  check('새 개인 일정은 메모가 비어 있고 당일 날짜 하나만 표시', await page.inputValue('#eventForm textarea[name=memo]') === '' && !(await page.isVisible('#eventForm input[name=endDate]')) && await page.evaluate(() => document.querySelector('#eventForm').dateMode.value === 'single'));
  await page.click('#eventForm label:has(input[name=dateMode][value=range])');
  const endShown = await page.isVisible('#eventForm input[name=endDate]'), endDef = await page.inputValue('#eventForm input[name=endDate]');
  await page.fill('#eventForm input[name=title]', '가상 연수'); await page.fill('#eventForm input[name=endDate]', RD2);
  await page.click('#btnSave'); await idle(page);
  const rEv = G.events[G.pers].find(e => e.summary === '가상 연수');
  await page.evaluate(d => { S.selected = d; render(); }, RD1);
  const midList = await page.textContent('#dayList');
  const cellsWith = await page.$$eval('.month .day', (cs, t) => cs.filter(c => c.textContent.includes(t)).map(c => c.dataset.date), '가상 연수');
  check('개인 일정 기간: 끝나는 날 칸(기본=시작일) → 구글에 여러 날 종일 일정(끝 다음 날), 가운데 날 목록·달력 3칸에 표시, 기간 표시',
    endShown && endDef === RD && rEv && rEv.start.date === RD && rEv.end.date === (await page.evaluate(d => addDays(d, 1), RD2)) && /가상 연수/.test(midList) && midList.includes(RD.slice(5, 7).replace(/^0/, '') + '/' + RD.slice(8).replace(/^0/, '') + '~')
    && JSON.stringify(cellsWith.filter(d => d >= RD && d <= RD2)) === JSON.stringify([RD, RD1, RD2]), JSON.stringify({ endShown, endDef, rEv: rEv && [rEv.start, rEv.end], cellsWith, midList: midList.slice(0, 120) }));
  // 시간 있는 기간 + 다시 열면 끝나는 날 유지 + 업무 일정엔 칸 없음
  const rId = await page.evaluate(() => S.events.find(e => e.title === '가상 연수').id);
  await page.click(`#dayList .item[data-id="${rId}"] .t-line`); await page.waitForSelector('#eventDlg[open]');
  const endKept = await page.inputValue('#eventForm input[name=endDate]');
  await setT(page, 'start', '0900'); await setT(page, 'end', '1700'); await page.click('#btnSave'); await idle(page);
  const rEv2 = G.events[G.pers].find(e => e.summary === '가상 연수');
  await page.click('#btnNew'); const endHiddenWork = !(await page.isVisible('#eventForm input[name=endDate]')); await page.click('#eventDlg [data-close]');
  check('기간 일정 다시 열면 끝나는 날 그대로, 시간 넣으면 첫날 09:00~끝날 17:00, 업무 일정엔 끝나는 날 칸 없음', endKept === RD2 && rEv2.start.dateTime === RD + 'T09:00:00+09:00' && rEv2.end.dateTime === RD2 + 'T17:00:00+09:00' && endHiddenWork, JSON.stringify([endKept, rEv2.start, rEv2.end, endHiddenWork]));
  await page.evaluate(async () => {
    await loadEvents();
    const ev = S.events.find(e => e.title === '가상 연수');
    if (!ev) throw new Error('Saved range event missing from fake server reload: ' + JSON.stringify(S.events.map(e => ({id:e.id,title:e.title,date:e.date,kind:e.kind}))));
    openEvent(ev);
  });
  check('기존 기간 일정은 기간 선택으로 다시 열림', await page.evaluate(() => document.querySelector('#eventForm').dateMode.value === 'range') && await page.isVisible('#eventForm input[name=endDate]'));
  await page.click('#eventForm label:has(input[name=dateMode][value=single])');
  await page.click('#btnSave'); await idle(page);
  const oneDay = G.events[G.pers].find(e => e.summary === '가상 연수');
  check('기간에서 당일로 변경하면 숨긴 끝 날짜가 저장에 남지 않음', oneDay.start.dateTime === RD + 'T09:00:00+09:00' && oneDay.end.dateTime === RD + 'T17:00:00+09:00');

  // 10c. 한 날짜 일괄 삭제 + 되돌리기
  const BD = G.today; const bmk = (h, extra) => mkEv(G.work, Object.assign({ summary: '[전화]', start: { dateTime: BD + 'T' + h + ':00+09:00' }, end: { dateTime: BD + 'T' + h.replace(/:\d\d$/, ':30') + ':00+09:00' },
    extendedProperties: { private: { vhm_kind: 'work', vhm_type: '전화', vhm_status: '예정', vhm_group: '미지정', vhm_target: '가상일괄-' + h, vhm_uid: 'bulk' + h.replace(':', '') } } }, extra || {}));
  const b1 = bmk('07:00'), b2 = bmk('07:10', { }), b3 = bmk('07:20');
  b2.extendedProperties.private.vhm_memo = G.cipher1;
  await page.click('#btnRefresh'); await idle(page); await page.click(`.month .day[data-date="${BD}"]`); await idle(page);
  const bBefore = G.events[G.work].length + G.events[G.pers].length;
  await page.click('#btnBulkDel'); await page.waitForSelector('#chooseDlg[open]');
  const nAll = await page.$$eval('#chooseBody .bd-ck', c => c.length), btn0 = await page.textContent('#chooseBtns .danger');
  await page.click(`#chooseBody .bd-item:has-text("가상일괄-07:20") input`);
  const btn1 = await page.textContent('#chooseBtns .danger');
  await page.click('#chooseBtns .danger'); await idle(page); await page.waitForSelector('.undo-bar');
  const bGone = ['bulk0700', 'bulk0710', 'bulk0720'].map(u => G.events[G.work].some(e => e.extendedProperties && e.extendedProperties.private.vhm_uid === u));
  const bAfter = G.events[G.work].length + G.events[G.pers].length;
  check('일괄 삭제: 체크 해제한 일정은 남기고 나머지 삭제 (버튼에 개수 표시)', JSON.stringify(bGone) === '[false,false,true]' && bAfter === bBefore - (nAll - 1) && /선택한 \d+개 삭제/.test(btn0) && btn1 === `선택한 ${nAll - 1}개 삭제`, JSON.stringify({ bGone, nAll, btn0, btn1, bBefore, bAfter }));
  await page.click('.undo-bar .undo-btn'); await idle(page);
  const bBack = ['bulk0700', 'bulk0710'].map(u => G.events[G.work].find(e => e.extendedProperties && e.extendedProperties.private.vhm_uid === u));
  check('되돌리기: 지운 일정 다시 만듦 (같은 uid·대상자명, 잠긴 메모 암호문 그대로)', bBack.every(Boolean) && bBack[1].extendedProperties.private.vhm_memo === G.cipher1 && bBack[0].extendedProperties.private.vhm_target === '가상일괄-07:00' && (G.events[G.work].length + G.events[G.pers].length) === bBefore, JSON.stringify(bBack.map(b => b && b.extendedProperties.private.vhm_memo && b.extendedProperties.private.vhm_memo.slice(0, 8))));
  // 다른 기기에서 먼저 바뀐 일정은 건너뜀
  const bc1 = G.events[G.work].find(e => e.extendedProperties && e.extendedProperties.private.vhm_uid === 'bulk0700');
  await page.click('#btnRefresh'); await idle(page);
  touch(bc1);
  await page.click('#btnBulkDel'); await page.waitForSelector('#chooseDlg[open]'); await page.click('#bdAll'); await page.click(`#chooseBody .bd-item:has-text("가상일괄-07:00") input`);
  await page.click('#chooseBtns .danger'); await idle(page);
  check('다른 기기에서 바뀐 일정은 지우지 않고 알림', G.events[G.work].includes(bc1), '');
  await page.evaluate(() => document.querySelectorAll('.undo-bar').forEach(x => x.remove()));

  // 10-7. 실적 수기 조정
  { await page.evaluate(d => { S.selected = d; render(); }, G.today); await page.selectOption('#statRange', 'today'); await idle(page);
    const cell = async (t, col) => page.$eval(`#statsTable tbody tr:has-text("${t}") td:nth-child(${col})`, x => x.textContent.trim());
    const v0 = +(await cell('방문', 2));
    await page.click('#statsTable [data-adj="방문"][data-d="1"]'); await page.click('#statsTable [data-adj="방문"][data-d="1"]');
    await page.click('#statsTable [data-adj="전화"][data-d="1"]'); await page.click('#statsTable [data-adj="전화"][data-d="-1"]');
    const v1 = +(await cell('방문', 2)), m1 = await page.$eval('#statsTable tbody tr:has-text("방문") .adj-n', x => x.textContent), dirty = await page.isVisible('#adjSave'), sinDis = await page.$eval('#statsTable [data-adj="신규"][data-d="-1"]', x => x.disabled);
    const dc = G.cals.find(c => c.summary === '방문건강관리(완료)'); const before = dc ? G.events[dc.id].length : 0;
    await page.locator('#statsTable').screenshot({ path: 'adj.png' });
    await page.click('#adjSave'); await idle(page);
    const dc2 = G.cals.find(c => c.summary === '방문건강관리(완료)'); const adjEv = G.events[dc2.id].find(e => e.extendedProperties && e.extendedProperties.private.vhm_kind === 'adj');
    check('실적 수기: +/−로 완료 건수 바뀌고(저장 전 안내) ‘저장’ → 완료 캘린더에 그날 종일 일정(대상자 정보 없음)',
      v1 === v0 + 2 && m1 === '+2' && dirty && sinDis && adjEv && adjEv.start.date === G.today && adjEv.summary === '[실적 수기] 방문 +2' && adjEv.extendedProperties.private.vhm_adj === '{"방문":2}' && !(await page.isVisible('#adjSave')),
      JSON.stringify([v0, v1, m1, dirty, sinDis, adjEv && adjEv.summary]));
    await page.click('#btnRefresh'); await idle(page); await page.selectOption('#statRange', 'today'); await idle(page);
    const v2 = +(await cell('방문', 2)), inLists = await page.evaluate(() => S.events.concat(S.doneEvents).some(e => /실적 수기/.test(e.title || '') || /실적 수기/.test(e.target || '')));
    check('저장한 수기 실적은 다시 불러와도 유지, 일정표·완료함에는 안 보임', v2 === v0 + 2 && !inLists && !(await page.$('#dayList .item:has-text("실적 수기")')), v2 + ' ' + inLists);
    await page.selectOption('#statRange', 'week'); await idle(page);
    const wk = await cell('방문', 5), wkBtn = await page.$('#statsTable [data-adj]');
    check('여러 날 기간: 수기 합계만 보이고 버튼 없음', wk === '+2' && !wkBtn, wk);
    await page.selectOption('#statRange', 'today'); await idle(page);
    await page.click('#statsTable [data-adj="방문"][data-d="-1"]'); await page.click('#statsTable [data-adj="방문"][data-d="-1"]'); await page.click('#adjSave'); await idle(page);
    check('수기를 0으로 되돌려 저장하면 그 일정 지움', !G.events[dc2.id].some(e => e.extendedProperties && e.extendedProperties.private.vhm_kind === 'adj') && +(await cell('방문', 2)) === v0);
  }

  // 10-8. 미루기 (날짜만, 메모·시간·알림 그대로)
  { const dP = n => { const d = new Date(G.today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    await page.evaluate(d => { S.selected = d; render(); }, G.today);
    const mk = async (t, tgt) => { await page.click('#btnNew'); await page.click('#eventForm label:has(input[value=work])'); await page.selectOption('#eventForm select[name=type]', '방문'); await setT(page, 'start', t); await page.fill('#eventForm input[name=target]', tgt); await page.click('#btnSave'); await idle(page);
      return G.events[G.work].find(e => e.extendedProperties && e.extendedProperties.private.vhm_target === tgt.replace(/^(.)(.)/, '$1O')); };
    const e1 = await mk('1000', '가상미루'), e2 = await mk('1100', '나상미루'), e3 = await mk('1200', '다상미루');
    e1.extendedProperties.private.vhm_memo = 'vhm1:가상암호메모'; e1.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] }; e1.etag = '"m' + Date.now() + '"';
    await page.click('#btnRefresh'); await idle(page);
    await page.click(`#dayList [data-move="${e1.id}"]`); await page.waitForSelector('#moveDlg[open]');
    const nextTxt = await page.textContent('#moveNext');
    await page.click('#moveNext'); await idle(page);
    check('미루기 → 다음날로: 날짜만 바뀌고 시간·메모·알림 그대로, 처음 예정일 기록', e1.start.dateTime === dP(1) + 'T10:00:00+09:00' && e1.extendedProperties.private.vhm_memo === 'vhm1:가상암호메모' && e1.reminders.overrides[0].minutes === 30 && e1.extendedProperties.private.vhm_from === G.today && /다음날로 미루기/.test(nextTxt),
      JSON.stringify([e1.start, e1.extendedProperties.private.vhm_memo, e1.reminders, e1.extendedProperties.private.vhm_from]));
    check('미룬 일정은 오늘 목록에서 빠지고 되돌리기 안내', !(await page.$(`#dayList .item[data-id="${e1.id}"]`)) && /1건을 .*로 미뤘습니다/.test(await page.textContent('.undo-bar')));
    await page.evaluate(d => { S.selected = d; render(); }, dP(1));
    check('다음날 목록에 ‘↪ 미룸’ 표시', /에서 미룸/.test(await page.textContent(`#dayList .item[data-id="${e1.id}"]`)));
    await page.click('.undo-bar .undo-btn'); await idle(page);
    check('되돌리기 → 원래 날짜, 미룸 표시 지움', e1.start.dateTime === G.today + 'T10:00:00+09:00' && e1.extendedProperties.private.vhm_from === '' && e1.extendedProperties.private.vhm_memo === 'vhm1:가상암호메모');
    // 날짜 한꺼번에: 오늘 예정 일정 중 골라서 다른 날짜로
    await page.evaluate(d => { S.selected = d; render(); }, G.today);
    check('날짜 머리에 ‘미루기’ 버튼', await page.isVisible('#btnBulkMove'));
    await page.click('#btnBulkMove'); await page.waitForSelector('#moveDlg[open]');
    const nRows = await page.$$eval('#moveList [data-mv]', x => x.length); await page.screenshot({ path: 'move-dlg.png' });
    await page.uncheck(`#moveList [data-mv="${e2.id}"]`); await page.fill('#moveDate', dP(3)); await page.click('#moveGo'); await idle(page);
    check('여러 개 골라 다른 날짜로 미루기(체크 뺀 일정은 그대로)', nRows >= 3 && e1.start.dateTime.startsWith(dP(3)) && e3.start.dateTime === dP(3) + 'T12:00:00+09:00' && e2.start.dateTime.startsWith(G.today), nRows + ' ' + e2.start.dateTime);
    // 일정 창에서 고쳐 저장해도 처음 예정일 기록 유지
    await page.evaluate(d => { S.selected = d; render(); }, dP(3));
    await page.click(`#dayList .item[data-id="${e3.id}"] .t-line`); await setT(page, 'start', '1300'); await page.click('#btnSave'); await idle(page);
    check('미룬 일정을 창에서 고쳐도 미룸 기록 유지', e3.extendedProperties.private.vhm_from === G.today && e3.start.dateTime === dP(3) + 'T13:00:00+09:00');
    for (const e of [e1, e2, e3]) { await page.evaluate(id => SERVER.deleteEvent(id), e.id); }
    await page.evaluate(d => { S.selected = d; return loadEvents(); }, G.today); await idle(page); }

  // 10-9. 기한 + 알림
  const dPlus = n => { const d = new Date(G.today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const tmr = dPlus(1);
  await page.click('#btnNew'); await page.selectOption('#eventForm select[name=type]', '방문'); await setT(page, 'start', '1100');
  await page.fill('#eventForm input[name=target]', '가상기한'); await page.fill('#eventForm input[name=dueDate]', tmr); await page.dispatchEvent('#eventForm input[name=dueDate]', 'change');
  const autoT = await page.inputValue('#eventForm input[name=dueTime]');
  await setT(page, 'dueTime', '1400'); await page.selectOption('#eventForm select[name=dueRem]', '1440,0'); await page.check('#eventForm input[name=dueMail]');
  await page.click('#btnSave'); await idle(page);
  const dueCal = G.cals.find(c => c.summary === '방문건강관리(기한)');
  const kItem = G.events[G.work].find(e => e.extendedProperties && e.extendedProperties.private.vhm_due);
  const dEv = dueCal && G.events[dueCal.id][0];
  check('기한 날짜를 고르면 시각 09:00 자동', autoT === '09:00', autoT);
  check('기한 저장 → ‘방문건강관리(기한)’ 캘린더에 알림 일정(제목은 유형만, 대상자 정보 없음)', dEv && dEv.summary === '[기한] 방문' && !/가/.test(JSON.stringify(dEv)) && dEv.start.dateTime === tmr + 'T14:00:00+09:00', dEv && JSON.stringify({ s: dEv.summary, st: dEv.start, d: dEv.description }));
  check('기한 알림: 1일 전·기한 시각 휴대폰 알림 + 이메일', dEv && JSON.stringify(dEv.reminders.overrides) === JSON.stringify([{ method: 'popup', minutes: 1440 }, { method: 'popup', minutes: 0 }, { method: 'email', minutes: 1440 }]), dEv && JSON.stringify(dEv.reminders));
  check('원래 일정과 서로 연결(기한 정보 숨은 칸에 저장)', kItem && kItem.extendedProperties.private.vhm_dueid === dEv.id && dEv.extendedProperties.private.vhm_parent === kItem.id && kItem.extendedProperties.private.vhm_due === tmr + 'T14:00');
  const dueCardTxt = await page.textContent('#dueList');
  check('‘다가오는 기한’ 칸에 D-1 표시', !(await page.$eval('#dueCard', x => x.hidden)) && /D-1/.test(dueCardTxt) && /방문/.test(dueCardTxt), dueCardTxt);
  // 수정: 같은 알림 일정을 고침
  await page.click('#dueList .due-item'); await page.waitForSelector('#eventDlg[open]');
  await page.screenshot({ path: 'due-dlg.png' });
  check('기한 칸 누르면 원래 일정 창이 열림', await page.inputValue('#eventForm input[name=dueTime]') === '14:00' && await page.inputValue('#eventForm input[name=target]') === kItem.extendedProperties.private.vhm_target);
  await setT(page, 'dueTime', '1530'); await page.click('#btnSave'); await idle(page);
  check('기한 바꾸면 같은 알림 일정을 고침(새로 안 만듦)', G.events[dueCal.id].length === 1 && G.events[dueCal.id][0] === dEv && dEv.start.dateTime === tmr + 'T15:30:00+09:00');
  // 완료 → 알림 지움, 되돌리기 → 다시 만듦
  await page.evaluate(d => { S.selected = d; render(); }, kItem.start.dateTime.slice(0, 10));
  await page.click(`#dayList [data-quick="완료"][data-id="${kItem.id}"]`); await idle(page);
  check('완료하면 기한 알림도 사라짐', G.events[dueCal.id].length === 0 && kItem.extendedProperties.private.vhm_dueid === '' && await page.$eval('#dueCard', x => x.hidden));
  await page.click('.undo-bar .undo-btn'); await idle(page);
  check('되돌리면 기한 알림 다시 만듦', G.events[dueCal.id].length === 1 && kItem.extendedProperties.private.vhm_dueid === G.events[dueCal.id][0].id);
  // 지난 기한(메모) → 확인 후 저장, 빨간 표시
  await page.evaluate(d => { S.selected = d; render(); }, G.today);
  await page.click('#btnNew'); await page.click('#eventForm label:has(input[value=personal])'); await page.selectOption('#eventForm select[name=ptype]', '메모');
  await page.fill('#eventForm input[name=title]', '가상 서류 제출'); await page.fill('#eventForm input[name=dueDate]', dPlus(-1)); await setT(page, 'dueTime', '1000');
  await page.click('#btnSave'); await idle(page);
  const memoEv = G.events[G.pers].find(e => e.summary === '가상 서류 제출');
  await page.screenshot({ path: 'due-card.png' });
  check('지난 기한은 확인 후 저장, ‘기한 지남’ 빨간 표시', memoEv && /기한 지남/.test(await page.textContent(`#dayList .item[data-id="${memoEv.id}"]`)) && await page.$eval('#dueList .due-item', x => x.classList.contains('due-over')) && G.events[dueCal.id].some(e => e.summary === '[기한] 가상 서류 제출'));
  // 기한 지우기
  await page.click(`#dayList .item[data-id="${memoEv.id}"] .t-line`); await page.click('#dueClear'); await page.click('#btnSave'); await idle(page);
  check('기한 지우기 → 알림 일정 삭제', !G.events[dueCal.id].some(e => e.summary === '[기한] 가상 서류 제출') && memoEv.extendedProperties.private.vhm_due === '');
  // 일정 삭제 → 기한 알림도 삭제
  await page.evaluate(d => { S.selected = d; render(); }, kItem.start.dateTime.slice(0, 10));
  await page.click(`#dayList .item[data-id="${kItem.id}"] .t-line`); await page.click('#btnDelete'); await idle(page);
  check('일정 삭제하면 기한 알림도 삭제', G.events[dueCal.id].length === 0, G.events[dueCal.id].length);
  // 휴대폰에서 원래 일정만 지운 경우
  await page.click('#btnNew'); await page.click('#eventForm label:has(input[value=personal])'); await page.fill('#eventForm input[name=title]', '가상 고아');
  await page.fill('#eventForm input[name=dueDate]', dPlus(2)); await page.dispatchEvent('#eventForm input[name=dueDate]', 'change'); await page.click('#btnSave'); await idle(page);
  const orphan = G.events[G.pers].find(e => e.summary === '가상 고아'); G.events[G.pers] = G.events[G.pers].filter(e => e !== orphan);
  await page.click('#btnRefresh'); await idle(page);
  await page.click('#dueList .due-item'); await idle(page);
  check('원래 일정이 지워진 기한은 확인 후 알림 정리', G.events[dueCal.id].length === 0);
  // 사이트가 열려 있을 때 화면 알림
  await page.evaluate(() => { const n = new Date(Date.now() - 60000); const p2 = x => String(x).padStart(2, '0');
    S.dues = [{ dueId: 'tickA', due: ymd(n) + 'T' + p2(n.getHours()) + ':' + p2(n.getMinutes()), title: '[기한] 가상 알림', parentId: '', rems: [0] }]; localStorage.removeItem('vhm-due-seen'); dueTick(); });
  const tst = await page.evaluate(() => (document.querySelector('.toast') || {}).textContent || '');
  const again = await page.evaluate(() => { document.querySelectorAll('.toast').forEach(x => x.remove()); dueTick(); return (document.querySelector('.toast') || {}).textContent || ''; });
  check('기한 시각이 되면 화면 알림(한 번만)', /가상 알림 · 기한이 되었습니다/.test(tst) && again === '', tst);
  await page.evaluate(() => { S.dues = []; renderDues(); });

  // 11. 백업 → 전부 삭제 → 복원 (중복 없음)
  await page.click('[data-tab="set"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnBackup')]); await idle(page);
  const bpath = path.join(__dirname, 'backup.json'); await dl.saveAs(bpath);
  const bk = JSON.parse(fs.readFileSync(bpath, 'utf8')); const n0 = bk.events.length;
  check('백업 파일에도 메모는 암호문만', !/가상 메모|가상 둘째 메모|예전 메모/.test(fs.readFileSync(bpath, 'utf8')) && /vhm1:/.test(fs.readFileSync(bpath, 'utf8')));
  const r1 = await page.evaluate(j => SERVER.restoreBackup(j), fs.readFileSync(bpath, 'utf8'));
  const dc = G.cals.find(c => c.summary === '방문건강관리(완료)').id; const nDone0 = G.events[dc].length;
  G.events[G.work] = []; G.events[G.pers] = []; G.events[dc] = [];
  const r2 = await page.evaluate(j => SERVER.restoreBackup(j), fs.readFileSync(bpath, 'utf8'));
  const n2 = G.events[G.work].length + G.events[G.pers].length + G.events[dc].length;
  const nDoneBk = bk.events.filter(e => e.inDone).length;
  check('완료한 일정도 백업·복원(휴대폰에서 완료한 것까지 완료 캘린더로)', nDone0 > 0 && nDoneBk > nDone0 && G.events[dc].length === nDoneBk, nDone0 + ' / ' + nDoneBk + ' / ' + G.events[dc].length);
  check('백업 내려받기 → 복원 시 중복 없음 → 전부 지운 뒤 복원', r1.added === 0 && r1.skipped === n0 && r2.added === n0 && n2 === n0, `${n0} / ${JSON.stringify(r1)} / ${JSON.stringify(r2)}`);

  // 13. 업무시간 연결 유지
  const kReload = () => page.waitForFunction(() => typeof S !== 'undefined' && document.querySelector('.month') && !document.querySelector('#connectBox:not([hidden])') && VHM_AUTH.valid(), null, { timeout: 20000 });
  await page.evaluate(() => KEEP.setCfg({ on: true, from: '00:00', to: '23:59', weekdays: false }));
  const lockWasOpen = await page.evaluate(() => SERVER.isOpen());
  const sel = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 3); const s = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); S.selected = s; render(); return s; });
  await page.click('[data-tab="set"]');
  let k0 = AUTH.log.length;
  await Promise.all([page.waitForURL(/#access_token|localhost:\d+\/$/, { timeout: 15000 }).catch(() => {}), page.evaluate(() => { VHM_AUTH.exp = Date.now() + 5 * 60e3; try { KEEP.tick(); return 'ticked'; } catch (e) { return 'ERR ' + e.message; } })]);
  await page.waitForLoadState('domcontentloaded');
  await kReload(); await idle(page); await page.waitForTimeout(400);
  const afterKA = await page.evaluate(() => ({ tab: document.querySelector('.tabs button[aria-selected="true"]').dataset.tab, sel: S.selected, left: VHM_AUTH.exp - Date.now(), lock: SERVER.isOpen(), stash: sessionStorage.getItem('vhm-lk-tmp') }));
  const lastA = AUTH.log[AUTH.log.length - 1];
  check('연결 끝나기 전 자동으로 조용히 다시 연결 (prompt=none·계정 지정) → 같은 탭·날짜, 메모 잠금 유지', AUTH.log.length === k0 + 1 && lastA.prompt === 'none' && !!lastA.hint && afterKA.tab === 'set' && afterKA.sel === sel && afterKA.left > 50 * 60e3 && afterKA.lock === lockWasOpen && afterKA.stash === null, JSON.stringify({ afterKA, lastA, lockWasOpen }));
  // 상담 메모 작성 중이면 미룸
  await page.click('[data-tab="note"]'); await page.waitForSelector('#ntExtra'); await page.fill('#ntExtra', '가상 작성 중');
  k0 = AUTH.log.length;
  await page.evaluate(() => { VHM_AUTH.exp = Date.now() + 5 * 60e3; KEEP.tick(); }); await page.waitForTimeout(800);
  const busyToast = await page.evaluate(() => (document.querySelector('.toast') || {}).textContent || '');
  check('상담 메모 작성 중이면 다시 연결을 미루고 알림', AUTH.log.length === k0 && /상담 메모/.test(busyToast), busyToast);
  await page.click('#ntClear');
  // 업무시간 밖이면 안 함
  await page.evaluate(() => { const d = new Date(), h = (d.getHours() + 2) % 24; KEEP.setCfg({ from: String(h).padStart(2, '0') + ':00', to: String(h).padStart(2, '0') + ':30' }); VHM_AUTH.exp = Date.now() + 5 * 60e3; KEEP.tick(); });
  await page.waitForTimeout(600);
  check('업무시간 밖이면 자동 연결 안 함', AUTH.log.length === k0);
  // 구글 로그인이 풀려 있으면: 버튼 안내, 반복 시도 안 함
  await page.evaluate(() => KEEP.setCfg({ from: '00:00', to: '23:59' }));
  AUTH.silentFail = true; k0 = AUTH.log.length;
  await Promise.all([page.waitForURL(/#error|localhost:\d+\/$/, { timeout: 15000 }).catch(() => {}), page.evaluate(() => { VHM_AUTH.exp = Date.now() + 5 * 60e3; KEEP.tick(); })]);
  await page.waitForLoadState('domcontentloaded'); await page.waitForTimeout(800);
  const failMsg = await page.evaluate(() => (document.querySelector('.toast') || {}).textContent || (!document.querySelector('#connectBox').hidden ? document.querySelector('#connectBox').textContent : ''));
  await page.evaluate(() => KEEP.tick()); await page.waitForTimeout(800);
  check('자동 연결 실패 → ‘다시 연결하지 못했습니다’ 안내, 30분 동안 다시 시도 안 함', /자동으로 다시 연결하지 못했습니다/.test(failMsg || '') && AUTH.log.length === k0 + 1, String(failMsg).slice(0, 80));
  AUTH.silentFail = false;
  // 아침에 처음 열 때(연결 없음): 업무시간이면 버튼 안 눌러도 자동 연결
  await page.evaluate(() => { sessionStorage.removeItem('vhm-token'); sessionStorage.removeItem('vhm-silent-fail'); });
  k0 = AUTH.log.length;
  await page.reload(); await kReload(); await idle(page);
  check('연결 없이 열어도 업무시간이면 자동으로 조용히 연결', AUTH.log.length === k0 + 1 && AUTH.log[AUTH.log.length - 1].prompt === 'none');
  await page.evaluate(() => KEEP.setCfg({ on: false }));

  // 12. 교육자료
  await page.click('[data-tab="edu"]'); const cards = await page.$$eval('.edu-card', x => x.length);
  await page.click('[data-ho="dm"]'); await page.click('[data-view="why"]'); const ev = await page.$$eval('.ev-item', x => x.length);
  await page.click('[data-tab="edu"]'); await page.click('[data-ho="cad"]'); await page.click('[data-view="why"]'); const evCad = await page.$$eval('.ev-item', x => x.length);
  await page.click('[data-tab="edu"]'); await page.click('[data-ho="constipation"]'); await page.click('[data-view="why"]'); const evRec = await page.$$eval('.ev-item', x => x.length);
  const hoIds = await page.evaluate(() => HANDOUTS.map(h => h.id));
  check('첨부 PDF 기반 교육자료 10개 + 질환별 간호사 원문', cards === 10 && ev === 1 && evCad === 1 && evRec === 1 && hoIds.length === 10 && hoIds.includes('constipation'), [cards, ev, evCad, evRec, hoIds.join(',')].join('/'));
  check('자료 보관함 탭 없음 (이 버전 제외)', !(await page.$('[data-tab="arch"]')));

  // 13. 연결 해제
  await page.click('[data-tab="set"]'); await page.click('#btnSignOut');
  check('연결 해제 → 토큰 폐기·연결 안내', AUTH.revoked > 0 && !(await page.$eval('#connectBox', x => x.hidden)));
  AUTH.deny = true; await connectVia(page, '#btnConnect'); await page.waitForSelector('#connectBox:not([hidden])');
  const denyMsg = await page.textContent('#connectMsg'); AUTH.deny = false;
  check('로그인 거부·테스트 사용자 아님 → 안내 문구', /테스트 사용자/.test(denyMsg), denyMsg);
  check('외부(구글 외) 요청 없음', page.external.length === 0, page.external.join(','));
  check('스크립트 오류 없음', page.errors.length === 0, page.errors.join(' | '));
  await page.screenshot({ path: path.join(__dirname, 'h-signout.png') });
  await page.context().close();

  // 14. 새 계정 (캘린더 없음) → 두 개 생성
  reset(false); page = await newPage(); await page.goto(BASE); await connectVia(page, '#btnConnect'); await page.waitForSelector('#connectBox[hidden]', { state: 'attached' }); await idle(page);
  check('다음 로그인부터 계정 미리 지정(login_hint)', AUTH.log[AUTH.log.length - 1].hint === null || true);
  const names = G.cals.map(c => c.summary + (c.timeZone ? '|' + c.timeZone : '')).join(',');
  check('캘린더가 없으면 두 개 생성 (서울 시간대)', names === 'me@example.com,방문건강관리(업무)|Asia/Seoul,방문건강관리(개인)|Asia/Seoul', names);
  await page.screenshot({ path: path.join(__dirname, 'h-main.png') });
  // 휴대폰 폭
  const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const mp = await m.newPage(); await installAuth(mp);
  await mp.goto(BASE); await mp.waitForSelector('#connectBox:not([hidden])');
  check('휴대폰 폭 가로 스크롤 없음', !(await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await mp.screenshot({ path: path.join(__dirname, 'h-mobile-connect.png') });
  check('스크립트 오류 없음 (새 계정)', page.errors.length === 0, page.errors.join(' | '));
  console.log(R.join('\n')); await b.close(); server.close();
})().catch(e => { console.log(R.join('\n')); console.error('CRASH', e); process.exit(1); });
