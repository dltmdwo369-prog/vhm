// Fake Google Calendar/Drive only; no account, patient data, or external service.
const {chromium} = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert/strict');
const ROOT = path.join(__dirname,'..');
const files = new Map(), events = new Map(); let seq=0, uploads=0, failed=false, calendarFail=false, corruptUpload=false, failDelete=false, lieDelete=false, failMarker=false, raceDelete=null, lateResurrection=false;
const cals=[{id:'w',summary:'방문건강관리(업무)',accessRole:'owner'},{id:'p',summary:'방문건강관리(개인)',accessRole:'owner'}];
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
    const meta=JSON.parse(parts[0]),id='file'+(++seq);if(failMarker&&meta.appProperties?.vhmType==='consultation-deleted-v1'){failMarker=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'fake marker failure'}})});}files.set(id,{meta,body:parts[1]});if(raceDelete&&meta.appProperties?.vhmType==='consultation-v1'){files.set('race-marker',{meta:{name:'vhm-consult-deleted-'+raceDelete.scope+'-'+raceDelete.id+'.json',appProperties:{vhmType:'consultation-deleted-v1'}},body:'{}'});raceDelete=null;}if(corruptUpload&&meta.appProperties?.vhmType==='consultation-v1'){corruptUpload=false, failDelete=false, lieDelete=false, failMarker=false, raceDelete=null;files.get(id).body+='corrupt';}uploads++;data={id};
   }
  }
  else if(p.startsWith('/drive/v3/files/')&&method==='DELETE'){if(failDelete){failDelete=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'fake delete failure'}})});}const fid=p.split('/').pop(),prior=files.get(fid);if(!lieDelete)files.delete(fid);if(lateResurrection&&prior){lateResurrection=false;files.set('late-copy',structuredClone(prior));}return route.fulfill({status:204});}
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


 await page.evaluate(async()=>{VHM_AUTH.hasDrive=false;await SERVER.lockSetup('fake-delete-password-123');await MEMOLOCK.refresh();await NOTES.open();});await page.locator('[data-tab="note"]').click();
 const scope=await page.evaluate(()=>SERVER.consultationScope());
 const rows=p=>p.evaluate(scope=>CONSULTATIONS._listLocal(scope),scope);
 const cloud=()=>[...files].filter(([id,f])=>f.meta.appProperties?.vhmType==='consultation-v1');
 const markers=()=>[...files].filter(([id,f])=>f.meta.appProperties?.vhmType==='consultation-deleted-v1');
 async function save(p,text){await p.locator('#ntOut').fill(text);await p.locator('#consultMemoSave').click();await p.waitForFunction(()=>!document.querySelector('#consultMemoSave').disabled);}
 async function sync(p){await p.locator('#consultSync').click();await p.waitForFunction(()=>!document.querySelector('#consultSync').disabled);}
 async function drop(p,id){await p.locator('#consultList>div').filter({has:p.locator('[data-phis-source="'+id+'"]')}).getByRole('button',{name:'Drive에서도 삭제',exact:true}).click();await p.waitForFunction(()=>!document.querySelector('#consultSave').disabled);}
 await page.locator('[data-survey="phq"]').click();await page.locator('#surveyName').fill('가상 삭제 대상');await page.locator('#surveyEditor [data-q="0"]').first().check();await page.locator('#surveySave').click();await page.waitForFunction(()=>!document.querySelector('#surveySave').disabled);await save(page,'가상 보존 대상');await page.evaluate(()=>VHM_AUTH.hasDrive=true);await sync(page);
 const initial=await rows(page),target=initial[0],kept=initial[1],cloudTarget=cloud().find(([id,f])=>f.body===target.encrypted);
 // Separate browser storage represents a second device with the same original encryption key.
 const desktop=await browser.newPage();desktop.on('dialog',d=>d.accept());desktop.on('pageerror',e=>errors.push(e.message));
 await desktop.route('**/*',r=>r.request().url().startsWith('http://localhost:')?r.continue():r.abort());await desktop.route('https://www.googleapis.com/**',google);
 await desktop.goto('http://localhost:'+server.address().port+'/');await desktop.evaluate(async()=>{VHM_AUTH.token='tok-fake';VHM_AUTH.exp=Date.now()+3600000;VHM_AUTH.hasDrive=false;await SERVER.lockUnlock('fake-delete-password-123');await MEMOLOCK.refresh();await NOTES.open();});await desktop.locator('[data-tab="note"]').click();await desktop.evaluate(()=>VHM_AUTH.hasDrive=true);await sync(desktop);
 check('questionnaire name and answers survive another device sync',await desktop.evaluate(async s=>{const r=await CONSULTATIONS._listLocal(s);const d=await SERVER.openConsultation(r[0].encrypted);return d.survey.name==='가상 삭제 대상'&&d.survey.answers[0]===0;},scope));
 check('both devices initially contain the same synced records',(await rows(desktop)).length===2&&cloud().length===2);
 files.set('duplicate',{meta:structuredClone(cloudTarget[1].meta),body:target.encrypted});
 let cancelled=false;page.removeAllListeners('dialog');page.once('dialog',d=>{cancelled=d.message().includes('영구 삭제');d.dismiss();});
 await drop(page,target.id);check('cancelling permanent-delete confirmation preserves all copies',cancelled&&(await rows(page)).length===2&&cloud().length===3&&markers().length===0);page.on('dialog',d=>d.accept());
 await page.context().setOffline(true);await drop(page,target.id);check('offline deletion is blocked without losing the local original',(await rows(page)).length===2&&cloud().length===3&&(await page.locator('#consultStatus').innerText()).includes('인터넷과 Drive 연결'));await page.context().setOffline(false);
 failMarker=true;await drop(page,target.id);check('deletion-marker write failure leaves cloud and local originals intact',(await rows(page)).length===2&&cloud().length===3&&markers().length===0);
 await drop(page,target.id);
 check('explicit delete permanently removes every matching Drive copy',!files.has(cloudTarget[0])&&!files.has('duplicate')&&cloud().length===1);
 check('local record is removed only after Drive deletion is verified',(await rows(page)).length===1&&(await rows(page))[0].id===kept.id&&(await page.locator('#consultStatus').innerText()).includes('이 기기와 Drive에서 삭제했습니다'));
 check('unrelated record ciphertext is unchanged',cloud()[0][1].body===kept.encrypted&&(await rows(page))[0].encrypted===kept.encrypted);
 check('deletion marker contains no memo, name, birthdate or ciphertext',markers().length===1&&markers()[0][1].body==='{}'&&!JSON.stringify(markers()).includes('가상')&&!JSON.stringify(markers()).includes('vhm-consult1:'));
 await page.locator('#consultMemoShow').click();await page.waitForFunction(()=>!document.querySelector('#consultMemoShow').disabled);await page.locator('#consultShow').click();await page.waitForFunction(()=>!document.querySelector('#consultShow').disabled);
 check('both saved-list buttons no longer resurrect deleted notes',(await rows(page)).length===1&&cloud().length===1);
 check('offline second device still has its old copy before refresh',(await rows(desktop)).some(e=>e.id===target.id));
 await sync(desktop);check('second device consumes deletion before it can re-upload the stale copy',(await rows(desktop)).length===1&&cloud().length===1);
 let rejected=false;try{await desktop.evaluate(e=>SERVER.copyConsultation(e.id,e.encrypted),target);}catch(_){rejected=true;}
 check('direct stale-copy upload is rejected by the shared deletion marker',rejected&&cloud().length===1);
 // Simulate an outdated client restoring the old encrypted Drive file: new sync must clean it up.
 files.set('legacy-resurrection',{meta:structuredClone(cloudTarget[1].meta),body:target.encrypted});await sync(page);
 check('old-client resurrected cloud copy is removed by the next sync',!files.has('legacy-resurrection')&&(await rows(page)).length===1);
 await page.reload();await page.evaluate(async()=>{VHM_AUTH.token='tok-fake';VHM_AUTH.exp=Date.now()+3600000;VHM_AUTH.hasDrive=false;await SERVER.lockUnlock('fake-delete-password-123');await NOTES.open();});await page.locator('[data-tab="note"]').click();await page.locator('#consultMemoShow').click();await page.waitForFunction(()=>!document.querySelector('#consultMemoShow').disabled);
 check('local deletion survives reload while offline from Drive',(await rows(page)).length===1);
 await page.evaluate(()=>VHM_AUTH.hasDrive=true);
 // Failed DELETE after the marker is durable must not claim completion or discard local data.
 failDelete=true;await drop(page,kept.id);
 check('Drive delete error retains local and cloud originals and reports failure',(await rows(page)).length===1&&cloud().length===1&&!(await page.locator('#consultStatus').innerText()).includes('Drive에서 삭제했습니다'));
 await sync(page);check('retry through synchronization finishes an interrupted delete',(await rows(page)).length===0&&cloud().length===0);
 await save(page,'가상 응답 검증 대상');const verify=(await rows(page))[0];lieDelete=true;await drop(page,verify.id);lieDelete=false;
 check('a successful HTTP DELETE without actual removal is not accepted',(await rows(page)).length===1&&cloud().length===1&&(await page.locator('#consultStatus').innerText()).includes('삭제 여부를 확인하지 못했습니다'));
 await sync(page);check('unverified delete can safely finish later',(await rows(page)).length===0&&cloud().length===0);
 await save(page,'가상 충돌 대상');const conflict=(await rows(page))[0],originalCipher=cloud()[0][1].body;cloud()[0][1].body+='corrupt';const n=markers().length;
 await drop(page,conflict.id);check('changed or corrupt Drive content blocks deletion without a new marker',(await rows(page)).length===1&&cloud().length===1&&markers().length===n);cloud()[0][1].body=originalCipher;
 await drop(page,conflict.id);
 check('deleting one record never resets save-number counters',await page.evaluate(async scope=>{const c=await new Promise(r=>{const q=indexedDB.open('vhm-consultations-v1',1);q.onsuccess=()=>r(q.result);});return new Promise(r=>{const q=c.transaction('counters').objectStore('counters').get(scope);q.onsuccess=()=>r(q.result>=4);});},scope));

 await save(page,'가상 삭제 완료 직전 복사');const late=(await rows(page))[0];lateResurrection=true;await drop(page,late.id);
 check('late concurrent copy prevents false delete completion',(await rows(page)).length===1&&cloud().length===1&&(await page.locator('#consultStatus').innerText()).includes('복사본이 추가되었습니다'));
 await sync(page);check('late concurrent copy is removed on retry',cloud().length===0&&(await rows(page)).length===0);
 await page.evaluate(()=>VHM_AUTH.hasDrive=false);await save(page,'가상 동시 삭제 업로드');const race=(await rows(page))[0];await page.evaluate(()=>VHM_AUTH.hasDrive=true);raceDelete={scope,id:race.id};let raceRejected=false;
 try{await page.evaluate(e=>SERVER.copyConsultation(e.id,e.encrypted),race);}catch(_){raceRejected=true;}
 check('deletion racing with upload removes the just-created cloud file',raceRejected&&cloud().length===0);
 await sync(page);check('racing upload local copy is removed on reconciliation',(await rows(page)).length===0);
 files.set('bad-marker',{meta:{name:'invalid-deletion-marker.json',appProperties:{vhmType:'consultation-deleted-v1'}},body:'{}'});
 await page.evaluate(()=>VHM_AUTH.hasDrive=false);await save(page,'가상 삭제상태 확인 실패');const guarded=(await rows(page))[0];await page.evaluate(()=>VHM_AUTH.hasDrive=true);let guardedUpload=false;
 try{await page.evaluate(e=>SERVER.copyConsultation(e.id,e.encrypted),guarded);}catch(_){guardedUpload=true;}
 check('malformed deletion metadata blocks upload and preserves local originals',guardedUpload&&cloud().length===0&&(await rows(page)).length===1);files.delete('bad-marker');
 for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:900});check('deletion UI fits '+width+'px',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 check('no JavaScript errors',errors.length===0);console.log('TOTAL '+checks+' consultation deletion assertions passed');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
