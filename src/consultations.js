/* Explicit encrypted consultation saves. No plaintext persistence or automatic upload. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s), clone = x => structuredClone(x);
  let strokes = [], active = null, tool = 'pen', color = '#183f35', width = 3;
  let records = [], scope = '', selected = '', epoch = 0, busy = false, listOpen = false, boardOpen = false;
  let database;
  const UUID = /^[a-f0-9-]{36}$/;
  function db() {
    if (!database) database = new Promise((resolve, reject) => {
      const req = indexedDB.open('vhm-consultations-v1', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('records', {keyPath:'id'}); req.result.createObjectStore('counters'); };
      req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result); };
      req.onerror = () => { database = null; reject(new Error('기기 저장소를 열지 못했습니다. 브라우저 저장 권한을 확인하세요.')); };
      req.onblocked = () => reject(new Error('다른 창이 저장소를 사용 중입니다. 다른 창을 닫고 다시 시도하세요.'));
    }).catch(error => { database = null; throw error; });
    return database;
  }
  async function listLocal(owner) {
    const connection = await db();
    return new Promise((resolve, reject) => {
      const tx = connection.transaction('records'), req = tx.objectStore('records').getAll();
      tx.oncomplete = () => resolve(req.result.filter(r => r.scope === owner).sort((a,b) => a.slot-b.slot));
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('저장 목록을 읽지 못했습니다.'));
    });
  }
  async function insert(entry) {
    const connection = await db();
    return new Promise((resolve, reject) => {
      const tx = connection.transaction(['records','counters'],'readwrite'), store = tx.objectStore('records'), counters = tx.objectStore('counters');
      let result;
      const prior = store.get(entry.id);
      prior.onsuccess = () => {
        if (prior.result) {
          if (prior.result.scope !== entry.scope || prior.result.encrypted !== entry.encrypted) { tx.abort(); return; }
          result = prior.result; return;
        }
        const count = counters.get(entry.scope);
        count.onsuccess = () => { const slot = (+count.result || 0) + 1; result = {...entry,slot}; store.add(result); counters.put(slot,entry.scope); };
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('기기 저장에 실패했습니다. 공간 부족 또는 동일 ID의 다른 자료를 확인하세요. 기존 저장은 유지됩니다.'));
    });
  }
  async function removeLocal(id, owner) {
    const connection = await db();
    return new Promise((resolve,reject) => {
      const tx = connection.transaction('records','readwrite'), store = tx.objectStore('records'), req = store.get(id);
      req.onsuccess = () => { if (req.result?.scope === owner) store.delete(id); };
      tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error || new Error('기기 저장 삭제에 실패했습니다.'));
    });
  }
  function validate(record) {
    if (!record || record.schema !== 1 || !UUID.test(record.id) || !Number.isFinite(Date.parse(record.created)) || !Array.isArray(record.strokes) || record.strokes.length > 2000) throw new Error('저장 메모 형식이 올바르지 않습니다.');
    NOTES.validateSaved(record.note);
    let count = 0;
    for (const s of record.strokes) {
      if (!['pen','erase'].includes(s.tool) || !['#183f35','#b42318','#1d4ed8'].includes(s.color) || !Number.isFinite(s.width) || s.width < 1 || s.width > 24 || !Array.isArray(s.points) || !s.points.length) throw new Error('손글씨 형식이 올바르지 않습니다.');
      for (const p of s.points) { if (!Array.isArray(p) || p.length !== 2 || !p.every(x => Number.isFinite(x) && x >= 0 && x <= 1)) throw new Error('필기 좌표가 올바르지 않습니다.'); }
      count += s.points.length;
    }
    if (count > 30000) throw new Error('필기 점이 너무 많습니다. 30,000점까지 저장할 수 있습니다.');
    return record;
  }
  function paintBoard() {
    const canvas = $('#consultCanvas'); if (!canvas) return;
    const c = canvas.getContext('2d'); c.clearRect(0,0,canvas.width,canvas.height);
    for (const s of strokes) {
      c.globalCompositeOperation = s.tool === 'erase' ? 'destination-out' : 'source-over'; c.strokeStyle = s.color; c.fillStyle = s.color;
      c.lineWidth = s.width; c.lineCap = 'round'; c.lineJoin = 'round';
      const points = s.points.map(([x,y]) => [x*1000,y*600]);
      c.beginPath(); c.moveTo(...points[0]); for (const p of points.slice(1)) c.lineTo(...p); c.stroke();
      if (points.length === 1) { c.beginPath(); c.arc(...points[0],s.width/2,0,Math.PI*2); c.fill(); }
    }
    c.globalCompositeOperation = 'source-over';
  }
  function bindBoard() {
    const canvas = $('#consultCanvas'); if (!canvas) return;
    const point = e => { const r = canvas.getBoundingClientRect(); return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))]; };
    canvas.onpointerdown = e => {
      if (busy || active || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (strokes.length >= 2000 || strokes.reduce((n,s)=>n+s.points.length,0) >= 30000) return toast('필기 한도에 도달했습니다. 저장하거나 지운 뒤 계속하세요.');
      e.preventDefault(); canvas.setPointerCapture(e.pointerId); active = {id:e.pointerId,stroke:{tool,color,width:tool==='erase'?18:width,points:[point(e)]}}; strokes.push(active.stroke); paintBoard();
    };
    canvas.onpointermove = e => {
      if (!active || active.id !== e.pointerId) return; e.preventDefault();
      if (strokes.reduce((n,s)=>n+s.points.length,0) >= 30000) return;
      active.stroke.points.push(point(e)); paintBoard();
    };
    canvas.onpointerup = canvas.onpointercancel = e => { if (active?.id === e.pointerId) active = null; };
    canvas.onlostpointercapture = () => { active = null; };
    paintBoard();
  }
  function paintList() {
    const container = $('#consultList'); if (!container) return;
    const memoList = $('#consultMemoList');
    if (memoList) {
      memoList.replaceChildren(); memoList.hidden = !listOpen;
      if (listOpen && !records.length) memoList.textContent = scope ? '이 기기에 저장한 메모가 없습니다.' : '잠금을 풀고 저장 목록을 열어 주세요.';
      if (listOpen && scope) for (const record of records) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = '저장'+record.slot;
        button.setAttribute('aria-label','저장'+record.slot+' 상담메모 열기'); button.disabled = busy;
        button.onclick = () => runAction(()=>load(record)); memoList.append(button);
      }
    }
    container.replaceChildren(); container.hidden = !listOpen;
    if (!listOpen) return;
    if (!scope) { container.textContent = '잠금을 풀고 저장 목록을 열어 주세요.'; return; }
    if (!records.length) { container.textContent = '이 기기에 저장한 메모가 없습니다.'; return; }
    for (const record of records) {
      const row = document.createElement('div'); row.className = 'row'; row.style.cssText = 'gap:6px;margin:8px 0;flex-wrap:wrap';
      const label = document.createElement('b'); label.textContent = '저장'+record.slot; row.append(label);
      const date = document.createElement('span'); date.className = 'hint'; date.textContent = new Date(record.created).toLocaleString('ko-KR'); row.append(date);
      for (const [label,action] of [['열기',()=>load(record)],['Drive에 복사',()=>copy(record)],['이 기기에서 삭제',()=>drop(record)]]) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'small'; b.textContent = label; b.disabled = busy; b.onclick = () => runAction(action); row.append(b);
      }
      container.append(row);
    }
  }
  function mount() {
    const box = $('#consultationTools'); if (!box) return;
    active = null;
    box.innerHTML = '<div class="card" style="padding:12px;margin:10px 0"><div class="row" style="flex-wrap:wrap;gap:8px"><b>상담메모 저장·손글씨</b><button type="button" class="primary" id="consultSave">새로 저장</button><button type="button" id="consultShow">저장 목록</button><button type="button" id="consultImport">Drive에서 불러오기</button><button type="button" id="consultConnect" hidden>Drive 연결 (작성 내용 초기화)</button></div><p class="hint" id="consultStatus" role="status" style="margin:8px 0"></p><p class="hint">저장1, 저장2…로 이 기기에 암호화 보관합니다. 다른 기기에서 쓰려면 저장 목록에서 Drive에 복사하세요. 자동 저장·업로드는 하지 않습니다. 잠금·로그아웃 전 저장하세요.</p><div id="consultList"></div><details id="consultBoard"><summary>손글씨 필기판 열기</summary><div class="row" style="margin:8px 0;flex-wrap:wrap"><button type="button" id="consultPen">펜</button><button type="button" id="consultEraser">지우개</button><label>색상 <select id="consultColor" aria-label="펜 색상"><option value="#183f35">검정</option><option value="#b42318">빨강</option><option value="#1d4ed8">파랑</option></select></label><label>굵기 <select id="consultWidth" aria-label="펜 굵기"><option value="3">가는 펜</option><option value="6">굵은 펜</option></select></label><button type="button" id="consultUndo">한 획 취소</button><button type="button" id="consultEraseAll">필기 지우기</button></div><canvas id="consultCanvas" width="1000" height="600" aria-label="손글씨 필기판: 마우스·펜·터치로 작성" style="display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:8px;background:#fff;touch-action:none"></canvas><p class="hint">메모와 필기를 함께 저장합니다. 손글씨는 필기 모양대로 보관합니다.</p></details></div>';
    $('#consultBoard').open = boardOpen; $('#consultBoard').ontoggle = e => { boardOpen = e.target.open; };
    $('#consultColor').value = color; $('#consultWidth').value = String(width);
    $('#consultColor').onchange = e => { color = e.target.value; };
    $('#consultWidth').onchange = e => { width = +e.target.value; };
    const paintTool = () => { for (const [id,value] of [['#consultPen','pen'],['#consultEraser','erase']]) { $(id).setAttribute('aria-pressed',String(tool === value)); $(id).classList.toggle('primary',tool === value); } };
    $('#consultPen').onclick = () => { tool = 'pen'; paintTool(); status('펜을 선택했습니다.'); };
    $('#consultEraser').onclick = () => { tool = 'erase'; paintTool(); status('지우개를 선택했습니다.'); };
    paintTool();
    $('#consultUndo').onclick = () => { if (!busy) { active = null; strokes.pop(); paintBoard(); } };
    $('#consultEraseAll').onclick = () => { if (!busy && confirm('현재 손글씨를 모두 지울까요? 저장된 메모는 유지됩니다.')) { strokes = []; active = null; paintBoard(); } };
    $('#consultSave').onclick = () => runAction(save);
    $('#consultShow').onclick = () => runAction(show);
    $('#consultImport').onclick = () => runAction(importDrive);
    const memoTools = $('#consultationMemoTools');
    if (memoTools) {
      memoTools.innerHTML = '<div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap"><button type="button" class="primary" id="consultMemoSave">상담메모 새로 저장</button><button type="button" id="consultMemoShow">저장한 메모 열기</button></div><p class="hint" style="margin:6px 0">이 입력란의 문장·체크 항목·손글씨를 저장1, 저장2…로 함께 보관합니다. 직접 고친 문장도 그대로 저장합니다.</p><p class="hint" id="consultMemoStatus" role="status" style="margin:6px 0"></p><div id="consultMemoList" class="row" style="gap:6px;flex-wrap:wrap" aria-label="저장된 상담메모 선택" hidden></div>';
      $('#consultMemoSave').onclick = () => runAction(save);
      $('#consultMemoShow').onclick = () => runAction(show);
    }
    $('#consultConnect').hidden = !!(window.VHM_AUTH && VHM_AUTH.hasDrive);
    $('#consultConnect').onclick = () => VHM_AUTH.request('drive').catch(e=>toast(e.message||e));
    status(selected ? selected+'을 열었습니다. 수정 후 새로 저장하면 원본을 보존합니다.' : '직접 저장한 내용만 보관합니다.');
    setBusy(busy); paintList(); bindBoard();
  }
  function status(text) { for (const id of ['#consultStatus','#consultMemoStatus']) if ($(id)) $(id).textContent = text; }
  function setBusy(value) { busy = value; for (const s of ['#consultSave','#consultShow','#consultMemoSave','#consultMemoShow','#consultImport','#consultUndo','#consultEraseAll']) if ($(s)) $(s).disabled = value; paintList(); }
  async function runAction(action) {
    if (busy) return; setBusy(true);
    try { await action(); } catch (e) { status(e.message || String(e)); toast(e.message || String(e),7000); }
    finally { setBusy(false); }
  }
  async function unlocked() {
    if (!SERVER.isOpen() && !(await MEMOLOCK.openNow('상담메모와 필기는 메모 잠금 암호로 암호화하여 저장합니다.'))) return false;
    scope = await SERVER.consultationScope(); return true;
  }
  async function show() {
    const version = epoch; if (!(await unlocked()) || version !== epoch) return;
    records = await listLocal(scope); if (version !== epoch) return;
    listOpen = true; paintList(); status('이 기기에 저장된 메모 '+records.length+'개');
  }
  async function save() {
    const version = epoch;
    const record = validate({schema:1,id:crypto.randomUUID(),created:new Date().toISOString(),note:NOTES.snapshot(),strokes:clone(strokes)});
    if (!record.note.out.trim() && !record.strokes.length && !Object.keys(record.note.pick || {}).length && !Object.values(record.note.lead || {}).some(Boolean)) throw new Error('상담 내용이나 손글씨를 작성하세요.');
    if (!(await unlocked()) || version !== epoch) return;
    const sealed = await SERVER.sealConsultation(record); if (version !== epoch || !SERVER.isOpen()) return;
    const entry = await insert({id:record.id,created:record.created,...sealed});
    if (version !== epoch) return;
    records = await listLocal(scope); listOpen = true; selected = '저장'+entry.slot; paintList(); status(selected+' 기기 저장 완료. 다른 기기에서 쓰려면 Drive에 복사하세요.');
  }
  async function load(entry) {
    const version = epoch; if (!(await unlocked()) || version !== epoch || entry.scope !== scope) return;
    const record = validate(await SERVER.openConsultation(entry.encrypted)); if (version !== epoch) return;
    if (!confirm('현재 작성 중인 내용 대신 저장'+entry.slot+'을 열까요? 필요한 내용은 먼저 저장하세요.')) return;
    strokes = clone(record.strokes); selected = '저장'+entry.slot; boardOpen = strokes.length > 0;
    NOTES.restoreSaved(record.note); status(selected+'을 열었습니다. 수정 후 새로 저장하면 원본은 보존됩니다.');
  }
  async function copy(entry) {
    const version = epoch; if (!(await unlocked()) || version !== epoch || entry.scope !== scope) return;
    if (!VHM_AUTH.hasDrive) throw new Error('Drive 연결이 필요합니다. 기기 저장 후 Drive 연결 버튼을 눌러 주세요.');
    await SERVER.copyConsultation(entry.id,entry.encrypted);
    if (version === epoch) status('저장'+entry.slot+' Drive 복사 완료. 다른 기기에서 같은 계정으로 불러올 수 있습니다.');
  }
  async function drop(entry) {
    const version = epoch; if (!(await unlocked()) || version !== epoch || entry.scope !== scope) return;
    if (!confirm('저장'+entry.slot+'을 이 기기에서 삭제할까요? Drive 복사본은 유지됩니다.')) return;
    await removeLocal(entry.id,scope); if (version !== epoch) return;
    records = await listLocal(scope); paintList(); status('이 기기에서 삭제했습니다. Drive 복사본은 유지됩니다.');
  }
  async function importDrive() {
    const version = epoch; if (!(await unlocked()) || version !== epoch) return;
    if (!VHM_AUTH.hasDrive) throw new Error('Drive 연결 후 다시 누르세요. 연결 전 현재 내용을 먼저 저장하세요.');
    const files = await SERVER.listConsultations(); let added = 0, failed = 0;
    const imported = [];
    const have = new Set((await listLocal(scope)).map(x=>x.id));
    for (const file of files) {
      if (version !== epoch || !SERVER.isOpen()) return;
      try {
        const encrypted = await SERVER.fetchConsultation(file.id), record = validate(await SERVER.openConsultation(encrypted));
        if (version !== epoch) return;
        imported.push({id:record.id,scope,created:record.created,encrypted});
      } catch (_) { failed++; }
    }
    imported.sort((a,b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
    for (const entry of imported) {
      if (version !== epoch || !SERVER.isOpen()) return;
      try { await insert(entry); if (!have.has(entry.id)) { added++; have.add(entry.id); } } catch (_) { failed++; }
    }
    if (version !== epoch) return;
    records = await listLocal(scope); listOpen = true; paintList(); status('Drive에서 '+added+'개 추가 · 중복은 유지'+(failed ? ' · '+failed+'개 읽기 실패(기존 저장 보존)' : ''));
  }
  function clearDraft() { epoch++; strokes = []; active = null; selected = ''; paintBoard(); status('현재 내용만 지웠습니다. 저장 목록은 유지됩니다.'); }
  function lock() { epoch++; strokes = []; active = null; records = []; scope = ''; selected = ''; listOpen = false; boardOpen = false; if (window.NOTES) NOTES.clearContent(); paintBoard(); paintList(); status('잠겼습니다. 저장 메모는 잠금을 푼 뒤 열 수 있습니다.'); }
  window.CONSULTATIONS = {mount,clearDraft,lock,validate,_listLocal:listLocal};
  if ($('#consultationTools')) mount();
})();
