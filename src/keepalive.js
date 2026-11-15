/* =====================================================================
 * 업무시간 연결 유지
 * - 구글이 주는 연결(토큰)은 1시간이면 끝남. 끝나기 몇 분 전에, 업무시간이고 작성 중인 내용이 없으면
 *   구글 화면 없이(prompt=none) 조용히 다시 연결하고 같은 탭·날짜로 돌아옴.
 * - 이 브라우저에서 구글 로그인이 살아 있어야 함. 안 되면 예전처럼 '구글 계정으로 연결' 버튼을 보여 줌.
 * - 설정은 기기마다(이 브라우저) 저장.
 * ===================================================================== */
(function () {
  'use strict';
  const KEY = 'vhm-keep', RESUME = 'vhm-resume', FAIL = 'vhm-silent-fail', LEAD_MS = 8 * 60e3;
  const def = { on: true, from: '08:00', to: '19:00', weekdays: true };
  const pad = n => String(n).padStart(2, '0');
  function cfg() { try { return Object.assign({}, def, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return Object.assign({}, def); } }
  function setCfg(p) { const c = Object.assign(cfg(), p); try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {} return c; }
  function inHours(d) {
    d = d || new Date(); const c = cfg(); if (!c.on) return false;
    if (c.weekdays && (d.getDay() === 0 || d.getDay() === 6)) return false;
    const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    return hm >= c.from && hm < c.to;
  }
  function failedRecently() { try { return Date.now() - (+sessionStorage.getItem(FAIL) || 0) < 30 * 60e3; } catch (e) { return false; } }
  // 다시 연결하면 페이지를 새로 읽으므로, 저장 안 된 작성 내용이 있으면 미룸
  function busyReason() {
    if (document.querySelector('dialog[open]')) return '열려 있는 창';
    const N = window.NOTES && NOTES._state;
    const has = x => x != null && (typeof x === 'object' ? ('name' in x ? String(x.name || '').trim() !== '' : Object.keys(x).length > 0) : String(x).trim() !== '');
    if (N && (N.edited || (N.extra || '').trim() || Object.values(N.pick || {}).some(v => Array.isArray(v) ? v.some(has) : has(v)) || Object.values(N.lead || {}).some(v => String(v || '').trim()))) return '상담 메모';
    const L = window.LINKS && LINKS._state; if (L && L.checks && L.checks.size) return '연계 안내 체크';
    if (window.ARCHIVE && ARCHIVE.busy()) return '보관함 파일 올리기·내려받기';
    if (window.FEEDBACK && FEEDBACK.busy()) return '피드백 작성·이미지 첨부';
    try { if (typeof ADJ !== 'undefined' && ADJ.dirty()) return '저장 안 한 수기 실적'; } catch (e) {}
    const a = document.activeElement; if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.value) return '입력 중';
    return '';
  }
  function curTab() { const b = document.querySelector('.tabs button[aria-selected="true"]'); return b ? b.dataset.tab : 'cal'; }
  function refreshNow() {
    try {
      sessionStorage.setItem(RESUME, JSON.stringify({ tab: curTab(), selected: S.selected, cursor: S.cursor && S.cursor.toISOString(), y: window.scrollY, at: Date.now() }));
    } catch (e) {}
    if (window.SERVER && SERVER.lockStash) SERVER.lockStash();
    VHM_AUTH.request('base', { silent: true });
  }
  let warned = false;
  function tick() {
    if (!window.VHM_AUTH || !VHM_AUTH.canSilent() || !inHours() || failedRecently()) return;
    const left = (VHM_AUTH.exp || 0) - Date.now();
    if (VHM_AUTH.token && left > LEAD_MS) { warned = false; return; }
    const why = busyReason();
    if (!why) { refreshNow(); return; }
    if (!warned) { warned = true; toast(`구글 연결 시간이 곧 끝납니다. 하던 작업(${why})을 마치면 자동으로 다시 연결합니다.`, 6000); }
  }
  // 처음 열 때: 연결이 없고 업무시간이면 바로 조용히 연결 시도. 시도했으면 true
  function autoStart(rr) {
    if (rr && rr.silentFailed) { try { sessionStorage.setItem(FAIL, String(Date.now())); } catch (e) {} return false; }
    if (VHM_AUTH.valid() || !VHM_AUTH.canSilent() || !inHours() || failedRecently()) return false;
    refreshNow(); return true;
  }
  // 다시 연결해서 돌아왔을 때 원래 화면으로
  async function resume() {
    let r = null; try { r = JSON.parse(sessionStorage.getItem(RESUME) || 'null'); sessionStorage.removeItem(RESUME); } catch (e) {}
    if (window.SERVER && SERVER.lockResume && (await SERVER.lockResume()) && window.MEMOLOCK) { await MEMOLOCK.refresh(); await loadEvents().catch(() => {}); }
    if (!r || Date.now() - r.at > 10 * 60e3) return;
    if (r.selected) S.selected = r.selected;
    if (r.cursor) { const c = new Date(r.cursor); if (!isNaN(c)) { const cur = S.cursor; S.cursor = c; if (!cur || cur.getTime() !== c.getTime()) await loadEvents().catch(() => {}); } }
    render(); if (r.tab && r.tab !== 'cal') showTab(r.tab);
    setTimeout(() => window.scrollTo(0, r.y || 0), 50);
  }
  function settingsHtml() {
    const c = cfg();
    return `<label class="row" style="gap:8px"><input type="checkbox" id="kaOn"${c.on ? ' checked' : ''}> 업무시간에는 구글 연결을 자동으로 유지</label>
      <div class="row" style="gap:8px;margin-top:6px;flex-wrap:wrap"><label class="row" style="gap:6px">시작 <input type="time" id="kaFrom" value="${c.from}" step="600"></label>
        <label class="row" style="gap:6px">끝 <input type="time" id="kaTo" value="${c.to}" step="600"></label>
        <label class="row" style="gap:6px"><input type="checkbox" id="kaWk"${c.weekdays ? ' checked' : ''}> 평일만</label></div>
      <p class="hint" style="margin:6px 0 0">구글 연결은 1시간이면 끝납니다. 이 시간 안에는 끝나기 몇 분 전에 구글 화면 없이 조용히 다시 연결하고, 보던 탭과 날짜로 돌아옵니다. 메모 잠금도 열린 상태로 유지됩니다.
        상담 메모를 쓰고 있거나 창이 열려 있으면 다 마칠 때까지 기다립니다. 이 브라우저에서 구글 로그인이 풀려 있으면 예전처럼 버튼을 눌러야 합니다. 기기(브라우저)마다 따로 정합니다.</p>`;
  }
  function bindSettings() {
    const box = document.getElementById('keepSet'); if (!box) return;
    box.innerHTML = settingsHtml();
    box.addEventListener('change', () => {
      const c = setCfg({ on: document.getElementById('kaOn').checked, from: document.getElementById('kaFrom').value || def.from, to: document.getElementById('kaTo').value || def.to, weekdays: document.getElementById('kaWk').checked });
      toast(c.on ? `연결 유지: ${c.weekdays ? '평일 ' : ''}${c.from}~${c.to}` : '연결 유지를 껐습니다.');
    });
  }
  window.KEEP = { cfg, setCfg, inHours, busyReason, tick, autoStart, resume, bindSettings, refreshNow };
  setInterval(tick, 30e3);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
})();
