# 작업 지시서 02 — 가입과 로그인

## 목표

실제 가입과 로그인이 되게 한다. 끝났을 때 아래가 모두 참이어야 한다.

- 일반 회원이 구글, GitHub, 이메일·비밀번호로 가입하고 로그인하고 로그아웃할 수 있다.
- 이메일 가입은 인증 메일의 링크를 눌러야 끝나고, 비밀번호를 잊으면 메일로 재설정할 수 있다.
- 운영자 계정은 스크립트로만 만들 수 있고, 운영자 전용 화면으로 로그인한다.
- `getSession()`이 Better Auth 세션을 읽고, 셋업 때의 데모 세션은 없다.
- 로그인하지 않은 사람은 보호된 화면을 볼 수 없다.

팀 만들기, 초대, 가입 요청은 이 작업에서 만들지 않는다 (지시서 03).

## 시작 전에

1. `AGENTS.md`를 읽는다.
2. `docs/spec/auth.md`를 처음부터 끝까지 읽는다. 이 작업의 기준 문서다.
3. `docs/spec/data-model.md`의 `users`, `auth_sessions, auth_accounts, auth_verifications`, `branches`, `branch_staff`와 `docs/spec/server.md`의 "세션", "메일", "환경 변수"를 읽는다.
4. 설치된 Next.js 문서에서 `01-app/02-guides/authentication-with-cache-components.md`, `authentication.md`와 `proxy` 파일 규칙 문서를 읽는다. 가이드의 `use cache: private` 예시는 따르지 않는다 (`docs/spec/auth.md`).
5. 지금 코드를 읽는다: `lib/auth/`, `lib/env.ts`, `lib/db/schema/users.ts`, `lib/dal/`, `lib/actions/create-action.ts`, `tests/db/helper.ts`, `eslint.config.mjs`, `app/`.
6. `git status`를 확인한다. 커밋되지 않은 변경이 `AGENTS.md`와 `docs/` 아래 문서뿐이면 그것만 먼저 `docs: add auth and team join specs (PFQV-63)`로 커밋하고 시작한다. 다른 파일이 바뀌어 있으면 멈추고 알린다.

## 환경에 대한 전제

- 실제 DB, 구글·GitHub OAuth 앱, 메일 서비스가 없다. 검증은 PGlite와 메모리 메일 구현으로 한다. 실제 OAuth 왕복은 확인할 수 없으므로 "확인 못 함"으로 보고한다.
- Better Auth는 최신 안정 버전을 쓴다 (이 지시서는 1.7.7에서 확인했다). 지시서에 적힌 옵션 이름은 힌트다. 설치한 버전의 공식 문서와 타입 정의에서 다시 확인하고, 이름이 달라도 `docs/spec/auth.md`의 규칙은 지킨다. 확인할 수 없으면 추측하지 말고 멈춰서 알린다.
- 네트워크가 막혀 패키지를 받을 수 없으면 우회하지 말고 승인을 요청한다.
- pnpm은 의존성의 빌드 스크립트를 기본으로 막는다. 새 의존성이 필요로 하면 꼭 필요한 것만 `pnpm-workspace.yaml`의 `allowBuilds`에 넣고 보고에 적는다.

## 범위

| 단계 | 내용 | Jira |
| --- | --- | --- |
| 1 | 스키마 변경과 마이그레이션 | PFQV-63 |
| 2 | 메일 발송 인터페이스 | PFQV-65 |
| 3 | Better Auth 인스턴스, Route Handler, 세션 교체 | PFQV-63 |
| 4 | 화면 보호 | PFQV-63 |
| 5 | 가입과 로그인 화면 | PFQV-64 |
| 6 | 이메일 인증과 비밀번호 재설정 화면 | PFQV-65 |
| 7 | 운영자 계정 스크립트와 운영자 로그인 | PFQV-66 |
| 8 | 문서와 마무리 | PFQV-63 |

단계마다 커밋한다.

