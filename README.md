# 방문건강관리 업무 일정 사이트 — 소스 인수인계

배포 주소: https://dltmdwo369-prog.github.io/vhm/  (GitHub 저장소 `dltmdwo369-prog/vhm`, GitHub Pages)
기존 운영본 기준: 2026-11-13 (사용자가 전달한 마지막 배포 커밋 f5c4c15)

> 디자인 개선 원본과 빌드 결과를 함께 관리하는 저장소입니다. 강서구 연계 안내 공개 카탈로그(2026-11-15 조사자료)를 추가했습니다. 운영·데이터 보존·갱신·롤백 절차는 [연계 안내 문서](docs/REFERRALS.md)를 참고하세요. 현재 접수나 지원 자격을 보장하는 자료는 아닙니다.

PHIS 기록 요청은 [사용·보안·향후 처리기 계약 문서](docs/PHIS_REQUESTS.md)를 참고하세요. 현재는 기기별 암호화 준비 목록이며 PHIS 접속·전송·입력 기능은 없습니다.

캘린더 계정은 유지하면서 Drive 저장 계정만 별도로 연결할 수 있습니다. [계정 분리·기존 자료 복사 안내](docs/DRIVE_ACCOUNT.md)를 참고하세요. 실제 계정 이메일은 공개 소스 대신 브라우저 설정에 저장합니다.

## 한눈에
- 서버 없는 단일 페이지(`site/index.html`). 브라우저에서 사용자의 구글 계정으로 **Google Calendar API·Drive API에 직접** 연결합니다.
- 로그인: OAuth 2.0 암시적 흐름(페이지 이동 방식). `site/config.js`에는 **클라이언트 ID만** 있습니다(비밀 키 아님, 공개 가능).
  - OAuth 클라이언트는 Google Cloud **`jaranda-budget`** 프로젝트에 있음. 승인된 JS 원본 `https://dltmdwo369-prog.github.io`, 리디렉션 URI `https://dltmdwo369-prog.github.io/vhm/`. 동의 화면은 '테스트' 상태(테스트 사용자 = 소유자 계정).
  - 권한: `calendar` + `drive.file`(앱이 만든 파일만).
- 사용자 데이터는 이 저장소에 없습니다. 기존 Google 자료 외에 기기별 암호화 상담 저장본과 PHIS 요청은 브라우저 IndexedDB에도 저장됩니다. PHIS 요청은 Drive 동기화 대상이 아닙니다.

## 폴더 구성
| 경로 | 내용 |
| --- | --- |
| `ui-source/Index.html` | 화면(HTML·CSS·주 스크립트) 원본. 상단 업무 개요와 메모리 내 집계 추가 |
| `ui-source/theme-v2.css` | ChatGPT 디자인 개선판. 빌드 시 최종 스타일로 인라인 삽입, 외부 폰트·이미지·분석 도구 없음 |
| `ui-source/Handouts.html`, `src/education.js`, `data/education.json` | 첨부 PDF 기반 10개 질환 교육자료(검색·대상 전환·큰 글씨·인쇄) |
| `src/gcal-api.js` | 구글 연결 계층: 로그인(`VHM_AUTH`), 캘린더 읽기·쓰기, 메모 잠금 암호화, 완료·기한·미루기·실적 집계·수기 실적 (`window.SERVER`) |
| `src/memolock.js` | 메모 잠금 화면(AES-GCM + PBKDF2, 기기별 생체인증 WebAuthn PRF) |
| `src/memo-images.js` | 일정 메모 이미지 선택·암호화 업로드·잠금 해제 미리보기·첨부 해제. [사용 및 백업 안내](docs/MEMO_IMAGES.md) |
| `src/drive-account.js` | 저장용 Drive 계정 설정·검증, 기존 앱 폴더 복사 미리보기·명시적 복사·재조회 검증 |
| `src/keepalive.js` | 업무시간 연결 유지(만료 전 `prompt=none` 조용한 재로그인) |
| `src/notes.js` | 상담 메모 탭(체크 → 메모 문장 자동 작성, 항목 편집기) |
| `src/phis-model.js`, `src/phis.js` | PHIS 기록 요청·기기별 암호화 대기 목록·검토 관리. 실제 자동화 미연동 |
| `src/consultations.js` | 상담메모의 저장1·저장2… 암호화 기기 저장, 태블릿·컴퓨터 Drive 동기화, 손글씨 필기판. [사용 안내](docs/CONSULTATION_SAVES.md) |
| `src/drugs.js`, `src/supps.js` | 처방약 111종·성분 66종, 영양제 26종 검색 목록 |
| `src/links.js` | 연계 안내 탭(드라이브 `vhm-links.json`) |
| `src/archive.js` | 보관함 탭(드라이브 임시 보관, 7일 후 자동 삭제) |
| `build_site.py` | 위 파일들을 합쳐 `site/index.html` 한 파일로 만듦 (`python3 build_site.py`) |
| `site/` | GitHub Pages 배포용 파일들(`index.html`, `config.js`, `forms/*.pdf`, 별도 페이지 `archive.html`, 선택용 `archive-cleanup.gs`). **ZIP 안의 `index.html`은 수정안이므로 아직 원격 배포본이 아님** |
| `forms-source/sheet1.html`, `sheet2.html` | 인쇄용 설문지 원본(1·2쪽 간이 설문지, 3·4쪽 기초조사표). 크롬 인쇄 → PDF(A4, 여백 없음)로 `site/forms/`의 PDF를 만듦 |
| `tests/` | 기존 4종 회귀 테스트(가짜 구글 서버 + 가상 데이터만)와 추가된 Python `visual-smoke.py`(화면 너비 4종, 네트워크 없이 검사) |
| `preview/` | 가상 데이터만 들어 있는 미리보기 HTML과 PC·모바일 화면 이미지. 실제 계정 연결과 저장 불가 |
| `CHANGELOG_CHATGPT.md` | 개선 사항, 테스트 범위와 배포 전 확인 사항 |
| `docs/` | 기능·규칙 정리 문서(가장 자세함) — 먼저 읽기 권장 |

