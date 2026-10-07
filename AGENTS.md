<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Floor — 에이전트 작업 규칙

공유오피스 멤버가 평면도(Canvas)에서 빈 공간을 찾아 예약하고, 그 예약에 붙은 채팅·영상 통화로 대화하는 웹 서비스다. 1인 개발 포트폴리오 프로젝트이고, 가칭은 Floor다.

이 파일만 자동으로 읽힌다. 아래 "먼저 읽을 문서"의 파일은 직접 열어서 읽어야 한다.

## 먼저 읽을 문서

작업을 시작하기 전에 해당 문서를 읽는다. 문서끼리 다르면 이 파일, `docs/spec/`, 작업 지시서 순으로 우선하고, 다른 점은 최종 보고에 적는다.

| 파일 | 내용 | 언제 읽나 |
| --- | --- | --- |
| `docs/codex/01-setup.md` | 기본 셋업 작업 지시서 (끝남) | 셋업에서 왜 그렇게 했는지 확인할 때 |
| `docs/codex/02-auth.md` | 가입과 로그인 작업 지시서 (범위, 단계, 완료 기준) | 가입·로그인 작업을 받았을 때 |
| `docs/codex/03-team-join.md` | 일반 회원에서 팀 회원으로 작업 지시서 | 팀 만들기·초대·가입 요청 작업을 받았을 때 |
| `docs/spec/auth.md` | 가입, 로그인, 세션, 운영자 계정, 팀 회원이 되는 세 가지 길 | 인증·세션·팀 가입을 만질 때 |
| `docs/spec/data-model.md` | 테이블, 컬럼, 제약 | DB 스키마·쿼리를 만질 때 |
| `docs/spec/server.md` | Server Actions 규칙, 결과 타입, 데이터 접근 계층, 세션, 메일, 실시간 | 서버 코드를 만질 때 |
| `docs/spec/roles-and-access.md` | 역할 4개, 권한 키, 기본값, 층·공간 접근 범위 | 권한·접근 판정을 만질 때 |
| `docs/spec/floor-plan.md` | 평면도 JSON 형식과 검증 규칙 | 평면도 스키마·렌더러·편집기를 만질 때 |
| `docs/spec/design-tokens.md` | 색, 타이포, 간격, shadcn 변수 매핑 | UI를 만질 때 |
| `docs/design/*.png` | 화면 시안 9장, 다이어그램 4장 | 화면을 만들 때 참고 |
| `docs/jira-issues.md` | Jira 이슈 68개의 키·제목·에픽 사본 | 커밋에 붙일 이슈 키를 찾을 때, 작업 범위를 확인할 때 |

## 기술 스택 (확정)

- Next.js 16 (App Router), React 19, TypeScript strict. 이미 설치된 버전을 유지한다
- Tailwind CSS + shadcn/ui (Radix 기반). 아이콘은 lucide-react
- zod (입력·환경 변수·평면도 JSON 검증), Zustand (클라이언트 상태), @tanstack/react-query (서버 상태)
- PostgreSQL (Neon) + Drizzle ORM
- 인증: Better Auth를 직접 운영한다 (Drizzle 어댑터, 우리 DB에 저장). 구글, GitHub, 이메일·비밀번호
- 테스트: Vitest, Testing Library, Playwright. 컴포넌트 문서: Storybook
- 패키지 매니저: pnpm 12. Node 22 LTS (22.12 이상)
- 배포 대상: Vercel (지금 배포하지는 않는다)

아직 정하지 않은 것: 실시간 서비스(Ably·Pusher 등), 메일 발송 서비스(Resend 등). 이 둘은 인터페이스 뒤에 숨기고 임시 구현만 둔다. 임의로 서비스를 고르거나 SDK를 설치하지 않는다.

## 명령어

아래 스크립트가 모두 동작해야 한다. 이름을 바꾸면 이 표도 고친다.

| 명령 | 하는 일 |
| --- | --- |
| `pnpm dev` | 개발 서버 |
| `pnpm build` | 프로덕션 빌드 |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `next typegen` 후 `tsc --noEmit` |
| `pnpm test` | Vitest (단위 + PGlite 통합 테스트) |
| `pnpm test:e2e` | Playwright |
| `pnpm format` | Prettier |
| `pnpm db:generate` | Drizzle 스키마에서 마이그레이션 SQL 생성 |
| `pnpm db:migrate` | `DATABASE_URL`에 마이그레이션 적용 |
| `pnpm storybook` / `pnpm build-storybook` | Storybook |
| `pnpm admin:create` | 운영자 계정 생성 (지시서 02에서 추가) |

작업을 마치기 전에 `pnpm lint && pnpm typecheck && pnpm test && pnpm build`를 직접 돌려서 통과를 확인한다. 실패하면 고치고, 못 고치면 실패 내용을 그대로 보고한다. 돌리지 않은 검사를 통과했다고 쓰지 않는다.

## 폴더 구조

