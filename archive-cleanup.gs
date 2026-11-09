/**
 * (선택) 임시 보관함 서버측 자동 삭제 — 페이지를 열지 않아도 지우고 싶을 때만 사용
 *
 * 사용법: script.google.com(맥북·아이폰 등 접속 가능한 기기)에서 새 프로젝트 → 이 코드 붙여넣기
 *  → 왼쪽 '서비스(+)'에서 'Drive API'(고급 서비스, v3) 추가
 *  → cleanupArchive 를 한 번 실행해 권한 승인 → 트리거(시계 아이콘)에서 매일 1회 실행으로 등록
 *
 * 동작: '방문건강관리 임시보관함' 폴더 안에서 만료 시각(appProperties.vhm_exp)이 지났거나,
 *       만료 값이 없으면 생성 후 7일이 지난 파일을 영구 삭제(휴지통 거치지 않음).
 * 주의: 실제 계정에서 아직 검증하지 못했습니다. 처음에는 DRY_RUN=true로 로그만 확인하세요.
 */
var DRY_RUN = true;
var FOLDER_NAME = '방문건강관리 임시보관함';
var KEEP_MS = 7 * 24 * 3600 * 1000;

function cleanupArchive() {
  var folders = DriveApp.getFoldersByName(FOLDER_NAME);
  var now = Date.now(), removed = 0;
  while (folders.hasNext()) {
    var folderId = folders.next().getId();
    var pageToken = null;
    do {
      var res = Drive.Files.list({
        q: "'" + folderId + "' in parents and trashed=false",
        fields: 'nextPageToken, files(id,name,createdTime,appProperties)',
        pageSize: 200,
        pageToken: pageToken
      });
      (res.files || []).forEach(function (f) {
        var exp = f.appProperties && Number(f.appProperties.vhm_exp);
        if (!(exp > 0)) exp = new Date(f.createdTime).getTime() + KEEP_MS;
        if (exp <= now) {
          Logger.log((DRY_RUN ? '[삭제 예정] ' : '[삭제] ') + f.name);
          if (!DRY_RUN) Drive.Files.remove(f.id);
          removed++;
        }
      });
      pageToken = res.nextPageToken;
    } while (pageToken);
  }
  Logger.log('만료 파일 ' + removed + '개 ' + (DRY_RUN ? '(시험 실행: 실제 삭제 안 함)' : '삭제함'));
}