## 범위 밖 (하지 않는다)

- 팀 만들기, 초대, 가입 요청, 팀 화면 (지시서 03). `teams`, `team_members`, `team_invites`의 컬럼 변경과 `team_join_requests`도 03에서 한다.
- 데모 계정 원클릭 로그인(PFQV-46), 시드 스크립트(PFQV-14)
- 실제 메일 발송 서비스 연결, 2단계 인증, 패스키, 매직 링크, 구글·GitHub 외의 제공자
- 프로필 수정, 이메일 변경, 계정 삭제, 연결된 로그인 수단 관리 화면
- 평면도, 예약, 채팅 등 다른 기능 화면
- Better Auth의 admin·organization 플러그인. 팀과 운영자는 우리 테이블(`team_members`, `branch_staff`)로 다룬다.

## 단계

### 1. 스키마 변경과 마이그레이션

`docs/spec/data-model.md`를 따른다. 이미 커밋된 마이그레이션은 고치지 않고 새 마이그레이션을 만든다.

- `users`: `auth_id`를 없애고 `email_verified`, `updated_at`을 더한다.
- `auth_sessions`, `auth_accounts`, `auth_verifications`를 더한다. 컬럼은 설치한 Better Auth가 요구하는 것을 따르되, 이름은 snake_case, id는 uuid(기본값 `gen_random_uuid()`), 시간은 `timestamptz`로 맞춘다. Drizzle 속성 이름은 Better Auth의 필드 이름(camelCase)과 같게 둔다. Better Auth의 스키마 생성 CLI 결과는 참고만 하고, 스키마 파일은 `lib/db/schema/auth.ts`에 이 저장소의 방식으로 쓴다.
- `pnpm db:generate`를 다시 돌렸을 때 새 파일이 생기지 않아야 한다.
- `tests/db`에 확인을 더한다: 사용자를 지우면 그 사용자의 세션과 로그인 수단이 같이 지워진다. 같은 `(provider_id, account_id)` 두 개는 들어가지 않는다.
- `auth_id`를 쓰던 코드와 테스트를 정리한다.

### 2. 메일 발송 인터페이스

- `lib/email/types.ts`: `EmailSender` (`docs/spec/auth.md`의 모양 그대로).
- `lib/email/console.ts`: 서버 로그에 받는 사람, 제목, 본문을 출력한다. 본문의 링크가 그대로 보여야 한다. `NODE_ENV`가 `production`이면 출력하지 않고 오류를 던진다 (단위 테스트로 확인).
- `lib/email/memory.ts`: 테스트용. 보낸 메일을 배열에 쌓는다.
- `lib/email/templates.ts`: 이메일 인증, 비밀번호 재설정, 이미 가입된 이메일 안내, 소셜 로그인 연결 안내 네 가지의 제목과 본문을 만드는 순수 함수. 인증 메일에는 "가입한 적이 없으면 링크를 누르지 마세요"를 넣는다. 한국어 해요체, 텍스트만. (팀 초대 템플릿은 03에서 더한다.)
- `lib/email/index.ts`: 기본 발송 구현을 돌려주는 함수와, 지금 메일을 실제로 보낼 수 있는지 알려주는 함수(배포 환경에서 콘솔 구현이면 false).
- 외부 메일 SDK는 설치하지 않는다.

### 3. Better Auth 인스턴스, Route Handler, 세션 교체

파일

