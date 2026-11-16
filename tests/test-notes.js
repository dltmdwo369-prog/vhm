const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const SITE = require('path').join(__dirname, '..', 'site');
const R = []; const check = (n, ok, info = '') => R.push(`${ok ? 'PASS' : 'FAIL'} ${n}${info ? ' — ' + info : ''}`);
const server = http.createServer((req, res) => {
  const f = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
  if (f === '/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end("window.VHM_CONFIG = { clientId: 'test' };"); }
  const fp = path.join(SITE, f); if (!fs.existsSync(fp)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); fs.createReadStream(fp).pipe(res);
});
(async () => {
  await new Promise(r => server.listen(0, r)); const BASE = 'http://localhost:' + server.address().port + '/';
  const b = await chromium.launch({ executablePath: process.env.VHM_CHROMIUM || '/usr/bin/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE.slice(0, -1) });
  const page = await ctx.newPage(); const errs = [], ext = [];
  page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => { console.log('DIALOG', d.message()); d.accept(); });
  page.on('request', r => { if (!r.url().startsWith(BASE)) ext.push(r.url()); });
  try {
    await page.goto(BASE); await page.click('[data-tab="note"]'); await page.waitForSelector('#ntOut');
    const warn = await page.textContent('#tab-note');
    check('상담 메모 탭: 로그인 없이 열림, 임시 기본값 안내', /임시 기본값/.test(warn) && /혈압/.test(warn));
    const chip = (label, opt) => page.click(`.nt-row:has(.nt-label:text-is("${label}")) .nt-chip:text-is("${opt}")`);
    const lab = l => `.nt-row:has(.nt-label:text-is("${l}"))`;
    const V = k => `${lab('Vital')} input[data-k="${k}"]`, flag = k => page.textContent(`[data-flag$=":${k}"]`);
    const bst = o => page.click(`${lab('Vital')} [data-pickf][data-v="${o}"]`);
    await page.fill(V(0), '120'); await page.fill(V(1), '60'); await page.fill(V(2), '80'); await page.fill(V(3), '120'); await bst('공복');
    let out = await page.inputValue('#ntOut');
    check('Vital 형식: *Vital / -BP: 120/60mmHg, PR: 80회/분, BST(공복): 120mg/dL', out === '*Vital\n-BP: 120/60mmHg, PR: 80회/분, BST(공복): 120mg/dL', JSON.stringify(out));
    const f1 = [await flag(0), await flag(1), await flag(2), await flag(3)];
    await bst('식후'); const f2 = await flag(3);
    await page.fill(V(3), '55'); const f3 = await flag(3); await page.fill(V(0), '150'); const f4 = await flag(0);
    check('정상범위 표시: 120 주의·60 정상·80 정상·공복120 주의 → 식후 정상, 55 낮음, 150 높음', JSON.stringify(f1) === '["주의","정상","정상","주의"]' && f2 === '정상' && f3 === '낮음' && f4 === '높음', JSON.stringify([f1, f2, f3, f4]));
    await page.fill(V(0), ''); await page.fill(V(1), ''); await bst('식후'); await page.fill(V(3), '120');
    out = await page.inputValue('#ntOut');
    check('빈 칸은 빠짐 (BP 없음, 시점 안 고르면 BST: )', out === '*Vital\n-PR: 80회/분, BST: 120mg/dL', JSON.stringify(out));
    await page.fill(V(0), '130'); await page.fill(V(1), '85'); await bst('공복');
    await chip('수면', '양호'); await chip('흡연', '안 함');
    await page.click(`.nt-row:has(.nt-label:has-text("교육 내용")) .nt-chip:text-is("저염식")`);
    await page.click(`.nt-row:has(.nt-label:has-text("교육 내용")) .nt-chip:text-is("낙상 예방")`);
    out = await page.inputValue('#ntOut');
    check('묶음마다 *머리줄, 묶음 사이 빈 줄 (Vital → 건강상담 → 생활습관)', out === '*Vital\n-BP: 130/85mmHg, PR: 80회/분, BST(공복): 120mg/dL\n\n*건강상담\n-수면 양호하다고 함.\n-저염식, 낙상 예방 교육함.\n\n*생활습관\n-비흡연.', JSON.stringify(out));
    await page.fill(V(1), '8a5'); const cleaned = await page.inputValue(V(1));
    await chip('수면', '양호'); await chip('수면', '불량');
    await page.fill('#ntExtra', '가상 추가 내용.');
    out = await page.inputValue('#ntOut');
    check('같은 보기 다시 누르면 해제·다른 보기로 바뀜, 숫자 외 글자 거름, 추가 내용 붙음', cleaned === '85' && out.endsWith('-잠들기 어렵거나 자주 깬다고 함.\n-저염식, 낙상 예방 교육함.\n\n*생활습관\n-비흡연.\n\n*기타사항\n-가상 추가 내용.'), cleaned + ' | ' + out);
    await page.click('#ntCopy'); const clip = await page.evaluate(() => navigator.clipboard.readText());
    check('복사하기 → 클립보드', clip === out);
    // 직접 고친 메모 + 버튼: 고친 부분은 그대로, 버튼으로 바뀐 문장만 반영
    const before0 = await page.inputValue('#ntOut');
    await page.click('#ntOut'); await page.keyboard.press('End'); await page.keyboard.type(' 직접 씀.');
    await page.evaluate(() => { const t = document.querySelector('#ntOut'); t.value = t.value.replace('잠들기 어렵거나 자주 깬다고 함.', '밤에 자주 깬다고 하심.'); t.dispatchEvent(new Event('input', { bubbles: true })); });
    const caretOn = await page.textContent('#ntCaret'); await page.click('#ntCaretOff');   // 여기서는 커서 자리 말고 원래 순서로 합치기 확인
    await chip('통증', '없음');
    const m1 = await page.inputValue('#ntOut');
    await chip('통증', '없음');
    const m2 = await page.inputValue('#ntOut');
    await page.fill(`${lab('Vital')} input[data-k="0"]`, '140');
    const m3 = await page.inputValue('#ntOut');
    await page.click(`.nt-row:has(.nt-label:has-text("교육 내용")) .nt-chip:text-is("저염식")`);
    const m4 = await page.inputValue('#ntOut');
    const regenGone = (await page.$$('#ntRegen')).length === 0;
    check('직접 고친 메모 유지 + 버튼 누르는 대로 반영(추가·해제·숫자·여러 개), ‘다시 만들기’ 버튼 없음',
      regenGone && /커서 자리에 넣는 중/.test(caretOn) && m1.includes('밤에 자주 깬다고 하심.') && m1.includes('직접 씀.') && m1.includes('특별한 통증 호소 없음.') && m1.indexOf('특별한 통증') < m1.indexOf('밤에 자주')
      && !m2.includes('특별한 통증') && m2.includes('밤에 자주 깬다고 하심.') && m3.includes('-BP: 140/85mmHg') && m3.includes('직접 씀.') && m4.includes('낙상 예방 교육함.') && !m4.includes('저염식,') && m4.includes('밤에 자주 깬다고 하심.'),
      JSON.stringify([m1, m2, m3, m4]));
    // 약 추가로 화면을 다시 그려도 고친 메모 유지
    await page.click(`${lab('처방약')} [data-dq]`); await page.keyboard.type('노바'); await page.keyboard.press('Enter');
    const m5 = await page.inputValue('#ntOut');
    check('약 추가(화면 다시 그림) 뒤에도 고친 메모 유지 + 복용약 줄 추가', m5.includes('밤에 자주 깬다고 하심.') && m5.includes('직접 씀.') && m5.includes('*복약\n-복용약: 노바스크정(고혈압약)') && !/[가-힣]\n\*복약|\*복약\n-복용약: 노바스크정\(고혈압약\)\n[^\n-]/.test(m5) && m5.indexOf('*복약') < m5.indexOf('*건강상담'), JSON.stringify(m5));
    await page.click(`${lab('처방약')} .nt-drug [data-ddel]`);
    out = await page.inputValue('#ntOut');
    const ls = await page.evaluate(() => localStorage.getItem('vhm-notes-tpl'));
    const anyStore = await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)) + JSON.stringify(Object.assign({}, sessionStorage)));
    check('체크·입력 내용은 어디에도 저장 안 됨 (틀만 저장), 외부 전송 없음', !/130|가상 추가|직접 씀|"85"/.test(anyStore) && ext.length === 0, ext.join(','));
    await page.click('#ntClear');
    check('다음 대상자 → 모두 지움', (await page.inputValue('#ntOut')) === '' && (await page.$$('.nt-chip.on')).length === 0);
    // 악력
    const G = k => `${lab('악력')} input[data-k="${k}"]`, gf = k => page.textContent(`${lab('악력')} [data-flag$=":${k}"]`), gs = () => page.textContent(`${lab('악력')} [data-gsum]`);
    const order0 = await page.$$eval('.nt-row .nt-label', l => l.map(x => x.textContent));
    await page.fill(G(0), '20'); await page.fill(G(1), '17');
    const noCtx = [await gf(0), await gs()];
    await page.click(`${lab('악력')} [data-pickf][data-v="여"]`); await page.fill(G(3), '72');
    const w72 = [await gf(0), await gf(1), await gs()];
    await page.fill(G(0), '17'); await page.fill(G(1), '15');
    const w72b = [await gf(0), await gf(1), await gs()];
    await page.click(`${lab('악력')} [data-pickf][data-v="남"]`); await page.fill(G(3), '81'); await page.fill(G(0), '30'); await page.fill(G(1), '20');
    const m81 = [await gf(0), await gf(1), await gs()];
    out = await page.inputValue('#ntOut');
    check('악력: 신체사정(관절 다음), 성별·나이 없으면 안내 → 여 72세 R20 보통·L17 보통·근력저하 아님', order0[order0.indexOf('관절') + 1] === '악력' && noCtx[0] === '' && /성별·나이/.test(noCtx[1]) && JSON.stringify(w72) === JSON.stringify(['또래 보통', '또래 보통', '근력 저하 기준 아님 (최댓값 20kg ≥ 18kg)']), JSON.stringify([noCtx, w72]));
    check('악력: 여 R17(<18.2)·L15(<16.5) 하위 20%·근력 저하 / 남 81세 R30 평균 이상·L20 하위 20%·저하 아님', JSON.stringify(w72b) === JSON.stringify(['또래 하위 20%', '또래 하위 20%', '근력 저하 (최댓값 17kg < 18kg)']) && JSON.stringify(m81) === JSON.stringify(['또래 평균 이상', '또래 하위 20%', '근력 저하 기준 아님 (최댓값 30kg ≥ 28kg)']), JSON.stringify([w72b, m81]));
    check('악력 메모: *신체계측 및 신체사정 / -악력 Rt: 30kg, Lt: 20kg (성별·나이는 메모에 안 들어감)', out === '*신체계측 및 신체사정\n-악력 Rt: 30kg, Lt: 20kg', JSON.stringify(out));
    await page.click('#ntClear');
    // 당화혈색소
    const A = `${lab('당화혈색소')} input[data-k="0"]`, af = () => page.textContent(`${lab('당화혈색소')} [data-flag$=":0"]`);
    const ordM = await page.$$eval('.nt-row .nt-label', l => l.map(x => x.textContent));
    await page.fill(A, '5.4'); const a1 = await af(); await page.fill(A, '6.1'); const a2 = await af(); await page.fill(A, '6.5'); const a3 = await af();
    await page.fill(`${lab('Vital')} input[data-k="2"]`, '80');
    const aOut1 = await page.inputValue('#ntOut');
    await page.fill(`${lab('Vital')} input[data-k="2"]`, ''); await page.fill(`${lab('서두')} [data-lead]`, '가상'); await page.click(`${lab('서두')} .nt-chip:text-is("방문함")`);
    const aOut2 = await page.inputValue('#ntOut');
    check('당화혈색소(Vital 다음): 5.4 정상·6.1 주의·6.5 높음, Vital 아래 -HbA1c 줄, 서두 다음엔 줄바꿈', ordM[ordM.indexOf('Vital') + 1] === '당화혈색소' && a1 === '정상' && a2 === '주의' && a3 === '높음' && aOut1 === '*Vital\n-PR: 80회/분\n-HbA1c: 6.5%' && aOut2 === '*가상 방문함.\n\n*Vital\n-HbA1c: 6.5%', JSON.stringify([a1, a2, a3, aOut1, aOut2]));
    await page.click('#ntClear');
    // 한글 조합 입력(아이폰 등): 직접 고친 메모·커서 자리에서도 글자가 깨지지 않음 + 같은 묶음 머리줄은 하나만
    { const cdp = await page.context().newCDPSession(page);
      const steps = { '노': ['ㄴ', '노'], '인': ['ㅇ', '이', '인'], '혈': ['ㅎ', '혀', '혈'], '압': ['ㅇ', '아', '압'], '계': ['ㄱ', '계'] };
      const ime = async w => { for (const ch of w) { for (const x of steps[ch] || [ch]) await cdp.send('Input.imeSetComposition', { text: x, selectionStart: x.length, selectionEnd: x.length }); await cdp.send('Input.insertText', { text: ch }); } };
      const res = [];
      for (const mode of ['edited', 'caret']) {
        await chip('수면', '양호');
        await page.click('#ntOut'); if (mode === 'edited') { await page.keyboard.press('End'); await page.keyboard.type(' 가'); await page.click('#ntCaretOff'); }
        await page.click(`${lab('물품')} [data-lead]`); await ime('혈압계'); await page.click(`${lab('보건복지서비스 연계')} [data-lead]`); await ime('노인');
        res.push(await page.inputValue('#ntOut')); await page.click('#ntClear');
      }
      check('한글 조합 입력: 직접 고친 메모·커서 자리 모두 글자 안 깨짐, *서비스제공 한 번', res.every(x => x.includes('*서비스제공\n-물품: 혈압계\n-보건복지서비스 연계: 노인') && !/[ㄱ-ㅎㅏ-ㅣ]/.test(x) && x.split('*서비스제공').length === 2), JSON.stringify(res));
      // 메모에 직접 *서비스제공 을 적어 두었거나, 묶음을 지웠다 다시 넣어도 머리줄은 하나
      await chip('수면', '양호'); await page.click('#ntOut'); await page.keyboard.press('End'); await page.keyboard.type('\n\n*서비스제공'); await page.click('#ntCaretOff');
      await page.click(`${lab('물품')} [data-tadd][data-v="혈압계"]`); await page.click(`${lab('보건복지서비스 연계')} [data-tadd][data-v="치매안심센터"]`);
      const d1 = await page.inputValue('#ntOut');
      await page.click(`${lab('물품')} [data-tadd][data-v="혈압계"]`); await page.click(`${lab('보건복지서비스 연계')} [data-tadd][data-v="치매안심센터"]`);
      const d2 = await page.inputValue('#ntOut');
      await page.click(`${lab('보건복지서비스 연계')} [data-tadd][data-v="치매안심센터"]`); const d3 = await page.inputValue('#ntOut');
      check('같은 묶음 머리줄은 하나로 합침 · 비면 머리줄도 지움', d1.split('*서비스제공').length === 2 && /\*서비스제공\n-물품: 혈압계\n-보건복지서비스 연계: 치매안심센터/.test(d1) && !d2.includes('-물품') && !d2.includes('-보건') && d3.split('*서비스제공').length === 2, JSON.stringify([d1, d2, d3]));
      await page.click('#ntClear'); }
    // 고른 보기마다 메모 칸 (사용자 예시 그대로)
    { const E = lab('눈·귀·구강');
      await page.click(`${E} [data-pickf][data-v="백내장"]`); await page.click(`${E} [data-pickf][data-v="보청기 사용"]`); await page.click(`${E} [data-pickf][data-v="틀니 사용"]`);
      const nIn = await page.$$eval(`.nt-row:has(.nt-label:text-is("눈·귀·구강")) .nt-note`, x => x.map(e => e.textContent.trim()));
      await page.fill(`${E} [data-lead$="#f0"]`, '2025년도 op+, 연세솔안과의원'); await page.fill(`${E} [data-lead$="#f1"]`, 'L: 보청기, R:인공와우'); await page.fill(`${E} [data-lead$="#f2"]`, '부분틀니, 큰 불편감은 없음');
      const o1 = await page.inputValue('#ntOut');
      check('신체사정: 고른 보기마다 메모 칸 → ‘눈: 백내장(2025년도 op+, 연세솔안과의원), 귀: 보청기 사용(L: 보청기, R:인공와우), 구강건강: 틀니 사용(부분틀니, 큰 불편감은 없음)’',
        nIn.length === 3 && o1.includes('-눈: 백내장(2025년도 op+, 연세솔안과의원), 귀: 보청기 사용(L: 보청기, R:인공와우), 구강건강: 틀니 사용(부분틀니, 큰 불편감은 없음)'), JSON.stringify([nIn, o1]));
      await page.click(`.nt-row:has(.nt-label:has-text("만성질환")) .nt-chip:text-is("고혈압")`); await page.click(`.nt-row:has(.nt-label:has-text("만성질환")) .nt-chip:text-is("당뇨병")`);
      await page.fill(`.nt-row:has(.nt-label:has-text("만성질환")) .nt-note:has-text("고혈압") input`, '2010년 진단, 가상내과');
      const AC = '.nt-row:has(.nt-label:text-is("급성질환"))';
      await page.click(`${AC} .nt-chip:has-text("폐렴")`); await page.fill(`${AC} .nt-note input`, '가상병원 입원');
      const o2 = await page.inputValue('#ntOut');
      await page.click(`.nt-row:has(.nt-label:has-text("만성질환")) .nt-chip:text-is("고혈압")`);
      const o3 = await page.inputValue('#ntOut'), nLeft = await page.$$eval('.nt-row:has(.nt-label:has-text("만성질환")) .nt-note', x => x.length);
      check('주질환: 질환마다 메모 → ‘고혈압(2010년 진단, 가상내과), 당뇨병, 폐렴(치료중, 가상병원 입원)’, 해제하면 메모 칸·문장도 빠짐',
        o2.includes('*주질환\n-고혈압(2010년 진단, 가상내과), 당뇨병, 폐렴(치료중, 가상병원 입원)') && o3.includes('*주질환\n-당뇨병, 폐렴(치료중, 가상병원 입원)') && nLeft === 1, JSON.stringify([o2, o3]));
      // 상담 메모 위 만 나이 계산기
      await page.fill('#ntAgeIn', '480312'); const ag = await page.textContent('#ntAgeOut');
      const y = new Date().getFullYear(), had = (new Date().getMonth() > 2 || (new Date().getMonth() === 2 && new Date().getDate() >= 12));
      check('상담 메모 탭 만 나이 계산기: 480312 → 만·한국 나이', ag.includes(`만 ${y - 1948 - (had ? 0 : 1)}세`) && ag.includes(`한국 나이 ${y - 1948 + 1}세`), ag);
      await page.click('#ntClear');
      check('다음 대상자: 메모 칸·나이 입력도 지움', await page.inputValue('#ntAgeIn') === '' && !(await page.$('.nt-note')) && !(await page.inputValue('#ntOut')));
    }
    // CIST 치매검사 여부·시기
    { const C = lab('CIST 치매검사');
      await page.click(`${C} [data-pickf][data-v="받음"]`); const c1 = await page.inputValue('#ntOut');
      await page.click(`${C} [data-pickf][data-v="작년"]`); const c2 = await page.inputValue('#ntOut');
      await page.click(`${C} [data-pickf][data-v="작년"]`); await page.click(`${C} [data-pickf][data-v="안 받음"]`); const c3 = await page.inputValue('#ntOut');
      check('CIST 치매검사: ‘-CIST 치매검사: 받음(작년)’, 시기 안 고르면 괄호 없이, 안 받음', c1 === '*건강상담\n-CIST 치매검사: 받음' && c2 === '*건강상담\n-CIST 치매검사: 받음(작년)' && c3 === '*건강상담\n-CIST 치매검사: 안 받음', JSON.stringify([c1, c2, c3]));
      await page.click('#ntClear'); }
    // 평형성 · Mini-Cog
    { const B = lab('평형성'), M = lab('Mini-Cog');
      await page.click(`${B} [data-pickf][data-v="측정불가"]`); await page.fill(`${B} input[data-k="0"]`, '0');
      await page.fill(`${M} input[data-k="0"]`, '3'); await page.fill(`${M} input[data-k="1"]`, '2');
      const tot = await page.inputValue(`${M} [data-calc]`), fl = await page.textContent(`${M} [data-flag$=":2"]`), o = await page.inputValue('#ntOut');
      await page.fill(`${M} input[data-k="0"]`, '1'); await page.fill(`${M} input[data-k="1"]`, '0');
      const tot2 = await page.inputValue(`${M} [data-calc]`), fl2 = await page.textContent(`${M} [data-flag$=":2"]`);
      await page.fill(`${B} input[data-k="0"]`, '12'); await page.click(`${B} [data-pickf][data-v="측정불가"]`); const o2 = await page.inputValue('#ntOut');
      check('평형성·Mini-Cog: ‘-평형성: 측정불가, 0초’ / ‘-mini-cog: 3단어(3/3), 시계그리기(2/2)’, 총점 자동·0~2점 인지저하 의심, 총점은 메모에 안 들어감',
        o.includes('*신체계측 및 신체사정\n-평형성: 측정불가, 0초\n-mini-cog: 3단어(3/3), 시계그리기(2/2)') && tot === '5' && fl === '음성' && tot2 === '1' && fl2 === '인지저하 의심' && o2.includes('-평형성: 12초\n-mini-cog: 3단어(1/3), 시계그리기(0/2)') && !/총점|음성|의심/.test(o2), JSON.stringify([o, tot, fl, tot2, fl2, o2]));
      await page.click('#ntClear'); }
    // 신체계측: 키·몸무게 → BMI 자동
    const BH = `${lab('신체계측')} input[data-k="0"]`, BW = `${lab('신체계측')} input[data-k="1"]`, bf = () => page.textContent(`${lab('신체계측')} [data-flag$=":2"]`), bv = () => page.inputValue(`${lab('신체계측')} [data-calc]`);
    const hasW = ordM.includes('체중');
    await page.fill(BW, '55'); const bOnlyW = await page.inputValue('#ntOut'); const bv0 = await bv();
    await page.fill(BH, '160'); const bv1 = await bv(), bf1 = await bf(), bOut1 = await page.inputValue('#ntOut'); await page.screenshot({ path: path.join(__dirname, 'bmi.png') });
    await page.fill(BW, '70'); const bv2 = await bv(), bf2 = await bf();
    await page.fill(BW, '45'); const bf3 = await bf();
    await page.fill(BW, '62'); const bf4 = await bf();
    const ro = await page.$eval(`${lab('신체계측')} [data-calc]`, x => x.readOnly);
    check('신체계측: 키·몸무게 → BMI 자동(직접 입력 안 됨), 대한비만학회 기준 판정, ‘체중’ 항목 없음', !hasW && ro && bv0 === '' && bv1 === '21.5' && bf1 === '정상' && bv2 === '27.3' && bf2 === '1단계 비만' && bf3 === '저체중' && bf4 === '비만 전단계', JSON.stringify([hasW, bv0, bv1, bf1, bv2, bf2, bf3, bf4]));
    check('메모: *신체계측 / -키: …cm / 몸무게: …kg / BMI: …, 빈 칸은 빠짐', bOut1 === '*신체계측 및 신체사정\n-키: 160cm / 몸무게: 55kg / BMI: 21.5' && bOnlyW === '*신체계측 및 신체사정\n-몸무게: 55kg', JSON.stringify([bOut1, bOnlyW]));
    await page.click('#ntClear');
    // 서두
    const firstGroup = await page.$eval('.nt-group .lk-cat-h', h => h.textContent);
    const L = `${lab('서두')} [data-lead]`, lead = o => page.click(`${lab('서두')} .nt-chip:text-is("${o}")`);
    await page.fill(L, '신규등록을 위해'); await lead('방문함');
    const s1 = await page.inputValue('#ntOut');
    await lead('동행방문함'); const s2 = await page.inputValue('#ntOut');
    await page.fill(L, ''); await lead('내소함'); const s3 = await page.inputValue('#ntOut');
    await page.fill(L, '가상 상담을 위해'); await page.fill(`${lab('Vital')} input[data-k="2"]`, '80'); await chip('수면', '양호');
    const s4 = await page.inputValue('#ntOut');
    check('서두(맨 위): 입력 + 방문함 → “신규등록을 위해 방문함.”, 동행방문함으로 바꿈, 입력 없으면 “내소함.”, 메모 맨 앞', firstGroup === '상담목적' && s1 === '*신규등록을 위해 방문함.' && s2 === '*신규등록을 위해 동행방문함.' && s3 === '*내소함.' && s4 === '*가상 상담을 위해 내소함.\n\n*Vital\n-PR: 80회/분\n\n*건강상담\n-수면 양호하다고 함.', JSON.stringify([s1, s2, s3, s4]));
    await page.click('#ntClear');
    check('다음 대상자 → 서두 입력칸도 비움', (await page.inputValue(L)) === '');
    // 만성질환 → *주질환
    const ord = await page.$$eval('.nt-group', g => g.map(x => [x.querySelector('.lk-cat-h').textContent, x.querySelector('.nt-label').textContent]));
    const dz = d => page.click(`.nt-row:has(.nt-label:has-text("만성질환")) .nt-chip:text-is("${d}")`);
    await dz('고혈압'); await dz('당뇨병'); await dz('관절염');
    await page.fill(`${lab('Vital')} input[data-k="2"]`, '80');
    await chip('수면', '양호');
    out = await page.inputValue('#ntOut');
    check('만성질환(건강 상태 맨 앞) 여러 개 → *주질환 / -고혈압, 당뇨병, 관절염 (Vital 다음 줄, 그 뒤 문장)', JSON.stringify(ord.find(x => x[0] === '주질환')) === '["주질환","만성질환 (여러 개)"]' && out === '*Vital\n-PR: 80회/분\n\n*주질환\n-고혈압, 당뇨병, 관절염\n\n*건강상담\n-수면 양호하다고 함.', JSON.stringify(out));
    await page.click('#ntClear');
    // 급성질환: 치료중 → 완치 → 해제, *주질환 줄에 함께
    const ac = d => page.click(`.nt-row:has(.nt-label:text-is("급성질환")) .nt-chip:has-text("${d}")`);
    const ordA = await page.$$eval('.nt-row .nt-label', l => l.map(x => x.textContent.replace(/\s*\(.*\)$/, '')));
    await ac('폐렴'); const q1 = await page.inputValue('#ntOut');
    await ac('대상포진'); await ac('대상포진'); const q2 = await page.inputValue('#ntOut');
    await page.click(`.nt-row:has(.nt-label:has-text("만성질환")) .nt-chip:text-is("고혈압")`); await chip('전반적 컨디션', '양호');
    const q3 = await page.inputValue('#ntOut');
    const chipTxt = await page.textContent(`.nt-row:has(.nt-label:text-is("급성질환")) .nt-chip.on.done`);
    await ac('폐렴'); await ac('폐렴'); const q4 = await page.inputValue('#ntOut');
    check('급성질환(만성질환 다음): 한 번 치료중·두 번 완치·세 번 해제, *주질환 줄에 만성질환과 함께, 컨디션은 -문장',
      ordA[ordA.indexOf('만성질환') + 1] === '급성질환' && q1 === '*주질환\n-폐렴(치료중)' && q2 === '*주질환\n-폐렴(치료중), 대상포진(완치)'
      && q3 === '*주질환\n-고혈압, 폐렴(치료중), 대상포진(완치)\n\n*건강상담\n-전반적인 컨디션 양호하다고 함.' && /대상포진.*완치/.test(chipTxt) && q4 === '*주질환\n-고혈압, 대상포진(완치)\n\n*건강상담\n-전반적인 컨디션 양호하다고 함.', JSON.stringify([q1, q2, q3, q4]));
    await page.click('[data-ntview="edit"]'); await page.uncheck('#ntDash'); await page.click('[data-ntview="write"]');
    const q5 = await page.inputValue('#ntOut');
    check('‘문장 앞에 - 붙이기’ 끄면 예전처럼', q5 === '*주질환\n고혈압, 대상포진(완치)\n\n*건강상담\n전반적인 컨디션 양호하다고 함.', JSON.stringify(q5));
    await page.click('[data-ntview="edit"]'); await page.check('#ntDash'); await page.click('[data-ntview="write"]');
    await page.click('#ntClear');
    // 투약 중단
    await chip('투약 중단', '약 부작용'); let o1 = await page.inputValue('#ntOut');
    await chip('투약 중단', '증상 호전'); let o2 = await page.inputValue('#ntOut');
    const order = await page.$$eval('.nt-row .nt-label', l => l.map(x => x.textContent.replace(/\s*\(.*\)$/, '')));
    await chip('투약 중단', '증상 호전');
    check('복약 다음에 ‘투약 중단’: 약 부작용 / 증상 호전 문장', o1 === '*복약\n-약 부작용으로 인해 투약 중단했다고 함.' && o2 === '*복약\n-증상 호전으로 인해 투약 중단했다고 함.' && order[order.indexOf('복약') + 1] === '투약 중단' && order[order.indexOf('처방약') + 1] === '복약', JSON.stringify([o1, o2]));
    // 처방약 검색
    const DQ = `${lab('처방약')} [data-dq]`, rows = () => page.$$eval(`${lab('처방약')} .nt-drug`, r => r.map(x => [x.querySelector('[data-dname]').value, x.querySelector('[data-dnote]').value]));
    await page.click(DQ); await page.keyboard.type('노바');
    const first = await page.textContent(`${lab('처방약')} .nt-dopt.first`);
    const link = await page.getAttribute(`${lab('처방약')} .nt-dlink`, 'href');
    await page.keyboard.press('Enter');
    let dr = await rows();
    check('약 이름 검색 → 첫 결과 Enter로 추가 (이름·괄호 메모 자동)', /노바스크정/.test(first) && /고혈압약/.test(first) && JSON.stringify(dr) === '[["노바스크정","고혈압약"]]' && link === 'https://nedrug.mfds.go.kr/searchDrug?itemName=' + encodeURIComponent('노바'), first + ' | ' + JSON.stringify(dr));
    await page.fill(DQ, '메트포르민'); await page.dispatchEvent(DQ, 'input');
    const ingList = await page.$$eval(`${lab('처방약')} .nt-dopt b`, b => b.map(x => x.textContent));
    await page.click(`${lab('처방약')} .nt-dopt:has(b:text-is("다이아벡스정"))`);
    await page.fill(DQ, 'ㅋㄹㅅㅌ'); await page.dispatchEvent(DQ, 'input');
    const choFirst = await page.textContent(`${lab('처방약')} .nt-dopt.first b`); await page.press(DQ, 'Enter');
    dr = await rows();
    check('성분명 검색·목록에서 누르기·초성 검색', ingList.includes('다이아벡스정') && ingList.includes('글루코파지정') && choFirst === '크레스토정' && JSON.stringify(dr.map(r => r[0])) === '["노바스크정","다이아벡스정","크레스토정"]', JSON.stringify([ingList.slice(0, 4), choFirst]));
    await page.fill(DQ, '가상약정'); await page.dispatchEvent(DQ, 'input'); await page.click(`${lab('처방약')} [data-draw]`);
    const vnote = `${lab('처방약')} .nt-drug:has([value="가상약정"]) [data-dnote]`;
    await page.fill(vnote, '가상 메모약'); await page.click('#ntExtra');
    await page.fill(`${lab('처방약')} .nt-drug:has([value="노바스크정"]) [data-dnote]`, '혈압약'); await page.click('#ntExtra');
    out = await page.inputValue('#ntOut');
    check('메모 결과: *복약 / -복용약: 노바스크정(혈압약), 다이아벡스정(당뇨약), 크레스토정(고지혈증약), 가상약정(가상 메모약)', out.includes('*복약\n-복용약: 노바스크정(혈압약), 다이아벡스정(당뇨약), 크레스토정(고지혈증약), 가상약정(가상 메모약)'), out);
    await page.waitForTimeout(1200);
    const my = await page.evaluate(() => JSON.parse(localStorage.getItem('vhm-notes-tpl')).drugs);
    await page.fill(DQ, '가상'); await page.dispatchEvent(DQ, 'input'); const mineTxt = await page.textContent(`${lab('처방약')} .nt-dopt.first`);
    check('직접 추가·메모 바꾼 약은 ‘내 약 목록’에 기억 → 다음 검색에 먼저', JSON.stringify(my) === '[{"name":"노바스크정","note":"혈압약"},{"name":"가상약정","note":"가상 메모약"}]' && /가상약정/.test(mineTxt) && /내 목록/.test(mineTxt), JSON.stringify(my) + ' | ' + mineTxt);
    await page.keyboard.press('Escape');
    await page.click(`${lab('처방약')} .nt-drug:has([value="다이아벡스정"]) [data-ddel]`);
    dr = await rows();
    const stored = await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)));
    check('✕로 빼기 · 대상자별 복용약 목록은 저장 안 됨', dr.length === 3 && !/다이아벡스|크레스토/.test(stored), JSON.stringify(dr));
    // 영양제 (처방약 아래, 같은 방식, 목록은 따로)
    const SQ = `${lab('영양제')} [data-dq]`;
    const ordS = await page.$$eval('.nt-row .nt-label', l => l.map(x => x.textContent));
    await page.click(SQ); await page.keyboard.type('눈');
    const sFirst = await page.textContent(`${lab('영양제')} .nt-dopt.first`), sLink = await page.$$(`${lab('영양제')} .nt-dlink`);
    await page.keyboard.press('Enter');
    await page.click(SQ); await page.keyboard.type('ㅇㅁㄱ3'); const sCho = await page.textContent(`${lab('영양제')} .nt-dopt.first b`); await page.keyboard.press('Enter');
    await page.fill(SQ, '가상영양제'); await page.dispatchEvent(SQ, 'input'); await page.click(`${lab('영양제')} [data-draw]`);
    await page.fill(`${lab('영양제')} .nt-drug:has([value="가상영양제"]) [data-dnote]`, '가상 기능'); await page.click('#ntExtra');
    out = await page.inputValue('#ntOut'); await page.waitForTimeout(1200);
    const tplS = await page.evaluate(() => JSON.parse(localStorage.getItem('vhm-notes-tpl')));
    check('영양제(처방약 아래): 기능으로 검색(눈→루테인)·초성, 의약품안전나라 링크 없음, 메모 *영양제 묶음', ordS[ordS.indexOf('투약 중단') + 1] === '영양제' && /루테인/.test(sFirst) && /눈 건강/.test(sFirst) && sLink.length === 0 && sCho === '오메가3' && out.includes('*복약\n-복용약: 노바스크정(혈압약), 크레스토정(고지혈증약), 가상약정(가상 메모약)\n-영양제: 루테인(눈 건강), 오메가3(혈중 중성지방·혈행), 가상영양제(가상 기능)'), JSON.stringify([sFirst, sCho, out]));
    check('직접 추가한 영양제는 ‘내 영양제 목록’에만 (약 목록과 따로)', JSON.stringify(tplS.supps) === '[{"name":"가상영양제","note":"가상 기능"}]' && !tplS.drugs.some(d => d.name === '가상영양제'), JSON.stringify([tplS.supps, tplS.drugs]));
    await page.click('#ntClear');
    // 문장 틀이 있어도 보기별 문장을 우선 사용 (별도 브라우저로 기존 테스트와 분리)
    {
      const customCtx = await b.newContext();
      const customPage = await customCtx.newPage();
      const customTpl = JSON.parse(JSON.stringify(tplS));
      const education = customTpl.items.find(i => i.label === '교육 내용');
      education.options = [
        { label: '예방접종 안내', text: '2026-2027절기 인플루엔자 무료예방접종 안내함.' },
        { label: '저염식', text: '' }, { label: '낙상 예방', text: '   ' }
      ];
      await customPage.addInitScript(tpl => localStorage.setItem('vhm-notes-tpl', JSON.stringify(tpl)), customTpl);
      await customPage.goto(BASE); await customPage.click('[data-tab="note"]');
      const customChip = label => customPage.click(`.nt-row:has(.nt-label:has-text("교육 내용")) .nt-chip:text-is("${label}")`);
      await customChip('예방접종 안내');
      check('문장 틀보다 보기별 코멘트 우선, 교육함 중복 없음', (await customPage.inputValue('#ntOut')) === '*건강상담\n-2026-2027절기 인플루엔자 무료예방접종 안내함.');
      await customChip('저염식'); await customChip('낙상 예방');
      const mixed = await customPage.inputValue('#ntOut');
      check('코멘트 있는 보기와 없는 보기 함께 선택: 기본 보기만 문장 틀 적용', mixed.includes('-2026-2027절기 인플루엔자 무료예방접종 안내함.') && mixed.includes('저염식, 낙상 예방 교육함.') && !mixed.includes('예방접종 안내,') && !mixed.includes('안내함. 교육함.'));
      await customChip('예방접종 안내');
      check('코멘트 보기 해제 시 기본 문장 유지', (await customPage.inputValue('#ntOut')) === '*건강상담\n-저염식, 낙상 예방 교육함.');
      await customCtx.close();
    }
    // 편집
    await page.click('[data-ntview="edit"]'); await page.click('.lk-row:has-text("수면")'); await page.waitForSelector('#ntDlg[open]');
    await page.fill('#ntDlgBody input[data-o="0"][data-f="text"]', '잠은 잘 주무신다고 하심.'); await page.click('#ntSave');
    await page.click('#ntAdd'); await page.fill('#neLabel', '가상 새 항목'); await page.fill('#neGroup', '추가 묶음');
    await page.selectOption('#neKind', 'num'); await page.fill('#ntDlgBody input[data-fl="0"][data-f="unit"]', '회'); await page.fill('#neTpl', '가상 측정 {1}회 함.'); await page.click('#ntSave');
    await page.click('.lk-row:has-text("가상 새 항목") [data-dir="-1"]');
    await page.selectOption('#ntJoin', '\n');
    await page.click('[data-ntview="write"]');
    await chip('수면', '양호'); await page.fill(`${lab('가상 새 항목')} input`, '3');
    out = await page.inputValue('#ntOut');
    check('항목 편집: 문장 고치기·새 숫자 항목 추가·순서·줄바꿈 구분', out === '*건강상담\n-잠은 잘 주무신다고 하심.\n\n*추가 묶음\n-가상 측정 3회 함.', JSON.stringify(out));
    // 기준 고치기 + 메모에 ↑↓
    await page.click('[data-ntview="edit"]'); await page.click('.lk-row:has-text("Vital")'); await page.waitForSelector('#ntDlg[open]');
    await page.fill('#ntDlgBody .nt-r[data-rk="2"][data-rf="max"]', '90'); await page.click('#ntSave');
    await page.check('#ntFlagMemo'); await page.click('[data-ntview="write"]');
    await page.fill(`${lab('Vital')} input[data-k="0"]`, '150'); await page.fill(`${lab('Vital')} input[data-k="2"]`, '95'); await page.fill(`${lab('Vital')} input[data-k="1"]`, '70');
    const f5 = await page.textContent('[data-flag$=":2"]'); out = await page.inputValue('#ntOut');
    check('맥박 기준을 90으로 고치면 95 높음 · 메모에도 ↑ 표시', f5 === '높음' && out.startsWith('*Vital\n-BP: 150↑/70mmHg, PR: 95↑회/분'), JSON.stringify(out));
    await page.click('[data-ntview="edit"]'); await page.uncheck('#ntFlagMemo'); await page.click('[data-ntview="write"]');
    await page.reload(); await page.click('[data-tab="note"]'); await page.waitForSelector('#ntOut');
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('vhm-notes-tpl')));
    check('고친 틀은 이 기기에 남음, 체크 내용은 새로 열면 비어 있음', persisted.items.some(i => i.label === '가상 새 항목') && (await page.inputValue('#ntOut')) === '' );
    await page.click('[data-ntview="edit"]'); await page.click('.lk-row:has-text("가상 새 항목")'); await page.click('#ntDel');
    await page.click('#ntConfirm');
    const t2 = await page.evaluate(() => JSON.parse(localStorage.getItem('vhm-notes-tpl')));
    check('항목 삭제·확인 완료', !t2.items.some(i => i.label === '가상 새 항목') && t2.defaultsPending === false);
    // 예전(처방약 항목 없던) 틀을 고쳐 쓰던 경우: 고친 내용 유지 + 처방약 항목 추가
    await page.evaluate(() => { const d = NOTES._defaults(); d.schema = 2; d.defaultsPending = false; d.items = d.items.filter(i => i.kind !== 'drugs' && i.kind !== 'lead' && i.label !== '투약 중단' && i.label !== '악력' && i.label !== '만성질환' && i.label !== '당화혈색소' && i.kind !== 'acute'); d.items.find(i => i.label === '수면').options[0].text = '가상 고친 문장.'; delete d.drugs; const bk = d.items.findIndex(i => i.label === '신체계측'); d.items[bk] = { id: 'oldw', group: '측정', label: '체중', kind: 'num', options: [], fields: [{ label: '체중', unit: 'kg' }], template: '체중 {1}kg 측정함.' }; localStorage.setItem('vhm-notes-tpl', JSON.stringify(d)); });
    await page.reload(); await page.click('[data-tab="note"]'); await page.waitForSelector('#ntOut');
    const mig2 = await page.evaluate(() => { const it = NOTES._state.tpl.items, gs = []; it.forEach(i => { if (!gs.includes(i.group)) gs.push(i.group); });
      return { gs: gs.join('>'), first: it[0].kind, txt: it.find(i => i.label === '수면').options[0].text, w: it.some(i => i.label === '체중'), body: (it.find(i => i.label === '신체계측') || {}).group, act: !!it.find(i => i.label === '신체활동'), cist: it.findIndex(i => i.label === 'CIST 치매검사') === it.findIndex(i => i.label === '건강검진') + 1, bal: it.findIndex(i => i.label === '평형성') === it.findIndex(i => i.label === '악력') + 1 && it.findIndex(i => i.label === 'Mini-Cog') === it.findIndex(i => i.label === '악력') + 2, drugs: it.filter(i => i.kind === 'drugs').length, schema: NOTES._state.tpl.schema }; });
    check('예전 틀 → 상담기록 순서로 재배치, 고친 문장 유지, 체중→신체계측, 운동→신체활동', mig2.gs === '상담목적>Vital>주질환>복약>신체계측 및 신체사정>건강상담>생활습관>서비스제공>기타사항' && mig2.first === 'lead' && mig2.txt === '가상 고친 문장.' && !mig2.w && mig2.body === '신체계측 및 신체사정' && mig2.act && mig2.drugs === 2 && mig2.schema === 16 && mig2.bal && mig2.cist, JSON.stringify(mig2));
    await page.evaluate(() => { const d = JSON.parse(JSON.stringify(NOTES._state.tpl)); d.items.find(i => i.kind === 'drugs').template = '복용약: {목록}'; localStorage.setItem('vhm-notes-tpl', JSON.stringify(d)); });
    await page.reload(); await page.click('[data-tab="note"]'); await page.waitForSelector('#ntOut');
    await page.click(`${lab('처방약')} [data-dq]`); await page.keyboard.type('노바'); await page.keyboard.press('Enter');
    await page.click(`${lab('처방약')} [data-dq]`); await page.keyboard.type('ㅋㄹㅅㅌ'); await page.keyboard.press('Enter');
    await chip('수면', '양호');
    out = await page.inputValue('#ntOut');
    check('복약 묶음: *복약 / -복용약: 약(메모), … 그 뒤 건강상담 묶음', out === '*복약\n-복용약: 노바스크정(고혈압약), 크레스토정(고지혈증약)\n\n*건강상담\n-가상 고친 문장.', JSON.stringify(out));
    await page.click('#ntClear');
    // 사용자 상담기록 형식 전체 + 커서 자리에 넣기
    await page.fill(`${lab('서두')} [data-lead]`, '가상 의뢰로 인하여'); await page.click(`${lab('서두')} .nt-chip:text-is("방문함")`);
    await page.fill(`${lab('상담 내용')} [data-lead]`, '가상 상담 내용 적음.');
    await page.fill(V(0), '120'); await page.fill(V(1), '70'); await page.fill(V(2), '72');
    await page.click(`.nt-row:has(.nt-label:has-text("만성질환")) .nt-chip:text-is("고혈압")`);
    await page.click(`${lab('처방약')} [data-dq]`); await page.keyboard.type('노바'); await page.keyboard.press('Enter');
    await chip('복약', '규칙적');
    await page.fill(`${lab('신체계측')} input[data-k="0"]`, '160'); await page.fill(`${lab('신체계측')} input[data-k="1"]`, '55');
    for (const [f, v] of [['눈', '양호'], ['귀', '양호'], ['구강건강', '양호']]) await page.click(`${lab('눈·귀·구강')} [data-pickf][data-v="${v}"] >> nth=${['눈', '귀', '구강건강'].indexOf(f)}`);
    await page.click(`${lab('관절')} [data-pickf][data-v="양호"]`);
    await chip('전반적 컨디션', '양호'); await chip('건강검진', '받음'); await chip('흡연', '안 함'); await chip('신체활동', '하고 있음');
    await page.click(`${lab('물품')} [data-tadd][data-v="혈압계"]`); await page.click(`${lab('물품')} [data-tadd][data-v="체온계"]`);
    await page.fill(`${lab('보건복지서비스 연계')} [data-lead]`, '가상센터 연계');
    await page.fill('#ntExtra', '가상 기타 메모.');
    const full = await page.inputValue('#ntOut'); await page.screenshot({ path: path.join(__dirname, 'notes-full.png'), fullPage: true });
    const want = ['*가상 의뢰로 인하여 방문함.', '-가상 상담 내용 적음.', '', '*Vital', '-BP: 120/70mmHg, PR: 72회/분', '', '*주질환', '-고혈압', '', '*복약', '-복용약: 노바스크정(고혈압약)', '-처방약 규칙적으로 복용 중이라 함.', '',
      '*신체계측 및 신체사정', '-키: 160cm / 몸무게: 55kg / BMI: 21.5', '-눈: 양호, 귀: 양호, 구강건강: 양호', '-관절: 양호', '', '*건강상담', '-전반적인 컨디션 양호하다고 함.', '-올해 건강검진 받았다고 함.', '',
      '*생활습관', '-비흡연.', '-걷기 등 꾸준히 신체활동 하고 계심.', '', '*서비스제공', '-물품: 혈압계, 체온계', '-보건복지서비스 연계: 가상센터 연계', '', '*기타사항', '-가상 기타 메모.'].join('\n');
    check('상담기록 순서: 상담목적 → Vital → 주질환 → 복약 → 신체계측 및 신체사정 → 건강상담 → 생활습관 → 서비스제공 → 기타사항', full === want, JSON.stringify(full));
    // 커서 자리에 넣기: 주질환 줄 끝을 누른 뒤 수면 → 그 자리(주질환 아래)에 들어감, 이어서 누르면 그 아래로
    await page.evaluate(() => { const t = document.querySelector('#ntOut'); const i = t.value.indexOf('-고혈압') + '-고혈압'.length; t.focus(); t.setSelectionRange(i, i); t.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const cap = await page.textContent('#ntCaret');
    await chip('수면', '양호'); await chip('식사', '규칙적');
    const c1 = await page.inputValue('#ntOut');
    await chip('수면', '양호');
    const c2 = await page.inputValue('#ntOut');
    await page.click('#ntCaretOff'); await chip('배변', '양호');
    const c3 = await page.inputValue('#ntOut');
    check('커서를 둔 곳에 입력: 커서 줄 아래에 차례로 들어감 → 다시 누르면 그 줄만 빠짐 → ‘원래 순서로’ 누르면 바로 앞 문장(식사) 옆으로',
      /커서 자리에 넣는 중/.test(cap) && c1.includes('*주질환\n-고혈압\n-가상 고친 문장.\n-식사 규칙적으로 하신다고 함.\n\n*복약') && !c2.includes('가상 고친 문장') && c2.includes('-고혈압\n-식사 규칙적으로 하신다고 함.')
      && c3.includes('-식사 규칙적으로 하신다고 함.\n-배변 양호함.') && c3.split('배변').length === 2, JSON.stringify([c1, c2, c3]));
    await page.click('#ntClear');
    await page.click('#ntClear');
    // 좁은 화면
    for (const [w, h, n] of [[390, 844, 'phone'], [820, 1180, 'tablet']]) {
      await page.setViewportSize({ width: w, height: h }); await page.click('[data-ntview="write"]');
      await chip('수면', '양호');
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      await page.screenshot({ path: path.join(__dirname, 'notes-' + n + '.png') });
      check(n + ' 화면 가로 넘침 없음', sw <= w, String(sw));
    }
    check('스크립트 오류 없음', errs.length === 0, errs.join(' | '));
  } catch (e) { R.push('CRASH ' + e.message.split('\n')[0] + ' | errs: ' + errs.join(' ; ')); }
  await b.close(); server.close(); console.log(R.join('\n'));
})();
