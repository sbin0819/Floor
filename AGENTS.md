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
| `docs/codex/02-auth.md` | 가입과 로그인 작업 지시서 (끝남) | 인증에서 왜 그렇게 했는지 확인할 때 |
| `docs/codex/03-team-join.md` | 일반 회원에서 팀 회원으로 작업 지시서 (끝남) | 팀 가입에서 왜 그렇게 했는지 확인할 때 |
| `docs/codex/04-seed.md` | 목 데이터와 관리자 계정 작업 지시서 (끝남) | 시드에서 왜 그렇게 했는지 확인할 때 |
| `docs/codex/05-booking.md` | 공간 찾기와 예약 작업 지시서 (끝남) | 예약에서 왜 그렇게 했는지 확인할 때 |
| `docs/codex/06-space-admin.md` | 운영자의 지점·층·공간 관리 작업 지시서 (끝남) | 운영자 공간 관리에서 왜 그렇게 했는지 확인할 때 |
| `docs/codex/07-speed-and-loading.md` | 조회 속도, 공통 틀, 로딩 상태 작업 지시서 (끝남) | 로딩과 속도에서 왜 그렇게 했는지 확인할 때 |
| `docs/codex/08-member-screens.md` | 멤버 화면 다시 짜기 작업 지시서 (끝남) | 멤버 화면에서 왜 그렇게 했는지 확인할 때 |
| `docs/codex/09-admin-auth-screens.md` | 운영자 화면과 로그인 화면 다듬기 작업 지시서 (끝남) | 그 화면에서 왜 그렇게 했는지 확인할 때 |
| `docs/codex/10-photos-and-look.md` | 공간 사진과 전체 인상 작업 지시서 (끝남) | 사진과 토큰에서 왜 그렇게 했는지 확인할 때 |
| `docs/codex/11-floor-timetable.md` | 층 화면: 날짜 달력, 시간표, 목록과 공간 상세 작업 지시서 (끝남) | 층 화면에서 왜 그렇게 했는지 확인할 때 |
| `docs/codex/12-calendar-home-branches.md` | 내 예약 달력, 홈, 지점 목록 작업 지시서 (끝남) | 그 화면에서 왜 그렇게 했는지 확인할 때 |
| `docs/codex/13-timetable-space-detail.md` | 시간표에서 공간 칸을 눌러 공간 상세를 여는 작업 지시서 (끝남) | 상세 시트와 공유 입력에서 왜 그렇게 했는지 확인할 때 |
| `docs/codex/14-attendees-and-filter.md` | 예약의 사용 인원, 인원으로 공간 거르기 작업 지시서 (끝남) | 그 작업에서 왜 그렇게 했는지 확인할 때 |
| `docs/codex/15-desk-booking.md` | 오픈 데스크 좌석 예약(오전·오후·종일, 좌석 배치도) 작업 지시서 (끝남) | 그 작업에서 왜 그렇게 했는지 확인할 때 |
| `docs/codex/16-participants.md` | 예약에 참석자 초대(사람 찾기, 초대받은 예약, 참석 안 함) 작업 지시서 (끝남) | 그 작업에서 왜 그렇게 했는지 확인할 때 |
| `docs/codex/17-notifications.md` | 알림(머리글의 종, 알림 목록, 미리 알림) 작업 지시서 (끝남) | 그 작업에서 왜 그렇게 했는지 확인할 때 |
| `docs/codex/18-edit-booking.md` | 예약 바꾸기(시간, 인원, 참석자, 제목) 작업 지시서 (끝남) | 그 작업에서 왜 그렇게 했는지 확인할 때 |
| `docs/codex/19-app-shell.md` | 앱의 틀(레일 + 사이드바, 위 줄, 서랍) 작업 지시서 | 그 작업을 받았을 때 |
| `docs/codex/20-chat-foundation.md` | 채팅 기반(테이블, 팀 스페이스, 텍스트 채널, Ably) 작업 지시서 | 그 작업을 받았을 때 |
| `docs/spec/ui.md` | 화면 구성, 로딩 상태(스켈레톤, 바뀌는 부분만 바꾸기), 조회 속도 예산, 화면별 구성과 문구 | 화면이나 조회 함수를 만질 때 |
| `docs/spec/ui-2.md` | 화면 구성 2차: 공간 사진, 날짜 달력, 층 시간표, 내 예약 달력, 홈·지점 목록·공간 상세. `ui.md`와 다르면 이 문서가 맞다 | 화면이나 조회 함수를 만질 때 |
| `docs/spec/auth.md` | 가입, 로그인, 세션, 운영자 계정, 팀 회원이 되는 세 가지 길 | 인증·세션·팀 가입을 만질 때 |
| `docs/spec/booking.md` | 지점 → 층 → 공간 → 예약 흐름, 사용자 행동별 데이터, 시간 규칙, 한도 | 공간 목록·예약을 만질 때 |
| `docs/spec/booking-2.md` | 예약 2차: 예약 프로세스 전체, 좌석 예약, 사용 인원, 인원으로 거르기, 참석자 초대, 알림, 예약 바꾸기. `booking.md`와 다르면 이 문서가 맞다 | 예약·내 예약·알림을 만질 때 |
| `docs/spec/chat.md` | 채팅·통화·자료 공유의 정의와 앱의 틀(레일과 사이드바). 지시서가 나온 범위만 구현 대상이다 (지시서 19: 앱의 틀, 20: 채팅 기반). 앱의 틀에 대해 `ui.md`, `ui-2.md`와 다르면 이 문서가 맞다 | 앱의 틀이나 채팅을 만질 때 |
| `docs/spec/space-admin.md` | 운영자가 지점·층·공간·이용 대상을 입력하는 규칙 | 운영자 화면을 만질 때 |
| `docs/spec/data-model.md` | 테이블, 컬럼, 제약 | DB 스키마·쿼리를 만질 때 |
| `docs/spec/server.md` | Server Actions 규칙, 결과 타입, 데이터 접근 계층, 세션, 메일, 실시간 | 서버 코드를 만질 때 |
| `docs/spec/roles-and-access.md` | 역할 4개, 권한 키, 기본값, 층·공간 접근 범위 | 권한·접근 판정을 만질 때 |
| `docs/spec/floor-plan.md` | 평면도 JSON 형식과 검증 규칙 | 평면도 스키마·렌더러·편집기를 만질 때 |
| `docs/spec/design-tokens.md` | 색, 타이포, 간격, shadcn 변수 매핑 | UI를 만질 때 |
| `docs/design/floor-*.png` | 처음 그린 화면 시안 9장, 다이어그램 4장 | 화면을 만들 때 참고 |
| `docs/design/ui-*.png` | 07–09의 시안 11장 (홈, 지점, 층, 내 예약, 팀, 로딩, 좁은 화면). `docs/spec/ui.md`와 같이 본다 | 팀 화면과 로딩 상태를 볼 때 |
| `docs/design/ui2-*.png` | 화면 구성 2차의 시안 8장 (층 시간표, 시간표에서 연 공간 상세, 층 목록과 공간 상세, 날짜 달력, 내 예약 달력, 홈, 지점 목록, 좁은 화면). `docs/spec/ui-2.md`와 같이 본다. 같은 화면이 `ui-*.png`에도 있으면 이쪽이 맞다 | 멤버 화면을 만들 때 |
| `docs/design/ui3-*.png` | 예약 2차의 시안 9장 (예약 프로세스, 시간표의 데스크 구역, 좌석 고르기, 인원으로 거르기, 예약 양식, 내 예약, 알림, 예약 바꾸기, 좁은 화면). `docs/spec/booking-2.md`와 같이 본다 | 예약 2차의 화면을 만들 때 |
| `docs/design/ui4-*.png` | 채팅과 앱의 틀 시안 9장 (레일과 사이드바, 텍스트 채널, 친구, 통화, 회의 채널, 오른쪽 시트, 파일, 초대, 좁은 화면). `docs/spec/chat.md`와 같이 본다. 채팅이 들어온 뒤의 모습이라 지시서 19에서는 틀만 참고한다 | 앱의 틀과 채팅 화면을 만들 때 |
| `docs/spec/examples/seed-chat.json` | 채팅의 시드: 팀 스페이스 `일반`의 메시지 | 시드를 만질 때 |
| `docs/spec/examples/seed-bookings-2.json` | 예약 2차의 시드: 사용 인원, 참석자, 좌석 예약, 좌석 점검 | 시드를 만질 때 |
| `docs/spec/examples/seed-photos.json`, `public/seed/photos/` | 공간 사진과 지점 대표 사진의 시드와 그림 파일 29개 | 사진을 만질 때 |
| `docs/jira-issues.md` | Jira 이슈 105개의 키·제목·에픽 사본 | 커밋에 붙일 이슈 키를 찾을 때, 작업 범위를 확인할 때 |

