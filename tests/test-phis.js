// Fake Google Calendar/Drive only; no account, patient data, or external service.
const {chromium} = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert/strict');
const ROOT = path.join(__dirname,'..');
const files = new Map(), events = new Map(); let seq=0, uploads=0, failed=false, calendarFail=false;
const cals=[{id:'fake-owner@example.test',summary:'primary',primary:true,accessRole:'owner'},{id:'w',summary:'방문건강관리(업무)',accessRole:'owner'},{id:'p',summary:'방문건강관리(개인)',accessRole:'owner'}];
const server=http.createServer((req,res)=>{
 const file=path.join(ROOT,'site',req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);
 if(req.url==='/config.js')return res.end('window.VHM_CONFIG={clientId:""}');
 if(!fs.existsSync(file)){res.writeHead(404);return res.end();}
 res.end(fs.readFileSync(file));
});
let checks=0; function check(name,ok){assert.ok(ok,name);console.log('PASS '+name);checks++;}
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOuoAAAAASUVORK5CYII=','base64');
(async()=>{
 await new Promise(r=>server.listen(0,r));
 const browser=await chromium.launch({executablePath:process.env.VHM_CHROMIUM||'/usr/bin/chromium'});
 try{
 const sharedContext=await browser.newContext({viewport:{width:1440,height:900}});
 const page=await sharedContext.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/*',r=>r.request().url().startsWith('http://localhost:')?r.continue():r.abort());
 const google = async route=>{
  const req=route.request(),u=new URL(req.url()),method=req.method(),p=u.pathname;
  let status=200,data={};const json=()=>JSON.parse(req.postData()||'{}');
  if(p==='/calendar/v3/users/me/calendarList')data={items:cals};
  else if(p==='/drive/v3/files'&&method==='GET'){
   const q=u.searchParams.get('q')||'';
   if(q.includes('appProperties'))data={files:[...files].filter(([id,f])=>f.meta.appProperties?.vhmType===(/value='([^']+)'/.exec(q)?.[1]||'consultation-v1')).map(([id,f])=>({id,name:f.meta.name}))};
   else if(q.includes('방문건강관리 연계자료'))data={files:[{id:'folder',name:'방문건강관리 연계자료',mimeType:'application/vnd.google-apps.folder'}]};
   else{const name=/name = '([^']+)'/.exec(q)?.[1];data={files:[...files].filter(([id,f])=>f.meta.name===name).map(([id,f])=>({id,name:f.meta.name}))};}
  }
  else if(p==='/upload/drive/v3/files'&&method==='POST'){
   if(failed){failed=false;status=503;data={error:{message:'fake upload failure'}};}
   else{
    const body=req.postDataBuffer().toString('utf8'),boundary=/boundary=([^;]+)/.exec(req.headers()['content-type'])[1];
    const parts=body.split('--'+boundary).slice(1,-1).map(x=>x.slice(x.indexOf('\r\n\r\n')+4,-2));
    const meta=JSON.parse(parts[0]),id='file'+(++seq);files.set(id,{meta,body:parts[1]});uploads++;data={id};
   }
  }
  else if(p.startsWith('/drive/v3/files/')&&u.searchParams.get('alt')==='media'){
   const f=files.get(p.split('/').pop());if(!f){status=404;data={error:{message:'missing'}};}else return route.fulfill({status:200,body:f.body});
  }
  else if(p.startsWith('/calendar/v3/calendars/')){
   const match=/calendars\/([^/]+)(?:\/events(?:\/([^/]+))?)?$/.exec(p),cid=decodeURIComponent(match[1]),id=match[2];
   if(!p.includes('/events')){
    const cal=cals.find(x=>x.id===cid);if(method==='PATCH')Object.assign(cal,json());data=cal||{};
   }else if(method==='GET'&&!id)data={items:[...events.values()].filter(e=>e.cal===cid)};
   else if(method==='GET'&&id){data=events.get(id);if(!data||data.cal!==cid){status=404;data={error:{message:'missing'}};}}
   else if(method==='POST'&&!id){
    if(calendarFail){calendarFail=false;status=503;data={error:{message:'fake calendar save failure'}};}
    else{const ev={...json(),id:'event'+(++seq),etag:'"'+seq+'"',cal:cid};events.set(ev.id,ev);data=ev;}
   }else if(method==='PATCH'&&id){const ev=events.get(id);if(req.headers()['if-match']&&req.headers()['if-match']!==ev.etag){status=412;data={error:{message:'conflict'}};}else{Object.assign(ev,json(),{etag:'"'+(++seq)+'"'});data=ev;}}
  }
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 }; await page.route('https://www.googleapis.com/**',google);
 await page.goto('http://localhost:'+server.address().port+'/');
 await page.evaluate(()=>{VHM_AUTH.token='tok-fake';VHM_AUTH.exp=Date.now()+3600000;VHM_AUTH.hasDrive=true;S.selected='2026-11-16';});


 const logs=[],network=[];page.on('console',m=>logs.push(m.text()));page.on('request',r=>{if(r.url().startsWith('https://www.googleapis.com/'))network.push(r.url());});
 await page.evaluate(async()=>{VHM_AUTH.hasDrive=false;await SERVER.lockSetup('fake-phis-password-123');await MEMOLOCK.refresh();await NOTES.open();});await page.locator('[data-tab="note"]').click();
 check('unsaved note has no enabled PHIS request button',await page.locator('[data-phis-source]:enabled').count()===0);
 await page.locator('#ntOut').fill('가상 상담 원문 <img src=x onerror=alert(1)>');await page.locator('#consultMemoSave').click();await page.waitForFunction(()=>!document.querySelector('#consultMemoSave').disabled);
 check('saved consultation gains PHIS record request button',await page.getByRole('button',{name:'PHIS 기록 요청',exact:true}).count()===1);
 const keyScope=await page.evaluate(()=>SERVER.consultationScope()),source=(await page.evaluate(s=>CONSULTATIONS._listLocal(s),keyScope))[0],original=source.encrypted;
 async function envelopes(p=page){return p.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('vhm-phis-requests-v1',1);r.onsuccess=()=>{const tx=r.result.transaction('jobs'),q=tx.objectStore('jobs').getAll();tx.oncomplete=()=>resolve(q.result);tx.onerror=reject;};}));}
 async function readJob(p=page){const e=(await envelopes(p))[0];return p.evaluate(e=>SERVER.openPhisJob(e.encrypted),e);}
 await page.locator('#ntOut').fill('저장하지 않은 다른 문장');
 await page.getByRole('button',{name:'PHIS 기록 요청',exact:true}).click();await page.waitForSelector('#phisDialog[open]');
 check('preview uses exact saved memo without executing HTML',await page.locator('#phisOriginalMemo').inputValue()==='가상 상담 원문 <img src=x onerror=alert(1)>'&&await page.locator('#phisDialog img').count()===0);
 check('missing identity and consultation date are not invented',await page.getByLabel('대상자 이름',{exact:true}).inputValue()===''&&await page.getByLabel('생년월일',{exact:true}).inputValue()===''&&await page.getByLabel('상담일자',{exact:true}).inputValue()==='');
 check('confirmation requires an explicit review check',await page.locator('#phisConfirmRequest').isDisabled());
 await page.getByLabel('대상자 이름',{exact:true}).fill('가상 대상자');await page.getByLabel('생년월일',{exact:true}).fill('1950-01-02');await page.getByLabel('상담일자',{exact:true}).fill('2026-11-17');await page.locator('#phisPreviewReviewed').check();
 const beforeRequest=network.length;await page.locator('#phisConfirmRequest').click();await page.waitForSelector('#phisDialog:not([open])',{state:'attached'});
 const job=await readJob(),rows=await envelopes();
 check('confirmed request remains pending with no execution attempts',job.status==='pending'&&job.attempts===0&&job.startedAt===null&&job.finishedAt===null);
 check('request snapshot preserves exact original and confirmed identity',job.snapshot.memoText.includes('가상 상담 원문')&&job.snapshot.identity.name==='가상 대상자'&&job.snapshot.identity.birthDate==='1950-01-02');
 check('job envelope stores no plaintext identity or note',rows[0].encrypted.startsWith('vhm-phis1:')&&!JSON.stringify(rows).includes('가상')&&!JSON.stringify(rows).includes('1950-01-02'));
 check('request creation sends no PHIS data to Google or a new server',network.length===beforeRequest&&files.size===0);
 check('original saved consultation is unchanged',(await page.evaluate(s=>CONSULTATIONS._listLocal(s),keyScope))[0].encrypted===original);
 await page.getByRole('button',{name:'PHIS 기록 요청',exact:true}).click();await page.waitForSelector('#phisDialog[open]');
 check('duplicate request opens existing status rather than creating again',await page.locator('#phisConfirmRequest').count()===0&&(await envelopes()).length===1);
 await page.locator('#phisDialog .dlg-head button').click();await page.locator('[data-tab="phis"]').click();await page.waitForSelector('.phis-row');
 check('management masks identity and date of birth in list',!(await page.locator('.phis-row').innerText()).includes('가상 대상자')&&!(await page.locator('.phis-row').innerText()).includes('1950-01-02'));
 await page.locator('#phisSearch').fill('없는 대상');check('subject filter excludes nonmatching requests',await page.locator('.phis-row').count()===0);await page.locator('#phisSearch').fill('가상');
 await page.locator('#phisFrom').fill('2026-11-18');check('consultation date filter works',await page.locator('.phis-row').count()===0);await page.locator('#phisFrom').fill('');
 await page.locator('#phisState').selectOption('completed');check('unlinked queue has no completed requests',await page.locator('.phis-row').count()===0);await page.locator('#phisState').selectOption('pending');
 await page.locator('.phis-row input[type=checkbox]').check();await page.locator('#phisPrepare').click();await page.waitForFunction(()=>document.querySelector('#phisNotice').textContent.includes('처리 요청 준비 1건'));
 const prepared=await readJob();check('batch preparation never starts PHIS or marks success',prepared.status==='pending'&&prepared.preparedAt&&prepared.attempts===0&&await page.locator('#phisExecute').isDisabled());
 await page.locator('.phis-row button').click();await page.waitForSelector('#phisDialog[open]');await page.locator('#phisCancel').click();await page.waitForSelector('#phisDialog:not([open])',{state:'attached'});
 check('request cancellation is persisted without touching source',(await readJob()).status==='cancelled'&&(await page.evaluate(s=>CONSULTATIONS._listLocal(s),keyScope))[0].encrypted===original);
 await page.locator('#phisState').selectOption('cancelled');await page.locator('.phis-row button').click();await page.waitForSelector('#phisRequeue');await page.locator('#phisRequeue').click();await page.waitForSelector('#phisDialog:not([open])',{state:'attached'});
 check('human re-request reuses job ID and preserves snapshot',(await readJob()).status==='pending'&&(await readJob()).id===job.id&&(await readJob()).snapshot.memoText===job.snapshot.memoText);
 await page.locator('#phisState').selectOption('pending');await page.locator('.phis-row button').click();await page.getByLabel('대상자 이름',{exact:true}).fill('가상 보완 대상');await page.locator('#phisReviewSave').click();await page.waitForSelector('#phisDialog:not([open])',{state:'attached'});
 const reviewed=await readJob();check('review corrections never mutate request-time snapshot',reviewed.snapshot.identity.name==='가상 대상자'&&reviewed.review.identity.name==='가상 보완 대상'&&reviewed.revision>job.revision);

 const transitions=await page.evaluate(j=>{
  const M=VHM_PHIS_MODEL,now=new Date().toISOString(),reject=(job,action,ctx={})=>{try{M.change(job,action,now,ctx);return false;}catch(_){return true;}};
  const missing=structuredClone(j);missing.snapshot.identity={name:'',birthDate:'',consultationDate:''};missing.review=null;
  const masked=structuredClone(missing);masked.snapshot.identity={name:'김O수',birthDate:'1950-01-02',consultationDate:'2026-11-17'};
  return {
   missing:reject(missing,'prepare',{sourceStatus:'current'}),masked:reject(masked,'prepare',{sourceStatus:'current'}),
   missingSource:reject(j,'prepare',{sourceStatus:'missing'}),cancelled:reject({...j,status:'cancelled'},'prepare',{sourceStatus:'current'}),
   unverified:['processing','completed','failed'].every(status=>M.state({...j,status})==='review'&&reject({...j,status},'cancel')),
   execution:['start','complete','fail','retry','worker_result'].every(a=>reject(j,a,{verified:true,connected:true,approved:true})),
   dates:!M.validDate('2026-02-30')&&!M.validDate('1950')&&M.validDate('2024-02-29'),
   immutable:JSON.stringify(M.change(j,'prepare',now,{sourceStatus:'current'}).snapshot)===JSON.stringify(j.snapshot)
  };
 },reviewed);
 for(const [name,ok]of Object.entries(transitions))check('state model invariant: '+name,ok);
 // A second tab's write is represented by an encrypted revision update while detail is open.
 await page.locator('.phis-row button').click();await page.waitForSelector('#phisCancel');
 await page.evaluate(async e=>{const j=await SERVER.openPhisJob(e.encrypted);j.revision++;const sealed=await SERVER.sealPhisJob(j);const c=await new Promise(r=>{const q=indexedDB.open('vhm-phis-requests-v1',1);q.onsuccess=()=>r(q.result);});await new Promise(r=>{const tx=c.transaction('jobs','readwrite');tx.objectStore('jobs').put({...e,revision:j.revision,encrypted:sealed.encrypted});tx.oncomplete=r;});},(await envelopes())[0]);
 await page.locator('#phisCancel').click();await page.waitForFunction(()=>document.querySelector('#phisNotice').textContent.includes('다른 창'));
 check('stale detail cannot overwrite another tabs newer revision',(await readJob()).status==='pending'&&(await readJob()).revision===reviewed.revision+1);
 await page.locator('#phisDialog .dlg-head button').click();await page.locator('#phisReload').click();
 // Deleted source must preserve the request snapshot and prohibit preparation.
 await page.evaluate(async id=>{const c=await new Promise(r=>{const q=indexedDB.open('vhm-consultations-v1',1);q.onsuccess=()=>r(q.result);});await new Promise(r=>{const tx=c.transaction('records','readwrite');tx.objectStore('records').delete(id);tx.oncomplete=r;});},source.id);
 await page.locator('#phisReload').click();await page.waitForFunction(()=>document.querySelector('.phis-row')?.textContent.includes('기기 원본 없음'));
 check('source deletion preserves request snapshot',(await readJob()).snapshot.memoText===job.snapshot.memoText);
 await page.evaluate(async e=>{const c=await new Promise(r=>{const q=indexedDB.open('vhm-consultations-v1',1);q.onsuccess=()=>r(q.result);});await new Promise(r=>{const tx=c.transaction('records','readwrite');tx.objectStore('records').put(e);tx.oncomplete=r;});},source);
 // Modify the same source ID only in the fake test to exercise version checks.
 await page.evaluate(async s=>{const connection=await new Promise(r=>{const q=indexedDB.open('vhm-consultations-v1',1);q.onsuccess=()=>r(q.result);});const tx=connection.transaction('records','readwrite');const e=await new Promise(r=>{const q=tx.objectStore('records').get(s.id);q.onsuccess=()=>r(q.result);});e.encrypted+='changed';tx.objectStore('records').put(e);},source);
 await page.locator('#phisReload').click();await page.waitForFunction(()=>document.querySelector('.phis-row')?.textContent.includes('원본 변경'));await page.locator('.phis-row input[type=checkbox]').check();await page.locator('#phisPrepare').click();await page.waitForFunction(()=>document.querySelector('#phisNotice').textContent.includes('제외 1건'));
 check('source change is detected and blocks preparation',(await readJob()).sourceFingerprint===job.sourceFingerprint&&(await readJob()).snapshot.memoText===job.snapshot.memoText);
 // Restore source fixture and forge an untrusted success flag: it must not display as completion.
 await page.evaluate(async e=>{const c=await new Promise(r=>{const q=indexedDB.open('vhm-consultations-v1',1);q.onsuccess=()=>r(q.result);});c.transaction('records','readwrite').objectStore('records').put(e);},source);
 await page.evaluate(async e=>{let j=await SERVER.openPhisJob(e.encrypted);j.status='completed';j.error={type:'가상 오류',message:'가상 확인 메시지'};const sealed=await SERVER.sealPhisJob(j);const c=await new Promise(r=>{const q=indexedDB.open('vhm-phis-requests-v1',1);q.onsuccess=()=>r(q.result);});c.transaction('jobs','readwrite').objectStore('jobs').put({...e,encrypted:sealed.encrypted});},(await envelopes())[0]);
 await page.locator('#phisState').selectOption('');await page.locator('#phisReload').click();await page.waitForFunction(()=>document.querySelector('.phis-row')?.textContent.includes('처리 결과 미검증'));
 check('forged client success is rendered as review, never input complete',!(await page.locator('.phis-row').innerText()).includes('입력 완료')&&(await page.locator('.phis-row').innerText()).includes('검토 필요'));
 await page.locator('.phis-row button').click();await page.waitForSelector('#phisDialog[open]');
 check('error text is visible only in authenticated detail',(await page.locator('#phisDialog').innerText()).includes('가상 확인 메시지'));
 check('execution and retry remain disabled without an approved worker',await page.getByRole('button',{name:'PHIS 실행 (미연동)',exact:true}).last().isDisabled()&&await page.getByRole('button',{name:'승인된 처리기로 재시도',exact:true}).isDisabled());
 await page.locator('#phisDialog .dlg-head button').click();
 const forbidden=await page.evaluate(async()=>{try{VHM_PHIS_MODEL.change({...(await SERVER.openPhisJob((await new Promise(r=>{const o=indexedDB.open('vhm-phis-requests-v1',1);o.onsuccess=()=>{const q=o.result.transaction('jobs').objectStore('jobs').getAll();q.onsuccess=()=>r(q.result[0]);};})).encrypted)),status:'pending'},'worker_result',new Date().toISOString(),{verified:true,connected:true});return false;}catch(e){return true;}});
 check('client supplied verified/success flags cannot enable a worker',forbidden&&await page.evaluate(()=>PHIS.capability.execution===false));
 for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:900});check('PHIS management fits '+width+'px',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.evaluate(()=>SERVER.lockNow());check('locking removes decrypted jobs and preview',await page.locator('.phis-row').count()===0&&await page.locator('#phisDialog[open]').count()===0);
 check('encrypted PHIS queue survives lock',(await envelopes()).length===1);
 check('no console disclosure of identities or note',!logs.some(t=>t.includes('가상 대상자')||t.includes('1950-01-02')||t.includes('가상 상담 원문')));
 check('no JavaScript errors',errors.length===0);console.log('TOTAL '+checks+' PHIS assertions passed');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
