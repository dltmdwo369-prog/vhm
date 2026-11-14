/**
 * 방문건강관리사업 · 업무 일정 관리 (Google Apps Script 웹앱)
 *
 * - 일정은 본인 구글 캘린더 두 개에 저장합니다.
 *     방문건강관리(업무) : 업무 일정 (실적 집계 대상)
 *     방문건강관리(개인) : 개인 일정·메모 (실적 집계 제외)
 * - 유형·상태 등은 일정의 '숨은 태그'에 저장하고, 제목은 "[방문] 완료"처럼 최소 정보만 씁니다.
 * - 휴대폰 구글 캘린더에서 제목을 "[전화] 완료"처럼 바꾸면 일정표에도 그 상태가 반영됩니다.
 * - 교육자료 보관함·백업 파일은 본인 구글 드라이브 폴더에 저장합니다 (직접 올린 파일만).
 *
 * 비밀번호·비밀 키를 쓰지 않습니다. 처음 실행할 때 구글이 보여주는 권한 승인 화면에서 직접 승인합니다.
 */

var APP = {
  WORK_CAL: '방문건강관리(업무)',
  PERSONAL_CAL: '방문건강관리(개인)',
  ARCHIVE_FOLDER: '방문건강관리 자료보관함',
  BACKUP_FOLDER: '방문건강관리 백업',
  TZ: 'Asia/Seoul',
  TYPES: ['신규', '방문', '전화', '내소', '연계'],
  STATUSES: ['예정', '완료', '부재', '취소'],
  GROUPS: ['집중관리군', '정기관리군', '자기역량지원군', '미지정'],
  MAX_UPLOAD_MB: 20,
  KEEP_BACKUPS: 30
};

/* ================= 웹앱 진입점 ================= */
function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('방문건강관리사업 · 업무 일정')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

/* ================= 설정·캘린더 준비 ================= */
function props_() { return PropertiesService.getUserProperties(); }

function defaultSettings_() {
  return { defaultReminder: 30, titleAlias: false, show: 'all', view: 'month', dailyBackup: false, timeStep: 10 };
}
function getSettings_() {
  var raw = props_().getProperty('settings');
  var s = defaultSettings_();
  if (raw) { try { var o = JSON.parse(raw); for (var k in o) s[k] = o[k]; } catch (e) {} }
  return s;
}
function saveSettings(patch) {
  var s = getSettings_();
  ['defaultReminder', 'titleAlias', 'show', 'view', 'timeStep'].forEach(function (k) { if (patch && k in patch) s[k] = patch[k]; });
  s.defaultReminder = Number(s.defaultReminder);
  s.timeStep = [5, 10, 30].indexOf(Number(s.timeStep)) >= 0 ? Number(s.timeStep) : 10;
  s.titleAlias = !!s.titleAlias;
  props_().setProperty('settings', JSON.stringify(s));
  return s;
}

/** 이름으로 캘린더를 찾고, 없으면 만듭니다. 찾은 ID는 저장해 둡니다. */
function ensureCalendar_(key, name, color) {
  var id = props_().getProperty(key);
  var cal = id ? CalendarApp.getCalendarById(id) : null;
  if (!cal) {
    var found = CalendarApp.getCalendarsByName(name);
    cal = found && found.length ? found[0] : CalendarApp.createCalendar(name, { timeZone: APP.TZ, color: color });
    props_().setProperty(key, cal.getId());
  }
  return cal;
}
function workCal_() { return ensureCalendar_('workCalId', APP.WORK_CAL, CalendarApp.Color.GREEN); }
function personalCal_() { return ensureCalendar_('personalCalId', APP.PERSONAL_CAL, CalendarApp.Color.GRAY); }

function ensureFolder_(key, name) {
  var id = props_().getProperty(key), folder = null;
  if (id) { try { folder = DriveApp.getFolderById(id); if (folder.isTrashed()) folder = null; } catch (e) { folder = null; } }
  if (!folder) {
    var it = DriveApp.getFoldersByName(name);
    folder = it.hasNext() ? it.next() : DriveApp.createFolder(name);
    props_().setProperty(key, folder.getId());
  }
  return folder;
}