| `legacy/Code.gs` | 중단된 Apps Script 버전(업무 PC에서 script.google.com이 막혀 중단) |

## 빌드·배포
1. 소스(`ui-source/`, `src/`) 수정
2. `python3 build_site.py` → `site/index.html` 생성 (현재 소스와 재생성 결과의 일치 확인; **원격 배포본과는 다를 수 있음**)
3. `cp site/index.html index.html`로 루트 배포 결과를 동기화합니다. **별도 테스트 후** `site/index.html`을 GitHub 저장소 루트의 `index.html`로 복사·커밋하면 GitHub Pages가 배포. 설정 파일(`config.js`) 등 기존 배포 파일은 유지
- 주의: 예전에 다른 작업자가 GitHub의 `index.html`을 **직접** 고친 적이 있음. 직접 고치면 다음 빌드에서 덮어써지므로, 고칠 내용은 반드시 소스에 반영하고 빌드할 것. **배포 직전 원격 저장소의 변경사항을 확인해 반드시 병합할 것.**

## 테스트 실행
- Node.js 및 시스템 Chromium이 필요합니다. `npm ci` 후 `npm test`로 가짜 Google 서버 회귀 테스트 4종 및 공개 카탈로그 테스트을 실행합니다. 실제 Google 계정과 사용자 데이터는 사용하지 않습니다.
- 테스트는 표준 `playwright` 모듈을 사용하며 브라우저 기본 경로는 `/usr/bin/chromium`입니다. 다른 설치 경로는 `VHM_CHROMIUM`으로 지정합니다.
- 반응형 테스트: 별도 Python 가상환경에 `playwright`를 설치한 뒤 `python3 tests/visual-smoke.py`. 1440/768/390/320px 폭의 레이아웃·집계·탭과 외부 요청 부재를 검사합니다.
- 테스트 스크린샷 등 생성물은 Git에서 제외합니다. `preview/`는 ZIP에 포함된 가상 데이터 시연 자료입니다.

## 구글 캘린더 데이터 구조 (핵심)
- 캘린더: `방문건강관리(업무)`, `방문건강관리(개인)`, `방문건강관리(완료)`(완료 항목 + 실적 수기 조정), `방문건강관리(기한)`(기한 알림용)
- 일정 숨은 칸(`extendedProperties.private`): `vhm_kind`(work/personal/due/adj), `vhm_type`, `vhm_status`, `vhm_target`(가린 이름 김O수), `vhm_birth`(출생연도), `vhm_sex`, `vhm_prio`, `vhm_memo`(잠금 시 `vhm1:` 암호문), `vhm_uid`, `vhm_parent`, `vhm_ptype`, `vhm_done`, `vhm_done_at`, `vhm_prevrem`, `vhm_due*`, `vhm_from`(미루기 전 날짜), `vhm_adj`(수기 실적 JSON)
- 제목 규칙: `[유형] 상태 대상자명` (유형: 신규·방문·전화·내소·연계, 상태: 예정·완료·부재·취소)
- 메모 잠금 정보: 업무 캘린더 설명의 `vhmlock1:` 줄
- 실적 = 업무+완료 캘린더의 '완료' 업무 일정 + 날짜별 수기 조정(`vhm_kind=adj`)

