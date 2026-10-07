# Floor

공유오피스 멤버가 평면도에서 공간을 찾아 예약하고, 예약에 붙은 채팅과 영상 통화로 대화하는 서비스예요.

현재는 기능 개발을 위한 기본 셋업이에요. 첫 화면에는 소개와 상태 배지 6개가 있고, 서버·DB·권한·평면도 검증 기반을 갖췄어요. 별도 API 서버, 예약·채팅·영상 화면, 로그인 화면·액션, 시드 데이터, 실제 인증·실시간 서비스 연결은 아직 없어요.

## 시작하기

Node 22 LTS(22.12 이상)와 pnpm 12.8.1이 필요해요. `.nvmrc`는 Node 22, `package.json`의 `packageManager`는 pnpm 12.8.1을 지정해요. Next.js 16.3.8과 React 19.2.8은 기존 버전을 유지해요.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

[http://localhost:3000](http://localhost:3000)에서 첫 화면을 확인해요. 이 화면과 빌드·테스트·마이그레이션 생성에는 `.env.local`이나 실제 DB가 필요하지 않아요.

## 명령어

| 명령                   | 하는 일                                                  |
| ---------------------- | -------------------------------------------------------- |
| `pnpm dev`             | Next.js 개발 서버                                        |
| `pnpm build`           | 프로덕션 빌드                                            |
| `pnpm start`           | 빌드한 앱 실행                                           |
| `pnpm lint`            | ESLint와 DB·환경 변수 접근 경계 검사                     |
| `pnpm typecheck`       | `next typegen` 후 `tsc --noEmit`                         |
| `pnpm test`            | Vitest 단위·컴포넌트·PGlite 통합 테스트, watch 없이 실행 |
| `pnpm test:e2e`        | Chromium으로 첫 화면 스모크 테스트                       |
| `pnpm format`          | Prettier로 파일과 Tailwind 클래스 정렬                   |
| `pnpm db:generate`     | Drizzle 스키마에서 새 마이그레이션 생성                  |
| `pnpm db:migrate`      | 설정한 실제 DB에 미적용 마이그레이션 실행                |
| `pnpm storybook`       | 포트 6006에서 Storybook 실행                             |
| `pnpm build-storybook` | `storybook-static/`에 문서 빌드                          |

E2E를 처음 실행할 때는 브라우저를 설치해요.

```sh
pnpm exec playwright install chromium
pnpm build
pnpm test:e2e
```

## 구조와 개발 규칙

```text
app/                     라우트, 레이아웃, 전역 Provider
components/ui/           shadcn Nova + Radix 기본 컴포넌트
components/              StatusBadge 등 공용 조합 컴포넌트와 스토리
features/<domain>/       향후 기능의 actions.ts, queries.ts, schema.ts, components/
lib/actions/             ActionResult, ActionError, createAction, 오류 변환
lib/auth/                데모 세션 쿠키와 Session 인터페이스
lib/db/                  Neon 클라이언트, Drizzle 스키마, tstzrange 타입
lib/dal/                 DB 접근 함수와 withTransaction
lib/permissions/         권한 키·기본값, can(), canAccess(), 세션 기반 로더
lib/realtime/            이벤트·채널 인터페이스, noop·메모리 구현
lib/floor-plan/          순수 문서 타입, strict Zod 스키마, PlanIssue
lib/env.ts               환경 변수 검증
drizzle/                 순서대로 적용하는 SQL과 스냅샷
tests/unit/              단위·컴포넌트 테스트
tests/db/                실제 마이그레이션을 사용하는 PGlite 통합 테스트
tests/e2e/               첫 화면 스모크 테스트
stories/                 색 토큰·타이포 스토리
.storybook/              Next.js Vite 기반 Storybook 설정
docs/                    작업 지시서, 명세, 가상 예시 데이터와 시안
```

`features/`는 다음 기능 작업에서 만들 예정이에요. 기능별 쓰기는 `features/*/actions.ts`에서 `createAction`으로 만들고, 첫 화면 읽기는 Server Component → `features/*/queries.ts` → DAL 순서로 처리해요. 읽기에는 Server Action을 쓰지 않아요. Route Handler는 캐시할 GET과 외부 웹훅에만 사용해요.

DB는 DAL에서만 읽고 써요. ESLint는 `lib/db` import를 `lib/db`, `lib/dal`, `tests/db`, `drizzle.config.*`로 제한해요. 환경 변수는 `lib/env.ts`와 루트 설정 파일만 직접 읽을 수 있어요. 테스트에는 DAL의 마지막 DB 인자로 PGlite 클라이언트를 주입할 수 있어요.

역할 권한은 `can()`, 층·공간 접근은 `canAccessFloor()`와 `canAccess()`로 판정해요. 화면에서 버튼을 숨겨도 서버 판정은 반드시 수행해요. DB 스키마와 권한·평면도 규칙의 기준은 [명세 문서](docs/spec/)예요.

### Cache Components

`next.config.ts`에서 `cacheComponents: true`를 켜고 React Compiler는 비활성으로 둬요. 세션·쿠키를 읽는 UI는 `<Suspense>` 아래의 Server Component에서 실행해요. 레이아웃 최상단에서 세션을 기다리지 않고, 세션이나 권한 결과를 요청 간 공유 캐시에 넣지 않아요. 현재 첫 화면은 세션을 읽지 않아요.

새 Next.js 코드를 작성하기 전에는 설치된 버전의 `node_modules/next/dist/docs/`를 확인해요. 특히 `01-app/02-guides/authentication-with-cache-components.md`에 이 규칙의 배경이 있어요.

### 액션 래퍼 사용 예

아래는 DB 쓰기 없이 래퍼의 사용법을 확인하는 테스트용 예제예요. 두 번째 인자로 세션을 주입하는 것은 테스트에서만 사용하고, 실제 기능 액션은 기본 `getSession()`을 사용해요.

```ts
import { z } from "zod";
import { createAction } from "@/lib/actions/create-action";
import { can } from "@/lib/permissions/can";
import type { PermissionContext } from "@/lib/permissions/types";

const userId = crypto.randomUUID();
const context: PermissionContext = {
  userId,
  teams: [],
  staffBranchIds: [],
  roleSettings: {},
};

const action = createAction(
  {
    input: z.object({ title: z.string().trim().min(1) }),
    authorize: ({ session }) =>
      session.userId === context.userId && can(context, "booking.own", {}),
    handler: ({ session, input }) => ({
      title: input.title,
      requestedBy: session.userId,
    }),
  },
  {
    getSession: async () => ({
      userId,
      email: "member@example.com",
      name: "데모 멤버",
    }),
  },
);

const result = await action({ title: "팀 회의" });
// { ok: true, data: { title: "팀 회의", requestedBy: userId } }
```

래퍼는 세션 → Zod 입력 검증 → `authorize` → `handler` 순서를 보장해요. `authorize`는 필수이며 권한 판정이 필요 없는 액션도 `authorize: "none"`을 명시해요. 비로그인 액션은 `auth: "public"`을 명시하고, 이때 `session`은 `Session | null`이에요.

실제 기능에서는 `loadPermissionContext(session, branchId)`로 서버에서 소속·권한을 읽고 `can()`과 `canAccess()`를 적용해요. `handler`의 DB 작업은 DAL로 구현하고 여러 쓰기는 `withTransaction()`으로 묶어요. 클라이언트가 보낸 사용자 id·역할·소유자는 신뢰하지 않아요. 액션을 내보내는 기능 파일에만 `"use server"`를 붙이고 래퍼 파일에는 붙이지 않아요.

결과는 `{ ok: true, data }` 또는 `{ ok: false, code, fieldErrors? }`예요. `ActionError`는 지정한 코드를 반환하고, Drizzle 오류의 `cause` 사슬에 있는 SQLSTATE `23P01`은 `BOOKING_CONFLICT`로 변환해요. 그 밖의 오류는 서버에만 기록하고 `INTERNAL`을 반환해요. 코드 목록은 [서버 명세](docs/spec/server.md)에 있어요.

## 디자인 토큰

색은 `app/globals.css`에 선언한 토큰으로 사용해요. Pretendard Variable은 패키지의 로컬 글꼴을 `next/font/local`로 제공해요. 주요 버튼은 `default`, 흰색 보조 버튼은 `outline` 또는 `secondary`, 글자 버튼은 `ghost`, 위험 동작은 `destructive`를 사용해요. 기본 버튼·입력 높이는 44px이에요.

| 대상             | Tailwind 유틸리티                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| 기본 표면·본문   | `bg-background`, `text-foreground`, `bg-card`, `border-border`                                          |
| 강조 버튼·포커스 | `bg-primary`, `text-primary-foreground`, `ring-ring`                                                    |
| 보조 표면·글자   | `bg-muted`, `text-muted-foreground`, `border-input`                                                     |
| 비어 있음        | `bg-status-free`, `text-status-free-foreground`, `border-status-free-border`, `bg-status-free-strong`   |
| 사용 중          | `bg-status-busy`, `text-status-busy-foreground`, `border-status-busy-border`, `bg-status-busy-strong`   |
| 내 예약          | `bg-status-mine`, `text-status-mine-foreground`, `border-status-mine-border`, `bg-status-mine-strong`   |
| 점검 중          | `bg-status-maintenance-hatch`, `text-status-maintenance-foreground`, `border-status-maintenance-border` |
| 전용 공간        | `bg-status-restricted`, `text-status-restricted-foreground`, `border-status-restricted-border`          |
| 수락 대기        | `bg-status-pending`, `text-status-pending-foreground`                                                   |
| 시간·숫자        | `tabular-nums`                                                                                          |

`StatusBadge`는 위 여섯 상태의 문구를 항상 표시하고 전용 공간에는 자물쇠 아이콘을 표시해요. 점검 중 빗금은 135도, 두 무채색을 8px씩 반복해요. 명세에 없는 상태의 `strong`·`border` 토큰은 만들지 않아요. 다크 모드는 shadcn 임시 값만 있고 상태 색 확정과 테마 전환은 후속 작업이에요. 자세한 값은 [디자인 토큰 명세](docs/spec/design-tokens.md)를 확인해요.

## 환경 변수와 Neon 마이그레이션

| 변수                  | 필요한 시점                    | 기본값                  |
| --------------------- | ------------------------------ | ----------------------- |
| `DATABASE_URL`        | 실제 DB 접근 또는 `db:migrate` | 없음                    |
| `AUTH_MODE`           | 데모 세션을 사용할 때 `demo`   | 빈 문자열               |
| `AUTH_SECRET`         | `AUTH_MODE=demo`일 때 필수     | 없음                    |
| `NEXT_PUBLIC_APP_URL` | 앱의 공개 URL이 달라질 때      | `http://localhost:3000` |

`parseEnv(source)`는 전달한 값만 검증하고, 앱에서는 `getEnv()`를 사용해요. DB 클라이언트는 처음 사용할 때 생성해요. 데모 세션은 `floor_session` httpOnly 쿠키에 사용자 UUID를 `sub`로 넣은 HS256 JWT이며 유효기간은 7일이에요. 검증 후 `users` 행을 다시 읽어 세션을 구성해요. `AUTH_MODE`가 비어 있으면 비로그인 상태로 동작해요.

실제 DB 연결은 사람이 다음 순서로 진행해요.

1. Neon 프로젝트를 만들고 사용할 DB의 연결 문자열을 받아요.
2. 로컬 설정 파일이 아직 없다면 `.env.example`을 `.env.local`로 복사해요. 기존 파일은 덮어쓰지 않아요.
3. `DATABASE_URL`을 채워요. 데모 인증을 사용할 예정이면 `AUTH_MODE=demo`와 충분히 무작위인 `AUTH_SECRET`도 채워요. 예를 들어 `openssl rand -base64 32`로 생성한 값을 사용할 수 있어요.
4. 아래 명령으로 대상 DB에 마이그레이션을 적용해요.

```sh
pnpm db:migrate
```

Drizzle 설정은 `db:migrate`를 실행할 때만 `.env.local`을 읽어요. 순서는 `0000_enable-btree-gist.sql` → `0001_initial-schema.sql` → `0002_bookings-exclusion.sql`이에요. 첫 파일에서 `btree_gist`를 켜고, 생성된 스키마 다음에 예약 겹침 방지 EXCLUDE 제약을 추가해요. 애플리케이션의 사전 검사만으로 겹침 제약을 대체하지 않아요.

이 과정은 테이블만 준비해요. 아직 시드·데모 계정 로그인 액션이 없으므로 `AUTH_MODE=demo`만으로 로그인되지는 않아요. 실제 Neon Auth와 실시간 서비스 연결, 시드·로그인은 다음 작업이에요. `.env*` 중 커밋하는 파일은 `.env.example`뿐이에요.

스키마를 바꿀 때는 `lib/db/schema`를 수정한 뒤 `pnpm db:generate`를 실행해요. 이미 커밋한 마이그레이션은 수정하지 않아요. 현재 스키마에서 다시 생성하면 새 파일이 없어야 해요. 실제 Neon 접속과 `db:migrate`는 로컬 테스트에 포함하지 않아요.

## 검사와 CI

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm db:generate
pnpm build-storybook
pnpm test:e2e
```

DB 테스트는 메모리 PGlite에 실제 SQL 마이그레이션을 적용해요. 예약 EXCLUDE·경계·부분 유니크·참조 제약과 DAL 트랜잭션을 확인해요. 권한 기본값·역할 합집합·접근 교집합, 액션 순서·오류 변환, 세션 서명, 평면도 스키마, 실시간 메모리 구현도 검사해요. Storybook은 docs 애드온만 사용하므로 단위 테스트와 독립적이에요.

GitHub Actions는 `main` push와 pull request에서 Node 22·pnpm 12.8.1, pnpm 저장소 캐시와 고정 lockfile 설치로 `lint`, `typecheck`, `test`, `build`를 실행해요. 실제 DB나 인증 비밀 값은 쓰지 않아요. Playwright는 로컬 검사로 두고 CI에는 넣지 않았어요. Actions 설치 방식은 공식 [checkout](https://github.com/actions/checkout)과 [pnpm/setup](https://github.com/pnpm/setup) 안내를 따랐어요. 원격 저장소에 push한 뒤 CI 실행 결과는 별도로 확인해야 해요.

## 주요 패키지와 추가 이유

아래는 셋업 시 설치된 버전이에요. 재현 가능한 전체 버전은 `pnpm-lock.yaml`이 기준이에요.

| 패키지                                              | 버전                             | 사용하는 이유                                      |
| --------------------------------------------------- | -------------------------------- | -------------------------------------------------- |
| Next.js / React·React DOM                           | 16.3.8 / 19.2.8                  | 기존 App Router 기반 유지                          |
| TypeScript                                          | 5.9.3                            | strict와 배열 접근 타입 검사                       |
| Tailwind CSS / PostCSS 플러그인                     | 4.3.3                            | 토큰 기반 유틸리티 스타일                          |
| shadcn / Radix UI                                   | 4.21.2 / 1.7.0                   | Nova 기본 컴포넌트와 접근성 동작                   |
| `cn` / `class-variance-authority`                   | 0.4.0 / 0.7.1                    | shadcn이 사용하는 클래스 병합·variant              |
| Lucide / Sonner / tw-animate-css                    | 1.52.0 / 2.0.8 / 1.4.0           | 아이콘·알림·기본 애니메이션                        |
| Pretendard                                          | 1.3.9                            | 외부 요청 없는 한국어 로컬 글꼴                    |
| Zod                                                 | 4.6.5                            | 환경 변수·액션 입력·평면도 검증                    |
| TanStack Query / Zustand                            | 5.104.1 / 5.0.15                 | 서버 상태 Provider / 후속 클라이언트 상태용 설치만 |
| Drizzle ORM / drizzle-kit                           | 0.45.3 / 0.31.11                 | 타입 지정 스키마·조회·마이그레이션                 |
| Neon serverless                                     | 1.2.0                            | 대화형 트랜잭션 가능한 WebSocket 드라이버          |
| jose / server-only / dotenv                         | 6.2.12 / 0.0.1 / 18.0.5          | JWT 서명·검증 / 서버 경계 / CLI의 로컬 환경 로드   |
| Vitest / PGlite / jsdom                             | 5.0.3 / 0.5.8 / 30.1.2           | 단위·실제 SQL 제약·DOM 테스트                      |
| Testing Library React / DOM / jest-dom / user-event | 16.3.3 / 10.4.2 / 7.0.1 / 14.6.7 | 사용자 동작 중심 컴포넌트 검사                     |
| Playwright                                          | 1.63.0                           | Chromium 첫 화면 스모크                            |
| Storybook / Next.js Vite·docs 애드온                | 10.6.1                           | 색·타이포·컴포넌트 문서                            |
| Vite / React 플러그인                               | 8.3.2 / 6.1.2                    | 테스트·Storybook 변환 기반                         |
| ESLint / Prettier / Tailwind 정렬 플러그인          | 9.39.5 / 3.9.9 / 0.8.1           | 경계 검사·일관된 포맷                              |

`pnpm-workspace.yaml`에서 의존성 빌드 스크립트는 필요한 `esbuild`만 허용해요. `sharp`와 `unrs-resolver`는 사전 빌드된 배포물을 사용해 설치 스크립트를 허용하지 않아요. 외부 실시간·인증 서비스 SDK는 추가하지 않았어요.
