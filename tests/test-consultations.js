// Fake Google Calendar/Drive only; no account, patient data, or external service.
const {chromium} = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert/strict');
const ROOT = path.join(__dirname,'..');
const files = new Map(), events = new Map(); let seq=0, uploads=0, failed=false, calendarFail=false;
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
    const meta=JSON.parse(parts[0]),id='file'+(++seq);files.set(id,{meta,body:parts[1]});uploads++;data={id};
   }
  }
  else if(p.startsWith('/drive/v3/files/')&&method==='DELETE'){files.delete(p.split('/').pop());return route.fulfill({status:204});}
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

 await page.evaluate(async()=>{VHM_AUTH.hasDrive=false;await SERVER.lockSetup('fake-consult-password-123');await MEMOLOCK.refresh();await NOTES.open();});
 await page.locator('[data-tab="note"]').click();
 const ctx=page.context();
 await page.locator('.nt-row:has(.nt-label:text-is("수면")) .nt-chip:text-is("불량")').click();
 await page.locator('.nt-row:has(.nt-label:text-is("수면")) .nt-notes input').fill('가상 수면 코멘트');
 await page.locator('.nt-row:has(.nt-label:text-is("Vital")) input[data-k="0"]').fill('130');
 await page.locator('#ntOut').fill('가상 상담 원문 <img src=x onerror=alert(1)>');
 const scope=await page.evaluate(()=>SERVER.consultationScope());
 check('typing does not auto-save patient content',await page.evaluate(async scope=>(await CONSULTATIONS._listLocal(scope)).length===0,scope));
 await page.locator('#consultBoard summary').click();
 async function draw(p){const box=await p.locator('#consultCanvas').boundingBox();await p.mouse.move(box.x+30,box.y+30);await p.mouse.down();await p.mouse.move(box.x+100,box.y+80,{steps:8});await p.mouse.up();}
 await draw(page);
 await page.locator('#consultMemoSave').click();await page.waitForFunction(()=>document.querySelector('#consultStatus').textContent.includes('기기 저장 완료'));
 let list=await page.evaluate(scope=>CONSULTATIONS._listLocal(scope),scope);
 check('first explicit save is numbered 저장1',list.length===1&&list[0].slot===1);
 check('local storage contains ciphertext, not typed content',list[0].encrypted.startsWith('vhm-consult1:')&&!JSON.stringify(list).includes('가상 상담'));
 const firstEncrypted=list[0].encrypted;
 const first=await page.evaluate(async r=>SERVER.openConsultation(r.encrypted),list[0]);
 check('text and handwriting are saved together',first.note.out.includes('가상 상담')&&first.strokes.length===1&&first.strokes[0].points.length>1);
 check('save does not upload to Drive automatically',uploads===0);
 await ctx.setOffline(true);
 await page.locator('#ntOut').fill('가상 오프라인 상담');await page.locator('#consultMemoSave').click();
 await page.waitForFunction(()=>document.querySelector('#consultStatus').textContent.includes('저장2 기기 저장 완료'));
 list=await page.evaluate(scope=>CONSULTATIONS._listLocal(scope),scope);
 check('already-unlocked page can save offline',list.length===2&&list[1].slot===2);
 await ctx.setOffline(false);
 await page.locator('#ntClear').click();
 check('next target clears draft without deleting saved records',await page.locator('#ntOut').inputValue()===''&&(await page.evaluate(scope=>CONSULTATIONS._listLocal(scope),scope)).length===2);
 await page.locator('#consultMemoShow').click();await page.waitForFunction(()=>document.querySelector('#consultList').children.length===2);
 await page.evaluate(()=>{NOTES._state.tpl.items[0].label='가상 사용자 질문';localStorage.setItem('vhm-notes-tpl',JSON.stringify(NOTES._state.tpl));});
 await page.getByRole('button',{name:'저장1 상담메모 열기',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#ntOut').value.includes('가상 상담 원문'));
 check('load restores exact edited text without executing markup',await page.locator('#ntOut').inputValue()===first.note.out&&await page.locator('#tab-note img[src=x]').count()===0);
 const loaded=await page.evaluate(()=>NOTES.snapshot());
 check('questionnaire picks and original template restore',JSON.stringify(loaded.pick)===JSON.stringify(first.note.pick)&&JSON.stringify(loaded.lead)===JSON.stringify(first.note.lead)&&loaded.tpl.items.length===first.note.tpl.items.length);
 check('loading old template keeps newer saved preferences intact',await page.evaluate(()=>JSON.parse(localStorage.getItem('vhm-notes-tpl')).items[0].label)==='가상 사용자 질문'&&loaded.tpl.items[0].label===first.note.tpl.items[0].label);
 await page.locator('#consultSave').click();await page.waitForFunction(()=>document.querySelector('#consultStatus').textContent.includes('저장3 기기 저장 완료'));
 list=await page.evaluate(scope=>CONSULTATIONS._listLocal(scope),scope);
 check('resaving creates a new slot and preserves original ciphertext',list.length===3&&list[0].encrypted===firstEncrypted&&list[2].slot===3);
 await page.evaluate(()=>VHM_AUTH.hasDrive=true);
 await page.locator('#consultList > div').first().getByRole('button',{name:'Drive에 복사',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#consultStatus').textContent.includes('Drive 복사 완료'));
 const copied=uploads;
 check('explicit Drive copy contains only encrypted record',files.size===1&&[...files.values()][0].body.startsWith('vhm-consult1:')&&!JSON.stringify([...files.values()]).includes('가상 상담'));
 await page.locator('#consultList > div').first().getByRole('button',{name:'Drive에 복사',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#consultSave').disabled===false);
 check('duplicate Drive copy does not upload twice',uploads===copied);
 const p2=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
 p2.on('dialog',d=>d.accept());p2.on('pageerror',e=>errors.push(e.message));
 await p2.route('**/*',r=>r.request().url().startsWith('http://localhost:')?r.continue():r.abort());await p2.route('https://www.googleapis.com/**',google);
 await p2.goto('http://localhost:'+server.address().port+'/');
 await p2.evaluate(async()=>{VHM_AUTH.token='tok-fake';VHM_AUTH.exp=Date.now()+3600000;VHM_AUTH.hasDrive=false;await SERVER.lockUnlock('fake-consult-password-123');await MEMOLOCK.refresh();await NOTES.open();VHM_AUTH.hasDrive=true;});
 await p2.locator('[data-tab="note"]').click();
 await p2.locator('#consultImport').click();await p2.waitForFunction(()=>document.querySelector('#consultStatus').textContent.includes('Drive에서 1개 추가'));
 check('another device imports the encrypted record with the same key',await p2.evaluate(async scope=>(await CONSULTATIONS._listLocal(scope)).length===1,scope));
 await p2.locator('#consultList > div').first().getByRole('button',{name:'열기',exact:true}).click();await p2.waitForFunction(()=>document.querySelector('#ntOut').value.includes('가상 상담'));
 check('another device restores handwriting and text',await p2.locator('#ntOut').inputValue()===first.note.out&&await p2.locator('#consultBoard').evaluate(el=>el.open));
 await p2.locator('#consultImport').click();await p2.waitForFunction(()=>document.querySelector('#consultStatus').textContent.includes('Drive에서 0개 추가'));
 check('repeated import is deduplicated',await p2.evaluate(async scope=>(await CONSULTATIONS._listLocal(scope)).length===1,scope));
 await p2.locator('#consultFinger').check();
 await p2.locator('#consultCanvas').scrollIntoViewIfNeeded();const touchBox=await p2.locator('#consultCanvas').boundingBox();
 const finger=await p2.context().newCDPSession(p2);const x=touchBox.x+30,y=touchBox.y+30;
 await finger.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await finger.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+40,y:y+40}]});await finger.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await p2.locator('#consultSave').click();await p2.waitForFunction(()=>document.querySelector('#consultStatus').textContent.includes('기기 저장 완료'));
 const fingerRecord=await p2.evaluate(async scope=>{const rows=await CONSULTATIONS._listLocal(scope);return SERVER.openConsultation(rows.at(-1).encrypted);},scope);
 check('mobile touch gestures produce saved handwriting',fingerRecord.strokes.length>first.strokes.length);

 const remote=[...files.values()][0], original=remote.body;remote.body=original.slice(0,-4)+'AAAA';
 await p2.locator('#consultImport').click();await p2.waitForFunction(()=>document.querySelector('#consultStatus').textContent.includes('읽기 실패'));
 check('tampered file does not replace or clear local record',await p2.evaluate(async scope=>(await CONSULTATIONS._listLocal(scope)).length===2,scope));remote.body=original;
 await page.locator('#consultList > div').last().getByRole('button',{name:'Drive에서도 삭제',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#consultStatus').textContent.includes('이 기기와 Drive에서 삭제했습니다'));
 await page.locator('#consultSave').click();await page.waitForFunction(()=>document.querySelector('#consultStatus').textContent.includes('저장4 기기 저장 완료'));
 check('deleted numbers are not reused', (await page.evaluate(scope=>CONSULTATIONS._listLocal(scope),scope)).some(r=>r.slot===4));
 const tplBefore=await page.evaluate(()=>localStorage.getItem('vhm-notes-tpl'));
 await page.locator('#ntClear').click();
 check('loading saved template never overwrites questionnaire preferences',await page.evaluate(()=>localStorage.getItem('vhm-notes-tpl'))===tplBefore);
 check('next target returns to the current user questionnaire',await page.evaluate(()=>NOTES._state.tpl.items[0].label)==='가상 사용자 질문');
 for(const w of [1440,768,390,320]){
  await page.setViewportSize({width:w,height:900});await page.evaluate(()=>NOTES.open());
  check('save and handwriting controls fit '+w+'px',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 await page.locator('#consultBoard').evaluate(d=>d.open=true);await page.locator('#consultCanvas').waitFor({state:'visible'});await draw(page);
 await page.locator('#consultUndo').click();
 check('undo removes a handwriting stroke',await page.evaluate(()=>{const c=document.querySelector('#consultCanvas'),data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return !data.some((v,i)=>i%4===3&&v);}));
 await draw(page);await page.locator('#consultEraser').click();await draw(page);
 await page.locator('#consultSave').click();await page.waitForFunction(()=>document.querySelector('#consultStatus').textContent.includes('기기 저장 완료'));
 list=await page.evaluate(scope=>CONSULTATIONS._listLocal(scope),scope);const ink=await page.evaluate(async r=>SERVER.openConsultation(r.encrypted),list.at(-1));
 check('eraser strokes survive save as editable vectors',ink.strokes.some(s=>s.tool==='erase'));
 await page.evaluate(()=>SERVER.lockNow());
 check('locking clears decrypted text and handwriting',await page.locator('#ntOut').inputValue()===''&&await page.locator('#consultList').evaluate(el=>el.children.length===0));
 check('locked records cannot be decrypted',await page.evaluate(async encrypted=>{try{await SERVER.openConsultation(encrypted);return false;}catch(e){return !!e.lockNeeded;}},list[0].encrypted));
 check('locking never deletes encrypted saved records',(await page.evaluate(scope=>CONSULTATIONS._listLocal(scope),scope)).length===list.length);
 await page.evaluate(async()=>{await SERVER.lockUnlock('fake-consult-password-123');await MEMOLOCK.refresh();});
 const malformed={...first,strokes:[{tool:'pen',color:'#183f35',width:3,points:[[NaN,0]]}]};
 check('malformed handwriting coordinates rejected',await page.evaluate(r=>{try{CONSULTATIONS.validate(r);return false;}catch(e){return true;}},malformed));
 await page.reload();await page.evaluate(async()=>{VHM_AUTH.token='tok-fake';VHM_AUTH.exp=Date.now()+3600000;VHM_AUTH.hasDrive=false;await SERVER.lockUnlock('fake-consult-password-123');await MEMOLOCK.refresh();await NOTES.open();});await page.locator('[data-tab="note"]').click();
 await page.locator('#consultShow').click();await page.waitForFunction(()=>document.querySelector('#consultList').children.length>0);
 check('encrypted saves survive reload without restoring plaintext automatically',(await page.evaluate(scope=>CONSULTATIONS._listLocal(scope),scope)).length===list.length&&await page.locator('#ntOut').inputValue()==='');
 const extra=await ctx.newPage();await extra.route('**/*',r=>r.request().url().startsWith('http://localhost:')?r.continue():r.abort());await extra.route('https://www.googleapis.com/**',google);
 await extra.goto('http://localhost:'+server.address().port+'/');await extra.evaluate(async()=>{VHM_AUTH.token='tok-fake';VHM_AUTH.exp=Date.now()+3600000;VHM_AUTH.hasDrive=false;await SERVER.lockUnlock('fake-consult-password-123');await MEMOLOCK.refresh();await NOTES.open();});await extra.locator('[data-tab="note"]').click();
 await extra.locator('#ntOut').fill('가상 동시 저장 B');await page.locator('#ntOut').fill('가상 동시 저장 A');
 const beforeConcurrent=(await page.evaluate(scope=>CONSULTATIONS._listLocal(scope),scope)).length;
 await Promise.all([page.locator('#consultSave').click(),extra.locator('#consultSave').click()]);await Promise.all([page.waitForFunction(()=>document.querySelector('#consultSave').disabled===false),extra.waitForFunction(()=>document.querySelector('#consultSave').disabled===false)]);
 const afterConcurrent=await page.evaluate(scope=>CONSULTATIONS._listLocal(scope),scope);
 check('simultaneous tabs allocate distinct slots without overwriting',afterConcurrent.length===beforeConcurrent+2&&new Set(afterConcurrent.map(r=>r.slot)).size===afterConcurrent.length);
 await extra.close();
 const connection=await page.evaluate(async()=>{const old=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...a){if(a[1]==='readwrite')throw new DOMException('fake quota','QuotaExceededError');return old.apply(this,a);};return true;});
 await page.locator('#ntOut').fill('가상 저장 실패');await page.locator('#consultSave').click();await page.waitForFunction(()=>document.querySelector('#consultStatus').textContent.includes('fake quota'));
 check('failed storage write never reports success or loses prior records',(await page.evaluate(scope=>CONSULTATIONS._listLocal(scope),scope)).length===afterConcurrent.length&&await page.locator('#ntOut').inputValue()==='가상 저장 실패');
 check('no JavaScript errors',errors.length===0);
 console.log('TOTAL '+checks+' consultation assertions passed');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
