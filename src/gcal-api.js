/* =====================================================================
 * 구글 캘린더 직접 연결 (Code.gs 와 같은 함수 이름·같은 결과 형식)
 * - 로그인: Google Identity Services 토큰 방식 (클라이언트 ID만 사용, 비밀 키 없음)
 * - 일정 저장소: 기존과 같은 캘린더 '방문건강관리(업무)', '방문건강관리(개인)'
 * - 기한: 일정·메모에 기한을 정하면 '방문건강관리(기한)' 캘린더에 알림용 일정을 따로 만듦(제목은 업무 유형만, 대상자 정보 없음)
 * - 완료한 일정·메모는 '방문건강관리(완료)' 캘린더로 옮김 (휴대폰 구글 캘린더에서 체크를 끄면 안 보임, 실적에는 포함)
 * - 숨은 정보: 이벤트 extendedProperties.private 의 vhm_* (Apps Script 의 setTag 와 같은 곳)
 * ===================================================================== */
(function () {
  'use strict';
  const CFG = window.VHM_CONFIG || {};
  const TZ = 'Asia/Seoul', OFFSET = '+09:00';
  const WORK = '방문건강관리(업무)', PERS = '방문건강관리(개인)', DONE = '방문건강관리(완료)', DUE = '방문건강관리(기한)';
  const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar';
  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';   // 이 앱이 만든 파일에만 접근
  // 로그인은 캘린더 권한만. 드라이브 권한은 '연계 안내'에서 따로 요청 (드라이브 승인이 막혀도 일정은 쓰도록)
  const API = 'https:' + '//www.googleapis.com/calendar/v3';
  const TYPES = ['신규', '방문', '전화', '내소', '연계'], STATUSES = ['예정', '완료', '부재', '취소'];
  const GROUPS = ['집중관리군', '정기관리군', '자기역량지원군', '미지정'];
  const TITLE_RE = /^\s*\[(신규|방문|전화|내소|연계)\]\s*(예정|완료|부재|취소)?\s*(.*)$/;

  class AuthNeeded extends Error { constructor(m) { super(m || '구글 캘린더 연결이 필요합니다.'); this.authNeeded = true; } }
  window.AuthNeeded = AuthNeeded;

  /* ---------- 로그인 (페이지 이동 방식 — 팝업을 쓰지 않음) ----------
   * '연결'을 누르면 구글 로그인 페이지로 이동했다가, 승인 후 이 주소로 돌아오며 주소 뒤(#)에 토큰을 받아 옵니다.
   * Google Cloud 클라이언트의 '승인된 리디렉션 URI'에 이 웹사이트 주소(예: https://아이디.github.io/vhm/)가 있어야 합니다. */
  const TOKEN_KEY = 'vhm-token', STATE_KEY = 'vhm-oauth-state';
  const AUTH_URL = 'https:' + '//accounts.google.com/o/oauth2/v2/auth';
  const REVOKE_URL = 'https:' + '//oauth2.googleapis.com/revoke';
  const REDIRECT = location.origin + location.pathname.replace(/index\.html$/, '');
  const Auth = {
    token: null, exp: 0, hasDrive: false, redirectResult: null, redirectUri: REDIRECT,
    load() { try { const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null'); if (t && t.exp > Date.now() + 60e3) { this.token = t.token; this.exp = t.exp; this.hasDrive = !!t.drive; } } catch (e) {} },
    valid() { return !!this.token && Date.now() < this.exp - 60e3; },
    /** kind: 'base'(캘린더) | 'drive'(드라이브 추가). 구글 로그인 페이지로 이동합니다. */
    /** 연결 유지용: 구글 화면을 띄우지 않고(prompt=none) 조용히 다시 받음. 구글 로그인이 살아 있어야 함 */
    canSilent() { try { return !!CFG.clientId && !!localStorage.getItem('vhm-consented') && !!localStorage.getItem('vhm-email'); } catch (e) { return false; } },
    request(kind, opt) {
      if (!CFG.clientId) return Promise.reject(new Error('config.js 에 클라이언트 ID가 없습니다.'));
      const silent = !!(opt && opt.silent);
      const drive = kind === 'drive';
      const st = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
      let consented = false, hint = '';
      try { consented = !!localStorage.getItem(drive ? 'vhm-consented-drive' : 'vhm-consented'); hint = localStorage.getItem('vhm-email') || '';
        sessionStorage.setItem(STATE_KEY, JSON.stringify({ st, drive, silent, at: Date.now() })); } catch (e) {}
      const q = new URLSearchParams({ client_id: CFG.clientId, redirect_uri: REDIRECT, response_type: 'token', scope: drive ? DRIVE_SCOPE : CAL_SCOPE, include_granted_scopes: 'true', state: st });
      if (silent) q.set('prompt', 'none'); else if (!consented) q.set('prompt', 'consent');
      if (hint) q.set('login_hint', hint);
      location.assign(AUTH_URL + '?' + q.toString());
      return new Promise(() => {});   // 페이지가 이동하므로 끝나지 않음
    },
    /** 구글에서 돌아왔을 때 주소의 #access_token=… 처리 */
    handleRedirect() {
      const h = location.hash.replace(/^#/, ''); if (!/(^|&)(access_token|error)=/.test(h)) return null;
      const p = new URLSearchParams(h); let saved = null;
      try { saved = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null'); sessionStorage.removeItem(STATE_KEY); } catch (e) {}
      try { history.replaceState(null, '', REDIRECT + location.search); } catch (e) {}
      const res = { drive: !!(saved && saved.drive), silent: !!(saved && saved.silent), error: '', driveError: '' };
      if (!saved || p.get('state') !== saved.st) { res.error = '로그인 응답을 확인하지 못했습니다. 다시 연결해 주세요.'; return res; }
      if (p.get('error') && res.silent) { res.silentFailed = true; res.error = '자동으로 다시 연결하지 못했습니다. 이 브라우저의 구글 로그인이 풀렸을 수 있습니다. ‘구글 계정으로 연결’ 버튼을 눌러 주세요.'; return res; }
      if (p.get('error')) { res.error = p.get('error') === 'access_denied' ? '구글 로그인이 취소되었거나, 이 계정이 테스트 사용자로 등록되어 있지 않습니다.' : '구글 로그인 오류: ' + p.get('error'); return res; }
      const scopes = String(p.get('scope') || '').split(/[ +]/);
      if (scopes.indexOf(CAL_SCOPE) < 0) { res.error = '캘린더 권한이 허용되지 않았습니다. 다시 연결하고 캘린더 체크박스를 켜 주세요.'; return res; }
      this.token = p.get('access_token'); this.exp = Date.now() + (Number(p.get('expires_in')) || 3600) * 1000;
      this.hasDrive = scopes.indexOf(DRIVE_SCOPE) >= 0;
      try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: this.token, exp: this.exp, drive: this.hasDrive }));
        localStorage.setItem('vhm-consented', '1'); if (this.hasDrive) localStorage.setItem('vhm-consented-drive', '1'); } catch (e) {}
      if (res.drive && !this.hasDrive) res.driveError = '드라이브 권한이 허용되지 않았습니다. 다시 누르고 드라이브 체크박스를 켜 주세요.';
      return res;
    },
    signOut() {
      const t = this.token; this.token = null; this.exp = 0; this.hasDrive = false;
      try { sessionStorage.removeItem(TOKEN_KEY); ['vhm-consented', 'vhm-consented-drive', 'vhm-cal-ids', 'vhm-email'].forEach(k => localStorage.removeItem(k)); } catch (e) {}
      if (t) try { fetch(REVOKE_URL + '?token=' + encodeURIComponent(t), { method: 'POST', mode: 'no-cors' }).catch(() => {}); } catch (e) {}
    }
  };
  Auth.load();
  Auth.redirectResult = Auth.handleRedirect();
  window.VHM_AUTH = Auth;

  /* ---------- REST 호출 ---------- */
  async function api(method, path, { body, query, ifMatch, raw, rawBody, contentType } = {}) {
    if (!Auth.valid()) throw new AuthNeeded();
    let url = /^https:/.test(path) ? path : API + path;
    if (query) url += '?' + new URLSearchParams(query).toString();
    const headers = { Authorization: 'Bearer ' + Auth.token };
    if (body) headers['Content-Type'] = 'application/json';
    if (rawBody != null && contentType) headers['Content-Type'] = contentType;
    if (ifMatch) headers['If-Match'] = ifMatch;
    let res;
    try { res = await fetch(url, { method, headers, body: rawBody != null ? rawBody : (body ? JSON.stringify(body) : undefined) }); }
    catch (e) { throw new Error('인터넷 연결이 끊겼거나 구글 서버에 닿지 않습니다.'); }
    if (res.status === 401) { Auth.token = null; try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {} throw new AuthNeeded('연결 시간이 지났습니다. 다시 연결해 주세요.'); }
    if (res.status === 204) return null;
    if (raw && res.ok) return res;
    let data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) { const err = new Error((data && data.error && data.error.message) || ('구글 응답 오류 ' + res.status)); err.status = res.status; throw err; }
    return data;
  }

  /* ---------- 설정 (기기마다 저장) ---------- */
  const SET_KEY = 'vhm-settings';
  function defaults() { return { defaultReminder: 30, titleAlias: false, show: 'all', view: 'month', timeStep: 10 }; }
  function getSettings() { const s = defaults(); try { Object.assign(s, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch (e) {} return s; }

  /* ---------- 캘린더 찾기·만들기 ---------- */
  let CAL = null;   // { work, personal, email }
  async function ensureCalendars() {
    if (CAL) return CAL;
    const items = []; let pageToken;
    do { const r = await api('GET', '/users/me/calendarList', { query: Object.assign({ maxResults: 250 }, pageToken ? { pageToken } : {}) }); items.push(...(r.items || [])); pageToken = r.nextPageToken; } while (pageToken);
    const primary = items.find(c => c.primary);
    const find = name => items.find(c => c.summary === name && (c.accessRole === 'owner' || c.accessRole === 'writer'));
    const make = async name => { const c = await api('POST', '/calendars', { body: { summary: name, timeZone: TZ } }); return c.id; };
    const w = find(WORK), p = find(PERS), d = find(DONE), du = find(DUE);
    CAL = { work: w ? w.id : await make(WORK), personal: p ? p.id : await make(PERS), done: d ? d.id : '', due: du ? du.id : '', email: primary ? primary.id : '' };
    return CAL;
  }
  // 완료 캘린더는 처음 완료할 때 만듦
  async function ensureDone() {
    const c = await ensureCalendars();
    if (!c.done) c.done = (await api('POST', '/calendars', { body: { summary: DONE, timeZone: TZ, description: '방문건강관리 일정표에서 완료 처리한 일정·메모가 모이는 곳입니다. 휴대폰 구글 캘린더에서 이 캘린더 체크를 끄면 보이지 않습니다. 실적 집계에는 포함됩니다.' } })).id;
    return c.done;
  }
  async function ensureDue() {
    const c = await ensureCalendars();
    if (!c.due) c.due = (await api('POST', '/calendars', { body: { summary: DUE, timeZone: TZ, description: '방문건강관리 일정표에서 정한 기한 알림이 모이는 곳입니다. 원래 일정을 완료하거나 기한을 지우면 함께 지워집니다.' } })).id;
    return c.due;
  }
  const isDone = e => e.kind === 'work' ? e.status === '완료' : !!e.done;
  const tagKind = ev => { const p = ev.extendedProperties && ev.extendedProperties.private; return p && p.vhm_kind === 'personal' ? 'personal' : 'work'; };

  /* ---------- 날짜 도우미 ---------- */
  const KFMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  function kst(iso) { const o = {}; KFMT.formatToParts(new Date(iso)).forEach(x => o[x.type] = x.value); return { date: o.year + '-' + o.month + '-' + o.day, time: o.hour + ':' + o.minute }; }
  function addDays(s, n) { const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); }
  function plus30(t) { const [h, m] = t.split(':').map(Number); const x = Math.min(h * 60 + m + 30, 23 * 60 + 59); return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); }

  /* ---------- 일정 변환 (Code.gs toObj_ 와 같은 규칙) ---------- */
  function toObj(ev, kind, inDone) {
    const priv = (ev.extendedProperties && ev.extendedProperties.private) || {};
    const tag = k => priv['vhm_' + k] == null ? '' : String(priv['vhm_' + k]);
    const allDay = !ev.start.dateTime;
    const s = allDay ? { date: ev.start.date, time: '' } : kst(ev.start.dateTime);
    const e = allDay ? { date: '', time: '' } : kst(ev.end.dateTime);
    let reminder = -1;
    if (ev.reminders) {
      if (ev.reminders.useDefault) reminder = -2;
      else { const pop = (ev.reminders.overrides || []).filter(o => o.method === 'popup').map(o => o.minutes); if (pop.length) reminder = Math.min(...pop); }
    }
    // 기간 일정: 종일이면 구글의 끝 날짜는 '다음 날'이라 하루 빼서 '끝나는 날'로
    let endDate = allDay ? (ev.end && ev.end.date ? addDays(ev.end.date, -1) : '') : e.date;
    if (!endDate || endDate <= s.date) endDate = '';
    const o = { id: ev.id, ical: ev.iCalUID || '', kind, uid: tag('uid') || ev.iCalUID || ev.id, date: s.date, start: s.time, end: e.time, endDate,
      memo: tag('memo'), parentId: tag('parent'), reminder, updated: ev.etag, fromApp: tag('kind') !== '', doneAt: tag('done_at'), movedFrom: tag('from'),
      due: tag('due'), dueRem: tag('duerem'), dueMail: tag('duemail') === '1', dueId: tag('dueid') };
    if (inDone) { o.inDone = true; if (tag('prevrem') !== '' && isFinite(+tag('prevrem'))) o.reminder = +tag('prevrem'); }   // 완료하면 알림을 끄고, 원래 알림은 기억
    const title = ev.summary || '';
    if (kind === 'work') {
      o.type = tag('type'); o.status = tag('status') || '예정'; o.group = tag('group') || '미지정'; o.target = tag('target'); o.birth = tag('birth'); o.sex = tag('sex'); o.prio = ['high', 'low'].includes(tag('prio')) ? tag('prio') : 'normal';
      const m = TITLE_RE.exec(title);
      if (m) { o.type = m[1]; o.status = m[2] || '예정'; if (!o.target && m[3]) o.target = maskName(m[3]).slice(0, 40); }
      else if (!o.fromApp) o.target = o.target || title.slice(0, 40);
      if (TYPES.indexOf(o.type) < 0) o.type = '';
      if (STATUSES.indexOf(o.status) < 0) o.status = '예정';
      if (GROUPS.indexOf(o.group) < 0) o.group = '미지정';
      o.rawTitle = title;
    } else {
      o.ptype = tag('ptype') || (allDay ? '메모' : '일정'); if (!o.fromApp) o.ptype = '일정';
      o.done = tag('done') === '1' || (!!inDone && tag('done') === '');
      o.title = title;
    }
    return o;
  }

  const isAdj = e => !!(e.extendedProperties && e.extendedProperties.private && e.extendedProperties.private.vhm_kind === 'adj');
  // 실적 수기 조정 일정('방문건강관리(완료)'의 종일 일정)은 일정 목록·실적 자동 집계에서 빼고, adj 옵션일 때만 그것만
  async function listCal(calId, from, to, opt) {
    const all = await listCalRaw(calId, from, to);
    return opt && opt.adj ? all.filter(isAdj) : all.filter(e => !isAdj(e));
  }
  async function listCalRaw(calId, from, to) {
    const out = []; let pageToken;
    do {
      const r = await api('GET', '/calendars/' + encodeURIComponent(calId) + '/events', { query: Object.assign({
        timeMin: from + 'T00:00:00' + OFFSET, timeMax: addDays(to, 1) + 'T00:00:00' + OFFSET, singleEvents: 'true', maxResults: 2500, showDeleted: 'false'
      }, pageToken ? { pageToken } : {}) });
      out.push(...(r.items || []).filter(e => e.status !== 'cancelled')); pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  }
  // 세 캘린더를 모두 읽어 '진행 중'과 '완료'로 나눔. 휴대폰에서 [전화] 완료로 바꾼 일정(업무 캘린더에 있음)도 완료로,
  // 완료 캘린더에 있지만 휴대폰에서 '부재' 등으로 바꾼 일정은 진행 중으로 봄
  async function listAll(from, to) {
    const c = await ensureCalendars();
    const [w, p, d] = await Promise.all([listCal(c.work, from, to), listCal(c.personal, from, to), c.done ? listCal(c.done, from, to) : []]);
    const all = w.map(e => toObj(e, 'work')).concat(p.map(e => toObj(e, 'personal')), d.map(e => toObj(e, tagKind(e), true))).filter(o => o.date >= from && o.date <= to);
    const active = [], done = [];
    all.forEach(o => { o.doneCal = !!o.inDone; if (isDone(o)) { o.inDone = true; done.push(o); } else { delete o.inDone; active.push(o); } });
    return { active, done };
  }
  async function listEvents(from, to) { return (await listAll(from, to)).active; }
  async function listDone(from, to) { return (await listAll(from, to)).done; }
  // 휴대폰에서 완료로 바꿔 업무 캘린더에 남아 있는 일정을 완료 캘린더로 옮김
  async function moveDone(list) {
    let moved = 0, failed = 0;
    for (const x of list || []) { try { const r = await setDone(x.id, true, x.updated); r.ok ? moved++ : failed++; } catch (err) { if (err.authNeeded) throw err; failed++; } }
    return { moved, failed };
  }

  /* ---------- 저장·삭제 ---------- */
  // 한글 이름 2~5자면 두 번째 글자를 O로 (화면과 같은 규칙. 저장 직전에 한 번 더 적용)
  function maskName(raw) { const s = String(raw || '').replace(/\s+/g, ''); return /^[가-힣]{2,5}$/.test(s) ? s[0] + 'O' + s.slice(2) : String(raw || '').trim(); }
  function validate(e) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) throw new Error('날짜가 올바르지 않습니다.');
    ['start', 'end'].forEach(k => { if (e[k] && !/^\d{2}:\d{2}$/.test(e[k])) throw new Error('시간이 올바르지 않습니다.'); });
    // 끝나는 날: 시작 날짜보다 뒤일 때만 (최대 1년). 화면에서는 개인 일정·메모에서 고름(업무는 휴대폰에서 만든 기간 일정을 그대로 유지)
    e.endDate = /^\d{4}-\d{2}-\d{2}$/.test(e.endDate || '') && e.endDate > e.date && e.endDate <= addDays(e.date, 366) ? e.endDate : '';
    if (e.start && e.end && e.end < e.start && !e.endDate) throw new Error('종료 시간이 시작 시간보다 빠릅니다.');
    if (e.kind === 'work') {
      if (TYPES.indexOf(e.type) < 0) throw new Error('유형을 선택하세요.');
      if (STATUSES.indexOf(e.status) < 0) e.status = '예정';
      if (GROUPS.indexOf(e.group) < 0) e.group = '미지정';
      e.prio = ['high', 'low'].includes(e.prio) ? e.prio : 'normal';
      e.target = maskName(e.target).slice(0, 40);
      const by = String(e.birth || '').trim(); e.birth = /^\d{4}$/.test(by) && +by >= 1900 && +by <= new Date().getFullYear() ? by : '';
      e.sex = e.sex === '남' || e.sex === '여' ? e.sex : '';
    } else {
      e.kind = 'personal'; e.done = !!e.done; e.ptype = e.ptype === '메모' ? '메모' : '일정'; e.title = String(e.title || '').slice(0, 80);
      if (!e.title && !e.memo && !e.memoCipher) throw new Error('제목이나 메모를 입력하세요.');
    }
    e.memo = String(e.memo || ''); if (!e.memo.startsWith(LOCK_PREFIX)) e.memo = e.memo.slice(0, 500);
    e.reminder = Number(e.reminder); if (!isFinite(e.reminder)) e.reminder = -1;
    // 기한: 'YYYY-MM-DDTHH:MM', 알림(분 전, 쉼표), 이메일로도
    e.due = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(e.due || '') ? e.due : '';
    e.dueRem = String(e.dueRem == null ? '0' : e.dueRem).split(',').map(x => x.trim()).filter(x => DUE_REMS.includes(x)).join(',');
    e.dueMail = !!e.dueMail && !!e.dueRem;
    e.movedFrom = /^\d{4}-\d{2}-\d{2}$/.test(e.movedFrom || '') && e.movedFrom !== e.date ? e.movedFrom : '';
    return e;
  }
  const DUE_REMS = ['0', '60', '1440', '4320', '10080'];
  function newUid() { const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); }
  function bodyOf(e, settings) {
    const summary = e.kind === 'work'
      ? '[' + e.type + ']' + (e.status && e.status !== '예정' ? ' ' + e.status : '') + (settings.titleAlias && e.target ? ' ' + e.target : '')
      : (e.title || (e.ptype === '메모' ? '메모' : '개인 일정'));
    const priv = { vhm_kind: e.kind, vhm_memo: e.memo, vhm_parent: e.parentId || '', vhm_uid: e.uid || newUid() };
    if (e.kind === 'work') Object.assign(priv, { vhm_type: e.type, vhm_status: e.status, vhm_group: e.group, vhm_target: e.target, vhm_birth: e.birth || '', vhm_sex: e.sex || '', vhm_prio: e.prio || 'normal' });
    else { priv.vhm_ptype = e.ptype; priv.vhm_done = e.done ? '1' : ''; }
    const fin = isDone(e);
    priv.vhm_from = e.movedFrom || '';   // 미룬 일정: 처음 예정일
    priv.vhm_done_at = fin ? (e.doneAt || String(Date.now())) : '';
    priv.vhm_prevrem = fin ? String(e.reminder) : '';
    Object.assign(priv, { vhm_due: e.due || '', vhm_duerem: e.due ? (e.dueRem || '') : '', vhm_duemail: e.due && e.dueMail ? '1' : '', vhm_dueid: e.dueId || '' });
    const start = e.start ? { dateTime: e.date + 'T' + e.start + ':00' + OFFSET, timeZone: TZ } : { date: e.date };
    const last = e.endDate && e.endDate > e.date ? e.endDate : e.date;   // 기간 일정이면 끝나는 날까지
    const end = e.start ? { dateTime: last + 'T' + (e.end || plus30(e.start)) + ':00' + OFFSET, timeZone: TZ } : { date: addDays(last, 1) };
    const reminders = fin ? { useDefault: false, overrides: [] }   // 완료한 일은 알림 끔
      : e.reminder === -2 ? { useDefault: true } : { useDefault: false, overrides: e.reminder >= 0 ? [{ method: 'popup', minutes: e.reminder }] : [] };
    return { summary, start, end, reminders, extendedProperties: { private: priv } };
  }
  /* ---------- 메모 잠금 (AES-GCM, 암호 → PBKDF2) ----------
     구글에는 'vhm1:' + 암호문만 저장. 암호·키는 어디에도 저장하지 않고 이 창의 메모리에만 둠.
     잠금 정보(소금값·확인용 암호문)는 업무 캘린더의 설명에 저장 → 다른 기기에서도 같은 암호로 열림 */
  const LOCK_PREFIX = 'vhm1:', META_TAG = 'vhmlock1:', ITER = 310000, CHECK = 'vhm-lock-ok', MEMO_BYTES = 700;
  const Lock = { key: null, raw: null, meta: undefined };
  const te = new TextEncoder(), td = new TextDecoder();
  const b64 = u8 => { let s = ''; u8.forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
  const ub64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function deriveRaw(pass, salt, iter) {
    const base = await crypto.subtle.importKey('raw', te.encode(String(pass).normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter || ITER }, base, 256));
  }
  const aesKey = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  async function encWith(key, text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(text)));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return b64(out);
  }
  async function decWith(key, s) { const u = ub64(s); return td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, key, u.slice(12))); }
  class LockNeeded extends Error { constructor(m) { super(m || '메모 잠금을 먼저 풀어 주세요.'); this.lockNeeded = true; } }
  async function lockMeta(refresh) {
    if (Lock.meta !== undefined && !refresh) return Lock.meta;
    const c = await ensureCalendars();
    const cal = await api('GET', '/calendars/' + encodeURIComponent(c.work));
    const d = cal.description || ''; const i = d.indexOf(META_TAG); let m = null;
    if (i >= 0) { try { m = JSON.parse(d.slice(i + META_TAG.length).split('\n')[0].trim()); } catch (e) { m = null; } }
    Lock.meta = m; return m;
  }
  async function useRaw(raw) {
    const m = await lockMeta(); const key = await aesKey(raw);
    let ok = false; try { ok = (await decWith(key, m.check)) === CHECK; } catch (e) {}
    if (!ok) return false;
    Lock.key = key; Lock.raw = raw; return true;
  }
  async function lockSetup(pass) {
    if (String(pass || '').length < 8) throw new Error('잠금 암호는 8자 이상으로 정하세요.');
    if (await lockMeta(true)) throw new Error('이미 잠금 암호가 있습니다. 그 암호로 잠금을 푸세요.');
    const salt = crypto.getRandomValues(new Uint8Array(16)), raw = await deriveRaw(pass, salt), key = await aesKey(raw);
    const meta = { v: 1, salt: b64(salt), iter: ITER, check: await encWith(key, CHECK) };
    const c = await ensureCalendars();
    const cal = await api('GET', '/calendars/' + encodeURIComponent(c.work));
    const keep = (cal.description || '').split('\n').filter(l => l.indexOf(META_TAG) < 0 && l.indexOf('메모 잠금 정보') < 0).join('\n').trim();
    await api('PATCH', '/calendars/' + encodeURIComponent(c.work), { body: { description: (keep ? keep + '\n' : '') + '메모 잠금 정보입니다. 지우거나 고치지 마세요.\n' + META_TAG + JSON.stringify(meta) } });
    Lock.meta = meta; Lock.key = key; Lock.raw = raw; return true;
  }
  async function lockUnlock(pass) {
    let m = await lockMeta(); if (!m) m = await lockMeta(true);   // 이미 읽어 둔 잠금 정보로 확인 (연결이 끊겨도 열림)
    if (!m) throw new Error('아직 잠금 암호를 만들지 않았습니다.');
    if (!(await useRaw(await deriveRaw(pass, ub64(m.salt), m.iter)))) throw new Error('암호가 맞지 않습니다.');
    return true;
  }
  function lockNow() { Lock.key = null; Lock.raw = null; }
  // 연결 유지로 페이지가 다시 열릴 때만 잠금 키를 잠깐 넘겨줌 (이 탭의 sessionStorage, 돌아오자마자 지움)
  function lockStash() { try { if (Lock.raw) sessionStorage.setItem('vhm-lk-tmp', b64(Lock.raw)); } catch (e) {} }
  async function lockResume() {
    let v = null; try { v = sessionStorage.getItem('vhm-lk-tmp'); sessionStorage.removeItem('vhm-lk-tmp'); } catch (e) {}
    if (!v) return false; try { return await useRaw(ub64(v)); } catch (e) { return false; }
  }
  async function lockState() { const m = await lockMeta(); return { setup: !!m, open: !!Lock.key, bio: bioInfo() }; }
  async function decObj(o) {
    if (!o || !o.memo || !o.memo.startsWith(LOCK_PREFIX)) { if (o) o.memoLock = ''; return o; }
    if (Lock.key) { try { const raw = o.memo; o.memo = await decWith(Lock.key, o.memo.slice(LOCK_PREFIX.length)); o.memoLock = 'open'; o.memoRaw = raw; return o; } catch (e) { o.memoLock = 'bad'; } }
    else o.memoLock = 'locked';
    o.memoCipher = o.memo; o.memo = ''; return o;
  }
  async function sealMemo(e, oldRaw, allowPlain) {   // 저장 직전: 메모를 암호문으로
    if (e.memoCipher && !e.memo) { e.memo = e.memoCipher; return; }
    if (!e.memo || e.memo.startsWith(LOCK_PREFIX)) return;
    if (Lock.key) {
      if (te.encode(e.memo).length > MEMO_BYTES) throw new Error('잠금 메모는 200자 안쪽으로 줄여 주세요.');
      e.memo = LOCK_PREFIX + await encWith(Lock.key, e.memo); return;
    }
    if (allowPlain || (oldRaw != null && oldRaw === e.memo)) return;   // 예전 일반 메모를 그대로 두는 경우
    throw new LockNeeded();
  }
  async function lockAll(from, to) {   // 예전 일반 메모를 모두 잠금
    if (!Lock.key) throw new LockNeeded();
    const c = await ensureCalendars(); let done = 0, long = 0;
    for (const calId of [c.work, c.personal, c.done].filter(Boolean)) {
      for (const ev of await listCal(calId, from, to)) {
        const p = ev.extendedProperties && ev.extendedProperties.private; const m = p && p.vhm_memo;
        if (!m || m.startsWith(LOCK_PREFIX)) continue;
        if (te.encode(m).length > MEMO_BYTES) { long++; continue; }
        await api('PATCH', '/calendars/' + encodeURIComponent(calId) + '/events/' + encodeURIComponent(ev.id), { body: { extendedProperties: { private: { vhm_memo: LOCK_PREFIX + await encWith(Lock.key, m) } } } });
        done++;
      }
    }
    return { done, long };
  }

  /* ---------- 생체인증으로 잠금 풀기 (패스키 PRF) ----------
     이 기기의 Face ID·지문·Windows Hello 가 만든 비밀값으로 '잠금 키'를 감싸 이 기기에만 저장 */
  const BIO_KEY = 'vhm-bio';
  function bioInfo() { try { const b = JSON.parse(localStorage.getItem(BIO_KEY) || 'null'); return b && b.cid ? { on: true } : { on: false }; } catch (e) { return { on: false }; } }
  async function bioAvailable() {
    try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (e) { return false; }
  }
  async function prfKey(out) {
    const base = await crypto.subtle.importKey('raw', out, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('vhm-bio-wrap'), info: te.encode('v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function bioGet(cid, salt) {
    const a = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: location.hostname, userVerification: 'required', timeout: 60000,
      allowCredentials: [{ type: 'public-key', id: cid }], extensions: { prf: { eval: { first: salt } } } } });
    const r = a && a.getClientExtensionResults().prf; const out = r && r.results && r.results.first;
    if (!out) throw new Error('이 기기·브라우저는 생체인증 잠금 풀기를 지원하지 않습니다. 암호로 여세요.');
    return new Uint8Array(out);
  }
  async function bioRegister() {
    if (!Lock.raw) throw new LockNeeded('먼저 암호로 잠금을 푼 뒤 등록하세요.');
    if (!window.PublicKeyCredential) throw new Error('이 브라우저는 생체인증을 지원하지 않습니다.');
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const email = (CAL && CAL.email) || '';
    const cred = await navigator.credentials.create({ publicKey: {
      rp: { name: '방문건강관리 일정', id: location.hostname }, user: { id: crypto.getRandomValues(new Uint8Array(16)), name: email || '메모 잠금', displayName: '방문건강관리 메모 잠금' },
      challenge: crypto.getRandomValues(new Uint8Array(32)), pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' }, timeout: 60000,
      extensions: { prf: { eval: { first: salt } } } } });
    const ext = cred.getClientExtensionResults().prf || {};
    if (ext.enabled === false) throw new Error('이 기기·브라우저는 생체인증 잠금 풀기를 지원하지 않습니다.');
    const cid = new Uint8Array(cred.rawId);
    const out = ext.results && ext.results.first ? new Uint8Array(ext.results.first) : await bioGet(cid, salt);
    const w = await encWith(await prfKey(out), b64(Lock.raw));
    localStorage.setItem(BIO_KEY, JSON.stringify({ cid: b64(cid), salt: b64(salt), w, email }));
    return true;
  }
  async function bioUnlock() {
    const b = JSON.parse(localStorage.getItem(BIO_KEY) || 'null'); if (!b) throw new Error('이 기기에는 생체인증이 등록되어 있지 않습니다.');
    const out = await bioGet(ub64(b.cid), ub64(b.salt));
    let raw; try { raw = ub64(await decWith(await prfKey(out), b.w)); } catch (e) { throw new Error('생체인증 정보가 맞지 않습니다. 암호로 연 뒤 다시 등록하세요.'); }
    if (!(await useRaw(raw))) throw new Error('잠금 암호가 바뀐 것 같습니다. 암호로 연 뒤 생체인증을 다시 등록하세요.');
    return true;
  }
  function bioRemove() { try { localStorage.removeItem(BIO_KEY); } catch (e) {} return true; }

  async function findEvent(id) {
    const c = await ensureCalendars();
    for (const [kind, calId] of [['work', c.work], ['personal', c.personal], ['done', c.done]]) {
      if (!calId) continue;
      try { const ev = await api('GET', '/calendars/' + encodeURIComponent(calId) + '/events/' + encodeURIComponent(id)); if (ev && ev.status !== 'cancelled') return kind === 'done' ? { ev, kind: tagKind(ev), calId, done: true } : { ev, kind, calId }; }
      catch (err) { if (err.status !== 404 && err.status !== 410) throw err; }
    }
    return null;
  }
  // 다른 캘린더로 옮기기 (같은 일정 그대로). 반복 일정의 한 회차처럼 옮길 수 없으면 복사 후 원본 삭제
  async function moveEv(fromCal, ev, toCal) {
    try { return await api('POST', '/calendars/' + encodeURIComponent(fromCal) + '/events/' + encodeURIComponent(ev.id) + '/move', { query: { destination: toCal } }); }
    catch (err) {
      if (err.authNeeded) throw err;
      const copy = {}; ['summary', 'start', 'end', 'reminders', 'extendedProperties', 'description', 'location', 'colorId', 'transparency'].forEach(k => { if (ev[k] != null) copy[k] = ev[k]; });
      const created = await api('POST', '/calendars/' + encodeURIComponent(toCal) + '/events', { body: copy });
      await api('DELETE', '/calendars/' + encodeURIComponent(fromCal) + '/events/' + encodeURIComponent(ev.id));
      return created;
    }
  }
  /* ---------- 기한 알림 일정 ('방문건강관리(기한)') ---------- */
  function dueBody(o) {
    const [d, t] = o.due.split('T');
    const head = o.kind === 'work' ? (o.type || '업무') : (o.title || (o.ptype === '메모' ? '메모' : '개인 일정'));   // 업무는 유형만 (대상자 정보 없음)
    const mins = (o.dueRem || '').split(',').filter(Boolean).map(Number).slice(0, 4);
    const overrides = mins.map(m => ({ method: 'popup', minutes: m })).concat(o.dueMail && mins.length ? [{ method: 'email', minutes: Math.max(...mins) }] : []);
    return { summary: '[기한] ' + head, start: { dateTime: d + 'T' + t + ':00' + OFFSET, timeZone: TZ }, end: { dateTime: d + 'T' + plus30(t) + ':00' + OFFSET, timeZone: TZ },
      description: '방문건강관리 일정표에서 정한 기한입니다. (원래 일정 ' + o.date + ')', reminders: { useDefault: false, overrides },
      extendedProperties: { private: { vhm_kind: 'due', vhm_parent: o.id, vhm_pkind: o.kind } } };
  }
  async function delDue(id) {
    const c = await ensureCalendars(); if (!id || !c.due) return;
    try { await api('DELETE', '/calendars/' + encodeURIComponent(c.due) + '/events/' + encodeURIComponent(id)); } catch (err) { if (err.authNeeded) throw err; }
  }
  // 저장한 일정에 맞춰 기한 알림 일정을 만들거나 고치거나 지움. 완료한 일정은 기한 알림을 지움
  async function syncDue(o) {
    const c = await ensureCalendars(), want = !!o.due && !o.inDone;
    if (!want && !o.dueId) return o;
    let id = o.dueId || '';
    if (want) {
      const cal = await ensureDue(), body = dueBody(o); let ev = null;
      if (id) { try { ev = await api('PATCH', '/calendars/' + encodeURIComponent(cal) + '/events/' + encodeURIComponent(id), { body }); if (ev && ev.status === 'cancelled') ev = null; } catch (err) { if (err.authNeeded) throw err; ev = null; } }
      if (!ev) ev = await api('POST', '/calendars/' + encodeURIComponent(cal) + '/events', { body });
      if (ev.id === id) return o;
      id = ev.id;
    } else { await delDue(id); id = ''; }
    const calId = o.inDone ? c.done : (o.kind === 'work' ? c.work : c.personal);
    const it = await api('PATCH', '/calendars/' + encodeURIComponent(calId) + '/events/' + encodeURIComponent(o.id), { body: { extendedProperties: { private: { vhm_dueid: id } } } });
    o.dueId = id; o.updated = it.etag; return o;
  }
  async function saveEvent(e, force, opt) {
    const r = await saveCore(e, force, opt);
    if (r.ok && r.event) { try { await syncDue(r.event); } catch (err) { if (err.authNeeded) throw err; r.dueError = '일정은 저장했지만 기한 알림을 만들지 못했습니다: ' + (err.message || err); } }
    return r;
  }
  async function listDue(from, to) {
    const c = await ensureCalendars(); if (!c.due) return [];
    return (await listCal(c.due, from, to)).map(ev => { const p = (ev.extendedProperties && ev.extendedProperties.private) || {}, st = ev.start.dateTime || '';
      return { dueId: ev.id, due: st.slice(0, 16), title: ev.summary || '', parentId: p.vhm_parent || '', pkind: p.vhm_pkind || '', rems: ((ev.reminders && ev.reminders.overrides) || []).filter(x => x.method === 'popup').map(x => x.minutes) }; })
      .filter(x => x.due).sort((a, b) => a.due < b.due ? -1 : 1);
  }
  async function saveCore(e, force, opt) {
    e = validate(Object.assign({}, e));
    const settings = getSettings(), c = await ensureCalendars();
    const fin = isDone(e);
    const calId = fin ? await ensureDone() : (e.kind === 'work' ? c.work : c.personal);
    if (e.id) {
      const f = await findEvent(e.id);
      if (!f) return { ok: false, gone: true, message: '이 일정은 다른 기기에서 삭제되었습니다.' };
      if (!force && e.updated && f.ev.etag !== e.updated) return { ok: false, conflict: true, current: toObj(f.ev, f.kind, f.done) };
      const old = toObj(f.ev, f.kind, f.done);
      if (fin && !e.doneAt) e.doneAt = old.doneAt || '';
      e.dueId = old.dueId || e.dueId || '';   // 기한 알림 일정은 구글에 있는 값 기준
      await sealMemo(e, old.memo, opt && opt.allowPlain);
      e.uid = e.uid || old.uid;
      const sameKind = f.kind === e.kind, sameShape = !!old.start === !!e.start;
      if (sameKind && sameShape) {
        try {
          let ev = await api('PATCH', '/calendars/' + encodeURIComponent(f.calId) + '/events/' + encodeURIComponent(e.id), { body: bodyOf(e, settings), ifMatch: force ? undefined : f.ev.etag });
          if (f.calId !== calId) ev = await moveEv(f.calId, ev, calId);   // 완료하면 완료 캘린더로, 되돌리면 원래 캘린더로
          return { ok: true, event: toObj(ev, e.kind, fin), moved: f.calId !== calId };
        } catch (err) {
          if (err.status === 412) { const g = await findEvent(e.id); return g ? { ok: false, conflict: true, current: toObj(g.ev, g.kind, g.done) } : { ok: false, gone: true, message: '이 일정은 다른 기기에서 삭제되었습니다.' }; }
          throw err;
        }
      }
      // 업무↔개인 또는 종일↔시간 전환: 새로 만들고 원본 삭제 (같은 uid 유지)
      const created = await api('POST', '/calendars/' + encodeURIComponent(calId) + '/events', { body: bodyOf(e, settings) });
      await api('DELETE', '/calendars/' + encodeURIComponent(f.calId) + '/events/' + encodeURIComponent(e.id));
      return { ok: true, event: toObj(created, e.kind, fin), moved: f.calId !== calId };
    }
    await sealMemo(e, null, opt && opt.allowPlain);
    const ev = await api('POST', '/calendars/' + encodeURIComponent(calId) + '/events', { body: bodyOf(e, settings) });
    return { ok: true, event: toObj(ev, e.kind, fin), moved: fin };
  }
  async function setStatus(id, status, updated) {
    const f = await findEvent(id);
    if (!f) return { ok: false, gone: true, message: '이 일정은 다른 기기에서 삭제되었습니다.' };
    if (updated && f.ev.etag !== updated) return { ok: false, conflict: true, current: toObj(f.ev, f.kind, f.done) };
    const o = toObj(f.ev, f.kind, f.done); o.status = status; o.updated = f.ev.etag;
    return saveEvent(o, false);
  }
  // 개인 일정·메모 완료 / 완료 취소
  // 미루기: 날짜만 바꾸고 시간·메모·알림·기한은 그대로. 여러 개 한꺼번에 가능 (to = 'YYYY-MM-DD')
  async function postpone(list, to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to || '')) throw new Error('미룰 날짜가 올바르지 않습니다.');
    const out = { moved: [], failed: 0, skipped: 0 };
    for (const x of list || []) {
      try {
        const f = await findEvent(x.id); if (!f) { out.failed++; continue; }
        if (x.updated && f.ev.etag !== x.updated) { out.failed++; continue; }
        const o = toObj(f.ev, f.kind, f.done); if (f.done || o.date === to) { out.skipped++; continue; }
        const shift = Math.round((Date.UTC(...to.split('-').map((v, i) => i === 1 ? v - 1 : +v)) - Date.UTC(...o.date.split('-').map((v, i) => i === 1 ? v - 1 : +v))) / 864e5);
        const from = o.date; o.date = to; if (o.endDate) o.endDate = addDays(o.endDate, shift);
        o.movedFrom = o.movedFrom || from; if (o.movedFrom === to) o.movedFrom = '';
        o.updated = f.ev.etag;
        const r = await saveEvent(o, false, { allowPlain: true });
        if (r.ok) out.moved.push({ id: r.event.id, updated: r.event.updated, from, kind: r.event.kind }); else out.failed++;
      } catch (err) { if (err.authNeeded) throw err; out.failed++; }
    }
    return out;
  }
  async function setDone(id, done, updated) {
    const f = await findEvent(id);
    if (!f) return { ok: false, gone: true, message: '이 일정은 다른 기기에서 삭제되었습니다.' };
    if (updated && f.ev.etag !== updated) return { ok: false, conflict: true, current: toObj(f.ev, f.kind, f.done) };
    const o = toObj(f.ev, f.kind, f.done); o.updated = f.ev.etag;
    if (o.kind === 'work') o.status = done ? '완료' : '예정'; else o.done = !!done;
    return saveEvent(o, false, { allowPlain: true });
  }
  async function deleteEvent(id, updated) {
    const f = await findEvent(id);
    if (!f) return { ok: true, already: true };
    if (updated && f.ev.etag !== updated) return { ok: false, conflict: true, current: toObj(f.ev, f.kind, f.done) };
    await api('DELETE', '/calendars/' + encodeURIComponent(f.calId) + '/events/' + encodeURIComponent(id));
    const p = f.ev.extendedProperties && f.ev.extendedProperties.private; if (p && p.vhm_dueid) await delDue(p.vhm_dueid);   // 기한 알림도 함께
    return { ok: true };
  }

  /* ---------- 실적 ---------- */
  async function getStats(from, to) {
    const c = await ensureCalendars(); const res = {}; let unclassified = 0;
    TYPES.forEach(t => { res[t] = { '완료': 0, '부재': 0, '예정': 0, '취소': 0 }; });
    const doneWork = c.done ? (await listCal(c.done, from, to)).filter(e => tagKind(e) === 'work').map(e => toObj(e, 'work', true)) : [];
    (await listCal(c.work, from, to)).map(e => toObj(e, 'work')).concat(doneWork).forEach(o => {
      if (o.date < from || o.date > to) return;
      if (!o.type) { unclassified++; return; }
      res[o.type][o.status]++;
    });
    // 수기 조정 (완료 건수에 더함, 날짜마다 한 일정)
    const manual = {}; TYPES.forEach(t => { manual[t] = 0; res[t].auto = res[t]['완료']; });
    let day = null;
    if (c.done) (await listCal(c.done, from, to, { adj: true })).forEach(ev => {
      const d = ev.start.date || (ev.start.dateTime || '').slice(0, 10); if (d < from || d > to) return;
      let m = {}; try { m = JSON.parse(ev.extendedProperties.private.vhm_adj || '{}'); } catch (e) {}
      TYPES.forEach(t => { const n = Math.trunc(+m[t] || 0); manual[t] += n; res[t]['완료'] += n; });
      if (from === to) day = { id: ev.id, etag: ev.etag, counts: m };
    });
    TYPES.forEach(t => { if (res[t]['완료'] < 0) res[t]['완료'] = 0; });
    return { from, to, counts: res, unclassified, manual, adjDay: from === to ? (day || { id: '', etag: '', counts: {} }) : null };
  }
  // 실적 수기 조정 저장: 그날의 유형별 ±건수. 대상자 정보 없음. 모두 0이면 지움
  async function saveAdj(date, counts, etag) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('날짜가 올바르지 않습니다.');
    const clean = {}; TYPES.forEach(t => { const n = Math.trunc(+((counts || {})[t]) || 0); if (n) clean[t] = Math.max(-999, Math.min(999, n)); });
    const cal = await ensureDone();
    const cur = (await listCal(cal, date, date, { adj: true })).find(ev => (ev.start.date || '') === date);
    if (cur && etag !== undefined && etag !== null && cur.etag !== etag) return { ok: false, conflict: true };
    if (!cur && etag) return { ok: false, conflict: true };
    if (!Object.keys(clean).length) { if (cur) await api('DELETE', '/calendars/' + encodeURIComponent(cal) + '/events/' + encodeURIComponent(cur.id)); return { ok: true, removed: !!cur }; }
    const label = TYPES.filter(t => clean[t]).map(t => t + ' ' + (clean[t] > 0 ? '+' : '') + clean[t]).join(', ');
    const body = { summary: '[실적 수기] ' + label, start: { date }, end: { date: addDays(date, 1) }, transparency: 'transparent',
      description: '방문건강관리 일정표의 실적 수기 조정입니다(완료 건수에 더해짐). 대상자 정보는 없습니다.', reminders: { useDefault: false, overrides: [] },
      extendedProperties: { private: { vhm_kind: 'adj', vhm_adj: JSON.stringify(clean) } } };
    try {
      const ev = cur ? await api('PATCH', '/calendars/' + encodeURIComponent(cal) + '/events/' + encodeURIComponent(cur.id), { body, ifMatch: cur.etag })
                     : await api('POST', '/calendars/' + encodeURIComponent(cal) + '/events', { body });
      return { ok: true, id: ev.id, etag: ev.etag };
    } catch (err) { if (err.status === 412) return { ok: false, conflict: true }; throw err; }
  }

  /* ---------- 백업 (파일로 내려받기) ---------- */
  async function exportBackup(from, to) {
    const la = await listAll(from, to), events = la.active.concat(la.done);
    const payload = { app: 'vhm-calendar-web', schema: 1, exportedAt: new Date().toISOString(), from, to, events };
    const json = JSON.stringify(payload, null, 1);
    const now = kst(new Date().toISOString());
    const name = '일정백업_' + now.date.replace(/-/g, '') + '_' + now.time.replace(':', '') + '.json';
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60e3);
    return { name, url, count: events.length, json };
  }
  async function restoreBackup(json) {
    const data = JSON.parse(json);
    if (!data || !Array.isArray(data.events)) throw new Error('이 일정표의 백업 파일이 아닙니다.');
    const evs = data.events.filter(e => e && e.date); if (!evs.length) return { added: 0, skipped: 0, failed: 0 };
    const dates = evs.map(e => e.date).sort(); const have = {};
    (await listAll(dates[0], dates[dates.length - 1])).active.concat((await listAll(dates[0], dates[dates.length - 1])).done).forEach(o => { have[o.uid] = true; if (o.ical) have[o.ical] = true; });
    let added = 0, skipped = 0, failed = 0;
    for (const e of evs) {
      if (e.uid && have[e.uid]) { skipped++; continue; }
      try { const r = await restoreOne(e); if (r) { added++; have[r] = true; } else failed++; }
      catch (err) { if (err.authNeeded) throw err; failed++; }
    }
    return { added, skipped, failed };
  }
  // 지운 일정 하나를 다시 만듦 (백업 복원·일괄 삭제 되돌리기). 메모는 원래 암호문 그대로
  async function restoreOne(e) {
    const copy = Object.assign({}, e); delete copy.id; delete copy.updated;
    if (copy.memoRaw) { copy.memoCipher = copy.memoRaw; copy.memo = ''; } delete copy.memoRaw;
    {
      {
        if (copy.kind === 'work' && !copy.type) {
          // 유형 없는(휴대폰에서 만든) 일정은 원래 제목 그대로 되살림
          const c = await ensureCalendars();
          const start = copy.start ? { dateTime: copy.date + 'T' + copy.start + ':00' + OFFSET, timeZone: TZ } : { date: copy.date };
          const end = copy.start ? { dateTime: copy.date + 'T' + (copy.end || plus30(copy.start)) + ':00' + OFFSET, timeZone: TZ } : { date: addDays(copy.date, 1) };
          const ev = await api('POST', '/calendars/' + encodeURIComponent(c.work) + '/events', { body: { summary: copy.rawTitle || copy.target || '(제목 없음)', start, end, reminders: { useDefault: true } } });
          return ev.id;
        }
        const r = await saveEvent(copy, true, { allowPlain: true }); return r.ok ? r.event.uid : null;
      }
    }
  }
  async function restoreEvents(list) {
    let added = 0, failed = 0;
    for (const e of list || []) { try { (await restoreOne(e)) ? added++ : failed++; } catch (err) { if (err.authNeeded) throw err; failed++; } }
    return { added, failed };
  }

  /* ---------- 구글 드라이브: 연계서비스 목록·양식 ---------- */
  const DRIVE = 'https:' + '//www.googleapis.com/drive/v3';
  const UPLOAD = 'https:' + '//www.googleapis.com/upload/drive/v3';
  const LINK_FOLDER = '방문건강관리 연계자료', LINK_FILE = 'vhm-links.json';
  function needDrive() { if (!Auth.valid()) throw new AuthNeeded(); if (!Auth.hasDrive) { const e = new Error('구글 드라이브 연결이 필요합니다.'); e.noDrive = true; throw e; } }
  const qEsc = v => String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  async function driveFind(name, mime, parent, unique = false) {
    let q = "name = '" + qEsc(name) + "' and trashed = false";
    if (mime) q += " and mimeType = '" + mime + "'";
    if (parent) q += " and '" + parent + "' in parents";
    const r = await api('GET', DRIVE + '/files', { query: { q, spaces: 'drive', fields: 'files(id,name,modifiedTime,mimeType)', orderBy: 'modifiedTime desc', pageSize: 10 } });
    if (unique && (r.files || []).length > 1) throw new Error('동일 이름의 연계자료 폴더 또는 목록 파일이 여러 개입니다. 원본을 백업하고 파일을 확인하세요. 자동 병합·삭제하지 않습니다.');
    return (r.files || [])[0] || null;
  }
  let LINK = null;   // { folderId, fileId }
  async function linkFolder(create = true) {
    if (LINK && LINK.folderId) return LINK.folderId;
    const f = await driveFind(LINK_FOLDER, 'application/vnd.google-apps.folder', null, true);
    if (!f && !create) { LINK = null; return null; }
    const id = f ? f.id : (await api('POST', DRIVE + '/files', { body: { name: LINK_FOLDER, mimeType: 'application/vnd.google-apps.folder' }, query: { fields: 'id' } })).id;
    if (!f) await driveFind(LINK_FOLDER, 'application/vnd.google-apps.folder', null, true);
    LINK = Object.assign(LINK || {}, { folderId: id }); return id;
  }
  function multipart(meta, blob, mime) {
    const boundary = 'vhm' + Math.random().toString(36).slice(2);
    const body = new Blob(['--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + boundary + '\r\nContent-Type: ' + (mime || 'application/octet-stream') + '\r\n\r\n', blob, '\r\n--' + boundary + '--']);
    return { body, type: 'multipart/related; boundary=' + boundary };
  }
  async function linksLoad() {
    needDrive();
    const folder = await linkFolder(false);
    if (!folder) return { data: null, modifiedTime: null };
    const f = await driveFind(LINK_FILE, null, folder, true);
    if (!f) { LINK.fileId = null; return { data: null, modifiedTime: null }; }
    LINK.fileId = f.id;
    const res = await api('GET', DRIVE + '/files/' + f.id, { query: { alt: 'media' }, raw: true });
    let data; try { data = JSON.parse(await res.text()); } catch (e) { throw new Error('연계 목록 파일을 읽지 못했습니다 (파일이 손상되었을 수 있습니다).'); }
    return { data, modifiedTime: f.modifiedTime };
  }
  /** No force overwrite: preserve remote edits, and use If-Match when Drive exposes its ETag. */
  async function linksSave(data, baseModified, force) {
    needDrive();
    const folder = await linkFolder();
    const existing = await driveFind(LINK_FILE, null, folder, true);
    if (existing && (!LINK.fileId || existing.id !== LINK.fileId)) return {ok:false, conflict:true};
    if (!existing && LINK.fileId) return {ok:false, conflict:true};
    const json = JSON.stringify(data, null, 1);
    if (LINK.fileId) {
      const response = await api('GET', DRIVE + '/files/' + LINK.fileId, { query: { fields: 'modifiedTime,trashed' }, raw:true });
      const meta = await response.json(), etag = response.headers.get('etag');
      if (meta.trashed || !baseModified || meta.modifiedTime !== baseModified) return {ok:false, conflict:true};
      // A revision check alone has a race. Fail closed if the server omits the conditional-write token.
      if (!etag) throw new Error('동시 수정 보호용 ETag를 받지 못했습니다. 원격 자료를 덮어쓰지 않았습니다. 다시 불러오거나 Google 응답을 확인하세요.');
      try {
        const r = await api('PATCH', UPLOAD + '/files/' + LINK.fileId, { query: { uploadType: 'media', fields: 'id,modifiedTime' }, rawBody: json, contentType: 'application/json', ifMatch:etag });
        return { ok: true, modifiedTime: r.modifiedTime };
      } catch (e) { if (e.status === 412 || e.status === 404) return {ok:false, conflict:true}; throw e; }
    }
    if (baseModified) return {ok:false, conflict:true};
    const mp = multipart({ name: LINK_FILE, parents: [folder], mimeType: 'application/json' }, new Blob([json]), 'application/json');
    const r = await api('POST', UPLOAD + '/files', { query: { uploadType: 'multipart', fields: 'id,modifiedTime' }, rawBody: mp.body, contentType: mp.type });
    LINK.fileId = r.id;
    // Drive does not offer unique-name creation. Detect simultaneous first-file creation and stop further writes.
    await driveFind(LINK_FILE, null, folder, true);
    return { ok: true, modifiedTime: r.modifiedTime };
  }
  /* 상담 메모 틀 (질문 항목·문장 틀만. 대상자 정보·체크 내용은 저장하지 않음) */
  const NOTE_FILE = 'vhm-notes.json'; let NOTE_ID = null;
  async function notesLoad() {
    needDrive();
    const f = await driveFind(NOTE_FILE, null, await linkFolder());
    if (!f) { NOTE_ID = null; return { data: null }; }
    NOTE_ID = f.id;
    const res = await api('GET', DRIVE + '/files/' + f.id, { query: { alt: 'media' }, raw: true });
    try { return { data: JSON.parse(await res.text()) }; } catch (e) { return { data: null }; }
  }
  async function notesSave(data) {
    needDrive();
    const json = JSON.stringify(data, null, 1);
    if (NOTE_ID) { await api('PATCH', UPLOAD + '/files/' + NOTE_ID, { query: { uploadType: 'media', fields: 'id' }, rawBody: json, contentType: 'application/json' }); return true; }
    const mp = multipart({ name: NOTE_FILE, parents: [await linkFolder()], mimeType: 'application/json' }, new Blob([json]), 'application/json');
    NOTE_ID = (await api('POST', UPLOAD + '/files', { query: { uploadType: 'multipart', fields: 'id' }, rawBody: mp.body, contentType: mp.type })).id;
    return true;
  }
  async function uploadForm(file) {
    needDrive();
    if (file.size > 20 * 1048576) throw new Error('20MB보다 큰 파일은 올릴 수 없습니다.');
    const folder = await linkFolder();
    const mp = multipart({ name: file.name, parents: [folder] }, file, file.type);
    const r = await api('POST', UPLOAD + '/files', { query: { uploadType: 'multipart', fields: 'id,name,mimeType,webViewLink,size' }, rawBody: mp.body, contentType: mp.type });
    return { type: 'file', fileId: r.id, name: r.name || file.name, mime: r.mimeType || file.type, link: r.webViewLink || '' };
  }
  async function downloadForm(fileId, name) {
    needDrive();
    const res = await api('GET', DRIVE + '/files/' + fileId, { query: { alt: 'media' }, raw: true });
    const blob = await res.blob(); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name || 'file'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60e3); return true;
  }
  async function trashForm(fileId) { needDrive(); await api('PATCH', DRIVE + '/files/' + fileId, { body: { trashed: true } }); return true; }

  window.SERVER = {
    async getBootstrap() {
      const c = await ensureCalendars();
      try { if (c.email) localStorage.setItem('vhm-email', c.email); } catch (e) {}
      return { settings: getSettings(), email: c.email, today: kst(new Date().toISOString()).date, calendars: { work: WORK, personal: PERS, done: DONE, due: DUE } };
    },
    async saveSettings(patch) {
      const s = getSettings();
      ['defaultReminder', 'titleAlias', 'show', 'view', 'timeStep'].forEach(k => { if (patch && k in patch) s[k] = patch[k]; });
      s.defaultReminder = Number(s.defaultReminder); s.titleAlias = !!s.titleAlias;
      s.timeStep = [5, 10, 30].indexOf(Number(s.timeStep)) >= 0 ? Number(s.timeStep) : 10;
      try { localStorage.setItem(SET_KEY, JSON.stringify(s)); } catch (e) {}
      return s;
    },
    async listEvents(f, t) { return Promise.all((await listEvents(f, t)).map(decObj)); },
    async saveEvent(e, force) { const r = await saveEvent(e, force); if (r.event) await decObj(r.event); if (r.current) await decObj(r.current); return r; },
    async setStatus(id, st, up) { const r = await setStatus(id, st, up); if (r.event) await decObj(r.event); if (r.current) await decObj(r.current); return r; },
    async setDone(id, d, up) { const r = await setDone(id, d, up); if (r.event) await decObj(r.event); if (r.current) await decObj(r.current); return r; },
    async listDone(f, t) { return Promise.all((await listDone(f, t)).map(decObj)); },
    async listAll(f, t) { const r = await listAll(f, t); return { active: await Promise.all(r.active.map(decObj)), done: await Promise.all(r.done.map(decObj)) }; },
    async getEvent(id) { const f = await findEvent(id); if (!f) return null; const o = toObj(f.ev, f.kind, f.done); if (f.done) o.inDone = true; return decObj(o); },
    saveAdj, postpone, moveDone, listDue, delDue: id => delDue(id).then(() => ({ ok: true })),
    async deleteEvent(id, up) { const r = await deleteEvent(id, up); if (r.current) await decObj(r.current); return r; },
    getStats, exportBackup, restoreBackup, restoreEvents,
    lockState, lockSetup, lockUnlock, lockNow, lockAll, lockStash, lockResume, bioAvailable, bioRegister, bioUnlock, bioRemove, isOpen: () => !!Lock.key,
    linksLoad, linksSave, uploadForm, downloadForm, trashForm, notesLoad, notesSave,
    hasDrive: () => Auth.hasDrive,
    _resetCache() { CAL = null; LINK = null; NOTE_ID = null; Lock.meta = undefined; lockNow(); }
  };
})();