/** 화면이 처음 열릴 때 부르는 함수 */
function getBootstrap() {
  workCal_(); personalCal_();
  var s = getSettings_();
  s.dailyBackup = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'dailyBackup'; });
  return {
    settings: s,
    email: Session.getActiveUser().getEmail(),
    today: Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd'),
    calendars: { work: APP.WORK_CAL, personal: APP.PERSONAL_CAL }
  };
}

/* ================= 일정 변환 ================= */
var TITLE_RE = /^\s*\[(신규|방문|전화|내소|연계)\]\s*(예정|완료|부재|취소)?\s*(.*)$/;

function tag_(ev, k) { var v = ev.getTag('vhm_' + k); return v == null ? '' : String(v); }
function setTags_(ev, obj) { for (var k in obj) ev.setTag('vhm_' + k, obj[k] == null ? '' : String(obj[k])); }
function fmt_(d, p) { return Utilities.formatDate(d, APP.TZ, p); }
function newUid_() { return Utilities.getUuid().replace(/-/g, ''); }

function workTitle_(e, titleAlias) {
  return '[' + e.type + ']' + (e.status && e.status !== '예정' ? ' ' + e.status : '') + (titleAlias && e.target ? ' ' + e.target : '');
}
function personalTitle_(e) { return e.title || (e.ptype === '메모' ? '메모' : '개인 일정'); }

/** 캘린더 일정 → 화면용 객체 (문자열·숫자만) */
function toObj_(ev, kind) {
  var allDay = ev.isAllDayEvent();
  var startD = allDay ? ev.getAllDayStartDate() : ev.getStartTime();
  var endD = allDay ? null : ev.getEndTime();
  var o = {
    id: ev.getId(), kind: kind, uid: tag_(ev, 'uid') || ev.getId(),   // 휴대폰에서 만든 일정은 캘린더 ID를 대신 사용 (복원 시 중복 방지)
    date: fmt_(startD, 'yyyy-MM-dd'),
    start: allDay ? '' : fmt_(startD, 'HH:mm'),
    end: allDay ? '' : fmt_(endD, 'HH:mm'),
    endDate: allDay ? '' : fmt_(endD, 'yyyy-MM-dd'),
    memo: tag_(ev, 'memo'),
    parentId: tag_(ev, 'parent'),
    reminder: -1,
    updated: ev.getLastUpdated().toISOString(),
    fromApp: tag_(ev, 'kind') !== ''
  };
  var rem = ev.getPopupReminders();
  if (rem && rem.length) o.reminder = Math.min.apply(null, rem);
  var title = ev.getTitle() || '';
  if (kind === 'work') {
    o.type = tag_(ev, 'type'); o.status = tag_(ev, 'status') || '예정';
    o.group = tag_(ev, 'group') || '미지정'; o.target = tag_(ev, 'target');
    var m = TITLE_RE.exec(title);
    if (m) {                                   // 휴대폰에서 바꾼 제목이 우선
      o.type = m[1]; o.status = m[2] || '예정';
      if (!o.target && m[3]) o.target = m[3].slice(0, 40);
    } else if (!o.fromApp) {
      o.target = o.target || title.slice(0, 40);
    }
    if (APP.TYPES.indexOf(o.type) < 0) o.type = '';   // 유형 없음 = 미분류 → 실적 제외
    if (APP.STATUSES.indexOf(o.status) < 0) o.status = '예정';
    o.rawTitle = title;
  } else {
    o.ptype = tag_(ev, 'ptype') || (allDay ? '메모' : '일정');
    if (!o.fromApp) o.ptype = '일정';
    o.title = title;
  }
  return o;
}

function rangeDates_(from, to) {
  var s = Utilities.parseDate(from + ' 00:00', APP.TZ, 'yyyy-MM-dd HH:mm');
  var e = Utilities.parseDate(to + ' 00:00', APP.TZ, 'yyyy-MM-dd HH:mm');
  e = new Date(e.getTime() + 24 * 3600 * 1000);
  return [s, e];
}