- `lib/auth/auth.ts`: `createAuth({ db, email, secret, baseUrl, providers })`로 인스턴스를 만드는 함수와, 실제 값으로 한 번만 만들어 돌려주는 `getAuth()`. import할 때가 아니라 처음 부를 때 만든다.
- ESLint의 `lib/db` import 허용 목록에 `lib/auth/auth.ts` 하나만 더한다.
- `app/api/auth/[...all]/route.ts`: Better Auth 핸들러. 요청이 올 때 `getAuth()`를 부른다.
- `lib/auth/session.ts`: `getSession()`, `requireSession()`을 Better Auth로 다시 구현하고 `requirePageSession(next)`, `requireOperatorPage()`를 더한다. `Session` 타입은 그대로다. `getSession()`은 세션 쿠키가 없으면 `getAuth()`를 부르지 않고 null을 돌려준다. `createSessionCookie`, `clearSessionCookie`, 데모 모드 코드를 지운다. `use cache` 종류는 어느 것도 붙이지 않는다.
- `lib/auth/client.ts`: 브라우저용 인증 클라이언트. `(auth)` 화면과 머리글의 로그아웃 버튼만 쓴다.
- `lib/env.ts`와 `.env.example`: `docs/spec/auth.md`의 "환경 변수"대로 바꾼다. `AUTH_MODE`를 없앤다. 구글이나 GitHub 변수가 한쪽만 있으면 오류, 빈 문자열은 없는 것으로 본다. CI 워크플로의 env도 맞춘다.
- `jose`를 더 쓰지 않으면 의존성에서 뺀다.

설정 (`docs/spec/auth.md`의 "인증 방식"부터 "이메일 인증과 비밀번호 재설정"까지가 기준이다)

- Drizzle 어댑터에 우리 스키마를 넘긴다: `schema: { user: users, session: authSessions, account: authAccounts, verification: authVerifications }`. 필드 매핑의 값은 DB 컬럼 이름이 아니라 Drizzle 속성 이름이다. `image`는 `avatarUrl`에 매핑한다 (`avatar_url`이라고 쓰면 스키마 불일치 오류가 난다).
- id: `advanced.database.generateId: 'uuid'`. `false`는 쓰지 않는다.
- 이메일·비밀번호: 이메일 인증 필수, 가입 때 인증 메일 발송, 인증 전 로그인 시 인증 메일 재발송, 인증 뒤 자동 로그인 없음, 가입 뒤 자동 로그인 없음, 비밀번호 8–128자, 재설정 뒤 세션 전부 끊기와 이메일 인증 처리.
- 이미 계정이 있는 이메일의 가입 요청: 미인증 계정이면 비밀번호 재설정 메일(그 훅 안에서 재설정 요청 API를 부른다), 인증된 계정이면 안내 메일. 응답은 새 가입과 같은 모양.
- 비밀번호가 있는 계정에 소셜 로그인 수단이 처음 연결될 때: 비밀번호 자격 삭제, 세션 전부 끊기, 안내 메일 (1.7.7에서는 account 생성 before 훅으로 된다).
- 구글과 GitHub: 각각 환경 변수가 둘 다 있을 때만. 제공자가 이메일을 미인증으로 알려주면 가입·로그인을 거절한다. 계정 연결은 라이브러리 기본 동작을 쓰고 `requireLocalEmailVerified`, `trustedProviders`는 설정하지 않는다. 오류는 `/login`으로 돌아오게 한다.
- 이름 1–50자(앞뒤 공백 제거)와 `image`가 든 이메일 가입 요청의 거절을 가입 요청 단계의 before 훅에서 강제한다. 사용자 생성 단계의 훅에서 하면 이미 있는 이메일일 때 응답이 달라진다. 소셜 가입의 이름이 비었으면 이메일의 `@` 앞부분을 쓰고 50자로 자른다.
- 쓰지 않는 엔드포인트를 끈다: 프로필 수정, 이메일 변경, 계정 삭제 등. 무엇을 껐는지 보고에 적는다.
- 세션 만료 7일, 갱신 주기 1일. Next.js 쿠키 연동 플러그인은 플러그인 목록의 마지막에 둔다. 요청 제한은 기본값을 쓴다.
- 인증 메일의 링크는 Better Auth가 주는 `url`을 쓰지 않고 `token`으로 직접 만든다. `callbackURL`은 언제나 `/login?verified=1`이다.

테스트 (`tests/db`, PGlite + 메모리 메일)

