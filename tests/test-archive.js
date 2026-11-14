// 보관함 탭 테스트: 가짜 로그인 + 가짜 Calendar + 가짜 Drive(이어올리기·만료·용량). 모두 가상 파일.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const { A: AUTH, install: installAuth, connectVia } = require('./fake-auth.js');
const SITE = require('path').join(__dirname, '..', 'site');
const R = []; const check = (n, ok, info = '') => R.push(`${ok ? 'PASS' : 'FAIL'} ${n}${info ? ' — ' + info : ''}`);
let seq = 0; const nid = p => p + (++seq).toString(36);
const FOLDER = 'application/vnd.google-apps.folder', DAY = 864e5;
const G = { cals: [{ id: 'me@example.com', summary: 'me@example.com', primary: true, accessRole: 'owner' }], events: { 'me@example.com': [] }, files: [], sessions: {}, log: [], failPutOnce: false, hold: null };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Location, Range', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE' };
function meta(f) { return { id: f.id, name: f.name, size: String(f.content.length), createdTime: f.createdTime, appProperties: f.appProperties || {}, mimeType: f.mimeType }; }
async function api(method, url, headers, buf) {
  const u = new URL(url); const p = u.pathname; G.log.push(method + ' ' + p + (u.searchParams.get('uploadType') ? '?' + u.searchParams.get('uploadType') : ''));
  if (method === 'OPTIONS') return [204, null];
  const uid = u.searchParams.get('upload_id');
  if (!uid && !(headers['authorization'] || '').startsWith('Bearer tok')) return [401, { error: { message: 'no auth' } }];
  const json = () => JSON.parse(buf.toString('utf8'));
  if (p === '/calendar/v3/users/me/calendarList') return [200, { items: G.cals }];
  if (method === 'POST' && p === '/calendar/v3/calendars') { const c = { id: nid('cal') + '@group', summary: json().summary, accessRole: 'owner' }; G.cals.push(c); G.events[c.id] = []; return [200, c]; }
  let m;
  if ((m = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(p))) { const cid = decodeURIComponent(m[1]);
    if (method === 'GET') return [200, { items: G.events[cid] || [] }];
    const ev = Object.assign({ id: nid('ev'), etag: '"' + seq + '"', status: 'confirmed' }, json()); G.events[cid].push(ev); return [200, ev]; }
  if (p === '/drive/v3/about') return [200, { storageQuota: { limit: String(15 * 1024 ** 3), usage: String(3 * 1024 ** 3) } }];
  if (p === '/drive/v3/files' && method === 'GET') {
    const q = u.searchParams.get('q');
    const name = (/name='((?:[^'\\]|\\.)*)'/.exec(q) || [])[1], mime = (/mimeType='([^']+)'/.exec(q) || [])[1], par = (/'([^']+)' in parents/.exec(q) || [])[1];
    return [200, { files: G.files.filter(f => !f.trashed && (!name || f.name === name) && (!mime || f.mimeType === mime) && (!par || f.parents.includes(par))).map(meta) }];
  }
  if (p === '/drive/v3/files' && method === 'POST') { const md = json(); const f = { id: nid('f'), name: md.name, mimeType: md.mimeType, parents: md.parents || [], createdTime: new Date().toISOString(), content: Buffer.alloc(0) }; G.files.push(f); return [200, { id: f.id }]; }
  // 이어올리기 시작
  if (p === '/upload/drive/v3/files' && method === 'POST' && u.searchParams.get('uploadType') === 'resumable') {
    const md = json(), id = nid('up'); G.sessions[id] = { md, total: Number(headers['x-upload-content-length']), got: Buffer.alloc(0) };
    return [200, '', 'application/json', { Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=' + id }];
  }
  if (p === '/upload/drive/v3/files' && method === 'PUT' && uid) {
    const s = G.sessions[uid], cr = headers['content-range'] || '';
    if (G.hold) await G.hold;
    if (/^bytes \*\//.test(cr)) { if (s.done) return [200, { id: s.done }]; return [308, '', 'text/plain', s.got.length ? { Range: 'bytes=0-' + (s.got.length - 1) } : {}]; }
    if (G.failPutOnce && s.got.length > 0) { G.failPutOnce = false; return [503, { error: { message: 'busy' } }]; }
    const mm = /bytes (\d+)-(\d+)\/(\d+)/.exec(cr); const start = Number(mm[1]);
    if (start !== s.got.length) return [400, { error: { message: 'bad offset ' + start + ' vs ' + s.got.length } }];
    s.got = Buffer.concat([s.got, buf]);
    if (s.got.length < s.total) return [308, '', 'text/plain', { Range: 'bytes=0-' + (s.got.length - 1) }];
    const f = { id: nid('f'), name: s.md.name, mimeType: 'application/octet-stream', parents: s.md.parents || [], createdTime: new Date().toISOString(), appProperties: s.md.appProperties, content: s.got };
    G.files.push(f); s.done = f.id; return [200, { id: f.id }];
  }
  if ((m = /^\/drive\/v3\/files\/([^/]+)$/.exec(p))) { const f = G.files.find(x => x.id === m[1]); if (!f) return [404, { error: { message: 'nf' } }];
    if (method === 'GET' && u.searchParams.get('alt') === 'media') return [200, f.content, 'application/octet-stream'];
    if (method === 'DELETE') { G.files = G.files.filter(x => x !== f); return [204, null]; }
    if (method === 'PATCH') { const b = json(); if (b.appProperties) f.appProperties = Object.assign({}, f.appProperties, b.appProperties); return [200, { id: f.id }]; } }
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
  const dialogs = [];
  async function newPage(drive = true, opt = {}) {
    const ctx = await b.newContext({ viewport: opt.vp || { width: 1280, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', acceptDownloads: true });
    const page = await ctx.newPage(); page.errors = []; page.on('pageerror', e => page.errors.push(e.message)); page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    await page.addInitScript(() => { try { localStorage.setItem('vhm-keep', JSON.stringify({ on: false })); } catch (e) {} });
    if (opt.noPicker) await page.addInitScript(() => { delete window.showSaveFilePicker; window.showSaveFilePicker = undefined; const c0 = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__aName = this.download; return c0.call(this); }; });
    else await page.addInitScript(() => { window.__saved = []; window.showSaveFilePicker = async o => ({ createWritable: async () => { const parts = []; return { write: async c => parts.push(Array.from(c)), close: async () => window.__saved.push({ name: o.suggestedName, bytes: parts.flat() }), abort: async () => {} }; } }); });
    AUTH.driveOk = drive; AUTH.granted.clear(); AUTH.log = []; await installAuth(page);
    await page.route('https://www.googleapis.com/**', async r => { const q = r.request(); const [st, js, ct, hd] = await api(q.method(), q.url(), q.headers(), q.postDataBuffer() || Buffer.alloc(0));
      await r.fulfill({ status: st, headers: Object.assign({}, CORS, hd || {}), contentType: ct || 'application/json', body: Buffer.isBuffer(js) ? js : (js == null ? '' : (typeof js === 'string' ? js : JSON.stringify(js))) }); });
    await page.goto(BASE); await connectVia(page, '#btnConnect'); await page.waitForSelector('#connectBox[hidden]', { state: 'attached' });
    return page;
  }
  const idle = p => p.waitForFunction(() => !document.querySelector('#sync .spin'), null, { timeout: 10000 });
  const listNames = p => p.$$eval('#arList .ar-name', xs => xs.map(x => x.textContent));

  // 0. 드라이브 권한 없음 → 연결 버튼, 업로드 영역 숨김
  let page = await newPage(false); await idle(page);
  await page.click('[data-tab="box"]'); await page.waitForSelector('#arDrive', { state: 'visible' });
  check('드라이브 권한이 없으면 ‘구글 드라이브 연결’ 버튼만 보임', await page.$eval('#arApp', x => x.hidden) && await page.isVisible('#arDrive'));
  check('보관함 탭에 개인정보·건강정보 금지 안내와 확인 칸', /건강정보/.test(await page.textContent('#tab-box .ar-warn')) && !(await page.isChecked('#arAck')));
  await page.context().close();

  // 1. 만료 파일 준비(가상): 보관함 폴더 안 만료 1개·유효 1개, 다른 폴더 파일 1개
  G.files.push({ id: 'fold1', name: '방문건강관리 임시보관함', mimeType: FOLDER, parents: [], createdTime: new Date().toISOString(), content: Buffer.alloc(0) });
  G.files.push({ id: 'old1', name: '가상_만료.txt', mimeType: 'text/plain', parents: ['fold1'], createdTime: new Date(Date.now() - 8 * DAY).toISOString(), appProperties: { vhm_exp: String(Date.now() - DAY) }, content: Buffer.from('old') });
  G.files.push({ id: 'live1', name: '가상_유효.txt', mimeType: 'text/plain', parents: ['fold1'], createdTime: new Date(Date.now() - 6.5 * DAY).toISOString(), appProperties: { vhm_exp: String(Date.now() + 0.5 * DAY) }, content: Buffer.from('hello 보관함') });
  G.files.push({ id: 'other1', name: 'vhm-links.json', mimeType: 'application/json', parents: ['zzz'], createdTime: new Date(Date.now() - 30 * DAY).toISOString(), content: Buffer.from('{}') });

  page = await newPage(true); await idle(page);
  await page.click('[data-tab="box"]'); await page.waitForSelector('#arDrive', { state: 'visible' });
  await connectVia(page, '#arDrive'); await idle(page);
  await page.waitForSelector('#tab-box:not([hidden]) #arApp:not([hidden])', { timeout: 10000 });
  check('드라이브 연결 후 보관함 탭으로 돌아옴', await page.$eval('#tab-box', x => !x.hidden) && AUTH.log.some(x => /drive\.file/.test(x.scope)), JSON.stringify(AUTH.log.map(x => x.scope)));
  await page.waitForFunction(() => document.querySelectorAll('#arList .ar-item').length === 1, null, { timeout: 8000 }).catch(() => {});
  check('기존 폴더 재사용(새 폴더 안 만듦)', G.files.filter(f => f.mimeType === FOLDER).length === 1);
  check('만료 파일은 열 때 영구 삭제, 다른 폴더 파일은 그대로', !G.files.some(f => f.id === 'old1') && G.files.some(f => f.id === 'other1') && G.log.includes('DELETE /drive/v3/files/old1'));
  check('유효 파일만 목록에 표시, 남은 시간이 하루 미만이면 강조', JSON.stringify(await listNames(page)) === '["가상_유효.txt"]' && await page.$eval('#arList .ar-left', x => x.classList.contains('soon') && /시간/.test(x.textContent)));
  check('저장공간 표시', /3 GB 사용 \/ 15 GB/.test(await page.textContent('#arQuotaTxt')), await page.textContent('#arQuotaTxt'));
  check('확인 칸 체크 전에는 파일 선택 불가', await page.$eval('#arPick', x => x.disabled));

  // 2. 확인 없이 파일 넣기 → 막힘
  dialogs.length = 0; const before = G.files.length;
  await page.setInputFiles('#arFile', { name: '가상.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }); await page.waitForTimeout(300);
  check('확인 칸 체크 없이 올리면 막힘', G.files.length === before && dialogs.some(d => /확인 칸/.test(d)));

  // 3. 이어올리기: 17MB (8MB씩 3번), 중간에 한 번 실패 → 위치 물어 이어서
  await page.check('#arAck'); check('체크하면 파일 선택 가능', !(await page.$eval('#arPick', x => x.disabled)));
  const big = Buffer.alloc(17 * 1024 * 1024); for (let i = 0; i < big.length; i += 4096) big[i] = (i / 4096) & 255;
  G.failPutOnce = true; let release; G.hold = new Promise(r => { release = r; });
  await page.setInputFiles('#arFile', { name: '가상_큰자료.bin', mimeType: 'application/octet-stream', buffer: big });
  await page.waitForTimeout(400);
  const busyMid = await page.evaluate(() => [ARCHIVE.busy(), KEEP.busyReason()]);
  check('올리는 동안 연결 유지가 기다림(작업 중으로 인식)', busyMid[0] === true && /보관함/.test(busyMid[1]), JSON.stringify(busyMid));
  G.hold = null; release();
  await page.waitForFunction(() => /업로드 완료/.test(document.querySelector('#arQueue').textContent), null, { timeout: 30000 }).catch(() => {});
  const up = G.files.find(f => f.name === '가상_큰자료.bin');
  const puts = G.log.filter(x => x.startsWith('PUT')).length;
  check('큰 파일이 조각으로 올라가고 실패 후 이어서 완료(내용 동일)', up && up.content.equals(big) && puts >= 4, 'PUT ' + puts);
  const exp = up && Number(up.appProperties.vhm_exp);
  check('7일 후 삭제 시각이 붙음', exp && Math.abs(exp - (Date.now() + 7 * DAY)) < 60e3);
  await page.waitForFunction(() => /가상_큰자료/.test(document.getElementById('arList').textContent), null, { timeout: 5000 }).catch(() => {});
  check('완료 후 목록에 추가', (await listNames(page)).includes('가상_큰자료.bin') && !(await page.evaluate(() => ARCHIVE.busy())));

  // 4. 빈 파일·2GB 초과 막기 (크기만 흉내)
  await page.evaluate(() => { const f = new File([], '빈파일.txt'); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('arFile'); i.files = dt.files; i.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(200);
  check('빈 파일은 거절', /빈 파일은 올릴 수 없습니다/.test(await page.textContent('#arQueue')));
  await page.evaluate(() => { const fake = { name: '너무큼.iso', size: 3 * 1024 ** 3, type: '' }; document.getElementById('arDrop').dispatchEvent(Object.assign(new Event('drop', { cancelable: true }), { dataTransfer: { files: [fake] } })); });
  await page.waitForTimeout(200);
  check('2GB 넘는 파일은 거절', /최대 2 GB/.test(await page.textContent('#arQueue')));

  // 5. 내려받기 (저장 위치 고르는 방식)
  await page.click('#arList [data-ardl="live1"]');
  await page.waitForFunction(() => window.__saved.length === 1, null, { timeout: 8000 }).catch(() => {});
  const saved = await page.evaluate(() => window.__saved[0]);
  check('내려받기(저장 위치 선택 방식): 내용 일치', saved && saved.name === '가상_유효.txt' && Buffer.from(saved.bytes).toString() === 'hello 보관함');

  // 6. 삭제
  await page.click('#arList [data-ardel="live1"]'); await page.waitForTimeout(400);
  check('삭제 확인 후 영구 삭제', !G.files.some(f => f.id === 'live1') && !(await listNames(page)).includes('가상_유효.txt') && dialogs.some(d => /영구 삭제/.test(d)));

  // 7. 1분마다 정리: 시간을 당겨 만료시킴
  up.appProperties.vhm_exp = String(Date.now() - 1000);
  await page.evaluate(() => { ARCHIVE._state.files.forEach(f => { if (f.name === '가상_큰자료.bin') f.appProperties.vhm_exp = String(Date.now() - 1000); }); });
  await page.click('#arRefresh'); await page.waitForTimeout(500);
  check('만료되면 목록에서 사라지고 드라이브에서도 삭제', !G.files.some(f => f.name === '가상_큰자료.bin') && (await listNames(page)).length === 0 && /만료된 파일 1개/.test(await page.textContent('#arClean')));

  // 8. 다른 탭 영향 없음 + 오류 없음
  await page.click('[data-tab="cal"]'); check('일정 탭 정상', await page.$eval('#tab-cal', x => !x.hidden) && await page.$eval('#tab-box', x => x.hidden));
  check('페이지 오류 없음', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();

  // 9. 저장 위치 선택이 없는 브라우저(아이폰 등): 일반 다운로드
  G.files.push({ id: 'live2', name: '가상_폰.txt', mimeType: 'text/plain', parents: ['fold1'], createdTime: new Date().toISOString(), appProperties: { vhm_exp: String(Date.now() + 3 * DAY) }, content: Buffer.from('phone') });
  page = await newPage(true, { noPicker: true, vp: { width: 390, height: 844 } }); await idle(page);
  await page.click('[data-tab="box"]'); await page.waitForSelector('#arDrive', { state: 'visible' }); await connectVia(page, '#arDrive'); await idle(page);
  await page.waitForSelector('#arList .ar-item', { timeout: 8000 });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('#arList [data-ardl="live2"]')]);
  const dlp = await dl.path(); const dtx = fs.readFileSync(dlp, 'utf8'); const anchorName = await page.evaluate(() => window.__aName);
  // 테스트용 헤드리스 크롬은 한글 파일명을 'download'로 바꿔 저장함 → 링크에 붙인 이름으로 확인
  check('일반 다운로드도 동작(내용·파일 이름)', dtx === 'phone' && anchorName === '가상_폰.txt', dl.suggestedFilename() + ' / ' + anchorName + ' / ' + dtx);
  const ow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check('휴대폰 폭에서 가로 넘침 없음', ow);
  await page.screenshot({ path: 'ar-phone.png', fullPage: true });
  // 연결 해제하면 보관함 상태 비움
  await page.click('[data-tab="set"]'); await page.click('#btnSignOut'); await page.waitForTimeout(300);
  check('연결 해제 시 보관함 목록 비움', await page.evaluate(() => ARCHIVE._state.files.length === 0 && ARCHIVE._state.folderId === null));
  check('페이지 오류 없음(휴대폰)', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();

  await b.close(); server.close();
  console.log(R.join('\n')); console.log(R.filter(x => x.startsWith('PASS')).length + '/' + R.length + ' PASS');
})().catch(e => { console.error(e); process.exit(1); });