/** 기간 안의 업무·개인 일정 */
function listEvents(from, to) {
  var r = rangeDates_(from, to), out = [];
  workCal_().getEvents(r[0], r[1]).forEach(function (ev) { out.push(toObj_(ev, 'work')); });
  personalCal_().getEvents(r[0], r[1]).forEach(function (ev) { out.push(toObj_(ev, 'personal')); });
  return out.filter(function (o) { return o.date >= from && o.date <= to; });
}

/* ================= 일정 저장·삭제 ================= */
function validate_(e) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) throw new Error('날짜가 올바르지 않습니다.');
  ['start', 'end'].forEach(function (k) { if (e[k] && !/^\d{2}:\d{2}$/.test(e[k])) throw new Error('시간이 올바르지 않습니다.'); });
  if (e.start && e.end && e.end < e.start) throw new Error('종료 시간이 시작 시간보다 빠릅니다.');
  if (e.kind === 'work') {
    if (APP.TYPES.indexOf(e.type) < 0) throw new Error('유형을 선택하세요.');
    if (APP.STATUSES.indexOf(e.status) < 0) e.status = '예정';
    if (APP.GROUPS.indexOf(e.group) < 0) e.group = '미지정';
    e.target = String(e.target || '').slice(0, 40);
  } else {
    e.kind = 'personal';
    e.ptype = e.ptype === '메모' ? '메모' : '일정';
    e.title = String(e.title || '').slice(0, 80);
    if (!e.title && !e.memo) throw new Error('제목이나 메모를 입력하세요.');
  }
  e.memo = String(e.memo || '').slice(0, 500);
  e.reminder = Number(e.reminder);
  if (!isFinite(e.reminder)) e.reminder = -1;
  return e;
}

function findEvent_(id) {
  var ev = workCal_().getEventById(id);
  if (ev) return { ev: ev, kind: 'work' };
  ev = personalCal_().getEventById(id);
  if (ev) return { ev: ev, kind: 'personal' };
  return null;
}

function applyTimes_(ev, e, cal) {
  var tz = APP.TZ;
  if (e.start) {
    var s = Utilities.parseDate(e.date + ' ' + e.start, tz, 'yyyy-MM-dd HH:mm');
    var en = e.end ? Utilities.parseDate(e.date + ' ' + e.end, tz, 'yyyy-MM-dd HH:mm') : new Date(s.getTime() + 30 * 60000);
    if (ev) { ev.setTime(s, en); return ev; }
    return cal.createEvent('일정', s, en);
  }
  var d = Utilities.parseDate(e.date + ' 00:00', tz, 'yyyy-MM-dd HH:mm');
  if (ev) { ev.setAllDayDate(d); return ev; }
  return cal.createAllDayEvent('일정', d);
}

function writeEvent_(ev, e, settings) {
  ev.setTitle(e.kind === 'work' ? workTitle_(e, settings.titleAlias) : personalTitle_(e));
  var tags = { kind: e.kind, memo: e.memo, parent: e.parentId || '', uid: e.uid || tag_(ev, 'uid') || newUid_() };
  if (e.kind === 'work') { tags.type = e.type; tags.status = e.status; tags.group = e.group; tags.target = e.target; }
  else { tags.ptype = e.ptype; }
  setTags_(ev, tags);
  ev.removeAllReminders();
  if (e.reminder >= 0) ev.addPopupReminder(e.reminder);
}

/**
 * 일정 저장 (새로 만들기·수정).
 * 수정할 때는 화면이 알고 있던 수정 시각(updated)을 함께 보냅니다.
 * 그 사이 휴대폰 등에서 바뀌었다면 덮어쓰지 않고 conflict 로 알려줍니다.
 */
