// All source files are served locally; this tab works without a Google connection.
const EDU = { query:'', audience:'sheet', large:false };
const eduPdf = audience => 'education/' + (audience === 'why' ? 'nurse-evidence.pdf' : 'elder-guide.pdf');
const eduText = value => esc(String(value || ''));
function eduAction(url, label, download) {
  return `<a class="edu-action" href="${url}" ${download ? `download="${download}"` : 'target="_blank" rel="noopener"'}>${label}</a>`;
}
function eduCards() {
  const q = EDU.query.trim().toLocaleLowerCase().replace(/\s+/g,'');
  const list = HANDOUTS.filter(h => !q || [h.title,h.keywords,h.lead,...h.summary].join(' ').toLocaleLowerCase().replace(/\s+/g,'').includes(q));
  $('#eduCount').textContent = `${list.length}개 질환 · ${EDU.audience === 'why' ? '간호사용 근거자료' : '어르신·보호자용 안내문'}`;
  $('#eduCards').innerHTML = list.length ? list.map(h => `<button class="edu-card" data-ho="${h.id}" style="--hc:${h.color}">
    <span class="edu-card-top"><span class="edu-number">${h.number}</span><span>${EDU.audience === 'why' ? '간호사용' : '어르신·보호자용'}</span><span aria-hidden="true">↗</span></span>
    <h3>${eduText(h.title)}</h3><p>${eduText(h.summary[0])}</p>
    <span class="edu-card-bottom">${EDU.audience === 'why' ? `근거집 ${h.nursePages.join('–')}쪽` : 'A4 안내문 1장'}<span>자료 보기 →</span></span></button>`).join('')
    : '<div class="edu-empty"><h3>검색 결과가 없습니다</h3><p>다른 질환명이나 키워드로 검색해 보세요.</p><button data-edu-reset>전체 자료 보기</button></div>';
}
function renderEdu(id, view) {
  const box = $('#tab-edu');
  if (view) EDU.audience = view === 'why' ? 'why' : 'sheet';
  if (!id) {
    S.eduId = null;
    box.innerHTML = `<div class="edu-library">
      <header class="edu-hero"><div><span class="edu-eyebrow">VHM · 건강교육 자료실</span><h2>건강을 지키는 작은 실천</h2><p>어르신께는 알기 쉬운 안내를,<br class="edu-mobile-br"> 간호사에게는 현장에서 필요한 근거를.</p><div class="edu-hero-tags"><span>10개 질환</span><span>어르신용 안내문</span><span>간호사용 근거집</span></div></div><div class="edu-hero-mark" aria-hidden="true"><span>+</span><small>건강한 일상을<br>함께 만듭니다</small></div></header>
      <section class="edu-downloads" aria-label="전체 PDF 자료"><div><b>교육 자료 전체 묶음</b><span>원본 PDF를 내려받아 방문 현장에서 활용하세요.</span></div><div class="edu-actions">${eduAction(eduPdf('sheet'),'↓ 어르신용 · 10쪽','만성질환_어르신_교육자료_10종.pdf')}${eduAction(eduPdf('why'),'↓ 간호사용 · 7쪽','만성질환_간호사_근거자료_10종.pdf')}</div></section>
      <div class="edu-catalog-bar"><div class="edu-audience" role="group" aria-label="자료 대상"><button data-edu-audience="sheet" aria-pressed="${EDU.audience === 'sheet'}">어르신·보호자용</button><button data-edu-audience="why" aria-pressed="${EDU.audience === 'why'}">간호사용</button></div><label class="edu-search"><span>자료 검색</span><input id="eduQuery" type="search" placeholder="질환명 또는 키워드 검색" value="${eduText(EDU.query)}" autocomplete="off"></label></div>
      <p class="edu-result" id="eduCount" aria-live="polite" aria-atomic="true"></p><div class="edu-grid" id="eduCards"></div>
      <footer class="edu-library-note">자료 출처: 제공된 만성질환 어르신 교육자료·간호사 근거자료 PDF<br>웹 요약과 원문을 함께 제공합니다. 개인의 치료 목표와 복약·식사·수분 섭취는 담당 의료진의 지시를 따르세요.</footer></div>`;
    eduCards(); return;
  }
  const h = HANDOUTS.find(x => x.id === id); if (!h) return renderEdu();
  S.eduId = h.id;
  const nurse = EDU.audience === 'why';
  const source = eduPdf(EDU.audience) + '#page=' + (nurse ? h.nursePages[0] : h.elderPage);
  box.innerHTML = `<div class="edu-detail${EDU.large ? ' edu-large' : ''}" style="--hc:${h.color}">
    <nav class="edu-detail-nav" aria-label="교육자료 탐색"><button data-ho="">← 전체 자료</button><div class="edu-actions"><button data-edu-size aria-pressed="${EDU.large}">큰 글씨 ${EDU.large ? '켜짐' : '보기'}</button><button id="btnPrint" class="primary">${nurse ? '근거 원문 인쇄' : '안내문 인쇄'}</button></div></nav>
    <div class="edu-detail-heading"><div><span class="edu-eyebrow">만성질환 건강교육 · ${h.number} / 10</span><h2 id="eduDetailTitle" tabindex="-1">${eduText(h.title)}</h2></div><div class="edu-audience" role="group" aria-label="자료 보기"><button data-view="sheet" aria-pressed="${!nurse}">어르신용 안내문</button><button data-view="why" aria-pressed="${nurse}">간호사 근거자료</button></div></div>
    <div class="edu-source-bar"><span>${nurse ? `간호사 근거집 ${h.nursePages.join('–')}쪽` : `어르신 교육자료 ${h.elderPage}쪽 · A4 한 장`}</span><div class="edu-actions">${eduAction(source,'원본 PDF 보기 ↗')}${eduAction(nurse ? eduPdf('why') : `education/${h.id}.pdf`,nurse ? '↓ 근거집 다운로드' : '↓ 이 안내문 다운로드',nurse ? '만성질환_간호사_근거자료_10종.pdf' : `${h.title}_어르신_안내문.pdf`)}</div></div>
    ${nurse ? evidenceHtml(h,source) : handoutHtml(h)}
    <nav class="edu-next" aria-label="다른 질환 자료">${Number(h.number)>1 ? `<button data-ho="${HANDOUTS[Number(h.number)-2].id}">← ${eduText(HANDOUTS[Number(h.number)-2].title)}</button>` : '<span></span>'}${Number(h.number)<10 ? `<button data-ho="${HANDOUTS[Number(h.number)].id}">${eduText(HANDOUTS[Number(h.number)].title)} →</button>` : '<span></span>'}</nav></div>`;
}
function eduParagraph(text) {
  const colon = text.indexOf(':');
  return colon > 0 ? `<b>${eduText(text.slice(0,colon))}</b><span>${eduText(text.slice(colon+1).trim())}</span>` : eduText(text);
}
function handoutHtml(h) {
  return `<article class="handout">
    <header class="edu-sheet-head"><span class="edu-eyebrow">어르신·보호자용 안내문</span><h2>${eduText(h.fullTitle)}</h2><p>${eduText(h.lead)}</p></header>
    <section class="edu-takeaways" aria-label="핵심 실천 요약"><h3>오늘부터 이렇게 실천해요</h3><ul>${h.summary.map(x=>`<li>${eduText(x)}</li>`).join('')}</ul></section>
    <div class="edu-metrics">${h.metrics.map(m=>`<div><span>${eduText(m.label)}</span><b>${eduText(m.value)}</b></div>`).join('')}</div>
    <div class="edu-sheet-body">${h.sections.map(s=>`<section class="ho-sec"><h3>${eduText(s.title)}</h3><ul>${s.items.map(t=>`<li>${eduParagraph(t)}</li>`).join('')}</ul></section>`).join('')}</div>
    <aside class="ho-danger"><h3>${eduText(h.dangerTitle)}</h3><ul>${h.danger.map(x=>`<li>${eduText(x)}</li>`).join('')}</ul></aside>
    ${h.id === 'cad' ? '<p class="edu-urgent">새로 생긴 심한 가슴 통증이나 식은땀·호흡곤란이 있으면 지체 없이 119에 연락하세요. 약을 반복 복용하느라 신고를 늦추지 마세요.</p>' : ''}
    <footer class="edu-sheet-foot"><p>담당 방문간호사: ______________　 연락처: __________________</p><small>출처: 제공된 「만성질환_어르신_교육자료_10종.pdf」 ${h.elderPage}쪽. 상단 ‘핵심 실천’은 웹 요약이며, 아래 본문은 원문을 옮겼습니다.<br>개인의 목표 수치와 치료는 담당 의료진의 지시를 따르세요. 원문 형식의 인쇄는 ‘이 안내문 다운로드’를 이용하세요.</small></footer></article>`;
}
function evidenceHtml(h,source) {
  return `<article class="evidence"><header><span class="edu-eyebrow">방문간호 실무 참고</span><h3>간호사용 근거자료 원문</h3><p>아래에서 제공된 PDF의 해당 질환 부분을 확인하세요. 표·수치·약물 관련 내용은 원문 형식으로 제공합니다.</p></header>
    <div class="edu-pdf-help">${h.nursePages.length > 1 ? `이 질환은 ${h.nursePages.join('–')}쪽에 걸쳐 있습니다. 다음 쪽까지 확인하세요.` : `이 질환은 ${h.nursePages[0]}쪽에서 확인할 수 있습니다.`} 모바일에서 PDF가 보이지 않으면 ‘원본 PDF 보기’를 눌러주세요.</div>
    <object class="edu-pdf" data="${source}" type="application/pdf" aria-label="${eduText(h.title)} 간호사 근거자료 PDF"><p>이 브라우저는 PDF 미리보기를 지원하지 않습니다. <a href="${source}" target="_blank" rel="noopener">간호사 근거집 열기</a></p></object>
    <details class="edu-source-text" ${EDU.large ? 'open' : ''}><summary>해당 질환 원문을 텍스트로 읽기</summary><div class="ev-item"><p>${eduText(h.nurseText)}</p></div></details>
    <p class="edu-evidence-note">출처: 제공된 「만성질환_간호사_근거자료_10종.pdf」 ${h.nursePages.join('–')}쪽. 이 파일에 기재된 참고문헌의 최신 개정 여부는 별도로 검증하지 않았습니다. 임상 적용은 기관 지침과 처방을 우선합니다.</p></article>`;
}
function bindEdu() {
  const box = $('#tab-edu');
  box.addEventListener('input',e=>{if(e.target.id === 'eduQuery'){EDU.query=e.target.value;eduCards();}});
  box.addEventListener('click',e=>{
    const card=e.target.closest('[data-ho]');
    if(card){renderEdu(card.dataset.ho);window.scrollTo(0,0);if(S.eduId)$('#eduDetailTitle').focus({preventScroll:true});else $('#eduQuery').focus({preventScroll:true});return;}
    const audience=e.target.closest('[data-edu-audience]');
    if(audience){EDU.audience=audience.dataset.eduAudience;renderEdu();box.querySelector(`[data-edu-audience="${EDU.audience}"]`).focus();return;}
    const view=e.target.closest('[data-view]');
    if(view && S.eduId){renderEdu(S.eduId,view.dataset.view);box.querySelector(`[data-view="${EDU.audience}"]`).focus();return;}
    if(e.target.closest('[data-edu-reset]')){EDU.query='';renderEdu();$('#eduQuery').focus();return;}
    if(e.target.closest('[data-edu-size]')){EDU.large=!EDU.large;renderEdu(S.eduId);box.querySelector('[data-edu-size]').focus();return;}
    if(e.target.closest('#btnPrint')){
      if(EDU.audience === 'why'){window.open(eduPdf('why')+'#page='+HANDOUTS.find(x=>x.id===S.eduId).nursePages[0],'_blank','noopener');}
      else window.print();
    }
  });
}
