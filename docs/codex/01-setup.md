# 작업 지시서 01 — 기본 셋업

## 목표

이 저장소를 "기능 개발을 바로 시작할 수 있는 상태"로 만든다. 끝났을 때 아래가 모두 참이어야 한다.

- Next.js 프로젝트가 뜨고, 린트·타입 검사·테스트·빌드가 통과한다.
- 디자인 토큰이 들어간 shadcn/ui 기본 컴포넌트와 Storybook이 있다.
- `docs/spec/data-model.md`의 테이블이 Drizzle 스키마와 마이그레이션으로 있고, 핵심 제약이 테스트로 확인된다.
- Server Action 래퍼, 세션 인터페이스, `can()`/`canAccess()`, 실시간 인터페이스, 평면도 zod 스키마가 뼈대로 있고 단위 테스트가 있다.

기능 화면은 만들지 않는다.

## 시작 전에

1. `AGENTS.md`를 읽는다.
2. `docs/spec/`의 문서 5개를 모두 읽는다.
3. `docs/design/floor-main.png`, `floor-style.png`를 본다 (톤 확인용). 이미지를 열 수 없으면 `docs/spec/design-tokens.md`만으로 진행하고 보고에 적는다.
4. 저장소의 현재 상태를 확인한다. `create-next-app`으로 만든 프로젝트가 이미 있고 커밋이 하나 있다 ("Initial commit from Create Next App"). `AGENTS.md`와 `docs/`가 커밋되지 않은 상태면 먼저 `docs: add handoff specs (PFQV-9)`로 커밋한다.

## 환경에 대한 전제

- 네트워크가 막혀 있으면 패키지 설치가 실패한다. 그때는 우회하지 말고 멈춰서 승인을 요청한다. 필요한 곳은 npm 레지스트리, shadcn 레지스트리, (받을 수 있다면) Playwright 브라우저 내려받기다.
- 실제 Neon DB에는 접속하지 않는다. `DATABASE_URL`은 없다고 가정한다. DB 관련 검증은 전부 PGlite로 한다.
- Next.js와 React는 이미 설치된 버전(Next.js 16.3.8, React 19.2.8)을 유지한다. 올려야 할 이유가 생기면 올리지 말고 보고에 적는다. 새로 넣는 도구는 최신 안정 버전을 쓰고, 설치 방법은 공식 문서의 현재 안내를 따른다. Next.js는 `node_modules/next/dist/docs/`의 문서를 기준으로 한다.
- 패키지 매니저는 pnpm 12다 (`packageManager` 필드). pnpm은 의존성의 빌드 스크립트를 기본으로 막고 `pnpm-workspace.yaml`의 `allowBuilds`로 허용한다. 새 의존성이 빌드 스크립트를 필요로 하면(예: esbuild) 꼭 필요한 것만 허용하고, 허용한 목록을 보고에 적는다.

## 범위

| 단계 | 내용 | Jira |
| --- | --- | --- |
| 1 | 기존 Next.js 프로젝트 정리와 도구 설정 | PFQV-9 |
| 2 | shadcn/ui, 디자인 토큰, Storybook | PFQV-13 (일부) |
| 3 | 환경 변수, 앱 뼈대 | PFQV-9 |
| 4 | Drizzle 스키마와 마이그레이션, 제약 테스트 | PFQV-10, PFQV-56, PFQV-57 (테이블) |
| 5 | 서버 뼈대: 결과 타입, 액션 래퍼, 세션, 데이터 접근 계층 | PFQV-52, PFQV-11 (일부) |
| 6 | 권한: `can()`, `canAccess()` | PFQV-56, PFQV-57 (판정 함수) |
| 7 | 실시간 인터페이스 | PFQV-54 (인터페이스만) |
| 8 | 평면도 zod 스키마와 예시 | PFQV-12 |
| 9 | CI, README, 마무리 | PFQV-9 |

단계마다 커밋한다. 커밋 메시지 규칙은 `AGENTS.md`에 있다.

