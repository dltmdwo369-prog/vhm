/* Encrypted device-only PHIS preparation queue. No transport or execution adapter. */
(function () {
  'use strict';
  const M = window.VHM_PHIS_MODEL, $ = s => document.querySelector(s);
  let connection, epoch=0, scope='', cryptoScope='', jobs=[], invalid=0, busy=false, preview=null, previewVersion=0, statusCache=new Map(), refreshing=null;
  const selected=new Set();let cacheVersion=0;
  const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('vhm-phis-local-refresh'):null;
  if(channel)channel.onmessage=()=>{cacheVersion++;if(accessible()){refreshSaved();if($('#tab-phis')&&!$('#tab-phis').hidden&&!busy)reload().catch(()=>{});}};
  const messages={LOGIN:'일정 탭에서 Google 계정으로 먼저 연결하세요.',LOCKED:'메모 잠금을 먼저 풀어 주세요.',FORMAT:'저장된 요청 형식을 확인하지 못했습니다.',IDENTITY:'이름 또는 날짜 형식을 확인하세요.',SOURCE_CHANGED:'원본 메모가 변경되었거나 없습니다. 변경 내용을 새로 저장한 뒤 새 요청을 만드세요.',INCOMPLETE:'대상자 정보·상담일자·원문을 확인하고 검토 정보를 보완하세요.',NOT_CONNECTED:'승인된 PHIS 처리기가 연결되지 않았습니다. 실행·재시도·완료 처리는 비활성화되어 있습니다.',UNVERIFIED_RESULT:'처리 결과를 검증할 수 없습니다. 완료 상태로 신뢰하지 않습니다.',TRANSITION:'현재 상태에서 허용되지 않는 변경입니다.',CONFLICT:'다른 창에서 먼저 변경했습니다. 목록을 새로 불러온 뒤 확인하세요.',STORAGE:'기기 저장에 실패했습니다. 기존 자료는 유지됩니다.',STALE:'창 또는 로그인 상태가 변경되어 작업을 중단했습니다.'};
  const text=(el,value)=>{el.textContent=String(value ?? '');return el;};
  const node=(tag,value,cls)=>{const el=document.createElement(tag);if(value!=null)text(el,value);if(cls)el.className=cls;return el;};
  const accessible=()=>!!(window.VHM_AUTH?.valid() && window.SERVER?.isOpen() && (!window.FEATURES || FEATURES.enabled('phis')));
  const live=(version,owner)=>version===epoch && scope===owner && accessible();
  function report(error) { const msg=messages[error?.code] || '작업을 처리하지 못했습니다. 원본과 기존 요청은 유지됩니다.'; notice(msg); if(window.toast)toast(msg,7000); }
  function notice(value){if($('#phisNotice'))text($('#phisNotice'),value);}
  async function owner(){if(!window.VHM_AUTH?.valid())M.fail('LOGIN');if(!SERVER.isOpen())M.fail('LOCKED');if(window.FEATURES&&!FEATURES.enabled('phis'))M.fail('LOGIN');const keyScope=await SERVER.consultationScope(),session=await SERVER.getBootstrap();if(!session.email)M.fail('LOGIN');cryptoScope=keyScope;scope=await hash('phis-owner-v1\0'+session.email.trim().toLowerCase()+'\0'+keyScope);return scope;}
  async function hash(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
  function db(){if(!connection)connection=new Promise((resolve,reject)=>{const r=indexedDB.open('vhm-phis-requests-v1',1);r.onupgradeneeded=()=>{const s=r.result.createObjectStore('jobs',{keyPath:'id'});s.createIndex('source',['scope','sourceId'],{unique:true});};r.onsuccess=()=>resolve(r.result);r.onerror=r.onblocked=()=>reject(Object.assign(new Error('STORAGE'),{code:'STORAGE'}));}).catch(e=>{connection=null;throw e;});return connection;}
  async function envelopes(ownerScope){const c=await db();return new Promise((resolve,reject)=>{const t=c.transaction('jobs'),r=t.objectStore('jobs').getAll();t.oncomplete=()=>resolve(r.result.filter(e=>e.scope===ownerScope));t.onerror=t.onabort=()=>reject(Object.assign(new Error('STORAGE'),{code:'STORAGE'}));});}
  async function decode(e){const j=M.validate(await SERVER.openPhisJob(e.encrypted));if(j.id!==e.id||j.sourceId!==e.sourceId||j.ownerScope!==e.scope||j.cryptoScope!==cryptoScope||j.revision!==e.revision||await hash(j.snapshot.memoText)!==j.snapshot.memoHash)M.fail('FORMAT');return j;}
  async function readOne(id,ownerScope){const entries=await envelopes(ownerScope),e=entries.find(e=>e.id===id);if(!e)M.fail('FORMAT');return decode(e);}
  async function persist(job,expected,version,guard=()=>true){
    const sealed=await SERVER.sealPhisJob(job);if(!live(version,job.ownerScope)||!guard())M.fail('STALE');if(sealed.scope!==job.cryptoScope||job.cryptoScope!==cryptoScope)M.fail('STALE');
    const c=await db();
    const envelope={id:job.id,scope:job.ownerScope,sourceId:job.sourceId,revision:job.revision,encrypted:sealed.encrypted};
    return new Promise((resolve,reject)=>{
      const t=c.transaction('jobs','readwrite'),s=t.objectStore('jobs'),r=s.get(job.id);let result,code='STORAGE';
      r.onsuccess=()=>{
        if(!live(version,job.ownerScope)||!guard()){code='STALE';t.abort();return;}
        const old=r.result;
        if(expected===null&&old){result={...old,wasDuplicate:true};return;}
        if(expected!==null&&(!old||old.scope!==job.ownerScope||old.sourceId!==job.sourceId||old.revision!==expected)){code='CONFLICT';t.abort();return;}
        s.put(envelope);result=envelope;
      };
      t.oncomplete=()=>{cacheVersion++;channel?.postMessage({type:'changed'});resolve(result);};t.onerror=t.onabort=()=>reject(Object.assign(new Error(code),{code}));
    });
  }
  async function sourceStatus(job){const saved=await CONSULTATIONS.getSaved(job.sourceId,job.cryptoScope);return !saved?'missing':await hash(saved.encrypted)===job.sourceFingerprint?'current':'changed';}
  async function reload(){const version=epoch,who=await owner(),decoded=[];let bad=0;for(const e of await envelopes(who)){try{const job=await decode(e);try{job._sourceState=await sourceStatus(job);}catch(_){job._sourceState='unknown';}decoded.push(job);}catch(_){bad++;}if(!live(version,who))return;}if(!live(version,who))return;jobs=decoded.sort((a,b)=>b.requestedAt.localeCompare(a.requestedAt));invalid=bad;statusCache=new Map(jobs.map(j=>[j.sourceId,j]));paintSavedStates();renderRows();}
  function paintSavedStates(){for(const b of document.querySelectorAll('[data-phis-source]')){const job=statusCache.get(b.dataset.phisSource);b.disabled=!accessible()||busy;const s=b.parentElement.querySelector('[data-phis-badge]');if(s)text(s,job?M.labels[M.state(job)]+(!['pending','review','cancelled'].includes(job.status)?' · 처리 결과 미검증':''):'아직 요청하지 않음');}}
  function refreshSaved(){if(!accessible()){statusCache.clear();paintSavedStates();return;}if(!refreshing)refreshing=(async()=>{const version=epoch,revision=cacheVersion,who=await owner(),cache=new Map();for(const e of await envelopes(who)){try{const j=await decode(e);cache.set(j.sourceId,j);}catch(_){}if(!live(version,who))return;}if(live(version,who)&&revision===cacheVersion){statusCache=cache;paintSavedStates();}})().catch(()=>{}).finally(()=>{refreshing=null;});return refreshing;}
  function addSavedRequestButton(row,id){const b=node('button','PHIS 기록 요청','small');b.type='button';b.dataset.phisSource=id;b.disabled=!accessible();b.onclick=()=>act(()=>requestPreview(id));row.append(b,node('span','','hint'));row.lastChild.dataset.phisBadge='';refreshSaved();}
  async function act(fn){if(busy)return;busy=true;paintSavedStates();for(const b of document.querySelectorAll('#tab-phis button'))b.disabled=true;try{await fn();}catch(e){report(e);}finally{busy=false;paintSavedStates();for(const b of document.querySelectorAll('#tab-phis button'))if(!b.dataset.executionDisabled)b.disabled=false;}}
  function createDialog(){let d=$('#phisDialog');if(d)return d;d=node('dialog');d.id='phisDialog';d.className='wide';d.setAttribute('aria-labelledby','phisDialogTitle');document.body.append(d);d.addEventListener('close',()=>{previewVersion++;preview=null;d.replaceChildren();});return d;}
  function closeDialog(){const d=$('#phisDialog');if(d?.open)d.close();else{previewVersion++;preview=null;d?.replaceChildren();}}
  function form(identity){const box=node('div',null,'form-grid');for(const [key,label,type]of [['name','대상자 이름','text'],['birthDate','생년월일','date'],['consultationDate','상담일자','date']]){const l=node('label',null,'f');l.append(node('span',label));const input=node('input');input.type=type;input.dataset.phisField=key;input.setAttribute('aria-label',label);if(key==='name'){input.maxLength=80;input.autocomplete='off';}input.value=identity[key]||'';l.append(input);box.append(l);}return box;}
  function readIdentity(d){const v={};for(const el of d.querySelectorAll('[data-phis-field]'))v[el.dataset.phisField]=el.value;return M.identity(v);}
  function dialogBase(title,identity,memo){const d=createDialog();d.replaceChildren();const head=node('div',null,'dlg-head');head.append(node('h3',title));head.firstChild.id='phisDialogTitle';const close=node('button','닫기','link');close.type='button';close.onclick=closeDialog;head.append(close);const body=node('div',null,'dlg-body');body.append(node('p','PHIS 미연동 · 이 기기에만 암호화 보관합니다. 실제 입력·작업 전송은 실행되지 않습니다.','infobox'));body.append(form(identity));const original=node('textarea');original.id='phisOriginalMemo';original.readOnly=true;original.rows=9;original.setAttribute('aria-label','상담메모 원문');original.value=memo;const l=node('label',null,'f full');l.append(node('span','요청 시점 상담메모 원문'),original);body.append(l);const footer=node('div',null,'dlg-foot');d.append(head,body,footer);return {d,body,footer};}
  async function requestPreview(sourceId){
    const version=epoch,who=await owner(),entry=await CONSULTATIONS.getSaved(sourceId,cryptoScope);if(!entry)M.fail('SOURCE_CHANGED');
    const record=CONSULTATIONS.validate(await SERVER.openConsultation(entry.encrypted));const fingerprint=await hash(entry.encrypted);if(!live(version,who))return;
    const existing=(await envelopes(who)).find(e=>e.sourceId===sourceId);if(existing){await detail((await decode(existing)).id);return;}
    const subject=record.subject||{},identity=M.identity({name:typeof subject.name==='string'?subject.name:'',birthDate:M.validDate(subject.birthDate)?subject.birthDate:'',consultationDate:M.validDate(record.consultedOn)?record.consultedOn:''});
    const {d,body,footer}=dialogBase('PHIS 기록 요청 미리보기',identity,record.note.out);
    body.prepend(node('p','저장'+entry.slot+' · 현재 상태: 요청하지 않음','hint'));
    body.append(node('p','원본에 없는 정보는 비워 두었습니다. 이름·생년월일·상담일자는 확인한 값만 직접 보완하세요. 미등록 항목이 있으면 처리 준비가 제한됩니다.','hint'));
    const check=node('label',null,'row'),input=node('input');input.type='checkbox';input.id='phisPreviewReviewed';input.style.width='auto';check.append(input,node('span','원문과 대상자 정보를 검토했습니다. 미등록 정보는 추가 검토가 필요함을 확인합니다.'));body.append(check);
    const confirm=node('button','요청 확정','primary');confirm.type='button';confirm.id='phisConfirmRequest';confirm.disabled=true;input.onchange=()=>confirm.disabled=!input.checked;footer.append(confirm);
    previewVersion++;const pv=previewVersion;preview={sourceId,who,fingerprint,record,entry,identity};
    confirm.onclick=()=>act(async()=>{
      if(pv!==previewVersion||!input.checked||!live(version,who))M.fail('STALE');
      const original=await CONSULTATIONS.getSaved(sourceId,cryptoScope);if(!original||await hash(original.encrypted)!==fingerprint)M.fail('SOURCE_CHANGED');
      const id='phis_'+await hash('phis-record-v1\0'+who+'\0'+sourceId),now=new Date().toISOString(),chosen=readIdentity(d);
      const job=M.validate({schema:1,type:'phis-record-request',id,ownerScope:who,cryptoScope,sourceId,sourceLabel:'저장'+entry.slot,sourceFingerprint:fingerprint,requestedAt:now,updatedAt:now,status:'pending',attempts:0,startedAt:null,finishedAt:null,error:null,preparedAt:null,review:null,revision:0,snapshot:{memoText:record.note.out,memoHash:await hash(record.note.out),identity:chosen,identitySource:JSON.stringify(chosen)===JSON.stringify(identity)?'source-or-missing':'user-confirmed',capturedAt:now,sourceCreatedAt:record.created},history:[{at:now,action:'requested',from:null,to:'pending',revision:0,actor:'local-owner'}]});
      const saved=await persist(job,null,version,()=>pv===previewVersion);if(!live(version,who))return;
      await decode(saved);closeDialog();await reload();notice(saved.wasDuplicate?'이미 요청된 메모입니다. 기존 요청을 유지했습니다.':'PHIS 요청 대기 작업을 기기에 저장했습니다. 실제 PHIS 입력은 실행하지 않았습니다.');if(window.toast)toast(saved.wasDuplicate?'이미 요청된 메모입니다.':'PHIS 요청 대기로 보관했습니다.');
    });d.showModal();
  }
  async function mutate(id,revision,action,identity){const version=epoch,who=await owner(),current=await readOne(id,who);if(current.revision!==revision)M.fail('CONFLICT');const state=await sourceStatus(current);const next=M.change(current,action,new Date().toISOString(),{sourceStatus:state,identity});await persist(next,current.revision,version);if(!live(version,who))return;closeDialog();await reload();notice(action==='prepare'?'처리 요청 준비만 기록했습니다. 작업 전송·실행은 비활성화되어 있습니다.':'요청 상태를 기기에 반영했습니다.');}
  async function detail(id){const version=epoch,who=await owner(),job=await readOne(id,who),source=await sourceStatus(job);if(!live(version,who))return;
    const identity=M.effectiveIdentity(job),{d,body,footer}=dialogBase('PHIS 요청 상세',identity,job.snapshot.memoText),effective=M.state(job);
    body.prepend(node('p',M.labels[effective]+' · 요청 '+new Date(job.requestedAt).toLocaleString('ko-KR')+' · 처리 시도: '+(job.attempts===0?'0회 (미연동)':'처리기 검증 필요'),'hint'));
    if(job.review){const original=job.snapshot.identity;body.append(node('p','요청 당시 확인정보: '+(original.name||'이름 미등록')+' / '+(original.birthDate||'생년월일 미등록')+' / '+(original.consultationDate||'상담일자 미등록'),'hint'));}
    const flags=M.flags(job);body.append(node('p',source==='current'?'원본 메모: 요청 시점과 일치':source==='missing'?'원본 메모가 이 기기에 없습니다. 요청 스냅샷은 유지됩니다.':'원본 메모가 변경되었습니다. 요청 시점 스냅샷은 유지됩니다.','hint'));
    if(flags.length)body.append(node('p','확인 필요: '+flags.join(' / '),'warnbox'));
    if(!['pending','review','cancelled'].includes(job.status))body.append(node('p','승인된 처리기가 없으므로 저장된 처리 결과를 검증할 수 없습니다. 입력 완료로 인정하지 않습니다.','warnbox'));
    if(job.error)body.append(node('p','오류: '+String(job.error.type||'미분류')+' · '+String(job.error.message||'내용 없음'),'warnbox'));
    body.append(node('p','검토 정보를 보완해도 요청 시점의 원문·원래 확인정보 스냅샷은 변경하지 않습니다.','hint'));
    const history=node('details');history.append(node('summary','요청·검토 이력'));const ul=node('ul');const actionLabels={requested:'요청 확정',cancel:'요청 취소',review:'검토 필요로 표시',review_identity:'확인정보 보완',requeue:'재요청',prepare:'처리 요청 준비(미전송)'};for(const h of job.history){ul.append(node('li',(Number.isFinite(Date.parse(h.at))?new Date(h.at).toLocaleString('ko-KR'):'시각 미확인')+' · '+(actionLabels[h.action]||'미검증 이력')));}history.append(ul);body.append(history);
    const add=(label,action)=>{const b=node('button',label);b.type='button';b.onclick=()=>act(action);footer.append(b);return b;};
    if(['pending','review'].includes(job.status)){
      add('검토 정보 확인·반영',()=>mutate(job.id,job.revision,'review_identity',readIdentity(d))).id='phisReviewSave';
      if(job.status==='pending')add('검토 필요로 표시',()=>mutate(job.id,job.revision,'review'));
      add('요청 취소',()=>mutate(job.id,job.revision,'cancel')).id='phisCancel';
    }
    if(['review','cancelled'].includes(job.status))add('검토 후 재요청',async()=>{if(!confirm('같은 요청을 다시 요청 대기로 두겠습니까? 실제 PHIS 실행은 하지 않습니다.'))return;await mutate(job.id,job.revision,'requeue');}).id='phisRequeue';
    const retry=add('승인된 처리기로 재시도',()=>{});retry.disabled=true;retry.title='승인된 처리기 미연결';
    const execute=add('PHIS 실행 (미연동)',()=>{});execute.disabled=true;execute.title='실제 PHIS 접속·입력은 구현하지 않았습니다.';
    d.showModal();
  }
  function renderRows(){const area=$('#phisRows');if(!area)return;area.replaceChildren();if(!accessible()){notice('Google 연결과 메모 잠금 해제 후 요청을 조회할 수 있습니다.');return;}
    const q=($('#phisSearch')?.value||'').trim().toLowerCase(),from=$('#phisFrom')?.value||'',to=$('#phisTo')?.value||'',filter=$('#phisState')?.value||'';
    const list=jobs.filter(j=>{const i=M.effectiveIdentity(j);return (!q||i.name.toLowerCase().includes(q))&&(!from||i.consultationDate>=from)&&(!to||!!i.consultationDate&&i.consultationDate<=to)&&(!filter||M.state(j)===filter);});
    for(const job of list){const i=M.effectiveIdentity(job),card=node('article',null,'card phis-row');card.style.cssText='padding:12px;margin:8px 0;overflow-wrap:anywhere';card.dataset.jobId=job.id;
      const line=node('div',null,'row');line.style.flexWrap='wrap';const check=node('input');check.type='checkbox';check.style.width='auto';check.setAttribute('aria-label',job.sourceLabel+' 작업 선택');check.checked=selected.has(job.id);check.onchange=()=>{if(check.checked)selected.add(job.id);else selected.delete(job.id);if($('#phisSelection'))text($('#phisSelection'),'선택 '+selected.size+'건');};line.append(check,node('b',M.maskName(i.name)),node('span',i.birthDate?i.birthDate.slice(0,4)+'-**-**':'생년월일 미등록','hint'),node('span',M.labels[M.state(job)],'badge'));
      card.append(line,node('p','상담일자: '+(i.consultationDate||'미등록')+' · 요청: '+new Date(job.requestedAt).toLocaleString('ko-KR'),'hint'));
      const result=!['pending','review','cancelled'].includes(job.status)?'처리 결과 미검증 · 검토 필요':job.status==='cancelled'?'사용자가 요청을 취소했습니다.':job.preparedAt?'처리 요청 준비됨 · 미전송·미실행':'처리기 미연결 · PHIS 입력 전';card.append(node('p',result,'hint'));
      if(job._sourceState&&job._sourceState!=='current')card.append(node('p',job._sourceState==='changed'?'원본 변경 · 재검토 필요':job._sourceState==='missing'?'기기 원본 없음 · 스냅샷 보존':'원본 확인 필요','hint'));
      if(M.flags(job).length)card.append(node('p',M.flags(job).join(' / '),'hint'));
      const b=node('button','상세보기');b.type='button';b.onclick=()=>act(()=>detail(job.id));card.append(b);area.append(card);
    }
    if(!list.length)area.append(node('p','조건에 맞는 PHIS 요청이 없습니다.','empty'));
    if($('#phisSelection'))text($('#phisSelection'),'선택 '+selected.size+'건');
    if($('#phisCount'))text($('#phisCount'),list.length+'건'+(invalid?' · 읽지 못한 자료 '+invalid+'건(보존됨)':''));
  }
  async function prepareSelected(){if(!selected.size){notice('준비할 요청을 선택하세요.');return;}let ready=0,skipped=0;for(const id of [...selected]){try{const job=jobs.find(j=>j.id===id);if(!job){skipped++;continue;}const version=epoch,who=await owner(),current=await readOne(id,who);if(current.revision!==job.revision)M.fail('CONFLICT');const next=M.change(current,'prepare',new Date().toISOString(),{sourceStatus:await sourceStatus(current)});await persist(next,current.revision,version);ready++;}catch(_){skipped++;}}selected.clear();await reload();notice('처리 요청 준비 '+ready+'건 · 보완/변경/상태 불일치로 제외 '+skipped+'건. 전송과 PHIS 실행은 하지 않았습니다.');}
  function mount(){const box=$('#tab-phis');if(!box)return;box.innerHTML='<div class="card" style="padding:14px"><h2>PHIS 기록 관리</h2><p class="infobox">PHIS 자동화 미연동 · 기기별 암호화 요청 보관만 제공합니다. 보안망 전송·PHIS 로그인·자동 입력·완료 처리는 비활성화되어 있습니다.</p><p class="hint">저장한 상담메모의 PHIS 기록 요청에서 작업을 만드세요. 요청 작업은 상담메모 Drive 동기화와 별개로 이 기기에만 남습니다. 목록은 이름·생년월일을 가려 표시하고 상세는 잠금 해제 후 확인합니다.</p><div class="row" style="flex-wrap:wrap;gap:8px"><button id="phisReload" type="button">잠금 해제·목록 갱신</button><button id="phisPrepare" type="button">선택 작업 처리 요청 준비</button><span id="phisSelection" class="hint" aria-live="polite">선택 0건</span><button id="phisClearSelection" type="button">선택 해제</button><button id="phisExecute" data-execution-disabled="true" disabled type="button">PHIS 실행 (미연동)</button></div><div class="form-grid" style="margin-top:12px"><label class="f">대상자 검색<input id="phisSearch" autocomplete="off"></label><label class="f">처리 상태<select id="phisState"><option value="">전체</option></select></label><label class="f">상담일자 시작<input id="phisFrom" type="date"></label><label class="f">상담일자 끝<input id="phisTo" type="date"></label></div><p id="phisNotice" class="hint" role="status"></p><p id="phisCount" class="hint"></p><div id="phisRows"></div><p class="hint">향후 입력 완료가 확인되더라도 연계서비스 추가·세부 상담 항목·기록 보완은 담당자가 직접 수행해야 합니다.</p></div>';
    for(const [value,label]of Object.entries(M.labels)){const o=node('option',label);o.value=value;$('#phisState').append(o);}
    for(const id of ['phisSearch','phisState','phisFrom','phisTo'])$('#'+id).addEventListener(id==='phisSearch'?'input':'change',renderRows);
    $('#phisReload').onclick=()=>act(async()=>{if(!VHM_AUTH.valid())M.fail('LOGIN');if(!SERVER.isOpen()&&!(await MEMOLOCK.openNow('PHIS 요청을 확인하려면 메모 잠금을 풀어 주세요.')))return;await reload();});
    $('#phisPrepare').onclick=()=>act(prepareSelected);
    $('#phisClearSelection').onclick=()=>{selected.clear();renderRows();};
  }
  async function open(){mount();if(!accessible()){notice('일정 탭의 Google 연결과 메모 잠금 해제를 먼저 완료하세요.');return;}await act(reload);}
  function lock(){epoch++;scope='';cryptoScope='';jobs=[];statusCache.clear();selected.clear();closeDialog();if($('#tab-phis')){mount();notice('잠겼습니다. 다시 연결·잠금 해제 후 목록을 갱신하세요.');}paintSavedStates();}
  setInterval(()=>{if(scope&&!accessible())lock();},30000);
  window.addEventListener('focus',()=>{if(scope&&!accessible())lock();});
  window.PHIS=Object.freeze({open,lock,addSavedRequestButton,requestPreview,refreshSaved,capability:M.capability});
})();
