# 작업 지시서 05 — 공간 찾기와 예약

지시서 04(목 데이터와 관리자 계정)가 끝난 뒤에 한다. `lib/time/`과 `lib/seed/`가 없으면 시작하지 말고 알린다.

## 목표

멤버가 지점을 고르고, 층을 고르고, 공간 목록에서 공간을 골라 시간을 예약한다. 끝났을 때 아래가 모두 참이어야 한다.

- 홈에서 "공간 예약하기"로 들어가 지점 → 층 → 공간 → 시간 순으로 골라 예약할 수 있다.
- 예약은 "개인으로" 또는 "팀 이름으로" 하고, 역할별 한도와 전용 공간 규칙이 서버에서 지켜진다.
- 겹치는 예약은 DB 제약이 막고, 화면은 이유에 맞는 문구를 보여준다.
- 내 예약을 보고 취소할 수 있다.
- 내가 쓸 수 없는 공간의 이름과 일정, 남의 예약 제목이 응답에 실리지 않는다.

평면도(Canvas)는 만들지 않는다. 공간은 목록으로 보여준다.

## 시작 전에

1. `AGENTS.md`를 읽는다.
2. `docs/spec/booking.md`를 처음부터 끝까지 읽는다. 이 작업의 기준 문서다.
3. `docs/spec/data-model.md`의 `users`, `branches`, `floors`, `spaces`, `bookings`, `space_blocks`, `role_settings`, `access_grants`와 "테스트로 확인할 제약" 15–16을 읽는다.
4. `docs/spec/roles-and-access.md`의 `can()`, "예약 한도", `canAccess()`를 읽는다. `docs/spec/server.md`의 액션 래퍼, 결과 코드, "실시간"을 읽는다.
5. `docs/spec/design-tokens.md`의 공간 상태 표와 판정 순서를 읽는다.
6. `docs/design/floor-main.png`를 본다. 오른쪽 패널이 공간 상세의 기준이다. 이미지를 열 수 없으면 `docs/spec/booking.md`의 "화면"만으로 진행하고 보고에 적는다.
7. 지금 코드를 읽는다: `lib/time/`, `lib/permissions/`, `lib/dal/`, `lib/actions/`, `lib/realtime/`, `lib/db/range.ts`, `lib/seed/`, `features/teams/`, `app/(app)/`, `components/status-badge.tsx`.

## 환경에 대한 전제

- 실제 DB가 없다. 검증은 PGlite로 한다. 브라우저에서의 실제 흐름은 "확인 못 함"으로 보고한다.
- PGlite는 연결이 하나라 진짜 동시 실행을 재현하지 못한다. 겹침과 한도는 연달아 넣는 테스트로 확인하고, 동시 부하 검증은 PFQV-26에서 실제 DB로 한다. 그래도 잠금과 조건이 붙은 `UPDATE`는 명세대로 넣는다.

## 범위

| 단계 | 내용 | Jira |
| --- | --- | --- |
| 1 | 스키마 변경, 결과 코드, 시드 함수 맞추기 | PFQV-23 |
| 2 | 예약 시간 규칙 (순수 함수) | PFQV-70 |
| 3 | 한도와 전용 공간 규칙 (순수 함수) | PFQV-62 |
| 4 | 데이터 접근 계층 | PFQV-23 |
| 5 | 예약하기, 취소하기, 기본 지점 저장 | PFQV-23, PFQV-25 |
| 6 | 조회 | PFQV-69 |
| 7 | 화면 | PFQV-69, PFQV-22, PFQV-25 |
| 8 | 문서와 마무리 | PFQV-23 |

이 작업은 두 번에 나눠 맡길 수 있다: 1–6단계(서버)와 7–8단계(화면). 프롬프트가 단계 범위를 정해 주면 그 범위만 하고, 멈출 때도 완료 기준의 검사를 돌려 보고한다.

