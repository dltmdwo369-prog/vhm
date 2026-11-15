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
  const M = window.VHM_REFERRALS, CATALOG = window.VHM_PUBLIC_REFERRALS;
  const PUBLIC = CATALOG.services.map(M.service);
  function emptyData() { return {schema:2, updatedAt:null, defaultsPending:true, categories:defaultCategories(), services:[], catalogReviews:{}}; }
  function normalize(d) { return M.migrate(d, emptyData()); }

  const L = { data: null, modified: null, loaded: false, checks: new Set(), view: 'match', q: '', editing: null, pendingForms: [], personalLoaded:false, loading:false, busy:false, epoch:0, notice:'', filters:{field:'',group:'',route:'',intake:'',source:''}, selected:new Set(), importSnapshot:null, reviewId:null, listLimit:12, needOpen:new Set(['cost','oral']) };
  const box = () => $('#tab-link');
  const itemById = () => { const m = {}; L.data.categories.forEach(c => c.items.forEach(i => { m[i.id] = Object.assign({ cat: c.name }, i); })); return m; };

  async function load() {
    if (L.loading) return;
    const epoch = L.epoch; L.loading = true;
    try {
      const r = await run('개인 연계 목록 불러오는 중…', () => call('linksLoad'));
      if (epoch !== L.epoch) return;
      L.data = normalize(r.data); L.modified = r.modifiedTime; L.personalLoaded = true; L.notice = '';
    } catch (e) {
      if (epoch !== L.epoch) return;
      L.personalLoaded = false;
      L.notice = e.authNeeded ? '개인 목록은 일정 탭의 구글 연결 후 불러올 수 있습니다.' : e.noDrive ? '개인 목록을 보려면 드라이브 연결이 필요합니다.' : '개인 목록 불러오기 실패: ' + (e.message || e);
    } finally { if (epoch === L.epoch) { L.loading = false; render(); } }
  }

  async function save(msg) {
    if (!L.personalLoaded) { alert('먼저 개인 목록을 불러오세요. 공개자료는 연결 없이 볼 수 있습니다.'); return false; }
    L.data.updatedAt = new Date().toISOString();
    let r = await run('드라이브에 저장 중…', () => call('linksSave', L.data, L.modified, false));
    if (r.conflict) {
      const pick = await choose('다른 기기에서 먼저 바뀌었습니다', '<p>이 목록을 연 뒤 다른 기기(휴대폰 등)에서 연계 목록이 수정되었습니다.</p><p class="hint"><b>다시 불러오기</b>: 방금 바꾼 내용은 버리고 최신 목록을 엽니다.<br>다른 기기의 변경을 보호하기 위해 최신 목록을 불러온 뒤 다시 수정합니다.</p>',
        [{ label: '다시 불러오기', value: 'reload' }]);
      await load(); return false;
    }
    L.modified = r.modifiedTime; if (msg) toast(msg); return true;
  }

  /* ---------- 화면 ---------- */
  function render() {
    if (!L.loaded) return;
    const counts = PUBLIC.reduce((a,s) => { a[s.verificationStatus] = (a[s.verificationStatus] || 0) + 1; return a; }, {});
    const tabs = [['match','요구 체크 → 추천'],['list','서비스 목록'],['pending','담당기관 확인 필요 (' + (counts.needs_contact || 0) + ')'],['needs','요구 항목'],['io','가져오기·백업']];
    box().innerHTML = '<div class="lk-summary"><h2>강서구 연계 안내</h2><p>공개자료 ' + PUBLIC.length + '건 · 상담 및 연계 가능 <b>' + (counts.consultable || 0) + '</b>건 · 담당기관 확인 필요 <b>' + (counts.needs_contact || 0) + '</b>건</p><p class="hint">자료 기준 ' + esc(CATALOG.checkedAt) + ' · <b>상담 및 연계 가능 ≠ 현재 접수 중·지원 확정</b><br>조사자료에 기재된 안내입니다. 접수·예산·대상 자격은 의뢰 전 담당기관에 확인하세요.</p></div>'
      + '<div class="lk-bar row"><div class="seg" role="tablist" aria-label="연계 안내 보기">' + tabs.map(t => '<button data-lkview="' + t[0] + '" aria-pressed="' + (L.view === t[0]) + '">' + t[1] + '</button>').join('') + '</div></div>'
      + '<div class="lk-personal row"><span>' + (L.personalLoaded ? '개인 Drive 목록 ' + L.data.services.length + '건 · 공개자료와 별도 보관' : '공개자료는 로그인 없이 이용 가능합니다. 개인 Drive 목록은 별도로 불러옵니다.') + '</span><button class="small" id="lkDrive">' + (L.personalLoaded ? '개인 목록 다시 불러오기' : '개인 목록·드라이브 연결') + '</button><span role="status">' + esc(L.notice) + '</span></div>'
      + '<div class="hint lk-special">2026년 안내: 강서구 일상돌봄은 예산 소진으로 대기 신청만 가능 · 이동푸드마켓은 미운영(별도 신청 불가) · 그냥드림은 신규 운영 안내(당일 수량 확인).</div>'
      + (L.data.defaultsPending ? '<p class="hint">개인 요구 항목은 임시 기본값입니다. 기존 항목을 보존하며 ‘요구 항목’에서 관리합니다.</p>' : '')
      + (L.view === 'match' ? matchHtml() : L.view === 'list' || L.view === 'pending' ? listHtml() : L.view === 'needs' ? needsHtml() : catalogImportHtml() + ioHtml());
  }
  function allServices() {
    const personal = L.data.services.map(s => {
      const research = PUBLIC.find(p => p.id === s.catalogId || M.identity(p) === M.identity(s));
      return Object.assign({},s,{_personal:true,_key:'personal:' + s.id},research && research.verificationStatus === 'needs_contact' ? {verificationStatus:'needs_contact'} : {});
    });
    return personal.concat(PUBLIC.filter(s => !M.isDuplicate(s, personal)).map(s => Object.assign({}, s, {_key:'public:' + s.id})));
  }
  function serviceByKey(k) { return allServices().find(s => s._key === k); }
  function needLabels(s) {
    if (!s._personal) return s.needs;
    const map = itemById(); return s.needs.map(n => map[n] ? map[n].label : n);
  }
  function matchCategories() {
    const categories = M.clone(L.data.categories), known = new Set(categories.flatMap(c => c.items.map(i => M.needsKey(i.label))));
    const extra = Array.from(new Set(PUBLIC.flatMap(s => s.needs))).filter(n => !known.has(M.needsKey(n)));
    if (extra.length) categories.push({id:'public-extra',name:'공개자료 추가 요구 (체크만, 저장 안 함)',items:extra.map(label => ({id:'public-need:' + label,label}))});
    return categories;
  }
  function checkGroups() { return M.groupedNeeds(matchCategories()); }
  function selectedNeedIds() { return M.expandNeedSelection(checkGroups(),L.checks); }
  function selectedLabels() { const selected = selectedNeedIds(); return new Set(matchCategories().flatMap(c => c.items.filter(i => selected.has(i.id)).map(i => M.needsKey(i.label)))); }
  function scored() {
    const checks = selectedLabels(), selected = selectedNeedIds();
    return allServices().filter(s => s.verificationStatus !== 'needs_contact' && M.intake(s) !== 'closed').map(s => ({s,hit:Array.from(new Set(needLabels(s).filter(n => checks.has(M.needsKey(n))).concat(M.refinedHits(s,needLabels(s),selected))))})).filter(x => x.hit.length)
      .sort((a,b) => b.hit.length - a.hit.length || Number(b.s._personal) - Number(a.s._personal) || a.s.name.localeCompare(b.s.name,'ko'));
  }
  function link(url, label) { const u = M.safeUrl(url); return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(label || u) + '</a>' : '<span class="hint">링크 미확인</span>'; }
  function formButtons(s) {
    if (!s.forms.length) return '<span class="hint">' + esc(s.formsNote || '담당기관에 최신 양식 요청') + '</span>';
    return s.forms.map((f,i) => f.fileId
      ? '<span class="lk-form">📄 ' + esc(f.name) + ' <button class="small" data-dl="' + esc(s.id) + ':' + i + '">내려받기</button>' + (f.link ? link(f.link,'드라이브에서 열기') : '') + '</span>'
      : '<span class="lk-form">' + link(f.url, (f.type === 'official_attachment_page' ? '서식 게시 페이지: ' : '') + f.name) + '</span>').join('');
  }
  function badges(s) { return '<span class="badge">' + (s._personal ? '개인 목록' : '공개 조사자료') + '</span> <span class="badge">' + esc(s.verificationStatus === 'needs_contact' ? '담당기관 확인 필요' : s.verificationStatus === 'consultable' ? '상담 및 연계 가능' : '개인 등록·검증 미확인') + '</span> <span class="badge">' + esc(M.intakeLabels[M.intake(s)]) + '</span>'; }
  function serviceCard(s, hit) {
    return '<article class="lk-svc"><div class="lk-svc-h"><div><b class="lk-name">' + esc(s.name) + '</b><p class="hint">' + esc(s.org) + '</p></div><span class="lk-score">' + hit.length + '개 해당</span></div><div>' + badges(s) + '</div><p class="lk-chips">' + hit.map(n => '<span class="lk-chip">' + esc(n) + '</span>').join('') + '</p><p><b>검토 후보</b> · 대상 조건: ' + esc(s.conditions || '미확인') + '</p><p>' + esc(M.routes[s.referralCode] || M.routes[4]) + '</p><p class="hint">접수: ' + esc(s.intakeStatus || '미확인') + '</p>' + formButtons(s) + '<div class="row"><button class="small" data-detail="' + esc(s._key) + '">전체 조건·근거 보기</button><button class="small" data-sched="' + esc(s._key) + '">연계 일정 등록</button></div></article>';
  }
  function needChip(i) {
    const checked = (i.sourceIds || [i.id]).some(id => L.checks.has(id));
    return '<label class="lk-chip' + (checked ? ' on' : '') + '"><input type="checkbox" data-need="' + esc(i.id) + '"' + (checked ? ' checked' : '') + '> ' + esc(i.label) + '</label>';
  }
  function matchHtml() {
    const res = scored(), refined = checkGroups(), count = refined.reduce((n,g) => n + g.items.length,0);
    const selected = selectedNeedIds();
    const pending = allServices().filter(s => s.verificationStatus === 'needs_contact' && M.refinedHits(s,needLabels(s),selected).length);
    return '<div class="lk-layout"><section class="card"><div class="card-head"><h3>대상자 요구 체크</h3><button class="small" id="lkClear">체크 초기화</button></div><div class="card-body"><p class="hint">체크는 저장·전송하지 않습니다. 탭을 떠나거나 연결을 해제하면 초기화됩니다. 이름은 입력하지 않습니다.</p>'
      + '<p><b>대상자 요구 ' + refined.length + '개 분야 · ' + count + '개 항목</b><br><span class="hint">분야를 펼쳐 필요한 항목을 골라주세요. 자격 판정·진단이 아닌 상담 연결용입니다.</span></p>'
      + refined.map(g => '<details class="lk-refined" id="refined-' + esc(g.id) + '" data-need-group="' + esc(g.id) + '"' + (L.needOpen.has(g.id) ? ' open' : '') + '><summary>' + esc(g.name) + '<span>' + g.items.filter(i => i.sourceIds.some(id => L.checks.has(id))).length + ' / ' + g.items.length + ' 선택</span></summary><div class="lk-chips">' + g.items.map(needChip).join('') + '</div></details>').join('')
      + '</div></section><section class="card"><div class="card-head"><h3>검토 후보 ' + (L.checks.size ? res.length + '건' : '') + '</h3></div><div class="card-body"><div class="infobox">요구 일치 순서이며 수급 자격 판정이 아닙니다. 연령·지역·소득·보험·중복 제한을 상세에서 확인하세요. 개인정보 제3자 제공 동의와 기관 기록 절차를 지켜주세요. 개인 서비스는 기존의 포괄 요구로 연결될 수 있어 세부 지원내용을 확인해야 합니다.</div>'
      + (L.checks.size ? res.length ? res.map(x => serviceCard(x.s,x.hit)).join('') : '<p class="empty">일치하는 검토 후보가 없습니다. 확인 필요 자료나 개인 서비스의 연결 항목도 확인하세요.</p>' : '<p class="empty">요구를 체크하면 검토할 서비스를 표시합니다.</p>')
      + (pending.length ? '<aside class="warnbox lk-pending-needs"><b>관련 자료 중 담당기관 확인 필요 ' + pending.length + '건</b><p>아래 자료는 추천·신청 가능 사업이 아닙니다. 현행 운영과 지원내용 확인이 필요합니다.</p>' + pending.map(s => '<button class="link" data-detail="' + esc(s._key) + '">' + esc(s.name) + ' — 확인 필요</button>').join('') + '</aside>' : '') + '</div></section></div>';
  }
  function options(values, selected, first) { return '<option value="">' + esc(first) + '</option>' + Object.entries(values).map(([k,v]) => '<option value="' + esc(k) + '"' + (selected === k ? ' selected' : '') + '>' + esc(v) + '</option>').join(''); }
  function filteredServices() {
    const q = M.key(L.q), f = L.filters;
    return allServices().filter(s => (L.view === 'pending' ? s.verificationStatus === 'needs_contact' : s.verificationStatus !== 'needs_contact')
      && (!q || M.key([s.name,s.org,s.field,s.conditions,s.contact,s.memo,...(s.aliases || []),...needLabels(s)].join(' ')).includes(q))
      && (!f.field || s.field === f.field) && (!f.route || String(s.referralCode || 4) === f.route)
      && (!f.group || M.groups(s).includes(f.group)) && (!f.intake || M.intake(s) === f.intake)
      && (!f.source || (f.source === 'personal' ? s._personal : !s._personal)));
  }
  function listHtml() {
    const list = filteredServices(), f = L.filters;
    return '<p class="hint">검토 후보 좁히기 — 선택 자격을 저장하지 않습니다. 일반 차상위와 차상위본인부담경감은 다르며, 필터 결과가 지원 자격을 뜻하지 않습니다. 주택바우처의 수급가구 제외 등은 상세에서 확인하세요.</p><div class="lk-filter"><label>검색<input type="search" id="lkQ" placeholder="서비스·기관·별칭·요구·조건·연락처" value="' + esc(L.q) + '"></label>'
      + [['field','분야',Object.fromEntries(FIELDS.map(x => [x,x]))],['group','대상 자격',M.groupLabels],['route','의뢰 방식',M.routes],['intake','접수 상태',M.intakeLabels],['source','자료 출처',{public:'공개자료',personal:'개인 목록'}]].map(([k,label,values]) => '<label>' + label + '<select data-lkfilter="' + k + '">' + options(values,f[k],label + ' 전체') + '</select></label>').join('')
      + '<button id="lkFilterClear">필터 초기화</button></div><div class="row"><b role="status">검색 결과 ' + list.length + '건</b><button class="primary" id="lkAdd">+ 개인 서비스 추가</button></div>'
      + '<div class="lk-list">' + list.slice(0,L.listLimit).map(s => '<article class="lk-row"><div><button class="link lk-title" data-detail="' + esc(s._key) + '">' + esc(s.name) + '</button><p class="hint">' + esc(s.org) + ' · ' + esc(s.field) + '</p><div>' + badges(s) + '</div><p>대상 조건: ' + esc(s.conditions || '미확인') + '</p><p>' + esc(M.routes[s.referralCode] || M.routes[4]) + '</p><p class="hint">접수: ' + esc(s.intakeStatus || '미확인') + '</p>'
      + (s._personal ? '<button class="small" data-edit="' + esc(s.id) + '">개인 서비스 수정</button>' : '') + '</div></article>').join('') + (list.length ? '' : '<p class="empty">검색 결과가 없습니다.</p>') + '</div>' + (list.length > L.listLimit ? '<button id="lkShowMore">더 보기 (' + Math.min(L.listLimit,list.length) + '/' + list.length + ')</button>' : '');
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
    if (!L.personalLoaded) { alert('먼저 개인 목록을 불러오세요.'); return; }
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

  function detailRow(label, value) { return '<div class="lk-kv"><b>' + esc(label) + '</b><span>' + esc(value || '미확인').replace(/\n/g,'<br>') + '</span></div>'; }
  function showDetail(k) {
    const s = serviceByKey(k); if (!s) return;
    const review = L.data.catalogReviews[s.catalogId || s.id];
    $('#referralTitle').textContent = s.name;
    $('#referralBody').innerHTML = '<p>' + badges(s) + '</p><p class="infobox">검토 후보 안내입니다. 현재 접수·예산이나 개별 지원 자격의 확정이 아닙니다. 의뢰 분류는 사업 신청 경로이며 의료기관 진료의뢰서와 다릅니다.</p>'
      + detailRow('운영기관 / 분야',s.org + ' / ' + s.field)
      + detailRow('적용 지역',s.region || s.scope || (s._personal && !s.catalogId ? '' : CATALOG.scope + ' (세부 거주요건은 대상 조건·기관 확인)'))
      + detailRow('기준연도',s.referenceYear || (s.catalogId || !s._personal ? CATALOG.checkedAt.slice(0,4) + '년 조사자료 (현행 접수 보장 아님)' : ''))
      + detailRow('검증 상태',s.verificationStatus === 'needs_contact' ? '담당기관 확인 필요' : s.verificationStatus === 'consultable' ? '상담 및 연계 가능' : '개인 등록·검증 미확인')
      + detailRow('접수 상태',s.intakeStatus) + detailRow('대상 조건',s.conditions)
      + detailRow('연령',s.ageConditions || '대상 조건에 기재된 연령을 확인; 별도 구조화 정보 없음')
      + detailRow('경제·보험·장애·질환',s.conditions) + detailRow('제외·중복·지원 범위',s.exceptionsAndNotes || s.memo)
      + detailRow('의뢰 방식', (M.routes[s.referralCode] || M.routes[4]) + '\n' + (s.referralDescription || '세부 경로 미확인'))
      + detailRow('연락처',s.contact) + detailRow('신청 절차',s.apply) + detailRow('필요 서류',s.docs || s.requiredDocuments)
      + detailRow('수술·치료 전 승인',s.preapprovalStatus) + detailRow('메모',s.memo)
      + '<div class="lk-kv"><b>양식</b><span>' + formButtons(s) + '<br>' + esc(s.formsNote || '최신 양식은 담당기관에 확인') + '</span></div>'
      + '<div class="lk-kv"><b>공식 안내</b><span>' + (M.safeUrl(s.officialGuideUrl) ? link(s.officialGuideUrl,s.officialSourceTitle || '공식 안내 원문 (제목 미확인)') + '<br>' + esc(s.officialGuideUrl) : '미확인') + '</span></div>'
      + detailRow('근거 발행일',s.sourcePublishedDate) + detailRow('조사자료 확인일',s.checkedAt)
      + detailRow('요구 / 별칭',needLabels(s).join(', ') + ((s.aliases || []).length ? '\n별칭: ' + s.aliases.join(', ') : ''))
      + (review ? detailRow('개인 확인 기록 (공개 분류 유지)',JSON.stringify(review,null,2)) : '')
      + (s.verificationStatus === 'needs_contact' ? '<button data-review="' + esc(s.catalogId || s.id) + '">담당기관 확인 기록 수정</button>' : '');
    $('#referralDlg').showModal();
  }
  function catalogImportHtml() {
    return '<section class="card"><div class="card-head"><h3>공개자료를 개인 목록에 선택 병합</h3></div><div class="card-body"><p>공개자료는 이미 검색할 수 있습니다. 편집·개인화가 필요할 때만 가져오세요. 기존 목록은 자동으로 변경하지 않습니다.</p><p class="hint">자료 버전: ' + esc(CATALOG.datasetId) + ' · 미확인 사업을 가져와도 공개 검증 상태는 바뀌지 않습니다.</p>'
      + '<div class="lk-import-picks">' + PUBLIC.map(s => '<label><input type="checkbox" data-catalog-select="' + esc(s.id) + '"' + (L.selected.has(s.id) ? ' checked' : '') + '> ' + esc(s.name) + (s.verificationStatus === 'needs_contact' ? ' (확인 필요)' : '') + '</label>').join('') + '</div>'
      + '<button id="lkCatalogPreview">선택 자료 병합 미리보기</button><div id="lkCatalogPreviewBox"></div></div></section>';
  }
  function downloadBackup(data, prefix = '연계목록_변경전백업') {
    const a = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    a.href = url; a.download = prefix + '_' + new Date().toISOString().replace(/[:.]/g,'-') + '.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url),60000);
  }
  async function previewCatalog() {
    if (!L.personalLoaded) { alert('먼저 개인 목록·드라이브 연결을 눌러주세요.'); return; }
    if (!L.selected.size) { alert('가져올 공개자료를 선택하세요.'); return; }
    const latest = await call('linksLoad');
    if (latest.modifiedTime !== L.modified) { L.importSnapshot = null; await load(); alert('다른 기기에서 개인 목록이 바뀌었습니다. 최신본에서 미리보기를 다시 실행하세요.'); return; }
    const data = normalize(latest.data), selected = PUBLIC.filter(s => L.selected.has(s.id));
    const plan = M.mergeCatalog(data,selected);
    L.importSnapshot = {data,sourceData:latest.data || data,selected,modifiedTime:latest.modifiedTime,backedUp:false};
    $('#lkCatalogPreviewBox').innerHTML = '<p>추가 ' + plan.added.length + '건 · 중복 제외 ' + plan.duplicates.length + '건</p><p>' + esc(plan.added.map(s => s.name).join(' · ') || '새로 가져올 자료가 없습니다.') + '</p><p class="hint">중복: ' + esc(plan.duplicates.join(' · ') || '없음') + '</p><p>기존 요구에 없는 라벨: ' + esc(plan.missing.join(', ') || '없음') + '</p>'
      + (plan.missing.length ? '<label><input type="checkbox" id="lkMissingConsent"> 위 요구 라벨을 새 ‘공개자료 추가 요구’ 분류에 추가합니다. 기존 분류는 유지합니다.</label>' : '')
      + '<div class="row"><button id="lkCatalogBackup">변경 전 백업 다운로드</button><label><input type="checkbox" id="lkBackupSaved">백업 파일이 저장됐는지 확인했습니다.</label></div><button class="primary" id="lkCatalogCommit"' + (plan.added.length ? '' : ' disabled') + '>확인 후 병합 저장</button><button id="lkCatalogCancel">미리보기 취소</button>';
  }
  async function commitCatalog() {
    const snap = L.importSnapshot; if (!snap) return;
    if (!snap.backedUp || !$('#lkBackupSaved').checked) { alert('변경 전 백업을 다운로드하고 저장을 확인하세요.'); return; }
    if ($('#lkMissingConsent') && !$('#lkMissingConsent').checked) { alert('새 요구 항목 추가 여부를 확인하세요.'); return; }
    if (!confirm('선택 자료를 개인 목록에 병합할까요? 중복 항목과 기존 개인 수정 내용은 유지됩니다.')) return;
    const epoch = L.epoch, latest = await call('linksLoad');
    if (epoch !== L.epoch) return;
    if (latest.modifiedTime !== snap.modifiedTime || (latest.data && JSON.stringify(normalize(latest.data)) !== JSON.stringify(snap.data))) {
      L.importSnapshot = null; await load(); alert('개인 목록이 바뀌어 병합을 중단했습니다. 최신본을 확인하고 다시 백업·미리보기하세요.'); return;
    }
    const plan = M.mergeCatalog(snap.data,snap.selected,true); plan.data.updatedAt = new Date().toISOString();
    const result = await call('linksSave',plan.data,snap.modifiedTime,false);
    if (epoch !== L.epoch) return;
    if (result.conflict) { L.importSnapshot = null; await load(); alert('저장 중 다른 기기 수정이 감지되어 중단했습니다. 기존 원격 자료는 보존됩니다.'); return; }
    L.data = plan.data; L.modified = result.modifiedTime; L.selected.clear(); L.importSnapshot = null; L.view = 'list'; render(); toast(plan.added.length + '건을 개인 목록에 병합했습니다.');
  }
  function openReview(id) {
    if (!L.personalLoaded) { alert('확인 기록은 개인 Drive에만 저장됩니다. 먼저 개인 목록을 불러오세요.'); return; }
    const raw = PUBLIC.find(s => s.id === id); if (!raw) return;
    L.reviewId = id; const r = L.data.catalogReviews[id] || {};
    $('#referralReviewTitle').textContent = raw.name + ' — 개인 확인 기록';
    $('#referralReviewBody').innerHTML = '<p class="infobox">기관 확인 내용을 기록해도 ‘담당기관 확인 필요’ 분류는 자동 변경되지 않습니다. 대상자 개인정보는 입력하지 마세요.</p>'
      + [['operation','현행 운영 여부'],['gangseo','강서구 적용 가능 여부'],['agency','담당기관·부서'],['recommendation','추천서 필요 여부'],['checkedAt','최근 확인일'],['evidence','공식 근거 URL·문서'],['memo','기관 정보 메모']].map(([k,label]) => '<label class="f">' + label + '<input data-review-field="' + k + '"' + (k === 'checkedAt' ? ' type="date"' : '') + ' value="' + esc(r[k] || '') + '"></label>').join('');
    if ($('#referralDlg').open) $('#referralDlg').close(); $('#referralReviewDlg').showModal();
  }
  function bindCatalogDialogs() {
    if (!$('#referralDlg')) document.body.insertAdjacentHTML('beforeend','<dialog id="referralDlg" class="wide"><div class="dlg-head"><h3 id="referralTitle"></h3><button data-refclose="referralDlg">닫기</button></div><div class="dlg-body" id="referralBody"></div></dialog><dialog id="referralReviewDlg"><div class="dlg-head"><h3 id="referralReviewTitle"></h3><button data-refclose="referralReviewDlg">닫기</button></div><div class="dlg-body" id="referralReviewBody"></div><div class="dlg-foot"><button id="lkReviewSave" class="primary">개인 확인 기록 저장</button></div></dialog>');
    for (const id of ['referralDlg','referralReviewDlg']) document.getElementById(id).addEventListener('click',async e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.refclose) { document.getElementById(t.dataset.refclose).close(); return; }
      if (t.dataset.review) { openReview(t.dataset.review); return; }
      if (t.dataset.dl) { const [sid,i] = t.dataset.dl.split(':'), s = L.data.services.find(s => s.id === sid); if (s && s.forms[+i]) try { await call('downloadForm',s.forms[+i].fileId,s.forms[+i].name); } catch(e) { alert(e.message); } return; }
      if (t.id === 'lkReviewSave') {
        t.disabled = true;
        try {
          const record = Object.assign({},L.data.catalogReviews[L.reviewId] || {});
          $$('[data-review-field]',$('#referralReviewBody')).forEach(x => record[x.dataset.reviewField] = x.value.trim());
          L.data.catalogReviews[L.reviewId] = record;
          if (await save('확인 기록을 저장했습니다. 공개 검증 상태는 유지됩니다.')) { $('#referralReviewDlg').close(); render(); }
        } catch(e) { alert(e.message); } finally { t.disabled = false; }
      }
    });
  }
  async function catalogClick(t) {
    const detail = t.closest('[data-detail]'); if (detail) { showDetail(detail.dataset.detail); return true; }
    if (t.id === 'lkFilterClear') { L.listLimit = 12; L.q = ''; Object.keys(L.filters).forEach(k => L.filters[k] = ''); render(); return true; }
    if (!['lkCatalogPreview','lkCatalogCommit','lkCatalogCancel','lkCatalogBackup'].includes(t.id)) return false;
    if (L.busy) return true;
    L.busy = true; t.disabled = true;
    try {
      if (t.id === 'lkCatalogPreview') await previewCatalog();
      if (t.id === 'lkCatalogCommit') await commitCatalog();
      if (t.id === 'lkCatalogBackup' && L.importSnapshot) { downloadBackup(L.importSnapshot.sourceData); L.importSnapshot.backedUp = true; }
      if (t.id === 'lkCatalogCancel') { L.importSnapshot = null; $('#lkCatalogPreviewBox').replaceChildren(); }
    } catch (e) { alert('병합 작업을 완료하지 못했습니다: ' + (e.message || e)); }
    finally { L.busy = false; t.disabled = false; }
    return true;
  }

  /* ---------- 이벤트 ---------- */
  function bindOnce() {
    const b = box();
    b.addEventListener('toggle', ev => { const d = ev.target; if (d.dataset.needGroup) { d.open ? L.needOpen.add(d.dataset.needGroup) : L.needOpen.delete(d.dataset.needGroup); } }, true);
    b.addEventListener('click', async ev => {
      const t = ev.target;
      const v = t.closest('[data-lkview]'); if (v) { L.view = v.dataset.lkview; L.listLimit = 12; render(); return; }
      if (t.id === 'lkShowMore') { L.listLimit += 12; render(); return; }
      if (t.id === 'lkRetry' || t.id === 'lkReload') { load(); return; }
      if (t.id === 'lkDrive') { t.disabled = true; try { if (!VHM_AUTH.valid()) { L.notice = '먼저 일정 탭에서 구글 계정으로 연결하세요. 공개자료는 계속 이용할 수 있습니다.'; render(); return; } if (!VHM_AUTH.hasDrive) await VHM_AUTH.request('drive'); await load(); } catch (e) { toast(e.message || String(e), 5000); t.disabled = false; } return; }
      if (t.id === 'lkClear') { L.checks.clear(); render(); return; }
      if (t.closest('[data-detail]') || ['lkFilterClear','lkCatalogPreview','lkCatalogCommit','lkCatalogCancel','lkCatalogBackup'].includes(t.id)) { await catalogClick(t); return; }
      if (t.id === 'lkAdd') { if (!L.personalLoaded) { alert('먼저 개인 목록·드라이브 연결을 눌러주세요.'); return; } openSvc(null); return; }
      const ed = t.closest('[data-edit]'); if (ed) { openSvc(L.data.services.find(s => s.id === ed.dataset.edit)); return; }
      if (t.dataset.dl) { const [sid, i] = t.dataset.dl.split(':'); const s = L.data.services.find(x => x.id === sid); const fm = s && s.forms[+i];
        if (fm) { t.disabled = true; try { await run('내려받는 중…', () => call('downloadForm', fm.fileId, fm.name)); } catch (e) {} t.disabled = false; } return; }
      if (t.dataset.sched) { const s = serviceByKey(t.dataset.sched);
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
      if (t.id === 'lkExport') { if (!L.personalLoaded) { alert('먼저 개인 목록을 불러오세요.'); return; } const blob = new Blob([JSON.stringify(L.data, null, 1)], { type: 'application/json' }); const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = '연계목록백업_' + todayStr().replace(/-/g, '') + '.json'; document.body.appendChild(a); a.click(); a.remove(); toast('백업 파일을 내려받았습니다.'); return; }
      if (t.id === 'lkRestore') { $('#lkFile').click(); return; }
    });
    b.addEventListener('change', async ev => {
      const t = ev.target;
      if (t.dataset.lkfilter) { L.filters[t.dataset.lkfilter] = t.value; L.listLimit = 12; render(); return; }
      if (t.dataset.catalogSelect) { t.checked ? L.selected.add(t.dataset.catalogSelect) : L.selected.delete(t.dataset.catalogSelect); L.importSnapshot = null; return; }
      if (t.dataset.need) { const item = checkGroups().flatMap(g => g.items).find(i => i.id === t.dataset.need); for (const id of item ? item.sourceIds : [t.dataset.need]) { if (t.checked) L.checks.add(id); else L.checks.delete(id); } render(); return; }
      if (t.id === 'lkFile') { if (!L.personalLoaded) { alert('먼저 개인 목록을 불러오세요.'); return; } const file = t.files[0]; t.value = ''; if (!file) return;
        let d; try { d = JSON.parse(await file.text()); } catch (e) { alert('백업 파일을 읽지 못했습니다.'); return; }
        if (!d || !Array.isArray(d.services) || !Array.isArray(d.categories)) { alert('연계 목록 백업 파일이 아닙니다.'); return; }
        if (!confirm('지금 목록(서비스 ' + L.data.services.length + '건)을 백업 파일 내용(서비스 ' + d.services.length + '건)으로 바꿀까요?')) return;
        downloadBackup(L.data,'연계목록_복원전백업');
        L.data = normalize(d); if (await save('백업 파일로 바꿨습니다.')) render(); }
    });
    b.addEventListener('input', ev => { if (ev.target.id === 'lkQ') { L.q = ev.target.value; L.listLimit = 12; const pos = ev.target.selectionStart; render(); const q = $('#lkQ'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } } });
    b.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.dataset && ev.target.dataset.edit) ev.target.click(); });
    // 서비스 대화상자
    $('#svcDlg').addEventListener('click', async ev => {
      const t = ev.target;
      if (t.id === 'svcAddFile') { $('#svcFile').click(); return; }
      if (t.id === 'svcAddLink') { const url = $('#svcLinkUrl').value.trim(), name = $('#svcLinkName').value.trim() || '링크';
        if (!M.safeUrl(url)) { alert('https:// 로 시작하는 주소를 넣어 주세요.'); return; }
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
    open() {
      if (!bound) { bindOnce(); bindCatalogDialogs(); bound = true; }
      if (!L.data) L.data = emptyData();
      L.loaded = true; render();
      if (!L.personalLoaded && window.VHM_AUTH && VHM_AUTH.valid() && VHM_AUTH.hasDrive) load();
    },
    leave() { L.checks.clear(); L.q = ''; Object.keys(L.filters).forEach(k => L.filters[k] = ''); },
    reset() { L.epoch++; L.data = emptyData(); L.loaded = false; L.personalLoaded = false; L.loading = false; L.notice = ''; L.busy = false; L.selected.clear(); L.importSnapshot = null; this.leave(); ['referralDlg','referralReviewDlg'].forEach(id => { const d = document.getElementById(id); if (d && d.open) d.close(); }); if (box()) box().replaceChildren(); },
    _state:L
  };

})();
