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
  const images = window.VHM_FEEDBACK_IMAGES;
  let attachments = [], preparing = false;
  const imageCache = new Map();
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
    if (!valid()) throw new Error('설정에서 Google 계정으로 연결한 뒤 이용해 주세요.');
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
    for (const [k,v] of Object.entries(d.fields || {})) r[k] = v.arrayValue ? (v.arrayValue.values || []).map(x => x.stringValue) : v.stringValue !== undefined ? v.stringValue : v.timestampValue;
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
  function previews() {
    return '<div class="fb-images">' + attachments.map(a => '<figure><img src="' + a.dataUrl + '" alt="첨부 이미지 미리보기" loading="lazy"><figcaption>' + esc(a.name) + '</figcaption><button type="button" data-fb-remove="' + a.id + '">삭제</button></figure>').join('') + '</div>';
  }
  function attachmentForm() {
    if (!images) return '';
    return '<div class="f"><label for="fbFiles">이미지 첨부 (선택 · 최대 3장)</label><input id="fbFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple ' + (preparing ? 'disabled' : '') + '><p class="hint">JPG·PNG·WebP, 원본 한 장당 10MB 이하. 전송 전에 크기를 줄입니다. 대상자 이름·연락처·건강정보가 보이는 이미지는 첨부하지 마세요.</p><p role="status" class="hint">' + (preparing ? '이미지를 준비하는 중…' : attachments.length + '/3장 선택') + '</p>' + previews() + '</div>';
  }
  function savedAttachments(row) {
    const ids = Array.isArray(row.imageIds) ? row.imageIds.filter(id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id)).slice(0,3) : [];
    if (!ids.length) return '';
    return '<div class="fb-saved-images"><b>첨부 이미지 ' + ids.length + '장</b><div class="fb-images">' + ids.map(id => {
      const key = row.name + '/images/' + id, cached = imageCache.get(key);
      return cached && images && images.safe(cached.dataUrl) ? '<figure><button type="button" data-fb-expand="' + esc(key) + '" aria-label="첨부 이미지 크게 보기"><img src="' + cached.dataUrl + '" alt="피드백 첨부 이미지" loading="lazy"></button><figcaption>' + esc(cached.name) + '</figcaption></figure>' : '<button type="button" data-fb-image="' + esc(key) + '">이미지 보기</button>';
    }).join('') + '</div></div>';
  }
  async function selectImages(files) {
    if (busy || preparing || !images) return;
    const selected = Array.from(files || []); if (!selected.length) return;
    if (attachments.length + selected.length > images.MAX_IMAGES) { message = '이미지는 최대 3장까지 첨부할 수 있습니다.'; render(); return; }
    const epoch = generation; preparing = true; message = ''; render();
    try {
      const prepared = await Promise.all(selected.map(images.prepare));
      if (epoch !== generation) return;
      attachments.push(...prepared); submitId = null;
    } catch(e) { if (epoch === generation) message = e.message || '이미지를 준비하지 못했습니다.'; }
    finally { if (epoch === generation) { preparing = false; render(); } }
  }
  function expandImage(key) {
    const cached = imageCache.get(key); if (!cached || !images.safe(cached.dataUrl)) return;
    let dialog = $('#fbImageDialog');
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.id = 'fbImageDialog';
      dialog.setAttribute('aria-label','첨부 이미지 크게 보기');
      dialog.innerHTML = '<div class="fb-heading"><b>첨부 이미지</b><button type="button">닫기</button></div><p></p><img alt="피드백 첨부 이미지">';
      document.body.appendChild(dialog); dialog.querySelector('button').onclick = () => dialog.close();
    }
    dialog.querySelector('p').textContent = cached.name;
    dialog.querySelector('img').src = cached.dataUrl; dialog.showModal();
  }
  async function loadImage(button) {
    if (button.disabled) return;
    const epoch = generation, key = button.dataset.fbImage;
    button.disabled = true; button.textContent = '이미지 불러오는 중…';
    try {
      const s = await authenticate();
      const data = await json('https://firestore.googleapis.com/v1/' + key, {headers:{Authorization:'Bearer ' + s.token}});
      if (epoch !== generation || !stillCurrent(s)) return;
      const image = decode(data);
      if (!images || !images.safe(image.dataUrl)) throw new Error('표시할 수 없는 이미지입니다.');
      imageCache.set(key,image);
      const figure = document.createElement('figure'), view = document.createElement('button'), img = document.createElement('img'), caption = document.createElement('figcaption');
      view.type = 'button'; view.setAttribute('aria-label','첨부 이미지 크게 보기'); view.onclick = () => expandImage(key);
      img.src = image.dataUrl; img.alt = '피드백 첨부 이미지'; caption.textContent = image.name;
      view.appendChild(img); figure.append(view,caption); button.replaceWith(figure);
    } catch(e) { if (epoch === generation) { button.disabled = false; button.textContent = '이미지 다시 불러오기'; const status = $(adminView ? '#tab-feedback-admin [role="status"]' : '#tab-feedback [role="status"]'); if (status) status.textContent = e.message || '이미지를 불러오지 못했습니다.'; } }
  }
  function render() {
    const box = $(adminView ? '#tab-feedback-admin' : '#tab-feedback');
    if (!box) return;
    const authed = stillCurrent(session), isAdmin = authed && session.admin;
    const active = authed && (!adminView || isAdmin);
    const visible = rows.filter(r => !filter || r.status === filter);
    box.innerHTML = '<div class="card fb-wrap"><div class="fb-heading"><div><h2>' + (adminView ? '피드백 관리' : '피드백') + '</h2><p class="hint">' + (adminView ? '사용자 의견을 확인하고 처리 상태와 답변을 남겨 주세요.' : '불편한 점이나 개선 의견을 남겨 주세요. 내가 보낸 의견과 처리 상태를 확인할 수 있습니다.') + '</p></div><button type="button" id="fbRefresh" ' + (busy ? 'disabled' : '') + '>새로고침</button></div>'
      + '<p class="hint">공유 주소: <a href="https://dltmdwo369-prog.github.io/vhm/">https://dltmdwo369-prog.github.io/vhm/</a></p>'
      + '<p role="status" aria-live="polite" class="infobox">' + esc(message || (busy ? '불러오는 중…' : !ready() ? '피드백 접수를 준비 중입니다. 관리자 연결 설정이 끝나면 사용할 수 있습니다.' : !valid() ? '설정에서 Google 계정으로 연결한 뒤 이용해 주세요.' : active ? (adminView ? '관리자 · ' : '') + session.email : '계정 확인 후 이용할 수 있습니다.')) + '</p>'
      + (!adminView ? '<form id="fbForm"><fieldset ' + (!active || busy ? 'disabled' : '') + '><legend>새 피드백</legend><label class="f">종류<select name="category">' + categories.map(c => '<option ' + (draft.category === c ? 'selected' : '') + '>' + c + '</option>').join('') + '</select></label><label class="f">제목<input name="title" required maxlength="100" value="' + esc(draft.title) + '" placeholder="어떤 점을 알려주시겠어요?"></label><label class="f">내용<textarea name="body" rows="6" required maxlength="3000" placeholder="문제가 생긴 화면과 동작, 개선 의견 등을 적어 주세요.">' + esc(draft.body) + '</textarea></label>' + attachmentForm() + '<p class="hint">작성한 제목·내용·첨부 이미지와 로그인 이메일이 관리자에게 전달됩니다. 대상자 이름·연락처·건강정보는 적지 마세요. 일정과 상담 메모는 첨부되지 않습니다.</p><label class="opt"><input type="checkbox" name="consent" required> 위 내용을 확인했으며 피드백 전달에 동의합니다.</label><button class="primary" type="submit" ' + (preparing ? 'disabled' : '') + '>' + (busy ? '처리 중…' : '피드백 보내기') + '</button></fieldset></form>' : '')
      + (active ? '<div class="fb-heading"><h3>' + (adminView ? '전체 피드백' : '내 피드백') + '</h3><label>상태 <select id="fbFilter"><option value="">전체</option>' + statuses.map(s => '<option ' + (filter === s ? 'selected' : '') + '>' + s + '</option>').join('') + '</select></label></div><p class="hint">불러온 ' + rows.length + '건 중 ' + visible.length + '건 표시' + (more ? ' · 더 불러올 피드백이 있습니다.' : '') + '</p><div class="fb-list">' + (visible.length ? visible.map(r => '<article class="fb-item"><div class="fb-heading"><h4>' + esc(r.title) + '</h4>' + statusHtml(r.status) + '</div><p class="hint">' + esc(r.category) + ' · 접수 ' + esc(date(r.createdAt)) + (adminView ? ' · ' + esc(r.authorEmail) : '') + '</p><p class="fb-text">' + esc(r.body) + '</p>' + savedAttachments(r) + (adminView ? '<form data-fb-item="' + esc(r.name) + '"><label class="f">처리 상태<select name="status">' + statuses.map(s => '<option ' + (s === r.status ? 'selected' : '') + '>' + s + '</option>').join('') + '</select></label><label class="f">답변<textarea name="reply" rows="3" maxlength="3000">' + esc(r.reply) + '</textarea></label><button type="submit" ' + (busy ? 'disabled' : '') + '>변경 저장</button></form>' : r.reply ? '<div class="infobox"><b>관리자 답변</b><p class="fb-text">' + esc(r.reply) + '</p></div>' : '<p class="hint">관리자 답변을 기다리고 있습니다.</p>') + '<p class="hint">최근 변경 ' + esc(date(r.updatedAt)) + '</p></article>').join('') : '<p class="hint">' + (filter ? '이 상태의 피드백이 없습니다.' : '아직 접수된 피드백이 없습니다.') + '</p>') + '</div>' + (more ? '<button type="button" id="fbMore" ' + (busy ? 'disabled' : '') + '>더 불러오기</button>' : '') : '') + '</div>';
    $('#fbRefresh').onclick = () => open(adminView);
    if ($('#fbFilter')) $('#fbFilter').onchange = e => { filter = e.target.value; render(); };
    if ($('#fbMore')) $('#fbMore').onclick = () => action(() => load(true));
    if ($('#fbForm')) {
      const f = $('#fbForm');
      f.oninput = e => { draft = {title:f.elements.title.value, body:f.elements.body.value, category:f.elements.category.value}; if (e.target.name !== 'consent') submitId = null; };
      f.onsubmit = e => { e.preventDefault(); submit(f); };
      if ($('#fbFiles')) $('#fbFiles').onchange = e => selectImages(e.target.files);
      f.querySelectorAll('[data-fb-remove]').forEach(b => b.onclick = () => { attachments = attachments.filter(a => a.id !== b.dataset.fbRemove); submitId = null; render(); });
    }
    box.querySelectorAll('[data-fb-image]').forEach(b => b.onclick = () => loadImage(b));
    box.querySelectorAll('[data-fb-expand]').forEach(b => b.onclick = () => expandImage(b.dataset.fbExpand));
    box.querySelectorAll('[data-fb-item]').forEach(f => f.onsubmit = e => { e.preventDefault(); update(f); });
  }
  async function action(fn) {
    if (busy || preparing) return;
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
      if (attachments.length) fields.imageIds = {arrayValue:{values:attachments.map(a => str(a.id))}};
      const writes = [{update:{name:root + '/feedback/' + submitId, fields}, currentDocument:{exists:false}, updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}];
      for (const image of attachments) writes.push({update:{name:root + '/feedback/' + submitId + '/images/' + image.id,fields:{authorId:str(s.uid),name:str(image.name),dataUrl:str(image.dataUrl)}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]});
      await db(':commit', {writes}, s);
      if (!stillCurrent(s)) return;
      draft = {title:'',body:'',category:categories[0]}; submitId = null; attachments = [];
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
    if (busy || preparing) return;
    $(admin ? '#tab-feedback' : '#tab-feedback-admin').innerHTML = '';
    adminView = !!admin; rows = []; cursor = null; more = false;
    return action(() => load(false));
  }
  function signOut() {
    generation++; session = null; pending = null; rows = []; cursor = null; more = false; busy = false;
    draft = {title:'',body:'',category:categories[0]}; submitId = null; message = '';
    attachments = []; preparing = false; imageCache.clear();
    const dialog = $('#fbImageDialog'); if (dialog) { dialog.close(); dialog.remove(); }
    $('[data-tab="feedback-admin"]').hidden = true;
    $('#tab-feedback-admin').innerHTML = ''; $('#tab-feedback').innerHTML = '';
  }
  function hasWork() {
    return busy || preparing || attachments.length > 0 || !!(draft.title.trim() || draft.body.trim())
      || Array.from(document.querySelectorAll('[data-fb-item]')).some(f => {
        const row = rows.find(r => r.name === f.dataset.fbItem);
        return row && (f.elements.reply.value !== row.reply || f.elements.status.value !== row.status);
      });
  }
  window.FEEDBACK = {open, signOut, busy:hasWork};
  // Check role after calendar boot so the management tab is visible to the administrator.
  if (ready() && valid()) authenticate().catch(() => {});
  const style = document.createElement('style');
  style.textContent = `
    .fb-wrap{width:100%;max-width:940px;min-width:0;margin:auto;padding:24px;overflow:visible;box-sizing:border-box;line-height:1.65;overflow-wrap:anywhere}
    .fb-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;min-width:0}
    .fb-heading>div{flex:1 1 240px;min-width:0}
    .fb-heading h2,.fb-heading h3,.fb-heading h4{margin:0;line-height:1.5;white-space:normal;overflow-wrap:anywhere}
    .fb-heading .hint{margin:8px 0 0}
    .fb-wrap fieldset{min-inline-size:0;width:100%;border:1px solid var(--line);border-radius:10px;padding:16px;margin:20px 0 0}
    .fb-wrap legend{max-width:100%;padding:0 6px;white-space:normal;line-height:1.65}
    .fb-wrap .f{min-width:0;margin-bottom:16px;line-height:1.65}
    .fb-wrap .opt{display:flex;align-items:flex-start;gap:8px;margin:16px 0;line-height:1.65}
    .fb-wrap .opt input{flex:none;width:16px;height:16px;min-height:0;margin:4px 0 0;padding:0}
    .fb-wrap a{overflow-wrap:anywhere}
    .fb-item{min-width:0;border-top:1px solid var(--line);padding:20px 0;overflow-wrap:anywhere}
    .fb-text{white-space:pre-wrap;overflow-wrap:anywhere}
    .fb-status{display:inline-block;flex-shrink:0;padding:4px 10px;border-radius:20px;font-weight:700;font-size:13px;line-height:1.65}
    .fb-0{background:#e3ecff;color:#1d4ed8}.fb-1{background:#fff3d6;color:#805300}.fb-2{background:#e6f4ea;color:#1e6b3a}
    .fb-wrap input,.fb-wrap select,.fb-wrap textarea{min-width:0;max-width:100%;height:auto;box-sizing:border-box;line-height:1.65}
    .fb-wrap .f>input,.fb-wrap .f>select,.fb-wrap .f>textarea{width:100%;padding:9px 12px}
    .fb-wrap textarea{min-height:140px}
    .fb-wrap button{flex-shrink:0;max-width:100%;height:auto;min-height:40px;line-height:1.65;white-space:normal;overflow-wrap:anywhere}
    .fb-wrap fieldset:disabled{opacity:1}
    .fb-wrap fieldset:disabled :is(input,select,textarea){color:var(--sub);background:#f5f8f6;opacity:1}
    .fb-images{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:12px;margin:12px 0}
    .fb-images figure{min-width:0;margin:0;border:1px solid var(--line);border-radius:10px;padding:10px;overflow-wrap:anywhere}
    .fb-images img{display:block;max-width:100%;width:100%;height:140px;object-fit:contain;background:#f5f8f6}
    .fb-images figcaption{font-size:12px;line-height:1.6;margin:8px 0;overflow-wrap:anywhere}
    .fb-images figure>button:has(img){width:100%;padding:0;background:transparent}
    #fbImageDialog{max-width:min(94vw,1100px);max-height:92vh;padding:20px;overflow:auto;border:1px solid var(--line);border-radius:14px}
    #fbImageDialog img{display:block;max-width:100%;height:auto}#fbImageDialog p{overflow-wrap:anywhere}
    @media(max-width:560px){.fb-wrap{padding:18px 16px}.fb-wrap fieldset{padding:14px 12px}.fb-heading>div{flex-basis:100%}.fb-wrap .f>input,.fb-wrap .f>select,.fb-wrap .f>textarea{padding:8px 10px}}
  `;
  document.head.appendChild(style);
})();
