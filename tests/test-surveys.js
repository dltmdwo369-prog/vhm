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
 await page.locator('[data-tab="note"]').click();
 const scope=await page.evaluate(()=>SERVER.consultationScope());
 check('five questionnaire buttons below memo writing',await page.locator('#surveyButtons button').count()===5);
 for(const id of ['phq','sgds','frail','cancer','disability']){
  await page.locator(`[data-survey="${id}"]`).click();
  await page.locator('#surveyName').fill('가상대상자-'+id);
  const first=page.locator('#surveyEditor input[data-q="0"]').first();await first.check();
  await page.locator('#surveySave').click();await page.waitForFunction(()=>!document.querySelector('#surveySave').disabled);
 }
 let list=await page.evaluate(s=>CONSULTATIONS._listLocal(s),scope);
 check('five independent numbered saves',list.length===5&&list.every((e,i)=>e.slot===i+1));
 const decoded=await page.evaluate(async s=>Promise.all((await CONSULTATIONS._listLocal(s)).map(e=>SERVER.openConsultation(e.encrypted))),scope);
 check('all forms preserve name and checked answers without unrelated memo',decoded.every(r=>r.survey.name==='가상대상자-'+r.survey.form&&r.survey.answers[0]!==null&&r.note.out===''&&r.strokes.length===0));
 check('names and responses encrypted at rest',!JSON.stringify(list).includes('가상대상자'));
 check('name and form visible in saved list',await page.locator('#consultList').innerText().then(t=>t.includes('가상대상자-phq')&&t.includes('PHQ-9')));
 await page.locator('#consultList .row').first().getByRole('button',{name:'열기',exact:true}).click();
 check('saved form reopens with original name and response',await page.locator('#surveyName').inputValue()==='가상대상자-phq'&&await page.locator('#surveyEditor [data-q="0"]').first().isChecked());
 const scores=await page.evaluate(()=>{
  const make=id=>({form:id,name:'가상',answers:VHM_SURVEYS.find(f=>f.id===id).fields.map(q=>q.options?(q.multi?[]:0):'')});
  const p=make('phq');p.answers.fill(3,0,9);const s=make('sgds');[0,4,6,10,12].forEach(i=>s.answers[i]=1);return [SURVEYS.score(p),SURVEYS.score(s)];
 });
 check('PHQ and SGDS score with reversed SGDS items',scores[0].includes('27점')&&scores[1].includes('15점'));
 await page.evaluate(()=>{VHM_AUTH.hasDrive=true;});
 await page.locator('#consultSync').click();await page.waitForFunction(()=>!document.querySelector('#consultSync').disabled);
 check('Drive sync uploads encrypted questionnaires',uploads===5&&[...files.values()].filter(f=>f.meta.appProperties?.vhmType==='consultation-v1').length===5);
 // Delete fake-Drive originals and verify permanent deletion using deletion-aware harness.
 for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:900});check('questionnaire fits '+width+'px',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.evaluate(()=>SERVER.lockNow());
 check('locking clears questionnaire names and answers from UI',await page.locator('#surveyName').count()===0&&!await page.locator('#consultList').innerText().then(t=>t.includes('가상대상자')));
 check('schema rejects invalid options',await page.evaluate(d=>{d.survey.answers[0]=999;try{CONSULTATIONS.validate(d);return false;}catch(_){return true;}},decoded[0]));
 check('no JS errors',errors.length===0);

 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