function saveEvent(e, force) {
  var lock = LockService.getUserLock(); lock.waitLock(20000);
  try {
    e = validate_(e);
    var settings = getSettings_();
    var cal = e.kind === 'work' ? workCal_() : personalCal_();
    var ev = null;
    if (e.id) {
      var f = findEvent_(e.id);
      if (!f) return { ok: false, gone: true, message: '이 일정은 다른 기기에서 삭제되었습니다.' };
      if (!force && e.updated && f.ev.getLastUpdated().toISOString() !== e.updated)
        return { ok: false, conflict: true, current: toObj_(f.ev, f.kind) };
      if (f.kind !== e.kind) {          // 업무↔개인 구분을 바꾸면 다른 캘린더로 옮김
        e.uid = tag_(f.ev, 'uid'); f.ev.deleteEvent();
      } else ev = f.ev;
    }
    if (ev && ev.isAllDayEvent() !== !e.start) {   // 종일↔시간 지정 전환은 새로 만들어 교체
      e.uid = tag_(ev, 'uid'); ev.deleteEvent(); ev = null;
    }
    ev = applyTimes_(ev, e, cal);
    writeEvent_(ev, e, settings);
    return { ok: true, event: toObj_(ev, e.kind) };
  } finally { lock.releaseLock(); }
}

function setStatus(id, status, updated) {
  var f = findEvent_(id);
  if (!f) return { ok: false, gone: true, message: '이 일정은 다른 기기에서 삭제되었습니다.' };
  var o = toObj_(f.ev, f.kind);
  if (updated && o.updated !== updated) return { ok: false, conflict: true, current: o };
  o.status = status;
  return saveEvent(o, true);
}

