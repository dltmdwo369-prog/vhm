/* =====================================================================
 * 상담 메모: 체크리스트를 고르면 메모 문장이 자동으로 만들어지고, 복사해서 기관 전용앱에 붙여 넣음
 * - 체크·입력한 내용과 문장은 자동 저장·전송하지 않음. 사용자가 저장할 때만 별도 암호화 보관.
 * - 질문 항목·문장 틀만 이 기기에 저장 + 드라이브가 연결되어 있으면 드라이브에도 저장(기기 간 공유)
 * ===================================================================== */
(function () {
  'use strict';
  const LS = 'vhm-notes-tpl';
  const HIRA_MEDICATION_URL = 'https://www.hira.or.kr/rb/dur/form.do?pgmid=HIRAA050300000100';
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
  const KINDS = { one: '하나 고르기', many: '여러 개 고르기', num: '숫자 입력', drugs: '약 검색', lead: '입력칸 + 하나 고르기', acute: '여러 개 + 치료중·완치', text: '직접 적기 (+ 빠른 입력)' };
  const SCHEMA = 16;
  const NOTE_ITEMS = ['만성질환', '급성질환', '눈·귀·구강', '관절'];   // 고른 보기마다 메모 칸 (사용자 요청 2026-11-12)
  const NO_HEAD = ['상담목적'];   // 이 묶음은 '*묶음이름' 머리줄 없이 (서두 줄이 이미 *로 시작)
  const ACUTE_ST = ['치료중', '완치'];   // 누를 때마다: 치료중 → 완치 → 해제

  // 기본 틀 (임시 — 사용자가 확인 후 고침)
  /* 악력 참고치: 한국인 국민건강영양조사 2014–2015 (PLoS ONE 2018, PMC6101358) 표 3 — 오른손·왼손 평균과 하위 20%(lowest quintile), kg
     근력 저하: AWGS 2019(아시아 근감소증 진단 기준, 대한근감소증학회 진료지침도 같은 기준) 양손 중 최댓값 남 28kg·여 18kg 미만 */
  const GRIP = {
    남: { R: [[60, 39.3, 33.8], [65, 36.8, 32.1], [70, 33.9, 28.9], [75, 31.4, 26.1], [80, 27.4, 22.1]], L: [[60, 37.7, 32.6], [65, 35.1, 29.7], [70, 32.5, 27.7], [75, 30.7, 25.8], [80, 26.3, 21.9]], cut: 28 },
    여: { R: [[60, 24.6, 21.2], [65, 23.2, 19.4], [70, 21.6, 18.2], [75, 19.8, 15.5], [80, 16.9, 13.0]], L: [[60, 23.1, 20.0], [65, 21.6, 18.1], [70, 20.1, 16.5], [75, 18.7, 15.1], [80, 15.8, 12.4]], cut: 18 }
  };
  // 평형성(초, 측정불가) · Mini-Cog(3단어 회상 0~3 + 시계그리기 0/2 = 총점 0~5, 0~2점이면 인지저하 의심: Borson 등 2000) — 사용자 요청 2026-11-12
  const balanceItem = () => ({ id: uid(), group: '신체계측 및 신체사정', label: '평형성', kind: 'num', options: [], template: '-평형성: {2}, {1}초', fields: [
    { label: '유지 시간', unit: '초' }, { label: '측정', type: 'pick', options: '측정불가' }] });
  const minicogItem = () => ({ id: uid(), group: '신체계측 및 신체사정', label: 'Mini-Cog', kind: 'num', options: [], template: '-mini-cog: 3단어({1}/3), 시계그리기({2}/2)', fields: [
    { label: '3단어 회상', unit: '/3' }, { label: '시계그리기', unit: '/2' }, { label: '총점', unit: '/5', calc: 'minicog' }] });
  // CIST(인지선별검사) 받은 여부·시기 — 사용자 요청 2026-11-12
  const cistItem = () => ({ id: uid(), group: '건강상담', label: 'CIST 치매검사', kind: 'num', options: [], template: '-CIST 치매검사: {1}({2})', fields: [
    { label: '검사', type: 'pick', options: '받음,안 받음,모름' }, { label: '받은 때', type: 'pick', options: '올해,작년,2년 이상 전' }] });
  const gripItem = () => ({ id: uid(), group: '신체계측 및 신체사정', label: '악력', kind: 'num', options: [], template: '-악력 Rt: {1}kg, Lt: {2}kg', fields: [
    { label: '오른손', unit: 'kg', norm: 'gripR' }, { label: '왼손', unit: 'kg', norm: 'gripL' },
    { label: '성별', type: 'pick', options: '남,여' }, { label: '나이', unit: '세' }] });
  // 신체계측: 키·몸무게 → BMI 자동 계산. 판정은 대한비만학회 2022 진료지침(18.5 미만 저체중, 18.5~22.9 정상, 23~24.9 비만 전단계, 25~29.9 1단계 비만, 30~34.9 2단계, 35 이상 3단계)
  const bodyItem = () => ({ id: uid(), group: '신체계측 및 신체사정', label: '신체계측', kind: 'num', options: [], template: '-키: {1}cm / 몸무게: {2}kg / BMI: {3}', fields: [
    { label: '키', unit: 'cm' }, { label: '몸무게', unit: 'kg' }, { label: 'BMI', unit: 'kg/m²', calc: 'bmi' }] });
  // 서두: 입력칸 문장 + 고른 보기 → '신규등록을 위해 방문함.'
  const leadItem = () => ({ id: uid(), group: '상담목적', label: '서두', kind: 'lead', options: [{ label: '방문함', text: '방문함.' }, { label: '내소함', text: '내소함.' }, { label: '동행방문함', text: '동행방문함.' }], fields: [], template: '*' });
  // 당화혈색소: 대한당뇨병학회 진단기준 — 정상 <5.7%, 당뇨병 전단계 5.7~6.4%(주의), 당뇨병 ≥6.5%(높음)
  const a1cItem = () => ({ id: uid(), group: 'Vital', label: '당화혈색소', kind: 'num', options: [], template: '-HbA1c: {1}%', fields: [{ label: 'HbA1c', unit: '%', range: { min: '', max: '5.6', warn: '6.4' } }] });
  const DISEASES = ['고혈압', '당뇨병', '이상지질혈증', '관절염', '척추질환', '골다공증', '뇌졸중', '심장질환', '치매', '암', '만성폐질환', '만성콩팥병', '갑상선질환', '전립선비대증', '우울증'];
  // 급성질환: '*주질환' 줄에 만성질환과 함께 '폐렴(치료중), 대상포진(완치)'
  const ACUTES = ['감기', '독감', '코로나19', '폐렴', '기관지염', '요로감염', '장염', '대상포진', '골절', '염좌', '피부질환', '결막염'];
  const acuteItem = () => ({ id: uid(), group: '주질환', label: '급성질환', kind: 'acute', options: ACUTES.map(d => ({ label: d, text: '' })), fields: [], template: '{선택}' });
  const diseaseItem = () => ({ id: uid(), group: '주질환', label: '만성질환', kind: 'many', options: DISEASES.map(d => ({ label: d, text: '' })), fields: [], template: '{선택}' });
  const stopItem = () => ({ id: uid(), group: '복약', label: '투약 중단', kind: 'one', options: [{ label: '약 부작용', text: '약 부작용으로 인해 투약 중단했다고 함.' }, { label: '증상 호전', text: '증상 호전으로 인해 투약 중단했다고 함.' }], fields: [], template: '' });
  const drugItem = () => ({ id: uid(), group: '복약', label: '처방약', kind: 'drugs', options: [], fields: [], template: '복용약: {목록}' });
  const suppItem = () => ({ id: uid(), group: '복약', label: '영양제', kind: 'drugs', src: 'supp', options: [], fields: [], template: '영양제: {목록}' });
  const textItem = (group, label, template, opts, ph) => ({ id: uid(), group, label, kind: 'text', options: (opts || []).map(o => ({ label: o, text: '' })), fields: [], template, ph: ph || '' });
  const isSupp = it => it && it.src === 'supp';
  function defaults() {
    const one = (group, label, opts) => ({ id: uid(), group, label, kind: 'one', options: opts.map(([l, t]) => ({ label: l, text: t })), fields: [], template: '' });
    const many = (group, label, opts, template) => ({ id: uid(), group, label, kind: 'many', options: opts.map(([l, t]) => ({ label: l, text: t || '' })), fields: [], template: template || '' });
    const num = (group, label, fields, template) => ({ id: uid(), group, label, kind: 'num', options: [], fields: fields.map(f => Array.isArray(f) ? { label: f[0], unit: f[1] } : f), template });
    // 정상 범위: 대한고혈압학회 2022 진료지침(정상 <120/80, 주의·전단계 ~139/89, 고혈압 ≥140/90), 대한당뇨병학회 진단기준(공복 100~125·식후2시간 140~199 = 주의, 그 이상 = 높음, 70 미만 = 저혈당), 맥박 성인 60~100회/분
    const R = (min, max, warn) => ({ min: min == null ? '' : String(min), max: max == null ? '' : String(max), warn: warn == null ? '' : String(warn) });
    const pk = (label, options) => ({ label, type: 'pick', options });
    // 사용자 상담기록 순서(2026-11-10): 상담목적 → Vital → 주질환 → 복약 → 신체계측 및 신체사정 → 건강상담 → 생활습관 → 서비스제공 → 기타사항
    const base = { schema: SCHEMA, updatedAt: null, defaultsPending: true, joiner: ' ', flagInMemo: false, dash: true, drugs: [], supps: [], items: [
      leadItem(),
      textItem('상담목적', '상담 내용', '{입력}', [], '예: 최근 혈압 조절 안 된다고 하여 혈압 측정 및 상담함.'),
      num('Vital', 'Vital', [
        { label: '수축기', unit: 'mmHg', range: R(90, 119, 139) },
        { label: '이완기', unit: 'mmHg', range: R(60, 79, 89) },
        { label: '맥박', unit: '회/분', range: R(60, 100) },
        { label: '혈당', unit: 'mg/dL', range: R(70, 139, 199), rangeBy: 5, ranges: { '공복': R(70, 99, 125), '식후': R(70, 139, 199) } },
        { label: '혈당 시점', type: 'pick', options: '공복,식후' }
      ], '-BP: {1}/{2}mmHg, PR: {3}회/분, BST({5}): {4}mg/dL'),
      a1cItem(),
      diseaseItem(),
      acuteItem(),
      drugItem(),
      one('복약', '복약', [['규칙적', '처방약 규칙적으로 복용 중이라 함.'], ['가끔 거름', '복약을 가끔 거른다고 하여 규칙적 복약 교육함.'], ['복용약 없음', '현재 복용 중인 약 없다고 함.']]),
      stopItem(),
      suppItem(),
      bodyItem(),
      num('신체계측 및 신체사정', '눈·귀·구강', [pk('눈', '양호,시력저하,백내장,녹내장'), pk('귀', '양호,청력저하,보청기 사용'), pk('구강건강', '양호,불량,틀니 사용,저작 불편')], '-눈: {1}, 귀: {2}, 구강건강: {3}'),
      num('신체계측 및 신체사정', '관절', [pk('관절', '양호,통증,부종,강직,운동 제한')], '-관절: {1}'),
      gripItem(),
      balanceItem(),
      minicogItem(),
      one('건강상담', '전반적 컨디션', [['양호', '전반적인 컨디션 양호하다고 함.'], ['보통', '컨디션 보통이라고 함.'], ['저하', '최근 컨디션 저하 호소함.']]),
      one('건강상담', '통증', [['없음', '특별한 통증 호소 없음.'], ['있음', '통증 호소하여 부위·정도 확인함.']]),
      one('건강상담', '수면', [['양호', '수면 양호하다고 함.'], ['불량', '잠들기 어렵거나 자주 깬다고 함.']]),
      one('건강상담', '식사', [['규칙적', '식사 규칙적으로 하신다고 함.'], ['불규칙', '식사 불규칙하다고 함.'], ['식욕 저하', '식욕 저하 호소함.']]),
      one('건강상담', '배변', [['양호', '배변 양호함.'], ['변비', '변비 호소함.'], ['설사', '설사 증상 있다고 함.']]),
      one('건강상담', '기분·정서', [['안정', '정서 안정적임.'], ['우울감', '우울감 호소하여 경청 및 정서 지지함.'], ['불안', '불안감 호소하여 경청 및 정서 지지함.']]),
      one('건강상담', '낙상', [['없음', '최근 낙상 경험 없다고 함.'], ['있음', '최근 낙상 경험 있다고 하여 낙상 예방 교육함.']]),
      one('건강상담', '건강검진', [['받음', '올해 건강검진 받았다고 함.'], ['예정', '건강검진 받을 예정이라고 함.'], ['안 받음', '올해 건강검진 받지 않아 수검 권유함.']]),
      cistItem(),
      many('건강상담', '교육 내용', [['고혈압 관리'], ['당뇨 관리'], ['저염식'], ['수분 섭취'], ['규칙적 운동'], ['복약'], ['낙상 예방'], ['치매 예방'], ['감염병 예방']], '{선택} 교육함.'),
      one('생활습관', '흡연', [['안 함', '비흡연.'], ['함', '흡연 중이라 하여 금연 권유함.'], ['금연', '금연 중이라고 함.']]),
      one('생활습관', '음주', [['안 함', '음주 안 함.'], ['가끔', '가끔 음주한다고 함.'], ['자주', '음주 잦다고 하여 절주 교육함.']]),
      one('생활습관', '신체활동', [['하고 있음', '걷기 등 꾸준히 신체활동 하고 계심.'], ['안 함', '규칙적인 신체활동 하지 않는다고 하여 신체활동 권유함.']]),
      textItem('서비스제공', '물품', '물품: {입력}', ['혈압계', '혈당측정기', '체온계', '영양제', '구강관리용품', '미끄럼방지매트', '마스크'], '예: 혈압계 대여'),
      textItem('서비스제공', '보건복지서비스 연계', '보건복지서비스 연계: {입력}', ['치매안심센터', '노인맞춤돌봄서비스', '정신건강복지센터', '장기요양 등급신청', '행정복지센터', '보건소 건강증진 프로그램'], '예: 치매안심센터 연계'),
      many('기타사항', '마무리', [['다음 방문 안내', '다음 방문 일정 안내함.'], ['보건소 내소 권유', '보건소 내소 권유함.'], ['진료 권유', '병원 진료 받으시도록 권유함.'], ['서비스 연계 검토', '필요 서비스 연계 검토 예정.']])
    ] };
    base.items.forEach(i => { if (NOTE_ITEMS.includes(i.label)) i.notes = true; });
    return base;
  }
  function clean(d) {
    const base = defaults(); if (!d || !Array.isArray(d.items)) return base;
    if (d.defaultsPending && !(d.schema >= 2)) return base;   // 아직 손대지 않은 예전 임시 틀은 새 기본 틀로
    const rg = r => ({ min: String((r && r.min) ?? '').slice(0, 8), max: String((r && r.max) ?? '').slice(0, 8), warn: String((r && r.warn) ?? '').slice(0, 8) });
    const out = { schema: SCHEMA, updatedAt: d.updatedAt || null, defaultsPending: !!d.defaultsPending, joiner: d.joiner === '\n' ? '\n' : ' ', flagInMemo: !!d.flagInMemo, dash: d.schema >= 11 ? d.dash !== false : true,
      drugs: (Array.isArray(d.drugs) ? d.drugs : []).map(x => ({ name: String(x.name || '').slice(0, 60), note: String(x.note || '').slice(0, 40) })).filter(x => x.name).slice(0, 500),
      supps: (Array.isArray(d.supps) ? d.supps : []).map(x => ({ name: String(x.name || '').slice(0, 60), note: String(x.note || '').slice(0, 40) })).filter(x => x.name).slice(0, 500),
      items: d.items.map(i => ({ id: i.id || uid(), group: String(i.group || '기타').slice(0, 30), label: String(i.label || '').slice(0, 40), kind: KINDS[i.kind] ? i.kind : 'one', ...(i.kind === 'drugs' && i.src === 'supp' ? { src: 'supp' } : {}), ...(i.kind === 'text' && i.ph ? { ph: String(i.ph).slice(0, 80) } : {}), ...(i.notes && ['many', 'acute', 'num'].includes(i.kind) ? { notes: true } : {}),
        options: (i.options || []).map(o => ({ label: String(o.label || '').slice(0, 40), text: String(o.text || '').slice(0, 200) })).filter(o => o.label),
        fields: (i.fields || []).map(f => {
          const o = { label: String(f.label || '').slice(0, 20), unit: String(f.unit || '').slice(0, 10) };
          if (f.type === 'pick') { o.type = 'pick'; o.options = String(f.options || '').slice(0, 80); return o; }
          if (f.norm === 'gripR' || f.norm === 'gripL') { o.norm = f.norm; return o; }
          if (f.calc === 'bmi' || f.calc === 'minicog') { o.calc = f.calc; return o; }
          o.range = rg(f.range); if (+f.rangeBy > 0) { o.rangeBy = +f.rangeBy; o.ranges = {}; Object.keys(f.ranges || {}).forEach(k => { o.ranges[String(k).slice(0, 20)] = rg(f.ranges[k]); }); }
          return o; }).filter(f => f.label),
        template: String(i.template || '').slice(0, 200) })).filter(i => i.label) };
    if (!(d.schema >= 13)) out.items.forEach(i => { if (i.kind === 'drugs' && i.template === '복용약: {목록}') i.template = '*복용약\n-{목록}'; });   // 예전 기본 형식 → *복용약 묶음 (사용자 요청)
    if (!(d.schema >= 3) && !out.items.some(i => i.kind === 'drugs')) {   // 예전 틀에 '처방약' 검색 항목 추가 (손댄 내용은 그대로)
      const k = out.items.findIndex(i => i.label === '복약'); out.items.splice(k >= 0 ? k + 1 : out.items.length, 0, drugItem());
    }
    if (!(d.schema >= 10)) out.items.forEach(i => { if (i.kind === 'lead' && !i.template) i.template = '*'; });   // 사용자 요청(2026-11-09): 서두 앞에 *
    if (!(d.schema >= 7) && !out.items.some(i => i.kind === 'lead')) out.items.unshift(leadItem());   // 사용자 요청(2026-11-09): 맨 위 '서두'
    if (!(d.schema >= 6) && !out.items.some(i => i.label === '만성질환')) {   // 사용자 요청(2026-11-09): 건강 상태 맨 앞에 '만성질환' → *주질환
      const k = out.items.findIndex(i => i.group === '건강 상태'); out.items.splice(k >= 0 ? k : out.items.length, 0, diseaseItem());
    }
    if (!(d.schema >= 5) && !out.items.some(i => i.fields.some(f => f.norm))) {   // 사용자 요청(2026-11-09): 측정에 '악력' 추가 (Vital 다음)
      const k = out.items.findIndex(i => i.label === 'Vital'); out.items.splice(k >= 0 ? k + 1 : 0, 0, gripItem());
    }
    if (!(d.schema >= 4) && !out.items.some(i => i.label === '투약 중단')) {   // 사용자 요청(2026-11-09): 복약 다음에 '투약 중단' 추가
      const k = out.items.findIndex(i => i.label === '복약'); out.items.splice(k >= 0 ? k + 1 : out.items.length, 0, stopItem());
    }
    if (!(d.schema >= 9) && !out.items.some(isSupp)) {   // 사용자 요청(2026-11-09): 처방약 아래 '영양제'
      const k = out.items.findIndex(i => i.kind === 'drugs'); out.items.splice(k >= 0 ? k + 1 : out.items.length, 0, suppItem());
    }
    if (!(d.schema >= 8) && !out.items.some(i => i.label === '당화혈색소')) {   // 사용자 요청(2026-11-09): Vital 다음에 당화혈색소
      const k = out.items.findIndex(i => i.label === 'Vital'); out.items.splice(k >= 0 ? k + 1 : out.items.length, 0, a1cItem());
    }
    if (!(d.schema >= 11) && !out.items.some(i => i.kind === 'acute')) {   // 사용자 요청(2026-11-09): 만성질환 다음 '급성질환'
      const k = out.items.findIndex(i => i.label === '만성질환'); out.items.splice(k >= 0 ? k + 1 : out.items.length, 0, acuteItem());
    }
    if (!(d.schema >= 12) && !out.items.some(i => i.fields.some(f => f.calc === 'bmi'))) {   // 사용자 요청(2026-11-10): '체중' → '신체계측'(키·몸무게·BMI)
      const k = out.items.findIndex(i => i.kind === 'num' && i.label === '체중');
      if (k >= 0) out.items.splice(k, 1, bodyItem());
      else { const g = out.items.map(i => i.group).lastIndexOf('측정'); out.items.splice(g >= 0 ? g + 1 : out.items.length, 0, bodyItem()); }
    }
    if (!(d.schema >= 13)) out.items = regroup(out.items, !!d.defaultsPending);
    if (!(d.schema >= 16) && !out.items.some(i => i.label === 'CIST 치매검사')) {   // 건강검진 다음(없으면 건강상담 묶음 끝)
      const g = out.items.findIndex(i => i.label === '건강검진'); const at = g >= 0 ? g + 1 : (out.items.map(i => i.group).lastIndexOf('건강상담') + 1 || out.items.length); out.items.splice(at, 0, cistItem()); }
    if (!(d.schema >= 15)) [minicogItem, balanceItem].forEach(mk => { const it = mk(); if (out.items.some(i => i.label === it.label)) return;   // 악력 다음(없으면 신체사정 묶음 끝)에
      const g = out.items.findIndex(i => i.label === '악력'); const at = g >= 0 ? g + 1 : out.items.map(i => i.group).lastIndexOf('신체계측 및 신체사정') + 1 || out.items.length; out.items.splice(at, 0, it); });
    if (!(d.schema >= 14)) out.items.forEach(i => { if (NOTE_ITEMS.includes(i.label) && ['many', 'acute', 'num'].includes(i.kind)) i.notes = true; });   // 사용자 요청(2026-11-10): 상담기록 순서대로 묶음 재배치
    return out;
  }
  // 예전 틀 → 새 묶음 순서. 같은 이름 항목은 사용자가 고친 보기 문장·정상 범위를 이어받고, 직접 추가한 항목은 알맞은 묶음 끝에 붙임
  function regroup(old, untouched) {
    const nb = defaults().items; if (untouched) return nb;
    const RENAME = { '운동': '신체활동', '최근 낙상': '낙상' };
    const GMAP = { '서두': '상담목적', '측정': 'Vital', '건강 상태': '건강상담', '생활 습관': '생활습관', '교육·안내': '건강상담', '마무리': '기타사항' };
    const KNOWN = ['서두', 'Vital', '당화혈색소', '악력', '체중', '신체계측', '만성질환', '급성질환', '전반적 컨디션', '통증', '수면', '식사', '배변', '기분·정서', '최근 낙상', '복약', '투약 중단', '처방약', '영양제', '운동', '흡연', '음주', '교육 내용', '마무리'];
    old.forEach(o => {
      const lab = RENAME[o.label] || o.label, n = nb.find(i => i.label === lab && i.kind === o.kind && (o.kind !== 'drugs' || !!o.src === !!i.src));
      if (n) {
        if (o.label === lab && ['one', 'many', 'lead', 'acute'].includes(o.kind)) n.options = o.options.map(x => { const d = n.options.find(y => y.label === x.label); return { label: x.label, text: x.text || (d ? d.text : '') }; });
        if (o.kind === 'num') o.fields.forEach(f => { const nf = n.fields.find(x => x.label === f.label); if (nf && f.range && !f.norm && !f.calc) { nf.range = f.range; if (f.rangeBy) { nf.rangeBy = f.rangeBy; nf.ranges = f.ranges; } } });
      } else if (!KNOWN.includes(o.label)) {
        const g = GMAP[o.group] || (nb.some(i => i.group === o.group) ? o.group : '기타사항'); const at = nb.map(i => i.group).lastIndexOf(g);
        nb.splice(at >= 0 ? at + 1 : nb.length, 0, Object.assign({}, o, { group: g, template: o.template.replace(/^\*[^\n{]*\n/, '') }));
      }
    });
    return nb;
  }

  const N = { tpl: null, view: 'write', pick: {}, lead: {}, referralQuick: {}, extra: '', edited: false, synced: false, editing: null };
  let savedTemplate = null;
  const box = () => $('#tab-note');

  function localLoad() { try { const d = JSON.parse(localStorage.getItem(LS) || 'null'); return d ? clean(d) : null; } catch (e) { return null; } }
  function localSave() { try { localStorage.setItem(LS, JSON.stringify(N.tpl)); } catch (e) {} }
  async function syncDrive() {   // 드라이브가 연결되어 있으면 최근 것 기준으로 맞춤
    if (!window.SERVER || !SERVER.hasDrive || !SERVER.hasDrive()) { N.synced = false; return; }
    try {
      const r = await SERVER.notesLoad(); const remote = r.data ? clean(r.data) : null;
      if (remote && (!N.tpl.updatedAt || (remote.updatedAt && remote.updatedAt > N.tpl.updatedAt))) { N.tpl = remote; localSave(); }
      else await SERVER.notesSave(N.tpl);
      N.synced = true;
    } catch (e) { N.synced = false; }
  }
  async function saveTpl(msg) {
    if (savedTemplate) { toast('저장 메모의 질문 틀은 보존합니다. 다음 대상자로 전환한 뒤 편집하세요.'); return; }
    N.tpl.updatedAt = new Date().toISOString(); localSave();
    if (window.SERVER && SERVER.hasDrive && SERVER.hasDrive()) { try { await SERVER.notesSave(N.tpl); N.synced = true; } catch (e) { N.synced = false; toast('이 기기에는 저장했지만 드라이브 저장은 실패했습니다: ' + (e.message || e), 5000); } }
    if (msg) toast(msg);
  }

  async function open() {
    if (!N.tpl) { N.tpl = localLoad() || defaults(); render(); }
    if (!N.synced) await syncDrive();   // 로그인 전에 열었던 경우 등
    render();
  }

  /* ---------- 문장 만들기 ---------- */
  function sentenceOf(it) {
    const p = N.pick[it.id];
    if (it.kind === 'drugs') { const a = (p || []).filter(x => x.name.trim()); if (!a.length) return ''; const list = a.map(x => x.name.trim() + (x.note.trim() ? '(' + x.note.trim() + ')' : '')).join(', '); return (it.template || '{목록}').includes('{목록}') ? it.template.replace('{목록}', list) : list; }
    if (it.kind === 'lead') { const t = String(N.lead[it.id] || '').trim(), o = p != null ? it.options[p] : null; const body = [t, o ? o.text.trim() : ''].filter(Boolean).join(' '); return body ? (it.template || '') + body : ''; }
    if (it.kind === 'text') { const t = String(N.lead[it.id] || '').trim(); if (!t) return ''; return (it.template || '{입력}').includes('{입력}') ? it.template.replace('{입력}', t) : it.template + ' ' + t; }
    if (it.kind === 'one') { if (p == null) return ''; const o = it.options[p]; return o ? o.text.trim() : ''; }
    if (it.kind === 'acute') { if (acuteHost()) return ''; const a = acuteList(it); return a.length ? (it.template.includes('{선택}') ? it.template.replace('{선택}', a.join(', ')) : a.join(', ')) : ''; }
    if (it.kind === 'many') {
      const sel = (p || []).map(k => it.options[k]).filter(Boolean);
      const extra = acuteHost() === it ? N.tpl.items.filter(i => i.kind === 'acute').flatMap(acuteList) : [];
      if (!sel.length && !extra.length) return '';
      if (it.template.includes('{선택}')) {
        const sentences = [], labels = [];
        const flush = () => { if (labels.length) { sentences.push(it.template.replace('{선택}', labels.join(', ')).trim()); labels.length = 0; } };
        (p || []).filter(k => it.options[k]).forEach(k => {
          const o = it.options[k], text = (o.text || '').trim(), m = noteOf(it, k);
          // 보기별 문장을 적었다면 문장 틀보다 우선하며, 틀의 접미사를 덧붙이지 않음.
          if (text) { flush(); sentences.push(text + (m ? `(${m})` : '')); }
          else labels.push(o.label + (m ? `(${m})` : ''));
        });
        labels.push(...extra); flush();
        return sentences.filter(Boolean).join(N.tpl.joiner);
      }
      return sel.map(o => (o.text || o.label).trim()).filter(Boolean).join(N.tpl.joiner);
    }
    return numText(it, p || []);
  }
  // 자동 계산 칸 (BMI = 몸무게kg ÷ 키m²). 같은 항목의 '키'·'몸무게' 칸을 씀
  function calcOf(it, k, v) {
    const f = it.fields[k]; if (!f || !f.calc) return null;
    if (f.calc === 'minicog') {
      const wi = it.fields.findIndex(x => !x.calc && /단어|회상/.test(x.label)), ci = it.fields.findIndex(x => !x.calc && /시계/.test(x.label));
      const ws = String(v[wi] || '').trim(), cs = String(v[ci] || '').trim(), w = +ws, c = +cs;
      if (ws === '' || cs === '' || !(w >= 0 && w <= 3 && Number.isInteger(w)) || !(c === 0 || c === 2)) return '';
      return String(w + c);
    }
    if (f.calc !== 'bmi') return null;
    const hi = it.fields.findIndex(x => !x.calc && x.type !== 'pick' && /키|신장/.test(x.label)), wi = it.fields.findIndex(x => !x.calc && x.type !== 'pick' && /몸무게|체중/.test(x.label));
    const h = +String(v[hi] || '').trim(), w = +String(v[wi] || '').trim();
    if (!(h >= 80 && h <= 230 && w >= 15 && w <= 250)) return '';
    return (w / Math.pow(h / 100, 2)).toFixed(1);
  }
  const valOf = (it, k, v) => { const c = calcOf(it, k, v); return c != null ? c : String(v[k] || '').trim(); };
  function bmiFlag(x) {
    if (x < 18.5) return { cls: 'low', text: '저체중', arrow: '↓' };
    if (x < 23) return { cls: 'ok', text: '정상', arrow: '' };
    if (x < 25) return { cls: 'warn', text: '비만 전단계', arrow: '↑' };
    return { cls: 'high', text: x < 30 ? '1단계 비만' : x < 35 ? '2단계 비만' : '3단계 비만', arrow: '↑' };
  }
  const MINICOG_TITLE = 'Mini-Cog 총점 = 3단어 회상(0~3) + 시계그리기(정상 2, 비정상 0). 0~2점이면 인지저하 의심(선별용, 진단 아님) → 치매안심센터 연계 검토';
  const calcTitle = f => f.calc === 'minicog' ? MINICOG_TITLE : BMI_TITLE;
  const BMI_TITLE = 'BMI = 몸무게(kg) ÷ 키(m)². 대한비만학회 2022: 18.5 미만 저체중, 18.5~22.9 정상, 23~24.9 비만 전단계, 25 이상 비만';
  // 정상 범위 판정: 최소 미만 → 낮음, 최대 초과 → (주의 상한 이하면) 주의 / 높음
  function rangeOf(it, k, v) {
    const f = it.fields[k]; if (!f || f.type === 'pick') return null;
    let r = f.range;
    if (f.rangeBy && f.ranges) { const sel = String(v[f.rangeBy - 1] || ''); if (sel && f.ranges[sel]) r = f.ranges[sel]; }
    return r && (r.min !== '' || r.max !== '') ? r : null;
  }
  // 악력: 같은 항목의 '성별'(고르기)·'나이' 칸으로 또래 기준을 찾음
  function gripCtx(it, v) {
    const si = it.fields.findIndex(f => f.type === 'pick' && /성별/.test(f.label)), ai = it.fields.findIndex(f => f.type !== 'pick' && /나이/.test(f.label));
    const sex = si >= 0 ? String(v[si] || '') : '', age = ai >= 0 ? +String(v[ai] || '').trim() : NaN;
    return { sex: GRIP[sex] ? sex : '', age: isNaN(age) ? null : age };
  }
  function gripRow(it, f, v) {
    const c = gripCtx(it, v); if (!c.sex || c.age == null || c.age < 60) return null;
    const rows = GRIP[c.sex][f.norm === 'gripL' ? 'L' : 'R']; let r = rows[0]; rows.forEach(x => { if (c.age >= x[0]) r = x; });
    return { group: r[0] === 80 ? '80세 이상' : r[0] + '~' + (r[0] + 4) + '세', mean: r[1], low: r[2], sex: c.sex };
  }
  function gripFlag(it, k, v) {
    const f = it.fields[k], x = +String(v[k] || '').trim(); const g = gripRow(it, f, v); if (!g || isNaN(x)) return null;
    if (x < g.low) return { cls: 'low', text: '또래 하위 20%', arrow: '↓' };
    return x >= g.mean ? { cls: 'ok', text: '또래 평균 이상', arrow: '' } : { cls: 'ok', text: '또래 보통', arrow: '' };
  }
  function gripTitle(it, k, v) { const g = gripRow(it, it.fields[k], v); return g ? `${g.sex} ${g.group} ${it.fields[k].label} 평균 ${g.mean}kg, 하위 20% ${g.low}kg 미만 (국민건강영양조사 2014–15)` : '성별과 나이(60세 이상)를 넣으면 또래 기준으로 판정합니다'; }
  function gripSummary(it, v) {   // 근력 저하 (AWGS 2019): 양손 중 큰 값
    const c = gripCtx(it, v); if (!c.sex) return null;
    const vals = it.fields.map((f, k) => f.norm ? +String(v[k] || '').trim() : NaN).filter(x => !isNaN(x) && x > 0); if (!vals.length) return null;
    const m = Math.max(...vals), cut = GRIP[c.sex].cut;
    return m < cut ? { cls: 'high', text: `근력 저하 (최댓값 ${m}kg < ${cut}kg)` } : { cls: 'ok', text: `근력 저하 기준 아님 (최댓값 ${m}kg ≥ ${cut}kg)` };
  }
  function flagOf(it, k, v) {
    if (it.fields[k] && it.fields[k].norm) return gripFlag(it, k, v);
    if (it.fields[k] && it.fields[k].calc === 'bmi') { const c = calcOf(it, k, v); return c ? bmiFlag(+c) : null; }
    if (it.fields[k] && it.fields[k].calc === 'minicog') { const c = calcOf(it, k, v); return c === '' || c == null ? null : (+c <= 2 ? { cls: 'high', text: '인지저하 의심', arrow: '' } : { cls: 'ok', text: '음성', arrow: '' }); }
    const raw = String(v[k] || '').trim(); if (raw === '') return null; const x = +raw; const r = rangeOf(it, k, v); if (!r || isNaN(x)) return null;
    if (r.min !== '' && x < +r.min) return { cls: 'low', text: '낮음', arrow: '↓' };
    if (r.max !== '' && x > +r.max) return r.warn !== '' && x <= +r.warn ? { cls: 'warn', text: '주의', arrow: '↑' } : { cls: 'high', text: '높음', arrow: '↑' };
    return { cls: 'ok', text: '정상', arrow: '' };
  }
  function rangeText(r) { if (!r) return ''; const a = r.min !== '' ? r.min : '', b = r.max !== '' ? r.max : ''; return '정상 ' + (a && b ? a + '~' + b : a ? a + ' 이상' : b + ' 이하') + (r.warn !== '' ? ', 주의 ~' + r.warn : ''); }
  // 문장 틀: 줄(\n)과 ', ' 로 나눈 조각마다, 숫자 칸이 비어 있으면 그 조각을 뺌. 고르기 칸이 비면 '(…)'만 뺌
  function numText(it, v) {
    const val = k => valOf(it, k, v);
    const isPick = k => it.fields[k] && it.fields[k].type === 'pick';
    const fill = seg => seg.replace(/\(\{(\d)\}\)/g, (m, n) => { const k = +n - 1; return isPick(k) && !val(k) ? '' : m; })
      .replace(/\{(\d)\}/g, (m, n) => { const k = +n - 1; let t = val(k); if (t && N.tpl.flagInMemo && !isPick(k)) { const f = flagOf(it, k, v); if (f && f.arrow) t += f.arrow; } if (t && isPick(k)) { const nt = noteOf(it, 'f' + k); if (nt) t += `(${nt})`; } return t; });
    const lines = it.template.split('\n'); let any = false;
    const out = lines.map(line => {
      if (!/\{\d\}/.test(line)) return { head: true, text: line };
      const mark = (/^\s*[-*•·]\s*/.exec(line) || [''])[0]; const body = line.slice(mark.length);
      // ', ' 또는 ' / ' 로 나눈 조각마다 판단, 남은 조각은 원래 구분자로 다시 이음
      const tok = body.split(/(, | \/ )/), keep = (seg => { const need = [...seg.matchAll(/\{(\d)\}/g)].map(m => +m[1] - 1).filter(k => !isPick(k)); return need.length ? need.every(k => val(k)) : [...seg.matchAll(/\{(\d)\}/g)].some(m => val(+m[1] - 1)); });
      let txt = '', n = 0;
      for (let i = 0; i < tok.length; i += 2) { if (!keep(tok[i])) continue; txt += (n ? (tok[i - 1] || ', ') : '') + fill(tok[i]); n++; }
      // 첫 조각만 빠졌는데 뒤 조각들에 이름이 없으면 첫 조각의 이름은 남김 (예: '평형성: {2}, {1}초' → '평형성: 12초')
      if (n && !keep(tok[0])) { const pm = /^([^{]*?:\s*)\{/.exec(tok[0]); if (pm && tok.filter((x, i) => i % 2 === 0 && i > 0).every(x => !/:/.test(x))) txt = pm[1] + txt; }
      if (!n) return null; any = true; return { text: mark + txt };
    }).filter(Boolean);
    return any ? out.map(o => o.text).join('\n').trim() : '';
  }
  // 급성질환은 '*주질환'(만성질환) 줄에 붙음
  function acuteHost() { return N.tpl.items.find(i => i.kind === 'many' && (i.label === '만성질환' || /주질환/.test(i.template)) && i.template.includes('{선택}')) || null; }
  // 보기마다 적은 메모 (저장 안 함, '다음 대상자'면 지워짐). 열쇠: 항목id#보기번호, 숫자 항목의 고르기 칸은 항목id#f칸번호
  const noteOf = (it, key) => it.notes ? String(N.lead[it.id + '#' + key] || '').trim() : '';
  function acuteList(it) { const st = N.pick[it.id] || {}; return it.options.map((o, k) => { if (!st[k]) return ''; const m = noteOf(it, k); return `${o.label}(${st[k]}${m ? ', ' + m : ''})`; }).filter(Boolean); }
  // 묶음마다 '*묶음이름' 머리줄 + 그 아래 '-문장' 줄. 묶음 사이는 빈 줄. 상담목적은 머리줄 없이(서두가 *로 시작)
  function compose() {
    const gs = groups(), extraG = gs.includes('기타사항') ? '기타사항' : gs[gs.length - 1];
    const blocks = gs.map(g => {
      const lines = [];
      N.tpl.items.filter(i => i.group === g).forEach(it => {
        const t = sentenceOf(it); if (!t) return;
        const ls = t.split('\n').map(x => x.trim()).filter(Boolean);
        const loose = (it.kind === 'one' || it.kind === 'many') && ls.length === 1 && !/^[-*•·]/.test(ls[0]);
        if (!N.tpl.dash && loose && lines.length && lines[lines.length - 1].loose && N.tpl.joiner === ' ') { lines[lines.length - 1].t += ' ' + ls[0]; return; }   // '-' 없이 이어 쓰기
        ls.forEach(l => lines.push({ t: N.tpl.dash && !/^[-*•·]/.test(l) && !(it.kind === 'lead') ? '-' + l : l, loose }));
      });
      if (g === extraG && N.extra.trim()) N.extra.trim().split('\n').map(x => x.trim()).filter(Boolean).forEach(l => lines.push({ t: N.tpl.dash && !/^[-*•·]/.test(l) ? '-' + l : l }));
      if (!lines.length) return '';
      const head = NO_HEAD.includes(g) || lines[0].t.startsWith('*') ? '' : '*' + g;
      return (head ? head + '\n' : '') + lines.map(x => x.t).join('\n');
    });
    return blocks.filter(Boolean).join('\n\n');
  }
  function paintFlags() {
    $$('#tab-note [data-flag]').forEach(el => {
      const [id, k] = el.dataset.flag.split(':'); const it = N.tpl.items.find(i => i.id === id); if (!it) return;
      const v = N.pick[id] || [], f = flagOf(it, +k, v), r = rangeOf(it, +k, v);
      const ttl = it.fields[+k].norm ? gripTitle(it, +k, v) : it.fields[+k].calc ? calcTitle(it.fields[+k]) : rangeText(r);
      if (it.fields[+k].calc) { const out = el.parentElement.querySelector('[data-calc]'); if (out) out.value = calcOf(it, +k, v) || ''; }
      el.className = 'nt-flag' + (f ? ' ' + f.cls : ''); el.textContent = f ? f.text : ''; el.title = ttl;
      const inp = el.parentElement.querySelector('input'); if (inp) inp.title = ttl;
    });
    $$('#tab-note [data-gsum]').forEach(el => {
      const it = N.tpl.items.find(i => i.id === el.dataset.gsum); if (!it) return; const v = N.pick[it.id] || [];
      const sm = gripSummary(it, v), c = gripCtx(it, v), hasVal = it.fields.some((f, k) => f.norm && String(v[k] || '').trim());
      el.className = 'nt-flag' + (sm ? ' ' + sm.cls : '');
      el.textContent = sm ? sm.text : hasVal && (!c.sex || c.age == null) ? '성별·나이를 넣으면 판정합니다' : '';
      if (!sm && el.textContent) el.className = 'nt-flag warn';
    });
  }
  // 직접 고친 메모 + 버튼으로 바뀐 부분 합치기: 예전 자동 문장(g0) → 새 자동 문장(g1)에서 바뀐 곳만 찾아, 사용자가 고친 글(u)에 같은 자리로 반영
  // 새 줄(새 묶음 포함)만 생긴 경우: 사용자 글에서 바로 앞 줄(없으면 바로 뒤 줄)을 찾아 그 옆에 줄 단위로 넣음
  // 내용 줄이 하나도 남지 않은 묶음 머리줄(*서비스제공 등)은 지움
  function dropEmptyHeads(U) {
    const heads = new Set(groups().map(g => '*' + g));
    return U.filter((x, k) => !heads.has(x.trim()) || (k + 1 < U.length && U[k + 1].trim() !== '' && !U[k + 1].trim().startsWith('*')));
  }
  function mergeLines(g0, u, g1) {
    const a = g0.split('\n'), b = g1.split('\n'); let p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let q = 0; while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
    const gone = a.slice(p, a.length - q), add = b.slice(p, b.length - q);
    const G = gone.filter(x => x.trim()), A = add.filter(x => x.trim());
    if (G.length) {   // 줄이 바뀌거나 빠진 경우: 사용자 글에서 같은 줄을 찾아 줄째로 바꾸거나 지움 (한글 입력 중 글자 깨짐 방지)
      const U = u.split('\n'), at = G.map(x => U.indexOf(x)); if (at.some(k => k < 0)) return null;
      if (A.length === G.length) { at.forEach((k, n) => { U[k] = A[n]; }); return U.join('\n'); }
      if (!A.length) { at.sort((x, y) => y - x).forEach(k => U.splice(k, 1)); return dropEmptyHeads(U).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, ''); }
      return null;
    }
    if (!A.length) return null;
    const core = add.slice(add.findIndex(x => x.trim())); while (!core[core.length - 1].trim()) core.pop();
    const prev = b.slice(0, p).filter(x => x.trim()).pop(), next = b.slice(b.length - q).find(x => x.trim());
    const U = u.split('\n'), newSec = core[0].startsWith('*');
    let i = prev != null ? U.lastIndexOf(prev) : -1, ins;
    if (i >= 0) { let j = i + 1; if (newSec) while (j < U.length && U[j].trim() && !U[j].startsWith('*')) j++;   // 새 묶음이면 앞 묶음 끝까지 지나서
      ins = j; }
    else { const k = next != null ? U.indexOf(next) : -1; ins = k >= 0 ? k : U.length; }
    const blk = (newSec && ins > 0 && U[ins - 1].trim() ? [''] : []).concat(core, newSec && ins < U.length && U[ins].trim() ? [''] : []);
    U.splice(ins, 0, ...blk);
    return U.join('\n').replace(/\n{3,}/g, '\n\n');
  }
  function merge(g0, u, g1) {
    if (u === g0) return g1;
    const ml = mergeLines(g0, u, g1); if (ml != null) return ml;
    let p = 0; const m = Math.min(g0.length, g1.length); while (p < m && g0[p] === g1[p]) p++;
    let q = 0; while (q < m - p && g0[g0.length - 1 - q] === g1[g1.length - 1 - q]) q++;
    const oldMid = g0.slice(p, g0.length - q), newMid = g1.slice(p, g1.length - q);
    const cL = n => g0.slice(Math.max(0, p - n), p), cR = n => g0.slice(g0.length - q, g0.length - q + n);
    const tidy = t => t.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n');
    // 1) 바뀌기 전 글이 사용자 글에 있으면 그 자리 (앞뒤 문맥이 맞는 곳 우선)
    for (const [om, nm] of [[oldMid, newMid], [oldMid.trim(), newMid.trim()]]) {
      if (!om) continue;
      let best = -1, bestScore = -1;
      for (let at = u.indexOf(om); at >= 0; at = u.indexOf(om, at + 1)) {
        const before = u.slice(0, at), after = u.slice(at + om.length);
        const sc = (cL(24) && before.endsWith(cL(24)) ? 2 : cL(8) && before.endsWith(cL(8).trim()) ? 1 : 0) + (cR(24) && after.startsWith(cR(24)) ? 2 : cR(8) && after.startsWith(cR(8).trim()) ? 1 : 0);
        if (sc > bestScore) { bestScore = sc; best = at; }
      }
      if (best >= 0 && (bestScore > 0 || om.trim().length >= 6)) return tidy(u.slice(0, best) + nm + u.slice(best + om.length));
    }
    // 2) 앞뒤 문맥으로 자리를 찾음
    for (const n of [24, 8]) {
      const L = cL(n).trim() ? cL(n) : '', R = cR(n).trim() ? cR(n) : '';
      const li = L ? u.lastIndexOf(L) : -1, ri = R ? u.indexOf(R, li >= 0 ? li + L.length : 0) : -1;
      if (!oldMid) {
        if (li >= 0) return tidy(u.slice(0, li + L.length) + newMid + u.slice(li + L.length));
        if (ri >= 0) return tidy(u.slice(0, ri) + newMid + u.slice(ri));
      } else if (li >= 0 && ri >= 0) return tidy(u.slice(0, li + L.length) + newMid + u.slice(ri));
    }
    return { fail: true, add: newMid };   // 자리를 못 찾음
  }
  // 줄 단위로 비교해 '새 줄만 생긴 경우'면 그 줄들을 돌려줌 (지워지거나 고쳐진 줄이 있으면 null)
  function paintCaret() {
    const el = $('#ntCaret'); if (!el) return;
    if (N.caret) { const ta = $('#ntOut'), v = ta ? ta.value : '', pos = Math.min(N.caret.pos, v.length), ln = v.slice(0, pos).split('\n').length;
      el.innerHTML = `<b>커서 자리에 넣는 중</b> (${ln}번째 줄) — 누르는 항목이 이 자리에 들어갑니다. <button type="button" class="link" id="ntCaretOff">원래 순서로</button>`; el.classList.add('on'); }
    else { el.textContent = '메모 안을 눌러 커서를 두면, 그다음 누르는 항목은 그 자리에 들어갑니다.'; el.classList.remove('on'); }
  }
  // 같은 묶음 머리줄(*서비스제공 등)이 두 번 생기면 하나로 합침: 뒤쪽 묶음의 줄들을 앞쪽 묶음 끝으로 옮김 (사용자 요청 2026-11-10)
  function dedupeHeads(t) {
    const heads = new Set(groups().filter(g => !NO_HEAD.includes(g)).map(g => '*' + g));
    const L = t.split('\n'); let again = true;
    const end = k => { let j = k + 1; while (j < L.length && L[j].trim() && !L[j].trim().startsWith('*')) j++; return j; };
    while (again) {
      again = false; const seen = {};
      for (let i = 0; i < L.length; i++) {
        const h = L[i].trim(); if (!heads.has(h)) continue;
        if (seen[h] == null) { seen[h] = i; continue; }
        const j = end(i), body = L.slice(i + 1, j); L.splice(i, j - i);
        L.splice(end(seen[h]), 0, ...body); again = true; break;
      }
    }
    return L.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
  }
  function addedLines(g0, g1) {
    const a = g0.split('\n'), b = g1.split('\n'); let p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let q = 0; while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
    const gone = a.slice(p, a.length - q), add = b.slice(p, b.length - q);
    if (gone.some(x => x.trim()) || !add.some(x => x.trim())) return null;
    return add.filter(x => x.trim()).join('\n');
  }
  function refreshOut() {
    paintFlags();
    const ta = $('#ntOut'); if (!ta) return;
    const g1 = compose(), before = ta.value;
    if (N.caret && N.caret.val !== ta.value) N.caret = null;   // 커서를 둔 뒤 메모가 다른 식으로 바뀌었으면 자리 기억을 버림
    const c = N.caret;
    // 메모 안에 커서를 둔 뒤 항목을 누르면, 새로 생긴 줄은 그 커서 자리에 넣음 (사용자 요청 2026-11-10)
    const ins = c && c.val === ta.value && N.gen != null && g1 !== N.gen ? addedLines(N.gen, g1) : null;
    if (ins) {
      let at = Math.min(c.pos, ta.value.length);
      if (at > 0 && ta.value[at - 1] !== '\n') { const e = ta.value.indexOf('\n', at); at = e < 0 ? ta.value.length : e; }   // 줄 중간이면 그 줄 끝으로
      { const ls = ta.value.slice(0, at).split('\n'), cur = (ls[ls.length - 1] || '') + (ta.value.slice(at).split('\n')[0] || '');
        if (cur.trim().startsWith('*') && !ins.trim().startsWith('*')) { let e = ta.value.indexOf('\n', at); while (e >= 0) { const nx = ta.value.indexOf('\n', e + 1), line = ta.value.slice(e + 1, nx < 0 ? undefined : nx); if (!line.trim() || line.trim().startsWith('*')) break; e = nx; } at = e < 0 ? ta.value.length : e; } }   // 머리줄 위면 그 묶음 끝으로
      const b = ta.value.slice(0, at), a = ta.value.slice(at); let t = ins, tail = 0;
      if (b && !b.endsWith('\n')) t = '\n' + t;
      if (a && !a.startsWith('\n')) { t += '\n'; tail = 1; }
      ta.value = b + t + a; c.pos = at + t.length - tail; c.moved = true;
      N.edited = ta.value !== g1;
    } else if (!N.edited || N.gen == null) ta.value = g1;
    else if (g1 !== N.gen) {
      const m = merge(N.gen, ta.value, g1);
      if (m && m.fail) {
        if (m.add.trim()) { ta.value = ta.value.replace(/\s*$/, '') + '\n' + m.add.trim(); toast('직접 고친 부분과 겹쳐서 새 내용을 맨 아래에 붙였습니다.', 5000); }
        else toast('직접 고친 부분이라 그 문장은 자동으로 지우지 못했습니다. 메모에서 직접 지워 주세요.', 5000);
      } else ta.value = m;
      if (ta.value === g1) N.edited = false;
    }
    const dd = dedupeHeads(ta.value), merged = dd !== ta.value; if (merged) { ta.value = dd; if (ta.value === g1) N.edited = false; }
    if (c && (!ins || merged)) { let i = 0; while (i < before.length && before[i] === ta.value[i]) i++; if (i < c.pos) c.pos = Math.max(i, c.pos + ta.value.length - before.length); c.pos = Math.min(c.pos, ta.value.length); }
    if (c) c.val = ta.value;
    paintCaret();
    N.gen = g1; N.out = ta.value;
    $('#ntCount').textContent = ta.value.length + '자';
  }

  /* ---------- 처방약 검색 ---------- */
  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const chosung = t => [...String(t)].map(c => { const x = c.charCodeAt(0) - 0xac00; return x >= 0 && x < 11172 ? CHO[Math.floor(x / 588)] : c; }).join('');
  const norm = t => String(t || '').toLowerCase().replace(/[\s·\-]/g, '');
  const itemOf = id => N.tpl.items.find(i => i.id === id);
  const myList = it => isSupp(it) ? (N.tpl.supps = N.tpl.supps || []) : (N.tpl.drugs = N.tpl.drugs || []);
  const baseList = it => isSupp(it) ? (window.VHM_SUPPS || []) : (window.VHM_DRUGS || []);
  function drugPool(it) {
    const out = [], seen = new Set(), add = (name, ing, note, tag) => { const k = norm(name); if (!k || seen.has(k)) return; seen.add(k); out.push({ name, ing, note, tag }); };
    myList(it).forEach(d => add(d.name, '', d.note, '내 목록'));
    baseList(it).forEach(([n, i, note]) => add(n, i, note, ''));
    if (!isSupp(it)) (window.VHM_DRUG_INGS || []).forEach(([i, note]) => add(i, i, note, '성분명'));
    return out;
  }
  function searchDrugs(q, it) {
    const nq = norm(q); if (!nq) return [];
    const cho = /[ㄱ-ㅎ]/.test(nq) && !/[가-힣]/.test(nq);   // 초성 검색 (숫자·영문 섞여도 됨: ㅇㅁㄱ3)
    const hit = d => cho ? chosung(norm(d.name)).includes(nq) : (norm(d.name).includes(nq) || norm(d.ing).includes(nq) || norm(d.note).includes(nq));
    const pool = drugPool(it).filter(hit);
    pool.sort((a, b) => (norm(b.name).startsWith(nq) - norm(a.name).startsWith(nq)) || ((b.tag === '내 목록') - (a.tag === '내 목록')) || a.name.localeCompare(b.name, 'ko'));
    return pool.slice(0, 8);
  }
  let dRes = [], saveT = null;
  function showDrugList(id, q) {
    const box = $(`[data-dlist="${id}"]`); if (!box) return;
    const it = itemOf(id); dRes = searchDrugs(q, it); const raw = q.trim();
    if (!raw) { box.hidden = true; return; }
    box.innerHTML = dRes.map((d, k) => `<button type="button" class="nt-dopt${k === 0 ? ' first' : ''}" data-dadd="${id}" data-k="${k}"><b>${esc(d.name)}</b><span class="hint">${esc([d.tag, !isSupp(it) && d.ing && d.ing !== d.name ? d.ing : '', d.note].filter(Boolean).join(' · '))}</span></button>`).join('')
      + `<button type="button" class="nt-dopt" data-draw="${id}">‘${esc(raw)}’ 그대로 추가</button>`
      + (isSupp(it) ? '' : `<a class="nt-dopt nt-dlink" href="https://nedrug.mfds.go.kr/searchDrug?itemName=${encodeURIComponent(raw)}" target="_blank" rel="noopener">의약품안전나라에서 ‘${esc(raw)}’ 찾아보기 ↗</a>`);
    box.hidden = false;
  }
  function rememberDrug(d, it) {   // 기본 목록에 없거나 메모를 바꾼 약·영양제는 '내 목록'에 (이름·메모만, 대상자 정보 없음)
    const name = d.name.trim(), note = d.note.trim(); if (!name) return;
    const base = baseList(it).find(x => x[0] === name);
    const list = myList(it); const k = list.findIndex(x => x.name === name);
    if (base && base[2] === note) { if (k >= 0) { list.splice(k, 1); queueSave(); } return; }
    if (k >= 0) { if (list[k].note === note) return; list[k].note = note; } else list.unshift({ name, note });
    queueSave();
  }
  function queueSave() { clearTimeout(saveT); saveT = setTimeout(() => saveTpl(), 800); }
  function addDrug(id, d) {
    const a = (N.pick[id] || []).slice(); if (!a.some(x => x.name === d.name)) a.push({ name: d.name, note: d.note || '' }); N.pick[id] = a;
    rememberDrug(a[a.length - 1], itemOf(id)); render(); const inp = $(`[data-dq="${id}"]`); if (inp) inp.focus();
  }

  /* ---------- 화면 ---------- */
  function groups() { const g = []; N.tpl.items.forEach(i => { if (!g.includes(i.group)) g.push(i.group); }); return g; }
  function render() {
    if (!N.tpl) return;
    let h = '<div class="lk-bar row"><div class="seg" role="tablist">'
      + [['write', '메모 쓰기'], ['edit', '항목 편집']].map(t => `<button data-ntview="${t[0]}" aria-pressed="${N.view === t[0]}">${t[1]}</button>`).join('') + '</div>'
      + `<span class="nt-forms"><a class="nt-form" href="forms/survey-all-p1-4.pdf" download="방문건강관리_설문지_전체_1-4쪽.pdf" title="간이 설문지(1·2쪽) + 기초조사표(3·4쪽) — A4 양면 2장, 4쪽">📄 전체 내려받기 (1~4쪽)</a><a class="nt-form" href="forms/simple-survey-p12.pdf" download="방문건강관리_간이설문지_1-2쪽.pdf" title="방문 상담용 빈 설문지 — A4 양면 1장(1·2쪽): 기본정보·Vital·주질환·복약·신체계측/신체사정·건강상담·생활습관·서비스제공·PHQ-9">📄 간이 설문지 내려받기 (1·2쪽)</a><a class="nt-form" href="forms/base-survey-p34.pdf" download="방문건강관리_기초조사표_3-4쪽.pdf" title="기초조사표 — A4 양면 1장(3·4쪽): 허약노인 기초측정표, 재가암·재가장애인(간이) 기초조사표, 변형 바델 지수">📄 기초조사표 내려받기 (3·4쪽)</a><a class="nt-form" href="forms/sgds-k-short-form.pdf" download="SGDS-K 단축형 노인우울척도 검사.pdf" title="단축형 노인우울척도 검사(SGDS-K) — 첨부 원본 PDF, 1쪽">📄 노인우울척도 내려받기 (SGDS-K)</a></span>`
      + `<span class="hint">${N.synced ? '질문 틀: 구글 드라이브와 이 기기에 저장' : '질문 틀: 이 기기에 저장 (연계 안내 탭에서 드라이브를 연결하면 다른 기기와 같이 씀)'}</span></div>`;
    if (N.tpl.defaultsPending) h += '<div class="warnbox" style="margin-bottom:10px">질문 항목과 문장은 아직 <b>임시 기본값</b>입니다. ‘항목 편집’에서 평소 쓰시는 말투로 고친 뒤 ‘확인 완료’를 눌러 주세요.</div>';
    if (N.view === 'write') h += hiraMedicationHtml() + '<div id="consultationTools"></div><div class="nt-referral-action"><button class="primary" id="ntReferrals">체크 항목으로 연계 보기</button><span class="hint">연계 안내로 이동하면 관련 요구를 자동 체크합니다. 직접 적은 문장·수치·이름은 가져오지 않습니다.</span></div>';
    h += N.view === 'write' ? writeHtml() : editHtml();
    box().innerHTML = h;
    if (N.view === 'write') { refreshOut(); if (N.age && typeof calcAge === 'function') calcAge('ntAge'); }
    if (window.CONSULTATIONS) CONSULTATIONS.mount();
  }
  // 고른 보기마다 메모 칸 (예: 백내장 → 2025년도 op+, 연세솔안과의원)
  function notesHtml(it) {
    const p = N.pick[it.id]; let list = [];
    if (it.kind === 'many') list = (p || []).filter(k => it.options[k]).map(k => [k, it.options[k].label]);
    else if (it.kind === 'acute') list = it.options.map((o, k) => (p || {})[k] ? [k, `${o.label}(${p[k]})`] : null).filter(Boolean);
    else if (it.kind === 'num') list = it.fields.map((f, k) => f.type === 'pick' && (p || [])[k] ? ['f' + k, `${f.label}: ${p[k]}`] : null).filter(Boolean);
    const ph = it.kind === 'num' ? '예: 2025년도 op+, ○○안과' : '예: 2015년 진단, ○○내과 진료 중';
    return list.map(([k, lab]) => `<label class="nt-note"><span>${esc(lab)}</span><input data-lead="${it.id}#${k}" value="${esc(N.lead[it.id + '#' + k] || '')}" placeholder="${esc(ph)}" maxlength="80" autocomplete="off"></label>`).join('');
  }
  function paintNotes(id) { const el = $(`[data-notes="${id}"]`), it = N.tpl.items.find(i => i.id === id); if (el && it) el.innerHTML = notesHtml(it); }
  function hiraMedicationHtml() {
    return `<section class="card nt-hira" aria-labelledby="ntHiraTitle">
      <div class="row" style="flex-wrap:wrap;gap:8px"><b id="ntHiraTitle">내가 먹는 약 한눈에 · 심평원</b><a class="nt-form" id="ntHiraOpen" href="${HIRA_MEDICATION_URL}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">심평원에서 본인인증·조회 ↗</a></div>
      <p class="hint">대상자 본인이 심평원 공식 화면에서 인증하고 복약정보를 확인합니다. 본인확인정보·인증번호는 심평원 화면에서만 입력하며, 이 연결 기능은 조회 결과를 가져오거나 저장하지 않습니다.</p>
      <details id="ntHiraPhone"><summary>대상자 휴대폰으로 열기 · QR/이용 순서</summary>
        <div class="nt-hira-phone"><img src="assets/hira-medication-qr.svg" width="240" height="240" alt="대상자 휴대폰에서 심평원 내가 먹는 약 한눈에 공식 페이지를 여는 QR 코드" loading="lazy">
        <div><ol><li>대상자에게 QR을 보여드리거나 공식 주소를 전달하세요.</li><li>대상자가 본인 휴대폰에서 공식 사이트의 본인인증을 직접 진행합니다. 문자 인증 제공 여부와 절차는 심평원 화면에서 확인하세요.</li><li>대상자가 조회 결과를 보여주면 함께 확인하며 상담하세요. 조회 후에는 심평원에서 로그아웃하고 화면을 종료하세요.</li></ol>
        <p class="hint">공식 주소: <span style="overflow-wrap:anywhere">www.hira.or.kr</span></p><button type="button" id="ntHiraCopy">공식 주소 복사</button><span class="hint" id="ntHiraCopyStatus" role="status"></span>
        <p class="hint">조회 내역과 실제 현재 복용약은 다를 수 있으므로 약봉투·처방전과 대상자의 설명을 함께 확인하세요.</p></div></div>
      </details></section>`;
  }
  function writeHtml() {
    const items = g => N.tpl.items.filter(i => i.group === g).map(it => {
      let ctl = '';
      if (it.kind === 'num') { const v = N.pick[it.id] || [];
        ctl = it.fields.map((f, k) => f.type === 'pick'
          ? `<span class="nt-num">${esc(f.label)} ${String(f.options || '').split(',').map(x => x.trim()).filter(Boolean).map(o => `<button type="button" class="nt-chip sm${v[k] === o ? ' on' : ''}" data-pickf="${it.id}" data-k="${k}" data-v="${esc(o)}" aria-pressed="${v[k] === o}">${esc(o)}</button>`).join('')}</span>`
          : f.calc ? `<label class="nt-num">${esc(f.label)}<input data-calc="${it.id}" data-k="${k}" value="${esc(calcOf(it, k, v) || '')}" readonly tabindex="-1" class="nt-calc" placeholder="자동" title="${esc(calcTitle(f))}"><span>${esc(f.unit)}</span><span class="nt-flag" data-flag="${it.id}:${k}"></span></label>`
          : `<label class="nt-num">${esc(f.label)}<input inputmode="decimal" data-num="${it.id}" data-k="${k}" value="${esc(v[k] || '')}" autocomplete="off" title="${esc(rangeText(rangeOf(it, k, v)))}"><span>${esc(f.unit)}</span><span class="nt-flag" data-flag="${it.id}:${k}"></span></label>`).join('')
          + (it.fields.some(f => f.norm) ? `<span class="nt-flag" data-gsum="${it.id}"></span>` : ''); }
      else if (it.kind === 'text') ctl = `<input class="nt-lead nt-text" data-lead="${it.id}" value="${esc(N.lead[it.id] || '')}" placeholder="${esc(it.ph || '직접 적기')}" maxlength="200" autocomplete="off">`
        + it.options.map(o => { const on = String(N.lead[it.id] || '').split(/,\s*/).includes(o.label); return `<button type="button" class="nt-chip sm${on ? ' on' : ''}" data-tadd="${it.id}" data-v="${esc(o.label)}" aria-pressed="${on}" title="눌러서 넣기·빼기">${esc(o.label)}</button>`; }).join('');
      else if (it.kind === 'lead') ctl = `<input class="nt-lead" data-lead="${it.id}" value="${esc(N.lead[it.id] || '')}" placeholder="예: 신규등록을 위해" maxlength="100" autocomplete="off">`
        + it.options.map((o, k) => `<button type="button" class="nt-chip${N.pick[it.id] === k ? ' on' : ''}" data-it="${it.id}" data-k="${k}" aria-pressed="${N.pick[it.id] === k}">${esc(o.label)}</button>`).join('');
      else if (it.kind === 'drugs') { const a = N.pick[it.id] || [];
        ctl = `<div class="nt-drugs">${a.map((x, k) => `<div class="nt-drug"><input data-dname="${it.id}" data-k="${k}" value="${esc(x.name)}" aria-label="약 이름">(<input data-dnote="${it.id}" data-k="${k}" value="${esc(x.note)}" placeholder="무슨 약" aria-label="무슨 약인지 메모">)<button type="button" class="small" data-ddel="${it.id}" data-k="${k}" title="빼기">✕</button></div>`).join('')}
          <div class="nt-dsearch"><input data-dq="${it.id}" placeholder="${isSupp(it) ? '영양제 이름·기능·초성으로 검색 (예: 루테인, 눈, ㄹㅌㅇ)' : '약 이름·성분·초성으로 검색 (예: 노바스크, 암로디핀, ㄴㅂㅅㅋ)'}" autocomplete="off"><div class="nt-dlist" data-dlist="${it.id}" hidden></div></div>${isSupp(it) ? '' : `<a class="nt-form" href="${HIRA_MEDICATION_URL}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">심평원 복약정보 확인 ↗</a>`}</div>`; }
      else if (it.kind === 'acute') { const st = N.pick[it.id] || {};
        ctl = it.options.map((o, k) => `<button type="button" class="nt-chip${st[k] ? ' on' + (st[k] === '완치' ? ' done' : '') : ''}" data-it="${it.id}" data-k="${k}" aria-pressed="${!!st[k]}">${esc(o.label)}${st[k] ? `<small> · ${st[k]}</small>` : ''}</button>`).join('') + '<span class="hint" style="flex-basis:100%">한 번 누르면 치료중, 두 번 누르면 완치, 세 번 누르면 해제</span>'; }
      else ctl = it.options.map((o, k) => { const on = it.kind === 'one' ? N.pick[it.id] === k : (N.pick[it.id] || []).includes(k);
        return `<button type="button" class="nt-chip${on ? ' on' : ''}" data-it="${it.id}" data-k="${k}" aria-pressed="${on}">${esc(o.label)}</button>`; }).join('');
      return `<div class="nt-row"><div class="nt-label">${esc(it.label)}${it.kind === 'many' ? ' <span class="hint">(여러 개)</span>' : ''}</div><div class="nt-ctl">${ctl}</div>${it.notes ? `<div class="nt-notes" data-notes="${it.id}">${notesHtml(it)}</div>` : ''}</div>`;
    }).join('');
    return `<div class="agecalc nt-age" role="group" aria-label="만 나이 계산기">
        <label for="ntAgeIn"><b>만 나이 계산</b></label>
        <input id="ntAgeIn" inputmode="numeric" maxlength="6" placeholder="생년월일 6자리 (예: 480312)" autocomplete="off" value="${esc(N.age || '')}">
        <span id="ntAgeOut" class="hint">입력한 생년월일은 저장하지 않습니다.</span>
      </div>
      <div class="nt-layout"><div class="card"><div class="card-body">
        ${groups().map(g => `<div class="nt-group"><div class="lk-cat-h">${esc(g)}</div>${items(g)}</div>`).join('')}
        ${N.tpl.items.some(i => i.kind === 'num' && i.fields.some(f => f.range && (f.range.min !== '' || f.range.max !== ''))) ? '<p class="hint" style="margin:4px 0 0">수치 옆 정상·주의·높음·낮음은 참고용입니다. 기본 기준: 대한고혈압학회 2022 진료지침(정상 120/80 미만, 140/90 이상 고혈압), 대한당뇨병학회 진단기준(공복 100~125·식후 2시간 140~199 주의, 70 미만 저혈당, 당화혈색소 5.7~6.4% 주의·6.5% 이상 높음 — 이미 당뇨병 진단을 받은 분의 조절 목표는 개인마다 다름), 성인 맥박 60~100회/분. 기준은 ‘항목 편집’에서 바꿀 수 있습니다.</p>' : ''}
        ${N.tpl.items.some(i => i.fields.some(f => f.calc === 'minicog')) ? '<p class="hint" style="margin:4px 0 0">Mini-Cog: 3단어 회상(0~3점)과 시계그리기(정상 2점·비정상 0점)를 넣으면 총점(5점)이 자동으로 나오고, 0~2점이면 ‘인지저하 의심’으로 표시합니다(선별용·참고, Borson 등 2000). 총점과 판정은 메모에 넣지 않습니다.</p>' : ''}
        ${N.tpl.items.some(i => i.fields.some(f => f.calc === 'bmi')) ? '<p class="hint" style="margin:4px 0 0">신체계측: 키(cm)·몸무게(kg)를 넣으면 BMI(몸무게 ÷ 키m²)를 소수 첫째 자리까지 자동 계산합니다. 판정은 대한비만학회 2022 진료지침(18.5 미만 저체중, 18.5~22.9 정상, 23~24.9 비만 전단계, 25 이상 비만 1~3단계)이며 참고용입니다.</p>' : ''}
        ${N.tpl.items.some(i => i.fields.some(f => f.norm)) ? '<p class="hint" style="margin:4px 0 0">악력: 각 손의 최댓값(kg)을 적고 성별·나이를 넣으세요. 또래 기준은 한국인 국민건강영양조사 2014–2015 악력 참고치(60세 이상, 5세 간격, 하위 20% 미만이면 ‘또래 하위 20%’), 근력 저하는 AWGS 2019 아시아 근감소증 기준(양손 중 큰 값이 남 28kg·여 18kg 미만). 성별·나이는 판정에만 쓰고 메모에는 넣지 않습니다.</p>' : ''}
        <label class="f" style="margin-top:8px">기타사항 (직접 적기) <span class="hint">— 메모의 *기타사항 아래에 한 줄씩 들어갑니다</span><textarea id="ntExtra" rows="2" maxlength="300" placeholder="체크 항목에 없는 기타 메모사항을 직접 적으세요">${esc(N.extra)}</textarea></label>
      </div></div>
      <div class="card nt-outcard"><div class="card-body">
        <div class="row" style="justify-content:space-between;margin-bottom:6px"><b>만들어진 메모</b><span class="hint" id="ntCount"></span></div>
        <textarea id="ntOut" rows="12" aria-label="만들어진 메모 (직접 고칠 수 있음)">${esc(N.out || '')}</textarea>
        <div class="hint nt-caret" id="ntCaret">메모 안을 눌러 커서를 두면, 그다음 누르는 항목은 그 자리에 들어갑니다.</div>
        <div class="row" style="margin-top:8px;gap:8px">
          <button class="primary" id="ntCopy" style="flex:1">복사하기</button>
          <button id="ntClear">다음 대상자 (모두 지우기)</button>
        </div>
        <p class="hint" style="margin:8px 0 0">체크한 내용과 문장은 자동 저장·전송하지 않습니다. ‘새로 저장’을 누르면 이 기기에 암호화하여 보관하며, Drive 복사는 별도로 선택합니다. 잠금·로그아웃 전 필요한 내용을 저장하세요.</p>
      </div></div></div>`;
  }
  function editHtml() {
    const rows = N.tpl.items.map((it, k) => `<div class="lk-row" data-edit="${it.id}">
        <div><b>${esc(it.label)}</b> <span class="hint">${esc(it.group)} · ${KINDS[it.kind]}</span></div>
        <div class="hint">${esc(it.kind === 'num' || it.kind === 'drugs' ? it.template.replace(/\n/g, ' ⏎ ') : it.options.map(o => o.label).join(' / '))}</div>
        <div class="row" style="gap:4px"><button class="small" data-move="${k}" data-dir="-1" title="위로">▲</button><button class="small" data-move="${k}" data-dir="1" title="아래로">▼</button></div></div>`).join('');
    return `<div class="row" style="margin-bottom:10px;gap:8px;flex-wrap:wrap">
        <button class="primary" id="ntAdd">+ 항목 추가</button>
        <label class="row" style="gap:6px">문장 사이<select id="ntJoin"><option value=" "${N.tpl.joiner === ' ' ? ' selected' : ''}>띄어쓰기</option><option value="\n"${N.tpl.joiner === '\n' ? ' selected' : ''}>줄바꿈</option></select></label>
        <label class="row" style="gap:6px"><input type="checkbox" id="ntDash"${N.tpl.dash ? ' checked' : ''}>문장 앞에 - 붙이기</label>
        <label class="row" style="gap:6px"><input type="checkbox" id="ntFlagMemo"${N.tpl.flagInMemo ? ' checked' : ''}>메모에도 ↑↓ 표시</label>
        ${N.tpl.defaultsPending ? '<button id="ntConfirm">확인 완료 (임시 표시 없애기)</button>' : ''}
        <button class="danger" id="ntReset">기본 틀로 되돌리기</button></div>
      <p class="hint">항목을 누르면 고칠 수 있습니다. ▲▼로 순서를 바꾸면 메모 문장 순서도 바뀝니다.</p>
      <div class="lk-list">${rows || '<div class="empty">항목이 없습니다.</div>'}</div>
      <p class="hint" style="margin:18px 0 0">아래는 기본 목록에 없어서 직접 추가했거나 괄호 메모를 바꾼 약·영양제입니다. 다음 검색부터 먼저 나옵니다. 이름과 메모만 저장되고 대상자 정보는 저장되지 않습니다.</p>
      ${[['drugs', '내 약 목록'], ['supps', '내 영양제 목록']].map(([key, title]) => `<h4 style="margin:12px 0 6px">${title} (${(N.tpl[key] || []).length})</h4>
      <div class="nt-ctl">${(N.tpl[key] || []).map((d, k) => `<span class="lk-chip">${esc(d.name)}${d.note ? '(' + esc(d.note) + ')' : ''} <button type="button" class="link" data-mydel="${k}" data-mylist="${key}" title="빼기">✕</button></span>`).join('') || '<span class="hint">아직 없습니다.</span>'}</div>`).join('')}`;
  }

  /* ---------- 항목 편집 창 ---------- */
  function openEdit(it) {
    N.editing = it ? JSON.parse(JSON.stringify(it)) : { id: uid(), group: groups()[0] || '기타', label: '', kind: 'one', options: [{ label: '', text: '' }], fields: [], template: '', isNew: true };
    paintEdit(); $('#ntDlg').showModal();
  }
  function paintEdit() {
    const e = N.editing;
    $('#ntDlgTitle').textContent = e.isNew ? '항목 추가' : '항목 고치기';
    const opt = e.options.map((o, k) => `<div class="nt-orow"><input data-o="${k}" data-f="label" value="${esc(o.label)}" placeholder="보기 (예: 양호)"><input data-o="${k}" data-f="text" value="${esc(o.text)}" placeholder="${e.kind === 'many' && e.template.includes('{선택}') ? '(문장 틀을 쓰면 비워도 됨)' : '만들어질 문장 (예: 수면 양호하다고 함.)'}"><button type="button" class="small" data-odel="${k}" title="빼기">✕</button></div>`).join('');
    const picks = e.fields.map((f, k) => f.type === 'pick' ? k : -1).filter(k => k >= 0);
    const rIn = (k, key, r, opt) => `<input class="nt-r" data-rk="${k}" data-rf="${key}"${opt != null ? ` data-ro="${esc(opt)}"` : ''} value="${esc(r ? r[key] : '')}" inputmode="decimal" placeholder="${key === 'min' ? '최소' : key === 'max' ? '최대' : '주의 상한'}">`;
    const rRow = (k, r, opt) => `<div class="nt-rrow">${opt != null ? `<b>${esc(opt)}</b>` : '정상 범위'} ${rIn(k, 'min', r, opt)} ~ ${rIn(k, 'max', r, opt)} <span class="hint">주의</span> ~ ${rIn(k, 'warn', r, opt)}</div>`;
    const fld = e.fields.map((f, k) => `<div class="nt-fbox"><div class="nt-orow"><span class="hint">{${k + 1}}</span><input data-fl="${k}" data-f="label" value="${esc(f.label)}" placeholder="칸 이름 (예: 수축기)"><select data-fl="${k}" data-f="type"><option value="num"${f.type !== 'pick' ? ' selected' : ''}>숫자</option><option value="pick"${f.type === 'pick' ? ' selected' : ''}>고르기</option></select>${f.type === 'pick' ? `<input data-fl="${k}" data-f="options" value="${esc(f.options || '')}" placeholder="보기 (쉼표로: 공복,식후)">` : `<input data-fl="${k}" data-f="unit" value="${esc(f.unit)}" placeholder="단위 (예: mmHg)">`}<button type="button" class="small" data-fdel="${k}" title="빼기">✕</button></div>
      ${f.type === 'pick' ? '' : f.calc === 'minicog' ? '<div class="nt-rrow hint">자동 계산: 3단어 회상 + 시계그리기 (총 5점, 0~2점 인지저하 의심). 메모에는 들어가지 않습니다.</div>' : f.calc ? '<div class="nt-rrow hint">자동 계산: 몸무게(kg) ÷ 키(m)² — 같은 항목의 ‘키’·‘몸무게’ 칸을 씁니다. 판정은 대한비만학회 2022 기준(직접 입력 안 함).</div>' : f.norm ? '<div class="nt-rrow hint">기준: 한국인 악력 참고치(성별·나이) + AWGS 2019 근력 저하 기준 — 같은 항목의 ‘성별’(고르기: 남,여)·‘나이’ 칸을 씁니다.</div>' : `${rRow(k, f.range)}${picks.length ? `<label class="hint nt-rrow"><input type="checkbox" data-rby="${k}"${f.rangeBy ? ' checked' : ''}> 고르기 칸 {${(f.rangeBy || picks[0] + 1)}}에 따라 기준 다르게</label>` : ''}${f.rangeBy && e.fields[f.rangeBy - 1] && e.fields[f.rangeBy - 1].type === 'pick' ? String(e.fields[f.rangeBy - 1].options || '').split(',').map(x => x.trim()).filter(Boolean).map(o => rRow(k, (f.ranges || {})[o], o)).join('') : ''}`}</div>`).join('');
    $('#ntDlgBody').innerHTML = `<div class="grid2">
        <label class="f">항목 이름<input id="neLabel" value="${esc(e.label)}" maxlength="40"></label>
        <label class="f">묶음 <span class="hint">(메모의 *머리줄)</span><input id="neGroup" value="${esc(e.group)}" maxlength="30" list="ntGroups"><datalist id="ntGroups">${groups().map(g => `<option value="${esc(g)}">`).join('')}</datalist></label>
        <label class="f">고르는 방식<select id="neKind">${Object.keys(KINDS).map(k => `<option value="${k}"${e.kind === k ? ' selected' : ''}>${KINDS[k]}</option>`).join('')}</select></label>
        ${['many', 'acute', 'num'].includes(e.kind) ? `<label class="row" style="gap:6px;align-items:center"><input type="checkbox" id="neNotes" style="width:auto"${e.notes ? ' checked' : ''}> 고른 보기마다 메모 칸 <span class="hint">(메모에 괄호로 들어감, 예: 백내장(2025년도 op+))</span></label>` : ''}
      </div>
      ${e.kind === 'lead' ? `<label class="f" style="margin-top:10px">앞에 붙일 표시 <span class="hint">(예: * → *신규등록을 위해 방문함.)</span><input id="neTpl" value="${esc(e.template)}" maxlength="10"></label>` : ''}
      ${e.kind === 'text' ? `<label class="f" style="margin-top:10px">문장 틀 <span class="hint">({입력} 자리에 적은 내용이 들어감)</span><input id="neTpl" value="${esc(e.template)}" maxlength="100" placeholder="예: 물품: {입력}"></label>
        <h4 style="margin:14px 0 6px">빠른 입력 보기 <span class="hint">(누르면 칸에 쉼표로 이어 넣음, 비워도 됨)</span></h4>${e.options.map((o, k) => `<div class="nt-orow"><input data-o="${k}" data-f="label" value="${esc(o.label)}" placeholder="예: 혈압계"><button type="button" class="small" data-odel="${k}" title="빼기">✕</button></div>`).join('')}<button type="button" class="small" id="neOAdd">+ 보기 추가</button>` : ''}
      ${e.kind === 'text' ? '' : e.kind === 'drugs' ? `<label class="f" style="margin-top:10px">문장 틀 <span class="hint">({목록} 자리에 ‘약 이름(메모), …’가 들어감)</span><textarea id="neTpl" rows="2" placeholder="예: 복용약: {목록}">${esc(e.template)}</textarea></label>
        <p class="hint">${isSupp(e) ? `검색 목록은 자주 드시는 영양제 ${(window.VHM_SUPPS || []).length}종(괄호는 식약처 건강기능식품 기능성을 줄인 참고용) + ‘내 영양제 목록’입니다.` : `검색 목록은 의약품안전나라에서 확인한 자주 쓰는 처방약 ${(window.VHM_DRUGS || []).length}개 + 성분명 + ‘내 약 목록’입니다.`}</p>` : e.kind === 'num' ? `<h4 style="margin:14px 0 6px">입력 칸</h4>${fld}<button type="button" class="small" id="neFAdd">+ 칸 추가</button>
        <label class="f" style="margin-top:10px">문장 틀 <span class="hint">({1}, {2}… 자리에 입력한 값이 들어감. 줄을 바꾸면 메모도 줄이 바뀜. ‘, ’로 나눈 조각은 숫자를 안 적으면 빠짐. 고르기 칸을 안 고르면 ‘({5})’ 부분만 빠짐)</span><textarea id="neTpl" rows="3" placeholder="예: -BP: {1}/{2}mmHg, PR: {3}회/분">${esc(e.template)}</textarea></label>
        <p class="hint" style="margin:6px 0 0">정상 범위: 최소보다 낮으면 ‘낮음’, 최대보다 높으면 ‘주의’(주의 상한까지) 또는 ‘높음’. 비워 두면 판정하지 않습니다.</p>`
      : `<h4 style="margin:14px 0 6px">보기와 문장</h4><p class="hint" style="margin-top:0">${e.kind === 'many' ? '보기별 문장을 적으면 상담메모에 그대로 들어갑니다. 비우면 문장 틀을 사용하고, 틀이 없으면 보기 이름을 사용합니다.' : '문장을 비우면 그 보기를 골라도 메모에 아무것도 안 들어갑니다(예: 흡연 ‘안 함’).'}</p>${opt}<button type="button" class="small" id="neOAdd">+ 보기 추가</button>
        ${e.kind === 'many' ? `<label class="f" style="margin-top:10px">문장 틀 (선택) <span class="hint">(보기별 문장을 적으면 그 문장을 우선 사용함. 비워 둔 보기는 {선택} 자리에 이름이 쉼표로 이어져 들어감. 줄을 바꾸면 메모도 줄이 바뀜)</span><textarea id="neTpl" rows="2" placeholder="예: {선택} 교육함.">${esc(e.template)}</textarea></label>` : ''}`}`;
    $('#ntDel').hidden = !!e.isNew;
  }
  function readEdit() {
    const e = N.editing; const v = id => ($('#' + id) || {}).value;
    e.label = (v('neLabel') || '').trim(); e.group = (v('neGroup') || '').trim() || '기타'; e.kind = v('neKind') || e.kind;
    if ($('#neTpl')) e.template = $('#neTpl').value.replace(/\r/g, '').trim();
    if ($('#neNotes')) { if ($('#neNotes').checked) e.notes = true; else delete e.notes; }
    $$('#ntDlgBody [data-o]').forEach(i => { e.options[+i.dataset.o][i.dataset.f] = i.value; });
    $$('#ntDlgBody [data-fl]').forEach(i => { const f = e.fields[+i.dataset.fl]; if (i.dataset.f === 'type') { if (i.value === 'pick') { f.type = 'pick'; f.options = f.options || ''; } else delete f.type; } else f[i.dataset.f] = i.value; });
    $$('#ntDlgBody [data-rk]').forEach(i => { const f = e.fields[+i.dataset.rk]; if (i.dataset.ro != null) { f.ranges = f.ranges || {}; f.ranges[i.dataset.ro] = f.ranges[i.dataset.ro] || { min: '', max: '', warn: '' }; f.ranges[i.dataset.ro][i.dataset.rf] = i.value.replace(/[^\d.]/g, ''); } else { f.range = f.range || { min: '', max: '', warn: '' }; f.range[i.dataset.rf] = i.value.replace(/[^\d.]/g, ''); } });
    $$('#ntDlgBody [data-rby]').forEach(i => { const f = e.fields[+i.dataset.rby]; if (i.checked) { if (!f.rangeBy) f.rangeBy = e.fields.findIndex(x => x.type === 'pick') + 1; } else { delete f.rangeBy; delete f.ranges; } });
  }

  /* ---------- 이벤트 ---------- */
  function bind() {
    const b = box();
    b.addEventListener('click', async ev => {
      const t = ev.target.closest('button,[data-edit]'); if (!t) return;
      if (t.id === 'ntHiraCopy') { const ok = await copyText(HIRA_MEDICATION_URL); $('#ntHiraCopyStatus').textContent = ok ? ' 공식 주소를 복사했습니다.' : ' 복사하지 못했습니다. 위 바로가기를 이용하세요.'; return; }
      if (t.id === 'ntReferrals') { if (window.FEATURES && !FEATURES.enabled('link')) { toast('설정에서 연계 안내 기능을 켜주세요.'); return; } showTab('link'); return; }
      if (t.dataset.ntview) { N.view = t.dataset.ntview; render(); return; }
      if (t.dataset.it) {   // 보기 고르기 (다시 누르면 해제)
        const it = N.tpl.items.find(i => i.id === t.dataset.it), k = +t.dataset.k;
        if (it.kind === 'acute') {
          const st = Object.assign({}, N.pick[it.id] || {}); const nx = !st[k] ? ACUTE_ST[0] : st[k] === ACUTE_ST[0] ? ACUTE_ST[1] : null;
          if (nx) st[k] = nx; else delete st[k]; N.pick[it.id] = st;
          t.classList.toggle('on', !!nx); t.classList.toggle('done', nx === '완치'); t.setAttribute('aria-pressed', !!nx);
          t.innerHTML = esc(it.options[k].label) + (nx ? `<small> · ${nx}</small>` : ''); paintNotes(it.id); refreshOut(); return;
        }
        if (it.kind === 'one' || it.kind === 'lead') N.pick[it.id] = N.pick[it.id] === k ? undefined : k;
        else { const a = new Set(N.pick[it.id] || []); a.has(k) ? a.delete(k) : a.add(k); N.pick[it.id] = [...a].sort((x, y) => x - y); }
        $$(`[data-it="${it.id}"]`).forEach(x => { const on = it.kind === 'one' || it.kind === 'lead' ? N.pick[it.id] === +x.dataset.k : (N.pick[it.id] || []).includes(+x.dataset.k); x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
        paintNotes(it.id); refreshOut(); return;
      }
      if (t.dataset.dadd) { const d = dRes[+t.dataset.k]; if (d) addDrug(t.dataset.dadd, d); return; }
      if (t.dataset.draw) { const q = $(`[data-dq="${t.dataset.draw}"]`).value.trim(); if (q) addDrug(t.dataset.draw, { name: q, note: '' }); return; }
      if (t.dataset.ddel) { const a = (N.pick[t.dataset.ddel] || []).slice(); a.splice(+t.dataset.k, 1); N.pick[t.dataset.ddel] = a; render(); return; }
      if (t.dataset.mydel != null) { const key = t.dataset.mylist === 'supps' ? 'supps' : 'drugs'; N.tpl[key].splice(+t.dataset.mydel, 1); await saveTpl('목록에서 뺐습니다.'); render(); return; }
      if (t.dataset.tadd) {   // 직접 적기 칸의 빠른 입력: 누르면 쉼표로 이어 넣고, 다시 누르면 뺌
        const id = t.dataset.tadd, cur = String(N.lead[id] || '').split(/,\s*/).map(x => x.trim()).filter(Boolean), v = t.dataset.v, k = cur.indexOf(v);
        if (k >= 0) cur.splice(k, 1); else cur.push(v);
        const quick = new Set(N.referralQuick[id] || []); if (k >= 0) quick.delete(v); else quick.add(v); N.referralQuick[id] = Array.from(quick);
        N.lead[id] = cur.join(', '); const inp = $(`[data-lead="${id}"]`); if (inp) inp.value = N.lead[id];
        t.classList.toggle('on', k < 0); t.setAttribute('aria-pressed', k < 0); refreshOut(); return;
      }
      if (t.dataset.pickf) {   // 숫자 항목 안의 고르기 칸 (예: 혈당 공복/식후)
        const id = t.dataset.pickf, k = +t.dataset.k, a = (N.pick[id] || []).slice(); a[k] = a[k] === t.dataset.v ? '' : t.dataset.v; N.pick[id] = a;
        $$(`[data-pickf="${id}"][data-k="${k}"]`).forEach(x => { const on = a[k] === x.dataset.v; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
        paintNotes(id); refreshOut(); return;
      }
      if (t.id === 'ntCopy') {
        const txt = $('#ntOut').value; if (!txt.trim()) { toast('복사할 문장이 없습니다. 항목을 골라 주세요.'); return; }
        try { await navigator.clipboard.writeText(txt); } catch (e) { const ta = $('#ntOut'); ta.focus(); ta.select(); document.execCommand('copy'); }
        toast('복사했습니다. 전용앱 메모란에 붙여 넣으세요.'); return;
      }
      if (t.id === 'ntCaretOff') { N.caret = null; paintCaret(); return; }
      if (t.id === 'ntClear') { clearContent(); if (window.CONSULTATIONS) CONSULTATIONS.clearDraft(); toast('현재 내용만 지웠습니다. 저장 메모는 유지됩니다.'); return; }
      if (t.id === 'ntAdd') { openEdit(null); return; }
      if (t.id === 'ntConfirm') { N.tpl.defaultsPending = false; await saveTpl('확인 완료로 표시했습니다.'); render(); return; }
      if (t.id === 'ntReset') { if (!confirm('지금 항목을 모두 지우고 기본 틀로 되돌릴까요?')) return; N.tpl = defaults(); N.pick = {}; N.referralQuick = {}; if (window.LINKS) LINKS.clearNoteNeeds(); await saveTpl('기본 틀로 되돌렸습니다.'); render(); return; }
      if (t.dataset.move != null) { const k = +t.dataset.move, j = k + +t.dataset.dir, a = N.tpl.items; if (j < 0 || j >= a.length) return; [a[k], a[j]] = [a[j], a[k]]; await saveTpl(); render(); return; }
      if (t.dataset.edit) { openEdit(N.tpl.items.find(i => i.id === t.dataset.edit)); return; }
    });
    b.addEventListener('input', ev => {
      if (ev.target.id === 'ntAgeIn') { N.age = ev.target.value; if (typeof AGE === 'object') AGE.ntAge = null; if (typeof calcAge === 'function') calcAge('ntAge'); return; }
      const t = ev.target;
      if (t.dataset.lead) { delete N.referralQuick[t.dataset.lead]; N.lead[t.dataset.lead] = t.value; if (!ev.isComposing) refreshOut(); return; }   // 한글 조합 중에는 메모를 건드리지 않음
      if (t.dataset.dq) { showDrugList(t.dataset.dq, t.value); return; }
      if (t.dataset.dname || t.dataset.dnote) { const id = t.dataset.dname || t.dataset.dnote, a = N.pick[id] || []; const x = a[+t.dataset.k]; if (x) { x[t.dataset.dname ? 'name' : 'note'] = t.value; if (!ev.isComposing) refreshOut(); } return; }
      if (t.dataset.num) { const a = (N.pick[t.dataset.num] || []).slice(); a[+t.dataset.k] = t.value.replace(/[^\d.]/g, ''); if (a[+t.dataset.k] !== t.value) t.value = a[+t.dataset.k]; N.pick[t.dataset.num] = a; refreshOut(); }
      else if (t.id === 'ntExtra') { N.extra = t.value; if (!ev.isComposing) refreshOut(); }
      else if (t.id === 'ntOut') { N.out = t.value; N.edited = t.value !== N.gen; $('#ntCount').textContent = t.value.length + '자'; }
    });
    b.addEventListener('compositionend', ev => { const t = ev.target; if (t.dataset.lead) { delete N.referralQuick[t.dataset.lead]; N.lead[t.dataset.lead] = t.value; refreshOut(); } else if (t.id === 'ntExtra') { N.extra = t.value; refreshOut(); } else if (t.dataset.dname || t.dataset.dnote) refreshOut(); });
    // 메모 칸의 커서 위치 기억 (누르기·방향키·글 고르기)
    const rememberCaret = ev => { const t = ev.target; if (t.id !== 'ntOut') return; N.caret = { pos: t.selectionEnd, val: t.value }; paintCaret(); };
    ['click', 'keyup', 'select', 'input'].forEach(k => b.addEventListener(k, rememberCaret));
    b.addEventListener('keydown', ev => {
      const t = ev.target; if (!t.dataset || !t.dataset.dq) return;
      if (ev.key === 'Enter') { ev.preventDefault(); if (ev.isComposing) return; const q = t.value.trim(); if (!q) return; addDrug(t.dataset.dq, dRes[0] && norm(t.value) ? dRes[0] : { name: q, note: '' }); }
      if (ev.key === 'Escape') { const l = $(`[data-dlist="${t.dataset.dq}"]`); if (l) l.hidden = true; }
    });
    b.addEventListener('pointerdown', ev => { if (ev.target.closest('.nt-dlist') && !ev.target.closest('a')) ev.preventDefault(); });   // 목록을 누를 때 검색칸이 먼저 닫히지 않게
    b.addEventListener('focusout', ev => { const t = ev.target; if (t.dataset && t.dataset.dq) { const id = t.dataset.dq; setTimeout(() => { const l = $(`[data-dlist="${id}"]`), act = document.activeElement; if (l && !l.contains(act) && !(act && act.dataset && act.dataset.dq === id)) l.hidden = true; }, 200); }
      if (t.dataset && (t.dataset.dname || t.dataset.dnote)) { const id = t.dataset.dname || t.dataset.dnote, x = (N.pick[id] || [])[+t.dataset.k]; if (x) rememberDrug(x, itemOf(id)); } });
    b.addEventListener('change', async ev => {
      if (ev.target.id === 'ntJoin') { N.tpl.joiner = ev.target.value; await saveTpl(); }
      if (ev.target.id === 'ntDash') { N.tpl.dash = ev.target.checked; await saveTpl(ev.target.checked ? '문장 앞에 -를 붙이고 한 줄씩 적습니다.' : '문장 앞에 -를 붙이지 않습니다.'); }
      if (ev.target.id === 'ntFlagMemo') { N.tpl.flagInMemo = ev.target.checked; await saveTpl(ev.target.checked ? '메모의 수치 옆에 ↑(높음·주의) ↓(낮음)을 붙입니다.' : '메모에는 수치만 적습니다.'); }
    });
    // 편집 창
    $('#ntDlgBody').addEventListener('click', ev => {
      const t = ev.target.closest('button'); if (!t) return; readEdit(); const e = N.editing;
      if (t.id === 'neOAdd') e.options.push({ label: '', text: '' });
      else if (t.id === 'neFAdd') e.fields.push({ label: '', unit: '' });
      else if (t.dataset.odel != null) e.options.splice(+t.dataset.odel, 1);
      else if (t.dataset.fdel != null) e.fields.splice(+t.dataset.fdel, 1);
      else return;
      paintEdit();
    });
    $('#ntDlgBody').addEventListener('change', ev => {
      if (ev.target.dataset.f === 'type' || ev.target.dataset.rby != null || (ev.target.dataset.f === 'options')) { readEdit(); paintEdit(); return; }
      if (ev.target.id !== 'neKind') return; readEdit(); const e = N.editing;
      if (e.kind === 'num' && !e.fields.length) { e.fields = [{ label: e.label || '값', unit: '' }]; if (!e.template) e.template = (e.label || '값') + ' {1} 측정함.'; }
      if (e.kind === 'drugs' && !e.template.includes('{목록}')) e.template = '복용약: {목록}';
      if (e.kind === 'text' && !e.template.includes('{입력}')) e.template = (e.label ? e.label + ': ' : '') + '{입력}';
      if (e.kind !== 'num' && e.kind !== 'drugs' && e.kind !== 'text' && !e.options.length) e.options = [{ label: '', text: '' }];
      paintEdit();
    });
    $('#ntSave').onclick = async () => {
      readEdit(); const e = N.editing;
      e.options = e.options.filter(o => o.label.trim()); e.fields = e.fields.filter(f => f.label.trim());
      if (!e.label) return alert('항목 이름을 적어 주세요.');
      if (e.kind === 'num' && (!e.fields.length || !e.template)) return alert('입력 칸과 문장 틀을 적어 주세요.');
      if (e.kind === 'text' && !e.template) e.template = '{입력}';
      if (e.kind === 'one' || e.kind === 'many' || e.kind === 'lead' || e.kind === 'acute') { if (!e.options.length) return alert('보기를 하나 이상 적어 주세요.'); }
      if (e.kind === 'drugs' && !e.template.includes('{목록}')) return alert('문장 틀에 {목록}을 넣어 주세요.');
      const isNew = e.isNew; delete e.isNew; const it = clean({ schema: SCHEMA, items: [e] }).items[0]; it.id = e.id;
      const k = N.tpl.items.findIndex(i => i.id === it.id);
      if (k >= 0) N.tpl.items[k] = it; else N.tpl.items.push(it);
      delete N.pick[it.id]; delete N.referralQuick[it.id];
      $('#ntDlg').close(); await saveTpl(isNew ? '항목을 추가했습니다.' : '항목을 고쳤습니다.'); render();
    };
    $('#ntDel').onclick = async () => {
      if (!confirm('이 항목을 지울까요?')) return;
      N.tpl.items = N.tpl.items.filter(i => i.id !== N.editing.id); delete N.pick[N.editing.id];
      $('#ntDlg').close(); await saveTpl('항목을 지웠습니다.'); render();
    };
  }

  function resetSession() {
    savedTemplate = null;
    N.pick = {}; N.lead = {}; N.referralQuick = {}; N.extra = ''; N.age = ''; N.out = ''; N.gen = null; N.caret = null; N.edited = false; N.tpl = null; N.synced = false; N.editing = null; N.view = 'write';
    if (box()) box().replaceChildren(); if (window.LINKS) LINKS.clearNoteNeeds();
    if ($('#ntDlg')?.open) $('#ntDlg').close();
  }
  function clearContent() {
    if (savedTemplate) { N.tpl = savedTemplate.tpl; N.synced = savedTemplate.synced; savedTemplate = null; }
    N.pick = {}; N.lead = {}; N.referralQuick = {}; N.extra = ''; N.age = ''; N.out = ''; N.gen = null; N.caret = null; N.edited = false;
    if (window.LINKS) LINKS.clearNoteNeeds(); if (N.tpl) render();
  }
  function snapshot() {
    return JSON.parse(JSON.stringify({tpl:N.tpl,pick:N.pick,lead:N.lead,referralQuick:N.referralQuick,extra:N.extra,age:N.age || '',out:$('#ntOut')?.value ?? N.out ?? ''}));
  }
  function validateSaved(d) {
    if (!d || !d.tpl || !Array.isArray(d.tpl.items) || d.tpl.items.length > 300 || typeof d.out !== 'string' || d.out.length > 100000) throw new Error('저장된 상담메모 형식이 올바르지 않습니다.');
    const safeId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id) && !['__proto__','constructor','prototype'].includes(id);
    if (!d.tpl.items.every(i => i && safeId(i.id) && Array.isArray(i.options) && Array.isArray(i.fields))) throw new Error('질문 항목 ID 또는 형식이 올바르지 않습니다.');
    const tpl = clean(d.tpl), pick = d.pick || {};
    for (const it of tpl.items) {
      const v = pick[it.id]; if (v == null) continue;
      const option = k => Number.isInteger(k) && k >= 0 && k < it.options.length;
      if (['one','lead'].includes(it.kind) && !option(v)) throw new Error('선택 항목이 올바르지 않습니다.');
      if (it.kind === 'many' && (!Array.isArray(v) || !v.every(option))) throw new Error('선택 목록이 올바르지 않습니다.');
      if (it.kind === 'num' && (!Array.isArray(v) || !v.every(x => typeof x === 'string' || x === null))) throw new Error('측정값이 올바르지 않습니다.');
      if (it.kind === 'drugs' && (!Array.isArray(v) || !v.every(x => x && typeof x.name === 'string' && typeof x.note === 'string'))) throw new Error('약 목록이 올바르지 않습니다.');
      if (it.kind === 'acute' && (typeof v !== 'object' || Array.isArray(v) || !Object.entries(v).every(([k,x]) => option(+k) && ACUTE_ST.includes(x)))) throw new Error('질환 선택이 올바르지 않습니다.');
    }
    if (d.lead && (typeof d.lead !== 'object' || Object.values(d.lead).some(v => typeof v !== 'string'))) throw new Error('입력 내용이 올바르지 않습니다.');
    if (d.referralQuick && (typeof d.referralQuick !== 'object' || Object.values(d.referralQuick).some(v => !Array.isArray(v) || v.some(x => typeof x !== 'string')))) throw new Error('빠른 입력 내용이 올바르지 않습니다.');
    return tpl;
  }
  function restoreSaved(d) {
    const tpl = validateSaved(d);
    if (!savedTemplate) savedTemplate = {tpl:N.tpl,synced:N.synced};
    N.tpl = tpl; N.synced = true; N.pick = structuredClone(d.pick || {}); N.lead = structuredClone(d.lead || {}); N.referralQuick = structuredClone(d.referralQuick || {});
    N.extra = String(d.extra || ''); N.age = String(d.age || ''); N.out = d.out; N.gen = compose(); N.edited = true; N.caret = null; N.view = 'write';
    if (window.LINKS) LINKS.clearNoteNeeds(); render();
  }
  window.NOTES = { open, bind, resetSession, clearContent, snapshot, validateSaved, restoreSaved, referralNeeds() { return window.VHM_NOTE_REFERRALS ? VHM_NOTE_REFERRALS.fromState(N.tpl?.items,N.pick,N.referralQuick) : []; }, _state: N, _compose: compose, _defaults: defaults };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();
