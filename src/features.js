/* Feature visibility is local to this browser and Google account. Never deletes data. */
(function () {
  'use strict';
  const items = [
    ['cal','일정','업무·개인 일정과 실적'],
    ['note','상담 메모','상담 메모 작성과 복사'],
    ['link','연계 안내','지원 서비스 검색과 개인 목록'],
    ['box','보관함','Google Drive 임시 파일 보관'],
    ['edu','교육자료','질환별 안내문과 인쇄 자료'],
    ['feedback','피드백','의견 접수와 처리 상태 확인']
  ];
  let account = '', prefs = {}, notice = '';
  const key = () => 'vhm-features:v1:' + encodeURIComponent(account || 'guest');
  const enabled = id => !items.some(x => x[0] === id) || prefs[id] !== false;
  function destination(id) { return enabled(id) ? id : (items.find(x => enabled(x[0])) || ['set'])[0]; }
  function apply() {
    for (const [id] of items) {
      const b = document.querySelector('[data-tab="' + id + '"]');
      if (b) b.hidden = !enabled(id);
    }
    const selected = document.querySelector('.tabs [aria-selected="true"]');
    if (selected && !enabled(selected.dataset.tab)) showTab(destination(selected.dataset.tab));
  }
  function render() {
    const el = document.getElementById('featureSettings'); if (!el) return;
    el.innerHTML = '<h3>사용할 기능</h3><p class="hint">사용하지 않는 기능은 메뉴에서 숨길 수 있습니다. 다시 켜면 그대로 이용할 수 있으며 저장된 데이터는 삭제되지 않습니다.</p><p class="hint">이 브라우저에서 ' + (account ? '로그인 계정별로' : '로그인 전 설정으로') + ' 저장됩니다. 설정 메뉴는 항상 표시됩니다.</p><div class="feature-list">' + items.map(([id,label,desc]) => '<label class="feature-row"><span><b>' + label + '</b><span class="hint">' + desc + '</span></span><span class="feature-control"><span data-feature-state="' + id + '">' + (enabled(id) ? '켜짐' : '꺼짐') + '</span><input type="checkbox" role="switch" data-feature="' + id + '" aria-label="' + label + ' 기능" ' + (enabled(id) ? 'checked' : '') + '><span class="feature-track" aria-hidden="true"></span></span></label>').join('') + '</div><p id="featureNotice" class="hint" role="status"></p>';
    document.getElementById('featureNotice').textContent = notice;
    el.querySelectorAll('[data-feature]').forEach(input => input.onchange = () => {
      const id = input.dataset.feature, previous = prefs[id]; prefs[id] = input.checked;
      try { localStorage.setItem(key(), JSON.stringify(prefs)); notice = '기능 설정을 저장했습니다.'; }
      catch (_) { prefs[id] = previous; notice = '이 브라우저에서 설정을 저장할 수 없습니다. 저장 공간과 브라우저 설정을 확인해 주세요.'; }
      apply(); render();
      const replacement = el.querySelector('[data-feature="' + id + '"]'); if (replacement) replacement.focus();
    });
  }
  function setAccount(email) {
    account = String(email || '').trim().toLowerCase(); prefs = {}; notice = '';
    try { const data = JSON.parse(localStorage.getItem(key()) || '{}'); if (data && typeof data === 'object' && !Array.isArray(data)) for (const [id] of items) if (typeof data[id] === 'boolean') prefs[id] = data[id]; } catch (_) {}
    apply(); render();
  }
  const style = document.createElement('style');
  style.textContent = '.feature-settings{margin:0 0 24px;padding-bottom:20px;border-bottom:1px solid var(--line)}.feature-list{display:grid;gap:0}.feature-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0;border-bottom:1px solid var(--line);cursor:pointer;min-width:0}.feature-row>span:first-child{min-width:0;overflow-wrap:anywhere}.feature-row .hint{display:block;margin-top:3px}.feature-control{display:flex;align-items:center;gap:8px;position:relative;flex:none;font-size:12px;color:var(--sub)}.feature-control input{position:absolute;right:0;width:44px;height:26px;margin:0;opacity:0;cursor:pointer;z-index:1}.feature-track{display:block;width:44px;height:26px;border:1px solid #84968e;border-radius:20px;background:#7d8d85;pointer-events:none;position:relative}.feature-track:after{content:"";position:absolute;width:18px;height:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:transform .15s}.feature-control input:checked+.feature-track{background:var(--accent);border-color:var(--accent)}.feature-control input:checked+.feature-track:after{transform:translateX(18px)}.feature-control input:focus-visible+.feature-track{outline:3px solid #78bba7;outline-offset:3px}.tabs button[hidden]{display:none}';
  document.head.appendChild(style);
  const connect = document.getElementById('featuresConnect');
  if (connect) {
    connect.disabled = !(window.VHM_CONFIG && VHM_CONFIG.clientId);
    connect.onclick = () => VHM_AUTH.request('base');
  }
  window.FEATURES = {enabled, destination, setAccount};
  let email = ''; try { if (window.VHM_AUTH && VHM_AUTH.valid()) email = localStorage.getItem('vhm-email') || ''; } catch (_) {}
  setAccount(email);
})();
