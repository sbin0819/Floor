# Codex에게 맡기는 방법

이 폴더는 Codex에게 작업을 넘길 때 쓰는 자료다. 사람이 읽는 안내는 이 파일 하나이고, 나머지는 Codex가 읽는다.

## 들어 있는 것

| 파일 | 누가 읽나 | 내용 |
| --- | --- | --- |
| `/AGENTS.md` | Codex (자동) | 스택, 명령어, 폴더 구조, 꼭 지킬 규칙, 보고 형식 |
| `docs/codex/01-setup.md` | Codex | 기본 셋업 작업 지시서. 9단계와 완료 기준 |
| `docs/spec/data-model.md` | Codex | 테이블 16개, 제약, 테스트할 제약 10개 |
| `docs/spec/server.md` | Codex | Server Actions 규칙, 결과 코드, 세션, 실시간 인터페이스 |
| `docs/spec/roles-and-access.md` | Codex | 역할 4개, 권한 키 14개, `can()`, `canAccess()` 판정표 |
| `docs/spec/floor-plan.md` | Codex | 평면도 JSON 형식과 검증 규칙 |
| `docs/spec/design-tokens.md` | Codex | 색·타이포·간격, shadcn 변수 매핑 |
| `docs/spec/examples/` | Codex | 강남점 7층 예시 평면도와 공간·팀·허용 팀 목록 (테스트용) |
| `docs/design/` | Codex | 화면 시안 9장, 다이어그램 4장 |
| `docs/jira-issues.md` | Codex | Jira 이슈 62개의 키·제목·에픽 사본. Codex는 Jira에 접속하지 않아서 이 파일로 이슈 키를 찾는다 |

Codex는 `AGENTS.md`만 자동으로 읽는다. 나머지 문서는 `AGENTS.md`의 표와 아래 프롬프트가 읽으라고 시킨다.

## 실행

1. 터미널에서 이 저장소 폴더(`~/project/FE/portfolio/floor`)로 이동해 Codex를 실행한다.
2. 아래 프롬프트를 그대로 붙여 넣는다.
3. 패키지 설치 단계에서 네트워크 접근 승인을 요청하면 허용한다. npm 레지스트리, shadcn 레지스트리, Playwright 브라우저 내려받기에 필요하다.

```text
docs/codex/01-setup.md의 작업을 수행해줘.

시작하기 전에 AGENTS.md와 docs/spec/의 문서 5개를 모두 읽고, 계획을 단계별로 짧게 보여준 뒤 진행해.
단계마다 커밋하고, 각 단계가 끝나면 그 단계에서 돌린 검사 결과를 한 줄로 알려줘.
지시서의 "범위 밖" 항목은 만들지 마.
끝나면 "완료 기준" 표의 명령을 전부 직접 실행하고, AGENTS.md의 "최종 보고 형식"대로 보고해.
실행하지 못한 검사는 통과했다고 쓰지 말고 "확인 못 함"이라고 적어줘.
```

작업이 길어서 한 번에 끝나지 않으면 "지시서의 N단계부터 이어서 해줘"로 이어 간다.

## Codex가 끝낸 뒤 직접 할 일

1. Neon에서 프로젝트를 만들고 연결 문자열을 받는다.
2. `.env.example`을 `.env.local`로 복사하고 `DATABASE_URL`, `AUTH_MODE=demo`, `AUTH_SECRET`을 채운다.
3. `pnpm db:migrate`로 마이그레이션을 적용한다. `btree_gist` 확장은 Neon이 지원하고, 마이그레이션이 켠다.
4. `pnpm dev`로 띄워 본다.
5. GitHub 저장소를 만들고 push한다. CI가 도는지 확인한다.
6. 끝난 단계의 Jira 이슈 상태를 바꾼다. Codex는 Jira를 건드리지 않는다.

## 결과를 볼 때 확인할 것