단계마다 커밋한다. 5단계는 커밋을 둘로 나눈다: 예약하기와 기본 지점 저장은 PFQV-23, 취소하기는 PFQV-25. 7단계는 셋으로 나눈다: 지점·층·공간 목록은 PFQV-69, 공간 상세와 예약 양식은 PFQV-22, 내 예약은 PFQV-25.

## 범위 밖 (하지 않는다)

`docs/spec/booking.md`의 "아직 하지 않는 것" 전부. 특히:

- 평면도 렌더러, "평면도 / 리스트" 전환
- 좌석 예약, 예약 시간 변경, 연장, 반복 예약
- 타임라인에서 끌어서 고르기, 낙관적 반영, 대안 시간 제안, 실시간 구독
- 예약 채팅방, 알림
- 운영자와 팀 관리자가 남의 예약을 모아 보는 화면
- 점검 등록 (시드가 넣은 점검만 있다)

## 단계

### 1. 스키마 변경, 결과 코드, 시드 함수 맞추기

`docs/spec/data-model.md`를 따른다. 새 마이그레이션을 만든다.

- `users.default_branch_id` (FK → branches, on delete set null). Better Auth의 필드로 등록하지 않는다. 가입·로그인 테스트가 그대로 통과해야 한다.
- `bookings.cancelled_at`, `bookings.cancelled_by`, CHECK `bookings_cancel_consistent`. CHECK를 더하기 전에 같은 마이그레이션에서 이미 `cancelled`인 행의 `cancelled_at`을 `created_at`으로 채운다. `pnpm db:generate`가 만든 SQL 파일에 이 `UPDATE` 한 문장을 CHECK 앞에 손으로 넣는다. 아직 커밋하지 않은 마이그레이션이므로 고쳐도 된다.
- 같은 커밋에서 시드 함수를 고친다: 취소된 예약의 `cancelled_at`(받은 현재 시각)과 `cancelled_by`(`cancelledByKey`의 사용자)를 채운다. 고치지 않으면 CHECK 때문에 04의 시드 테스트가 깨진다. 시드 테스트에 확인을 더한다. `seed.json`은 고치지 않는다.
- `tests/db/constraints.test.ts`에 제약 15–16을 더한다.
- `lib/actions/result.ts`에 `OUTSIDE_HOURS`, `SPACE_IN_USE`를 더한다. `SPACE_IN_USE`는 06에서 쓴다.
- `pnpm db:generate`를 다시 돌렸을 때 새 파일이 생기지 않아야 한다.

### 2. 예약 시간 규칙

`features/bookings/rules.ts`에 순수 함수로 만든다. 04의 `lib/time/`을 쓴다. 현재 시각은 인자로 받는다.

- 입력: 지점의 시간대와 운영 시간, 시작과 끝, 현재 시각. 결과: 통과 또는 이유(`not_aligned`, `not_same_day`, `in_past`, `outside_hours`, `closed_day`, `too_short`).
- 어떤 날짜에 고를 수 있는 30분 칸의 목록을 만드는 함수도 둔다. 화면의 선택 상자와 타임라인이 같이 쓴다.
- 단위 테스트: 분이 15인 시작, 초가 있는 시각, 끝이 시작과 같거나 앞, 자정을 넘는 예약, 지금 칸의 시작(통과)과 그 앞 칸(실패), 운영 시작 전과 종료 후, 쉬는 날, `24:00`에 끝나는 예약, 운영 시간이 `{}`인 지점의 기본값, `America/New_York` 서머타임 전환일.

### 3. 한도와 전용 공간 규칙

`features/bookings/limits.ts`와 `features/bookings/access.ts`에 순수 함수로 만든다. `docs/spec/booking.md`의 "예약 한도"와 "전용 공간"을 따른다.