## 범위 밖 (하지 않는다)

- 평면도 렌더러, 예약 타임라인, 채팅, 영상 통화, 운영자 화면 등 모든 기능 화면
- 실제 인증 연결(Neon Auth), 실제 실시간 서비스 연결, LiveKit, 파일 업로드
- 시드 스크립트(PFQV-14), 예약 한도 검사(PFQV-62), 평면도 게시 검증의 기하 검사(PFQV-41)
- 배포, 원격 저장소 push, 외부 서비스 계정 생성
- 다크 모드 색 확정

## 단계

### 1. 기존 Next.js 프로젝트 정리와 도구 설정

프로젝트는 이미 만들어져 있다. `create-next-app`을 다시 돌리지 않는다.

지금 상태

- Next.js 16.3.8, React 19.2.8, App Router, TypeScript(`strict`), ESLint flat config(`eslint-config-next`), import alias `@/*`, `src/` 디렉터리 없음, pnpm 12
- Tailwind CSS는 들어 있지 않다. 스타일은 `app/globals.css`와 `app/page.module.css`다.
- Cache Components는 `cacheComponents: true`로 활성화한다. React Compiler는 비활성으로 둔다. 세션을 읽는 UI는 `<Suspense>` 아래에 둔다.
- `AGENTS.md` 맨 위에 Next.js가 관리하는 블록이 있고, `CLAUDE.md`는 `@AGENTS.md` 한 줄이다. 둘 다 그대로 둔다.

할 일

- Tailwind CSS를 공식 문서의 "기존 Next.js 프로젝트에 추가" 방법으로 넣는다 (2단계의 shadcn/ui가 필요로 한다).
- 템플릿 잔재를 정리한다: `app/page.module.css`, `public/`의 템플릿 svg, Geist 글꼴 설정, 템플릿 README 내용. `app/favicon.ico`는 둔다.
- `package.json`: `engines.node`(22.12 이상)를 넣고, 스크립트를 `AGENTS.md`의 명령어 표와 같게 맞춘다. `name`과 `packageManager`는 그대로 둔다.
- `.nvmrc`에 22.
- TypeScript: `strict`에 더해 `noUncheckedIndexedAccess`를 켠다.
- Prettier와 Tailwind 클래스 정렬 플러그인. ESLint와 충돌하지 않게 설정한다.
- ESLint 규칙 추가. flat config의 `files`별 설정으로 만든다.
  - `@/lib/db`(와 하위 경로)는 `lib/db/**`, `lib/dal/**`, `drizzle.config.*`, `tests/db/**`에서만 import 가능 (`no-restricted-imports`)
  - `process.env`는 `lib/env.ts`와 루트 설정 파일(`*.config.*`)에서만 (`no-restricted-properties` 또는 같은 효과의 규칙)
- Vitest: 단위 테스트는 `tests/unit`, DB 테스트는 `tests/db`. 기본 환경은 `node`이고 컴포넌트 테스트(`*.test.tsx`)만 jsdom + Testing Library를 쓴다. `pnpm test`는 `vitest run`(watch 아님)이다. `server-only`는 빈 모듈로 alias한다.
- Playwright: 설정 파일과 스모크 테스트 1개(`/`가 뜨고 제목이 보인다). 브라우저 바이너리를 받을 수 없으면 설정까지만 하고 보고에 적는다.

### 2. shadcn/ui, 디자인 토큰, Storybook

