# 작업 지시서 18 — 예약 바꾸기

지시서 17(알림)이 끝난 뒤에 한다. 예약 2차의 마지막 작업이다. `booking_participants`, `notifications`, 사용 인원 입력, 참석자 입력이 없으면 시작하지 말고 알린다.

## 목표

`docs/spec/booking-2.md`의 "예약 바꾸기"를 만든다. 끝났을 때 아래가 모두 참이어야 한다.

- 내 예약에서 "바꾸기"를 눌러 시간, 사용 인원, 참석자, 제목을 고친다. 취소하고 다시 잡지 않아도 된다.
- 시간을 바꾸면 새로 예약할 때와 같은 규칙(시간, 한도, 점검, 겹침)을 다시 본다.
- 이미 시작한 예약은 시간을 바꿀 수 없고 인원, 참석자, 제목만 바꾼다.
- 시간이 바뀌면 참석자에게 알림이 가고 미리 알림이 새 시간으로 다시 잡힌다. 참석자가 들어오고 나가면 그 사람에게 알림이 간다.

예약을 만드는 규칙과 취소하는 규칙은 바꾸지 않는다.

## 시작 전에

1. `AGENTS.md`를 읽는다.
2. `docs/spec/booking-2.md`의 "예약 프로세스"(특히 "예약의 상태", "예약할 때 확인하는 순서", "사용자 행을 잠그는 순서"), "사용 인원", "참석자 초대", "알림"(특히 "미리 알림"), "예약 바꾸기" 전체, "화면 문구"를 읽는다. "예약 바꾸기"가 이 작업의 기준이다.
3. `docs/spec/booking.md`의 "시간 규칙", "예약 한도", "액션"(`createBooking`의 순서, `cancelBooking`의 한 문장 UPDATE), `docs/spec/data-model.md`의 `bookings`를 읽는다.
4. `docs/spec/ui.md`의 "로딩 상태"와 "액션", `docs/spec/ui-2.md`의 "공간 상세"(하루 일정)를 읽는다.
5. `docs/design/ui3-edit.png`, `ui3-my-bookings.png`를 본다.
6. 지금 코드를 읽는다.
   - `features/bookings/`: `create-booking-factory.ts`, `cancel-booking-factory.ts`, `action-factory.ts`, `rules.ts`, `limits.ts`, `access.ts`, `schema.ts`, `query-factory.ts`(`getSpaceDay`), `selection.ts`, `day-grid.ts`, `types.ts`, `ui-errors.ts`
   - `features/bookings/components/`: `booking-form*.tsx`, `booking-timeline.tsx`, `use-booking-mutation.ts`, `booking-skeletons.tsx`, `my-bookings.tsx`, `my-bookings-calendar-panel.tsx`, 지시서 14의 사용 인원 입력, 16의 참석자 입력
   - `features/notifications/`와 `lib/dal/notifications.ts`(지시서 17의 만드는 함수와 DAL), 지시서 16의 참석자 DAL
   - `lib/dal/bookings.ts`(`sumBookedMinutes`, 잠금 함수들), `app/(app)/bookings/`
   - `proxy.ts`와 `tests/unit/proxy.test.ts`
   - 테스트: `tests/db/booking-actions.test.ts`(잠금 함수에 끼어드는 "rechecks … after locking the space" 테스트), `booking-cancel.test.ts`, 지시서 16·17의 테스트, `query-budget.test.ts`, `tests/unit/booking-components.test.tsx`, `booking-history.test.tsx`, `day-grid-components.test.tsx`
7. `git status`가 깨끗한지 본다. 사람이 하던 변경이 있으면 되돌리지 말고 계획에 적는다.
8. 고치기 전에 `pnpm lint`, `pnpm typecheck`, `pnpm test`를 돌려 지금 상태를 적어 둔다. 이미 실패하는 것이 있으면 멈추고 알린다.

## 환경에 대한 전제

지시서 10과 같다. 검증은 PGlite 테스트와 컴포넌트 테스트로 한다. `pnpm db:migrate`, `pnpm db:seed`를 돌리지 않는다.

## 지금 있는 테스트를 다루는 법

