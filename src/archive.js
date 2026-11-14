/* =====================================================================
 * 보관함 (임시 보관함을 일정 사이트 안으로 옮김 — 원본: archive.html, 다른 대화에서 제작)
 * - 같은 구글 계정으로 어디서든 파일을 올리고 내려받음. 올린 뒤 7일이 지나면 삭제
 * - 저장 위치: 본인 구글 드라이브 '방문건강관리 임시보관함' 폴더 (이 앱이 만든 파일만 접근, drive.file)
 * - 로그인은 사이트와 같은 방식(페이지 이동). 드라이브 권한은 연계 안내와 같은 권한을 씀
 * ===================================================================== */
(function () {
  'use strict';
  const API = 'https://www.googleapis.com/drive/v3', UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  const FOLDER_NAME = '방문건강관리 임시보관함', DAY = 864e5, KEEP = 7 * DAY;
  const MAX_FILE = 2 * 1024 * 1024 * 1024, CHUNK = 8 * 1024 * 1024;   // 파일당 2GB, 8MB씩(256KB의 배수)
  const A = { folderId: null, files: [], busy: 0, built: false, timer: null };
  const el = id => document.getElementById(id);
  const escH = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function fmtSize(n) { n = Number(n) || 0; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return (i ? n.toFixed(n >= 100 ? 0 : 1).replace(/\.0$/, '') : n) + ' ' + u[i]; }
  function fmtDate(ms) { const d = new Date(ms), p = x => String(x).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function expOf(f) { const e = f.appProperties && Number(f.appProperties.vhm_exp); return e > 0 ? e : new Date(f.createdTime).getTime() + KEEP; }
  function leftTxt(ms) { if (ms <= 0) return '만료됨'; const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60); if (d >= 1) return d + '일 ' + h + '시간 남음'; if (h >= 1) return h + '시간 ' + (m % 60) + '분 남음'; return Math.max(m, 1) + '분 남음'; }
  function msg(t, bad) { const m = el('arMsg'); if (m) { m.textContent = t || ''; m.className = 'ar-msg' + (bad ? ' ar-err' : ''); } }

  /* ---------- 연결 ---------- */
  const signedIn = () => !!(window.VHM_AUTH && VHM_AUTH.valid());
  const driveOk = () => !!(window.SERVER && SERVER.hasDrive && SERVER.hasDrive());
  function authed() {
    if (!signedIn()) { const e = new Error('구글 연결 시간이 지났습니다. 위의 ‘구글 계정으로 연결’을 눌러 주세요.'); e.authNeeded = true; throw e; }
    return { Authorization: 'Bearer ' + VHM_AUTH.token };
  }
  async function api(path, opt) {
    opt = opt || {}; opt.headers = Object.assign({}, authed(), opt.headers || {});
    const r = await fetch(API + path, opt);
    if (r.status === 401) { const e = new Error('구글 연결이 끊겼습니다. 다시 연결해 주세요.'); e.authNeeded = true; throw e; }
    if (!r.ok) { let t = ''; try { t = (await r.json()).error.message; } catch (e) {} throw new Error(t || ('HTTP ' + r.status)); }
    return r.status === 204 ? null : r.json();
  }

  /* ---------- 폴더·목록·정리 ---------- */
  async function findFolder() {
    const q = "name='" + FOLDER_NAME + "' and mimeType='application/vnd.google-apps.folder' and trashed=false";
    const r = await api('/files?q=' + encodeURIComponent(q) + '&fields=files(id)&pageSize=10');
    if (r.files.length) return r.files[0].id;
    return (await api('/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }) })).id;
  }
  async function loadList() {
    let out = [], pt = '';
    do {
      const q = "'" + A.folderId + "' in parents and trashed=false";
      const r = await api('/files?q=' + encodeURIComponent(q) + '&pageSize=1000&fields=nextPageToken,files(id,name,size,createdTime,appProperties)' + (pt ? '&pageToken=' + pt : ''));
      out = out.concat(r.files); pt = r.nextPageToken;
    } while (pt);
    A.files = out;
  }
  async function cleanup() {   // 만료 파일 영구 삭제 (올리기·내려받기 중에는 건드리지 않음)
    if (A.busy || !signedIn()) return;
    const now = Date.now(), gone = A.files.filter(f => expOf(f) <= now); let n = 0;
    for (const f of gone) { try { await api('/files/' + f.id, { method: 'DELETE' }); n++; } catch (e) { if (e.authNeeded) break; } }
    if (n) { A.files = A.files.filter(f => expOf(f) > now); const c = el('arClean'); if (c) c.textContent = '만료된 파일 ' + n + '개를 삭제했습니다. (' + fmtDate(Date.now()) + ')'; }
  }
  async function loadQuota() {
    try {
      const a = await api('/about?fields=storageQuota'); const lim = Number(a.storageQuota.limit), use = Number(a.storageQuota.usage);
      if (lim > 0) { el('arQuotaBar').hidden = false; el('arQuotaFill').style.width = Math.min(100, use / lim * 100) + '%'; el('arQuotaTxt').textContent = '내 구글 저장공간 ' + fmtSize(use) + ' 사용 / ' + fmtSize(lim) + ' (남은 용량 ' + fmtSize(lim - use) + ', 지메일·사진과 공유)'; }
      else el('arQuotaTxt').textContent = '내 구글 저장공간 ' + fmtSize(use) + ' 사용';
    } catch (e) {}
  }

  /* ---------- 화면 ---------- */
  function build() {
    if (A.built) return; A.built = true;
    el('tab-box').innerHTML = `
      <div class="card ar-card"><div class="card-body">
        <h2 style="margin:0 0 4px;font-size:18px">보관함</h2>
        <p class="hint" style="margin:0">집·사무실·휴대폰 어디서든 같은 구글 계정으로 올리고 내려받는 임시 보관함입니다. 올린 파일은 <b>업로드 후 7일이 지나면 자동 삭제</b>됩니다.</p>
      </div></div>
      <div class="warnbox ar-warn"><b>올리기 전에 확인하세요</b><br>대상자의 이름·주소·연락처·주민번호, 건강정보, 상담 내용이 들어 있는 파일은 올리지 마세요. 이 보관함은 본인의 개인 구글 드라이브(국외 서버)에 저장됩니다. 기관 업무자료를 개인 클라우드로 옮기는 것은 기관 정보보안 지침 위반이 될 수 있으니, 업무용은 분임정보보안담당관 확인 후 사용하세요.
        <label class="ar-ack"><input type="checkbox" id="arAck"> 위 내용을 확인했고, 개인정보·건강정보·업무상 비밀이 없는 파일만 올립니다.</label></div>
      <div class="card ar-card" id="arConnect" hidden><div class="card-body"><div class="row" style="gap:8px;flex-wrap:wrap">
        <button class="primary" id="arDrive">구글 드라이브 연결</button><span class="hint" id="arConnTxt">보관함은 구글 드라이브에 저장합니다. 이 앱이 만든 파일만 접근합니다(드라이브 전체 열람 불가).</span></div></div></div>
      <div id="arApp" hidden>
        <div class="card ar-card"><div class="card-body">
          <div id="arDrop" class="ar-drop off"><div>여기에 파일을 끌어 놓거나</div><div style="margin:8px 0"><button class="primary" id="arPick" disabled>파일 선택</button></div>
            <div class="hint">파일당 최대 ${fmtSize(MAX_FILE)} · 보관 기간 7일</div></div>
          <input type="file" id="arFile" multiple hidden><div id="arQueue"></div>
        </div></div>
        <div class="card ar-card"><div class="card-body">
          <div class="row" style="justify-content:space-between"><b>보관 중인 파일 <span id="arCnt" class="hint"></span></b><button id="arRefresh">새로고침</button></div>
          <div class="ar-quota" id="arQuotaBar" hidden><i id="arQuotaFill"></i></div><div class="hint" id="arQuotaTxt"></div>
          <div id="arList"></div><div class="hint" id="arClean"></div>
        </div></div>
      </div>
      <p id="arMsg" class="ar-msg"></p>
      <p class="hint">만료 파일은 이 탭을 열 때와 사이트가 열려 있는 동안 1분마다 영구 삭제합니다(휴지통 거치지 않음). 사이트를 오래 열지 않으면 삭제가 늦어질 수 있어도, 만료된 파일은 목록에서 숨기고 내려받기를 막습니다.</p>`;
    el('arAck').onchange = syncEnable;
    el('arPick').onclick = () => el('arFile').click();
    el('arFile').onchange = () => { addFiles(el('arFile').files); el('arFile').value = ''; };
    el('arRefresh').onclick = async () => { try { await loadList(); await cleanup(); renderList(); loadQuota(); } catch (e) { msg('실패: ' + e.message, true); } };
    el('arDrive').onclick = () => { try { sessionStorage.setItem('vhm-after-drive', 'box'); } catch (e) {} VHM_AUTH.request('drive'); };
    const drop = el('arDrop');
    ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); if (el('arAck').checked) drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => { if (!el('arAck').checked) { alert('먼저 위의 확인 칸을 체크하세요.'); return; } addFiles(e.dataTransfer.files); });
  }
  function syncEnable() { const on = el('arAck').checked && signedIn() && driveOk(); el('arPick').disabled = !on; el('arDrop').classList.toggle('off', !on); }
  function renderList() {
    const now = Date.now(), box = el('arList');
    const live = A.files.filter(f => expOf(f) > now).sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));
    el('arCnt').textContent = '(' + live.length + '개)';
    if (!live.length) { box.innerHTML = '<div class="hint" style="padding:10px 0">보관 중인 파일이 없습니다.</div>'; return; }
    box.innerHTML = live.map(f => { const ms = expOf(f) - now;
      return `<div class="ar-item" data-fid="${escH(f.id)}"><div class="ar-name">${escH(f.name)}</div>
        <div class="hint">${fmtSize(f.size)} · 올린 시각 ${fmtDate(new Date(f.createdTime).getTime())} · 삭제 예정 ${fmtDate(expOf(f))} · <span class="ar-left${ms < DAY ? ' soon' : ''}" data-exp="${expOf(f)}">${leftTxt(ms)}</span></div>
        <div class="row" style="gap:8px;margin-top:6px"><button class="primary small" data-ardl="${escH(f.id)}">내려받기</button><button class="danger small" data-ardel="${escH(f.id)}">삭제</button></div><div class="ar-prog"></div></div>`; }).join('');
  }
  function tick() {
    if (!A.built || !A.folderId) return;
    const now = Date.now(); let need = false;
    document.querySelectorAll('#tab-box [data-exp]').forEach(x => { const ms = Number(x.dataset.exp) - now; if (ms <= 0) need = true; else { x.textContent = leftTxt(ms); x.className = 'ar-left' + (ms < DAY ? ' soon' : ''); } });
    if (need || signedIn()) cleanup().then(renderList).catch(() => {});
  }

  async function remove(f) {
    if (!confirm('"' + f.name + '" 파일을 지금 영구 삭제할까요? 되돌릴 수 없습니다.')) return;
    try { await api('/files/' + f.id, { method: 'DELETE' }); A.files = A.files.filter(x => x.id !== f.id); renderList(); loadQuota(); }
    catch (e) { alert('삭제하지 못했습니다: ' + e.message); }
  }

  /* ---------- 내려받기 ---------- */
  async function download(f, btn) {
    if (expOf(f) <= Date.now()) { alert('보관 기간(7일)이 지나 내려받을 수 없습니다.'); await cleanup(); renderList(); return; }
    const pg = btn.closest('.ar-item').querySelector('.ar-prog');
    const size = Number(f.size) || 0, canStream = typeof window.showSaveFilePicker === 'function';
    if (!canStream && size > 700 * 1024 * 1024 && !confirm('이 브라우저는 큰 파일을 내려받을 때 메모리를 많이 씁니다(' + fmtSize(size) + '). 실패할 수 있습니다. 컴퓨터의 Edge·Chrome에서 받는 것을 권장합니다. 계속할까요?')) return;
    let writable = null; A.busy++; btn.disabled = true;
    try {
      if (canStream) { const handle = await window.showSaveFilePicker({ suggestedName: f.name }); writable = await handle.createWritable(); }
      const r = await fetch(API + '/files/' + f.id + '?alt=media', { headers: authed() });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const reader = r.body.getReader(), parts = []; let got = 0;
      const bar = document.createElement('progress'); bar.max = size || 1; bar.value = 0; pg.textContent = ''; pg.appendChild(bar);
      for (;;) { const x = await reader.read(); if (x.done) break; got += x.value.length; bar.value = got; if (writable) await writable.write(x.value); else parts.push(x.value); }
      if (writable) { await writable.close(); writable = null; }
      else { const url = URL.createObjectURL(new Blob(parts)), a = document.createElement('a'); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
      pg.textContent = '내려받기 완료 (' + fmtSize(got) + ')'; pg.className = 'ar-prog';
    } catch (e) {
      if (writable) { try { await writable.abort(); } catch (_) {} }
      pg.textContent = (e && e.name === 'AbortError') ? '' : '실패: ' + e.message; pg.className = 'ar-prog' + (pg.textContent ? ' ar-err' : '');
    } finally { A.busy--; btn.disabled = false; }
  }

  /* ---------- 올리기 (이어올리기 지원) ---------- */
  function addFiles(list) { if (!el('arAck').checked) { alert('먼저 위의 확인 칸을 체크하세요.'); return; } Array.prototype.forEach.call(list, f => uploadOne(f)); }
  function putChunk(url, blob, start, total, onp) {
    return new Promise((res, rej) => {
      const x = new XMLHttpRequest(); x.open('PUT', url);
      x.setRequestHeader('Content-Range', 'bytes ' + start + '-' + (start + blob.size - 1) + '/' + total);
      x.upload.onprogress = e => onp && onp(start + e.loaded);
      x.onload = () => res({ status: x.status, text: x.responseText }); x.onerror = () => rej(new Error('network')); x.ontimeout = () => rej(new Error('timeout'));
      x.send(blob);
    });
  }
  async function askOffset(url, total) {
    const r = await new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('PUT', url); x.setRequestHeader('Content-Range', 'bytes */' + total);
      x.onload = () => res({ status: x.status, range: x.getResponseHeader('Range'), text: x.responseText }); x.onerror = () => rej(new Error('network')); x.send(); });
    if (r.status === 200 || r.status === 201) return { done: true, text: r.text };
    const m = r.range && /bytes=0-(\d+)/.exec(r.range); return { done: false, offset: m ? Number(m[1]) + 1 : 0 };
  }
  async function uploadOne(file) {
    const row = document.createElement('div'); row.className = 'ar-item';
    row.innerHTML = `<div class="ar-name"></div><progress max="${file.size || 1}" value="0"></progress><div class="hint"></div>`;
    row.querySelector('.ar-name').textContent = file.name; el('arQueue').prepend(row);
    const bar = row.querySelector('progress'), st = row.querySelector('.hint');
    if (!file.size) { st.textContent = '빈 파일은 올릴 수 없습니다.'; st.className = 'ar-err'; bar.remove(); return; }
    if (file.size > MAX_FILE) { st.textContent = '파일당 최대 ' + fmtSize(MAX_FILE) + '까지 올릴 수 있습니다. (이 파일 ' + fmtSize(file.size) + ')'; st.className = 'ar-err'; bar.remove(); return; }
    A.busy++;
    try {
      const now = Date.now();
      const h = Object.assign({ 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': file.type || 'application/octet-stream', 'X-Upload-Content-Length': String(file.size) }, authed());
      const r = await fetch(UPLOAD + '?uploadType=resumable&fields=id', { method: 'POST', headers: h, body: JSON.stringify({ name: file.name, parents: [A.folderId], appProperties: { vhm_up: String(now), vhm_exp: String(now + KEEP) } }) });
      if (!r.ok) throw new Error('업로드 시작 실패 (HTTP ' + r.status + ')');
      const url = r.headers.get('Location'); if (!url) throw new Error('업로드 주소를 받지 못했습니다.');
      let offset = 0, last = null, fails = 0;
      const onp = p => { bar.value = p; st.textContent = fmtSize(p) + ' / ' + fmtSize(file.size) + ' (' + Math.floor(p / file.size * 100) + '%)'; };
      while (offset < file.size) {
        const end = Math.min(offset + CHUNK, file.size);
        try {
          const res = await putChunk(url, file.slice(offset, end), offset, file.size, onp);
          if (res.status === 308) { offset = end; fails = 0; }
          else if (res.status === 200 || res.status === 201) { last = res.text; offset = file.size; }
          else throw new Error('HTTP ' + res.status);
        } catch (e) {
          if (++fails > 5) throw e;
          await new Promise(z => setTimeout(z, 1500 * fails));
          const q = await askOffset(url, file.size); if (q.done) { last = q.text; offset = file.size; } else offset = q.offset;
        }
      }
      const id = JSON.parse(last).id;
      bar.value = file.size; st.textContent = '업로드 완료 · 7일 후 삭제됩니다.'; st.className = 'ar-ok';
      try { await api('/files/' + id + '?fields=id', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appProperties: { vhm_exp: String(Date.now() + KEEP) } }) }); } catch (e) {}   // 완료 시각 기준 7일
      await loadList(); renderList(); loadQuota();
    } catch (e) { st.textContent = '실패: ' + e.message; st.className = 'ar-err'; }
    finally { A.busy--; }
  }

  /* ---------- 열기 ---------- */
  async function open() {
    build(); syncEnable();
    const conn = el('arConnect'), app = el('arApp');
    if (!signedIn()) { conn.hidden = true; app.hidden = true; msg('먼저 화면 위의 ‘구글 계정으로 연결’을 눌러 주세요.'); return; }
    if (!driveOk()) { conn.hidden = false; app.hidden = true; msg(''); return; }
    conn.hidden = true; app.hidden = false; msg('');
    try {
      if (!A.folderId) A.folderId = await findFolder();
      await loadList(); await cleanup(); renderList(); loadQuota();
    } catch (e) { msg('목록을 불러오지 못했습니다: ' + e.message, true); }
    if (!A.timer) A.timer = setInterval(tick, 60000);
    syncEnable();
  }
  document.addEventListener('click', e => {
    const t = e.target.closest('#tab-box [data-ardl], #tab-box [data-ardel]'); if (!t) return;
    const f = A.files.find(x => x.id === (t.dataset.ardl || t.dataset.ardel)); if (!f) return;
    if (t.dataset.ardl) download(f, t); else remove(f);
  });
  window.addEventListener('beforeunload', e => { if (A.busy) { e.preventDefault(); e.returnValue = ''; } });
  function reset() { A.folderId = null; A.files = []; if (A.built) { const l = el('arList'); if (l) l.innerHTML = ''; } }
  window.ARCHIVE = { open, reset, busy: () => A.busy > 0, _state: A };
})();