- shadcn/ui를 공식 문서의 현재 방법으로 초기화한다. Nova 프리셋, Radix 베이스, CSS 변수 방식, 컴포넌트 위치는 `components/ui`.
- `docs/spec/design-tokens.md`의 값을 shadcn 변수와 추가 토큰(공간 상태)으로 넣는다. 토큰 이름은 그 문서에 정해진 대로 쓰고, Tailwind 유틸리티로 쓸 수 있어야 한다 (예: `bg-status-free`, `text-status-busy-foreground`, `border-status-mine-border`). README에 표로 적는다.
- 글꼴은 Pretendard. `next/font/local` 또는 패키지로 넣고 레이아웃 이동(CLS)이 없게 한다.
- shadcn 컴포넌트 추가: `button`, `badge`, `input`, `label`, `switch`, `tabs`, `tooltip`, `dialog`, `dropdown-menu`, `select`, `sonner`.
- 버튼은 시안의 3종(강조, 보조, 글자만)과 높이 44px 기본이 되게 variant를 맞춘다.
- `components/status-badge.tsx`: 상태 6개(`free`, `busy`, `mine`, `maintenance`, `restricted`, `pending`)를 받는 배지. 색만으로 구분하지 않게 글자를 항상 포함하고, `restricted`에는 자물쇠 아이콘을 넣는다.
- Storybook을 Next.js Vite(`@storybook/nextjs-vite`), docs-only 방식으로 설정한다. 스토리: 색 토큰 표, 타이포, Button, StatusBadge. Tailwind와 글꼴이 Storybook에서도 적용돼야 한다. 컴포넌트 스토리는 컴포넌트 옆 `*.stories.tsx`, 토큰·타이포 스토리는 `stories/`에 둔다.
- Storybook 초기화에서 테스트 연동 기능(Vitest 애드온, Chromatic 등)은 넣지 않는다. `pnpm test`가 Storybook에 기대지 않게 한다.

### 3. 환경 변수, 앱 뼈대

- `lib/env.ts`: zod로 검증. 변수 목록은 `docs/spec/server.md`의 표. `DATABASE_URL`이 없어도 빌드와 테스트가 통과해야 하므로, DB 클라이언트는 처음 쓸 때 만들고 그때 없으면 분명한 오류를 낸다. `parseEnv(source)`를 내보내서 `process.env`를 건드리지 않고 테스트한다.
- `.env.example`에 변수 이름과 설명 주석.
- `app/layout.tsx`: `<html lang="ko">`, 글꼴, 메타데이터(제목 "Floor"), 전역 Provider.
- `app/providers.tsx`: TanStack Query Provider, `sonner` Toaster, TooltipProvider만 넣는다. QueryClient는 요청마다 새로 만들고 브라우저에서는 하나를 유지하는 공식 패턴을 따른다. 테마 전환은 만들지 않는다.
- `app/page.tsx`: 임시 페이지. 제목 "Floor", 한 줄 설명, `StatusBadge` 6개. 기능은 없다.
- Zustand는 설치만 하고, 스토어는 만들지 않는다.

### 4. Drizzle 스키마와 마이그레이션

- 테이블 16개와 enum을 `docs/spec/data-model.md` 그대로 만든다. 파일은 도메인별로 나눈다 (`lib/db/schema/branches.ts`, `spaces.ts`, `bookings.ts`, `chat.ts`, `teams.ts`, `access.ts`, `users.ts` 등)과 `index.ts`.
- `tstzrange`는 Drizzle 커스텀 타입으로 만든다. TypeScript 쪽 값은 `{ start: Date; end: Date }`이고 경계는 `[)`로 고정한다. 직렬화·역직렬화 테스트는 `tests/db`에 둔다 (`lib/db`를 import하므로).
- Drizzle로 선언할 수 있는 것은 스키마에 선언한다: 부분 유니크 인덱스, CHECK, 순환 FK, gist 인덱스. 제약 이름은 `docs/spec/data-model.md`에 적힌 대로 쓴다.
- 손으로 쓰는 마이그레이션은 두 가지뿐이다. drizzle-kit의 custom 마이그레이션으로 만든다.
  1. `CREATE EXTENSION IF NOT EXISTS btree_gist` — 테이블을 만드는 마이그레이션보다 앞 번호여야 한다. `space_blocks`의 gist 인덱스도 이 확장이 필요하다.
  2. 예약 EXCLUDE 제약 (`bookings_no_overlap`).
