// Offline public catalog, schema, XSS and viewport checks. No real Google account or patient data.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), vm = require('node:vm');
const {chromium} = require('playwright');
const data = JSON.parse(fs.readFileSync(path.join(__dirname,'../data/public-referrals.json'),'utf8'));
let count = 0;
function check(name, fn) { fn(); count++; console.log('PASS ' + name); }
const refined = JSON.parse(fs.readFileSync(path.join(__dirname,'../data/refined-needs.json'),'utf8'));
const context = {window:{VHM_PUBLIC_REFERRALS:data,VHM_REFINED_NEEDS:refined}, URL};
vm.createContext(context); vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/referral-model.js'),'utf8'),context);
const M = context.window.VHM_REFERRALS;
check('catalog 69 unique IDs, 48 consultable + 21 needs_contact',() => {
 assert.equal(data.services.length,69); assert.equal(new Set(data.services.map(s=>s.id)).size,69);
 assert.equal(data.services.filter(s=>s.verificationStatus==='consultable').length,48);
 assert.equal(data.services.filter(s=>s.verificationStatus==='needs_contact').length,21);
});
check('all source URLs use safe HTTP(S), no invented PDF forms',() => {
 for(const s of data.services) {if(s.officialGuideUrl) assert(M.safeUrl(s.officialGuideUrl)); assert([1,2,3,4].includes(s.referralCode)); for(const f of s.forms) assert(M.safeUrl(f.url));}
});
check('unsafe protocols, credentials and malformed URLs rejected',() => {
 for(const s of ['javascript:alert(1)','data:text/html,test','file:///etc/passwd','https://user:pass@example.com','//example.com'])assert.equal(M.safeUrl(s),'');
});
const legacy = {schema:1,future:{x:42},categories:[{id:'own-cat',name:'내 분류',extra:true,items:[{id:'custom-cost',label:'의료비 부담',future:1}]}],services:[{id:'own',name:'가상 서비스',org:'가상 기관',needs:['custom-cost'],forms:[],future:{keep:true},verificationStatus:'needs_contact',officialGuideUrl:'https://example.org',eligibleGroups:'가상 자격'}]};
const migrated = M.migrate(legacy,{categories:[],services:[]});
check('untrusted prototype-shaped keys do not change object prototypes',()=>{const x=M.migrate(JSON.parse('{"__proto__":{"injected":true},"categories":[],"services":[]}'),{categories:[],services:[]});assert.equal(x.injected,undefined);assert.equal(JSON.parse(JSON.stringify(x)).__proto__.injected,true);});
check('v1 migration retains unknown top/category/item/service fields and does not mutate input',() => {
 assert.equal(legacy.schema,1);assert.equal(migrated.schema,2);assert.equal(migrated.future.x,42);assert(migrated.categories[0].extra);assert.equal(migrated.categories[0].items[0].future,1);assert(migrated.services[0].future.keep);assert.equal(migrated.services[0].verificationStatus,'needs_contact');
});
check('future schema and new fields round-trip',()=>{const x=M.migrate({...migrated,schema:8},{categories:[],services:[]});assert.equal(x.schema,8);assert.equal(x.services[0].officialGuideUrl,'https://example.org');assert.equal(x.services[0].eligibleGroups,'가상 자격');});
const eye = data.services.find(s=>s.id==='eye-surgery');
check('need labels map to custom IDs, missing labels are reported',()=>{const x=M.mapNeeds(eye.needs,migrated.categories);assert(x.ids.includes('custom-cost'));assert(x.missing.includes('시력·청력 문제'));});
const plan=M.mergeCatalog(migrated,[eye],true);
check('merge keeps custom categories and creates approved missing needs',()=>{assert.equal(plan.data.categories[0].id,'own-cat');assert.equal(plan.data.services[0].id,'own');const x=plan.added[0];assert(x.needs.includes('custom-cost'));assert.equal(x.catalogId,'eye-surgery');assert(x.preapprovalStatus);});
check('repeat import and exact name/org duplicate are skipped without overwrite',()=>{assert.equal(M.mergeCatalog(plan.data,[eye],true).added.length,0);const x=M.clone(migrated);x.services.push({...M.service(eye),id:'manual',needs:[],memo:'사용자 수정'});const y=M.mergeCatalog(x,[eye],true);assert.equal(y.added.length,0);assert.equal(y.data.services.at(-1).memo,'사용자 수정');});
check('housing basic/medical recipients excluded from indexed eligibility',()=>{const s=M.service(data.services.find(s=>s.id==='seoul-rent-voucher'));assert(!M.groups(s).includes('basic'));assert(!M.groups(s).includes('medical'));});
check('general 차상위 never mapped to 본인부담경감',()=>{assert(!M.groups(M.service(eye)).includes('reduced'));assert(M.groups(M.service(data.services.find(s=>s.id==='cancer-medical'))).includes('reduced'));});
check('waiting, closed, unknown and guide intake statuses remain distinct',()=>{assert.equal(M.intake(data.services.find(s=>s.id==='daily-care')),'waiting');assert.equal(M.intake({intakeStatus:'2026 미운영'}),'closed');assert.equal(M.intake({verificationStatus:'needs_contact',intakeStatus:'운영 확인 필요'}),'unknown');assert.equal(M.intake({intakeStatus:'상시 법정 제도'}),'guide');});
check('refined needs have unique IDs and reference existing catalog services',()=>{const items=refined.groups.flatMap(g=>g.items);assert.equal(refined.groups.length,11);assert.equal(items.length,44);assert.equal(new Set(items.map(i=>i.id)).size,44);for(const i of items){assert(i.parents.length);for(const id of i.serviceIds)assert(data.services.some(s=>s.id===id),id);}});
check('eye and hearing needs do not cross-match through the old combined label',()=>{const selected=new Set(['refined:eye-surgery']);assert.equal(M.refinedHits(data.services.find(s=>s.id==='eye-surgery'),[],selected).length,1);assert.equal(M.refinedHits(data.services.find(s=>s.id==='hearing-aid-local'),[],selected).length,0);assert.equal(M.refinedHits(data.services.find(s=>s.id==='eye-surgery'),[],new Set(['refined:hearing-aid'])).length,0);});
check('specific catalog copies use specific matching; custom services keep broad IDs',()=>{const picks=new Set(['refined:repair']);assert.equal(M.refinedHits({_personal:true,catalogId:'eye-surgery'},['보조기기 필요'],picks).length,0);assert.equal(M.refinedHits({_personal:true,id:'custom'},['보조기기 필요'],picks).length,1);});
check('several selected details count once each without mutating personal schema',()=>{const before=JSON.stringify(migrated);const hits=M.refinedHits({_personal:true,id:'custom'},['시력·청력 문제','보조기기 필요'],new Set(['refined:hearing-aid']));assert.equal(hits.length,1);assert.equal(JSON.stringify(migrated),before);});
check('existing needs are grouped into matching menus and unknown labels stay under institution linkage',()=>{const raw=[{id:'mine',name:'내 분류',items:[{id:'oral-old',label:'구강 문제'},{id:'med-old',label:'약 복용 관리 어려움'},{id:'unknown-old',label:'가상 복합 요구'}]}];const before=JSON.stringify(raw),groups=M.groupedNeeds(raw);assert(groups.find(g=>g.id==='oral').items.some(i=>i.id==='oral-old'));assert(groups.find(g=>g.id==='disease').items.some(i=>i.id==='med-old'));assert(groups.find(g=>g.id==='access').items.some(i=>i.id==='unknown-old'));assert.equal(JSON.stringify(raw),before);});
check('duplicate labels display once but retain every saved ID',()=>{const groups=M.groupedNeeds([{items:[{id:'one',label:'의료비 부담'},{id:'two',label:'의료비 부담'}]}]);const items=groups.flatMap(g=>g.items).filter(i=>i.label==='의료비 부담');assert.equal(items.length,1);const selected=M.expandNeedSelection(groups,new Set(['one']));assert(selected.has('one')&&selected.has('two'));});
check('an existing exact refined label keeps both private ID and precise catalog matching',()=>{const label=refined.groups.find(g=>g.id==='senses').items.find(i=>i.id==='refined:hearing-aid').label;const groups=M.groupedNeeds([{items:[{id:'my-hearing',label}]}]);const selected=M.expandNeedSelection(groups,new Set(['my-hearing']));assert(selected.has('refined:hearing-aid'));assert.equal(M.refinedHits(data.services.find(s=>s.id==='eye-surgery'),[],selected).length,0);assert.equal(M.refinedHits(data.services.find(s=>s.id==='disability-equipment-nhis'),[],selected).length,1);});
const SITE=path.join(__dirname,'../site');
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;const file=path.join(SITE,pathname==='/'?'index.html':pathname);if(!file.startsWith(SITE+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.VHM_CHROMIUM||'/usr/bin/chromium'});
 try {
 for(const width of [1440,768,390,320]){
  const ctx=await browser.newContext({viewport:{width,height:1000},locale:'ko-KR'});const page=await ctx.newPage();const errors=[],external=[],dialogs=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{dialogs.push(d.message());d.accept();});
  await page.route('**/*',r=>{if(r.request().url().startsWith(base))return r.continue();external.push(r.request().url());return r.abort();});
  await page.goto(base);await page.click('[data-tab="link"]');await page.waitForSelector('.lk-summary');
  check(width+'px public catalog available without Google/Drive',()=>{assert.equal(external.length,0);});
  assert.match(await page.textContent('.lk-summary'),/公開資料|공개자료 69건/);assert.match(await page.textContent('.lk-summary'),/48/);assert.match(await page.textContent('.lk-summary'),/21/);
  await page.click('[data-lkview="list"]');assert.equal(await page.locator('#tab-link .lk-row').count(),12); assert.match(await page.textContent('#tab-link'),/검색 결과 48건/); while(await page.locator('#lkShowMore').count()) await page.click('#lkShowMore'); assert.equal(await page.locator('#tab-link .lk-row').count(),48);
  await page.selectOption('[data-lkfilter="route"]','1');assert(await page.locator('#tab-link .lk-row').count()>0);assert((await page.locator('#tab-link .lk-row').allTextContents()).every(s=>s.includes('①')));
  await page.click('#lkFilterClear');await page.selectOption('[data-lkfilter="intake"]','waiting');assert.equal(await page.locator('#tab-link .lk-row').count(),1);assert.match(await page.textContent('#tab-link .lk-list'),/일상돌봄/);
  await page.click('[data-detail="public:daily-care"]');assert.match(await page.textContent('#referralBody'),/대기 신청만 가능/);await page.click('[data-refclose="referralDlg"]');
  await page.click('#lkFilterClear');await page.fill('#lkQ','병원 안심동행');assert.equal(await page.locator('#tab-link .lk-row').count(),1);
  await page.click('[data-detail="public:seoul-health-ride"]');const ride=await page.textContent('#referralBody');assert.match(ride,/6,000원/);assert.match(ride,/1인가구 원칙/);assert.match(ride,/다인가구/);await page.click('[data-refclose="referralDlg"]');
  await page.click('#lkFilterClear');await page.selectOption('[data-lkfilter="group"]','medical');assert(!(await page.locator('[data-detail="public:seoul-rent-voucher"]').count()));
  await page.selectOption('[data-lkfilter="group"]','reduced');assert((await page.locator('#tab-link .lk-row').allTextContents()).every(s=>s.includes('차상위본인부담경감')));
  await page.click('#lkFilterClear');await page.click('[data-lkview="pending"]');assert.match(await page.textContent('#tab-link'),/검색 결과 21건/); while(await page.locator('#lkShowMore').count()) await page.click('#lkShowMore'); assert.equal(await page.locator('#tab-link .lk-row').count(),21);
  await page.click('[data-detail="public:smile-dental"]');assert.match(await page.textContent('#referralBody'),/담당기관 확인 필요/);await page.click('[data-review="smile-dental"]');assert(dialogs.some(s=>s.includes('개인 목록')));await page.click('[data-refclose="referralDlg"]');
  await page.click('[data-lkview="match"]');await page.locator('label.lk-chip').filter({hasText:'의료비 부담'}).locator('input').check();assert(await page.locator('.lk-svc').count()>0);assert(!(await page.locator('[data-detail="public:smile-dental"]').count()));
  assert.match(await page.textContent('#tab-link'),/검토 후보/);assert.match(await page.textContent('#tab-link'),/미운영/);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.click('#lkClear');
  await page.locator('#refined-senses summary').click();
  await page.locator('input[data-need="refined:eye-surgery"]').check();
  assert.equal(await page.locator('[data-detail="public:eye-surgery"]').count(),1);
  assert.equal(await page.locator('.lk-svc [data-detail="public:disability-equipment-nhis"]').count(),0);
  assert.equal(await page.locator('#refined-senses').getAttribute('open'),'');
  await page.locator('input[data-need="refined:eye-surgery"]').uncheck();
  await page.locator('input[data-need="refined:hearing-aid"]').check();
  assert.equal(await page.locator('.lk-svc [data-detail="public:eye-surgery"]').count(),0);
  assert.equal(await page.locator('.lk-svc [data-detail="public:disability-equipment-nhis"]').count(),1);
  assert.match(await page.textContent('.lk-pending-needs'),/강서구 난청 어르신 보청기 지원/);
  assert.equal(await page.locator('.lk-svc [data-detail="public:hearing-aid-local"]').count(),0);
  await page.click('#lkClear');
  await page.locator('#refined-oral input[data-need="refined:dental-disabled"]').check();
  assert.equal(await page.locator('.lk-svc [data-detail="public:senior-dentures"]').count(),0);
  assert.match(await page.textContent('.lk-pending-needs'),/스마일재단/);
  check(width+'px refined needs distinguish eyes/hearing, preserve expansion, and separate unverified dental support',()=>{assert.equal(errors.length,0);assert.equal(external.length,0);});
  assert.equal(await page.locator('.lk-legacy').count(),0);assert(!/기존·직접 관리 요구 항목/.test(await page.textContent('#tab-link')));
  assert.equal(await page.locator('#refined-oral').getByRole('checkbox',{name:'구강 문제',exact:true}).count(),1);
  assert.equal(await page.locator('#refined-senses').getByRole('checkbox',{name:'시력·청력 문제',exact:true}).count(),1);
  await page.evaluate(()=>{LINKS._state.data.categories.push({id:'mock-extra',name:'가상 분류',items:[{id:'unknown-1',label:'가상 복합 요구'},{id:'unknown-2',label:'가상 복합 요구'}]});LINKS._state.data.services.push(VHM_REFERRALS.service({id:'unknown-service',name:'가상 복합 지원',org:'가상기관',needs:['unknown-2'],forms:[]}));});
  await page.click('[data-lkview="list"]');await page.click('[data-lkview="match"]');await page.click('#lkClear');
  await page.locator('#refined-access summary').click();
  const custom=page.locator('#refined-access').getByRole('checkbox',{name:'가상 복합 요구',exact:true});assert.equal(await custom.count(),1);await custom.check();
  assert.equal(await page.locator('.lk-svc [data-detail="personal:unknown-service"]').count(),1);
  assert(await page.evaluate(()=>LINKS._state.data.categories.find(c=>c.id==='mock-extra').items.map(i=>i.id).join(',')==='unknown-1,unknown-2'));
  await custom.uncheck();assert.equal(await page.locator('.lk-svc [data-detail="personal:unknown-service"]').count(),0);
  await page.evaluate(()=>{LINKS._state.data.categories=LINKS._state.data.categories.filter(c=>c.id!=='mock-extra');LINKS._state.data.services=LINKS._state.data.services.filter(s=>s.id!=='unknown-service');});
  check(width+'px unified menus, preserved custom routing, duplicate-ID links and unchecking preserved without network',()=>{assert.equal(errors.length,0);assert.equal(external.length,0);});
  await page.click('#lkClear');
  assert.equal(await page.locator('#refined-other').count(),0);
  assert(await page.locator('#refined-urgent').getByRole('checkbox',{name:'긴급 지원 필요',exact:true}).isVisible());
  assert.equal(await page.locator('#refined-urgent details').count(),0);
  const position=await page.evaluate(()=>{const urgent=document.querySelector('#refined-urgent'),group=document.querySelector('.lk-refined');return !!(urgent.compareDocumentPosition(group)&Node.DOCUMENT_POSITION_FOLLOWING);});assert(position);
  await page.locator('#refined-urgent input').check();assert(await page.locator('.lk-svc [data-detail="public:emergency-national"]').count());
  await page.click('#lkClear');assert.equal(await page.locator('#refined-urgent input').isChecked(),false);
  check(width+'px urgent checkbox is standalone and first, no 기타 menu, recommendation and reset work',()=>{assert.equal(errors.length,0);assert.equal(external.length,0);});
  // Synthetic stored HTML and unsafe links must never execute or become navigable.
  await page.evaluate(()=>{LINKS._state.data.services.push(VHM_REFERRALS.service({id:'xss',name:'<img src=x onerror="window.XSS=1">',org:'<svg onload="window.XSS=2">',needs:[],forms:[{url:'javascript:window.XSS=3',name:'bad'}],officialGuideUrl:'javascript:window.XSS=4',future:{keep:true}}));});
  await page.click('[data-lkview="list"]');await page.click('[data-detail="personal:xss"]');assert.equal(await page.locator('#referralBody img,#referralBody svg,#referralBody a[href^="javascript:"]').count(),0);assert.equal(await page.evaluate(()=>window.XSS),undefined);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.click('[data-refclose="referralDlg"]');
  await page.click('[data-tab="edu"]');await page.click('[data-tab="link"]');assert.equal(await page.evaluate(()=>LINKS._state.checks.size),0);
  await page.evaluate(()=>{LINKS._state.data.services=LINKS._state.data.services.filter(s=>s.id!=='xss');}); await page.click('[data-lkview="list"]');await page.screenshot({path:'/tmp/vhm-catalog-'+width+'.png',fullPage:true});
  check(width+'px filters, details, statuses, needs, XSS, no overflow/no external traffic',()=>{assert.equal(errors.length,0,errors.join('\n'));assert.equal(external.length,0,external.join('\n'));});
  await ctx.close();
 }
 }finally{await browser.close();server.close();}
 console.log(count+' checks passed');
})().catch(e=>{console.error('CRASH',e);server.close();process.exitCode=1;});
