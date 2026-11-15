# 웹사이트 내 피드백

공유할 기존 주소: https://dltmdwo369-prog.github.io/vhm/

사용자는 Google 계정으로 연결한 후 ‘피드백’에서 의견을 보내고 자신의 피드백·상태·관리자 답변을 확인합니다. 최초 상태는 **접수**입니다. 관리자는 **피드백 관리**에서 전체 의견을 확인하고 **접수 / 미해결 / 해결완료**와 답변을 저장합니다. 상태는 사용자가 새로고침하거나 탭을 다시 열면 갱신됩니다.

피드백에 입력한 제목·내용·분류·로그인 이메일만 공용 저장소에 저장합니다. 기존 Calendar·Drive 데이터는 계속 각 사용자 계정에 있으며 피드백에 자동 첨부하지 않습니다. 이메일 발송 기능은 없습니다. 관리자 로그인 계정은 `dltmdwo369@gmail.com`, 추후 이메일 알림을 추가할 경우 수신 희망 주소는 `iseungjae9590@gmail.com`입니다.

## 운영 연결 (프로젝트 소유자 콘솔 작업)

이 저장소를 수정하는 환경에는 Google Cloud/Firebase 콘솔에 로그인해 관리할 수 있는 도구나 관리 자격 증명이 없습니다. 아래 작업을 프로젝트 소유자가 완료하기 전에는 피드백 접수가 활성화되지 않습니다. 기존 일정 기능은 영향을 받지 않습니다.

1. [Firebase 콘솔](https://console.firebase.google.com/)에서 Google Cloud 프로젝트 **jarandabudget-542c5**을 선택해 Firebase를 추가합니다. 새 프로젝트를 별도로 만들 필요는 없습니다.
2. 프로젝트 설정 → 일반 → 웹 앱 추가. 공개 `apiKey`와 `projectId`를 확인합니다. `feedback/config.example.js`처럼 **루트 `config.js`와 `site/config.js` 모두**에 `VHM_CONFIG.feedback`를 추가합니다. 기존 Calendar OAuth `clientId`를 유지합니다. 서비스 계정 비밀 키는 웹사이트에 넣지 않습니다.
3. Authentication → Sign-in method → Google 제공업체를 활성화합니다. Authorized domains에 `dltmdwo369-prog.github.io`를 추가합니다. 기존 Calendar OAuth 클라이언트(README 참조)를 Google 제공업체의 웹 SDK 설정에서 사용하여 동일한 클라이언트 토큰을 허용합니다. Firebase의 기본 웹 클라이언트와 다를 경우 ‘외부 프로젝트의 클라이언트 ID 허용’ 목록에도 기존 Calendar OAuth 클라이언트를 등록합니다. 프로젝트가 같아도 실제 토큰 교환이 성공하는지 확인합니다.
4. Firestore Database를 **기본 데이터베이스 `(default)`**, 운영 모드로 만듭니다. 데이터 보관 지역을 선택합니다. Rules에 `feedback/firestore.rules` 전체를 게시합니다. 테스트 모드의 공개 읽기/쓰기를 사용하지 않습니다. Indexes에는 `feedback/firestore.indexes.json`과 같은 복합 색인(authorId 오름차순, createdAt 내림차순)을 추가하고 준비 완료를 기다립니다. Firebase CLI를 사용하는 경우 `cd feedback` 후 `firebase deploy --only firestore --project jarandabudget-542c5`로 게시할 수 있습니다.
5. 설정을 적용한 웹사이트에서 기존 Google 연결을 해제하고 다시 연결합니다. 이번에는 계정 확인용 `openid email profile`도 요청합니다. 관리자 계정 `dltmdwo369@gmail.com`으로 연결하면 ‘피드백 관리’ 탭이 나타납니다. 별도 관리자 등록 작업은 없습니다. 서버 규칙에서 정확히 이 이메일인 검증된 Google 계정만 관리자 권한을 허용합니다.
6. 일반 계정으로 접수 → 관리자 상태 변경·답변 → 일반 계정에서 새로고침을 확인합니다. 다른 일반 계정이 남의 글을 조회하거나 상태를 변경할 수 없는지도 확인합니다.

## 다른 Google 계정에 공개

사이트 URL 공개와 Google API 이용 승인은 별도입니다. README 기준 OAuth 동의 화면은 테스트 상태입니다. [Google Auth Platform](https://console.cloud.google.com/auth/overview?project=jarandabudget-542c5)의 Audience에서 외부 사용자 설정을 확인하세요. 시범 운영은 Test users에 사용할 계정을 추가합니다. 불특정 사용자 공개는 프로덕션 게시 및 Calendar 민감 권한에 필요한 Google 검증을 진행해야 합니다. 승인되지 않은 계정도 사용할 수 있다고 안내하지 않습니다. 기존 원본과 redirect URI는 유지합니다.

## 보안과 검증 범위

- Firebase는 기존 Google OAuth access token을 Google 제공업체 로그인으로 교환합니다. Firebase 토큰은 이 페이지 메모리에만 유지하고 Google 연결 해제 시 지웁니다. refresh token은 저장하지 않습니다.
- Firestore 규칙은 검증된 Google 계정만 허용합니다. 일반 사용자는 본인 글만 조회·접수할 수 있고, 관리자만 상태와 답변을 수정합니다. 원문·작성자·접수 시각 변경 및 삭제는 허용하지 않습니다.
- 서버 시각으로 접수·수정 시각을 기록합니다. 동시 수정은 updateTime 전제조건으로 막고, 전송 재시도는 동일 문서 ID를 사용합니다.
- 한 번에 50건을 조회하고 ‘더 불러오기’를 제공합니다. 상태 필터는 현재 불러온 항목에 적용됩니다.
- `node tests/test-feedback.js`는 가상 Firebase REST 응답으로 화면, 계정 분리, 초기 접수 상태, 관리자 변경 요청, 로그아웃, 실패·중복 전송 방지를 검사합니다. 실제 Firebase 권한 강제는 콘솔에 규칙을 게시한 후 두 계정으로 확인해야 합니다. 가상 REST 검사가 실제 보안 규칙 배포나 실제 계정 검증을 대신하지 않습니다.
- 개인정보나 일정·상담 내용은 테스트 데이터로 사용하지 않습니다.

## 보안 규칙 회귀 검사

로컬 Firestore Emulator를 `--project_id demo-vhm --rules feedback/firestore.rules --host 127.0.0.1 --port 8787`로 실행한 후 `FIRESTORE_EMULATOR_HOST=127.0.0.1:8787 node tests/test-feedback-rules.cjs`를 실행합니다. 실제 규칙 엔진에서 계정 간 격리, 관리자만 상태 변경, 관리자 권한 자기 부여 차단, 위조 작성자·초기 상태·길이 제한을 검사합니다. 테스트는 localhost만 허용하며 운영 데이터베이스에 연결하지 않습니다.
