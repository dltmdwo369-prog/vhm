/* Explicit encrypted consultation saves. No plaintext persistence or automatic upload. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s), clone = x => structuredClone(x);
  let strokes = [], active = null, tool = 'pen', color = '#183f35', width = 3;
  let fingerEnabled = false, frame = 0, pointCount = 0;
  let records = [], scope = '', selected = '', epoch = 0, busy = false, listOpen = false, boardOpen = false;
  const SYNC_PREF = 'vhm-consultation-save-sync';
  let autoSync = true;
  try { autoSync = localStorage.getItem(SYNC_PREF) !== '0'; } catch (_) {}
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
      const tx = connection.transaction(['records','counters']), req = tx.objectStore('records').getAll(), del=tx.objectStore('counters').getAll();
      tx.oncomplete = () => {const ids=new Set(del.result.filter(d=>d?.type==='consultation-deletion'&&d.scope===owner).map(d=>d.id));resolve(req.result.filter(r => r.scope === owner&&!ids.has(r.id)).sort((a,b) => a.slot-b.slot));};
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('저장 목록을 읽지 못했습니다.'));
    });
  }
  async function getSaved(id,owner) {
    const connection = await db();
    return new Promise((resolve,reject) => {
      const tx = connection.transaction('records'), req = tx.objectStore('records').get(id);
      tx.oncomplete = () => resolve(req.result?.scope === owner ? req.result : null);
      tx.onabort = tx.onerror = () => reject(new Error('저장 메모를 읽지 못했습니다.'));
    });
  }
  async function insert(entry) {
    const connection = await db();
    return new Promise((resolve, reject) => {
      const tx = connection.transaction(['records','counters'],'readwrite'), store = tx.objectStore('records'), counters = tx.objectStore('counters');
      let result;
      const deleted=counters.get('deleted:'+entry.scope+':'+entry.id);
      deleted.onsuccess=()=>{if(deleted.result){tx.abort();return;}
      const prior = store.get(entry.id);
      prior.onsuccess = () => {
        if (prior.result) {
          if (prior.result.scope !== entry.scope || prior.result.encrypted !== entry.encrypted) { tx.abort(); return; }
          result = prior.result; return;
        }
        const count = counters.get(entry.scope);
        count.onsuccess = () => { const slot = (+count.result || 0) + 1; result = {...entry,slot}; store.add(result); counters.put(slot,entry.scope); };
      };
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('기기 저장에 실패했습니다. 공간 부족 또는 동일 ID의 다른 자료를 확인하세요. 기존 저장은 유지됩니다.'));
    });
  }
  async function applyDeletions(ids,owner) {
    const connection=await db();
    return new Promise((resolve,reject)=>{
      const tx=connection.transaction(['records','counters'],'readwrite'),store=tx.objectStore('records'),counters=tx.objectStore('counters');
      for(const id of ids){counters.put({type:'consultation-deletion',scope:owner,id},'deleted:'+owner+':'+id);const req=store.get(id);req.onsuccess=()=>{if(req.result?.scope===owner)store.delete(id);};}
      tx.oncomplete=()=>{if(window.SURVEYS)SURVEYS.deleted(ids);resolve();};tx.onabort=tx.onerror=()=>reject(new Error('기기 삭제 상태 저장에 실패했습니다. 다시 동기화하세요.'));
    });
  }
  async function deletionState(version,owner) {
    const markers=(await SERVER.listConsultationDeletions()).filter(d=>d.scope===owner),ids=new Set(markers.map(d=>d.id));
    if(version!==epoch||!SERVER.isOpen())return ids;
    if(ids.size){
      const active=await SERVER.listConsultations();
      for(const file of active){const m=/^vhm-consult-([a-f0-9-]{36})\.vhm$/.exec(file.name||'');if(m&&ids.has(m[1])){await SERVER.deleteConsultation(m[1],null,file.id);if(version!==epoch||!SERVER.isOpen())return ids;}}
      if(version===epoch&&SERVER.isOpen())await applyDeletions(ids,owner);
    }
    return ids;
  }
  async function markRemote(entry,remoteId) {
    if (typeof remoteId !== 'string' || !/^[\w-]{1,150}$/.test(remoteId)) throw new Error('Drive 저장 결과를 확인하지 못했습니다. 기기 원본은 유지됩니다.');
    const connection = await db();
    return new Promise((resolve,reject) => {
      const tx = connection.transaction('records','readwrite'), store = tx.objectStore('records'), req = store.get(entry.id);
      req.onsuccess = () => { const saved = req.result; if (saved && saved.scope === entry.scope && saved.encrypted === entry.encrypted) store.put({...saved,remoteId,remoteAt:new Date().toISOString()}); };
      tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error || new Error('Drive 저장 상태를 기기에 기록하지 못했습니다. 기기 원본은 유지됩니다.'));
    });
  }
  const driveReady = () => !!(window.VHM_AUTH?.hasDrive && VHM_AUTH.valid() && navigator.onLine !== false);
  function validate(record) {
    if (!record || record.schema !== 1 || !UUID.test(record.id) || !Number.isFinite(Date.parse(record.created)) || !Array.isArray(record.strokes) || record.strokes.length > 2000) throw new Error('저장 메모 형식이 올바르지 않습니다.');
    if (record.survey) { if (!window.SURVEYS) throw new Error('조사표 모듈을 불러오세요.'); SURVEYS.validate(record.survey); }
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
    if (frame) cancelAnimationFrame(frame); frame = 0;
    pointCount = strokes.reduce((n,s) => n+s.points.length,0);
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
    if (active) active.drawn = active.stroke.points.length;
  }
  function bindBoard() {
    const canvas = $('#consultCanvas'); if (!canvas) return;
    canvas.draggable = false;
    canvas.tabIndex = 0;
    canvas.style.cssText += ';user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-user-drag:none;touch-action:none;overscroll-behavior:contain';
    const point = e => { const r = canvas.getBoundingClientRect(); return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))]; };
    const prevent = e => { if (e.cancelable) e.preventDefault(); };
    const flush = () => {
      if (frame) cancelAnimationFrame(frame); frame = 0;
      if (!active || active.canvas !== canvas) return;
      const s = active.stroke, from = Math.max(0,active.drawn-1), c = canvas.getContext('2d');
      if (active.drawn >= s.points.length) return;
      c.globalCompositeOperation = s.tool === 'erase' ? 'destination-out' : 'source-over'; c.lineWidth = s.width; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = s.color;
      c.beginPath(); c.moveTo(s.points[from][0]*1000,s.points[from][1]*600);
      for (let k=from+1;k<s.points.length;k++) c.lineTo(s.points[k][0]*1000,s.points[k][1]*600);
      c.stroke(); c.globalCompositeOperation = 'source-over'; active.drawn = s.points.length;
    };
    const append = e => {
      let events = [];
      try { events = e.getCoalescedEvents ? e.getCoalescedEvents() : []; } catch (_) {}
      // Include the dispatch event too: Safari may omit its final position from the batch.
      for (const sample of [...events,e]) {
        if (pointCount >= 30000 || !Number.isFinite(sample.clientX) || !Number.isFinite(sample.clientY)) continue;
        const p = point(sample), last = active.stroke.points.at(-1);
        if (p[0] === last[0] && p[1] === last[1]) continue;
        active.stroke.points.push(p); pointCount++;
      }
    };
    const finish = (e, finalPoint) => {
      if (!active || active.id !== e.pointerId || active.canvas !== canvas) return;
      prevent(e); if (finalPoint) append(e); flush(); active = null;
      try { if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    canvas.addEventListener('pointerdown', e => {
      prevent(e);
      if (busy || (e.pointerType === 'touch' && !fingerEnabled) || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (active) {
        // A Pencil takes priority over a finger/palm that arrived first.
        if (e.pointerType !== 'pen' || active.type === 'pen') return;
        if (strokes.at(-1) === active.stroke) strokes.pop();
        try { active.canvas.releasePointerCapture(active.id); } catch (_) {}
        active = null; paintBoard();
      }
      if (strokes.length >= 2000 || pointCount >= 30000) return toast('필기 한도에 도달했습니다. 저장하거나 지운 뒤 계속하세요.');
      // Leave text editing/Scribble focus without scrolling or changing its content.
      try { canvas.focus({preventScroll:true}); window.getSelection()?.removeAllRanges(); } catch (_) {}
      active = {id:e.pointerId,type:e.pointerType,canvas,drawn:1,stroke:{tool,color,width:tool==='erase'?18:width,points:[point(e)]}};
      strokes.push(active.stroke); pointCount++;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      const c = canvas.getContext('2d'), s = active.stroke, p = s.points[0];
      c.globalCompositeOperation = s.tool === 'erase' ? 'destination-out' : 'source-over'; c.fillStyle = s.color;
      c.beginPath(); c.arc(p[0]*1000,p[1]*600,s.width/2,0,Math.PI*2); c.fill(); c.globalCompositeOperation = 'source-over';
    }, {passive:false});
    canvas.addEventListener('pointermove', e => {
      prevent(e); if (!active || active.id !== e.pointerId || active.canvas !== canvas) return;
      append(e); if (!frame) frame = requestAnimationFrame(flush);
    }, {passive:false});
    canvas.addEventListener('pointerup', e => finish(e,true), {passive:false});
    canvas.addEventListener('pointercancel', e => finish(e,false), {passive:false});
    canvas.addEventListener('lostpointercapture', e => finish(e,false));
    for (const event of ['touchstart','touchmove','touchend','contextmenu','dragstart','selectstart']) canvas.addEventListener(event,prevent,{passive:false});
    paintBoard();
  }
  function paintList() {
    const container = $('#consultList'); if (!container) return;
    if ($('#consultConnect')) $('#consultConnect').hidden = !!(window.VHM_AUTH?.hasDrive && VHM_AUTH.valid());
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
      const version=epoch; SERVER.openConsultation(record.encrypted).then(r=>{if(version===epoch&&SERVER.isOpen()&&row.isConnected&&r.survey){label.textContent='저장'+record.slot+' · '+r.survey.name+' · '+(window.VHM_SURVEYS.find(f=>f.id===r.survey.form)?.title||'조사표');}}).catch(()=>{});
      const syncLabel = document.createElement('span'); syncLabel.className = 'hint'; syncLabel.textContent = record.remoteId ? 'Drive 저장 확인' : autoSync ? '기기 저장 · 동기화 대기' : '기기 전용 저장'; row.append(syncLabel);
      const date = document.createElement('span'); date.className = 'hint'; date.textContent = new Date(record.created).toLocaleString('ko-KR'); row.append(date);
      for (const [label,action] of [['열기',()=>load(record)],['Drive에 복사',()=>copy(record)],['Drive에서도 삭제',()=>drop(record)]]) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'small'; b.textContent = label; b.disabled = busy; b.onclick = () => runAction(action); row.append(b);
      }
      container.append(row);
      if (window.PHIS) PHIS.addSavedRequestButton(row,record.id);
    }
  }
  function mount() {
    const box = $('#consultationTools'); if (!box) return;
    if (frame) cancelAnimationFrame(frame); frame = 0; active = null;
    box.innerHTML = '<div class="card" style="padding:12px;margin:10px 0"><div class="row" style="flex-wrap:wrap;gap:8px"><b>상담메모 저장·손글씨</b><button type="button" class="primary" id="consultSave">새로 저장</button><button type="button" id="consultShow">저장 목록</button><button type="button" id="consultImport">Drive에서 불러오기</button><button type="button" id="consultConnect" hidden>Drive 연결 (작성 내용 초기화)</button></div><p class="hint" id="consultStatus" role="status" style="margin:8px 0"></p><p class="hint">저장1, 저장2…로 이 기기에 암호화 보관합니다. Drive 연결과 저장 시 동기화가 켜져 있으면 저장 버튼을 누를 때 Drive에도 보관합니다. 기존 태블릿 메모는 이 기기에서 동기화를 한 번 실행하세요. 저장 목록을 열면 연결된 Drive 자료도 불러옵니다. 입력 중에는 저장·전송하지 않습니다. ‘Drive에서도 삭제’는 메모 원본을 영구 삭제합니다. 재생성 방지용 삭제 표식에는 메모 내용이 포함되지 않습니다.</p><div id="consultList"></div><details id="consultBoard"><summary>손글씨 필기판 열기</summary><p class="hint">Apple Pencil·마우스로 바로 작성하세요. 기본은 펜 전용으로 손바닥 터치를 무시합니다. 화면 밖에서는 평소처럼 스크롤할 수 있습니다.</p><label class="row" style="gap:6px;margin:8px 0"><input type="checkbox" id="consultFinger" style="width:auto"> 손가락으로도 쓰기 (터치 필기)</label><div class="row" style="margin:8px 0;flex-wrap:wrap"><button type="button" id="consultPen">펜</button><button type="button" id="consultEraser">지우개</button><label>색상 <select id="consultColor" aria-label="펜 색상"><option value="#183f35">검정</option><option value="#b42318">빨강</option><option value="#1d4ed8">파랑</option></select></label><label>굵기 <select id="consultWidth" aria-label="펜 굵기"><option value="3">가는 펜</option><option value="6">굵은 펜</option></select></label><button type="button" id="consultUndo">한 획 취소</button><button type="button" id="consultEraseAll">필기 지우기</button></div><canvas id="consultCanvas" width="1000" height="600" aria-label="손글씨 필기판: 마우스·펜·터치로 작성" style="display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:8px;background:#fff;touch-action:none"></canvas><p class="hint">메모와 필기를 함께 저장합니다. 손글씨는 필기 모양대로 보관합니다.</p></details></div>';
    $('#consultBoard').open = boardOpen; $('#consultBoard').ontoggle = e => { boardOpen = e.target.open; };
    $('#consultColor').value = color; $('#consultWidth').value = String(width);
    $('#consultFinger').checked = fingerEnabled;
    $('#consultFinger').onchange = e => { fingerEnabled = e.target.checked; if (active?.type === 'touch') { active = null; paintBoard(); } };
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
    const syncControls = document.createElement('div'); syncControls.className = 'row'; syncControls.style.cssText = 'flex-wrap:wrap;gap:8px;margin:8px 0';
    syncControls.innerHTML = '<button type="button" id="consultSync">태블릿·컴퓨터 동기화</button><label class="row" style="gap:6px"><input type="checkbox" id="consultAutoSync" style="width:auto"> 저장할 때 Drive에도 동기화</label>';
    box.querySelector('.card').insertBefore(syncControls,$('#consultStatus'));
    $('#consultSync').onclick = () => runAction(syncAll);
    $('#consultAutoSync').checked = autoSync;
    $('#consultAutoSync').onchange = e => { autoSync = e.target.checked; try { localStorage.setItem(SYNC_PREF,autoSync ? '1' : '0'); } catch (_) {} paintList(); status(autoSync ? '다음 저장부터 Drive 연결 시 함께 보관합니다. 기존 메모는 동기화 버튼으로 올릴 수 있습니다.' : '저장은 이 기기에만 합니다. 동기화 버튼은 별도로 사용할 수 있습니다.'); };
    const memoTools = $('#consultationMemoTools');
    if (memoTools) {
      memoTools.innerHTML = '<div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap"><button type="button" class="primary" id="consultMemoSave">상담메모 새로 저장</button><button type="button" id="consultMemoShow">저장한 메모 열기</button></div><p class="hint" style="margin:6px 0">이 입력란의 문장·체크 항목·손글씨를 저장1, 저장2…로 함께 보관합니다. 직접 고친 문장도 그대로 저장합니다. Drive 연결 시 상단의 저장 동기화 설정을 따릅니다.</p><p class="hint" id="consultMemoStatus" role="status" style="margin:6px 0"></p><div id="consultMemoList" class="row" style="gap:6px;flex-wrap:wrap" aria-label="저장된 상담메모 선택" hidden></div>';
      $('#consultMemoSave').onclick = () => runAction(save);
      $('#consultMemoShow').onclick = () => runAction(show);
      const sync = document.createElement('button'); sync.type = 'button'; sync.id = 'consultMemoSync'; sync.textContent = '태블릿·컴퓨터 동기화'; sync.onclick = () => runAction(syncAll); memoTools.querySelector('.row').append(sync);
    }
    $('#consultConnect').hidden = !!(window.VHM_AUTH && VHM_AUTH.hasDrive);
    $('#consultConnect').onclick = () => VHM_AUTH.request('drive').catch(e=>toast(e.message||e));
    status(selected ? selected+'을 열었습니다. 수정 후 새로 저장하면 원본을 보존합니다.' : '직접 저장한 내용만 보관합니다.');
    setBusy(busy); paintList(); bindBoard();
  }
  function status(text) { for (const id of ['#consultStatus','#consultMemoStatus']) if ($(id)) $(id).textContent = text; }
  function setBusy(value) { busy = value; for (const s of ['#consultSave','#consultShow','#consultMemoSave','#consultMemoShow','#consultSync','#consultMemoSync','#consultAutoSync','#consultImport','#consultUndo','#consultEraseAll']) if ($(s)) $(s).disabled = value; paintList(); }
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
    if (driveReady()) await importDrive();
  }
  async function save(survey = null) {
    const version = epoch;
    const record = validate({schema:1,id:crypto.randomUUID(),created:new Date().toISOString(),note:survey ? {tpl:NOTES._defaults(),pick:{},lead:{},out:''} : NOTES.snapshot(),strokes:survey ? [] : clone(strokes),...(survey ? {survey} : {})});
    if (!record.survey && !record.note.out.trim() && !record.strokes.length && !Object.keys(record.note.pick || {}).length && !Object.values(record.note.lead || {}).some(Boolean)) throw new Error('상담 내용이나 손글씨를 작성하세요.');
    if (!(await unlocked()) || version !== epoch) return;
    const sealed = await SERVER.sealConsultation(record); if (version !== epoch || !SERVER.isOpen()) return;
    const entry = await insert({id:record.id,created:record.created,...sealed});
    if(survey && version===epoch)SURVEYS.markSaved(survey,record.id);
    if (version !== epoch) return;
    records = await listLocal(scope); listOpen = true; selected = '저장'+entry.slot; paintList(); status(selected+' 기기 저장 완료'+(autoSync ? ' · Drive 동기화 확인 중…' : ' · 이 기기에만 보관합니다.'));
    if (autoSync) {
      if (!driveReady()) { status(selected+' 기기 저장 완료 · Drive 동기화 대기. 연결 후 동기화 버튼을 누르세요.'); return; }
      try {
        const remoteId = await SERVER.copyConsultation(entry.id,entry.encrypted);
        if (version !== epoch || !SERVER.isOpen()) return;
        await markRemote(entry,remoteId); if (version !== epoch) return;
        records = await listLocal(scope); paintList(); status(selected+' 기기 저장 완료 · Drive 동기화 완료');
      } catch (err) { if (version === epoch) status(selected+' 기기 저장 완료 · Drive 동기화 대기: '+(err.message || err)+'. 기기 원본은 유지됩니다.'); }
    }
  }
  async function load(entry) {
    const version = epoch; if (!(await unlocked()) || version !== epoch || entry.scope !== scope) return;
    const record = validate(await SERVER.openConsultation(entry.encrypted)); if (version !== epoch) return;
    if (!confirm('현재 작성 중인 내용 대신 저장'+entry.slot+'을 열까요? 필요한 내용은 먼저 저장하세요.')) return;
    if (record.survey) { SURVEYS.restore(record.survey,record.id); status('저장'+entry.slot+' 조사표를 열었습니다.'); return; }
    strokes = clone(record.strokes); selected = '저장'+entry.slot; boardOpen = strokes.length > 0;
    NOTES.restoreSaved(record.note); status(selected+'을 열었습니다. 수정 후 새로 저장하면 원본은 보존됩니다.');
  }
  async function copy(entry) {
    const version = epoch; if (!(await unlocked()) || version !== epoch || entry.scope !== scope) return;
    if (!VHM_AUTH.hasDrive) throw new Error('Drive 연결이 필요합니다. 기기 저장 후 Drive 연결 버튼을 눌러 주세요.');
    const remoteId = await SERVER.copyConsultation(entry.id,entry.encrypted);
    if (version !== epoch) return;
    await markRemote(entry,remoteId); if (version !== epoch) return;
    records = await listLocal(scope); paintList();
    if (version === epoch) status('저장'+entry.slot+' Drive 복사 완료. 다른 기기에서 같은 계정으로 불러올 수 있습니다.');
  }
  async function drop(entry) {
    const version = epoch; if (!(await unlocked()) || version !== epoch || entry.scope !== scope) return;
    if(!driveReady())throw new Error('Drive까지 삭제하려면 인터넷과 Drive 연결이 필요합니다. 기존 저장본은 유지됩니다.');
    if(!confirm('저장'+entry.slot+'을 이 기기와 Drive에서 영구 삭제할까요? Drive 휴지통에도 남기지 않으며 복구할 수 없습니다. 다른 기기의 같은 저장본도 다음 동기화 때 삭제됩니다.'))return;
    const owner=scope;
    await SERVER.deleteConsultation(entry.id,entry.encrypted,entry.remoteId);if(version!==epoch||!SERVER.isOpen())return;
    await applyDeletions([entry.id],owner);if(version!==epoch)return;
    records=await listLocal(owner);paintList();status('이 기기와 Drive에서 삭제했습니다. 다른 기기는 다음 동기화 때 반영됩니다.');
    if(window.PHIS)PHIS.refreshSaved();
  }
  async function importDrive() {
    const version = epoch; if (!(await unlocked()) || version !== epoch) return;
    if (!VHM_AUTH.hasDrive) throw new Error('Drive 연결 후 다시 누르세요. 연결 전 현재 내용을 먼저 저장하세요.');
    const deleted=await deletionState(version,scope);if(version!==epoch||!SERVER.isOpen())return;
    const files = await SERVER.listConsultations(); let added = 0, failed = 0;
    const imported = [];
    const have = new Set((await listLocal(scope)).map(x=>x.id));
    for (const file of files) {
      if (version !== epoch || !SERVER.isOpen()) return;
      try {
        const encrypted = await SERVER.fetchConsultation(file.id), record = validate(await SERVER.openConsultation(encrypted));
        if (version !== epoch) return;
        if(deleted.has(record.id))continue;
        imported.push({id:record.id,scope,created:record.created,encrypted,remoteId:file.id,remoteAt:new Date().toISOString()});
      } catch (_) { failed++; }
    }
    imported.sort((a,b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
    for (const entry of imported) {
      if (version !== epoch || !SERVER.isOpen()) return;
      try { const saved = await insert(entry); await markRemote(saved,entry.remoteId); if (!have.has(entry.id)) { added++; have.add(entry.id); } } catch (_) { failed++; }
    }
    if (version !== epoch) return;
    records = await listLocal(scope); listOpen = true; paintList(); status('Drive에서 '+added+'개 추가 · 중복은 유지'+(failed ? ' · '+failed+'개 읽기 실패(기존 저장 보존)' : ''));
  }
  async function syncAll() {
    const version = epoch;
    if (!(await unlocked()) || version !== epoch) return;
    if (!driveReady()) throw new Error('인터넷 연결과 같은 Google 계정의 Drive 연결을 확인한 뒤 다시 동기화하세요. 현재 기기 저장본은 유지됩니다.');
    const owner=scope,deleted=await deletionState(version,owner);if(version!==epoch||!SERVER.isOpen())return;
    const files = await SERVER.listConsultations();
    let downloaded = 0, uploaded = 0, failed = 0;
    const verified = new Set(), imported = [], have = new Set((await listLocal(owner)).map(e=>e.id));
    for (const file of files) {
      if (version !== epoch || !SERVER.isOpen()) return;
      try {
        const encrypted = await SERVER.fetchConsultation(file.id), record = validate(await SERVER.openConsultation(encrypted));
        if (version !== epoch) return;
        if(deleted.has(record.id))continue;
        imported.push({id:record.id,scope:owner,created:record.created,encrypted,remoteId:file.id,remoteAt:new Date().toISOString()});
      } catch (_) { failed++; }
    }
    imported.sort((a,b)=>a.created.localeCompare(b.created)||a.id.localeCompare(b.id));
    for (const entry of imported) {
      if (version !== epoch || !SERVER.isOpen()) return;
      try {
        const saved = await insert(entry); await markRemote(saved,entry.remoteId);
        verified.add(entry.id); if (!have.has(entry.id)) { downloaded++; have.add(entry.id); }
      } catch (_) { failed++; }
    }
    for (const entry of await listLocal(owner)) {
      if (version !== epoch || !SERVER.isOpen()) return;
      if (verified.has(entry.id)) continue;
      try { const remoteId = await SERVER.copyConsultation(entry.id,entry.encrypted); if (version !== epoch) return; await markRemote(entry,remoteId); uploaded++; }
      catch (_) { failed++; }
    }
    if (version !== epoch) return;
    records = await listLocal(owner); listOpen = true; paintList();
    status((failed ? '일부 동기화 실패' : '동기화 완료')+' · Drive에 '+uploaded+'개 업로드 · 이 기기에 '+downloaded+'개 추가'+(failed ? ' · 오류 '+failed+'건(기기 저장본 유지, 다시 동기화 가능)' : ''));
  }
  function clearDraft() { if(window.SURVEYS)SURVEYS.clear(); epoch++; strokes = []; active = null; selected = ''; paintBoard(); status('현재 내용만 지웠습니다. 저장 목록은 유지됩니다.'); }
  function lock() { if(window.SURVEYS)SURVEYS.clear(); epoch++; strokes = []; active = null; records = []; scope = ''; selected = ''; listOpen = false; boardOpen = false; if (window.NOTES) NOTES.clearContent(); paintBoard(); paintList(); status('잠겼습니다. 저장 메모는 잠금을 푼 뒤 열 수 있습니다.'); }
  window.CONSULTATIONS = {saveSurvey:survey=>runAction(()=>save(survey)),mount,clearDraft,lock,validate,getSaved,_listLocal:listLocal};
  if ($('#consultationTools')) mount();
})();