```
app/                 라우트 (App Router). 화면 로직은 얇게 두고 features/를 부른다
components/ui/       shadcn/ui가 생성한 컴포넌트
components/          여러 기능이 같이 쓰는 조합 컴포넌트
features/<도메인>/   기능별 코드: actions.ts, queries.ts, schema.ts, components/
lib/db/              Drizzle 클라이언트와 스키마 (lib/db/schema/*.ts)
lib/dal/             데이터 접근 계층. DB를 읽고 쓰는 유일한 곳
lib/auth/            Better Auth 인스턴스(auth.ts), 세션 확인 함수(session.ts), 운영자 생성(operators.ts)
lib/email/           메일 발송 인터페이스와 콘솔·메모리 구현, 메일 문구
lib/permissions/     권한 키, 기본값, can(), canAccess()
lib/actions/         Server Action 래퍼와 결과 타입
lib/realtime/        발행·구독 인터페이스
lib/floor-plan/      평면도 zod 스키마와 검증
lib/env.ts           zod로 검증한 환경 변수
drizzle/             생성된 마이그레이션 SQL
scripts/             운영자 계정 생성 같은 명령줄 스크립트
tests/               단위·통합 테스트(tests/unit, tests/db), e2e(tests/e2e)
docs/                명세와 작업 지시서
```

## 반드시 지킬 규칙

서버

- 쓰기는 전부 Server Actions로 한다. 별도 API 서버를 만들지 않는다.
- 첫 화면 데이터는 Server Component에서 `features/*/queries.ts`의 읽기 함수를 불러 읽는다. queries가 `lib/dal`과 `canAccess()`를 쓴다. 읽기에 Server Action을 쓰지 않는다.
- Route Handler는 캐시되는 GET(게시된 평면도 JSON, 이전 메시지), 외부 웹훅, Better Auth(`app/api/auth/[...all]/route.ts`)에만 쓴다. 가입·로그인·로그아웃은 Better Auth가 처리하므로 Server Action 래퍼를 거치지 않는다. 그 밖의 쓰기는 예외가 없다.
- Better Auth를 직접 부르는 곳은 `lib/auth/*`, 위 Route Handler, 브라우저용 인증 클라이언트(`lib/auth/client.ts`)뿐이다. 다른 코드는 `getSession()`, `requireSession()`, `requirePageSession()`, `requireOperatorPage()`만 쓴다.
- 모든 Server Action은 누구나 호출할 수 있는 공개 POST 주소로 취급한다. 순서는 세션 확인 → zod 검증 → 권한 확인 → 실행이고, `lib/actions`의 래퍼로만 만든다.
- 액션은 예외를 던지지 않고 `{ ok: true, data }` 또는 `{ ok: false, code }`를 돌려준다. 코드 목록은 `docs/spec/server.md`에 있다.
- 클라이언트가 보낸 사용자 id, 역할, 소유자 값을 믿지 않는다. 서버가 세션으로 다시 조회한다.
- `lib/db`는 `lib/db`, `lib/dal`, `lib/auth/auth.ts`, `drizzle.config.*`, `tests/db` 안에서만 import한다. ESLint 규칙으로 막아 둔다.
- `import 'server-only'`는 `lib/db/client.ts`, `lib/dal/*`, `lib/auth/auth.ts`, `lib/auth/session.ts`, `lib/auth/operators.ts`, `lib/permissions/context.ts`에만 넣는다. `lib/db/schema/*`(drizzle-kit이 Next.js 밖에서 직접 읽는다)와 순수 함수 파일(`keys.ts`, `defaults.ts`, `can.ts`, `can-access.ts`)에는 넣지 않는다. Vitest에서는 `server-only`를 빈 모듈로 alias한다.
- 권한은 `can()`, 층·공간 접근은 `canAccess()`로만 판정한다. Postgres RLS는 쓰지 않는다.
- 화면에서 버튼을 숨기는 것은 편의일 뿐이고, 실제 차단은 서버에서 한다.

DB

- 스키마 변경은 `lib/db/schema`를 고치고 `pnpm db:generate`로 SQL을 만든다. 이미 커밋된 마이그레이션 파일은 고치지 않는다.
- 부분 유니크 인덱스, CHECK, 순환 FK, gist 인덱스는 Drizzle 스키마에 선언한다. Drizzle로 표현할 수 없는 것(확장 설치, EXCLUDE 제약)만 손으로 쓴 마이그레이션에 넣는다. 제약마다 `tests/db`에 확인하는 테스트를 둔다.
- 예약 겹침은 DB의 EXCLUDE 제약이 최종 방어선이다. 애플리케이션 코드의 사전 검사로 대신하지 않는다.
- id는 uuid, 시간은 `timestamptz`, 예약·점검 시간은 `tstzrange`(`[시작, 끝)`)다. DB는 snake_case, TypeScript는 camelCase다.

UI

