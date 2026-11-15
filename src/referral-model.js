/* Public research stays immutable; only explicitly saved personal data goes to Drive. */
(function () {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const text = value => value == null ? '' : String(value);
  const key = value => text(value).normalize('NFKC').replace(/\s/g, '').toLowerCase();
  function safeUrl(value) {
    try { const u = new URL(text(value)); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch (_) { return ''; }
  }
  function service(s) {
    const out = clone(s);
    Object.assign(out, { id: text(s.id), name: text(s.name), org: text(s.org ?? s.organization), field: text(s.field || '기타'),
      needs: Array.isArray(s.needs) ? s.needs.map(text) : [], conditions: text(s.conditions ?? s.eligibleGroups), contact: text(s.contact),
      apply: text(s.apply ?? s.applicationProcedure), docs: text(s.docs), memo: text(s.memo ?? s.exceptionsAndNotes),
      forms: (Array.isArray(s.forms) ? s.forms : []).filter(f => f && (f.fileId || safeUrl(f.url))).map(f => Object.assign({}, f,
        f.fileId ? { type: 'file', name: text(f.name || f.label || '양식') } : { name: text(f.name || f.label || '링크'), url: safeUrl(f.url), type: f.type || 'link' })) });
    return out;
  }
  function migrate(d, defaults) {
    const out = {...clone(defaults), ...(d && typeof d === 'object' ? clone(d) : {})};
    out.schema = Math.max(2, Number(out.schema) || 0);
    out.categories = (Array.isArray(out.categories) ? out.categories : []).map(c => ({...c, items:Array.isArray(c.items) ? c.items : []}));
    out.services = (Array.isArray(out.services) ? out.services : []).filter(s => s && s.name).map(service);
    out.catalogReviews = out.catalogReviews && typeof out.catalogReviews === 'object' && !Array.isArray(out.catalogReviews) ? out.catalogReviews : {};
    return out;
  }
  const routes = {1:'① 공공기관 의뢰·추천 필수',2:'② 공공기관 의뢰·추천 가능',3:'③ 본인·가족 직접 신청 가능',4:'④ 신청·의뢰 경로 미확인'};
  const needsKey = label => key(label === '만성질환 관리' ? '고혈압·당뇨 등 만성질환 관리' : label);
  function mapNeeds(labels, categories) {
    const ids = new Map(categories.flatMap(c => c.items.map(i => [needsKey(i.label), i.id])));
    return { ids: labels.map(n => ids.get(needsKey(n))).filter(Boolean), missing: labels.filter(n => !ids.has(needsKey(n))) };
  }
  const refinedGroups = window.VHM_REFINED_NEEDS.groups;
  function refinedHits(s, labels, selected) {
    const serviceNeeds = new Set(labels.map(needsKey));
    // Catalog copies use specific service mappings too; broad custom services keep their existing links.
    const catalogId = s.catalogId || (!s._personal ? s.id : null);
    return refinedGroups.flatMap(g => g.items).filter(i => selected.has(i.id) &&
      (catalogId ? i.serviceIds.includes(catalogId) : i.parents.some(n => serviceNeeds.has(needsKey(n))))).map(i => i.label);
  }
  // Display grouping only: never rewrite the user's saved category/need IDs.
  const broadGroups = {
    urgent:['긴급 지원 필요'],
    cost:['의료비 부담'],
    oral:['구강 문제'],
    senses:['시력·청력 문제'],
    disease:['고혈압·당뇨 등 만성질환 관리','암 치료·관리','약 복용 관리 어려움','희귀질환 치료·관리'],
    mobility:['관절·척추 통증','거동 불편·보행 보조 필요','재활·운동 필요','보조기기 필요'],
    care:['일상생활 도움 필요','장기요양 필요','보호자 부재·돌봄 부담','퇴원 후 돌봄','방문 진료·간호 필요'],
    food:['영양 불량·식사량 감소','식사 준비 어려움'],
    mental:['인지 저하·치매 의심','우울감·정서 지원 필요','음주 문제','정신건강 사례관리'],
    safety:['독거','사회적 고립','안전 설비 필요','낙상 위험'],
    housing:['주거환경 불량(위생·수리)','냉난방 어려움'],
    access:['병원 동행 필요','생계 곤란']
  };
  function groupedNeeds(categories) {
    const groups = refinedGroups.map(g => ({id:g.id,name:g.name,items:g.items.map(i => ({...clone(i),sourceIds:[i.id]}))}));
    groups.unshift({id:'urgent',name:'긴급 지원 필요',standalone:true,items:[]});
    const destinations = new Map(Object.entries(broadGroups).flatMap(([id,labels]) => labels.map(label => [needsKey(label),id])));
    const byLabel = new Map(groups.flatMap(g => g.items.map(i => [needsKey(i.label),i])));
    for (const c of categories) for (const raw of c.items) {
      const k = needsKey(raw.label), existing = byLabel.get(k);
      if (existing) { if (!existing.sourceIds.includes(raw.id)) existing.sourceIds.push(raw.id); continue; }
      const destination = destinations.get(k) || 'access';
      const group = groups.find(g => g.id === destination);
      const item = {...clone(raw),sourceIds:[raw.id]}; group.items.push(item); byLabel.set(k,item);
    }
    return groups;
  }
  function expandNeedSelection(groups, selected) {
    const out = new Set(selected);
    for (const g of groups) for (const i of g.items) if (i.sourceIds.some(id => selected.has(id))) i.sourceIds.forEach(id => out.add(id));
    return out;
  }
  function identity(s) { return key(s.name) + '|' + key(s.org ?? s.organization); }
  function isDuplicate(s, list) { return list.some(p => (p.catalogId && p.catalogId === (s.catalogId || s.id)) || identity(p) === identity(s)); }
  function mergeCatalog(d, selected, createMissing = false) {
    const out = clone(d), added = [], duplicates = [], missing = new Set();
    for (const raw of selected) {
      const s = service(raw);
      if (isDuplicate(s, out.services)) { duplicates.push(s.name); continue; }
      const mapping = mapNeeds(s.needs, out.categories);
      mapping.missing.forEach(n => missing.add(n));
      if (createMissing) for (const label of mapping.missing) {
        let category = out.categories.find(c => c.id === 'catalog-needs');
        if (!category) { category = {id:'catalog-needs',name:'공개자료 추가 요구',items:[]}; out.categories.push(category); }
        const id = 'catalog-need-' + encodeURIComponent(needsKey(label));
        if (!category.items.some(i => i.id === id)) category.items.push({id,label});
      }
      s.catalogId = raw.catalogId || raw.id; s.catalogVersion = window.VHM_PUBLIC_REFERRALS.datasetId;
      s.id = 'catalog-copy-' + s.catalogId; s.needs = mapNeeds(raw.needs, out.categories).ids;
      // Keep the research labels independently of personal need IDs.
      s.catalogNeedLabels = clone(raw.needs); out.services.push(s); added.push(s);
    }
    return {data:out,added,duplicates,missing:Array.from(missing)};
  }
  function intake(s) {
    if (s.verificationStatus === 'needs_contact') return 'unknown';
    const t = text(s.intakeStatus);
    if (/미운영|운영\s*중단/.test(t)) return 'closed';
    if (/대기\s*신청만|대기\s*접수만/.test(t)) return 'waiting';
    if (/예산|대기|접수.*확인|모집|정원|예약.*확인/.test(t)) return 'check';
    if (!t || /미확인/.test(t)) return 'unknown';
    return 'guide';
  }
  const intakeLabels = {guide:'제도·상담 안내',waiting:'대기 신청',closed:'미운영',check:'예산·접수 확인',unknown:'미확인'};
  const groupLabels = {basic:'기초생활수급',medical:'의료급여',reduced:'차상위본인부담경감',low:'일반 건강보험 저소득',senior:'65세 이상 관련',disabled:'등록장애인',unknown:'자격 개별 확인'};
  // Only explicit eligibility wording is indexed; broad '차상위' never implies 본인부담경감.
  function groups(s) {
    if (Array.isArray(s.qualificationTags)) return s.qualificationTags;
    const t = text(s.conditions ?? s.eligibleGroups), out = [];
    if (s.catalogId === 'seoul-rent-voucher' || s.id === 'seoul-rent-voucher') return ['low'];
    if (/기초생활|기초수급|생계\/의료\/주거\/교육급여/.test(t)) out.push('basic');
    if (/의료급여/.test(t)) out.push('medical');
    if (/차상위본인부담경감/.test(t)) out.push('reduced');
    if (/저소득.*건강보험|저소득.*건보|건강보험.*저소득|복지사각지대 일반 저소득/.test(t)) out.push('low');
    if (/65세 이상|60세 이상/.test(t)) out.push('senior');
    if (/등록장애인/.test(t)) out.push('disabled');
    return out.length ? out : ['unknown'];
  }
  window.VHM_REFERRALS = {clone,key,needsKey,safeUrl,service,migrate,routes,mapNeeds,identity,isDuplicate,mergeCatalog,intake,intakeLabels,groups,groupLabels,refinedGroups,refinedHits,groupedNeeds,expandNeedSelection};
})();