Codex의 보고만 믿지 말고 아래는 직접 본다.

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build`가 내 컴퓨터에서도 통과하는가
- `drizzle/`의 마이그레이션에 예약 EXCLUDE 제약과 부분 유니크 인덱스가 실제로 들어 있는가
- `tests/db`에 제약 10개 항목의 테스트가 있고, 건너뛴(`skip`) 테스트가 없는가
- `app/` 아래 파일이 `@/lib/db`를 직접 import하지 않는가
- 컴포넌트에 hex 색이 직접 쓰이지 않았는가
- 지시서에 없는 의존성이 늘지 않았는가 (`package.json`)

## 이 자료에서 새로 정한 것

기획서와 명세에 없던 내용을 셋업에 필요해서 정했다. 마음에 들지 않으면 Codex에게 넘기기 전에 해당 문서를 고치면 된다.

| 정한 것 | 어디에 | 이유 |
| --- | --- | --- |
| ORM은 Drizzle, UI는 shadcn/ui + Tailwind, 패키지 매니저는 pnpm | `AGENTS.md` | 확정된 결정 |
| `users` 테이블을 앱이 직접 갖고 인증 계정은 `auth_id`로만 연결 | `data-model.md` | 인증을 바꿔도 외래 키가 유지되고, 데모·시드 계정을 만들기 쉬움 |
| 층마다 published 평면도도 1개만 (부분 유니크 인덱스) | `data-model.md` | 게시 트랜잭션의 실수를 DB가 막음 |
| `team_invites.email`은 비워 둘 수 있음 | `data-model.md` | 시안에 이메일 초대와 링크 초대가 둘 다 있음 |
| 권한 키 14개의 이름 | `roles-and-access.md` | 기본 권한표의 14행에 이름을 붙임 |
| 역할은 "더해 주는 권한"만 갖고, 가진 역할의 권한을 합쳐서 판정 | `roles-and-access.md` | 시안의 "일반 사용자 권한은 기본으로 포함" |
| 지점이 없는 판정(팀 채널, 팀원 관리)은 기본값 사용 | `roles-and-access.md` | 팀을 지점에 묶을지 아직 미정 |
| `canAccess()`는 층과 공간의 허용 팀이 겹치는 부분만 허용 | `roles-and-access.md` | 데이터가 잘못 저장돼도 접근이 넓어지지 않음 |
| 실제 인증 대신 데모 세션(서명된 쿠키)만 구현 | `server.md` | Neon Auth 연결은 다음 작업으로 분리 |
| Next.js와 React는 만들어 둔 버전(16.3.8, 19.2.8)을 유지, Cache Components 활성화 | `01-setup.md` | 세션을 읽는 UI는 `<Suspense>` 아래에 둠. React Compiler는 비활성으로 유지하고 Tailwind는 추가함 |
| `space_type`에서 `fixture`를 뺌 | `data-model.md` | 코어·계단 같은 고정물은 평면도 JSON에만 있고 `spaces` 행이 없음 |
| 좌석 행이 있는 데스크 구역은 예약 불가 | `data-model.md` | 구역과 좌석을 같은 시간에 따로 예약하는 일을 DB가 막지 못함 |
| 예약·점검 구간의 경계 `[)`를 CHECK로 강제 | `data-model.md` | 경계가 다르면 맞닿은 예약이 겹침으로 잡힘 |
| 배경 도면의 저장소 키는 `floor_plans.background_image`에만 둠 | `floor-plan.md` | 문서와 컬럼 두 곳에 있던 것을 하나로 |
| "사용 중"은 다른 사람의 예약이 진행 중일 때. 내 예약이 진행 중이면 "내 예약" | `design-tokens.md` | 판정 순서만으로는 내 진행 중 예약이 어떻게 보일지 정해지지 않았음 |
| 테스트용 DB는 PGlite | `01-setup.md` | 실제 DB 없이 제약을 검증. Codex 환경에 DB가 없음 |

## 다음 작업 후보

셋업이 끝나면 같은 형식으로 지시서를 이어서 만든다.

| 순서 | 작업 | Jira |
| --- | --- | --- |
| 02 | 시드 스크립트와 역할별 데모 계정 로그인 | PFQV-14, PFQV-46 |
| 03 | 평면도 렌더러 (카메라, 레이어, 히트 테스트) | PFQV-2 |
| 04 | 팀 만들기·초대·전환, 역할과 권한 화면 | PFQV-58 ~ PFQV-61 |
| 05 | 예약 타임라인과 예약 액션 | PFQV-3, PFQV-62 |