- 이메일 가입 → 인증 전 로그인 실패 → 메일의 링크로 인증 → 그 응답에 세션 쿠키가 없음 → 비밀번호로 로그인 성공 → `users.email_verified`가 true
- 로그인한 요청의 헤더로 세션을 읽으면 `{ userId, email, name }`이 나온다. 로그아웃 뒤에는 null
- 대문자가 섞인 이메일로 가입해도 소문자로 저장된다
- 같은 이메일(대소문자만 다른 경우 포함)로 다시 가입하면: 응답은 성공 모양이고 id가 uuid 형식이며, `users` 행은 1개이고, 기존 비밀번호가 그대로다. 기존 계정이 미인증이면 재설정 메일이, 인증됐으면 안내 메일이 한 통 쌓인다
- 비밀번호 7자, 빈 이름, 51자 이름, `image`가 든 요청은 거절된다. 이미 있는 이메일로 보내도 새 이메일과 같은 오류가 난다
- 로그인 때 다시 보낸 인증 메일의 링크도 `/login?verified=1`로 돌아온다
- 선점 시나리오 1: 공격자가 피해자 이메일로 가입(미인증) → 피해자가 같은 이메일로 가입 → 피해자가 재설정 메일의 링크로 비밀번호를 정함 → 공격자의 비밀번호로는 로그인되지 않고, 피해자는 추가 인증 없이 새 비밀번호로 로그인된다
- 선점 시나리오 2: 미인증 비밀번호 가입이 있는 이메일로 소셜 로그인 → 거절되고 로그인 수단이 연결되지 않는다
- 선점 시나리오 3: 제공자가 이메일을 미인증으로 알려주는 소셜 로그인 → 사용자도 세션도 생기지 않는다
- 인증된 비밀번호 계정이 있는 이메일로 소셜 로그인 → 같은 사용자에 연결되고, 예전 비밀번호와 예전 세션은 더 쓸 수 없고, 안내 메일이 한 통 쌓인다. 두 번째 소셜 로그인 때는 메일이 나가지 않는다
- 재설정 뒤 예전 세션으로 세션을 읽으면 null

소셜 로그인은 외부 왕복 없이 확인한다. id 토큰으로 로그인하는 경로를 쓰고, 테스트용 인스턴스에서 제공자의 토큰 검증과 사용자 정보 조회를 대체한다. 방법을 찾지 못하면 테스트를 꾸며내지 말고 무엇을 확인하지 못했는지 보고한다.

### 4. 화면 보호

`docs/spec/auth.md`의 "Cache Components와 화면 보호", "next 값 검사", "주소"를 따른다.

- 라우트 그룹: 로그인이 필요 없는 화면 `(auth)`(`/admin/login` 포함), 로그인이 필요한 화면 `(app)`, 운영자 화면 `admin`.
- `(app)` 레이아웃은 정적인 틀(머리글의 "Floor")을 그리고 `{children}`을 `<Suspense>`로 감싼다. 레이아웃에서 세션으로 접근을 막으려 하지 않는다.
- `(app)` 아래의 모든 페이지가 `requirePageSession('<자기 경로>')`를, `admin` 아래의 모든 페이지가 `requireOperatorPage()`를 직접 부른다. `features/*/queries.ts`의 함수도 각자 `requireSession()`으로 확인한다.
- `next` 검사 함수(`lib/auth/safe-next.ts`)와 단위 테스트. 테스트 값은 `docs/spec/auth.md`에 있다.
- `proxy.ts`: 보호된 경로(`(app)`과 `/admin`, 단 `/admin/login` 제외)에 세션 쿠키가 없으면 `/login?next=<경로와 쿼리>`로 보낸다 (`/admin` 아래는 `/admin/login`으로). 쿠키의 유효성은 검사하지 않는다. `/api/auth`, 정적 파일, `(auth)` 화면은 건드리지 않는다. 쿠키가 있다는 이유로 `(auth)` 화면에서 내보내지 않는다.
- `/login`과 `/signup`은 `<Suspense>` 안에서 `getSession()`으로 실제 확인하고, 로그인돼 있으면 `next` 또는 `/`로 보낸다. `/verify-email`, `/forgot-password`, `/reset-password`는 로그인한 상태로도 열린다. `/admin/login`의 동작은 7단계에 있다.
- 머리글: "Floor", 사용자 이름, 로그아웃. 사용자 이름은 `<Suspense>` 아래에서 읽는다. 로그아웃하면 `/login`으로 간다.
- 홈(`/`)은 `(app)` 아래로 옮기고, 지금은 인사말("안녕하세요, {이름}님")만 보여준다. 상태 배지 목록은 지운다. 팀 관련 내용은 03에서 더한다.