## 기술 스택 (확정)

- Next.js 16 (App Router), React 19, TypeScript strict. 이미 설치된 버전을 유지한다
- Tailwind CSS + shadcn/ui (Radix 기반). 아이콘은 lucide-react
- zod (입력·환경 변수·평면도 JSON 검증), Zustand (클라이언트 상태), @tanstack/react-query (서버 상태)
- 실시간: Ably (지시서 20부터. 키가 없으면 꺼진다)
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
| `pnpm admin:create` | 운영자 계정 생성 |
| `pnpm db:seed` | 허용한 개발 DB에 가상 데이터와 계정 넣기. 원격 DB는 `SEED_ALLOW_HOST`가 필요하고 배포 환경에서는 실행되지 않는다 |

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
lib/time/            시간대 계산과 운영 시간 (순수 함수)
lib/spaces/          편의 시설 목록 같은 공간 공통 값
lib/seed/            시드 데이터 읽기·검증과 실행 함수
lib/permissions/     권한 키, 기본값, can(), canAccess()
lib/actions/         Server Action 래퍼와 결과 타입
lib/realtime/        발행·구독 인터페이스, Ably 서버·브라우저 구현
lib/rate-limit/      메모리 요청 제한기 (참석자 찾기, 메시지 보내기, 실시간 토큰)
lib/floor-plan/      평면도 zod 스키마와 검증
lib/env.ts           zod로 검증한 환경 변수
drizzle/             생성된 마이그레이션 SQL
scripts/             운영자 계정 생성·시드 실행과 인자·환경 검사
tests/               단위·통합 테스트(tests/unit, tests/db), e2e(tests/e2e)
docs/                명세와 작업 지시서
```

## 반드시 지킬 규칙

서버

- 쓰기는 전부 Server Actions로 한다. 별도 API 서버를 만들지 않는다.
- 첫 화면 데이터는 Server Component에서 `features/*/queries.ts`의 읽기 함수를 불러 읽는다. queries가 `lib/dal`과 `canAccess()`를 쓴다. 읽기에 Server Action을 쓰지 않는다.
- Route Handler는 캐시되는 GET(게시된 평면도 JSON, 이전 메시지), 외부 웹훅, Better Auth(`app/api/auth/[...all]/route.ts`), 화면이 떠 있는 동안 되풀이해 읽는 두 가지 GET(참석자 찾기 `/api/participants/search`, 알림 `/api/notifications`. `docs/spec/booking-2.md`), 그리고 실시간 토큰 `POST /api/realtime/token`(Ably 토큰 요청. DB에 쓰지 않는다. `docs/spec/chat.md`)에만 쓴다. 참석자 찾기, 알림, 실시간 토큰은 캐시하지 않고(`private, no-store`), `features/*/queries.ts`의 함수를 부르기만 하며, 세션은 그 함수가 확인한다. 이 목록에 없는 읽기를 Route Handler로 만들지 않는다. 가입·로그인·로그아웃은 Better Auth가 처리하므로 Server Action 래퍼를 거치지 않는다. 그 밖의 쓰기는 예외가 없다.
- Better Auth를 직접 부르는 곳은 `lib/auth/*`, 인증의 Route Handler(`app/api/auth/[...all]/route.ts`), 브라우저용 인증 클라이언트(`lib/auth/client.ts`)뿐이다. 다른 코드는 `getSession()`, `requireSession()`, `requirePageSession()`, `requireOperatorPage()`만 쓴다.
- 모든 Server Action은 누구나 호출할 수 있는 공개 POST 주소로 취급한다. 순서는 세션 확인 → zod 검증 → 권한 확인 → 실행이고, `lib/actions`의 래퍼로만 만든다.
- 액션은 예외를 던지지 않고 `{ ok: true, data }` 또는 `{ ok: false, code }`를 돌려준다. 코드 목록은 `docs/spec/server.md`에 있다.
- 클라이언트가 보낸 사용자 id, 역할, 소유자 값을 믿지 않는다. 서버가 세션으로 다시 조회한다.
- `lib/db`는 `lib/db`, `lib/dal`, `lib/auth/auth.ts`, `drizzle.config.*`, `tests/db` 안에서만 import한다. ESLint 규칙으로 막아 둔다.
- `import 'server-only'`는 `lib/db/client.ts`, `lib/dal/*`, `lib/auth/auth.ts`, `lib/auth/session.ts`, `lib/auth/operators.ts`, `lib/permissions/context.ts`에만 넣는다. `lib/db/schema/*`(drizzle-kit이 Next.js 밖에서 직접 읽는다)와 순수 함수 파일(`keys.ts`, `defaults.ts`, `can.ts`, `can-access.ts`)에는 넣지 않는다. Vitest에서는 `server-only`를 빈 모듈로 alias한다.
- 권한은 `can()`, 층·공간 접근은 `canAccess()`로만 판정한다. Postgres RLS는 쓰지 않는다.
- 화면에서 버튼을 숨기는 것은 편의일 뿐이고, 실제 차단은 서버에서 한다.

DB

- 스키마 변경은 `lib/db/schema`를 고치고 `pnpm db:generate`로 SQL을 만든다. 이미 커밋된 마이그레이션 파일은 고치지 않는다. 방금 만든(아직 커밋하지 않은) SQL에 기존 행을 맞추는 문장을 손으로 더하는 것은 지시서가 시킬 때만 한다.
- 부분 유니크 인덱스, CHECK, 순환 FK, gist 인덱스는 Drizzle 스키마에 선언한다. Drizzle로 표현할 수 없는 것(확장 설치, EXCLUDE 제약)만 손으로 쓴 마이그레이션에 넣는다. 제약마다 `tests/db`에 확인하는 테스트를 둔다.
- 예약 겹침은 DB의 EXCLUDE 제약이 최종 방어선이다. 애플리케이션 코드의 사전 검사로 대신하지 않는다. 시드 스크립트만 예외로, 자기 예약을 넣기 전에 겹침을 조회해 건너뛴다.
- 예약 행은 지우지 않고 취소한다. 시드 스크립트가 자기 id의 예약을 지우고 다시 넣는 것만 예외다.
- 상태를 바꾸는 쓰기(취소, 승인, 수락, 보관)는 "지금 그 상태일 때만 바꾸는" `UPDATE … WHERE … RETURNING` 한 문장으로 한다. 먼저 읽고 나서 바꾸지 않는다. 개수 한도와 "예약이 있으면 안 됨" 같은 검사는 같은 트랜잭션에서 기준 행을 잠근 뒤 센다.
- 날짜와 시각 계산은 지점의 시간대로 하고 `lib/time`의 함수를 쓴다. 서버나 브라우저의 시간대에 기대는 호출(`getHours()`, 시간대 없는 `toLocaleString()` 등)을 쓰지 않는다.
- 현재 시각이 결과를 바꾸는 쓰기와 조회는 SQL의 `now()`를 쓰지 않고, 함수가 받은 현재 시각을 바인딩한다. 테스트가 시각을 고정한다.
- 여러 행을 잠글 때의 순서는 층 → 공간 → 사용자·팀이다.
- id는 uuid, 시간은 `timestamptz`, 예약·점검 시간은 `tstzrange`(`[시작, 끝)`)다. DB는 snake_case, TypeScript는 camelCase다.

UI

- 화면 문구는 한국어 해요체로 쓴다. `<html lang="ko">`.
- 색은 `docs/spec/design-tokens.md`의 토큰만 쓴다. 컴포넌트에 hex 값을 직접 쓰지 않는다.
- 색은 의미가 있을 때만 쓴다. 공간 상태(비어 있음, 사용 중, 내 예약, 점검 중, 전용 공간), 초대의 수락 대기, 읽지 않은 알림의 수, 강조 버튼 외에는 무채색이다.
- 기본 컴포넌트는 shadcn/ui를 쓴다. 같은 역할의 컴포넌트를 새로 만들지 않는다.
- 키보드로 모든 동작이 가능해야 하고, 포커스 표시를 없애지 않는다. 기본 컨트롤 높이는 44px이고, 더 작은 컨트롤은 누를 수 있는 영역을 44px로 넓힌다. 예외는 둘이다: 공간 상세의 하루 일정에서 빈 칸의 높이는 1024px 이상의 패널에서 28px이고(시트에서는 44px. `docs/spec/ui.md`), 층 시간표에서 빈 칸의 폭은 1024px 이상에서 34px이다(그보다 좁으면 44px. `docs/spec/ui-2.md`).
- 사진은 `next/image`로 그리고 대체 글을 넣는다. 사진의 경로는 사이트 안의 경로만 받는다 (`docs/spec/ui-2.md`의 "사진"). 접근할 수 없는 공간의 사진을 내려보내지 않는다.
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

## 로딩과 속도

자세한 것은 `docs/spec/ui.md`에 있다. 화면이나 조회를 만질 때 언제나 지킨다. `docs/spec/ui-2.md`가 더하는 화면에도 똑같이 적용된다.

- 제목·탭·요일·일반 탐색 링크처럼 데이터 없이 알 수 있는 UI는 먼저 그린다. `<Suspense>`는 모르는 값의 자리만 같은 크기의 스켈레톤으로 채운다. 화면 전체를 무조건 스켈레톤으로 바꾸거나 글자 한 줄로 대체하지 않는다. 이름·건수·권한별 동작은 조회 뒤에만 표시한다.
- 달력은 시간대 메타데이터 뒤에 실제 날짜와 이동을 먼저 제공하고, 같은 서버 Promise로 예약 표시를 나중에 채운다. 로딩을 빈 예약 목록으로 취급하지 않는다. 날짜 링크·입력의 DOM과 포커스를 데이터 도착 때문에 다시 만들지 않는다.
- Activity에 보존된 지점 Workspace는 서버가 준 `branchId`와 해당 레이아웃의 `useSelectedLayoutSegments()`로 범위를 정한다. 다른 화면의 전역 경로·검색 값으로 이전 선택을 초기화하거나 늦은 응답으로 현재 URL을 바꾸지 않는다.
- 공유 예약 초안·구간은 Workspace별 Zustand 저장소와 좁은 selector로 나눈다. URL·transition·서버 승인·Suspense는 React에 유지하며, 저장소를 전역 singleton이나 영구 저장으로 바꾸지 않는다. 로그아웃 성공 뒤에는 전체 문서 이동으로 이전 계정의 보존된 화면 상태를 비운다.
- 독립된 영역은 각자의 `<Suspense>`에서 따로 읽는다. 한 영역이 다른 영역의 조회를 기다리지 않는다.
- 주소만 바꾸는 이동(탭, 날짜, 목록의 선택)은 누른 즉시 선택 표시가 바뀌고, 바뀌는 영역만 스켈레톤이 된다. 항목은 `<a href>`로 남긴다.
- 한 요청 안에서 같은 조회를 두 번 하지 않는다. 세션과 내 소속은 React의 `cache()`로 요청 단위로 한 번만 읽는다. `cache()`는 요청이 끝나면 버려지므로 써도 된다. `use cache`는 여전히 쓰지 않는다.
- 서로 기다릴 필요가 없는 조회는 `Promise.all`로 같이 보낸다. 조회 함수는 `docs/spec/ui.md`의 단계 예산(대부분 세션 확인 뒤 2단계) 이하여야 하고, `tests/db`의 단계 테스트로 확인한다. 한 단계에 같이 보내는 문장은 6개까지다. 반복문 안에서 조회를 `await`하지 않는다.
- 속도를 위해 권한 확인을 빼거나, 보여주면 안 되는 값을 읽어 온 뒤 코드나 화면에서 가리지 않는다. 클라이언트 컴포넌트에 넘기는 값은 화면에 쓸 필드만 담는다.
- 클라이언트 컴포넌트는 렌더링 중에 `new Date()`, `Date.now()`를 부르지 않는다. 오늘과 지금은 서버가 props로 내려준다.

## 하지 않는 것

- 지시서에 없는 기능 화면, 평면도 렌더러, 채팅, 영상 통화를 만들지 않는다.
- 비밀번호, 세션 토큰, 인증·재설정 링크를 로그나 오류 메시지에 남기지 않는다. 예외는 둘뿐이다: 개발용 콘솔 메일 구현이 메일 본문을 출력하는 것(배포 환경에서는 출력하지 않는다), `pnpm admin:create`가 새로 만든 비밀번호를 표준 출력에 한 번 출력하는 것.
- 비밀 값을 커밋하지 않는다. `.env*`는 `.env.example`만 커밋한다. `docs/spec/examples/seed.json`과 README에 적힌 시드 계정의 비밀번호는 비밀 값이 아니다. 개발용 가상 계정의 값이고, 시드는 배포 환경에서 실행되지 않는다.
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
