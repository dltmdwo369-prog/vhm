/* =====================================================================
 * 연계 안내: 대상자 요구 체크 → 알맞은 연계서비스·양식 안내
 * - 요구 체크 내용은 저장하지 않음 (화면에서 계산만)
 * - 서비스 목록·요구 항목·양식 파일은 본인 구글 드라이브 '방문건강관리 연계자료' 폴더
 * ===================================================================== */
(function () {
  'use strict';
  const FIELDS = ['보건의료', '복지', '돌봄', '주거·안전', '정신건강', '경제', '기타'];
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  // 기본 요구 항목 (임시 — 사용자가 확인 후 직접 고침)
  function defaultCategories() {
    const C = (name, items) => ({ id: uid(), name, items: items.map(label => ({ id: uid(), label })) });
    return [
      C('건강·질환', ['고혈압·당뇨 등 만성질환 관리', '암 치료·관리', '관절·척추 통증', '구강 문제', '시력·청력 문제', '약 복용 관리 어려움']),
      C('인지·정신', ['인지 저하·치매 의심', '우울감·정서 지원 필요', '음주 문제']),
      C('영양·식생활', ['영양 불량·식사량 감소', '식사 준비 어려움']),
      C('신체기능·돌봄', ['거동 불편·보행 보조 필요', '일상생활 도움 필요', '장기요양 필요', '재활·운동 필요', '낙상 위험']),
      C('의료 이용', ['병원 동행 필요', '의료비 부담', '방문 진료·간호 필요', '보조기기 필요']),
      C('경제', ['생계 곤란', '긴급 지원 필요']),
      C('주거·안전', ['주거환경 불량(위생·수리)', '냉난방 어려움', '안전 설비 필요']),
      C('사회관계', ['독거', '사회적 고립', '보호자 부재·돌봄 부담'])
    ];
  }
  function emptyData() { return { schema: 1, updatedAt: null, defaultsPending: true, categories: defaultCategories(), services: [] }; }
  function normalize(d) {
    const out = emptyData(); if (!d || typeof d !== 'object') return out;
    out.defaultsPending = !!d.defaultsPending;
    out.updatedAt = d.updatedAt || null;
    if (Array.isArray(d.categories)) out.categories = d.categories.map(c => ({ id: c.id || uid(), name: String(c.name || '분류'), items: (c.items || []).map(i => ({ id: i.id || uid(), label: String(i.label || '') })).filter(i => i.label) }));
    out.services = (Array.isArray(d.services) ? d.services : []).map(s => ({
      id: s.id || uid(), name: String(s.name || '').slice(0, 80), org: String(s.org || '').slice(0, 80), field: FIELDS.includes(s.field) ? s.field : '기타',
      needs: Array.isArray(s.needs) ? s.needs.map(String) : [], conditions: String(s.conditions || ''), contact: String(s.contact || ''),
      apply: String(s.apply || ''), docs: String(s.docs || ''), memo: String(s.memo || ''),
      forms: (Array.isArray(s.forms) ? s.forms : []).filter(f => f && (f.fileId || f.url)).map(f => f.fileId ? { type: 'file', fileId: f.fileId, name: f.name || '양식', mime: f.mime || '', link: f.link || '' } : { type: 'link', url: String(f.url), name: f.name || '링크' })
    })).filter(s => s.name);
    return out;
  }

  const L = { data: null, modified: null, loaded: false, checks: new Set(), view: 'match', q: '', editing: null, pendingForms: [] };
  const box = () => $('#tab-link');
  const itemById = () => { const m = {}; L.data.categories.forEach(c => c.items.forEach(i => { m[i.id] = Object.assign({ cat: c.name }, i); })); return m; };

  async function load() {
    box().innerHTML = '<div class="empty">구글 드라이브에서 연계 목록을 불러오는 중…</div>';
    try {
      const r = await run('연계 목록 불러오는 중…', () => call('linksLoad'));
      L.data = normalize(r.data); L.modified = r.modifiedTime; L.loaded = true;
      if (!r.data) { await save('처음 사용: 기본 항목으로 목록을 만들었습니다.'); }
      render();
    } catch (e) {
      L.loaded = false;
      box().innerHTML = e.authNeeded
        ? '<div class="empty">먼저 일정 탭에서 ‘구글 계정으로 연결’을 눌러 주세요.</div>'
        : e.noDrive
        ? '<div class="card"><div class="card-body"><h3 style="margin:0 0 6px">구글 드라이브 연결</h3><p class="hint">연계 목록과 양식 파일은 본인 구글 드라이브의 ‘방문건강관리 연계자료’ 폴더에 저장됩니다. <b>이 앱이 만든 파일에만</b> 접근하는 권한이며, 일정 연결과는 따로 승인합니다.</p><button class="primary" id="lkDrive">구글 드라이브 연결</button><p class="hint" style="margin-top:10px">권한 화면에서 드라이브 항목에 체크하고 계속을 누르세요. 처음이면 Google Cloud 에서 ‘Google Drive API’를 ‘사용’으로 해 두어야 합니다. 이 기기에서 연결이 안 되면 다른 기기(휴대폰·맥북)에서 써 보세요 — 일정 기능은 그대로 쓸 수 있습니다.</p></div></div>'
        : '<div class="empty">연계 목록을 불러오지 못했습니다: ' + esc(e.message || e) + ' <button class="small" id="lkRetry">다시 시도</button></div>';
    }
  }
  async function save(msg) {
    L.data.updatedAt = new Date().toISOString();
    let r = await run('드라이브에 저장 중…', () => call('linksSave', L.data, L.modified, false));
    if (r.conflict) {
      const pick = await choose('다른 기기에서 먼저 바뀌었습니다', '<p>이 목록을 연 뒤 다른 기기(휴대폰 등)에서 연계 목록이 수정되었습니다.</p><p class="hint"><b>다시 불러오기</b>: 방금 바꾼 내용은 버리고 최신 목록을 엽니다.<br><b>내 내용으로 덮어쓰기</b>: 다른 기기에서 바꾼 내용이 사라집니다.</p>',
        [{ label: '다시 불러오기', value: 'reload' }, { label: '내 내용으로 덮어쓰기', value: 'mine', cls: 'danger' }]);
      if (pick === 'mine') r = await run('드라이브에 저장 중…', () => call('linksSave', L.data, L.modified, true));
      else { await load(); return false; }
    }
    L.modified = r.modifiedTime; if (msg) toast(msg); return true;
  }

  /* ---------- 화면 ---------- */
  function render() {
    if (!L.loaded) return;
    const tabs = [['match', '요구 체크 → 추천'], ['list', '서비스 목록 (' + L.data.services.length + ')'], ['needs', '요구 항목'], ['io', '가져오기·백업']];
    let html = '<div class="lk-bar row"><div class="seg" role="tablist">' + tabs.map(t => '<button data-lkview="' + t[0] + '" aria-pressed="' + (L.view === t[0]) + '">' + t[1] + '</button>').join('') + '</div>'
      + '<span class="hint">구글 드라이브 ‘방문건강관리 연계자료’ 폴더에 저장 · ' + (L.data.updatedAt ? '최근 저장 ' + new Date(L.data.updatedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '') + '</span>'
      + '<button class="small" id="lkReload">새로고침</button></div>';
    if (L.data.defaultsPending) html += '<div class="warnbox" style="margin-bottom:10px">요구 항목은 아직 <b>임시 기본값</b>입니다. ‘요구 항목’ 탭에서 확인하고 고친 뒤 ‘확인 완료’를 눌러 주세요.</div>';
    html += L.view === 'match' ? matchHtml() : L.view === 'list' ? listHtml() : L.view === 'needs' ? needsHtml() : ioHtml();
    box().innerHTML = html;
  }

  function scored() {
    const checks = L.checks;
    return L.data.services.map(s => ({ s, hit: s.needs.filter(n => checks.has(n)) })).filter(x => x.hit.length)
      .sort((a, b) => b.hit.length - a.hit.length || a.s.name.localeCompare(b.s.name, 'ko'));
  }
  function formButtons(s) {
    if (!s.forms.length) return '<span class="hint">등록된 양식 없음</span>';
    return s.forms.map((f, i) => f.type === 'file'
      ? '<span class="lk-form">📄 ' + esc(f.name) + ' <button class="small" data-dl="' + esc(s.id) + ':' + i + '">내려받기</button>' + (f.link ? ' <a class="small" href="' + esc(f.link) + '" target="_blank" rel="noopener">드라이브에서 열기</a>' : '') + '</span>'
      : '<span class="lk-form">🔗 <a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.name) + '</a></span>').join('');
  }
  function serviceCard(s, hit, map) {
    const row = (k, v) => v ? '<div class="lk-kv"><b>' + k + '</b><span>' + esc(v).replace(/\n/g, '<br>') + '</span></div>' : '';
    return '<div class="lk-svc"><div class="lk-svc-h"><div><b class="lk-name">' + esc(s.name) + '</b> <span class="badge">' + esc(s.field) + '</span>' + (s.org ? '<div class="hint">' + esc(s.org) + '</div>' : '') + '</div>'
      + (hit ? '<span class="lk-score">' + hit.length + '개 해당</span>' : '') + '</div>'
      + (hit ? '<div class="lk-chips">' + hit.map(n => '<span class="lk-chip on">' + esc((map[n] || {}).label || '') + '</span>').join('') + '</div>' : '')
      + row('대상 조건', s.conditions) + row('연락처', s.contact) + row('신청 방법', s.apply) + row('필요 서류', s.docs) + row('메모', s.memo)
      + '<div class="lk-kv"><b>양식</b><span>' + formButtons(s) + '</span></div>'
      + (hit ? '<div class="row" style="margin-top:6px"><button class="small" data-sched="' + esc(s.id) + '">연계 일정 등록</button></div>' : '')
      + '</div>';
  }
  function matchHtml() {
    const map = itemById(), res = scored();
    const cats = L.data.categories.map(c => '<div class="lk-cat"><div class="lk-cat-h">' + esc(c.name) + '</div><div class="lk-chips">'
      + c.items.map(i => '<label class="lk-chip' + (L.checks.has(i.id) ? ' on' : '') + '"><input type="checkbox" data-need="' + esc(i.id) + '"' + (L.checks.has(i.id) ? ' checked' : '') + '> ' + esc(i.label) + '</label>').join('') + '</div></div>').join('');
    return '<div class="lk-layout"><section class="card"><div class="card-head"><h3>대상자 요구 체크</h3><button class="small" id="lkClear">체크 초기화</button></div>'
      + '<div class="card-body"><p class="hint" style="margin-top:0">체크한 내용은 <b>저장되지 않고</b> 화면을 닫거나 초기화하면 사라집니다. 대상자 이름은 입력하지 않습니다.</p>' + cats + '</div></section>'
      + '<section class="card"><div class="card-head"><h3>알맞은 연계서비스 ' + (L.checks.size ? res.length + '건' : '') + '</h3></div><div class="card-body">'
      + (L.checks.size ? '<div class="infobox lk-pre"><b>연계 전 확인</b><ul><li>대상 조건(연령·소득·등급 등)을 실제로 충족하는지 확인</li><li>다른 기관에 대상자 정보를 넘길 때는 <b>개인정보 제3자 제공 동의</b>를 받았는지 확인</li><li>연계 내용은 기관 전산시스템에 기록</li></ul></div>' : '')
      + (!L.checks.size ? '<div class="empty">왼쪽에서 대상자의 요구를 체크하면 알맞은 서비스가 많이 해당하는 순서로 나옵니다.</div>'
        : res.length ? res.map(x => serviceCard(x.s, x.hit, map)).join('') : '<div class="empty">체크한 요구에 해당하는 서비스가 목록에 없습니다. ‘서비스 목록’에서 서비스의 ‘해당하는 요구’를 지정해 주세요.</div>')
      + '</div></section></div>';
  }
  function listHtml() {
    const q = L.q.toLowerCase(), map = itemById();
    const list = L.data.services.filter(s => !q || [s.name, s.org, s.field, s.conditions, s.memo].join(' ').toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return '<div class="row" style="margin-bottom:10px"><button class="primary" id="lkAdd">+ 서비스 추가</button><input type="search" id="lkQ" placeholder="서비스명·기관·조건 검색" value="' + esc(L.q) + '" style="flex:1;min-width:180px"></div>'
      + (list.length ? '<div class="lk-list">' + list.map(s => '<div class="lk-row" data-edit="' + esc(s.id) + '" role="button" tabindex="0"><div><b>' + esc(s.name) + '</b> <span class="badge">' + esc(s.field) + '</span><div class="hint">' + esc(s.org) + '</div></div>'
        + '<div class="lk-chips">' + s.needs.slice(0, 6).map(n => map[n] ? '<span class="lk-chip">' + esc(map[n].label) + '</span>' : '').join('') + (s.needs.length > 6 ? '<span class="hint">+' + (s.needs.length - 6) + '</span>' : '') + (s.needs.length ? '' : '<span class="hint" style="color:var(--warn)">해당 요구 미지정 — 추천에 나오지 않음</span>') + '</div>'
        + '<span class="hint">' + (s.forms.length ? '양식 ' + s.forms.length : '') + '</span></div>').join('') + '</div>'
        : '<div class="empty">' + (L.data.services.length ? '검색 결과가 없습니다.' : '아직 등록된 서비스가 없습니다. ‘+ 서비스 추가’ 또는 ‘가져오기·백업’ 탭에서 엑셀 내용을 붙여넣어 주세요.') + '</div>');
  }
  function needsHtml() {
    return '<div class="card"><div class="card-body">'
      + '<p class="hint" style="margin-top:0">방문 현장에서 체크할 항목입니다. 이름을 고치거나 지우고 새로 추가할 수 있습니다. 항목을 지우면 서비스에 지정된 것도 함께 빠집니다.</p>'
      + L.data.categories.map((c, ci) => '<div class="lk-ncat"><div class="row"><input class="lk-catname" data-ci="' + ci + '" value="' + esc(c.name) + '" aria-label="분류 이름"><button class="small" data-additem="' + ci + '">+ 항목</button><button class="small danger" data-delcat="' + ci + '">분류 삭제</button></div>'
        + '<div class="lk-items">' + c.items.map((it, ii) => '<span class="lk-item"><input data-ci="' + ci + '" data-ii="' + ii + '" class="lk-itemname" value="' + esc(it.label) + '" aria-label="항목 이름"><button class="small link" data-delitem="' + ci + ':' + ii + '" title="삭제">✕</button></span>').join('') + '</div></div>').join('')
      + '<div class="row" style="margin-top:12px"><button id="lkAddCat">+ 분류 추가</button><button class="primary" id="lkSaveNeeds">저장</button>'
      + (L.data.defaultsPending ? '<button id="lkConfirmDefaults">확인 완료 (임시 표시 없애기)</button>' : '') + '</div></div></div>';
  }
  function ioHtml() {
    return '<div class="card"><div class="card-head"><h3>엑셀에서 붙여넣어 서비스 가져오기</h3></div><div class="card-body">'
      + '<ol class="hint" style="margin-top:0"><li>엑셀에서 아래 열 순서로 표를 만들고, 제목 줄까지 포함해 복사합니다. <button class="small" id="lkTpl">제목 줄 복사</button></li>'
      + '<li>아래 칸에 붙여넣고 ‘미리 보기’ → ‘가져오기’를 누릅니다.</li></ol>'
      + '<p class="hint"><code>서비스명 · 기관 · 분야 · 해당 요구 · 대상 조건 · 연락처 · 신청 방법 · 필요 서류 · 양식 링크 · 메모</code><br>‘해당 요구’는 쉼표로 구분합니다(예: 독거, 사회적 고립). 요구 항목에 없는 이름은 ‘기타’ 분류에 새 항목으로 추가됩니다. ‘분야’는 ' + FIELDS.join('·') + ' 중 하나입니다.</p>'
      + '<div class="warnbox" style="margin:8px 0">대상자 이름·연락처 등 개인정보가 섞여 있지 않은지 확인한 뒤 붙여넣으세요. 서비스 목록에는 기관 정보만 넣습니다.</div>'
      + '<textarea id="lkPaste" rows="7" style="width:100%" placeholder="엑셀에서 복사한 내용을 붙여넣으세요"></textarea>'
      + '<div class="row" style="margin-top:8px"><button id="lkPreview">미리 보기</button><button class="primary" id="lkImport" disabled>가져오기</button><span class="hint" id="lkPrevMsg"></span></div><div id="lkPrev"></div></div></div>'
      + '<div class="card"><div class="card-head"><h3>백업</h3></div><div class="card-body"><div class="row"><button id="lkExport">연계 목록 백업 파일 내려받기</button><button id="lkRestore">백업 파일로 바꾸기…</button><input type="file" id="lkFile" accept=".json" hidden></div>'
      + '<p class="hint">양식 파일 자체는 드라이브 폴더에 그대로 있고, 백업 파일에는 목록과 파일 연결 정보만 들어갑니다.</p></div></div>';
  }

  /* ---------- 가져오기 ---------- */
  const TPL = ['서비스명', '기관', '분야', '해당 요구', '대상 조건', '연락처', '신청 방법', '필요 서류', '양식 링크', '메모'];
  function parseTsv(text) {   // 엑셀 붙여넣기: 탭 구분, 따옴표 안 줄바꿈 지원
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
      if (ch === '"' && cell === '') { q = true; continue; }
      if (ch === '\t') { row.push(cell); cell = ''; continue; }
      if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; continue; }
      cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim()));
  }
  let PREVIEW = null;
  function preview() {
    const rows = parseTsv($('#lkPaste').value || '');
    if (!rows.length) { $('#lkPrevMsg').textContent = '붙여넣은 내용이 없습니다.'; return; }
    let start = 0, col = {};
    const head = rows[0].map(h => h.trim());
    if (head.includes('서비스명')) { start = 1; TPL.forEach(t => { const i = head.indexOf(t); if (i >= 0) col[t] = i; }); }
    else TPL.forEach((t, i) => col[t] = i);
    const get = (r, k) => col[k] == null ? '' : String(r[col[k]] || '').trim();
    const labelMap = {}; L.data.categories.forEach(c => c.items.forEach(i => { labelMap[i.label.replace(/\s/g, '')] = i.id; }));
    const existing = new Set(L.data.services.map(s => (s.name + '|' + s.org).replace(/\s/g, '')));
    const items = [], newNeeds = new Set(); let dup = 0;
    rows.slice(start).forEach(r => {
      const name = get(r, '서비스명'); if (!name) return;
      const key = (name + '|' + get(r, '기관')).replace(/\s/g, ''); if (existing.has(key)) { dup++; return; }
      const needs = get(r, '해당 요구').split(/[,，、;\/]/).map(x => x.trim()).filter(Boolean);
      needs.forEach(n => { if (!labelMap[n.replace(/\s/g, '')]) newNeeds.add(n); });
      const link = get(r, '양식 링크');
      items.push({ name, org: get(r, '기관'), field: FIELDS.includes(get(r, '분야')) ? get(r, '분야') : '기타', needLabels: needs, conditions: get(r, '대상 조건'), contact: get(r, '연락처'), apply: get(r, '신청 방법'), docs: get(r, '필요 서류'), memo: get(r, '메모'),
        forms: /^https?:\/\//i.test(link) ? [{ type: 'link', url: link, name: '신청·양식 페이지' }] : [] });
    });
    PREVIEW = { items, newNeeds: Array.from(newNeeds) };
    $('#lkPrevMsg').textContent = '새 서비스 ' + items.length + '건' + (dup ? ' · 이미 있는 ' + dup + '건 제외' : '') + (newNeeds.size ? ' · 새 요구 항목 ' + newNeeds.size + '개' : '');
    $('#lkPrev').innerHTML = items.length ? '<table class="files" style="margin-top:8px"><thead><tr><th>서비스명</th><th>기관</th><th>분야</th><th>해당 요구</th></tr></thead><tbody>' + items.slice(0, 30).map(i => '<tr><td>' + esc(i.name) + '</td><td>' + esc(i.org) + '</td><td>' + esc(i.field) + '</td><td>' + esc(i.needLabels.join(', ')) + '</td></tr>').join('') + '</tbody></table>' + (items.length > 30 ? '<p class="hint">… 외 ' + (items.length - 30) + '건</p>' : '') : '';
    $('#lkImport').disabled = !items.length;
  }
  async function doImport() {
    if (!PREVIEW || !PREVIEW.items.length) return;
    const labelMap = {}; L.data.categories.forEach(c => c.items.forEach(i => { labelMap[i.label.replace(/\s/g, '')] = i.id; }));
    if (PREVIEW.newNeeds.length) {
      let etc = L.data.categories.find(c => c.name === '기타'); if (!etc) { etc = { id: uid(), name: '기타', items: [] }; L.data.categories.push(etc); }
      PREVIEW.newNeeds.forEach(n => { const it = { id: uid(), label: n }; etc.items.push(it); labelMap[n.replace(/\s/g, '')] = it.id; });
    }
    PREVIEW.items.forEach(i => L.data.services.push({ id: uid(), name: i.name, org: i.org, field: i.field, needs: i.needLabels.map(n => labelMap[n.replace(/\s/g, '')]).filter(Boolean), conditions: i.conditions, contact: i.contact, apply: i.apply, docs: i.docs, memo: i.memo, forms: i.forms }));
    const n = PREVIEW.items.length; PREVIEW = null;
    if (await save('서비스 ' + n + '건을 가져왔습니다.')) { L.view = 'list'; render(); }
  }

  /* ---------- 서비스 편집 ---------- */
  function openSvc(s) {
    L.editing = s ? JSON.parse(JSON.stringify(s)) : { id: '', name: '', org: '', field: '복지', needs: [], conditions: '', contact: '', apply: '', docs: '', memo: '', forms: [] };
    L.pendingForms = [];
    const e = L.editing, f = $('#svcForm');
    $('#svcTitle').textContent = s ? '서비스 수정' : '서비스 추가';
    f.innerHTML = '<div class="form-grid">'
      + '<label class="f">서비스명<input name="name" maxlength="80" required value="' + esc(e.name) + '"></label>'
      + '<label class="f">기관<input name="org" maxlength="80" value="' + esc(e.org) + '"></label>'
      + '<label class="f">분야<select name="field">' + FIELDS.map(x => '<option' + (x === e.field ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></label><div></div>'
      + '<div class="full"><div class="hint" style="margin-bottom:4px">해당하는 요구 (추천에 쓰임)</div>' + L.data.categories.map(c => '<div class="lk-cat"><div class="lk-cat-h">' + esc(c.name) + '</div><div class="lk-chips">'
        + c.items.map(i => '<label class="lk-chip' + (e.needs.includes(i.id) ? ' on' : '') + '"><input type="checkbox" name="needs" value="' + esc(i.id) + '"' + (e.needs.includes(i.id) ? ' checked' : '') + '> ' + esc(i.label) + '</label>').join('') + '</div></div>').join('') + '</div>'
      + '<label class="f full">대상 조건<textarea name="conditions" rows="2" placeholder="예: 65세 이상, 기초연금 수급자">' + esc(e.conditions) + '</textarea></label>'
      + '<label class="f">연락처<input name="contact" value="' + esc(e.contact) + '" placeholder="기관 대표번호·담당 부서"></label>'
      + '<label class="f">신청 방법<input name="apply" value="' + esc(e.apply) + '" placeholder="예: 주민센터 방문 신청"></label>'
      + '<label class="f full">필요 서류<textarea name="docs" rows="2">' + esc(e.docs) + '</textarea></label>'
      + '<label class="f full">메모<textarea name="memo" rows="2">' + esc(e.memo) + '</textarea></label>'
      + '<div class="full"><div class="hint" style="margin-bottom:4px">양식 (파일은 드라이브에 올라가고, 링크는 신청 페이지 주소)</div><div id="svcForms"></div>'
      + '<div class="row" style="margin-top:6px"><button type="button" class="small" id="svcAddFile">파일 첨부</button><input type="file" id="svcFile" multiple hidden>'
      + '<input id="svcLinkName" placeholder="링크 이름" style="width:130px"><input id="svcLinkUrl" placeholder="https://..." style="flex:1;min-width:140px"><button type="button" class="small" id="svcAddLink">링크 추가</button></div></div>'
      + '<div class="full warnbox">서비스 목록에는 기관 정보만 넣습니다. 대상자 이름·연락처는 넣지 마세요.</div></div>';
    renderForms(); $('#svcDelete').hidden = !s; $('#svcDlg').showModal();
  }
  function renderForms() {
    const e = L.editing;
    $('#svcForms').innerHTML = e.forms.length ? e.forms.map((f, i) => '<div class="lk-form">' + (f.type === 'file' ? '📄 ' : '🔗 ') + esc(f.name) + ' <button type="button" class="small link" data-rmform="' + i + '">빼기</button></div>').join('') : '<span class="hint">없음</span>';
  }
  async function saveSvc() {
    const f = $('#svcForm'), e = L.editing;
    const el = k => f.elements.namedItem(k);
    e.name = el('name').value.trim(); if (!e.name) { alert('서비스명을 입력하세요.'); return; }
    e.org = el('org').value.trim(); e.field = el('field').value; e.needs = $$('input[name=needs]:checked', f).map(x => x.value);
    ['conditions', 'contact', 'apply', 'docs', 'memo'].forEach(k => e[k] = el(k).value.trim());
    const i = L.data.services.findIndex(s => s.id === e.id);
    if (!e.id) { e.id = uid(); L.data.services.push(e); } else L.data.services[i] = e;
    if (await save('저장했습니다.')) { $('#svcDlg').close(); render(); }
  }

  /* ---------- 이벤트 ---------- */
  function bindOnce() {
    const b = box();
    b.addEventListener('click', async ev => {
      const t = ev.target;
      const v = t.closest('[data-lkview]'); if (v) { L.view = v.dataset.lkview; render(); return; }
      if (t.id === 'lkRetry' || t.id === 'lkReload') { load(); return; }
      if (t.id === 'lkDrive') { t.disabled = true; try { await VHM_AUTH.request('drive'); await load(); } catch (e) { toast(e.message || String(e), 5000); t.disabled = false; } return; }
      if (t.id === 'lkClear') { L.checks.clear(); render(); return; }
      if (t.id === 'lkAdd') { openSvc(null); return; }
      const ed = t.closest('[data-edit]'); if (ed) { openSvc(L.data.services.find(s => s.id === ed.dataset.edit)); return; }
      if (t.dataset.dl) { const [sid, i] = t.dataset.dl.split(':'); const s = L.data.services.find(x => x.id === sid); const fm = s && s.forms[+i];
        if (fm) { t.disabled = true; try { await run('내려받는 중…', () => call('downloadForm', fm.fileId, fm.name)); } catch (e) {} t.disabled = false; } return; }
      if (t.dataset.sched) { const s = L.data.services.find(x => x.id === t.dataset.sched);
        showTab('cal'); openEvent(null, { kind: 'work', type: '연계', status: '예정', memo: ('연계: ' + s.name + (s.org ? ' (' + s.org + ')' : '')).slice(0, 500) }); return; }
      // 요구 항목 편집
      if (t.dataset.additem != null) { syncNeedInputs(); L.data.categories[+t.dataset.additem].items.push({ id: uid(), label: '새 항목' }); render(); return; }
      if (t.dataset.delitem) { syncNeedInputs(); const [ci, ii] = t.dataset.delitem.split(':').map(Number); const it = L.data.categories[ci].items[ii];
        const used = L.data.services.filter(s => s.needs.includes(it.id)).length;
        if (used && !confirm('‘' + it.label + '’ 항목이 서비스 ' + used + '곳에 지정되어 있습니다. 지울까요?')) return;
        L.data.categories[ci].items.splice(ii, 1); L.data.services.forEach(s => s.needs = s.needs.filter(n => n !== it.id)); L.checks.delete(it.id); render(); return; }
      if (t.dataset.delcat != null) { syncNeedInputs(); const c = L.data.categories[+t.dataset.delcat];
        if (!confirm('‘' + c.name + '’ 분류와 항목 ' + c.items.length + '개를 지울까요?')) return;
        const ids = new Set(c.items.map(i => i.id)); L.data.categories.splice(+t.dataset.delcat, 1); L.data.services.forEach(s => s.needs = s.needs.filter(n => !ids.has(n))); render(); return; }
      if (t.id === 'lkAddCat') { syncNeedInputs(); L.data.categories.push({ id: uid(), name: '새 분류', items: [] }); render(); return; }
      if (t.id === 'lkSaveNeeds') { syncNeedInputs(); if (await save('요구 항목을 저장했습니다.')) render(); return; }
      if (t.id === 'lkConfirmDefaults') { syncNeedInputs(); L.data.defaultsPending = false; if (await save('요구 항목 확인을 완료했습니다.')) render(); return; }
      // 가져오기·백업
      if (t.id === 'lkTpl') { toast(await copyText(TPL.join('\t')) ? '제목 줄을 복사했습니다. 엑셀 첫 줄에 붙여넣으세요.' : '복사하지 못했습니다.'); return; }
      if (t.id === 'lkPreview') { preview(); return; }
      if (t.id === 'lkImport') { doImport(); return; }
      if (t.id === 'lkExport') { const blob = new Blob([JSON.stringify(L.data, null, 1)], { type: 'application/json' }); const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = '연계목록백업_' + todayStr().replace(/-/g, '') + '.json'; document.body.appendChild(a); a.click(); a.remove(); toast('백업 파일을 내려받았습니다.'); return; }
      if (t.id === 'lkRestore') { $('#lkFile').click(); return; }
    });
    b.addEventListener('change', async ev => {
      const t = ev.target;
      if (t.dataset.need) { if (t.checked) L.checks.add(t.dataset.need); else L.checks.delete(t.dataset.need); render(); return; }
      if (t.id === 'lkFile') { const file = t.files[0]; t.value = ''; if (!file) return;
        let d; try { d = JSON.parse(await file.text()); } catch (e) { alert('백업 파일을 읽지 못했습니다.'); return; }
        if (!d || !Array.isArray(d.services) || !Array.isArray(d.categories)) { alert('연계 목록 백업 파일이 아닙니다.'); return; }
        if (!confirm('지금 목록(서비스 ' + L.data.services.length + '건)을 백업 파일 내용(서비스 ' + d.services.length + '건)으로 바꿀까요?')) return;
        L.data = normalize(d); if (await save('백업 파일로 바꿨습니다.')) render(); }
    });
    b.addEventListener('input', ev => { if (ev.target.id === 'lkQ') { L.q = ev.target.value; const pos = ev.target.selectionStart; render(); const q = $('#lkQ'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } } });
    b.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.dataset && ev.target.dataset.edit) ev.target.click(); });
    // 서비스 대화상자
    $('#svcDlg').addEventListener('click', async ev => {
      const t = ev.target;
      if (t.id === 'svcAddFile') { $('#svcFile').click(); return; }
      if (t.id === 'svcAddLink') { const url = $('#svcLinkUrl').value.trim(), name = $('#svcLinkName').value.trim() || '링크';
        if (!/^https?:\/\//i.test(url)) { alert('https:// 로 시작하는 주소를 넣어 주세요.'); return; }
        L.editing.forms.push({ type: 'link', url, name }); $('#svcLinkUrl').value = ''; $('#svcLinkName').value = ''; renderForms(); return; }
      if (t.dataset.rmform != null) { const fm = L.editing.forms[+t.dataset.rmform];
        if (fm.type === 'file' && confirm('‘' + fm.name + '’ 파일을 드라이브 휴지통으로도 보낼까요? (취소를 누르면 목록에서만 뺍니다)')) { try { await run('삭제 중…', () => call('trashForm', fm.fileId)); } catch (e) {} }
        L.editing.forms.splice(+t.dataset.rmform, 1); renderForms(); return; }
      if (t.id === 'svcSave') { saveSvc(); return; }
      if (t.id === 'svcDelete') { if (!confirm('‘' + L.editing.name + '’ 서비스를 목록에서 지울까요? (첨부 양식 파일은 드라이브에 남습니다)')) return;
        L.data.services = L.data.services.filter(s => s.id !== L.editing.id); if (await save('지웠습니다.')) { $('#svcDlg').close(); render(); } return; }
      if (t.dataset.close != null) { $('#svcDlg').close(); }
    });
    $('#svcDlg').addEventListener('change', async ev => {
      const t = ev.target;
      if (t.id === 'svcFile') { const files = Array.from(t.files); t.value = '';
        for (const file of files) { try { const fm = await run('올리는 중… ' + file.name, () => call('uploadForm', file)); L.editing.forms.push(fm); renderForms(); } catch (e) {} } return; }
      if (t.name === 'needs') t.closest('.lk-chip').classList.toggle('on', t.checked);
    });
  }
  function syncNeedInputs() {
    $$('.lk-catname', box()).forEach(i => { const c = L.data.categories[+i.dataset.ci]; if (c) c.name = i.value.trim() || c.name; });
    $$('.lk-itemname', box()).forEach(i => { const c = L.data.categories[+i.dataset.ci]; const it = c && c.items[+i.dataset.ii]; if (it) it.label = i.value.trim() || it.label; });
  }

  let bound = false;
  window.LINKS = {
    open() { if (!bound) { bindOnce(); bound = true; } if (L.loaded) render(); else load(); },
    reset() { L.data = null; L.loaded = false; L.checks.clear(); },
    _state: L
  };
})();