- 화면 문구는 한국어 해요체로 쓴다. `<html lang="ko">`.
- 색은 `docs/spec/design-tokens.md`의 토큰만 쓴다. 컴포넌트에 hex 값을 직접 쓰지 않는다.
- 색은 의미가 있을 때만 쓴다. 공간 상태(비어 있음, 사용 중, 내 예약, 점검 중, 전용 공간), 초대의 수락 대기, 강조 버튼 외에는 무채색이다.
- 기본 컴포넌트는 shadcn/ui를 쓴다. 같은 역할의 컴포넌트를 새로 만들지 않는다.
- 키보드로 모든 동작이 가능해야 하고, 포커스 표시를 없애지 않는다. 기본 컨트롤 높이는 44px이고, 더 작은 컨트롤은 누를 수 있는 영역을 44px로 넓힌다.
- 시간과 숫자에는 `tabular-nums`를 쓴다.

코드

- TypeScript `strict`. `any`와 `@ts-ignore`를 쓰지 않는다. 꼭 필요하면 `@ts-expect-error`에 이유를 적는다.
- 식별자, 파일 이름, 커밋 메시지는 영어. 주석은 "왜"가 필요한 곳에만 한국어로 쓴다.
- 파일 이름은 kebab-case, 컴포넌트는 PascalCase, 함수와 변수는 camelCase.
- 환경 변수는 `lib/env.ts`를 통해서만 읽는다. `process.env`는 `lib/env.ts`와 루트 설정 파일(`*.config.*`)에서만 직접 읽는다.
- 새 의존성은 꼭 필요할 때만 추가하고, 추가한 이유를 최종 보고에 적는다.

## Next.js

Cache Components는 활성화하고 React Compiler는 비활성으로 둔다. 세션·쿠키·`params`·`searchParams`를 읽는 UI는 `<Suspense>` 아래에서 실행한다. 세션이나 권한 결과를 읽는 함수에는 `use cache`, `use cache: private`, `use cache: remote` 어느 것도 붙이지 않는다.

레이아웃은 접근을 막는 수단이 아니다. 로그인이 필요한 페이지, `features/*/queries.ts`의 함수, 액션이 각자 세션을 확인한다. `proxy.ts`(Next.js 16에서 `middleware.ts`의 새 이름)는 쿠키 유무로 미리 돌려보내는 용도일 뿐이다.

이 파일 맨 위의 `nextjs-agent-rules` 블록은 Next.js가 관리한다. `next dev`가 다시 써 넣으므로 고치거나 지우지 않는다. Next.js 관련 코드를 쓰기 전에 설치된 버전의 문서(`node_modules/next/dist/docs/`)에서 해당 주제를 찾아 읽는다. 기억에 있는 예전 API(예: `next lint`, 동기 `cookies()`/`params`)를 쓰지 않는다.

Drizzle, Neon 드라이버, shadcn/ui, Storybook, Tailwind도 버전에 따라 설정 방법이 다르다. 공식 문서의 현재 안내를 확인하고, 확인할 수 없으면 추측하지 말고 보고에 적는다.

## 하지 않는 것

- 지시서에 없는 기능 화면, 평면도 렌더러, 채팅, 영상 통화를 만들지 않는다.
- 비밀번호, 세션 토큰, 인증·재설정 링크를 로그나 오류 메시지에 남기지 않는다. 예외는 둘뿐이다: 개발용 콘솔 메일 구현이 메일 본문을 출력하는 것(배포 환경에서는 출력하지 않는다), `pnpm admin:create`가 새로 만든 비밀번호를 표준 출력에 한 번 출력하는 것.
- 비밀 값을 커밋하지 않는다. `.env*`는 `.env.example`만 커밋한다.
- 원격 저장소에 push하거나 배포하지 않는다. 외부 서비스 계정을 만들지 않는다.
- 실제 회사 이름, 실제 공유오피스 도면을 쓰지 않는다. 데이터는 모두 가상이다.
- 테스트를 통과시키려고 테스트를 지우거나 약하게 만들지 않는다.

## Git

- 브랜치는 `main` 하나에서 시작한다. 단계마다 커밋한다.
- 커밋 메시지는 Conventional Commits에 Jira 키를 붙인다. 예: `feat(db): add bookings exclusion constraint (PFQV-10)`
- Jira 키는 작업 지시서의 단계 표에 있다. 키가 여럿이면 표의 첫 번째 키를 쓴다. 지시서가 한 단계의 커밋을 키별로 나누라고 하면 그에 따른다.
- Jira에는 접속하지 않는다. 이슈 목록은 `docs/jira-issues.md`에 사본이 있고, 이슈 상태를 바꾸는 일은 사람이 한다.

## 최종 보고 형식

작업이 끝나면 아래 순서로 짧게 보고한다.

1. 한 것 (단계별로 한 줄씩)
2. 검사 결과 (`lint`, `typecheck`, `test`, `build` 각각의 실제 결과)
3. 지시서와 다르게 한 것과 이유
4. 설치된 주요 패키지 버전
5. 사람이 해야 하는 일 (`.env.local`, `pnpm db:migrate`, OAuth 앱 등록 등)
6. 확인하지 못한 것, 남은 문제
