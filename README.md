# Floor

공유오피스 멤버가 평면도에서 공간을 찾아 예약하고, 예약에 붙은 채팅과 영상 통화로 대화하는 서비스예요.

현재는 기본 셋업, 가입·로그인과 팀 회원으로 전환하는 흐름까지 구현했어요. Better Auth로 Google·GitHub·이메일 비밀번호 로그인, 이메일 인증과 비밀번호 재설정을 제공하고, 운영자 계정 생성 CLI도 있어요. 일반 회원은 팀을 만들거나 이메일 초대를 수락하거나 가입 요청을 승인받아 팀원이 될 수 있어요. 팀 역할 변경·내보내기·탈퇴, 공유 초대 링크, 팀 전환 레일, 평면도 렌더러, 예약·채팅·영상 화면, 시드, 실제 메일·실시간 서비스 연결은 아직 없어요. 별도 API 서버나 배포는 만들지 않아요.

## 시작하기

Node 22 LTS(22.12 이상)와 pnpm 12.8.1이 필요해요. `.nvmrc`는 Node 22, `package.json`의 `packageManager`는 pnpm 12.8.1을 지정해요. Next.js 16.3.8과 React 19.2.8은 기존 버전을 유지해요.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

[http://localhost:3000](http://localhost:3000)에 로그인하지 않고 들어가면 `/login`으로 안내해요. 세션 쿠키가 없는 공개 화면과 빌드·테스트·마이그레이션 생성은 실제 DB 없이 확인할 수 있어요. 실제 가입·로그인에는 아래의 [환경 변수와 Neon 준비](#환경-변수와-neon-준비)가 필요해요.

## 명령어

| 명령                   | 하는 일                                                  |
| ---------------------- | -------------------------------------------------------- |
| `pnpm dev`             | Next.js 개발 서버                                        |
| `pnpm build`           | 프로덕션 빌드                                            |
| `pnpm start`           | 빌드한 앱 실행                                           |
| `pnpm lint`            | ESLint와 DB·환경 변수 접근 경계 검사                     |
| `pnpm typecheck`       | `next typegen` 후 `tsc --noEmit`                         |
| `pnpm test`            | Vitest 단위·컴포넌트·PGlite 통합 테스트, watch 없이 실행 |
| `pnpm test:e2e`        | Chromium으로 공개 인증 화면·보호 경로 스모크 테스트      |
| `pnpm format`          | Prettier로 파일과 Tailwind 클래스 정렬                   |
| `pnpm db:generate`     | Drizzle 스키마에서 새 마이그레이션 생성                  |
| `pnpm db:migrate`      | 설정한 실제 DB에 미적용 마이그레이션 실행                |
| `pnpm admin:create`    | 운영자 계정 생성 또는 기존 계정에 지점 운영 권한 추가    |
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
app/(auth)/              로그인·가입·인증·재설정·운영자 로그인
app/(app)/               로그인한 홈·팀 전환·팀 상세·개인 초대, 정적인 머리글과 Suspense
app/admin/               운영자 홈, 정적인 레이아웃과 Suspense
app/api/auth/[...all]/   Better Auth Route Handler
app/                     루트 레이아웃, 전역 Provider와 스타일
components/ui/           shadcn Nova + Radix 기본 컴포넌트
components/              StatusBadge, 로그아웃 등 공용 컴포넌트와 스토리
features/auth/           인증 양식·입력 스키마·고정 오류 문구
features/admin/          세션과 운영 권한을 확인하는 queries
features/teams/          팀 액션·조회·공유 입력 스키마·양식·팀원 목록
lib/actions/             ActionResult, ActionError, createAction, 오류 변환
lib/auth/                Better Auth, 세션 가드, safeNext, 운영자 생성
lib/email/               EmailSender, 콘솔·메모리 구현, 인증·팀 초대 메일 문구
lib/db/                  Neon 클라이언트, Drizzle 스키마, tstzrange 타입
lib/dal/                 DB 접근 함수와 withTransaction
lib/permissions/         권한 키·기본값, can(), canAccess(), 세션 기반 로더
lib/teams/               팀 이름과 검색어의 순수 정규화
lib/realtime/            이벤트·채널 인터페이스, noop·메모리 구현
lib/floor-plan/          순수 문서 타입, strict Zod 스키마, PlanIssue
lib/env.ts               환경 변수 검증
drizzle/                 순서대로 적용하는 SQL과 스냅샷
scripts/                 운영자 CLI와 인자 처리
tests/unit/              단위·컴포넌트 테스트
tests/db/                실제 마이그레이션을 사용하는 PGlite 통합 테스트
tests/e2e/               공개 인증 화면·보호 경로 스모크 테스트
stories/                 색 토큰·타이포 스토리
.storybook/              Next.js Vite 기반 Storybook 설정
docs/                    작업 지시서, 명세, 가상 예시 데이터와 시안
```

기능별 쓰기는 `features/*/actions.ts`에서 `createAction`으로 만들고, 첫 화면 데이터 읽기는 Server Component → `features/*/queries.ts` → DAL 순서로 처리해요. 읽기에는 Server Action을 쓰지 않아요. Route Handler는 캐시할 GET·외부 웹훅·Better Auth만 허용해요. 가입·로그인·로그아웃 등 인증 요청은 예외로 `/api/auth/[...all]`이 처리하며 Server Action 래퍼를 거치지 않아요.

업무 DB는 DAL에서만 읽고 써요. 인증 저장소는 Better Auth의 Drizzle 어댑터가 기존 `users`와 인증 테이블에 연결해요. ESLint는 `lib/db` import를 `lib/db`, `lib/dal`, `lib/auth/auth.ts`, `tests/db`, `drizzle.config.*`로 제한해요. 환경 변수는 `lib/env.ts`와 루트 설정 파일만 직접 읽을 수 있어요. 테스트에는 DAL의 마지막 DB 인자로 PGlite 클라이언트를 주입할 수 있어요.

Better Auth를 직접 부르는 곳은 `lib/auth/*`와 인증 Route Handler로 제한해요. 브라우저의 `authClient`는 `(auth)` 화면과 머리글의 로그아웃 버튼만 사용해요. 다른 코드는 아래 세션 가드를 사용해요.

역할 권한은 `can()`, 층·공간 접근은 `canAccessFloor()`와 `canAccess()`로 판정해요. 화면에서 버튼을 숨겨도 서버 판정은 반드시 수행해요. DB 스키마와 권한·평면도 규칙의 기준은 [명세 문서](docs/spec/)예요.

### Cache Components

`next.config.ts`에서 `cacheComponents: true`를 켜고 React Compiler는 비활성으로 둬요. 세션·쿠키·헤더·`params`·`searchParams`를 읽는 UI는 `<Suspense>` 아래의 Server Component에서 실행해요. 인증 화면의 제공자·메일 가능 여부도 `connection()` 뒤 요청 시점에 읽어요. 세션·권한·소속 조회에는 `use cache`, `use cache: private`, `use cache: remote` 어느 것도 붙이지 않아요.

레이아웃은 정적인 틀과 `<Suspense>`만 제공하고 접근을 막는 수단으로 쓰지 않아요. 보호가 필요한 페이지와 조회·액션이 각각 직접 확인해요.

| 함수                       | 용도와 실패 동작                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `getSession()`             | `{ userId, email, name }` 또는 `null`. 세션 쿠키가 없으면 인증 인스턴스·DB를 만들지 않음         |
| `requireSession()`         | queries·액션용. 세션이 없으면 `ActionError("UNAUTHENTICATED")`                                   |
| `requirePageSession(next)` | `(app)`의 모든 페이지용. 세션이 없으면 `/login?next=…`                                           |
| `requireOperatorPage()`    | `admin`의 모든 페이지용. 비로그인은 `/admin/login`, 비운영자는 `/admin/login?error=not_operator` |

홈·팀 전환·팀 상세·개인 초대·운영자 페이지가 각각 가드를 호출해요. `features/admin/queries.ts`와 `features/teams/queries.ts`도 독립적으로 세션·소속·권한을 확인해요. `proxy.ts`는 쿠키 유무만 보고 일찍 안내하는 편의 기능이며 쿠키 유효성을 검증하지 않아요. 오래된 쿠키만으로 `/login`에서 내보내지 않고, 로그인·가입 페이지가 실제 세션을 확인해요. 인증·재설정 화면은 로그인한 상태로도 열려요.

로그인 뒤 목적지는 `safeNext()`를 통과한 같은 사이트의 경로만 사용해요. 외부 주소, 역슬래시·제어 문자, 인증 API, 로그인 화면으로 되돌아가는 목적지는 `/`로 바꿔요. 이메일 인증 후에는 목적지와 무관하게 `/login?verified=1`로 이동하며 자동 로그인하지 않아요. `<Suspense>` 안의 `redirect()`는 틀이 먼저 전송되면 HTTP 200으로 처리될 수 있어요.

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
      name: "테스트 멤버",
    }),
  },
);

const result = await action({ title: "팀 회의" });
// { ok: true, data: { title: "팀 회의", requestedBy: userId } }
```

래퍼는 세션 → Zod 입력 검증 → `authorize` → `handler` 순서를 보장해요. `authorize`는 필수이며 권한 판정이 필요 없는 액션도 `authorize: "none"`을 명시해요. 비로그인 액션은 `auth: "public"`을 명시하고, 이때 `session`은 `Session | null`이에요.

실제 기능에서는 `loadPermissionContext(session, branchId)`로 서버에서 소속·권한을 읽고 `can()`과 `canAccess()`를 적용해요. `handler`의 DB 작업은 DAL로 구현하고 여러 쓰기는 `withTransaction()`으로 묶어요. 클라이언트가 보낸 사용자 id·역할·소유자는 신뢰하지 않아요. 액션을 내보내는 기능 파일에만 `"use server"`를 붙이고 래퍼 파일에는 붙이지 않아요.

결과는 `{ ok: true, data }` 또는 `{ ok: false, code, fieldErrors? }`예요. `ActionError`는 지정한 코드를 반환하고, Drizzle 오류의 `cause` 사슬에 있는 SQLSTATE `23P01`은 `BOOKING_CONFLICT`로 변환해요. `23505`는 제약 이름으로 팀 이름 중복(`TEAM_NAME_TAKEN`)과 대기 요청 중복(`ALREADY_REQUESTED`)을 구분해요. 나머지는 `INTERNAL`과 고정 서버 로그만 남겨요. 오류 객체·SQL·입력·토큰을 로그로 출력하지 않아요. 코드 목록은 [서버 명세](docs/spec/server.md)에 있어요.

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

## 환경 변수와 Neon 준비

| 변수                                       | 필요한 시점과 규칙                                         | 기본값                  |
| ------------------------------------------ | ---------------------------------------------------------- | ----------------------- |
| `DATABASE_URL`                             | 실제 DB·인증 접근, `db:migrate`, `admin:create`            | 없음                    |
| `AUTH_SECRET`                              | 실제 인증·`admin:create`에 필수. 32바이트 이상의 무작위 값 | 없음                    |
| `NEXT_PUBLIC_APP_URL`                      | 앱과 인증 콜백의 기준 주소                                 | `http://localhost:3000` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | 둘 다 있을 때만 Google 로그인 활성화                       | 없음                    |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | 둘 다 있을 때만 GitHub 로그인 활성화                       | 없음                    |
| `NODE_ENV`                                 | Next.js가 설정. `production`에서는 콘솔 메일 발송 금지     | `development`           |

`parseEnv(source)`는 전달한 값만 검증하고, 앱에서는 `getEnv()`를 사용해요. 선택 값의 빈 문자열은 없는 것으로 취급해요. OAuth 설정은 한쪽만 있으면 오류예요. `AUTH_SECRET`이 있으면 UTF-8 기준 최소 32바이트를 검증하며, 없는 상태도 빌드·테스트를 위해 허용해요. DB와 인증 인스턴스는 첫 실제 사용 시 생성해요. 세션은 Better Auth의 DB 세션과 쿠키를 사용하며 만료 7일, 갱신 주기 1일이에요.

실제 DB 연결은 사람이 다음 순서로 진행해요.

1. Neon 프로젝트를 만들고 사용할 DB의 연결 문자열을 받아요.
2. 로컬 설정 파일이 아직 없다면 `.env.example`을 `.env.local`로 복사해요. 기존 파일은 덮어쓰지 않아요.
3. `DATABASE_URL`을 채우고 `openssl rand -base64 32`로 생성한 무작위 값을 `AUTH_SECRET`에 설정해요. 출력한 비밀 값을 저장소나 공유 로그에 남기지 않아요.
4. 아래 명령으로 대상 DB에 마이그레이션을 적용해요.

```sh
pnpm db:migrate
```

Drizzle 설정은 `db:migrate`를 실행할 때만 `.env.local`을 읽어요. 순서는 `0000_enable-btree-gist.sql` → `0001_initial-schema.sql` → `0002_bookings-exclusion.sql` → `0003_auth-foundation.sql` → `0004_team-join.sql`이에요. `0003`은 기존 사용자에 인증 필드와 인증 테이블을 추가하고, `0004`는 팀 정보·초대 처리 상태·가입 요청을 추가해요. 이미 적용한 파일과 기존 PK 이름은 유지해요. `btree_gist`와 예약 EXCLUDE 제약도 그대로 유지하며 애플리케이션의 사전 검사로 대신하지 않아요.

이어서 필요한 OAuth 앱을 등록하고, 아래 운영자 CLI로 운영 계정을 준비한 뒤 `pnpm dev`를 실행해요. 일반 회원은 `/signup`, 운영자는 `/admin/login`에서 시작해요. Neon은 PostgreSQL 저장소로 사용하며 별도의 Neon Auth 서비스는 연결하지 않아요. `.env*` 중 커밋하는 파일은 `.env.example`뿐이에요.

스키마를 바꿀 때는 `lib/db/schema`를 수정한 뒤 `pnpm db:generate`를 실행해요. 이미 커밋한 마이그레이션은 수정하지 않아요. 현재 스키마에서 다시 생성하면 새 파일이 없어야 해요. 실제 Neon 접속과 `db:migrate`는 로컬 테스트에 포함하지 않아요.

### Google·GitHub OAuth 앱

Google은 [Google Cloud Console](https://console.cloud.google.com/)에서 웹 애플리케이션 OAuth 클라이언트를, GitHub는 [Developer settings](https://github.com/settings/developers)에서 OAuth App을 만들어요. 등록한 앱의 ID·Secret 쌍을 위 환경 변수에 넣고 서버를 다시 실행해요. 콜백 경로는 Better Auth의 [Google](https://better-auth.com/docs/authentication/google)·[GitHub](https://better-auth.com/docs/authentication/github) 안내를 따라요.

| 제공자 | 로컬에 등록할 콜백 주소                          | 다른 환경의 콜백 주소                            |
| ------ | ------------------------------------------------ | ------------------------------------------------ |
| Google | `http://localhost:3000/api/auth/callback/google` | `{NEXT_PUBLIC_APP_URL}/api/auth/callback/google` |
| GitHub | `http://localhost:3000/api/auth/callback/github` | `{NEXT_PUBLIC_APP_URL}/api/auth/callback/github` |

앱 주소·포트·프로토콜을 콜백 등록값과 일치시켜요. 설정이 완성된 제공자 버튼만 요청 시점에 보여주고 비밀 값은 클라이언트에 내려주지 않아요. 제공자가 이메일을 미인증으로 알려주면 로그인을 거절해요. 이미 있는 미인증 비밀번호 계정에는 소셜 수단을 연결하지 않아요. 인증된 비밀번호 계정에 소셜 수단이 처음 연결되면 기존 비밀번호와 세션을 삭제하고 안내 메일을 보내요. 비밀번호 로그인도 쓰려면 다시 재설정해야 해요.

### 개발 메일과 production 제한

외부 메일 서비스는 아직 없어요. `pnpm dev`에서 가입·인증 재발송·비밀번호 재설정을 하면 받는 사람, 제목, 본문을 **개발 서버 터미널**에 출력해요. 브라우저 콘솔이나 실제 받은 편지함이 아니라 이 서버 로그에서 링크를 찾아 열어요. 인증 링크를 열면 `/login?verified=1`로 돌아오고 직접 로그인해야 해요. 재설정을 마치면 이전 비밀번호와 세션은 사용할 수 없어요.

`NODE_ENV=production`의 콘솔 구현은 링크를 출력하지 않고 오류를 내요. 따라서 `pnpm build && pnpm start`에서도 `/signup`, `/forgot-password`, `/verify-email`의 이메일 양식 대신 다음 안내를 표시해요. 켜진 소셜 버튼은 유지해요.

> 지금은 이메일로 가입하거나 재설정할 수 없어요. Google이나 GitHub로 계속해 주세요

메일을 발송하지 못해도 Better Auth가 성공 모양으로 응답할 수 있으므로 이 안내를 숨기면 안 돼요. 메일 서비스 연결 전에는 소셜 로그인과 이미 인증된 계정(운영자 CLI 계정 포함)의 비밀번호 로그인을 사용할 수 있어요. 제공자를 하나도 설정하지 않으면 소셜 버튼도 없어요. 이메일 가입·재설정의 실제 운영 사용은 메일 서비스 연결 후 확인해요.

요청 제한은 Better Auth 기본값을 유지해요. production에서 메모리 저장소를 사용하므로 여러 서버 간 제한은 공유되지 않으며 배포 전 다시 정해야 해요. 화면의 인증 재발송 60초 대기는 편의 기능일 뿐 서버 제한을 대신하지 않아요.

### 이번 범위에서 비활성화한 인증 경로

`lib/auth/auth.ts`의 `disabledAuthPaths`는 아래 15개예요. 모두 `/api/auth` 기준 상대 경로이며 프로필·계정·로그인 수단 관리 API를 공개하지 않아요. 가입·로그인·로그아웃·이메일 인증·비밀번호 재설정은 활성 상태예요.

```text
/update-user
/change-email
/delete-user
/delete-user/callback
/change-password
/list-sessions
/revoke-session
/revoke-sessions
/revoke-other-sessions
/list-accounts
/link-social
/unlink-account
/get-access-token
/refresh-token
/account-info
```

## 운영자 계정 만들기

공개 가입으로는 운영자가 될 수 없어요. 마이그레이션과 `DATABASE_URL`·`AUTH_SECRET` 설정을 먼저 마친 뒤, 저장소 루트에서 실행해요.

```sh
pnpm admin:create --help
pnpm admin:create --email ops@example.com --name "가상 운영자" --branch "가상 지점" --create-branch
```

두 번째 명령은 지점이 없으면 만들고 새 계정을 이메일 인증이 끝난 상태로 등록해요. 비밀번호를 생략하면 안전한 무작위 값을 만들어 표준 출력에 한 번만 보여줘요. 값을 안전한 곳에 보관하고 공유 로그에 남기지 않아요.

| 옵션               | 동작                                                                      |
| ------------------ | ------------------------------------------------------------------------- |
| `--email`          | 필수. 앞뒤 공백을 제거하고 소문자로 바꾼 유효한 이메일                    |
| `--name`           | 새 계정에서 필수. 앞뒤 공백을 뺀 1–50자. 기존 이름은 바꾸지 않음          |
| `--branch`         | 필수 지점 이름. 앞뒤 공백을 제거하며 동일 이름이 둘 이상이면 오류         |
| `--create-branch`  | 지점이 없으면 기본 시간대로 생성. 생략하면 없는 지점은 오류               |
| `--password`       | 8–128자. 새 계정 또는 `--reset-password`에서만 설정. 생략하면 무작위 생성 |
| `--reset-password` | 기존 비밀번호 교체·모든 세션 삭제·이메일 인증 처리를 한 트랜잭션으로 수행 |
| `--help`           | 환경 변수나 DB 연결 없이 사용법 출력                                      |

이미 인증된 계정에 다른 지점을 추가하려면 이름과 비밀번호를 생략해요. 이미 같은 지점의 운영자여도 성공하며 기존 비밀번호를 유지해요.

```sh
pnpm admin:create --email ops@example.com --branch "다른 가상 지점" --create-branch
```

미인증 기존 계정은 `--reset-password` 없이는 실패해요. 기존 계정의 비밀번호를 재발급할 때도 같은 옵션을 명시해요.

```sh
pnpm admin:create --email ops@example.com --branch "가상 지점" --reset-password
```

비밀번호를 직접 정하려면 `--password "직접 정한 8–128자 비밀번호"`를 더할 수 있지만 셸 기록에 남을 수 있어요. 기존 계정에는 `--password`만 전달해도 비밀번호가 바뀌지 않아요. Google·GitHub가 연결된 계정이면 그 로그인 수단으로도 운영자 화면에 들어올 수 있다는 경고를 출력해요.

명령은 `node --conditions=react-server --import=tsx --env-file-if-exists=.env.local scripts/admin-create.ts`를 실행해요. `react-server` 조건은 Next.js 밖에서도 `server-only` 경계를 유지하기 위한 것이고, `tsx`는 TypeScript와 경로 별칭을 처리해요. Node가 `.env.local`을 있으면 읽고, 실제 환경 검증은 `lib/env.ts`가 해요. 필수 값이 없거나 입력·DB 작업이 실패하면 비밀 값 없이 안내하고 실패 코드로 끝나요.

완료 후 `/admin/login`에서 이메일·비밀번호로 로그인해 `/admin`의 운영 지점 목록을 확인해요. `/admin/login`은 안내용 입구이고 실제 경계는 페이지·queries의 서버 검사예요. 운영자가 아닌 로그인 상태에서는 자동 로그아웃하지 않고 홈으로 가거나 명시적으로 다른 계정으로 로그인할 수 있어요.

## 팀 회원으로 전환

홈(`/`)에서 내 팀 목록 또는 팀 회원으로 전환하는 카드를 볼 수 있어요. `/teams/start`는 받은 초대, 새 팀 만들기, 팀 검색·가입 요청 순서예요. 검색은 NFC·공백 정규화 후 2–40자이며, 이름과 주 이용 지점만 최대 10개 보여줘요. `%`, `_`, `\`는 검색 연산자가 아닌 문자로 취급해요.

- 새 팀을 만들면 생성자가 관리자가 돼요. 주 이용 지점은 지점이 있을 때 필수이고 권한 범위를 바꾸지 않아요. 관리자 팀은 회원당 최대 5개예요.
- 가입 요청은 회원당 대기 10개까지 보낼 수 있어요. 본인은 취소하고 대상 팀 관리자는 승인·거절할 수 있어요.
- 관리자는 `/teams/[teamId]`에서 이메일 초대를 만들거나 취소해요. 7일짜리 개인 초대이며, 팀당 미처리 50개까지예요. 만료됐지만 미처리인 초대도 한도와 관리자 목록에 포함해요. 같은 이메일로 다시 초대하면 이전 초대를 취소하고 새로 만들어요.
- 수신자는 받은 초대 목록이나 `/invite/[token]`에서 수락·거절해요. 인증된 이메일이 일치해야 해요. 다른 수신자·만료·처리 완료·잘못된 토큰은 모두 같은 안내를 보여줘요.

팀원이 아닌 사람에게 팀 상세는 존재하지 않는 팀과 동일하게 처리해요. 일반 팀원 조회는 관리자 연락처·보낸 초대·가입 요청을 읽지 않아요. 관리자 응답에도 초대 토큰은 포함하지 않아요. 승인과 수락은 기존 관리자 역할을 보존하고, 같은 팀의 대기 요청·초대를 한 트랜잭션에서 함께 정리해요.

초대 메일은 DB 커밋 뒤 보내요. 개발 모드에서는 기존 콘솔 메일로 확인하고, 메일을 보낼 수 없는 환경에서도 초대 등록은 허용해요. 발송 실패가 초대를 취소하지 않으며, 수신자는 로그인 후 받은 초대 목록에서 확인할 수 있어요. 화면은 등록 성공만 안내하고 메일 전송 성공을 단정하지 않아요. 요청 실패 로그에는 메일 본문·주소·초대 토큰을 넣지 않아요.

화면 쓰기는 TanStack Query mutation으로 실행하며 공통 실행 잠금과 동일 scope로 중복·병렬 제출을 막아요. 성공 뒤 서버 목록을 새로 읽고 멤버십을 낙관적으로 변경하지 않아요. 관련 사용자 UUID 오름차순 → 팀 행 → 조건부 상태 변경 순서로 잠그고, 한도 초과나 중간 실패는 전체 트랜잭션을 되돌려요.

기존 Neon과 OAuth 설정을 사용한다면 `pnpm db:migrate`로 새 마이그레이션을 적용한 다음, 서로 다른 인증된 계정 두 개로 **팀 생성 → 초대 → 수락 → 다른 팀 가입 요청 → 승인**을 확인해요. 이번 로컬 검사는 실제 DB나 메일 서비스에 접근하지 않아요.

## 검사와 CI

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm db:generate
pnpm build-storybook
pnpm test:e2e
```

DB 테스트는 메모리 PGlite에 실제 SQL 마이그레이션을 적용해요. 예약 EXCLUDE·경계·부분 유니크·참조 제약, DAL 트랜잭션, 인증 세션·계정의 사용자 삭제 연쇄와 제공자 계정 유니크 제약을 확인해요. 권한 기본값·역할 합집합·접근 교집합, 액션 순서·오류 변환, 평면도 스키마, 실시간 메모리 구현도 검사해요.

인증 통합 테스트는 PGlite와 메모리 메일로 가입→인증→로그인→로그아웃, 중복 가입 응답, 계정 선점 방지, 재설정 후 기존 세션 폐기, 운영자 생성과 비밀번호 재발급을 검사해요. 소셜 경로는 테스트 제공자의 토큰 검증·사용자 정보를 대체해 외부 왕복 없이 확인해요. UI 테스트는 입력 오류·접근성 연결·중복 제출·메일 불가 안내·60초 대기·오류 문구를 확인해요.

팀 테스트도 실제 마이그레이션을 적용한 PGlite와 메모리 메일을 사용해요. 제약 11–14, 팀 생성·가입 요청·초대, 권한·한도·만료, 중복 처리·교차 정리·기존 역할 보존, 롤백, 응답의 민감 필드와 관리자 전용 조회 분리를 검사해요. SQL 기록으로 잠금 순서와 pending 조건이 있는 `UPDATE … RETURNING`을 확인해요. PGlite는 단일 연결이므로 실제 PostgreSQL 다중 세션의 교착 상태까지 검증하는 것은 아니에요. 팀 화면은 컴포넌트 테스트를 추가하고 기존 E2E는 회귀 검사로 유지해요.

Playwright는 가짜 비밀 키와 실제 연결할 수 없는 DB 주소로 production 서버를 띄워 비로그인 홈의 로그인 안내, 안전한 `next`, 메일 불가 안내, 운영자 로그인과 키보드 이동을 검사해요. 이 검사는 실제 가입·로그인이나 OAuth 왕복 검증이 아니에요. Storybook은 docs 애드온만 사용하므로 단위 테스트와 독립적이에요.

GitHub Actions는 `main` push와 pull request에서 Node 22·pnpm 12.8.1, pnpm 저장소 캐시와 고정 lockfile 설치로 `lint`, `typecheck`, `test`, `build`를 실행해요. 실제 DB나 인증 비밀 값은 쓰지 않아요. Playwright는 로컬 검사로 두고 CI에는 넣지 않았어요. Actions 설치 방식은 공식 [checkout](https://github.com/actions/checkout)과 [pnpm/setup](https://github.com/pnpm/setup) 안내를 따랐어요. 원격 저장소에 push한 뒤 CI 실행 결과는 별도로 확인해야 해요.

실제 Neon 마이그레이션, 브라우저의 가입·메일 인증·재설정, Google·GitHub OAuth 왕복, 실제 DB를 쓰는 운영자 CLI는 위 준비 절차 후 사람이 별도로 확인해야 해요. 외부 메일 발송·push·배포는 이 작업에 포함하지 않아요.

## 주요 패키지와 추가 이유

아래는 현재 설치된 주요 버전이에요. 재현 가능한 전체 버전은 `pnpm-lock.yaml`이 기준이에요.

| 패키지                                                             | 버전                             | 사용하는 이유                                                   |
| ------------------------------------------------------------------ | -------------------------------- | --------------------------------------------------------------- |
| Next.js / React·React DOM                                          | 16.3.8 / 19.2.8                  | 기존 App Router 기반 유지                                       |
| TypeScript                                                         | 5.9.3                            | strict와 배열 접근 타입 검사                                    |
| Tailwind CSS / PostCSS 플러그인                                    | 4.3.3                            | 토큰 기반 유틸리티 스타일                                       |
| shadcn / Radix UI                                                  | 4.21.2 / 1.7.0                   | Nova 기본 컴포넌트와 접근성 동작                                |
| `cn` / `class-variance-authority`                                  | 0.4.0 / 0.7.1                    | shadcn이 사용하는 클래스 병합·variant                           |
| Lucide / Sonner / tw-animate-css                                   | 1.52.0 / 2.0.8 / 1.4.0           | 아이콘·알림·기본 애니메이션                                     |
| Pretendard                                                         | 1.3.9                            | 외부 요청 없는 한국어 로컬 글꼴                                 |
| Zod                                                                | 4.6.5                            | 환경 변수·액션 입력·평면도 검증                                 |
| TanStack Query / Zustand                                           | 5.104.1 / 5.0.15                 | 서버 상태 Provider / 후속 클라이언트 상태용 설치만              |
| Drizzle ORM / drizzle-kit                                          | 0.45.3 / 0.31.11                 | 타입 지정 스키마·조회·마이그레이션                              |
| Neon serverless                                                    | 1.2.0                            | 대화형 트랜잭션 가능한 WebSocket 드라이버                       |
| Better Auth / `@better-auth/core` / `@better-auth/drizzle-adapter` | 각각 1.7.7                       | 자체 운영 인증 / 트랜잭션 후 메일 훅 / 기존 Drizzle 스키마 연결 |
| server-only / dotenv                                               | 0.0.1 / 18.0.5                   | 서버 경계 / Drizzle 마이그레이션 CLI의 로컬 환경 로드           |
| tsx                                                                | 4.23.15                          | Next.js 밖에서 운영자 TypeScript CLI 실행                       |
| Vitest / PGlite / jsdom                                            | 5.0.3 / 0.5.8 / 30.1.2           | 단위·실제 SQL 제약·DOM 테스트                                   |
| Testing Library React / DOM / jest-dom / user-event                | 16.3.3 / 10.4.2 / 7.0.1 / 14.6.7 | 사용자 동작 중심 컴포넌트 검사                                  |
| Playwright                                                         | 1.63.0                           | Chromium 공개 인증 화면 스모크                                  |
| Storybook / Next.js Vite·docs 애드온                               | 10.6.1                           | 색·타이포·컴포넌트 문서                                         |
| Vite / React 플러그인                                              | 8.3.2 / 6.1.2                    | 테스트·Storybook 변환 기반                                      |
| ESLint / Prettier / Tailwind 정렬 플러그인                         | 9.39.5 / 3.9.9 / 0.8.1           | 경계 검사·일관된 포맷                                           |

직접 JWT를 만드는 구현을 Better Auth DB 세션으로 교체하면서 `jose` 직접 의존성은 제거했어요. Better Auth가 사용하는 전이 의존성까지 제거한다는 뜻은 아니에요. Better Auth 관련 세 패키지는 호환되는 1.7.7로 고정해요.

`pnpm-workspace.yaml`에서 의존성 빌드 스크립트는 필요한 `esbuild`만 허용해요. `sharp`와 `unrs-resolver`는 사전 빌드된 배포물을 사용해 설치 스크립트를 허용하지 않아요. 외부 메일·실시간 서비스 SDK와 Better Auth admin·organization 플러그인은 추가하지 않았어요.
