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
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/*',r=>r.request().url().startsWith('http://localhost:')?r.continue():r.abort());
 await page.route('https://www.googleapis.com/**',async route=>{
  const req=route.request(),u=new URL(req.url()),method=req.method(),p=u.pathname;
  let status=200,data={};const json=()=>JSON.parse(req.postData()||'{}');
  if(p==='/calendar/v3/users/me/calendarList')data={items:cals};
  else if(p==='/drive/v3/files'&&method==='GET')data={files:[{id:'folder',name:'방문건강관리 연계',mimeType:'application/vnd.google-apps.folder'}]};
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
 });
 await page.goto('http://localhost:'+server.address().port+'/');
 await page.evaluate(()=>{VHM_AUTH.token='tok-fake';VHM_AUTH.exp=Date.now()+3600000;VHM_AUTH.hasDrive=true;S.selected='2026-11-16';});
 const before=uploads;
 const rejected=await page.evaluate(async()=>{try{await SERVER.uploadMemoImage(new File(['x'],'fake.png',{type:'image/png'}));return false;}catch(e){return !!e.lockNeeded;}});
 check('locked image upload is rejected before network write',rejected&&uploads===before);
 await page.evaluate(()=>SERVER.lockSetup('fake-image-password-123'));
 await page.evaluate(()=>MEMOLOCK.refresh());
 await page.evaluate(()=>openEvent(null,{kind:'personal',title:'가상 이미지 일정'}));
 const input=page.locator('#memoImageInput');
 await input.setInputFiles({name:'가상 <img onerror=alert(1)>.png',mimeType:'image/png',buffer:PNG});
 check('selection stays local until save',uploads===0 && await page.locator('#memoImageList button').count()===2);
 await page.locator('#memoImageList button').first().click();
 check('filename is text, not injected HTML',await page.locator('#memoImagePreview p img').count()===0);
 await page.locator('#memoImagePreview button').click();
 await page.locator('#btnSave').click();await page.waitForFunction(()=>!S.saving);
 const saved=[...events.values()].find(e=>e.summary==='가상 이미지 일정');
 check('calendar save persists opaque attachment reference',saved&&JSON.parse(saved.extendedProperties.private.vhm_images).length===1);
 const id=JSON.parse(saved.extendedProperties.private.vhm_images)[0],file=files.get(id);
 check('Drive receives encrypted bytes and opaque filename',file.body.startsWith('vhm-image1:')&&!file.body.includes('가상')&&!file.body.includes(PNG.toString('base64'))&&file.meta.name.startsWith('memo-image-')&&file.meta.mimeType==='application/octet-stream');
 check('no public permissions or plaintext calendar attachment',!saved.attachments&&!JSON.stringify(saved).includes('onerror'));
 const roundtrip=await page.evaluate(async id=>{const f=await SERVER.readMemoImage(id);return {name:f.name,mime:f.blob.type,bytes:Array.from(new Uint8Array(await f.blob.arrayBuffer()))};},id);
 check('decrypt restores original image bytes and filename',Buffer.from(roundtrip.bytes).equals(PNG)&&roundtrip.name.includes('가상')&&roundtrip.mime==='image/png');
 const preserve=await page.evaluate(async id=>{const e=await SERVER.getEvent(id);delete e.imageIds;const r=await SERVER.saveEvent(e);return r.ok&&r.event.imageIds.length===1;},saved.id);
 check('legacy callers preserve attachments when field is omitted',preserve);
 const conflict=await page.evaluate(async id=>{const e=await SERVER.getEvent(id);e.updated='stale';return (await SERVER.saveEvent(e)).conflict;},saved.id);
 check('stale Calendar revision does not overwrite image links',conflict&&JSON.parse(events.get(saved.id).extendedProperties.private.vhm_images)[0]===id);
 const backup=await page.evaluate(async()=>JSON.parse((await SERVER.exportBackup('2026-11-01','2026-11-30')).json));
 check('backup includes attachment references, not plaintext image',backup.events.some(e=>e.imageIds&&e.imageIds.includes(id))&&!JSON.stringify(backup).includes(PNG.toString('base64')));
 await page.evaluate(async id=>{await loadEvents();SERVER.lockNow();openEvent(S.events.find(e=>e.id===id));},saved.id);
 check('locked existing event retains image references',await page.evaluate(()=>readForm().imageIds.length===1));
 check('locked image read denied',await page.evaluate(async id=>{try{await SERVER.readMemoImage(id);return false;}catch(e){return !!e.lockNeeded;}},id));
 await page.evaluate(()=>SERVER.lockUnlock('fake-image-password-123'));await page.evaluate(()=>MEMOLOCK.refresh());
 await page.locator('#memoImageList button').first().click();
 await page.waitForSelector('#memoImagePreview[open]');
 check('saved image preview works after unlock',await page.locator('#memoImagePreview img').evaluate(el=>el.src.startsWith('blob:')));
 const downloadPromise=page.waitForEvent('download');await page.locator('#memoImagePreview a').click();const download=await downloadPromise;
 check('download restores original bytes',fs.readFileSync(await download.path()).equals(PNG));
 await page.locator('#memoImagePreview button').click();
 const original=file.body;file.body=original.slice(0,-4)+'AAAA';
 check('tampered ciphertext is rejected',await page.evaluate(async id=>{try{await SERVER.readMemoImage(id);return false;}catch(e){return true;}},id));file.body=original;
 await page.locator('#memoImageList button').last().click();
 await page.waitForFunction(()=>document.querySelector('#memoImageList').children.length===0);
 await page.locator('#btnSave').click();await page.waitForFunction(()=>!S.saving);
 check('unlink saves empty references without deleting Drive file',JSON.parse(events.get(saved.id).extendedProperties.private.vhm_images).length===0&&files.has(id));
 await page.evaluate(()=>openEvent(null,{kind:'personal',title:'가상 실패 재시도'}));
 await input.setInputFiles({name:'fake.png',mimeType:'image/png',buffer:PNG});failed=true;
 await page.locator('#btnSave').click();await page.waitForFunction(()=>!S.saving);
 check('upload failure keeps dialog and selection for retry',await page.locator('#eventDlg').evaluate(d=>d.open)&&await page.locator('#memoImageList button').count()===2);
 calendarFail=true;
 await page.locator('#btnSave').click();await page.waitForFunction(()=>!S.saving);const count=uploads;
 await page.locator('#btnSave').click();await page.waitForFunction(()=>!S.saving);
 check('Calendar failure retry reuses uploaded encrypted file',uploads===count&&[...events.values()].some(e=>e.summary==='가상 실패 재시도'));
 await page.evaluate(()=>openEvent(null,{kind:'personal',title:'가상 취소'}));await input.setInputFiles({name:'fake.png',mimeType:'image/png',buffer:PNG});const cancelCount=uploads;
 await page.locator('#eventDlg [data-close]').first().click();await page.waitForTimeout(20);
 check('cancel before save uploads nothing and clears selection',uploads===cancelCount&&await page.evaluate(()=>MEMO_IMAGES.read().imageIds.length===0));
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:900});await page.evaluate(()=>openEvent(null,{kind:'personal',title:'가상 모바일'}));
  await input.setInputFiles({name:'가상'.repeat(60)+'.png',mimeType:'image/png',buffer:PNG});
  check('image controls fit '+width+'px',await page.evaluate(()=>document.querySelector('#eventDlg').scrollWidth<=document.querySelector('#eventDlg').clientWidth));
  await page.locator('#eventDlg [data-close]').first().click();await page.waitForTimeout(10);
 }
 await page.evaluate(()=>openEvent(null,{kind:'personal',title:'가상 형식'}));
 await input.setInputFiles({name:'fake.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});
 check('active SVG format is rejected',await page.locator('#memoImageList button').count()===0);
 await input.setInputFiles({name:'huge.png',mimeType:'image/png',buffer:Buffer.alloc(5*1048576+1)});
 check('oversized file is rejected',await page.locator('#memoImageList button').count()===0);
 const spoof=await page.evaluate(async()=>{try{await SERVER.uploadMemoImage(new File(['<svg/>'],'fake.png',{type:'image/png'}));return false;}catch(e){return true;}});
 check('spoofed MIME is rejected by byte signature',spoof);
 await input.setInputFiles(Array.from({length:4},(_,i)=>({name:'fake'+i+'.png',mimeType:'image/png',buffer:PNG})));
 check('more than three images rejected without partial selection',await page.locator('#memoImageList button').count()===0);
 await page.locator('#eventDlg [data-close]').first().click();await page.waitForTimeout(10);
 await page.evaluate(()=>openEvent(null,{kind:'personal'}));await input.setInputFiles({name:'only-image.png',mimeType:'image/png',buffer:PNG});
 const beforeOnly=events.size;await page.locator('#btnSave').click();await page.waitForFunction(()=>!S.saving);
 check('personal memo can save an image without text or title',events.size===beforeOnly+1);
 const corrupt=await page.evaluate(async()=>{const first=await SERVER.saveEvent({kind:'personal',date:'2026-11-16',title:'가상 손상 목록',imageIds:null,imageIdsRaw:'old-unreadable-data'});const e=await SERVER.getEvent(first.event.id);e.title='가상 손상 보존';const r=await SERVER.saveEvent(e);return r.event.imageIds===null&&r.event.imageIdsRaw==='old-unreadable-data';});
 check('unreadable attachment metadata is preserved on edit',corrupt);
 await page.evaluate(()=>{openEvent(null,{kind:'personal',title:'가상 업로드 중 취소'});window.__realUpload=SERVER.uploadMemoImage;SERVER.uploadMemoImage=async f=>{const id=await window.__realUpload(f);await new Promise(r=>window.__finishUpload=r);return id;};});
 await input.setInputFiles({name:'cancel-during-upload.png',mimeType:'image/png',buffer:PNG});
 await page.locator('#btnSave').click();await page.waitForFunction(()=>typeof window.__finishUpload==='function');
 await page.locator('#eventDlg [data-close]').first().click();await page.waitForTimeout(10);await page.evaluate(()=>window.__finishUpload());await page.waitForFunction(()=>!S.saving);
 check('cancel during upload never saves or links the cancelled event',![...events.values()].some(e=>e.summary==='가상 업로드 중 취소')&&await page.evaluate(()=>MEMO_IMAGES.read().imageIds.length===0));
 await page.evaluate(()=>{SERVER.uploadMemoImage=window.__realUpload;openEvent(null,{kind:'personal',title:'가상 로그아웃'});});await input.setInputFiles({name:'signout.png',mimeType:'image/png',buffer:PNG});
 await page.evaluate(()=>VHM_AUTH.signOut());
 check('signout clears pending images',await page.evaluate(()=>!MEMO_IMAGES.hasPending()&&MEMO_IMAGES.read().imageIds.length===0));
 check('no JavaScript errors',errors.length===0);
 console.log('TOTAL '+checks+' memo image assertions passed');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
