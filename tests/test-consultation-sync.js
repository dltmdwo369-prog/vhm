// Fake Google Calendar/Drive only; no account, patient data, or external service.
const {chromium} = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert/strict');
const ROOT = path.join(__dirname,'..');
const files = new Map(), events = new Map(); let seq=0, uploads=0, failed=false, calendarFail=false, corruptUpload=false;
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
   if(q.includes('appProperties'))data={files:[...files].filter(([id,f])=>f.meta.appProperties?.vhmType==='consultation-v1').map(([id,f])=>({id,name:f.meta.name}))};
   else if(q.includes('방문건강관리 연계자료'))data={files:[{id:'folder',name:'방문건강관리 연계자료',mimeType:'application/vnd.google-apps.folder'}]};
   else{const name=/name = '([^']+)'/.exec(q)?.[1];data={files:[...files].filter(([id,f])=>f.meta.name===name).map(([id,f])=>({id,name:f.meta.name}))};}
  }
  else if(p==='/upload/drive/v3/files'&&method==='POST'){
   if(failed){failed=false;status=503;data={error:{message:'fake upload failure'}};}
   else{
    const body=req.postDataBuffer().toString('utf8'),boundary=/boundary=([^;]+)/.exec(req.headers()['content-type'])[1];
    const parts=body.split('--'+boundary).slice(1,-1).map(x=>x.slice(x.indexOf('\r\n\r\n')+4,-2));
    const meta=JSON.parse(parts[0]),id='file'+(++seq);files.set(id,{meta,body:parts[1]});if(corruptUpload&&meta.appProperties?.vhmType==='consultation-v1'){corruptUpload=false;files.get(id).body+='corrupt';}uploads++;data={id};
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


 await page.evaluate(async()=>{VHM_AUTH.hasDrive=false;await SERVER.lockSetup('fake-consult-password-123');await MEMOLOCK.refresh();await NOTES.open();});await page.locator('[data-tab="note"]').click();
 const scope=await page.evaluate(()=>SERVER.consultationScope()),ctx=page.context();
 const rows=p=>p.evaluate(scope=>CONSULTATIONS._listLocal(scope),scope);
 const cloud=()=>[...files.values()].filter(f=>f.meta.appProperties?.vhmType==='consultation-v1');
 async function save(p,text){await p.locator('#ntOut').fill(text);await p.locator('#consultMemoSave').click();await p.waitForFunction(()=>!document.querySelector('#consultMemoSave').disabled);}
 await page.locator('#consultBoard summary').click();const ink=await page.locator('#consultCanvas').boundingBox();await page.mouse.move(ink.x+30,ink.y+30);await page.mouse.down();await page.mouse.move(ink.x+80,ink.y+60);await page.mouse.up();
 await save(page,'가상 태블릿 기존 메모1');await page.locator('#ntClear').click();await save(page,'가상 태블릿 기존 메모2');
 const originals=await rows(page);
 check('old tablet-only saves remain local before Drive connection',originals.length===2&&cloud().length===0);
 await page.evaluate(()=>VHM_AUTH.hasDrive=true);await page.locator('#consultSync').click();await page.waitForFunction(()=>!document.querySelector('#consultSync').disabled);
 check('one sync backfills all old tablet records',cloud().length===2&&(await rows(page)).every(r=>r.remoteId));
 check('backfill never changes existing encrypted notes or numbers',(await rows(page)).every((r,i)=>r.encrypted===originals[i].encrypted&&r.slot===originals[i].slot));
 check('cloud files contain only ciphertext and opaque names',cloud().every(f=>f.body.startsWith('vhm-consult1:')&&!f.body.includes('가상')&&f.meta.name.startsWith('vhm-consult-')));
 const desktop=await browser.newPage({viewport:{width:1440,height:900}});desktop.on('dialog',d=>d.accept());desktop.on('pageerror',e=>errors.push(e.message));
 await desktop.route('**/*',r=>r.request().url().startsWith('http://localhost:')?r.continue():r.abort());await desktop.route('https://www.googleapis.com/**',google);
 await desktop.goto('http://localhost:'+server.address().port+'/');await desktop.evaluate(async()=>{VHM_AUTH.token='tok-fake';VHM_AUTH.exp=Date.now()+3600000;VHM_AUTH.hasDrive=false;await SERVER.lockUnlock('fake-consult-password-123');await MEMOLOCK.refresh();await NOTES.open();});await desktop.locator('[data-tab="note"]').click();await desktop.evaluate(()=>VHM_AUTH.hasDrive=true);
 await desktop.locator('#consultMemoShow').click();await desktop.waitForFunction(()=>!document.querySelector('#consultMemoShow').disabled);
 check('computer saved-list action imports tablet records',(await rows(desktop)).length===2);
 await desktop.getByRole('button',{name:'저장1 상담메모 열기',exact:true}).click();await desktop.waitForFunction(()=>document.querySelector('#ntOut').value.includes('태블릿 기존 메모1'));
 check('computer opens the same text, checks and handwriting',await desktop.locator('#ntOut').inputValue()==='가상 태블릿 기존 메모1'&&await desktop.locator('#consultBoard').evaluate(d=>d.open));
 await page.locator('#ntClear').click();await save(page,'가상 새 저장 동기화');
 check('save with Drive connected automatically uploads encrypted record',cloud().length===3&&(await page.locator('#consultMemoStatus').innerText()).includes('Drive 동기화 완료'));
 await desktop.locator('#ntOut').fill('가상 컴퓨터 작성 중');await desktop.locator('#consultMemoShow').click();await desktop.waitForFunction(()=>!document.querySelector('#consultMemoShow').disabled);
 check('computer refresh discovers the new save without overwriting its draft',(await rows(desktop)).length===3&&await desktop.locator('#ntOut').inputValue()==='가상 컴퓨터 작성 중');
 await ctx.setOffline(true);await save(page,'가상 오프라인 저장');
 check('offline save stays local and clearly pending',cloud().length===3&&(await rows(page)).length===4&&(await page.locator('#consultMemoStatus').innerText()).includes('동기화 대기'));
 await ctx.setOffline(false);await page.locator('#consultMemoSync').click();await page.waitForFunction(()=>!document.querySelector('#consultMemoSync').disabled);
 check('sync retries offline backlog without duplicating old cloud records',cloud().length===4&&(await rows(page)).every(r=>r.remoteId));
 await page.locator('#consultSync').click();await page.waitForFunction(()=>!document.querySelector('#consultSync').disabled);
 check('repeated full sync creates no duplicates',cloud().length===4&&(await rows(page)).length===4);
 failed=true;await save(page,'가상 업로드 실패');
 const failedLocal=await rows(page);
 check('cloud error never loses the saved local note or claims sync success',failedLocal.length===5&&cloud().length===4&&(await page.locator('#consultMemoStatus').innerText()).includes('동기화 대기')&&!(await page.locator('#consultMemoStatus').innerText()).includes('동기화 완료'));
 await page.locator('#consultSync').click();await page.waitForFunction(()=>!document.querySelector('#consultSync').disabled);
 check('failed cloud save can be retried safely',cloud().length===5&&(await rows(page)).every(r=>r.remoteId));
 await page.locator('#consultAutoSync').uncheck();await save(page,'가상 기기 전용 저장');
 check('explicit device-only preference prevents upload',cloud().length===5&&(await rows(page)).length===6&&await page.evaluate(()=>localStorage.getItem('vhm-consultation-save-sync'))==='0');
 await page.locator('#consultSync').click();await page.waitForFunction(()=>!document.querySelector('#consultSync').disabled);
 check('manual sync can still share device-only records',cloud().length===6);
 await desktop.locator('#consultMemoShow').click();await desktop.waitForFunction(()=>!document.querySelector('#consultMemoShow').disabled);
 check('computer receives every backfilled and retried note',(await rows(desktop)).length===6);
 const remote=cloud()[0],original=remote.body;remote.body=original.slice(0,-4)+'AAAA';const beforeBad=await rows(page);
 await page.locator('#consultSync').click();await page.waitForFunction(()=>!document.querySelector('#consultSync').disabled);
 check('corrupt remote never replaces local ciphertext or gets silently overwritten',(await rows(page)).every((r,i)=>r.encrypted===beforeBad[i].encrypted)&&remote.body!==original&&(await page.locator('#consultStatus').innerText()).includes('일부 동기화 실패'));remote.body=original;
 await page.locator('#consultAutoSync').check();
 await Promise.all([save(page,'가상 태블릿 동시 저장'),save(desktop,'가상 컴퓨터 동시 저장')]);
 await page.locator('#consultSync').click();await page.waitForFunction(()=>!document.querySelector('#consultSync').disabled);await desktop.locator('#consultSync').click();await desktop.waitForFunction(()=>!document.querySelector('#consultSync').disabled);
 const left=await rows(page),right=await rows(desktop);
 check('concurrent devices merge all new immutable records',left.length===8&&right.length===8&&new Set(left.map(r=>r.id)).size===8&&left.map(r=>r.id).sort().join()===right.map(r=>r.id).sort().join());
 corruptUpload=true;await save(page,'가상 수신 검증 실패');const verifiedLocal=await rows(page);
 check('server readback mismatch never claims cloud sync success',verifiedLocal.length===9&&!verifiedLocal.at(-1).remoteId&&(await page.locator('#consultMemoStatus').innerText()).includes('동기화 대기'));
 for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:900});await page.evaluate(()=>NOTES.open());check('sync and memo controls fit '+width+'px',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 check('no JavaScript errors',errors.length===0);console.log('TOTAL '+checks+' consultation sync assertions passed');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