- 어느 역할의 한도를 쓸지 정하는 함수: 팀 이름으로 → `team_member`, 개인으로 → 그 지점 운영자면 `operator`, 아니면 `user`. 값은 그 지점의 `role_settings.limits`에서 키별로 읽고, 키가 없으면 코드 기본값, null이면 제한 없음.
- 한도 검사: 예약 길이, 그날 이미 쓴 분, 시작 날짜와 오늘의 차이를 받아 통과 또는 `per_booking`, `per_day`, `days_ahead`를 돌려준다.
- 남은 시간 계산: 화면의 "오늘 1시간 남음"에 쓴다.
- 예약 방식 검사: 공간과 층의 이용 대상·허용 팀, 내 소속, `teamId`를 받아 이 방식으로 예약할 수 있는지 돌려준다. `canAccess()`를 다시 만들지 말고 그 위에 "전용 공간은 허용된 팀 이름으로만"을 더한다.
- 내가 이 공간에서 고를 수 있는 방식의 목록(개인, 팀들)을 만드는 함수도 둔다.
- 단위 테스트는 표로 쓴다. 한도: 기본값, `role_settings`로 일부 키만 바꾼 경우, null, 0일 앞, 딱 한도와 1분 초과. 방식: 모두인 공간 × (팀 없음, A팀, A·B팀), A팀 전용 × (개인, A팀으로, B팀으로, 내 팀이 아닌 팀으로), 층이 A·B팀이고 공간이 A팀, 닫힌 공간, 운영자.

### 4. 데이터 접근 계층

`lib/dal/bookings.ts`, `lib/dal/branches.ts`, `lib/dal/spaces.ts`에 필요한 함수만 만든다. DAL은 권한을 판정하지 않는다.

- 지점 목록, 지점 하나, 지점의 층과 층별 허용 팀, 층의 공간과 공간별 허용 팀(보관된 것과 좌석 제외 옵션), 구역별 좌석 수.
- 어떤 범위와 겹치는 예약(공간 하나, 층 전체)과 예약자·팀 이름. 범위 겹침은 `&&` 연산자로 읽는다. `lib/db/range.ts`의 타입을 쓴다.
- 어떤 범위와 겹치는 점검.
- 그날의 예약 분 합계: 지점, 날짜 범위, (사용자의 개인 예약 | 팀의 예약). 확정 예약만 센다. 합계는 SQL에서 구간의 길이로 계산한다.
- 예약 넣기, 조건이 붙은 취소(`UPDATE … WHERE status = 'confirmed' AND upper(during) > $now RETURNING`), 예약 하나와 그 공간·층·지점. 현재 시각은 DB의 `now()`를 쓰지 않고 인자로 받아 바인딩한다.
- 행 잠금: 공간 `FOR SHARE`, 사용자 또는 팀 `FOR UPDATE`. 트랜잭션 안에서만 부른다.
- 내 예약 목록(다가오는 것, 지난 것).
- `users.default_branch_id` 읽기와 쓰기.
- 통합 테스트: 맞닿은 예약은 겹침 조회에 걸리지 않는다. 합계가 취소된 예약, 다른 지점, 다른 날, 다른 사람의 예약을 세지 않는다. 취소 `UPDATE`를 두 번 하면 두 번째는 0행이다.

### 5. 예약하기, 취소하기, 기본 지점 저장

`features/bookings/`에 입력 스키마, 일을 하는 함수, 액션을 둔다.

