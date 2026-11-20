// Pointer/Pencil gesture regression. Fake notes/crypto; real DOM, canvas and IndexedDB.
const {chromium}=require('playwright'),http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const moduleSource=fs.readFileSync(process.env.VHM_INK_SOURCE||path.join(__dirname,'../src/consultations.js'),'utf8');
const html=`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:12px}.row{display:flex;flex-wrap:wrap;gap:6px}button,select{padding:8px}canvas{box-sizing:border-box}</style><textarea id="focusTest" aria-label="virtual note"></textarea><div id="consultationTools"></div><div id="consultationMemoTools"></div><div style="height:1200px">Scroll outside the board</div><script>
window.toast=t=>window.lastToast=t;window.VHM_AUTH={hasDrive:false};window.NOTES={snapshot:()=>({out:'virtual ink test'}),validateSaved:()=>{},clearContent:()=>{}};window.MEMOLOCK={openNow:async()=>true};window.SERVER={isOpen:()=>true,consultationScope:async()=>'fake-scope',openConsultation:async encrypted=>JSON.parse(encrypted),sealConsultation:async record=>{window.saved=structuredClone(record);return {scope:'fake-scope',encrypted:JSON.stringify(record)}}};
</script><script>${moduleSource}</script>`;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});let checks=0;
function check(label,ok){assert.ok(ok,label);console.log('PASS '+label);checks++;}
(async()=>{await new Promise(r=>server.listen(0,r));const browser=await chromium.launch({executablePath:process.env.VHM_CHROMIUM||'/usr/bin/chromium'});
try{
 const ctx=await browser.newContext({viewport:{width:1024,height:1366},hasTouch:true,isMobile:true});const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:'+server.address().port+'/');await page.locator('#consultBoard summary').click();
 const canvas=page.locator('#consultCanvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox(),x=box.x+40,y=box.y+40;
 let px=x,py=y;
 const cdp=await ctx.newCDPSession(page);
 await page.evaluate(()=>{const c=document.querySelector('#consultCanvas'),g=c.getContext('2d'),old=g.clearRect.bind(g);window.fullRedraws=0;g.clearRect=(...a)=>{window.fullRedraws++;return old(...a)};c.addEventListener('pointerdown',e=>{if(e.pointerType==='pen')window.penId=e.pointerId});});
 async function pen(type,px,py){await cdp.send('Input.dispatchMouseEvent',{type,x:px,y:py,button:type==='mouseMoved'?'none':'left',buttons:type==='mouseReleased'?0:1,pointerType:'pen',force:type==='mouseReleased'?0:0.5});}
 async function touch(type,points){await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});}
 async function save(){await page.locator('#consultMemoSave').click();await page.waitForFunction(()=>!document.querySelector('#consultMemoSave').disabled);const b=await canvas.boundingBox();px=b.x+40;py=b.y+40;return page.evaluate(()=>window.saved);}
 check('Pencil-only is default on touch tablet',!(await page.locator('#consultFinger').isChecked()));
 await page.locator('#focusTest').fill('가상 입력 보존');await canvas.scrollIntoViewIfNeeded();
 const startScroll=await page.evaluate(()=>scrollY);
 await touch('touchStart',[{x:x+100,y:y+100}]);await touch('touchMove',[{x:x+105,y:y+105}]);
 await pen('mousePressed',x,y);await pen('mouseMoved',x+70,y+30);await pen('mouseReleased',x+90,y+40);await touch('touchEnd',[]);
 const focusedInk=await canvas.evaluate(c=>document.activeElement===c);
 let record=await save();
 check('Pencil leaves text-editing focus without erasing the note',focusedInk&&await page.locator('#focusTest').inputValue()==='가상 입력 보존');
 check('palm arriving first cannot steal the Pencil stroke',record.strokes.length===1&&record.strokes[0].points.length>=3);
 check('Pencil pointer events reach the canvas',await page.evaluate(()=>typeof window.penId==='number'));
 check('Pencil movement preserves final pointer-up coordinate',Math.abs(record.strokes[0].points.at(-1)[0]-(130/box.width))<0.01);
 check('canvas gesture does not move the document',Math.abs(await page.evaluate(()=>scrollY)-startScroll)<2);
 check('movement paints incrementally without full canvas clears',await page.evaluate(()=>window.fullRedraws)===0);
 check('drag/select/context-menu defaults are cancelled',await canvas.evaluate(c=>['dragstart','selectstart','contextmenu'].every(type=>!c.dispatchEvent(new Event(type,{cancelable:true,bubbles:true})))));
 check('canvas disables browser text selection and native dragging',await canvas.evaluate(c=>getComputedStyle(c).userSelect==='none'&&getComputedStyle(c).touchAction==='none'&&c.draggable===false));
 await canvas.scrollIntoViewIfNeeded();const b=await canvas.boundingBox();px=b.x+40;py=b.y+40;
 await pen('mousePressed',px,py);
 await canvas.evaluate((c,p)=>{const e=new PointerEvent('pointermove',{pointerId:window.penId,pointerType:'pen',clientX:p.x+100,clientY:p.y+60,cancelable:true});e.getCoalescedEvents=()=>[new PointerEvent('pointermove',{clientX:p.x+60,clientY:p.y+40}),new PointerEvent('pointermove',{clientX:p.x+80,clientY:p.y+50})];c.dispatchEvent(e);},{x:b.x,y:b.y});
 await pen('mouseReleased',px+80,py+40);record=await save();
 check('coalesced samples and final dispatch point are retained',record.strokes.at(-1).points.length>=5);
 await canvas.scrollIntoViewIfNeeded();
 await pen('mousePressed',px,py);await pen('mouseMoved',px+15,py+10);
 await canvas.evaluate(c=>c.dispatchEvent(new PointerEvent('pointercancel',{pointerId:window.penId,pointerType:'pen',cancelable:true})));
 await pen('mouseReleased',px+15,py+10);await pen('mousePressed',px,py+70);await pen('mouseMoved',px+80,py+90);await pen('mouseReleased',px+90,py+100);record=await save();
 check('cancelled input never leaves the next Pencil stroke stuck',record.strokes.length===4);
 await page.locator('#consultFinger').check();await canvas.scrollIntoViewIfNeeded();
 await touch('touchStart',[{x:px+160,y:py+50}]);await touch('touchMove',[{x:px+165,y:py+55}]);await pen('mousePressed',px,py+120);await pen('mouseMoved',px+80,py+130);await pen('mouseReleased',px+90,py+140);await touch('touchEnd',[]);record=await save();
 check('Pencil takes priority even when finger writing is enabled',record.strokes.length===5);
 await canvas.scrollIntoViewIfNeeded();await touch('touchStart',[{x:px+60,y:py+100}]);await touch('touchMove',[{x:px+90,y:py+120}]);await touch('touchEnd',[]);record=await save();
 check('explicit finger mode still supports touch writing',record.strokes.length===6);
 await page.locator('#consultUndo').click();record=await save();check('undo still removes exactly one stroke',record.strokes.length===5);
 await pen('mousePressed',px,py);await canvas.evaluate(c=>c.dispatchEvent(new PointerEvent('lostpointercapture',{pointerId:window.penId,pointerType:'pen'})));await pen('mouseReleased',px,py);await pen('mousePressed',px+40,py);await pen('mouseReleased',px+50,py+10);record=await save();check('lost capture recovers for subsequent input',record.strokes.length===7);
 await canvas.scrollIntoViewIfNeeded();const edge=await canvas.boundingBox();
 await pen('mousePressed',edge.x+30,edge.y+30);await pen('mouseMoved',edge.x-5,edge.y+40);await pen('mouseMoved',edge.x+60,edge.y+60);await pen('mouseReleased',edge.x+70,edge.y+70);record=await save();
 check('captured Pencil can leave and re-enter the board without dragging',record.strokes.at(-1).points.some(p=>p[0]===0)&&record.strokes.at(-1).points.at(-1)[0]>0);
 check('no pointer or canvas JavaScript errors',errors.length===0);
 console.log('TOTAL '+checks+' Pencil regression assertions passed');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