- 명세가 바꾼 구성 때문에 깨지는 화면 테스트(내 예약의 줄에 "바꾸기"가 생긴다)는 같은 것을 새 구성으로 확인하게 고친다. 고친 테스트의 목록을 보고에 적는다.
- 액션, 권한, 노출, 예산 테스트는 고치지 않는다. 깨지면 구현이 틀린 것이다. 예외는 둘이다: `query-budget.test.ts`에서 3단계를 허용하는 이름의 배열에 이름 하나를 더하는 것(3단계), `proxy.test.ts`에 줄을 더하는 것(4단계).
- `createBooking`과 `cancelBooking`의 테스트는 고치지 않은 채 통과해야 한다. 두 액션과 같이 쓰려고 공통 부분을 떼어 내는 것은 되지만 동작이 달라지면 안 된다.

## 범위

| 단계 | 내용 | Jira |
| --- | --- | --- |
| 1 | `bookings.updated_at` | PFQV-96 |
| 2 | `updateBooking` | PFQV-96 |
| 3 | `getBookingForEdit` | PFQV-96 |
| 4 | 예약 바꾸기 화면 | PFQV-96 |
| 5 | 들어오는 곳 | PFQV-96 |
| 6 | 문서와 마무리 | PFQV-96 |

단계마다 커밋한다. 두 번에 나눠 맡길 수 있다: 1–3단계(서버), 4–6단계(화면).

## 범위 밖 (하지 않는다)

- 공간, 날짜, 예약 방식(개인·팀) 바꾸기
- 진행 중인 예약의 연장 (PFQV-36), 끌어서 시간 바꾸기 (PFQV-22)
- 좌석 예약 바꾸기
- 팀 관리자나 운영자가 남의 예약을 바꾸기 (취소만 된다)
- 바꾼 이력을 쌓아 보여주기 (`updated_at` 하나만 남긴다)
- 공간 상세의 하루 일정에 있는 내 예약 블록에 "바꾸기"를 더하는 것
- 새 의존성

## 단계

### 1. `bookings.updated_at`

- 컬럼을 더한다 (timestamptz, null 허용. `docs/spec/data-model.md`). 마이그레이션.
- 지금 있는 예약과 새로 만드는 예약은 null이다. `createBooking`과 `createDeskBooking`은 이 컬럼을 쓰지 않는다.

### 2. `updateBooking`

`docs/spec/booking-2.md`의 "예약 바꾸기 · 규칙"과 "updateBooking", "예약 프로세스 · 사용자 행을 잠그는 순서".

- 입력: `bookingId`, `start`, `end`, `attendeeCount`(null 가능), `participants`(전체 목록. `{ userId, email? }[]`. 지시서 16의 `createBooking`과 같은 모양), `title`. 스키마는 `createBooking`의 것과 같은 규칙을 쓴다.
- 확인 순서 10단계는 명세대로. 요점만 적는다.
  - 예약이 없거나, 내가 예약한 사람이 아니거나, 취소됐거나, 끝났거나, 공간이 보관됐으면 `NOT_FOUND`. 남의 예약이 있는지 드러내지 않는다 (초대받은 사람이 불러도 `NOT_FOUND`).
  - 좌석 예약이면 `INVALID_INPUT`. 접근보다 먼저 본다 (좌석 행의 `access`는 뜻이 없다).
  - 그다음 접근과 권한: 그 예약의 `team_id`로 `canBookAs`. 안 되면 `FORBIDDEN`.
  - 사용 인원과 "나 + 참석자"는 언제나 지금의 정원으로 본다. 넘으면 `OVER_CAPACITY`이고 `message`는 지시서 14·16과 같다 (`attendee_count` | `participants`). 사용 인원이 "나 + 참석자"보다 작으면 `INVALID_INPUT`.
  - 참석자: 기존 참석자의 인증·이메일 자격은 다시 요구하지 않는다. 새 참석자는 지시서 16의 자격을 확인한다. 저장할 전체 명단은 20명까지이며 외부 참석자 5명 제한은 새로 넣는 사람이 없어도 다시 검사한다. 화면을 열었을 때의 `participantIdsAtLoad`도 입력으로 받아, 그 뒤 빠진 사람은 오래된 수정으로 재초대하지 않는다 (`booking-round2-delivery.md`의 사용자 확정 규칙).
  - 시간이 바뀌었는지는 저장된 `during`과 견주어 정한다. 바뀌었고 이미 시작했으면 `INVALID_INPUT`. 바뀌었으면 시간 규칙을 보고, 날짜가 달라지면 `INVALID_INPUT`.
  - 시간이 바뀌지 않았으면 시간 규칙, 한도, 점검을 보지 않는다.
  - 한도의 하루 합계는 이 예약의 원래 시간을 뺀 값에 새 시간을 더해 본다. 1회 최대와 며칠 앞도 본다.
