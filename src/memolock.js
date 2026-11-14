/* 메모 잠금 화면 (호스팅 버전 전용)
 * - 메모는 잠금 암호로 암호화되어 구글에 저장됩니다. 암호·키는 이 창의 메모리에만 있고, 창을 닫으면 다시 잠깁니다.
 * - 이 기기에 생체인증(Face ID·지문·Windows Hello)을 등록하면 암호 대신 쓸 수 있습니다. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const escH = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let state = { setup: false, open: false, bio: { on: false } }, bioOk = null;

  async function refresh() {
    try { state = await SERVER.lockState(); } catch (e) { return; }
    if (bioOk === null) bioOk = await SERVER.bioAvailable();
    paint();
  }
  function paint() {
    const b = $('#btnLock');
    if (b) { b.textContent = state.open ? '🔓 메모 열림' : '🔒 메모 잠김'; b.title = state.open ? '누르면 메모를 다시 잠급니다' : '누르면 잠긴 메모를 엽니다'; b.classList.toggle('lk-open', state.open); }
    const box = $('#lockSet'); if (!box) return;
    const st = !state.setup ? '아직 잠금 암호를 만들지 않았습니다. 메모를 처음 저장할 때 만들게 됩니다.'
      : state.open ? '<b>열림</b> — 이 창을 닫거나 ‘지금 잠그기’를 누르면 다시 잠깁니다.' : '<b>잠김</b> — 메모 내용이 가려져 있습니다.';
    const bio = !bioOk ? '이 기기·브라우저에서는 생체인증을 찾지 못했습니다. 암호로 여세요.'
      : state.bio.on ? '이 기기에 생체인증이 등록되어 있습니다.' : '이 기기에는 생체인증이 등록되어 있지 않습니다.';
    box.innerHTML = `<p style="margin:0 0 6px">${st}</p><p class="hint" style="margin:0 0 8px">${escH(bio)}</p>
      <div class="row">
        ${!state.setup ? '<button id="lkSetup" class="primary">잠금 암호 만들기</button>' : state.open ? '<button id="lkClose">지금 잠그기</button>' : '<button id="lkOpen" class="primary">잠금 풀기</button>'}
        ${state.setup && bioOk && !state.bio.on ? '<button id="lkBioAdd"' + (state.open ? ' class="primary"' : '') + '>이 기기에 생체인증 등록</button>' : ''}
        ${state.bio.on ? '<button id="lkBioDel">이 기기 생체인증 해제</button>' : ''}
        ${state.open ? '<button id="lkAll">예전 메모 모두 잠그기</button>' : ''}
      </div>`;
  }

  // 잠금 풀기·만들기 창. 성공하면 true
  function prompt(reason) {
    return new Promise(resolve => {
      const d = $('#lockDlg'), setup = !state.setup;
      $('#lockTitle').textContent = setup ? '메모 잠금 암호 만들기' : '메모 잠금 풀기';
      $('#lockBody').innerHTML = (reason ? `<p class="hint" style="margin-top:0">${escH(reason)}</p>` : '') + (setup
        ? `<p style="margin-top:0">메모는 이 암호로 잠겨서 구글에 저장됩니다. <b>구글도, Claude도, 만든 사람도 열 수 없습니다.</b></p>
           <div class="warnbox" style="margin-bottom:10px">암호를 잊으면 잠긴 메모는 <b>영영 복구할 수 없습니다.</b> 따로 안전하게 적어 두세요.</div>
           <label class="f">잠금 암호 (8자 이상)<input type="password" id="lockPw" autocomplete="new-password"></label>
           <label class="f" style="margin-top:8px">한 번 더<input type="password" id="lockPw2" autocomplete="new-password"></label>`
        : `${state.bio.on ? '<button type="button" id="lockBio" class="primary" style="width:100%;margin-bottom:12px">생체인증으로 열기 (Face ID·지문)</button>' : ''}
           <label class="f">잠금 암호<input type="password" id="lockPw" autocomplete="current-password"></label>`)
        + '<p id="lockMsg" class="hint" style="color:var(--warn);min-height:1em;margin:8px 0 0"></p>';
      const msg = t => { $('#lockMsg').textContent = t || ''; };
      const done = ok => { d.onclose = null; if (d.open) d.close(); resolve(ok); };
      const busy = on => { $('#lockOk').disabled = on; const bb = $('#lockBio'); if (bb) bb.disabled = on; };
      $('#lockOk').textContent = setup ? '암호 만들기' : '열기'; $('#lockOk').disabled = false;   // 앞 창에서 눌린 상태가 남지 않게
      $('#lockOk').onclick = async () => {
        const pw = $('#lockPw').value;
        if (setup && pw !== $('#lockPw2').value) return msg('두 암호가 다릅니다.');
        busy(true); msg(setup ? '만드는 중…' : '확인 중…');
        try { setup ? await SERVER.lockSetup(pw) : await SERVER.lockUnlock(pw); await refresh(); done(true);
          if (setup && bioOk) toast('잠금 암호를 만들었습니다. 설정 탭에서 이 기기에 생체인증을 등록할 수 있습니다.', 5000); }
        catch (e) { msg(e.message || String(e)); busy(false); }
      };
      const bb = $('#lockBio');
      if (bb) bb.onclick = async () => { busy(true); msg('생체인증을 기다리는 중…');
        try { await SERVER.bioUnlock(); await refresh(); done(true); } catch (e) { msg(e.name === 'NotAllowedError' ? '생체인증이 취소되었습니다. 암호로 여세요.' : (e.message || String(e))); busy(false); } };
      $('#lockCancel').onclick = () => done(false);
      d.onclose = () => resolve(false);
      $('#lockPw').onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); (setup ? $('#lockPw2') : $('#lockOk')).focus(); if (!setup) $('#lockOk').click(); } };
      d.showModal(); if (!bb) $('#lockPw').focus();
    });
  }

  async function openNow(reason) { if (state.open) return true; const ok = await prompt(reason); if (ok) await loadEvents().catch(() => {}); return ok; }

  // 일정 창의 메모 칸: 잠긴 메모면 가리고 '잠금 풀기' 단추
  function syncMemo(d) {
    const f = $('#eventForm'), ta = f.memo, locked = d && (d.memoLock === 'locked' || d.memoLock === 'bad');
    ta.disabled = !!locked; ta.dataset.cipher = locked ? '1' : '';
    ta.placeholder = locked ? (d.memoLock === 'bad' ? '🔒 이 메모는 지금 암호로 열 수 없습니다' : '🔒 잠긴 메모입니다 — ‘잠금 풀기’를 누르면 보입니다') : '본인 확인용 짧은 메모 (상담 내용은 기관 전산시스템에)';
    $('#memoUnlock').hidden = !locked || d.memoLock === 'bad';
  }

  function bind() {
    $('#btnLock').onclick = async () => {
      if (state.open) { SERVER.lockNow(); await refresh(); await loadEvents(); toast('메모를 잠갔습니다.'); }
      else await openNow();
    };
    $('#memoUnlock').onclick = async () => {
      const id = S.editing && S.editing.id; const ok = await openNow(); if (!ok || !id) return;
      const ev = S.events.find(x => x.id === id); if (ev) { $('#eventForm').memo.value = ev.memo || ''; syncMemo(ev); S.editing = ev; }
    };
    $('#lockSet').addEventListener('click', async ev => {
      const t = ev.target.closest('button'); if (!t) return;
      try {
        if (t.id === 'lkSetup' || t.id === 'lkOpen') await openNow();
        else if (t.id === 'lkClose') { SERVER.lockNow(); await refresh(); await loadEvents(); toast('메모를 잠갔습니다.'); }
        else if (t.id === 'lkBioAdd') {
          // 생체인증 창은 버튼을 누른 그 순간에 띄워야 함(사파리 등). 잠겨 있으면 먼저 열고, 한 번 더 누르게 안내
          if (!state.open) { if (await openNow('생체인증을 등록하려면 먼저 암호로 여세요.')) toast('잠금을 풀었습니다. ‘이 기기에 생체인증 등록’을 한 번 더 눌러 주세요.', 6000); return; }
          await SERVER.bioRegister(); await refresh(); toast('이 기기에 생체인증을 등록했습니다. 다음부터 ‘생체인증으로 열기’를 쓸 수 있습니다.', 5000);
        } else if (t.id === 'lkBioDel') {
          SERVER.bioRemove(); await refresh(); toast('이 기기의 생체인증을 해제했습니다. 기기 설정의 암호(패스키) 목록에서 ‘방문건강관리’ 항목도 지울 수 있습니다.', 6000);
        } else if (t.id === 'lkAll') {
          const [a, b] = [addDays(S.today || S.selected, -400), addDays(S.today || S.selected, 400)];
          const r = await run('예전 메모를 잠그는 중…', () => SERVER.lockAll(a, b)); await loadEvents();
          toast(`메모 ${r.done}건을 잠갔습니다.` + (r.long ? ` 200자가 넘는 메모 ${r.long}건은 줄인 뒤 다시 저장하세요.` : ''), 6000);
        }
      } catch (e) { toast(e.name === 'NotAllowedError' ? '생체인증이 취소되었습니다.' : (e.message || String(e)), 6000); }
    });
  }

  window.MEMOLOCK = { refresh, prompt, openNow, syncMemo, isOpen: () => state.open, bind,
    // 저장 전: 새로 쓴 메모가 있는데 잠겨 있으면 먼저 풀기(처음이면 암호 만들기)
    async beforeSave(e) {
      if (!e.memo || e.memoCipher || state.open) return true;
      if (S.editing && S.editing.memoLock === '' && S.editing.memo === e.memo) return true;   // 예전 일반 메모 그대로
      return openNow(state.setup ? '메모를 저장하려면 잠금을 풀어 주세요.' : '메모는 잠금 암호로 잠가서 저장합니다. 처음 한 번 암호를 만들어 주세요.');
    } };
})();