### 5. 가입과 로그인 화면

- `/login`: 소셜 버튼(켜진 제공자만), "또는" 구분선, 이메일·비밀번호 양식, "비밀번호를 잊었어요" 링크, "계정 만들기" 링크. `verified`와 `error` 쿼리의 문구는 `docs/spec/auth.md`의 표를 따른다. 쿼리의 값을 화면에 그대로 출력하지 않는다.
- `/signup`: 이름, 이메일, 비밀번호. 소셜 버튼도 같이 둔다. 응답이 성공 모양이면 `/verify-email?email=…`로 간다. 그 이메일이 이미 가입돼 있는지에 따라 화면이 달라지지 않는다.
- 메일을 실제로 보낼 수 없는 환경(2단계의 함수가 false)이면 `/signup`, `/forgot-password`, `/verify-email`은 양식 대신 `docs/spec/auth.md`의 안내 문구를 보여준다. 이 값도 요청 시점에 읽는다.
- 어떤 제공자가 켜져 있는지는 요청 시점에 서버에서 읽어 화면에 내려준다 (`<Suspense>` 안). 클라이언트 번들에 비밀 값이 들어가지 않게 한다.
- `next`는 검사 함수를 거친 값만 쓰고, 로그인 성공 뒤 이동, `/signup` 링크, 소셜 로그인의 `callbackURL`에 이어서 넘긴다.
- 모양: 화면 가운데 폭 400px 카드, 맨 위에 "Floor"와 제목(24/600), 컨트롤 높이 44px. 소셜 버튼은 보조 버튼, 제출 버튼은 강조 버튼. 색은 토큰만 쓴다. 문구는 `docs/spec/auth.md`의 "화면 문구"를 쓴다.
- 양식은 zod로 검사한다 (화면의 검사는 편의이고 서버 훅이 같은 규칙을 강제한다). 오류는 해당 입력 아래에 보여주고 `aria-describedby`로 잇는다. 제출 실패는 `aria-live` 영역으로 알린다. 제출 중에는 버튼을 비활성으로 하고 중복 제출을 막는다.
- 입력에는 알맞은 `autocomplete`(`email`, `current-password`, `new-password`, `name`)와 `type`을 넣는다.
- 로그인 실패 문구는 하나만 쓴다 ("이메일 또는 비밀번호가 맞지 않아요").
- 이메일 인증을 마치지 않은 계정으로 맞는 비밀번호를 넣으면 `/verify-email?email=…`로 안내한다.
- 필요한 shadcn 컴포넌트(`card`, `separator`, `alert` 등)는 shadcn CLI로 더한다.

### 6. 이메일 인증과 비밀번호 재설정 화면