- 트랜잭션
  1. 잠금은 시간이 바뀌지 않았어도 언제나 건다. 순서는 층 → 공간 → 사용자 → 팀이고, 예약 행은 그 뒤(3번의 UPDATE)에 잠긴다. 사용자 행은 이 트랜잭션이 건드릴 사람(나, 지금의 참석자, 새로 넣을 참석자)을 id 순서로 한 번에 잠근다. 세기는 `createBooking`과 같다 (개인 예약의 내 행만 `FOR UPDATE`, 나머지는 `FOR KEY SHARE`).
  2. 공간을 다시 읽어 보관과 정원을 다시 본다. 한도와 점검은 시간이 바뀌었을 때만 본다.
  3. 조건이 붙은 UPDATE 한 문장 (`id`, `user_id`, `status = 'confirmed'`, `upper(during) > $now`). 바뀐 행이 없으면 `NOT_FOUND`. 겹치면 `BOOKING_CONFLICT`.
  4. UPDATE 뒤에(그 행이 잠긴 뒤에) 지금의 참석자를 다시 읽어, 보낸 목록과의 차이를 여기서 정한다. 트랜잭션 밖에서 읽은 목록으로 정하지 않는다 ("참석 안 함"이 사이에 끼어들 수 있다). 빼는 사람은 다시 읽은 참석자 가운데 보낸 목록에 없는 사람이다. 넣는 사람은 앞의 확인에서 "새로 넣는 사람"으로 통과한 사람뿐이다: 확인할 때는 참석자였는데 다시 읽을 때 없는 사람(그 사이에 "참석 안 함"을 누른 사람)은 다시 넣지 않는다. 넣기 한 문장, 빼기 한 문장. 바뀐 것이 없으면 문장을 보내지 않는다.
  5. 알림과 미리 알림 (지시서 17의 함수를 쓴다)
     - 새로 들어간 사람: `booking_invited` (새 시간).
     - 빠진 사람: `booking_removed`. `data`의 시간은 바뀌기 전의 시간이다 (그 사람이 알던 시간). 그 사람의 미리 알림을 지운다.
     - 시간이 바뀌었으면: 남아 있던 참석자(이번에 새로 들어간 사람은 뺀다)에게 `booking_changed`. `data`에 새 시간과 바뀌기 전의 시작·끝을 담는다.
     - 미리 알림, 시간이 바뀌었을 때: 그 예약의 미리 알림을 모두 지우고, 예약한 사람과 바꾼 뒤의 참석자 모두에게 새 시간으로 한 번만 넣는다. 새로 들어간 사람 몫을 따로 또 넣지 않는다 (유니크 인덱스에 걸린다).
     - 미리 알림, 시간이 그대로일 때: 새로 들어간 사람 몫만 넣는다.
     - 미리 알림의 `data`에는 제목을 담지 않는다 (지시서 17).
     - 인원이나 제목만 바뀌었으면 알림이 없다.