function deleteEvent(id, updated) {
  var lock = LockService.getUserLock(); lock.waitLock(20000);
  try {
    var f = findEvent_(id);
    if (!f) return { ok: true, already: true };
    if (updated && f.ev.getLastUpdated().toISOString() !== updated)
      return { ok: false, conflict: true, current: toObj_(f.ev, f.kind) };
    f.ev.deleteEvent();
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/* ================= 실적 집계 ================= */
/** 업무 캘린더 + 유형 있음 + 상태별 건수. 개인 캘린더는 읽지 않으므로 항상 제외됩니다. */
function getStats(from, to) {
  var r = rangeDates_(from, to), res = {}, unclassified = 0;
  APP.TYPES.forEach(function (t) { res[t] = { '완료': 0, '부재': 0, '예정': 0, '취소': 0 }; });
  workCal_().getEvents(r[0], r[1]).forEach(function (ev) {
    var o = toObj_(ev, 'work');
    if (o.date < from || o.date > to) return;
    if (!o.type) { unclassified++; return; }
    res[o.type][o.status]++;
  });
  return { from: from, to: to, counts: res, unclassified: unclassified };
}

/* ================= 백업 ================= */
function backupPayload_(from, to) {
  return { app: 'vhm-calendar-gas', schema: 1, exportedAt: new Date().toISOString(), from: from, to: to, events: listEvents(from, to) };
}
/** 화면의 '백업 저장' — 드라이브 백업 폴더에 JSON 파일을 만들고 링크를 돌려줍니다. */
function exportBackup(from, to) {
  var payload = backupPayload_(from, to);
  var name = '일정백업_' + fmt_(new Date(), 'yyyyMMdd_HHmm') + '.json';
  var file = ensureFolder_('backupFolderId', APP.BACKUP_FOLDER).createFile(name, JSON.stringify(payload, null, 1), 'application/json');
  return { name: name, url: file.getUrl(), count: payload.events.length, json: JSON.stringify(payload) };
}
/** 매일 자동 백업 (켜면 하루 한 번, 앞뒤 1년치 일정) */
function dailyBackup() {
  var now = new Date();
  var from = fmt_(new Date(now.getTime() - 365 * 864e5), 'yyyy-MM-dd'), to = fmt_(new Date(now.getTime() + 365 * 864e5), 'yyyy-MM-dd');
  var folder = ensureFolder_('backupFolderId', APP.BACKUP_FOLDER);
  folder.createFile('자동백업_' + fmt_(now, 'yyyyMMdd') + '.json', JSON.stringify(backupPayload_(from, to)), 'application/json');
  var files = [], it = folder.getFiles();
  while (it.hasNext()) { var f = it.next(); if (f.getName().indexOf('자동백업_') === 0) files.push(f); }
  files.sort(function (a, b) { return b.getName() < a.getName() ? -1 : 1; });
  files.slice(APP.KEEP_BACKUPS).forEach(function (f) { f.setTrashed(true); });
}
function setDailyBackup(on) {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dailyBackup') ScriptApp.deleteTrigger(t); });
  if (on) ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(18).inTimezone(APP.TZ).create();
  return !!on;
}
/** 백업 파일 복원 — 일정표에 없는 일정(uid 기준)만 다시 만듭니다. 이미 있는 일정은 건드리지 않습니다. */
function restoreBackup(json) {
  var data = JSON.parse(json);
  if (!data || !Array.isArray(data.events)) throw new Error('이 일정표의 백업 파일이 아닙니다.');
  var evs = data.events.filter(function (e) { return e && e.date; });
  if (!evs.length) return { added: 0, skipped: 0 };
  var dates = evs.map(function (e) { return e.date; }).sort();
  var have = {};
  listEvents(dates[0], dates[dates.length - 1]).forEach(function (o) { if (o.uid) have[o.uid] = true; });
  var added = 0, skipped = 0, failed = 0;
  evs.forEach(function (e) {
    if (e.uid && have[e.uid]) { skipped++; return; }
    var copy = {}; for (var k in e) copy[k] = e[k];
    delete copy.id; delete copy.updated;
    if (copy.kind === 'work' && !copy.type) { failed++; return; }
    try { var r = saveEvent(copy, true); if (r.ok) { added++; if (r.event.uid) have[r.event.uid] = true; } else failed++; }
    catch (err) { failed++; }
  });
  return { added: added, skipped: skipped, failed: failed };
}

/* ================= 교육자료 보관함 (구글 드라이브) ================= */
function archiveFolderUrl() { return ensureFolder_('archiveFolderId', APP.ARCHIVE_FOLDER).getUrl(); }

function listArchive() {
  var folder = ensureFolder_('archiveFolderId', APP.ARCHIVE_FOLDER), out = [], it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    out.push({ id: f.getId(), name: f.getName(), mime: f.getMimeType(), size: f.getSize(),
      category: f.getDescription() || '기타', added: fmt_(f.getDateCreated(), 'yyyy-MM-dd'), url: f.getUrl() });
  }
  out.sort(function (a, b) { return b.added < a.added ? -1 : b.added > a.added ? 1 : a.name < b.name ? -1 : 1; });
  return out;
}
function uploadArchive(name, mime, base64, category) {
  var bytes = Utilities.base64Decode(base64);
  if (bytes.length > APP.MAX_UPLOAD_MB * 1048576) throw new Error(APP.MAX_UPLOAD_MB + 'MB보다 큰 파일은 드라이브에 직접 올려 주세요.');
  var f = ensureFolder_('archiveFolderId', APP.ARCHIVE_FOLDER).createFile(Utilities.newBlob(bytes, mime || 'application/octet-stream', name));
  f.setDescription(String(category || '기타').slice(0, 30));
  return { id: f.getId() };
}
function setArchiveCategory(id, category) {
  var f = DriveApp.getFileById(id); assertInArchive_(f);
  f.setDescription(String(category || '기타').slice(0, 30)); return true;
}
function deleteArchive(id) {
  var f = DriveApp.getFileById(id); assertInArchive_(f);
  f.setTrashed(true); return true;   // 드라이브 휴지통으로 이동 (30일 안에 되살릴 수 있음)
}
function assertInArchive_(f) {
  var folderId = ensureFolder_('archiveFolderId', APP.ARCHIVE_FOLDER).getId(), it = f.getParents();
  while (it.hasNext()) if (it.next().getId() === folderId) return;
  throw new Error('보관함 폴더의 파일이 아닙니다.');
}

/* ================= 설치 확인용 (편집기에서 직접 실행) ================= */
/** 편집기에서 이 함수를 선택해 ▶실행 하면 권한 승인 화면이 뜨고, 캘린더 두 개가 만들어집니다. */
function setup() {
  var b = getBootstrap();
  ensureFolder_('archiveFolderId', APP.ARCHIVE_FOLDER);
  ensureFolder_('backupFolderId', APP.BACKUP_FOLDER);
  Logger.log('준비 완료: ' + b.calendars.work + ', ' + b.calendars.personal + ' 캘린더와 드라이브 폴더 2개를 확인했습니다.');
}
