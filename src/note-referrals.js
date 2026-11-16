/* Deterministic checked-option mapping only. No free text, medication names, age or numeric diagnosis. */
(function () {
  'use strict';
  const key = s => typeof s === 'string' ? s.normalize('NFKC').replace(/\s/g,'') : '';
  const oneRules = {
    '복약': {'가끔 거름':['medication']},
    '투약 중단': {'약 부작용':['medication'],'증상 호전':['medication']},
    '기분·정서': {'우울감':['mood'],'불안':['mood']},
    '식사': {'식욕 저하':['nutrition'],'불규칙':['nutrition']},
    '낙상': {'있음':['fall']},
    '음주': {'자주':['mental-case']}
  };
  const diseases = {
    '고혈압':['chronic'],'당뇨병':['chronic'],'당뇨':['chronic'],'이상지질혈증':['chronic'],'고지혈증':['chronic'],
    '관절염':['rehab'],'척추질환':['rehab'],'골다공증':['rehab'],'뇌졸중':['rehab'],
    '심장질환':['chronic'],'만성폐질환':['chronic'],'만성콩팥병':['chronic'],'갑상선질환':['chronic'],'전립선비대증':['chronic'],
    '치매':['dementia-care'],'암':['cancer'],'우울증':['mood']
  };
  const senses = {
    '눈': {'시력저하':['vision'],'백내장':['eye-surgery'],'녹내장':['vision']},
    '귀': {'청력저하':['hearing-aid']},
    '구강건강': {'불량':['oral-check'],'틀니 사용':['dentures'],'저작 불편':['chewing']}
  };
  const quickRoutes = {'치매안심센터':['memory'],'노인맞춤돌봄서비스':['daily'],'정신건강복지센터':['mental-case'],'장기요양 등급신청':['longterm'],'보건소 건강증진 프로그램':['chronic']};
  const lookup = (rules, value) => Object.entries(rules).find(([label]) => key(label) === key(value))?.[1];
  function fromState(items, picks, quick) {
    const out = new Set();
    const add = values => (values || []).forEach(v => out.add('refined:' + v));
    for (const it of Array.isArray(items) ? items : []) {
      const p = picks && picks[it.id];
      if (it.kind === 'one' && Number.isInteger(p)) add(lookup(lookup(oneRules,it.label) || {},it.options?.[p]?.label));
      if (it.kind === 'many' && key(it.label) === key('만성질환')) {
        for (const n of Array.isArray(p) ? p : []) if (Number.isInteger(n)) add(lookup(diseases,it.options?.[n]?.label));
      }
      if (it.kind === 'acute' && key(it.label) === key('급성질환') && p && typeof p === 'object') {
        (it.options || []).forEach((o,n) => { if (p[n] === '치료중' && ['골절','염좌'].includes(o.label)) add(['rehab']); });
      }
      if (it.kind === 'num' && Array.isArray(p)) {
        (it.fields || []).forEach((f,n) => {
          if (f.type !== 'pick') return;
          // Accept only an actual categorical option, never a free numeric/string field.
          if (!(f.options || '').split(',').some(o => key(o) === key(p[n]))) return;
          if (key(it.label) === key('눈·귀·구강')) add(lookup(lookup(senses,f.label) || {},p[n]));
          if (key(it.label) === key('관절') && key(f.label) === key('관절') && ['통증','부종','강직','운동 제한'].some(o => key(o) === key(p[n]))) add(['rehab']);
        });
      }
      if (it.kind === 'text' && key(it.label) === key('보건복지서비스 연계')) {
        for (const v of Array.isArray(quick?.[it.id]) ? quick[it.id] : []) {
          if ((it.options || []).some(o => o.label === v)) add(lookup(quickRoutes,v));
        }
      }
    }
    return Array.from(out);
  }
  window.VHM_NOTE_REFERRALS = {fromState};
})();