- `updated_at`은 주입받은 지금 시각이다.
- 값이 하나도 바뀌지 않은 요청도 성공이다.
- 커밋 뒤 `createBooking`과 같은 이벤트를 발행한다.
- 테스트(`tests/db`에 새 파일)
  - 시간만 바꾼다: `during`과 `updated_at`이 바뀌고 다른 값은 그대로다.
  - 제목만, 인원만 바꾼다: 한도가 이미 꽉 찬 사람도 된다 (시간 규칙과 한도를 다시 보지 않는다).
  - 다른 예약과 겹치게 바꾸면 `BOOKING_CONFLICT`이고 아무것도 바뀌지 않는다 (참석자와 알림 포함). 자기 자신의 원래 시간과 겹치는 새 시간(10:00–11:00 → 10:30–11:30)은 된다.
  - 점검과 겹치게 바꾸면 `SPACE_BLOCKED`. 운영 시간 밖은 `OUTSIDE_HOURS`. 지난 시각으로는 `INVALID_INPUT`. 다른 날짜로는 `INVALID_INPUT`.
  - 한도: 하루 2시간 가운데 1시간짜리 예약 둘을 가진 사람이 하나를 1시간 30분으로 늘리면 `LIMIT_EXCEEDED`(`per_day`), 다른 하나를 취소한 뒤에는 된다. 1회 최대를 넘으면 `per_booking`.
  - 이미 시작한 예약: 시간을 바꾸면 `INVALID_INPUT`, 제목과 인원과 참석자는 바뀐다.
  - 남의 예약, 초대받은 예약, 취소된 예약, 끝난 예약: `NOT_FOUND`. 좌석 예약: `INVALID_INPUT` (구역에 접근할 수 없는 사람의 좌석 예약이어도 `FORBIDDEN`이 아니다).
  - 공간에 더는 접근할 수 없게 된 뒤: `FORBIDDEN`. 그 예약의 취소는 여전히 된다.
  - 정원이 줄어든 뒤(사용 인원 6, 정원 4): 인원을 그대로 두고 제목만 바꿔 보내면 `OVER_CAPACITY`(`attendee_count`)이고 아무것도 바뀌지 않는다. 인원을 4로 줄여 같이 보내면 된다. 참석자가 정원을 넘는 경우는 `participants`.
  - 참석자: 한 명을 넣고 한 명을 빼면 행이 맞춰지고, 넣은 사람에게 초대 알림과 미리 알림, 뺀 사람에게 빠짐 알림이 가고 뺀 사람의 미리 알림이 없어진다. 그대로인 사람에게는 알림이 없다.
  - 새로 넣는 참석자: 같은 팀이 아닌데 `email`이 없거나 틀리면 `INVALID_INPUT`. 이미 참석자인 사람은 `email` 없이 보내도 남는다.
  - 시간과 참석자를 같이 바꾼다: 빠진 사람의 `booking_removed`에 바뀌기 전의 시간이 있다. 새로 들어간 사람의 미리 알림이 한 벌뿐이다 (유니크 인덱스 위반이 나지 않는다).
  - 시간 변경: 남아 있던 참석자에게 `booking_changed`(바뀌기 전 시간이 `data`에 있다). 미리 알림의 `scheduled_for`가 새 시간 기준이다. 이미 보였던 옛 미리 알림도 없다.
  - 겹치는 순서: PGlite는 연결이 하나라 두 요청을 정말로 동시에 돌릴 수 없다. `tests/db/booking-actions.test.ts`의 "rechecks … after locking the space" 테스트가 쓰는 방식을 쓴다: 잠금 함수(`lockSpaceForBooking` 따위)를 `vi.spyOn(…).mockImplementationOnce`로 감싸, 잠그기 직전에 "다른 요청이 먼저 끝냈다면 있었을 변화"를 그 트랜잭션에서 직접 넣는다(행을 넣거나 고치거나 지운다). 그 안에서 두 번째 액션을 통째로 부르지 않는다 (바깥 트랜잭션에 얹혀 같이 되돌려진다).
    - 잠그기 직전에 같은 공간에 겹치는 다른 예약이 들어왔다: `BOOKING_CONFLICT`이고 이 예약의 시간, 참석자, 알림이 그대로다.
    - 잠그기 직전에 참석자 한 명이 나갔다 (그 사람의 참석자 행과 미리 알림을 지운다. `leaveBooking`이 한 일과 같다): 바꾸기는 성공하고, 보낸 목록에 그 사람이 있어도 참석자 행, 초대 알림, 미리 알림이 다시 생기지 않는다.
    - 교착은 연결 하나로는 재현되지 않는다. 사용자 행을 잠그는 함수가 받은 id(또는 미터가 잡은 잠금 문장)의 순서가 오름차순인지로 확인한다.

