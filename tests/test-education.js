// Real static assets and simulated disconnected Google state; no user records.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');let browser,server,count=0;
const pass=name=>{count++;console.log('PASS '+name);};
(async()=>{
 const data=JSON.parse(fs.readFileSync(path.join(root,'data/education.json'),'utf8'));
 assert.equal(data.items.length,10);assert.equal(new Set(data.items.map(h=>h.id)).size,10);
 for(const h of data.items){assert.equal(h.sections.length,2);assert(h.sections.every(s=>s.items.length===4));assert.equal(h.danger.length,3);assert(h.nurseText.startsWith(h.number+'. '));assert(fs.readFileSync(path.join(root,'education',h.id+'.pdf')).subarray(0,5).equals(Buffer.from('%PDF-')));}
 pass('10 source-mapped diseases with 80 guidance items, 30 warning signs and printable PDF files');
 for(const name of fs.readdirSync(path.join(root,'education')))assert(fs.readFileSync(path.join(root,'education',name)).equals(fs.readFileSync(path.join(root,'site/education',name))));
 assert(fs.readFileSync(path.join(root,'index.html')).equals(fs.readFileSync(path.join(root,'site/index.html'))));pass('root and site/ deployment assets match');
 server=http.createServer((req,res)=>{const filename=path.join(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!fs.existsSync(filename)){res.writeHead(404);res.end();return;}const file=fs.statSync(filename).isDirectory()?path.join(filename,'index.html'):filename;res.setHeader('Content-Type',file.endsWith('.pdf')?'application/pdf':file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(file));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.VHM_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage(),errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const url=route.request().url();if(['chrome:','chrome-extension:'].includes(new URL(url).protocol))return route.continue();if(!url.startsWith(base)){external.push(url);return route.abort();}if(url.endsWith('/config.js'))return route.fulfill({contentType:'text/javascript',body:"window.VHM_CONFIG={clientId:''}"});return route.continue();});
 await page.goto(base);await page.click('[data-tab="edu"]');assert.equal(await page.locator('.edu-card').count(),10);pass('education works without Google sign-in');
 await page.fill('#eduQuery','고지혈증');assert.equal(await page.locator('.edu-card').count(),1);assert.equal(await page.locator('.edu-card h3').innerText(),'이상지질혈증');
 await page.fill('#eduQuery','혈 당');assert.equal(await page.locator('.edu-card').count(),1);
 await page.fill('#eduQuery','<img onerror=alert(1)>');assert.equal(await page.locator('.edu-card').count(),0);assert.equal(await page.locator('#eduCards img').count(),0);await page.click('[data-edu-reset]');assert.equal(await page.locator('.edu-card').count(),10);pass('keyword/whitespace search, empty reset and markup-safe input');
 await page.fill('#eduQuery','콩팥');await page.click('[data-edu-audience="why"]');assert.equal(await page.locator('#eduQuery').inputValue(),'콩팥');await page.click('[data-ho="dialysis"]');assert((await page.locator('.edu-pdf').getAttribute('data')).endsWith('#page=7'));assert.equal(await page.locator('[data-view="why"]').getAttribute('aria-pressed'),'true');
 await page.click('[data-view="sheet"]');assert.equal(await page.locator('.handout').count(),1);assert.equal(await page.locator('.ho-sec li').count(),8);await page.click('[data-edu-size]');assert.equal(await page.locator('.edu-large').count(),1);await page.click('[data-ho=""]');assert.equal(await page.locator('#eduQuery').inputValue(),'콩팥');await page.fill('#eduQuery','');pass('audience switching, correct source pages, enlarged text and search preservation');
 const download=page.waitForEvent('download');await page.locator('.edu-downloads a').first().click();const file=await download;assert((await fs.promises.readFile(await file.path())).subarray(0,5).equals(Buffer.from('%PDF-')));pass('PDF download returns a real PDF');
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:900});await page.click('[data-tab="edu"]');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(width===1440||width===390)await page.screenshot({path:path.join(root,'..','education-'+width+'.png'),fullPage:true});
  for(const h of data.items){await page.click('[data-ho="'+h.id+'"]');assert.equal(await page.locator('.ho-danger li').count(),3);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),h.id+' overflow '+width);await page.click('[data-ho=""]');}
  pass(width+'px: all 10 readable sheets without horizontal overflow');
 }
 await page.setViewportSize({width:1440,height:1000});await page.click('[data-ho="htn"]');await page.screenshot({path:path.join(root,'..','education-detail.png'),fullPage:true});
 // Print layout must reset large type and isolate the selected handout.
 await page.emulateMedia({media:'print'});for(const h of data.items){await page.evaluate(id=>renderEdu(id,'sheet'),h.id);await page.pdf({path:path.join(root,'..','print-'+h.id+'.pdf'),preferCSSPageSize:true,printBackground:true});}pass('10 A4 print documents generated for page-count inspection');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);pass('no script errors or external requests');
 console.log('TOTAL '+count+' education assertions passed');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));});