- 손으로 쓴 파일에 문장이 둘 이상이면 문장 사이에 `--> statement-breakpoint`를 넣는다. 없으면 PGlite 마이그레이터가 실패한다.
- `drizzle.config.ts`, `pnpm db:generate`, `pnpm db:migrate`. `db:generate`를 다시 돌렸을 때 새 파일이 생기지 않아야 한다 (스키마와 마이그레이션이 일치).
- `lib/db/client.ts`: Neon 드라이버 연결. 대화형 트랜잭션이 되는 방식을 고른다 (`docs/spec/server.md`의 "DB 연결").
- `tests/db`: PGlite에 마이그레이션을 그대로 적용하는 헬퍼를 만들고, `docs/spec/data-model.md`의 "테스트로 확인할 제약" 10개를 각각 테스트로 쓴다.
  - PGlite에서 `btree_gist`는 `@electric-sql/pglite/contrib/btree_gist` 확장으로 켠다.
  - PGlite에서 동작하지 않는 문장이 있으면 테스트를 지우지 말고, 무엇이 왜 안 되는지 보고한다.

### 5. 서버 뼈대

`docs/spec/server.md`를 따른다.

- `lib/actions/result.ts`: `ActionResult`, `ActionErrorCode`, `ActionError` 클래스.
- `lib/actions/create-action.ts`: 래퍼. 순서(세션 → zod → 권한 → 실행)와 오류 변환을 단위 테스트로 확인한다. `authorize`를 빼면 타입 오류가 나야 한다.
- 오류 변환은 가짜 오류 객체만으로 검증하지 않는다. `tests/db`에 PGlite + Drizzle로 실제 겹치는 예약을 넣어서 변환 함수가 `BOOKING_CONFLICT`를 내는 테스트를 1개 둔다 (SQLSTATE가 `cause` 안쪽에 있다).
- `lib/auth/session.ts`: `getSession()`, `requireSession()`, `createSessionCookie()`, `clearSessionCookie()`. `AUTH_MODE=demo`일 때만 동작한다. 쿠키 형식은 `docs/spec/server.md`의 "세션"대로. 직접 암호 로직을 만들지 않는다. 로그인 액션과 화면은 만들지 않는다.
- `lib/dal/`: DB 클라이언트를 주입받는 구조와 `withTransaction(fn)`을 정하고, 예시로 아래 함수만 만든다. PGlite로 테스트한다.
  - `getUserById(id)`
  - `getMemberships(userId)` → `{ teams: { teamId, role }[], staffBranchIds: string[] }`
  - `getRoleSettings(branchId)` → 역할별 권한·한도 (행이 없으면 빈 결과)
  - `getSpaceForAccess(spaceId)` → 공간, 층(access, branchId), 두 단계의 허용 팀 id 목록
- 예시 액션은 만들지 않는다. 래퍼의 사용 예는 테스트와 README에 둔다.

### 6. 권한

`docs/spec/roles-and-access.md`를 따른다.

- `lib/permissions/keys.ts`: 권한 키 14개와 역할 4개를 리터럴 유니온 타입으로 (`PermissionKey`, `Role`).
- `lib/permissions/defaults.ts`: 역할별 기본 권한과 기본 한도.
- `lib/permissions/can.ts`: `PermissionContext`, `heldRoles()`, `can()`. DB를 부르지 않는 순수 함수.
- `lib/permissions/can-access.ts`: `canAccess()`, `canAccessFloor()`. 순수 함수.
- `lib/permissions/context.ts`: 세션에서 판정에 필요한 ctx를 만드는 로더 (`lib/dal`을 부른다).
- 단위 테스트
  - `defaults.ts`: 역할이 더해 주는 권한 4 × 14 표가 문서와 같은지
  - `can()`: 소속 없는 사람, 팀원, 팀 관리자, 운영자 × 권한 14개 (가진 역할의 합집합 기준)
  - 지점 `role_settings`가 한 역할의 기본값만 덮어쓰는 경우, 저장된 값에 없어도 `operator`의 `roles.manage`가 유지되는 경우
  - 한 사람이 A팀 관리자이자 B팀 팀원일 때 대상 팀에 따라 결과가 달라지는 경우
  - `canAccess()`: `docs/spec/roles-and-access.md`의 판정 예시 표 9행 × 소속 4가지 전부, 그리고 운영자(해당 지점, 다른 지점)