### 3. `getBookingForEdit`

`docs/spec/booking-2.md`의 "getBookingForEdit".

- 돌려주는 조건과 내용은 명세대로. 아니면 `ActionError('NOT_FOUND')`.
- 열어 주는 조건에 "그 예약의 방식으로 지금도 예약할 수 있다"가 들어 있다: 액션의 4단계와 같은 `canBookAs`(그 예약의 `team_id`)다. 접근만 보고 열어 주지 않는다 (화면은 열리는데 저장이 언제나 `FORBIDDEN`인 경우가 생긴다).
- 예산: 3단계, 한 단계의 문장 6개 이하.
  - 1단계: 예약과 그 공간·층·지점 (한 문장). 여기서 지점과 층을 알아낸다.
  - 2단계: 판정에 필요한 것 (층의 접근, 내 소속, 역할 설정 따위). `getSpaceDay`의 1단계가 읽는 것과 같다.
  - 3단계: 그날의 다른 예약, 점검, 팀 이름, 합계, 참석자.
  - 문장 두 개짜리 `getSpaceForAccess`를 그대로 불러 쓰지 않는다 (단계가 하나 더 생긴다). 필요한 DAL 함수를 직접 묶는다.
  - `tests/db/query-budget.test.ts`에 `bookings.getBookingForEdit`를 재는 줄을 더하고, 3단계를 허용하는 이름의 배열(`bookings.getHomeFreeSpaces`, `bookings.getHomeBookingLimits`, `bookings.getBookingDestination`이 있는 곳)에 이 이름을 더한다. 그 밖의 기준은 고치지 않는다.
- 그날의 다른 예약과 점검은 `getSpaceDay`와 같은 규칙으로 읽고(제목과 인원이 보이는 범위 포함), 이 예약은 뺀다.
- 한도의 "남은 시간"은 이 예약의 시간을 뺀 값이다.
- 참석자: id, 이름, 나와 같이 속한 팀의 이름들, 가린 이메일 (지시서 16의 가리는 함수). 가리지 않은 이메일은 돌려주지 않는다.
- 테스트: 내 예약은 읽힌다. 남의 예약, 초대받은 예약, 좌석 예약, 끝난 예약, 취소된 예약, 보관된 공간의 예약은 `NOT_FOUND`. 그 방식으로 더는 예약할 수 없게 된 예약(팀에서 나왔다, 층의 접근이 바뀌었다)도 `NOT_FOUND`. 다른 예약 목록에 이 예약이 없다. 남은 시간의 계산. 참석자의 이메일이 가려져 있다. 다른 사람 예약의 제목이 보이는 범위가 `getSpaceDay`와 같다. 단계와 문장 수.

### 4. 예약 바꾸기 화면

`ui3-edit.png`. `docs/spec/booking-2.md`의 "예약 바꾸기 · 화면".

- `app/(app)/bookings/[bookingId]/edit/page.tsx`. `requirePageSession()`. 바꿀 수 없는 예약이면 `notFound()`.
- `proxy.ts`의 matcher에서 `/bookings`를 `/bookings/:path*`로 바꾼다 (지금은 `/bookings`만 맞아서, 로그인하지 않은 사람이 이 주소를 열면 proxy를 지나쳐 페이지의 확인에서야 걸린다). `tests/unit/proxy.test.ts`에 `/bookings/{uuid}/edit`가 로그인으로 가는 줄과 `/bookings`가 그대로인 줄을 더한다. `/api`는 여전히 matcher에 넣지 않는다.
- 틀(돌아가는 링크, 제목, 설명, 두 카드의 자리)을 먼저 그리고 데이터는 `<Suspense>` 안에서 읽는다. fallback은 두 카드의 스켈레톤.
- 왼쪽 카드: 대표 사진, 공간 이름과 정원, 지점과 층, 날짜, 방식, 지금 예약, 안내 문구.
- 오른쪽 카드
  - 하루 일정: 공간 상세의 하루 일정 컴포넌트(`booking-timeline.tsx`)를 쓴다. 고른 시간의 블록 글자를 "바꾼 시간"으로 바꿀 수 있게 한다 (지금은 "새 예약"). 빈 칸을 누르는 규칙은 같은 순수 함수다.
  - 양식: 시작, 끝, 사용 인원(지시서 14의 입력), 참석자(16의 입력), 제목, 한도 한 줄, "바꾼 내용 저장", "돌아가기".
  - 처음 값은 이 예약의 값이다. 시작과 끝이 원래와 다르면 이름 옆에 "10:00 → 10:30".
  - 바뀐 것이 없으면 저장이 비활성이다.
  - 정원이 줄어 지금 값이 이미 정원을 넘는 예약: 처음부터 그 입력(사용 인원 또는 참석자) 아래에 오류를 보여주고, 정원 안으로 줄이기 전에는 다른 것을 바꿔도 저장이 비활성이다.
