/* Drafts stay in memory. Explicit saves use the encrypted consultation lifecycle. */
(function(){
'use strict';
const forms=window.VHM_SURVEYS, drafts=new Map(), savedIds=new Map(); let current='';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function validate(d){
 const f=forms.find(f=>f.id===d?.form);
 if(!f||typeof d.name!=='string'||!d.name.trim()||d.name.length>80||!Array.isArray(d.answers)||d.answers.length!==f.fields.length)throw Error('조사표 형식 또는 대상자 이름을 확인하세요.');
 d.answers.forEach((a,i)=>{const q=f.fields[i];if(q.options){if(q.multi){if(!Array.isArray(a)||new Set(a).size!==a.length||!a.every(v=>Number.isInteger(v)&&v>=0&&v<q.options.length))throw Error('조사표 선택값 오류');}else if(a!==null&&(!Number.isInteger(a)||a<0||a>=q.options.length))throw Error('조사표 선택값 오류');}else if(typeof a!=='string'||a.length>2000)throw Error('조사표 입력값 오류');});return d;
}
function fresh(f){return {form:f.id,name:'',answers:f.fields.map(q=>q.options?(q.multi?[]:null):'')};}
function score(d){const n=d.form==='phq'?9:d.form==='sgds'?15:0;if(!n)return '';const a=d.answers.slice(0,n),done=a.filter(x=>x!==null).length;let total=a.reduce((s,v,i)=>s+(v===null?0:d.form==='phq'?v:([0,4,6,10,12].includes(i)?v===1:v===0)?1:0),0);return `${done}/${n}문항 응답 · ${done===n?'총점':'응답한 문항 점수'} ${total}점`+(d.form==='sgds'&&done===n&&total>=8?' · 전문의 상담 권유(원본 기준)':'')+(d.form==='phq'&&a[8]>0?' · 9번 응답에 따라 위험 확인 및 정신건강복지센터 연계 검토':'')+' · 선별검사이며 진단이 아닙니다.';}
function mount(){
 const host=document.querySelector('#surveyTools');if(!host)return;
 host.innerHTML='<div class="card" style="padding:12px;margin:12px 0"><b>기초조사표 작성·저장</b><div class="row" id="surveyButtons" style="flex-wrap:wrap;gap:8px;margin:8px 0">'+forms.map(f=>`<button type="button" data-survey="${f.id}" aria-pressed="${current===f.id}">${esc(f.title)}</button>`).join('')+'</div><p class="hint">대상자 이름과 체크 응답만 입력해 저장하세요. 저장 목록·Drive 동기화·영구 삭제는 위의 상담메모 저장 기능을 함께 사용합니다. 입력 중에는 저장하지 않습니다.</p><div id="surveyEditor"></div></div>';
 host.querySelectorAll('[data-survey]').forEach(b=>b.onclick=()=>{current=b.dataset.survey;mount();});render();
}
function render(){
 const box=document.querySelector('#surveyEditor'),f=forms.find(f=>f.id===current);if(!box||!f)return;
 if(!drafts.has(f.id))drafts.set(f.id,fresh(f));const d=drafts.get(f.id);
 box.innerHTML=`<h3>${esc(f.title)}</h3><p class="hint">${esc(f.period)}</p><label class="f">대상자 이름<input id="surveyName" maxlength="80" autocomplete="off" value="${esc(d.name)}"></label>`+f.fields.map((q,i)=>`<fieldset style="margin:10px 0;border:1px solid var(--line);border-radius:8px;min-width:0"><legend>${i+1}. ${esc(q.label)}</legend>${q.options?'<div class="row" style="flex-wrap:wrap;gap:10px">'+q.options.map((v,k)=>`<label style="display:inline-flex;align-items:center;gap:5px"><input style="width:auto" type="${q.multi?'checkbox':'radio'}" name="survey-${i}" data-q="${i}" value="${k}" ${(q.multi?d.answers[i].includes(k):d.answers[i]===k)?'checked':''}>${esc(v)}</label>`).join('')+`</div>${q.multi?'':`<button type="button" class="small" data-unset="${i}">선택 해제</button>`}`:`<textarea rows="2" maxlength="2000" data-q="${i}">${esc(d.answers[i])}</textarea>`}</fieldset>`).join('')+`<p id="surveyScore" role="status">${esc(score(d))}</p><div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="primary" id="surveySave">이 조사표 새로 저장</button><button type="button" id="surveyReset">새 대상자 / 입력 지우기</button></div><p id="surveyStatus" role="status"></p>`;
 box.querySelector('#surveyName').oninput=e=>d.name=e.target.value;
 box.querySelectorAll('[data-q]').forEach(el=>el.oninput=()=>{const i=+el.dataset.q,q=f.fields[i];d.answers[i]=q.options?(q.multi?[...box.querySelectorAll(`[data-q="${i}"]:checked`)].map(x=>+x.value):+el.value):el.value;box.querySelector('#surveyScore').textContent=score(d);});
 box.querySelectorAll('[data-unset]').forEach(el=>el.onclick=()=>{d.answers[+el.dataset.unset]=null;render();});
 box.querySelector('#surveySave').onclick=async()=>{const b=box.querySelector('#surveySave');b.disabled=true;try{validate(d);await CONSULTATIONS.saveSurvey(structuredClone(d));const status=document.querySelector('#surveyStatus');if(status)status.textContent=document.querySelector('#consultStatus')?.textContent||'';}catch(e){box.querySelector('#surveyStatus').textContent=e.message;}finally{b.disabled=false;}};
 box.querySelector('#surveyReset').onclick=()=>{if(confirm('이 조사표의 이름과 응답을 지울까요? 저장본은 유지됩니다.')){drafts.set(f.id,fresh(f));savedIds.delete(f.id);render();}};
}
function restore(d,id){validate(d);if(id)savedIds.set(d.form,id);current=d.form;drafts.set(current,structuredClone(d));mount();document.querySelector('#surveyTools')?.scrollIntoView({block:'start'});}
function clear(){savedIds.clear();drafts.clear();current='';mount();}
function deleted(ids){for(const [form,id] of savedIds){if(ids.includes(id)){drafts.delete(form);savedIds.delete(form);if(current===form)current='';}}mount();}
window.SURVEYS={mount,restore,validate,clear,score,deleted,markSaved:(d,id)=>savedIds.set(d.form,id)};mount();
})();
