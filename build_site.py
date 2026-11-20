# 웹앱 화면(Index.html)을 호스팅용 index.html 로 바꿉니다.
# 원본: ui-source/Index.html, Handouts.html  +  src/gcal-api.js
import os, re, json
import os
ROOT = os.path.dirname(os.path.abspath(__file__)) + '/'
SRC = ROOT + 'ui-source/'
H = ROOT
s = open(SRC + 'Index.html', encoding='utf-8').read()
handouts = open(SRC + 'Handouts.html', encoding='utf-8').read()
api = open(H + 'src/gcal-api.js', encoding='utf-8').read()

def rep(a, b, count=1):
    global s
    n = s.count(a)
    assert n >= 1, ('찾지 못함', a[:80])
    s = s.replace(a, b) if count == 0 else s.replace(a, b, count)

rep('<base target="_top">\n', '')
rep('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>방문건강관리사업 · 업무 일정</title>\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="방문건강관리">')
education = json.load(open(H + 'data/education.json', encoding='utf-8'))
assert len(education['items']) == 10
education_js = json.dumps(education, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
handouts = handouts.replace('/* EDUCATION_DATA */', 'window.VHM_EDUCATION = ' + education_js + '; window.HANDOUTS = window.VHM_EDUCATION.items;')
rep("<?!= include('Handouts'); ?>", handouts)
rep('/* EDUCATION_MODULE */', open(H + 'src/education.js', encoding='utf-8').read())
rep('.toast{', '.connect{margin:14px 20px 0;padding:14px 16px;background:#fff;border:1px solid #cfdcf3;border-left:4px solid var(--accent);border-radius:10px;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}\n.connect p{margin:2px 0 0;color:var(--sub);font-size:13px}\n.toast{')

# 연결 안내 상자
rep('<section id="tab-cal">', '<section id="tab-cal">\n  <div id="connectBox" class="connect" hidden><div><b>구글 캘린더 연결</b><p id="connectMsg"></p></div><button class="primary" id="btnConnect">구글 계정으로 연결</button></div>')

# 자료 보관함 탭 숨김 (드라이브 보관함은 Apps Script 웹앱에서만)
rep('    <button role="tab" data-tab="arch" aria-selected="false">자료 보관함</button>\n', '')

# 설정 탭
rep('    <div class="infobox" id="setStatus"></div>', '    <div class="infobox" id="setStatus"></div>\n    <div class="row" style="margin-top:8px"><button id="btnSignOut">이 기기에서 연결 해제</button><span class="hint">구글 캘린더의 일정은 그대로 남습니다. 다시 쓰려면 ‘구글 계정으로 연결’을 누르세요.</span></div>\n    <h3 style="margin:18px 0 8px">Drive 저장 계정</h3>\n    <div id="driveAccountSettings"></div>\n    <h3 style="margin:18px 0 8px">연결 유지</h3>\n    <div class="infobox" id="keepSet"></div>')
rep('    <h3 style="margin:18px 0 8px">일정 기본값</h3>', '    <h3 style="margin:18px 0 8px">일정 기본값 <span class="hint" style="font-weight:400">(이 설정은 기기마다 따로 저장됩니다)</span></h3>')
rep('실수로 지운 경우를 대비해 드라이브 ‘방문건강관리 백업’ 폴더에 JSON 파일로 남깁니다.', '실수로 지운 경우를 대비해 이 기기에 JSON 파일로 내려받아 둘 수 있습니다.')
rep('    <label class="opt"><input type="checkbox" id="setDaily">', '    <label class="opt" hidden><input type="checkbox" id="setDaily">')
rep("toast('드라이브에 백업했습니다.');", "toast('백업 파일을 내려받았습니다.');")
rep(' 로 저장했습니다.`;', ' 파일로 내려받았습니다.`;')

# 알림: 캘린더 기본 알림 선택지 (휴대폰에서 만든 일정의 기본 알림을 지우지 않도록)
rep('<select name="reminder">\n          <option value="-1">알림 없음</option>', '<select name="reminder">\n          <option value="-2">캘린더 기본 알림</option><option value="-1">알림 없음</option>')

# 후속 일정: 예전(Apps Script) 방식 ID 도 찾기
rep('S.events.find(x => x.id === d.parentId)', 'S.events.find(x => x.id === d.parentId || x.ical === d.parentId || x.uid === d.parentId || (x.previousIds || []).includes(d.parentId))')
rep("S.events.find(x => x.id === $('#eventForm').dataset.parentId)", "S.events.find(x => x.id === $('#eventForm').dataset.parentId || x.ical === $('#eventForm').dataset.parentId || x.uid === $('#eventForm').dataset.parentId || (x.previousIds || []).includes($('#eventForm').dataset.parentId))")

# 서버 호출 → 브라우저에서 직접
old_call = s[s.index('function call(fn, ...args) {'):s.index('function toast(msg')]
s = s.replace(old_call, """function call(fn, ...args) {
  return Promise.resolve().then(() => {
    if (!window.SERVER || !SERVER[fn]) throw new Error('이 버전에서는 지원하지 않는 기능입니다 (' + fn + ').');
    return SERVER[fn](...args);
  });
}
function showConnect(msg) {
  $('#connectBox').hidden = false;
  $('#connectMsg').textContent = msg || '구글 계정으로 연결하면 일정을 불러옵니다.';
}
""")
rep("  try { const r = await fn(); return r; }\n  catch (e) { syncState('err', '연결 실패 — 인터넷 연결을 확인한 뒤 새로고침하세요'); toast('실패: ' + (e.message || e), 5000); throw e; }",
    "  try { const r = await fn(); $('#sync').classList.remove('err'); return r; }\n  catch (e) {\n    if (e && e.authNeeded) { showConnect(e.message + ' 아래 버튼을 눌러 주세요.'); syncState('err', '구글 캘린더 연결 필요'); }\n    else if (e && e.noDrive) { /* 연계 안내 탭에서 '드라이브 연결' 버튼으로 안내 */ }\n    else { syncState('err', '연결 실패 — 인터넷 연결을 확인한 뒤 새로고침하세요'); toast('실패: ' + (e.message || e), 5000); }\n    throw e;\n  }")

# 시작 순서
old_start = s[s.index('(async function start() {'):s.index('</script>\n</body>')]
s = s.replace(old_start, """async function boot() {
  const b = await run('구글 캘린더 연결 중…', () => call('getBootstrap'));
  await VHM_AUTH.verifyDrive(b.email);
  if(window.DRIVE_ACCOUNT)DRIVE_ACCOUNT.render();
  $('#connectBox').hidden = true;
  S.settings = b.settings; renderSettings(b); render(); await loadEvents();
}
(async function start() {
  const d = new Date(); S.cursor = new Date(d.getFullYear(), d.getMonth(), 1);
  S.settings = Object.assign({ show:'all', view:'month', defaultReminder:30, titleAlias:false, timeStep:10 }, (() => { try { return JSON.parse(localStorage.getItem('vhm-settings') || '{}'); } catch (e) { return {}; } })());
  bind(); render();
  $('#btnConnect').onclick = async () => {
    $('#btnConnect').disabled = true;
    try { await VHM_AUTH.request('base'); $('#connectBox').hidden = true; await boot(); }
    catch (e) { if (!e.authNeeded) toast(e.message || String(e), 5000); }
    finally { $('#btnConnect').disabled = false; }
  };
  $('#btnSignOut').onclick = () => {
    if (!confirm('이 기기에서 구글 연결을 해제할까요? 구글 캘린더의 일정은 지워지지 않습니다.')) return;
    VHM_AUTH.signOut(); SERVER._resetCache(); S.events = []; render();
    showConnect('연결을 해제했습니다. 다시 쓰려면 아래 버튼을 누르세요.'); showTab('cal');
  };
  if (!(window.VHM_CONFIG && VHM_CONFIG.clientId)) {
    showConnect('설정 파일(config.js)에 클라이언트 ID가 아직 없습니다. 설치 안내의 클라이언트 ID 단계를 확인하세요.');
    $('#btnConnect').disabled = true; syncState('err', '설정 필요'); return;
  }
  const rr = VHM_AUTH.redirectResult;
  if (window.KEEP && KEEP.autoStart(rr)) { showConnect('업무시간이라 구글에 자동으로 다시 연결하는 중입니다…'); syncState('', '자동 연결 중…'); return; }
  if (rr && rr.error) { showConnect(rr.error); syncState('err', '구글 캘린더 연결 필요'); if (!VHM_AUTH.valid()) return; }
  if (!VHM_AUTH.valid()) { showConnect('처음 한 번, 그리고 1시간쯤 지나면 다시 연결이 필요합니다. 버튼을 누르면 구글 로그인 페이지로 이동했다가 돌아옵니다.'); syncState('err', '구글 캘린더 연결 필요'); return; }
  try {
    await boot();
    if (rr && rr.drive && !rr.silent) { let to = 'link'; try { to = sessionStorage.getItem('vhm-after-drive') || 'link'; sessionStorage.removeItem('vhm-after-drive'); } catch (e) {} showTab(to); if (rr.driveError) toast(rr.driveError, 6000); }
    if (rr && rr.drive && rr.silent && rr.driveError) toast(rr.driveError,6000);
    if (rr && rr.silentFailed) toast('자동으로 다시 연결하지 못했습니다. 지금 연결은 곧 끝납니다. 끝나면 ‘구글 계정으로 연결’을 눌러 주세요.', 9000);
  } catch (e) {}
})();
""")

# ===== 연계 안내 탭 =====
catalog = json.load(open(H + 'data/public-referrals.json', encoding='utf-8'))
assert len({x['id'] for x in catalog['services']}) == len(catalog['services']), 'duplicate catalog IDs'
assert all(x['verificationStatus'] in ('consultable', 'needs_contact') and x['referralCode'] in (1,2,3,4) for x in catalog['services'])
# Prevent data from closing the inline script, even in future catalog updates.
catalog_js = json.dumps(catalog, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
refined = json.load(open(H + 'data/refined-needs.json', encoding='utf-8'))
refined_items = [i for g in refined['groups'] for i in g['items']]
assert len({i['id'] for i in refined_items}) == len(refined_items), 'duplicate refined need IDs'
assert all(i['parents'] and all(sid in {s['id'] for s in catalog['services']} for sid in i['serviceIds']) for i in refined_items), 'invalid refined need mapping'
refined_js = json.dumps(refined, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
links = 'window.VHM_REFINED_NEEDS = ' + refined_js + ';\n' + 'window.VHM_PUBLIC_REFERRALS = ' + catalog_js + ';\n' + open(H + 'src/note-referrals.js', encoding='utf-8').read() + '\n' + open(H + 'src/referral-model.js', encoding='utf-8').read() + '\n' + open(H + 'src/links.js', encoding='utf-8').read()
rep('    <button role="tab" data-tab="edu" aria-selected="false">교육자료</button>', '    <button role="tab" data-tab="note" aria-selected="false">상담 메모</button>\n    <button role="tab" data-tab="phis" aria-selected="false">PHIS 기록 관리</button>\n    <button role="tab" data-tab="link" aria-selected="false">연계 안내</button>\n    <button role="tab" data-tab="box" aria-selected="false">보관함</button>\n    <button role="tab" data-tab="edu" aria-selected="false">교육자료</button>')
rep('<section id="tab-edu" class="page" hidden></section>', '<section id="tab-note" class="page" hidden></section>\n<section id="tab-phis" class="page" hidden></section>\n<section id="tab-link" class="page" hidden></section>\n<section id="tab-box" class="page" hidden></section>\n<section id="tab-edu" class="page" hidden></section>')
rep("  ['cal','edu','arch','set'].forEach(t => $('#tab-' + t).hidden = t !== name);", "  ['cal','note','phis','link','box','edu','arch','set'].forEach(t => { const x = $('#tab-' + t); if (x) x.hidden = t !== name; });\n  if (name === 'link' && window.LINKS) LINKS.open({fromNotes:previousTab === 'note'});\n  if (name === 'box' && window.ARCHIVE) ARCHIVE.open();\n  if (name === 'note' && window.NOTES) NOTES.open();\n  if (name === 'phis' && window.PHIS) PHIS.open();")
rep('<!-- 선택 상자 -->', """<!-- 상담 메모 항목 편집 -->
<dialog id="ntDlg" class="wide">
  <div class="dlg-head"><h3 id="ntDlgTitle">항목</h3><button type="button" class="link" data-close>닫기</button></div>
  <div class="dlg-body" id="ntDlgBody"></div>
  <div class="dlg-foot"><button type="button" class="danger" id="ntDel">삭제</button><div class="right"><button type="button" data-close>취소</button><button type="button" class="primary" id="ntSave">저장</button></div></div>
</dialog>

<!-- 연계서비스 편집 -->
<dialog id="svcDlg" class="wide">
  <div class="dlg-head"><h3 id="svcTitle">서비스</h3><button type="button" class="link" data-close>닫기</button></div>
  <div class="dlg-body"><form id="svcForm" onsubmit="return false"></form></div>
  <div class="dlg-foot"><button type="button" class="danger" id="svcDelete">삭제</button><div class="right"><button type="button" data-close>취소</button><button type="button" class="primary" id="svcSave">저장</button></div></div>
</dialog>

<!-- 선택 상자 -->""")
rep('dialog::backdrop{', """.nt-layout{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:16px;align-items:start}
.nt-outcard{position:sticky;top:12px}
@media (max-width:900px){.nt-layout{grid-template-columns:1fr}.nt-outcard{position:sticky;top:auto;bottom:0;z-index:5;box-shadow:0 -6px 18px rgba(0,0,0,.12)}.nt-outcard #ntOut{height:5.5em;max-height:22vh}}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.nt-flag{font-size:12px;font-weight:700;border-radius:6px;padding:2px 6px;min-width:0}
.nt-flag:empty{display:none}
.nt-flag.ok{color:#1e6b3a;background:#e6f4ea}.nt-flag.warn{color:#8a5a00;background:#fff3d6}.nt-flag.high{color:#b3261e;background:#fde7e5}.nt-flag.low{color:#1d4ed8;background:#e3ecff}
.nt-chip.on.done{background:#e6f4ea;border-color:#9fd0ad;color:#1e6b3a}
.nt-chip small{font-weight:600;font-size:12px}
.nt-chip.sm{padding:4px 10px;min-height:30px;font-size:13px}
.nt-ctl .nt-num{margin-right:6px}
.nt-fbox{border:1px solid var(--line);border-radius:8px;padding:8px;margin-bottom:8px;background:#fafbfd}
.nt-fbox .nt-orow{grid-template-columns:auto minmax(0,1.3fr) auto minmax(0,1fr) auto;align-items:center}
.nt-rrow{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:13px;margin-top:4px}
.nt-r{width:64px;padding:5px 6px}
@media (max-width:560px){.nt-fbox .nt-orow{grid-template-columns:auto minmax(0,1fr) auto}.nt-fbox .nt-orow>input[data-f="unit"],.nt-fbox .nt-orow>input[data-f="options"]{grid-column:2}}
.nt-drugs{display:flex;flex-direction:column;gap:6px;width:100%}
.nt-drug{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.nt-drug input{padding:6px 8px;font-size:14px}
.nt-drug input[data-dname]{flex:1 1 160px;min-width:0}
.nt-drug input[data-dnote]{flex:1 1 120px;min-width:0}
.nt-dsearch{position:relative;width:100%}
.nt-dsearch input{width:100%;box-sizing:border-box;padding:8px 10px;font-size:14px}
.nt-dlist{position:absolute;left:0;right:0;top:100%;z-index:20;background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.14);max-height:300px;overflow:auto;margin-top:2px}
.nt-dopt{display:flex;flex-direction:column;align-items:flex-start;gap:1px;width:100%;text-align:left;border:0;border-bottom:1px solid var(--line);background:#fff;padding:8px 10px;font-size:14px;border-radius:0;cursor:pointer}
.nt-dopt.first{background:#f3f7ff}.nt-dopt:hover{background:#eaf2ff}
.nt-dlink{color:var(--accent);text-decoration:none;font-size:13px}
.nt-lead{flex:1 1 220px;min-width:0;padding:8px 10px;font-size:14px}
.nt-form{display:inline-flex;align-items:center;gap:4px;padding:6px 12px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--text,#111);text-decoration:none;font-size:13px;font-weight:600;white-space:nowrap}.nt-form:hover{border-color:var(--accent)}.nt-forms{display:inline-flex;gap:6px;flex-wrap:wrap}.nt-form.sub{font-weight:400;color:var(--sub,#555)}
.nt-age{margin:0 0 10px}
.nt-notes{grid-column:2/-1;display:flex;flex-direction:column;gap:4px;margin:4px 0 2px}
.nt-notes:empty{display:none}
.nt-note{display:flex;align-items:center;gap:6px;font-size:13px}
.nt-note span{flex:0 0 auto;min-width:72px;color:var(--sub,#555);font-weight:600}
.nt-note input{flex:1 1 auto;min-width:0;padding:6px 8px;font-size:14px}
.nt-caret{margin-top:4px}.nt-caret.on{color:#1e4fa8;background:#eef4ff;border-radius:6px;padding:4px 8px}.nt-caret .link{font-size:12px}
.nt-group{margin-bottom:12px}
.nt-row{display:grid;grid-template-columns:120px minmax(0,1fr);gap:8px;align-items:center;padding:6px 0;border-bottom:1px dashed var(--line)}
@media (max-width:560px){.nt-row{grid-template-columns:1fr;gap:4px}.nt-notes{grid-column:1/-1}}
.nt-label{font-size:14px;font-weight:600}
.nt-order-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--line)}
.nt-order-row>span{flex:1 1 110px;min-width:0;overflow-wrap:anywhere}
.nt-order-controls{display:flex;gap:6px;align-items:center}
.nt-order-controls select{width:auto;min-height:44px}
.nt-order-controls button{min-width:44px;min-height:44px}
.nt-ctl{display:flex;flex-wrap:wrap;gap:6px}
.nt-chip{border:1px solid var(--line);border-radius:999px;padding:7px 14px;font-size:14px;background:#fff;min-height:36px}
.nt-chip.on{background:#eaf2ff;border-color:#8fb3ee;color:#163f86;font-weight:700}
.nt-num{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--sub)}
.nt-num input{width:78px;font-size:15px;padding:7px 8px}
.nt-num input.nt-calc{background:#f3f6fa;color:var(--text,#111);font-weight:700;border-style:dashed}
#ntOut{width:100%;box-sizing:border-box;font-size:15px;line-height:1.55;resize:vertical}
.nt-orow{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr) auto;gap:6px;margin-bottom:6px}
@media (max-width:560px){.nt-orow{grid-template-columns:1fr auto}.nt-orow input[data-f="text"],.nt-orow input[data-f="unit"]{grid-column:1}}
dialog.wide{max-width:min(860px,calc(100vw - 24px))}
.ar-card{margin-bottom:12px}
.ar-warn{margin-bottom:12px;font-size:13px;line-height:1.55}
.ar-ack{display:flex;gap:8px;align-items:flex-start;margin-top:8px;font-weight:700}
.ar-drop{border:2px dashed #b9c6db;border-radius:12px;padding:22px 12px;text-align:center;color:var(--sub);background:#fafcff}
.ar-drop.over{border-color:var(--accent);background:#eef4ff}
.ar-drop.off{opacity:.55}
.ar-item{border-top:1px solid var(--line);padding:10px 0}
.ar-item:first-child{border-top:0}
.ar-name{font-weight:600;word-break:break-all}
.ar-item progress{width:100%;height:10px;margin-top:6px}
.ar-left.soon{color:var(--danger);font-weight:700}
.ar-quota{height:8px;background:#e8edf5;border-radius:99px;overflow:hidden;margin:8px 0 4px}
.ar-quota i{display:block;height:100%;background:var(--accent)}
.ar-msg{min-height:1em;font-size:13px}
.ar-err{color:var(--danger)}.ar-ok{color:#1e6b3a}
.ar-prog{font-size:12px;margin-top:4px}
.lk-bar{margin-bottom:12px;justify-content:space-between}
.lk-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:16px;align-items:start}
@media (max-width:900px){.lk-layout{grid-template-columns:1fr}}
.lk-cat{margin-bottom:10px}.lk-cat-h{font-size:12.5px;font-weight:700;color:var(--sub);margin-bottom:4px}
.lk-chips{display:flex;flex-wrap:wrap;gap:6px}
.lk-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-size:13px;background:#fff;cursor:pointer}
.lk-chip input{margin:0}
.lk-chip.on{background:#eaf2ff;border-color:#8fb3ee;color:#163f86;font-weight:600}
span.lk-chip{cursor:default}
.lk-svc{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:10px;background:#fff}
.lk-svc-h{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;margin-bottom:6px}
.lk-name{font-size:15px}
.lk-score{font-size:12px;font-weight:700;color:#fff;background:var(--accent);border-radius:999px;padding:2px 8px;white-space:nowrap}
.lk-kv{display:grid;grid-template-columns:72px 1fr;gap:6px;font-size:13px;margin-top:4px}
.lk-kv b{color:var(--sub);font-weight:600}
.lk-form{display:inline-flex;align-items:center;gap:4px;margin:0 10px 4px 0}
.lk-pre{margin-bottom:10px}.lk-pre ul{margin:4px 0 0;padding-left:18px}
.lk-list{display:flex;flex-direction:column;gap:6px}
.lk-row{display:grid;grid-template-columns:minmax(160px,1fr) 2fr auto;gap:10px;align-items:center;border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:#fff;cursor:pointer}
.lk-row:hover{background:#fafcff}
@media (max-width:700px){.lk-row{grid-template-columns:1fr}}
.lk-ncat{border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:10px;background:#fff}
.lk-catname{font-weight:700;width:180px}
.lk-items{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.lk-item{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:8px;padding:2px 4px;background:#fafbfd}
.lk-item input{border:0;background:transparent;width:190px;padding:4px}
dialog::backdrop{""")
# 연결 해제 시 연계 목록 상태도 비우기
rep("    VHM_AUTH.signOut(); SERVER._resetCache(); S.events = []; render();", "    VHM_AUTH.signOut(); SERVER._resetCache(); if (window.LINKS) LINKS.reset(); if (window.ARCHIVE) ARCHIVE.reset(); S.events = []; S.doneEvents = []; S.dues = []; S.loadedAt = 0; render();")


# ===== 메모 잠금 =====
memolock = open(H + 'src/memolock.js', encoding='utf-8').read()
rep('<!-- MEMO_IMAGES_UI -->', '<div class="f full" id="memoImages"><span>이미지 첨부</span><div class="row"><button type="button" id="memoImagePick">+ 이미지 선택</button><button type="button" id="memoImageDrive" hidden>Drive 연결 (작성 내용 초기화)</button><input type="file" id="memoImageInput" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden></div><span class="hint" id="memoImageHint">파일당 5MB · 최대 3개 · 일정 저장 시 암호화하여 개인 Drive에 저장합니다.</span><div id="memoImageList" aria-live="polite"></div></div>')
rep('<button id="btnNew" class="primary">+ 새 일정</button>',
    '<button id="btnNew" class="primary">+ 새 일정</button>\n      <button id="btnLock" title="잠긴 메모 열기·잠그기">🔒 메모 잠김</button>')
rep('.toolbar{display:flex;', '.toolbar button{white-space:nowrap}.toolbar .nav{flex-wrap:wrap}\n.toolbar{display:flex;')
rep('<label class="f full">메모 <span class="hint">(구글 캘린더 화면에는 보이지 않는 숨은 정보로 저장)</span><textarea name="memo" maxlength="500"',
    '<div class="f full"><span>메모 <span class="hint">(잠금 암호로 잠가서 저장 — 구글·Claude도 읽을 수 없음, 200자까지 · Enter는 줄바꿈, <b>Ctrl+Enter</b>(맥은 ⌘+Enter)는 저장)</span> <button type="button" class="link" id="memoUnlock" hidden>🔓 잠금 풀기</button></span><textarea name="memo" maxlength="200"')
rep('placeholder="본인 확인용 짧은 메모 (상담 내용은 기관 전산시스템에)"></textarea></label>', 'placeholder="본인 확인용 짧은 메모 (상담 내용은 기관 전산시스템에)"></textarea></div>')
rep("syncPersonHint(); $('#eventDlg').showModal();", "syncPersonHint(); if (window.MEMOLOCK) MEMOLOCK.syncMemo(ev ? d : null); if (window.MEMO_IMAGES) MEMO_IMAGES.open(d); $('#eventDlg').showModal();")
rep("  if (S.editing) { e.id = S.editing.id; e.updated = S.editing.updated; e.uid = S.editing.uid; e.dueId = S.editing.dueId || ''; e.movedFrom = S.editing.movedFrom || ''; }",
    "  if (S.editing) { e.id = S.editing.id; e.updated = S.editing.updated; e.uid = S.editing.uid; e.dueId = S.editing.dueId || ''; e.movedFrom = S.editing.movedFrom || ''; }\n  if (f.memo.dataset.cipher === '1' && S.editing) { e.memo = ''; e.memoCipher = S.editing.memoCipher; }")
rep("if (!e.title && !e.memo && !(e.imageIds && e.imageIds.length) && !(window.MEMO_IMAGES && MEMO_IMAGES.hasPending())) { alert('제목이나 메모 또는 이미지를 입력하세요.'); return null; }", "if (!e.title && !e.memo && !e.memoCipher && !(e.imageIds && e.imageIds.length) && !(window.MEMO_IMAGES && MEMO_IMAGES.hasPending())) { alert('제목이나 메모 또는 이미지를 입력하세요.'); return null; }")
rep("  const e = readForm(); if (!e) return;", "  const e = readForm(); if (!e) return;\n  if (window.MEMOLOCK && !(await MEMOLOCK.beforeSave(e))) return;")
rep("${e.memo ? `<div class=\"memo\">${esc(e.memo)}</div>` : ''}", "${e.memo ? `<div class=\"memo\">${esc(e.memo)}</div>` : ''}${e.memoLock === 'locked' || e.memoLock === 'bad' ? '<div class=\"memo\">🔒 잠긴 메모</div>' : ''}${e.imageIds && e.imageIds.length ? '<div class=\"memo\">📎 이미지 ' + e.imageIds.length + '개</div>' : ''}")
rep('    <h3 style="margin:18px 0 8px">백업</h3>', '    <h3 style="margin:18px 0 8px">메모 잠금</h3>\n    <div class="infobox" id="lockSet"></div>\n    <h3 style="margin:18px 0 8px">백업</h3>')
rep('<!-- 선택 상자 -->', """<!-- 메모 잠금 -->
<dialog id="lockDlg">
  <div class="dlg-head"><h3 id="lockTitle">메모 잠금</h3></div>
  <div class="dlg-body" id="lockBody"></div>
  <div class="dlg-foot"><div class="right"><button type="button" id="lockCancel">취소</button><button type="button" class="primary" id="lockOk">열기</button></div></div>
</dialog>

<!-- 선택 상자 -->""")
rep('dialog::backdrop{', '#btnLock.lk-open{background:#eaf7ee;border-color:#9fd0ad}\ndialog::backdrop{')
rep("  bind(); render();\n  $('#btnConnect')", "  bind(); if (window.MEMOLOCK) MEMOLOCK.bind(); if (window.KEEP) KEEP.bindSettings(); render();\n  $('#btnConnect')")
rep("  S.settings = b.settings; renderSettings(b); render(); await loadEvents();\n}", "  S.settings = b.settings; renderSettings(b); render(); await loadEvents();\n  if (window.MEMOLOCK) await MEMOLOCK.refresh();\n  if (window.KEEP) await KEEP.resume();\n}")
rep("    if (e && e.authNeeded) {", "    if (e && e.lockNeeded) { toast(e.message, 5000); }\n    else if (e && e.authNeeded) {")

# 연결 모듈을 앞에 삽입
marker = "<script>\n'use strict';"
assert s.count(marker) == 1
s = s.replace(marker, '<script src="config.js"></script>\n<script>\n' + api + '\n</script>\n<script>\n' + memolock + '\n</script>\n<script>\n' + open(H + 'src/keepalive.js', encoding='utf-8').read() + '\n</script>\n' + marker)

# 최종 시각 테마는 별도 소스 파일에 두고 가장 마지막 스타일로 삽입합니다.
# index.html을 직접 수정하면 재빌드 시 덮어써집니다.
visual_theme = open(H + 'ui-source/theme-v2.css', encoding='utf-8').read()
s = s.replace('</head>', '<style>\n' + visual_theme + '\n</style>\n</head>', 1)

# 남은 Apps Script 흔적 점검
rep('    <h3 style="margin:4px 0 10px">구글 캘린더 연결 상태</h3>', '    <div id="featureSettings" class="feature-settings"></div>\n    <h3 style="margin:4px 0 10px">구글 계정 연결</h3>\n    <p class="hint">일정 기능을 꺼도 여기서 Google 계정을 연결할 수 있습니다.</p>\n    <button type="button" id="featuresConnect">구글 계정으로 연결</button>')
rep('  S.settings = b.settings; renderSettings(b); render(); await loadEvents();', '  S.settings = b.settings; renderSettings(b); render(); if (window.FEATURES) FEATURES.setAccount(b.email); await loadEvents();')
rep('    <button role="tab" data-tab="set"', '    <button role="tab" data-tab="feedback" aria-selected="false">피드백</button>\n    <button role="tab" data-tab="feedback-admin" aria-selected="false" hidden>피드백 관리</button>\n    <button role="tab" data-tab="set"')
rep('<section id="tab-set"', '<section id="tab-feedback" class="page" hidden></section>\n<section id="tab-feedback-admin" class="page" hidden></section>\n<section id="tab-set"')
rep("['cal','note','phis','link','box','edu','arch','set']", "['cal','note','phis','link','box','edu','arch','set','feedback','feedback-admin']")
rep("  if (name === 'link' && window.LINKS)", "  if ((name === 'feedback' || name === 'feedback-admin') && window.FEEDBACK) FEEDBACK.open(name === 'feedback-admin');\n  if (name === 'link' && window.LINKS)")
s = s.replace('</body>', '<script>\n' + open(H + 'src/feedback-images.js', encoding='utf-8').read() + '\n</script>\n<script>\n' + open(H + 'src/feedback.js', encoding='utf-8').read() + '\n</script>\n</body>', 1)
notes = open(H + 'src/drugs.js', encoding='utf-8').read() + '\n' + open(H + 'src/supps.js', encoding='utf-8').read() + '\n' + open(H + 'src/notes.js', encoding='utf-8').read()
s = s.replace('</script>\n</body>', '</script>\n<script>\n' + links + '\n</script>\n<script>\n' + notes + '\n</script>\n<script>\n' + open(H + 'src/archive.js', encoding='utf-8').read() + '\n</script>\n</body>', 1)
s = s.replace('</body>', '<script>\n' + open(H + 'src/drive-account.js', encoding='utf-8').read() + '\n</script>\n</body>', 1)
s = s.replace('</body>', '<script>\n' + open(H + 'src/features.js', encoding='utf-8').read() + '\n</script>\n</body>', 1)
s = s.replace('</body>', '<script>\n' + open(H + 'src/memo-images.js', encoding='utf-8').read() + '\n</script>\n</body>', 1)
s = s.replace('</body>', '<script>\n' + open(H + 'src/consultations.js', encoding='utf-8').read() + '\n</script>\n</body>', 1)
s = s.replace('</body>', '<script>\n' + open(H + 'src/phis-model.js', encoding='utf-8').read() + '\n</script>\n<script>\n' + open(H + 'src/phis.js', encoding='utf-8').read() + '\n</script>\n</body>', 1)
assert 'google.script' not in s, 'google.script 남음'
assert '<?' not in s, '템플릿 태그 남음'
os.makedirs(H + 'site', exist_ok=True)
# Interactive surveys share encrypted consultation persistence.
s = s.replace('</body>', '<script>\n' + open(H + 'src/survey-data.js', encoding='utf-8').read() + '\n' + open(H + 'src/surveys.js', encoding='utf-8').read() + '\n</script>\n</body>', 1)
open(H + 'site/index.html', 'w', encoding='utf-8').write(s)
cfg = H + 'site/config.js'
if not os.path.exists(cfg):
    open(cfg, 'w', encoding='utf-8').write(
        "// 설치 안내에서 받은 '클라이언트 ID'를 아래 따옴표 안에 붙여넣으세요.\n"
        "// 비밀번호나 비밀 키가 아니며, 공개되어도 괜찮은 값입니다.\n"
        "window.VHM_CONFIG = { clientId: '' };\n")
# Root and site/ are both supported static deployment locations.
import shutil
shutil.copytree(H + 'education', H + 'site/education', dirs_exist_ok=True)
shutil.copytree(H + 'forms', H + 'site/forms', dirs_exist_ok=True)
shutil.copytree(H + 'assets', H + 'site/assets', dirs_exist_ok=True)
print('ok', len(s))