- 실제 일은 의존성을 주입받는 함수가 한다 (조회도 현재 시각이 필요하면 같은 방식으로 받는다). DB, 현재 시각, `RealtimePublisher`를 인자로 받는다 (기본값은 실제 것). `actions.ts`는 `createAction`으로 감싸기만 한다. 테스트는 그 함수에 PGlite, 고정된 시각, 메모리 발행 구현을 넣어 돌린다. 파일을 나누는 방식과 이름은 `features/teams/`가 이미 쓰는 방식(`*-factory.ts`)을 따른다.
- 잠그는 순서는 언제나 층 → 공간 → 사용자·팀이다.
- `createBooking`: `docs/spec/booking.md`의 "예약할 때 확인하는 순서" 10단계를 그 순서대로 구현한다. 순서가 바뀌면 돌려주는 코드가 달라진다. 시간 규칙 안의 순서와 한도 안의 순서도 명세에 있다.
- `LIMIT_EXCEEDED`의 `message`에는 `per_booking`, `per_day`, `days_ahead` 중 하나를 넣는다.
- 입력의 `start`, `end`는 오프셋이 붙은 ISO 8601만 받는다. 오프셋이 없는 문자열은 `INVALID_INPUT`이다.
- 이벤트 발행은 커밋 뒤에 한다. 발행이 예외를 던져도 결과는 성공이다.
- `cancelBooking`, `setDefaultBranch`: 명세 그대로.

통합 테스트 (`tests/db`). 데이터는 테스트마다 필요한 만큼만 직접 넣거나 04의 시드 함수를 쓴다.

- 성공: 개인 예약, 팀 예약. `bookings` 행의 `user_id`, `team_id`, `during`이 맞고 이벤트가 한 번 발행된다.
- 결과 코드마다 한 가지 이상: `UNAUTHENTICATED`, `INVALID_INPUT`(형식, 30분 칸, 지난 시간, 하루 넘김, 예약 불가 공간, 좌석), `NOT_FOUND`(없는 공간, 보관된 공간), `FORBIDDEN`(접근 불가, 전용 공간에 개인으로, 다른 팀 이름으로, 내 팀이 아닌 `teamId`), `OUTSIDE_HOURS`(운영 시간 밖, 쉬는 날), `LIMIT_EXCEEDED`(세 가지), `SPACE_BLOCKED`, `BOOKING_CONFLICT`.
- 같은 시간을 연달아 두 번 예약하면 두 번째가 `BOOKING_CONFLICT`이고 행은 하나다. 맞닿은 시간은 둘 다 성공한다.
- 하루 한도: 개인 60분 + 60분은 성공, 다음 30분은 `LIMIT_EXCEEDED`. 취소하면 다시 된다. 다른 지점의 예약은 세지 않는다. 팀 한도는 팀원 두 명의 예약을 합쳐서 센다. 운영자는 한도가 없다. `role_settings.limits`를 바꾸면 바뀐 값이 적용된다.
- 확인 순서: 접근할 수 없는 공간에 지난 시간으로 요청하면 `FORBIDDEN`이다 (`INVALID_INPUT`이 아니다).
- 취소: 본인 성공, `cancelled_at`과 `cancelled_by`가 채워진다. `role_settings`로 `booking.own`이 꺼진 지점에서도 본인은 취소된다. 팀이 그 공간의 이용 대상에서 빠진 뒤에도 그 팀의 팀 관리자는 팀 예약을 취소할 수 있다. 팀 예약을 그 팀의 팀 관리자가 취소하면 성공하고 `cancelled_by`가 팀 관리자다. 같은 팀의 일반 팀원이 남의 팀 예약을 취소하면 `FORBIDDEN`. 그 지점 운영자는 성공. 다른 지점의 운영자는 일반 사용자와 같아서, 접근할 수 있는 공간의 남의 예약이면 `FORBIDDEN`, 접근할 수 없는 공간의 예약이면 `NOT_FOUND`. 끝난 예약과 이미 취소된 예약은 `NOT_FOUND`. 두 번 취소하면 두 번째는 `NOT_FOUND`.
- 기본 지점: 저장된다. 없는 지점은 `NOT_FOUND`.

### 6. 조회

`features/bookings/queries.ts`. `docs/spec/booking.md`의 "조회" 표의 함수 여섯 개다. 모든 함수가 `requireSession()`을 직접 부르고 `use cache`를 붙이지 않는다.