- `/verify-email`: 안내 문구와 "인증 메일 다시 보내기". `?email=`이 있으면 그 주소로 보내고, 없으면 이메일 입력란을 보여준다. 버튼은 누른 뒤 60초 동안 비활성으로 둔다 (실제 제한은 서버가 한다).
- 인증 링크를 누르면 `/login?verified=1`에 도착한다. 링크가 만료됐거나 잘못됐으면 `/login`이 오류 문구와 `/verify-email` 링크를 보여준다.
- `/forgot-password`: 이메일을 받고, 결과와 상관없이 같은 문구를 보여준다.
- `/reset-password`: 메일 링크의 토큰으로 새 비밀번호를 받는다. 끝나면 `/login`으로 보낸다. 토큰이 잘못됐으면 재설정을 다시 요청하게 안내한다.
- 테스트: 재설정 요청 → 메모리 메일의 링크 → 새 비밀번호로 로그인 성공, 예전 비밀번호로 실패. 없는 이메일로 요청해도 같은 응답이고 메일은 나가지 않는다.

### 7. 운영자 계정 스크립트와 운영자 로그인

`docs/spec/auth.md`의 "운영자 계정"을 따른다.

- `lib/auth/operators.ts`: DB와 인증 인스턴스를 주입받아 운영자를 만드는 함수. 사용자 생성과 비밀번호 설정은 인증 인스턴스의 내부 API로 한다 (1.7.7 기준 `auth.$context`의 `password.hash`, `internalAdapter.createUser`, `linkAccount`, `updatePassword`). `auth_accounts`에 직접 쿼리를 쓰지 않는다. `branch_staff`와 지점 조회는 `lib/dal` 함수로 한다.
- 다루는 경우와 테스트(PGlite): 새 계정 생성(인증된 상태, 로그인 가능), 인증된 기존 계정에 지점 추가, 이미 그 지점의 운영자(오류 아님), 미인증 기존 계정은 `--reset-password` 없이 오류, `--reset-password`(비밀번호 교체, 기존 세션 삭제, 인증 처리), 지점 없음 오류, 같은 이름의 지점이 둘이면 오류, `--create-branch`, 대문자 이메일, 7자 비밀번호 거절, 소셜 로그인 수단이 연결된 계정의 경고.
- `scripts/admin-create.ts`와 `pnpm admin:create`: 인자를 읽어 위 함수를 부른다. DB는 `getAuth()`와 DAL의 기본 연결을 쓴다. 환경 변수는 `lib/env.ts`로만 읽고, `.env.local`은 Node의 `--env-file-if-exists`로 불러온다 (dotenv를 추가하지 않는다. `--env-file`은 파일이 없으면 안내 문구를 내기 전에 끝나 버린다). `DATABASE_URL`, `AUTH_SECRET`이 없으면 무엇이 필요한지 알려주고 끝난다. 무작위 비밀번호는 표준 출력에 한 번만 출력한다.
- 스크립트는 Next.js 밖에서 돈다. `server-only`를 import하는 모듈을 Node에서 불러올 수 있게 실행 방법을 정하고(조건 플래그 등) README에 적는다. `server-only`를 지워서 해결하지 않는다.
- `/admin/login`(`(auth)` 그룹): 이메일·비밀번호만. 성공하면 `/admin`으로 간다. 이미 로그인한 운영자가 오면 `/admin`으로 보낸다. 운영자가 아닌 계정으로 로그인된 상태면 "운영자 계정이 아니에요", "홈으로", "다른 계정으로 로그인"(로그아웃)을 보여준다. 자동으로 로그아웃시키지 않는다.
- `/admin`: "운영자 화면"이라는 제목과 내가 운영하는 지점 이름 목록만 보여준다. 로그인하지 않았으면 `/admin/login`, 운영자가 아니면 `/admin/login?error=not_operator`로 보낸다. 이 확인은 페이지와 queries가 직접 한다.
- `lib/dal`에 필요한 함수(운영 지점 조회, 이름으로 지점 찾기 등)를 더한다. `/admin`의 조회는 `features/*/queries.ts`를 거친다.

### 8. 문서와 마무리

