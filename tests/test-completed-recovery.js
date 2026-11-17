// Calendar-copy-scoped metadata, tombstones, verified transfers and evidence-only recovery.
const {chromium}=require('playwright'),http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const ROOT=path.join(__dirname,'..'),cals=[{id:'w',summary:'방문건강관리(업무)',accessRole:'owner'},{id:'p',summary:'방문건강관리(개인)',accessRole:'owner'},{id:'d',summary:'방문건강관리(완료)',accessRole:'owner'}];
const maps={w:new Map(),p:new Map(),d:new Map()};let seq=0,drop=false,insertFail=false,race=false,repairRace=false,checks=0;const log=[];
const clone=x=>structuredClone(x),touch=e=>{e.etag='"r'+(++seq)+'"';};
function seed(cal,body){const e={status:'confirmed',...clone(body),id:body.id||'ev'+(++seq).toString(16)+'aa'};e.iCalUID=e.iCalUID||e.id+'@fake';touch(e);maps[cal].set(e.id,e);return e;}
function legacyMove(ev,from){const dest=clone(ev);dest.extendedProperties={private:{}};touch(dest);maps.d.set(dest.id,dest);ev.status='cancelled';touch(ev);return dest;}
function check(n,ok){assert.ok(ok,n);console.log('PASS '+n);checks++;}
const server=http.createServer((req,res)=>{if(req.url==='/config.js')return res.end('window.VHM_CONFIG={clientId:""}');const p=path.join(ROOT,'site',req.url==='/'?'index.html':req.url.split('?')[0]);if(!fs.existsSync(p)){res.writeHead(404);return res.end();}res.end(fs.readFileSync(p));});
(async()=>{await new Promise(r=>server.listen(0,r));const browser=await chromium.launch({executablePath:process.env.VHM_CHROMIUM||'/usr/bin/chromium'});try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/*',r=>r.request().url().startsWith('http://localhost:')?r.continue():r.abort());
 await page.route('https://www.googleapis.com/**',async route=>{
  const req=route.request(),u=new URL(req.url()),p=u.pathname,m=req.method(),body=req.postData()?JSON.parse(req.postData()):null;log.push({m,p,body,ifMatch:req.headers()['if-match']});let status=200,result={};
  if(p==='/calendar/v3/users/me/calendarList')result={items:cals};
  else {const match=/^\/calendar\/v3\/calendars\/([^/]+)(?:\/events(?:\/([^/]+))?)?$/.exec(p);if(!match)throw new Error('unhandled fake '+p);const cal=decodeURIComponent(match[1]),id=match[2],store=maps[cal];
   if(!p.includes('/events')){const c=cals.find(x=>x.id===cal);if(m==='PATCH')Object.assign(c,body);result=c;}
   else if(m==='GET'&&!id)result={items:[...store.values()].filter(e=>e.status!=='cancelled'&&(!u.searchParams.get('timeMin')||Date.parse(e.start.dateTime||e.start.date)>=Date.parse(u.searchParams.get('timeMin')))&&(!u.searchParams.get('timeMax')||Date.parse(e.start.dateTime||e.start.date)<Date.parse(u.searchParams.get('timeMax'))))};
   else if(m==='POST'&&!id){
    if(insertFail){insertFail=false;status=503;result={error:{message:'fake insert failure'}};}
    else if(body.id&&store.has(body.id)){status=409;result={error:{message:'duplicate including tombstones'}};}
    else {const e=seed(cal,body);if(drop){drop=false;e.extendedProperties={private:{}};}result=e;
     if(race&&cal==='d'){race=false;const original=maps.w.get(body.id);original.extendedProperties.private.vhm_target='가상 동시 수정';touch(original);}
    }
   }else{const ev=store.get(id);
    if(!ev){status=404;result={error:{message:'missing'}};}
    else if(m==='GET')result=ev;
    else{if(repairRace&&m==='PATCH'&&cal==='d'){repairRace=false;touch(ev);}
     if(req.headers()['if-match']&&req.headers()['if-match']!==ev.etag){status=412;result={error:{message:'concurrent edit'}};}
     else if(m==='PATCH'){for(const [k,v]of Object.entries(body)){if(k==='extendedProperties')ev.extendedProperties={...ev.extendedProperties,private:{...ev.extendedProperties?.private,...v.private}};else ev[k]=clone(v);}touch(ev);result=ev;}
     else if(m==='DELETE'){ev.status='cancelled';touch(ev);status=204;}
    }
   }
  }
  await route.fulfill({status,contentType:'application/json',body:status===204?'':JSON.stringify(result)});
 });
 await page.goto('http://localhost:'+server.address().port+'/');await page.evaluate(()=>{VHM_AUTH.token='tok-fake';VHM_AUTH.exp=Date.now()+3600000;VHM_AUTH.hasDrive=false;});
 const event={kind:'work',date:'2026-11-17',type:'방문',status:'예정',group:'정기관리군',target:'가상 대상-01',birth:'1948',sex:'여',memo:'',reminder:30,imageIds:['fake-image-1']};
 const first=await page.evaluate(e=>SERVER.saveEvent(e),event),firstId=first.event.id;
 maps.w.get(firstId).extendedProperties.private.vhm_future='preserve-unknown';
 const cipher='vhm1:fake-cipher-not-plaintext';maps.w.get(firstId).extendedProperties.private.vhm_memo=cipher;
 const finished=await page.evaluate(async id=>SERVER.setDone(id,true,(await SERVER.getEvent(id)).updated),firstId);
 check('verified completion preserves app classification and all details',finished.ok&&finished.event.fromApp&&finished.event.target==='가상 대상-01'&&finished.event.birth==='1948'&&finished.event.group==='정기관리군');
 const completed=maps.d.get(finished.event.id);
 check('encrypted memo, image references and unknown fields survive',completed.extendedProperties.private.vhm_memo===cipher&&completed.extendedProperties.private.vhm_images==='["fake-image-1"]'&&completed.extendedProperties.private.vhm_future==='preserve-unknown');
 check('source is deleted only after destination readback',maps.w.get(firstId).status==='cancelled'&&log.findIndex(x=>x.m==='GET'&&x.p.endsWith('/d/events/'+completed.id))<log.findIndex(x=>x.m==='DELETE'&&x.p.endsWith('/w/events/'+firstId)));
 check('completion never calls events.move',!log.some(x=>x.p.endsWith('/move')));
 const undone=await page.evaluate(async id=>SERVER.setDone(id,false,(await SERVER.getEvent(id)).updated),completed.id);
 check('undo handles cancelled-ID conflict without losing UID or details',undone.ok&&undone.event.uid===first.event.uid&&undone.event.target===first.event.target&&undone.event.previousIds.includes(firstId)&&undone.event.reminder===30);
 const created2=await page.evaluate(e=>SERVER.saveEvent({...e,target:'가상 실패-02'}),event);drop=true;
 let failed=await page.evaluate(async id=>{try{await SERVER.setDone(id,true,(await SERVER.getEvent(id)).updated);return false;}catch(e){return true;}},created2.event.id);
 check('stripped destination properties never cause source deletion',failed&&maps.w.get(created2.event.id).status==='confirmed'&&maps.w.get(created2.event.id).extendedProperties.private.vhm_target==='가상 실패-02');
 const created3=await page.evaluate(e=>SERVER.saveEvent({...e,target:'가상 실패-03'}),event);insertFail=true;
 failed=await page.evaluate(async id=>{try{await SERVER.setDone(id,true,(await SERVER.getEvent(id)).updated);return false;}catch(e){return true;}},created3.event.id);
 check('destination insert failure keeps source',failed&&maps.w.get(created3.event.id).status==='confirmed');
 const created4=await page.evaluate(e=>SERVER.saveEvent({...e,target:'가상 경합-04'}),event);race=true;
 const conflicted=await page.evaluate(async id=>SERVER.setDone(id,true,(await SERVER.getEvent(id)).updated),created4.event.id);
 check('concurrent source edit is never deleted',conflicted.conflict&&maps.w.get(created4.event.id).status==='confirmed'&&maps.w.get(created4.event.id).extendedProperties.private.vhm_target==='가상 동시 수정');
 const created5=await page.evaluate(e=>SERVER.saveEvent({...e,target:'가상 과거-05'}),event);const old=maps.w.get(created5.event.id);old.summary='[방문] 완료';old.extendedProperties.private.vhm_status='완료';const damaged=legacyMove(old,'w');
 const before=await page.evaluate(id=>SERVER.getEvent(id),damaged.id);
 check('legacy missing metadata is flagged and retained in completed view',before.metadataMissing&&before.inDone&&before.status==='완료'&&!before.fromApp);
 await page.evaluate(ev=>{S.settings={...S.settings,show:'all',view:'done'};S.selected='2026-11-17';S.cursor=new Date(2026,10,1);S.doneEvents=[ev];render();openEvent(ev);},before);
 check('damaged archive is not falsely labelled as phone registration',(await page.locator('#phoneInfo').innerText()).includes('단정할 수 없'));
 await page.locator('#eventDlg [data-close]').first().click();
 await page.locator('#doneRepair').click();await page.waitForFunction(()=>document.querySelector('#doneRepairResult')?.textContent.includes('복구 1건'));
 check('matching cancelled source restores old private details',true&&maps.d.get(damaged.id).extendedProperties.private.vhm_target==='가상 과거-05');
 check('repair leaves current title and dates unchanged',maps.d.get(damaged.id).summary==='[방문] 완료'&&maps.d.get(damaged.id).start.date==='2026-11-17');
 const recovered=await page.evaluate(id=>SERVER.getEvent(id),damaged.id);check('recovered event is again an app event',recovered.fromApp&&!recovered.metadataMissing&&recovered.group==='정기관리군');
 const c6=await page.evaluate(e=>SERVER.saveEvent({...e,target:'가상 백업-06'}),event),snapshot=clone(c6.event);const bad6=legacyMove(maps.w.get(c6.event.id),'w');maps.w.delete(c6.event.id);
 const backup=JSON.stringify({app:'vhm-calendar-web',schema:1,events:[snapshot]});
 await page.locator('#doneRepairFile').setInputFiles({name:'virtual-backup.json',mimeType:'application/json',buffer:Buffer.from(backup)});await page.waitForFunction(()=>document.querySelector('#doneRepairResult')?.textContent.includes('이미 정상 1건'));
 check('exact backup repairs an existing archive instead of creating duplicates',true&&maps.d.get(bad6.id).extendedProperties.private.vhm_target==='가상 백업-06'&&maps.d.get(bad6.id).extendedProperties.private.vhm_status==='완료');
 const phone=seed('d',{summary:'가상 근거 없음',start:{date:'2026-11-17'},end:{date:'2026-11-18'},extendedProperties:{private:{}}});
 const untouched=JSON.stringify(phone);const missing=await page.evaluate(()=>SERVER.repairCompleted('2026-11-01','2026-11-30'));
 check('no source or backup means no invented restoration',missing.missing>=1&&JSON.stringify(phone)===untouched);
 const c7=await page.evaluate(e=>SERVER.saveEvent({...e,target:'가상 불일치-07'}),event);const bad7=legacyMove(maps.w.get(c7.event.id),'w');
 const different={...c7.event,target:'가상 다른 백업'};
 const ambiguous=await page.evaluate(json=>SERVER.repairCompleted('2026-11-01','2026-11-30',json),JSON.stringify({app:'vhm-calendar-web',events:[different]}));
 check('conflicting recovery evidence is not guessed',ambiguous.ambiguous===1&&!maps.d.get(bad7.id).extendedProperties.private.vhm_kind);
 const c8=await page.evaluate(e=>SERVER.saveEvent({...e,target:'가상 복구 경합-08'}),event),bad8=legacyMove(maps.w.get(c8.event.id),'w');repairRace=true;
 const repairConflict=await page.evaluate(()=>SERVER.repairCompleted('2026-11-01','2026-11-30'));
 check('recovery uses conditional writes',repairConflict.conflicts>=1&&!maps.d.get(bad7.id).extendedProperties.private.vhm_kind);
 const count=[...maps.d.values()].filter(e=>e.status!=='cancelled').length;
 await page.evaluate(()=>SERVER.repairCompleted('2026-11-01','2026-11-30'));
 check('repeated repair never creates new appointments',[...maps.d.values()].filter(e=>e.status!=='cancelled').length===count);
 for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:900});await page.evaluate(async()=>{const all=await SERVER.listAll('2026-11-01','2026-11-30');S.doneEvents=all.done;S.events=all.active;S.settings.view='done';render();});check('recovery controls fit '+width+'px',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 const oldUid=seed('w',{summary:'[내소] 완료',start:{date:'2026-11-17'},end:{date:'2026-11-18'},extendedProperties:{private:{vhm_kind:'work',vhm_type:'내소',vhm_status:'완료',vhm_target:'가상 옛 형식'}}});legacyMove(oldUid,'w');
 const legacy=await page.evaluate(()=>SERVER.repairCompleted('2026-11-01','2026-11-30'));
 check('legacy records without app UID recover only with matching iCalUID',legacy.repaired===1&&maps.d.get(oldUid.id).extendedProperties.private.vhm_target==='가상 옛 형식');
 check('no JavaScript errors',!errors.length);console.log('TOTAL '+checks+' completed metadata assertions passed');
 }finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