- 공간 상태 판정(전용 공간 > 점검 중 > 사용 중 > 내 예약 > 비어 있음)은 순수 함수로 빼서 단위 테스트를 둔다.
- 층을 읽는 함수는 층 행에서 지점을 읽어 판정하고, 인자로 받은 `branchId`와 다르면 `NOT_FOUND`다. `can(ctx, 'floor.view', { branchId })`가 false여도 `NOT_FOUND`다.
- 접근할 수 없는 공간은 id와 종류만 담는다. 이름, 정원, 편의 시설, 예약을 읽어서 버리는 것이 아니라 결과에 넣지 않는다. 타입으로도 구분한다 (예: `{ kind: 'restricted'; id; type }`).
- 남의 예약에서 제목을 빼는 규칙도 여기서 적용한다.
- 통합 테스트: 김하은(팀 없음)의 7층 결과에 "회의실 A"라는 문자열이 없다 (결과를 JSON으로 바꿔 확인). 그로스팀 팀원의 결과에는 있다. 팀 없음 사용자의 층 목록에 8층이 없다. 남의 예약 제목이 없다. 같은 팀의 팀 예약 제목은 있다. 운영자는 제목을 모두 본다. 보관된 공간과 좌석이 목록에 없다. 데스크 구역에 좌석 수가 나온다. 접근할 수 없는 층의 `getFloorDay`와 공간의 `getSpaceDay`는 `NOT_FOUND`. `getMyBookings`가 다가오는 것과 지난 것을 나누고 취소된 것을 포함한다. `getBookingEntry`의 세 경우(기본 지점, 팀의 주 이용 지점, 없음).

### 7. 화면

`docs/spec/booking.md`의 "주소", "공간 목록에 보이는 것", "화면", "화면 문구"를 따른다. 색은 토큰만 쓰고 상태는 `StatusBadge`로 보여준다.

- 모든 페이지가 `requirePageSession('<자기 경로>')`를 부른다. `params`와 `searchParams`는 `<Suspense>` 아래에서 읽는다.
- `proxy.ts`의 `matcher`에 `/branches/:path*`와 `/bookings`를 더하고 `tests/unit/proxy.test.ts`에 확인을 더한다.
- 홈(`/`): "공간 예약하기" 카드를 맨 위에 더한다. 03에서 만든 팀 관련 내용은 그 아래에 그대로 둔다.
- 머리글: "홈", "공간 예약"(`/branches`), "내 예약" 링크. 지금 있는 곳은 `aria-current="page"`. 이 표시는 `usePathname`을 쓰는 클라이언트 컴포넌트로 빼고 `<Suspense>`로 감싼다.
- 지점 목록(`/branches`): 지점마다 이름, 주소, 오늘 운영 시간. 고르면 `setDefaultBranch`를 부르고 성공하면 그 지점으로 간다.
- 지점(`/branches/[branchId]`): 쓸 수 있는 첫 층으로 보낸다. 없으면 안내 문구.
- 층(`/branches/[branchId]/floors/[floorId]`): 위쪽 줄(지점, 층 탭, 날짜), 공간 목록, 공간 상세. 지점·층·날짜·공간 선택은 모두 링크이고 상태는 주소에 있다.
- 공간 상세: 이름, "N층 · 최대 N인", 편의 시설, 하루 일정 타임라인(내가 취소할 수 있는 예약에는 "취소"), 시작·끝 선택 상자, "개인으로 / 팀으로", 한도 한 줄, 제목 입력(선택), "예약하기".
- 타임라인의 칸은 버튼이다. 키보드로 이동하고 고를 수 있어야 하고, 각 칸에 "15:00, 비어 있음"처럼 읽히는 이름이 있어야 한다. 예약 블록은 시간과 예약자를 글자로 보여준다.
- 예약 양식은 클라이언트 컴포넌트다. 제출은 TanStack Query mutation 안에서 하고 `onSuccess`에서 `router.refresh()`를 부른다. 양식에는 공간 id와 날짜로 만든 `key`를 준다. 서버가 돌려준 코드를 문구로 바꾸는 함수는 순수 함수로 두고 테스트한다.
- 내 예약(`/bookings`): 명세대로. 취소는 `dialog`로 확인을 받는다.
- 필요한 shadcn 컴포넌트는 shadcn CLI로 더한다.
- 컴포넌트 테스트: 예약 양식에서 예약된 시각이 선택 상자에 나오지 않는다. 팀이 없으면 방식 선택이 보이지 않는다. 전용 공간에서는 "개인으로"를 고를 수 없다. `BOOKING_CONFLICT`, `LIMIT_EXCEEDED`(세 가지), `OUTSIDE_HOURS`의 문구가 나온다. 제출 중에는 버튼이 비활성이다.