- `README.md`: 처음 실행 방법에 `AUTH_SECRET` 만들기, 구글·GitHub OAuth 앱의 콜백 주소, 개발 중 인증 메일의 링크는 서버 로그에서 찾는다는 것, `pnpm admin:create` 사용법을 더한다. 데모 세션 설명은 지운다.
- `AGENTS.md`의 명령어 표(`pnpm admin:create`)와 폴더 구조(`lib/email/`, `scripts/`)는 이미 적혀 있다. 실제로 만든 것과 다르면 고친다.
- `tests/e2e`에 스모크 테스트를 더한다: 로그인하지 않고 `/`에 가면 `/login`이 보인다. `/login?next=https://example.com`으로 들어가도 바깥 주소로 가는 링크나 이동이 없다. Playwright의 `webServer`에는 가짜 `AUTH_SECRET`과 실제로 접속하지 않는 `DATABASE_URL`을 넣는다. 로그인하지 않은 화면은 DB에 접속하지 않아야 이 테스트가 통과한다.

## 완료 기준

직접 실행해서 확인하고, 결과를 보고에 그대로 적는다.

| 확인 | 기준 |
| --- | --- |
| `pnpm lint` | 오류 0 |
| `pnpm typecheck` | 오류 0 |
| `pnpm test` | 전부 통과, 건너뛴 테스트 없음. 2·3·4·6·7단계의 테스트 포함 |
| `pnpm build` | `DATABASE_URL`, `AUTH_SECRET` 없이 성공. Cache Components 관련 오류 없음 |
| `pnpm test:e2e` | 통과. 브라우저를 받을 수 없어 못 돌리면 "확인 못 함" |
| `pnpm db:generate` | 새 마이그레이션 파일이 생기지 않음 |
| `git status` | 깨끗함. 비밀 값이 커밋되지 않음 |
| 데모 세션 | `AUTH_MODE`, `floor_session`, `createSessionCookie`가 코드에 남아 있지 않음 (`rg`로 확인) |
| 비밀 값 | 클라이언트 컴포넌트가 `lib/env.ts`나 OAuth 비밀 값을 import하지 않음 |
| 캐시 | `lib/auth/`, `features/*/queries.ts`에 `use cache`가 없음 (`rg`로 확인) |
| 보호 | `(app)` 아래 모든 `page.tsx`가 `requirePageSession()`을, `admin` 아래 모든 `page.tsx`가 `requireOperatorPage()`를 부름 (목록을 보고에 적는다) |

실제 DB가 없어서 확인하지 못한 것(브라우저에서의 가입·로그인, OAuth 왕복, `pnpm admin:create` 실행)은 "확인 못 함"으로 적고, 사람이 확인할 순서를 보고에 적는다.

## 막혔을 때

- Better Auth가 `users` 테이블 매핑이나 uuid id를 지원하지 않으면, 인증용 user 테이블을 따로 두는 방법으로 바꾸지 말고 멈춰서 알린다. 다른 테이블의 외래 키가 걸려 있는 결정이다.
- `docs/spec/auth.md`의 "계정 연결과 선점 방지" 규칙을 설치한 버전의 옵션으로 만들 수 없으면, 규칙을 약하게 바꾸지 말고 무엇이 안 되는지 알린다.
- Better Auth 어댑터가 PGlite에서 동작하지 않으면, 무엇이 왜 안 되는지 보고하고 테스트를 지우지 않는다.
- 문서끼리 다르면 `AGENTS.md`, `docs/spec/auth.md`, 그 밖의 `docs/spec/`, 이 지시서 순으로 우선한다. 다른 점은 보고에 적는다.
- 스키마, 결과 코드, 주소, 환경 변수 이름처럼 다른 작업이 기대는 이름은 임의로 바꾸지 않는다.

## 최종 보고

`AGENTS.md`의 "최종 보고 형식"을 따른다. "사람이 해야 하는 일"에는 Neon DB에 마이그레이션 적용, `AUTH_SECRET`, OAuth 앱 등록, 운영자 계정 만들기를 순서대로 적는다. Better Auth 설정에서 힌트와 다르게 한 옵션이 있으면 무엇을 왜 바꿨는지 적는다.