- 이 화면의 상태는 화면 안에 둔다 (층 화면의 초안 저장소를 쓰지 않는다).
- 이미 시작한 예약: 하루 일정의 칸과 시작·끝 선택 상자가 비활성이고 "진행 중인 예약은 시간을 바꿀 수 없어요"를 보여준다. 인원, 참석자, 제목은 바꿀 수 있다.
- 제출: 지금의 예약 제출 훅과 같은 방식으로 `updateBooking`을 부른다. 한 번에 하나. 제출 중에는 "저장하고 있어요".
- 성공: 토스트 "예약을 바꿨어요", `/bookings`로 간다.
- 실패: 코드에 맞는 문구를 `aria-live` 영역에. `BOOKING_CONFLICT`와 `SPACE_BLOCKED`는 다시 읽는다. `OVER_CAPACITY`는 `message`가 가리키는 입력(`attendee_count`는 사용 인원, `participants`는 참석자) 아래에, 필드 오류는 그 입력 아래에. `NOT_FOUND`는 "이 예약은 더 바꿀 수 없어요"와 내 예약으로 가는 링크.
- 좁은 화면: 왼쪽 카드가 위로 올라가고 양식의 칸이 한 줄에 하나씩이다.
- 컴포넌트 테스트: 처음 값. 저장이 비활성이다가 값을 바꾸면 활성이 된다. 원래 값으로 되돌리면 다시 비활성이다. 시작을 바꾸면 "10:00 → 10:30"이 보인다. 하루 일정의 칸을 눌러 시간이 바뀐다. 이미 시작한 예약에서 시간 입력이 비활성이고 인원은 바뀐다. 제출에 실리는 값(참석자 전체 목록. 새로 넣은 같은 팀 아닌 사람에게만 `email`이 실린다). 정원을 넘는 값으로 열면 처음부터 오류가 보이고 저장이 비활성이며, 줄이면 활성이 된다. `OVER_CAPACITY`의 `message`에 따라 오류가 붙는 입력. 성공하면 이동한다. `BOOKING_CONFLICT`에서 문구와 다시 읽기.

### 5. 들어오는 곳

`ui3-my-bookings.png`.

- 내 예약의 목록: 내가 한 다가오는 시간 예약의 줄에 "바꾸기" 링크(테두리 버튼 모양. 이름 "{공간 이름} 예약 바꾸기"), 그 옆에 "취소". 좌석 예약과 초대받은 예약에는 없다.
- 내 예약의 달력: 고른 날짜의 예약에 같은 링크.
- 링크는 `<a href>`다 (`/bookings/[bookingId]/edit`).
- 컴포넌트 테스트: 링크의 주소와 이름. 좌석 예약, 초대받은 예약, 지난 예약에 링크가 없다.

### 6. 문서와 마무리

- `README.md`(저장소 루트)에 예약 바꾸기(바꿀 수 있는 것, 진행 중인 예약, 알림과 미리 알림이 어떻게 되는지)와 주소를 더한다.
- `tests/e2e/smoke.spec.ts`에 지금 있는 테스트는 그대로 두고 통과해야 한다. 테스트 하나를 더한다: 로그인하지 않고 `/bookings/{임의의 uuid}/edit`을 열면 로그인으로 간다.