### 8. 문서와 마무리

- `README.md`에 예약 흐름과 주소, 시간 규칙의 요약을 더한다.
- `tests/e2e`는 더하지 않는다. 실제 DB가 없어 로그인한 흐름을 돌릴 수 없다.

## 완료 기준

직접 실행해서 확인하고, 결과를 보고에 그대로 적는다.

| 확인 | 기준 |
| --- | --- |
| `pnpm lint` | 오류 0 |
| `pnpm typecheck` | 오류 0 |
| `pnpm test` | 전부 통과, 건너뛴 테스트 없음. 제약 15–16과 2–7단계의 테스트 포함 |
| `TZ=America/Los_Angeles pnpm test` | 전부 통과 |
| `pnpm build` | `DATABASE_URL`, `AUTH_SECRET` 없이 성공. Cache Components 관련 오류 없음 |
| `pnpm db:generate` | 새 마이그레이션 파일이 생기지 않음 |
| `git status` | 깨끗함 |
| 권한 | 모든 액션과 queries가 서버에서 세션과 접근을 확인함. 클라이언트가 보낸 지점·층 id로 권한을 판정하는 곳이 없음 |
| 노출 | 접근할 수 없는 공간의 이름과 일정, 남의 예약 제목이 응답에 없음. queries 테스트로 확인 |
| 겹침 | `features/bookings/`에 예약 겹침을 사전 조회로 판정하는 코드가 없음. `23P01`만 `BOOKING_CONFLICT`가 됨 (시드의 사전 조회는 예외) |
| 시계 | `lib/dal/bookings.ts`의 SQL에 `now()`가 없음. 현재 시각은 인자로 받음 |
| 시간 | 서버나 브라우저의 시간대에 기대는 코드가 없음 (`new Date().getHours()`, `toLocaleDateString()` 같은 호출을 `rg`로 확인) |
| 캐시 | `features/bookings/`에 `use cache`가 없음 |
| 보호 | 새 `page.tsx`가 모두 `requirePageSession()`을 부름 (목록을 보고에 적는다) |

브라우저에서의 실제 흐름은 "확인 못 함"으로 적고, 사람이 확인할 순서(시드 → 김하은으로 로그인 → 강남점 7층 → 회의실 C 예약 → 내 예약에서 취소 → 이서연으로 8층 예약)를 보고에 적는다.

## 막혔을 때

- 규칙이 문서에 없으면 더 안전한 쪽(덜 보여주고, 덜 허용하는 쪽)으로 정하고 보고에 적는다.
- 문서끼리 다르면 `AGENTS.md`, `docs/spec/booking.md`, 그 밖의 `docs/spec/`, 이 지시서 순으로 우선한다.
- 테이블, 컬럼, 제약, 결과 코드, 주소의 이름은 임의로 바꾸지 않는다.
- PGlite가 `FOR SHARE`나 범위 연산을 지원하지 않으면 그 부분을 빼지 말고 무엇이 안 되는지 알린다.

## 최종 보고

`AGENTS.md`의 "최종 보고 형식"을 따른다.
