// 가짜 구글 로그인 페이지 (페이지 이동 방식). 요청을 기록하고, 승인된 권한을 쌓아 가며 #access_token 으로 돌려보냄.
const A = { log: [], granted: new Set(), driveOk: true, deny: false, silentFail: false, revoked: 0, origin: null };
async function install(page) {
  await page.route('https://accounts.google.com/o/oauth2/v2/auth**', r => {
    const u = new URL(r.request().url()); const q = u.searchParams;
    const want = (q.get('scope') || '').split(' ');
    A.log.push({ scope: q.get('scope'), prompt: q.get('prompt'), hint: q.get('login_hint'), redirect: q.get('redirect_uri'), rt: q.get('response_type'), igs: q.get('include_granted_scopes') });
    const back = q.get('redirect_uri');
    if (A.origin && !back.startsWith(A.origin)) return r.fulfill({ status: 400, body: 'redirect_uri_mismatch' });
    let frag;
    if (q.get('prompt') === 'none' && A.silentFail) frag = 'error=login_required&state=' + q.get('state');
    else if (A.deny) frag = 'error=access_denied&state=' + q.get('state');
    else {
      want.forEach(s => { if (s.indexOf('drive') >= 0 && !A.driveOk) return; A.granted.add(s); });
      frag = 'access_token=tok' + Date.now() + '&token_type=Bearer&expires_in=3599&scope=' + encodeURIComponent(Array.from(A.granted).join(' ')) + '&state=' + q.get('state');
    }
    return r.fulfill({ status: 302, headers: { location: back + '#' + frag } });
  });
  await page.route('https://oauth2.googleapis.com/revoke**', r => { A.revoked++; A.granted.clear(); return r.fulfill({ status: 200, body: '' }); });
}
/** 버튼을 누르면 구글로 갔다가 돌아오는 것까지 기다림 */
async function connectVia(page, selector) {
  await Promise.all([page.waitForURL(/#access_token|#error|localhost:\d+\/$/, { timeout: 15000 }).catch(() => {}), page.click(selector)]);
  await page.waitForLoadState('domcontentloaded');
}
module.exports = { A, install, connectVia };