## 완료 기준

직접 실행해서 확인하고, 결과를 보고에 그대로 적는다.

| 확인 | 기준 |
| --- | --- |
| `pnpm lint` | 오류 0 |
| `pnpm typecheck` | 오류 0 |
| `pnpm test` | 전부 통과, 건너뛴 테스트 없음. 고친 화면 테스트의 목록을 보고에 적는다 |
| `TZ=America/Los_Angeles pnpm test` | 전부 통과 |
| `pnpm build` | `DATABASE_URL`, `AUTH_SECRET` 없이 성공 |
| `pnpm build-storybook` | 성공 |
| `pnpm test:e2e` | 통과. 못 돌리면 "확인 못 함" |
| 한 문장 | 예약을 고치는 것이 조건이 붙은 UPDATE 한 문장이고, 겹침을 사전 조회로 판정하지 않음 |
| 본인만 | 남의 예약과 초대받은 예약은 조회와 액션 모두 `NOT_FOUND` |
| 참석자 | 새로 넣는 참석자를 서버가 다시 확인함 (같은 팀이거나 이메일이 정확히 맞음). 참석자의 차이를 UPDATE 뒤에 트랜잭션 안에서 정함 |
| 잠금 | 사용자 행을 id 순서로 잠그고 예약 행은 그 뒤에 잠김 (잠금 순서를 확인하는 테스트가 있음) |
| proxy | `/bookings/:path*`가 matcher에 있고 `/api`는 없음 |
| 만들기와 취소 | `createBooking`, `createDeskBooking`, `cancelBooking`의 테스트가 고치지 않은 채 통과 |
| 알림 | 실패한 바꾸기는 참석자와 알림을 바꾸지 않음. 시간이 바뀌면 옛 미리 알림이 남지 않음 |
| 예산 | `getBookingForEdit`가 3단계 이하, 한 단계의 문장 6개 이하 |
| 시각 | 클라이언트 컴포넌트의 렌더링에 `new Date()`, `Date.now()`가 없음 |
| 색 | 컴포넌트에 hex 색과 그림자 값이 없음 |
| `git status` | 이 작업의 변경은 모두 커밋됨 |

브라우저에서 보이는 모습은 "확인 못 함"으로 적고, 사람이 확인할 순서를 보고에 적는다: `pnpm db:migrate` → 내일의 회의실을 참석자 한 명과 예약 → 내 예약에서 "바꾸기" → 하루 일정에서 30분 뒤로 옮기고 인원을 바꿔 저장 → 내 예약에 바뀐 시간 → 참석자의 종에 "시간을 바꿨어요" → 다시 "바꾸기"로 참석자를 빼기 → 그 사람의 종에 알림 → 지금 진행 중인 예약에서 시간 입력이 잠겨 있는지 → 좌석 예약에 "바꾸기"가 없는지.

## 막혔을 때

- UPDATE로 `during`을 바꿀 때 겹침 제약이 자기 자신과 부딪치면(그럴 일은 없어야 한다) 제약을 바꾸지 말고 알린다.
- 하루 합계에서 이 예약을 빼는 것이 지금의 합계 함수로 안 되면, 함수에 "빼는 예약 id"를 더한다. `createBooking`의 호출은 그대로 둔다.
- 하루 일정 컴포넌트를 이 화면에서 쓰려면 층 화면의 컨텍스트가 필요하면, 컨텍스트 없이도 동작하게 한 지금의 방식(양식만 그리는 테스트와 Storybook)을 쓴다.
- 시안과 명세가 다르면 명세가 맞다. 둘 다 없으면 더 단순한 쪽으로 정하고 보고에 적는다.
- 문서끼리 다르면 `AGENTS.md`, `docs/spec/booking-2.md`, `docs/spec/ui-2.md`, `docs/spec/ui.md`, `docs/spec/booking.md`, 이 지시서 순으로 우선한다.

## 최종 보고

`AGENTS.md`의 "최종 보고 형식"을 따른다. "사람이 해야 하는 일"에 `pnpm db:migrate`를 적는다.