## 꼭 지켜 온 원칙 (사용자 요청)
- 구글에 보내는 업무 일정 정보는 업무 종류·일시 등 **최소한**. 대상자 이름은 두 번째 글자 가림, 생년월일 전체·주민번호·주소·연락처는 넣지 않음(주소 등은 잠긴 메모로만).
- 상담 내용·건강정보·보관함 자료를 **자동으로 외부 전송하지 않음**. 상담 메모 탭의 체크·문장은 저장하지 않음.
- 개발·검증은 **가상 데이터만**.
- 비밀번호·비밀 키를 HTML에 넣지 않고 공식 로그인·권한 승인 방식만 사용.
- 화면·버튼만 만든 상태를 '연동 완료'라고 하지 않고, 실제 기기·계정으로 확인 못 한 것은 그렇다고 밝힘.

## 확인하지 못한 것
- 실제 구글 계정에서의 동작 다수(휴대폰 알림, 완료·기한 캘린더 이동, 수기 실적 저장 등)는 가짜 서버로만 시험함. 업무 PC(Edge)·기관 태블릿·실제 프린터 출력도 미확인.

이 저장소에는 ZIP의 환경 전용 `deploy.sh`를 포함하지 않았습니다. 빌드 결과와 원본 소스를 함께 커밋하고 기존 main 브랜치의 Pages 배포를 사용합니다.

## 웹사이트 내 피드백

사용자용 ‘피드백’과 관리자용 ‘피드백 관리’를 추가했습니다. 공용 Firebase 연결 전에는 접수가 비활성화됩니다. 관리자 계정 지정, Firebase 보안 규칙, 다른 Google 계정 공개 설정 및 검증 범위는 [피드백 운영 안내](docs/FEEDBACK.md)를 참고하세요. 기존 일정·상담 메모는 피드백에 자동 전송하지 않습니다.

피드백 이미지 첨부(최대 3장)와 설정의 기능 토글을 지원합니다. 이미지 저장에는 최신 Firestore 보안 규칙 게시가 필요합니다. 기능 토글은 데이터 삭제 없이 메뉴를 숨기며, 현재 브라우저에서 Google 계정별로 유지됩니다. 자세한 동작은 [사용할 기능 설정](docs/FEATURES.md)을 참고하세요.

## 강서구 연계 안내

공개자료 69건(상담 및 연계 가능 48·담당기관 확인 필요 21)을 로그인 없이 검색합니다. 개인 Drive 목록은 별도로 보존하며, 명시적 선택·백업·확인 후에만 병합합니다. 신규 구현은 `src/referral-model.js`, `src/links.js`, `data/public-referrals.json`을 기준으로 빌드합니다. 상세 사용법·스키마 및 미검증 사항은 [docs/REFERRALS.md](docs/REFERRALS.md)에 있습니다.

## 교육자료 (2026-11-15 개편)

‘교육자료’는 제공된 어르신용 10쪽 PDF와 간호사용 7쪽 PDF를 바탕으로 10개 질환을 제공합니다. 이전 직장류·저나트륨혈증 별도 항목 대신 원본의 변비·배변장애 및 탈수·전해질 영역으로 정리했습니다.

- `data/education.json`: 질환명·검색어·웹 요약·어르신용 본문·간호사 원문 발췌와 원본 페이지 매핑. 본문은 PDF 줄바꿈만 정리했으며 핵심 실천 요약은 별도로 표시합니다.
- `education/`: 첨부 원본 2개와 질환별 단일 페이지 PDF 10개. 빌드 시 `site/education/`에 복사합니다. 루트와 `site/` 어디서 배포해도 상대경로로 작동합니다.
- 간호사용 화면은 해당 페이지의 원본 PDF와 접어서 볼 수 있는 텍스트 발췌를 제공합니다. 큰 글씨를 선택하면 텍스트를 펼칩니다. 임상 지침의 최신 개정 여부를 별도로 검증한 자료는 아닙니다.
- `tests/test-education.js`: 로그인 없는 탐색, 검색, 대상 전환, PDF 다운로드, 4개 화면 폭에서 10개 자료의 배치, 출력 문서 생성을 검증합니다. 생성된 검사용 PDF는 저장소 밖의 작업 디렉터리에 둡니다.

개인별 목록·공문/양식 등록 및 다른 사용자에게 공유할 안내문은 [개인별 사용 안내](docs/PERSONAL_USE.md)를 참고하세요. 일반 이용에는 GitHub 계정·ChatGPT 유료 구독이 필요하지 않습니다. 개인 저장에는 본인 Google 계정과 앱 연결 권한이 필요합니다.

상담 메모에서 체크 후 **체크 항목으로 연계 보기**를 누르거나 연계 안내 탭으로 이동하면 관련 요구가 자동 선택됩니다. 연결 기준·개인정보 보호·다음 대상자 초기화는 [상담 메모 자동 연계 안내](docs/NOTE_REFERRALS.md)를 참고하세요.
