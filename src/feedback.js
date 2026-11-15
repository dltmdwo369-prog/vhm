/* Shared feedback only. Calendar, notes and archive data never enter this module. */
(function () {
  'use strict';
  const cfg = (window.VHM_CONFIG || {}).feedback || {};
  const statuses = ['접수', '미해결', '해결완료'];
  const categories = ['오류 신고', '개선 제안', '사용 문의', '기타'];
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ready = () => !!(cfg.apiKey && cfg.projectId);
  const root = 'projects/' + cfg.projectId + '/databases/(default)/documents';
  const endpoint = 'https://firestore.googleapis.com/v1/' + root;
  let session = null, pending = null, generation = 0, adminView = false, busy = false;
  let rows = [], cursor = null, more = false, filter = '', message = '', draft = {title:'', body:'', category:categories[0]};
  let submitId = null;
  function valid() { return window.VHM_AUTH && VHM_AUTH.valid(); }
  function stillCurrent(s) { return s && valid() && s.googleToken === VHM_AUTH.token; }
  async function json(url, options) {
    let r;
    try { r = await fetch(url, options); } catch (_) { throw new Error('인터넷 연결을 확인한 뒤 다시 시도해 주세요.'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const reason = data.error && data.error.message || '';
      if (/CONFIGURATION_NOT_FOUND|OPERATION_NOT_ALLOWED|SERVICE_DISABLED/.test(reason)) throw new Error('관리자가 피드백 연결을 준비 중입니다. 설정이 끝난 뒤 다시 이용해 주세요.');
      if (/INVALID_IDP_RESPONSE|INVALID_CREDENTIAL|INVALID_OAUTH/.test(reason)) throw new Error('Google 계정 확인에 실패했습니다. 연결을 해제한 뒤 다시 연결해 주세요. 계속 실패하면 관리자에게 알려 주세요.');
      if (r.status === 401) session = null;
      if (r.status === 409 || r.status === 412) throw new Error('다른 곳에서 변경되었거나 이미 접수된 항목입니다. 새로고침해 확인해 주세요.');
      if (r.status === 403) throw new Error('피드백 접근 권한이 없습니다. 관리자에게 연결 설정을 확인해 달라고 요청해 주세요.');
      if (r.status === 401) throw new Error('로그인 시간이 지났습니다. Google 계정으로 다시 연결해 주세요.');
      throw new Error('피드백 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    }
    return data;
  }
  async function authenticate() {
    if (!ready()) throw new Error('피드백 접수를 준비 중입니다. 관리자 연결 설정이 끝나면 사용할 수 있습니다.');
    if (!valid()) throw new Error('일정 탭에서 Google 계정으로 연결한 뒤 이용해 주세요.');
    if (stillCurrent(session) && session.exp > Date.now() + 60000) return session;
    if (pending && pending.token === VHM_AUTH.token) return pending.promise;
    const googleToken = VHM_AUTH.token, epoch = generation;
    const task = (async () => {
      const r = await json('https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=' + encodeURIComponent(cfg.apiKey), {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
          requestUri:location.origin + location.pathname,
          postBody:new URLSearchParams({access_token:googleToken, providerId:'google.com'}).toString(),
          returnSecureToken:true
        })
      });
      if (epoch !== generation || !valid() || VHM_AUTH.token !== googleToken) throw new Error('계정 연결이 변경되었습니다. 다시 열어 주세요.');
      const s = {googleToken, token:r.idToken, uid:r.localId, email:r.email, exp:Date.now() + Number(r.expiresIn) * 1000, admin:false};
      if (!s.uid || !s.token) throw new Error('Google 계정을 확인하지 못했습니다. 다시 연결해 주세요.');
      // Presentation only: Firestore rules independently enforce this exact verified account.
      s.admin = s.email === 'dltmdwo369@gmail.com';
      if (epoch !== generation || !stillCurrent(s)) throw new Error('계정 연결이 변경되었습니다. 다시 열어 주세요.');
      session = s;
      $('[data-tab="feedback-admin"]').hidden = !s.admin;
      return s;
    })();
    const entry = {token:googleToken, promise:task}; pending = entry;
    try { return await task; } finally { if (pending === entry) pending = null; }
  }
  async function db(path, body, s) {
    if (!stillCurrent(s)) throw new Error('Google 계정으로 다시 연결해 주세요.');
    return json(endpoint + path, {method:'POST', headers:{Authorization:'Bearer ' + s.token, 'Content-Type':'application/json'}, body:JSON.stringify(body)});
  }
  const str = stringValue => ({stringValue});
  function decode(d) {
    const r = {name:d.name, version:d.updateTime};
    for (const [k,v] of Object.entries(d.fields || {})) r[k] = v.stringValue !== undefined ? v.stringValue : v.timestampValue;
    return r;
  }
  async function load(append) {
    const s = await authenticate();
    if (adminView && !s.admin) throw new Error('관리자만 피드백 관리를 이용할 수 있습니다.');
    const q = {from:[{collectionId:'feedback'}], orderBy:[{field:{fieldPath:'createdAt'}, direction:'DESCENDING'},{field:{fieldPath:'__name__'}, direction:'DESCENDING'}], limit:51};
    if (!adminView) q.where = {fieldFilter:{field:{fieldPath:'authorId'}, op:'EQUAL', value:str(s.uid)}};
    if (append && cursor) q.startAt = {values:[{timestampValue:cursor.createdAt},{referenceValue:cursor.name}], before:false};
    const result = await db(':runQuery', {structuredQuery:q}, s);
    if (!stillCurrent(s)) return;
    const docs = result.filter(x => x.document).map(x => decode(x.document));
    more = docs.length > 50;
    const page = docs.slice(0,50);
    cursor = page.length ? page[page.length - 1] : null;
    rows = (append ? rows : []).concat(page).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  function date(v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR', {timeZone:'Asia/Seoul'}); }
  function statusHtml(s) { return '<span class="fb-status fb-' + statuses.indexOf(s) + '">' + esc(s) + '</span>'; }
  function render() {
    const box = $(adminView ? '#tab-feedback-admin' : '#tab-feedback');
    if (!box) return;
    const authed = stillCurrent(session), isAdmin = authed && session.admin;
    const active = authed && (!adminView || isAdmin);
    const visible = rows.filter(r => !filter || r.status === filter);
    box.innerHTML = '<div class="card fb-wrap"><div class="fb-heading"><div><h2>' + (adminView ? '피드백 관리' : '피드백') + '</h2><p class="hint">' + (adminView ? '사용자 의견을 확인하고 처리 상태와 답변을 남겨 주세요.' : '불편한 점이나 개선 의견을 남겨 주세요. 내가 보낸 의견과 처리 상태를 확인할 수 있습니다.') + '</p></div><button type="button" id="fbRefresh" ' + (busy ? 'disabled' : '') + '>새로고침</button></div>'
      + '<p class="hint">공유 주소: <a href="https://dltmdwo369-prog.github.io/vhm/">https://dltmdwo369-prog.github.io/vhm/</a></p>'
      + '<p role="status" aria-live="polite" class="infobox">' + esc(message || (busy ? '불러오는 중…' : !ready() ? '피드백 접수를 준비 중입니다. 관리자 연결 설정이 끝나면 사용할 수 있습니다.' : !valid() ? '일정 탭에서 Google 계정으로 연결한 뒤 이용해 주세요.' : active ? (adminView ? '관리자 · ' : '') + session.email : '계정 확인 후 이용할 수 있습니다.')) + '</p>'
      + (!adminView ? '<form id="fbForm"><fieldset ' + (!active || busy ? 'disabled' : '') + '><legend>새 피드백</legend><label class="f">종류<select name="category">' + categories.map(c => '<option ' + (draft.category === c ? 'selected' : '') + '>' + c + '</option>').join('') + '</select></label><label class="f">제목<input name="title" required maxlength="100" value="' + esc(draft.title) + '" placeholder="어떤 점을 알려주시겠어요?"></label><label class="f">내용<textarea name="body" rows="6" required maxlength="3000" placeholder="문제가 생긴 화면과 동작, 개선 의견 등을 적어 주세요.">' + esc(draft.body) + '</textarea></label><p class="hint">작성한 제목·내용과 로그인 이메일이 관리자에게 전달됩니다. 대상자 이름·연락처·건강정보는 적지 마세요. 일정과 상담 메모는 첨부되지 않습니다.</p><label class="opt"><input type="checkbox" name="consent" required> 위 내용을 확인했으며 피드백 전달에 동의합니다.</label><button class="primary" type="submit">' + (busy ? '처리 중…' : '피드백 보내기') + '</button></fieldset></form>' : '')
      + (active ? '<div class="fb-heading"><h3>' + (adminView ? '전체 피드백' : '내 피드백') + '</h3><label>상태 <select id="fbFilter"><option value="">전체</option>' + statuses.map(s => '<option ' + (filter === s ? 'selected' : '') + '>' + s + '</option>').join('') + '</select></label></div><p class="hint">불러온 ' + rows.length + '건 중 ' + visible.length + '건 표시' + (more ? ' · 더 불러올 피드백이 있습니다.' : '') + '</p><div class="fb-list">' + (visible.length ? visible.map(r => '<article class="fb-item"><div class="fb-heading"><h4>' + esc(r.title) + '</h4>' + statusHtml(r.status) + '</div><p class="hint">' + esc(r.category) + ' · 접수 ' + esc(date(r.createdAt)) + (adminView ? ' · ' + esc(r.authorEmail) : '') + '</p><p class="fb-text">' + esc(r.body) + '</p>' + (adminView ? '<form data-fb-item="' + esc(r.name) + '"><label class="f">처리 상태<select name="status">' + statuses.map(s => '<option ' + (s === r.status ? 'selected' : '') + '>' + s + '</option>').join('') + '</select></label><label class="f">답변<textarea name="reply" rows="3" maxlength="3000">' + esc(r.reply) + '</textarea></label><button type="submit" ' + (busy ? 'disabled' : '') + '>변경 저장</button></form>' : r.reply ? '<div class="infobox"><b>관리자 답변</b><p class="fb-text">' + esc(r.reply) + '</p></div>' : '<p class="hint">관리자 답변을 기다리고 있습니다.</p>') + '<p class="hint">최근 변경 ' + esc(date(r.updatedAt)) + '</p></article>').join('') : '<p class="hint">' + (filter ? '이 상태의 피드백이 없습니다.' : '아직 접수된 피드백이 없습니다.') + '</p>') + '</div>' + (more ? '<button type="button" id="fbMore" ' + (busy ? 'disabled' : '') + '>더 불러오기</button>' : '') : '') + '</div>';
    $('#fbRefresh').onclick = () => open(adminView);
    if ($('#fbFilter')) $('#fbFilter').onchange = e => { filter = e.target.value; render(); };
    if ($('#fbMore')) $('#fbMore').onclick = () => action(() => load(true));
    if ($('#fbForm')) {
      const f = $('#fbForm');
      f.oninput = e => { draft = {title:f.elements.title.value, body:f.elements.body.value, category:f.elements.category.value}; if (e.target.name !== 'consent') submitId = null; };
      f.onsubmit = e => { e.preventDefault(); submit(f); };
    }
    box.querySelectorAll('[data-fb-item]').forEach(f => f.onsubmit = e => { e.preventDefault(); update(f); });
  }
  async function action(fn) {
    if (busy) return;
    const epoch = generation; busy = true; message = ''; render();
    try { await fn(); } catch (e) { if (epoch === generation) message = e.message || '요청에 실패했습니다.'; }
    finally { if (epoch === generation) { busy = false; render(); } }
  }
  function submit(f) {
    if (!f.reportValidity()) return;
    const title = f.elements.title.value.trim(), body = f.elements.body.value.trim(), category = f.elements.category.value;
    if (!title || !body) { message = '제목과 내용을 입력해 주세요.'; render(); return; }
    return action(async () => {
      const s = await authenticate();
      // Retain the ID on uncertain network failures: retry cannot create duplicate records.
      if (!submitId) submitId = crypto.randomUUID();
      const fields = {authorId:str(s.uid), authorEmail:str(s.email), title:str(title), body:str(body), category:str(category), status:str('접수'), reply:str('')};
      await db(':commit', {writes:[{update:{name:root + '/feedback/' + submitId, fields}, currentDocument:{exists:false}, updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}]}, s);
      if (!stillCurrent(s)) return;
      draft = {title:'',body:'',category:categories[0]}; submitId = null;
      message = '피드백이 접수되었습니다.';
      await load(false);
    });
  }
  function update(f) {
    const status = f.elements.status.value, reply = f.elements.reply.value.trim();
    const row = rows.find(r => r.name === f.dataset.fbItem);
    if (!row || !statuses.includes(status) || reply.length > 3000) return;
    return action(async () => {
      const s = await authenticate();
      if (!s.admin) throw new Error('관리자만 상태를 변경할 수 있습니다.');
      await db(':commit', {writes:[{update:{name:row.name,fields:{status:str(status),reply:str(reply)}}, updateMask:{fieldPaths:['status','reply']}, currentDocument:{updateTime:row.version}, updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}]}, s);
      message = '처리 상태와 답변을 저장했습니다.';
      await load(false);
    });
  }
  async function open(admin) {
    if (busy) return;
    $(admin ? '#tab-feedback' : '#tab-feedback-admin').innerHTML = '';
    adminView = !!admin; rows = []; cursor = null; more = false;
    return action(() => load(false));
  }
  function signOut() {
    generation++; session = null; pending = null; rows = []; cursor = null; more = false; busy = false;
    draft = {title:'',body:'',category:categories[0]}; submitId = null; message = '';
    $('[data-tab="feedback-admin"]').hidden = true;
    $('#tab-feedback-admin').innerHTML = ''; $('#tab-feedback').innerHTML = '';
  }
  window.FEEDBACK = {open, signOut};
  // Check role after calendar boot so the management tab is visible to the administrator.
  if (ready() && valid()) authenticate().catch(() => {});
  const style = document.createElement('style');
  style.textContent = '.fb-wrap{max-width:940px;margin:auto}.fb-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.fb-heading h2,.fb-heading h3,.fb-heading h4{margin:8px 0}.fb-wrap fieldset{border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0}.fb-wrap .f{margin-bottom:12px}.fb-wrap .opt{margin:12px 0}.fb-wrap a{overflow-wrap:anywhere}.fb-item{border-top:1px solid var(--line);padding:16px 0;overflow-wrap:anywhere}.fb-text{white-space:pre-wrap;overflow-wrap:anywhere}.fb-status{display:inline-block;padding:4px 10px;border-radius:20px;font-weight:700;font-size:13px}.fb-0{background:#e3ecff;color:#1d4ed8}.fb-1{background:#fff3d6;color:#805300}.fb-2{background:#e6f4ea;color:#1e6b3a}.fb-wrap input,.fb-wrap select,.fb-wrap textarea{max-width:100%;box-sizing:border-box}.fb-wrap fieldset:disabled{opacity:.65}';
  document.head.appendChild(style);
})();