### 7. 실시간 인터페이스

- `lib/realtime/types.ts`: `RealtimeEvent`(`docs/spec/server.md`에 적힌 판별 유니온 4종 그대로), `RealtimePublisher`, `RealtimeSubscriber`.
- `lib/realtime/channels.ts`: 채널 이름 헬퍼.
- `lib/realtime/noop.ts`(기본 구현)와 `lib/realtime/memory.ts`(테스트용).
- 외부 SDK는 설치하지 않는다.

### 8. 평면도 zod 스키마

`docs/spec/floor-plan.md`를 따른다.

- `lib/floor-plan/schema.ts`: 문서 스키마와 타입(`FloorPlanDocument`). "스키마에서 바로 검사" 항목을 모두 구현한다.
- `lib/floor-plan/issues.ts`: `PlanIssue` 타입만.
- 테스트: `docs/spec/examples/gangnam-7f.plan.json`은 통과, 문서에 적힌 실패 사례 4가지는 각각 실패. `gangnam-7f.spaces.json`과의 교차 검사(모든 `spaceId`가 목록에 있고 좌석은 `type = 'desk'`)도 테스트로 둔다.

### 9. CI, README, 마무리

- `.github/workflows/ci.yml`: pnpm 설치(캐시), `lint`, `typecheck`, `test`, `build`. Playwright는 CI에 넣지 않는다.
- `README.md`: 프로젝트 한 줄 소개, 필요한 것(Node, pnpm), 처음 실행 방법, 명령어 표, 폴더 구조, 토큰 유틸리티 이름 표, 액션 래퍼 사용 예, DB 마이그레이션을 Neon에 적용하는 방법.
- `AGENTS.md`의 명령어 표와 폴더 구조가 실제와 다르면 고친다. 아직 만들지 않은 폴더(`features/` 등)와 규칙은 지우지 않는다.
- `.gitignore`에 `.env*`(`.env.example` 제외), Storybook·Playwright 산출물.

## 완료 기준

아래를 직접 실행해서 확인하고, 결과를 보고에 그대로 적는다.

| 확인 | 기준 |
| --- | --- |
| `pnpm lint` | 오류 0 |
| `pnpm typecheck` | 오류 0 |
| `pnpm test` | 전부 통과, 건너뛴 테스트 없음. DB 제약 10개 항목, 권한 테스트, 액션 래퍼 테스트, 평면도 스키마 테스트 포함 |
| `pnpm build` | `DATABASE_URL` 없이 성공 |
| `pnpm db:generate` | 새 마이그레이션 파일이 생기지 않음 |
| `pnpm build-storybook` | 성공 |
| `git status` | 깨끗함. 비밀 값과 `.env.local`이 커밋되지 않음 |
| ESLint 규칙 | `app/`에서 `@/lib/db`를 import하면 린트 오류가 남 (확인 뒤 되돌린다) |

`pnpm dev`를 띄워 `/`가 보이는지도 확인한다. 확인할 수 없었던 항목은 통과했다고 쓰지 말고 "확인 못 함"으로 적는다.

## 막혔을 때

- 문서끼리 다르거나 빠진 것이 있으면 가장 단순한 쪽으로 정하고, 정한 내용과 이유를 보고의 "지시서와 다르게 한 것"에 적는다.
- 스키마, 권한 키, 결과 코드처럼 다른 작업이 기대는 이름은 임의로 바꾸지 않는다.
- 도구 설정이 공식 문서와 달라 실패하면, 실패한 명령과 오류를 그대로 남긴다.

## 최종 보고

`AGENTS.md`의 "최종 보고 형식"을 따른다.
