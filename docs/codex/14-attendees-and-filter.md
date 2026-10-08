# 작업 지시서 14 — 사용 인원과 인원으로 거르기

지시서 13까지 끝난 뒤에 한다. 예약 2차(14–18)의 첫 작업이다. 뒤의 지시서가 이 작업의 컬럼과 입력 위에서 동작한다.

## 목표

`docs/spec/booking-2.md`의 "사용 인원"과 "인원으로 거르기"를 만든다. 끝났을 때 아래가 모두 참이어야 한다.

- 회의실을 예약할 때 사용 인원을 적을 수 있다. 안 적어도 예약된다. 정원보다 많으면 예약되지 않는다.
- 적은 인원이 요약, 하루 일정(볼 수 있는 사람에게), 내 예약에 보인다.
- 층 화면의 도구 줄에서 인원을 정하면 정원이 모자란 공간이 빠진다. 서버에 다시 묻지 않는다.
- 정한 인원이 예약할 때 사용 인원의 기본값이 된다.

예약의 다른 규칙(한도, 겹침, 접근, 결과 코드의 뜻)은 바꾸지 않는다.

## 시작 전에

1. `AGENTS.md`를 읽는다.
2. `docs/spec/booking-2.md`를 처음부터 "인원으로 거르기"까지 읽는다 ("예약 프로세스", "사용 인원", "인원으로 거르기"). 그리고 "데이터에 더하는 것", "화면 문구". 이 작업의 기준이다. 참석자, 좌석, 알림, 예약 바꾸기는 이 작업이 아니다.
3. `docs/spec/booking.md`의 "액션"(`createBooking`의 확인 순서), "다른 사람의 예약에서 보이는 것", `docs/spec/ui-2.md`의 "보기 고르기"(주소만 바꾸는 전환), "고른 구간과 예약 줄", "공간 상세"를 읽는다.
4. `docs/spec/data-model.md`의 `bookings`, "테스트로 확인할 제약" 21번, `docs/spec/server.md`의 결과 코드 목록을 읽는다.
5. `docs/design/ui3-list-form.png`, `ui3-tt-desk.png`, `ui3-people-filter.png`, `ui3-mobile.png`를 본다. 이미지를 열 수 없으면 명세만으로 진행하고 보고에 적는다.
6. 지금 코드를 읽는다.
   - `features/bookings/`: `schema.ts`, `create-booking-factory.ts`, `query-factory.ts`(`getSpaceDay`, `getMyBookings`, 달력, 홈), `types.ts`, `visibility.ts`, `ui-errors.ts`, `booking-draft-store.ts`, `floor-view.ts`, `floor-selection.ts`, `format.ts`, `timetable.ts`
   - `features/bookings/components/`: `booking-form.tsx`, `booking-form-fields.tsx`, `booking-form-layout.tsx`, `booking-strip.tsx`, `booking-timeline.tsx`, `use-booking-draft.ts`, `branch-navigation.tsx`, `floor-view.tsx`(보기 전환이 주소만 바꾸는 방식), `floor-navigation-link.tsx`, `floor-views.tsx`, `floor-day.tsx`, `floor-timetable.tsx`, `my-bookings.tsx`, `my-bookings-calendar-panel.tsx`, `home-next-booking.tsx`
   - `lib/dal/bookings.ts`, `lib/db/schema`, `lib/actions/`(결과 타입과 래퍼가 `message`를 내보내는 곳), `lib/seed/`(`data.ts`, `scope.ts`, `add-branches.ts`), `scripts/seed.ts`, `scripts/seed-command.ts`
   - 테스트: `tests/db/booking-actions.test.ts`, `booking-queries.test.ts`, `constraints.test.ts`, `seed.test.ts`, 시드의 범위와 데이터 테스트(`seed-scope`, `seed-data`), `tests/unit/booking-components.test.tsx`, `booking-strip.test.tsx`, `floor-view.test.tsx`, `floor-timetable.test.tsx`, `booking-history.test.tsx`, `day-grid-components.test.tsx`, 초안 저장소의 테스트
7. `git status`를 본다.
   - `docs/`와 `AGENTS.md`의 커밋되지 않은 변경(예약 2차의 명세, 지시서, 시안, 시드 파일)은 먼저 `docs: add booking round 2 specs and briefs (PFQV-92)`로 커밋한다.
   - 그 밖에 커밋되지 않은 변경이 있으면 사람이 하던 일이다. 되돌리거나 지우지 않는다. 무엇이 있는지 계획에 적고 그 위에서 작업한다.
8. 고치기 전에 `pnpm lint`, `pnpm typecheck`, `pnpm test`를 돌려 지금 상태를 적어 둔다. 이미 실패하는 것이 있으면 멈추고 알린다.

## 환경에 대한 전제

지시서 10과 같다. 실제 DB가 없으니 검증은 PGlite 테스트와 컴포넌트 테스트로 한다. `pnpm db:migrate`, `pnpm db:seed`를 돌리지 않는다. 브라우저에서 보이는 모습은 "확인 못 함"으로 적는다.

## 지금 있는 테스트를 다루는 법

- 명세가 바꾼 문구나 구성 때문에 깨지는 화면 테스트는 같은 것을 새 문구로 확인하게 고친다. 지우거나 확인을 줄이지 않는다. 고친 테스트의 목록을 보고에 적는다.
- 액션, 권한, 노출, 예산 테스트는 고치지 않는다. 깨지면 구현이 틀린 것이다. 다만 입력에 선택 필드가 늘어서 타입만 맞추면 되는 곳은 맞춘다.
- 바뀌는 것으로 알려진 것: 공간 상세의 펼침 버튼 글자("시간·제목 바꾸기" → "예약 내용 바꾸기"), 시드의 예약에 사용 인원이 생기는 것, 하루 일정의 블록 글자(사용 인원이 붙는다), 초안 저장소의 모양.

## 범위

| 단계 | 내용 | Jira |
| --- | --- | --- |
| 1 | 컬럼, 결과 코드, 시드 | PFQV-92 |
| 2 | `createBooking`의 사용 인원 | PFQV-92 |
| 3 | 조회에 사용 인원 | PFQV-92 |
| 4 | 예약 양식의 입력과 보여주는 곳 | PFQV-92 |
| 5 | 인원 조건: 주소, 거르는 함수, 도구 줄 | PFQV-93 |
| 6 | 목록과 시간표에 적용, 알림 줄, 기본값 | PFQV-93 |
| 7 | 문서와 마무리 | PFQV-93 |

단계마다 커밋한다. 두 번에 나눠 맡길 수 있다: 1–4단계, 5–7단계.

## 범위 밖 (하지 않는다)

- 좌석 예약 (지시서 15), 참석자 초대 (16), 알림 (17), 예약 바꾸기 (18). `bookings.updated_at`은 18에서 더한다
- 인원 조건을 쿠키에 기억하기, 홈이나 지점 목록에서 인원으로 찾기
- 정원을 운영자가 고치는 화면을 바꾸는 것
- 새 의존성

시안에 있지만 따르지 않는 것

- 예약 줄과 양식의 "참석자": 지시서 16에서 만든다. 이 작업에서는 그 자리를 비워 둔다 (자리 표시도 두지 않는다).
- 머리글의 종: 지시서 17.
- 시간표의 데스크 구역 행(오전·오후 버튼): 지시서 15. 지금 문구("좌석 N석 · 좌석 예약은 준비 중이에요") 그대로 둔다.
- 좁은 화면 시안은 인원 조건을 보기 아이콘과 한 줄에 그렸다. 운영 상태와 보기의 줄은 그대로 두고 그 아래에 한 줄을 더한다 (5단계).

## 단계

### 1. 컬럼, 결과 코드, 시드

- `bookings.attendee_count`(integer, null 허용)와 검사 제약 `bookings_attendee_count_range`를 더한다 (`docs/spec/data-model.md`). 마이그레이션을 만든다.
- 결과 코드 `OVER_CAPACITY`를 더한다 (`docs/spec/server.md`). 이 코드는 `message`로 어느 쪽이 정원을 넘었는지 알려 준다 (`attendee_count`. 지시서 16이 `participants`를 더한다). 액션 래퍼는 지금 `LIMIT_EXCEEDED`의 `message`만 내보낸다. `OVER_CAPACITY`의 `message`도 내보내게 한다.
- 시드: `docs/spec/examples/seed-bookings-2.json`의 `attendeeCounts`를 읽어 그 예약의 사용 인원을 넣는다. `seed.json`과 그 스키마는 바꾸지 않는다.
  - 새 파일의 스키마를 따로 둔다. 지금 시드의 스키마가 그렇듯 모르는 키를 받지 않는 스키마이므로, 파일의 다섯 키(`note`, `attendeeCounts`, `participants`, `deskBookings`, `deskBlocks`)의 모양을 지금 모두 적어 둔다. 이 작업에서 검증하고 넣는 것은 `attendeeCounts`뿐이다. 나머지는 지시서 15와 16이 쓴다.
  - 확인: 가리키는 예약 id가 `seed.json`에 있는지, 인원이 그 공간의 정원 이하인지.
  - 이 파일의 행은 모두 강남점의 것이다. 전체 시드에서 넣는다. 지점을 골라 더하는 시드(`--branches`, `lib/seed/scope.ts`와 `add-branches.ts`)에서는 강남점이 새로 더해지는 지점일 때만 넣고, 이미 있는 지점을 확인하는 검증에는 넣지 않는다.
  - 시드의 예약이 이미 있는 예약과 겹쳐 건너뛰어지면 그 예약의 사용 인원도 건너뛴다.
  - 다시 돌려도 결과가 같아야 한다.
- 테스트: 제약 21번. 시드를 넣은 뒤 그 예약들의 사용 인원. 시드를 두 번 넣어도 같다. 건너뛴 예약의 사용 인원이 넣어지지 않는다. `--branches`로 다른 지점만 더할 때 강남점의 예약이 바뀌지 않는다.

### 2. `createBooking`의 사용 인원

`docs/spec/booking-2.md`의 "사용 인원 · 규칙".

- 입력에 `attendeeCount?: number | null`(1–500의 정수)을 더한다. 없거나 null이면 안 적은 것이다.
- 확인 순서의 5단계에 더한다: 공간의 정원이 있고 사용 인원이 정원보다 많으면 `OVER_CAPACITY`(`message`는 `attendee_count`). 좌석이면 지금처럼 `INVALID_INPUT`이 먼저다. 접근과 권한(`FORBIDDEN`)이 이보다 먼저다.
- 트랜잭션에서 공간을 잠근 뒤 다시 읽은 정원으로 한 번 더 본다.
- 넣을 때 컬럼에 적는다.
- 테스트(`booking-actions.test.ts`에 더한다): 안 적으면 null로 들어간다. 정원과 같으면 된다. 정원 + 1이면 `OVER_CAPACITY`이고 행이 생기지 않는다. 정원이 null인 공간은 500까지 되고 501은 `INVALID_INPUT`이다. 0, 음수, 소수는 `INVALID_INPUT`. 사용 인원은 한도 계산을 바꾸지 않는다.

### 3. 조회에 사용 인원

`docs/spec/booking-2.md`의 "누구에게 보이나"와 "보여주는 곳".

- `getSpaceDay`의 예약: 제목을 내려보내는 예약에만 `attendeeCount`를 같이 싣는다. 제목이 보이지 않는 사람에게는 필드가 없다. 지금의 제목 판정 함수를 같이 쓴다.
- 내 예약(`getMyBookings`, 달력, 홈의 다음 예약): 예약마다 `attendeeCount`.
- `getFloorDay`의 구간 데이터에는 싣지 않는다.
- 문장과 단계를 늘리지 않는다 (같은 문장에서 컬럼 하나를 더 읽는다). 예산 테스트가 그대로 통과한다.
- 테스트: 노출 테스트에 더한다 — 제목이 보이지 않는 사람(같은 공간에 접근하는 다른 사람)의 `getSpaceDay` 결과에 `attendeeCount` 키가 없다. 본인, 같은 팀, 운영자에게는 있다.

### 4. 예약 양식의 입력과 보여주는 곳

`ui3-list-form.png`, `ui3-tt-desk.png`. `docs/spec/booking-2.md`의 "사용 인원 · 입력".

- 입력 컴포넌트: 줄이기, 숫자 입력, 늘리기. 이름 "사용 인원 (선택)". 비어 있으면 "미정". 정원에서 멈추고 옆에 "정원 N명". 버튼의 이름, 직접 적은 값이 정원보다 클 때의 문구와 제출 비활성은 명세대로. `components/`에 두고 Storybook 이야기를 만든다 (비어 있음, 값 있음, 정원에 닿음, 정원 없음, 오류).
- 초안 저장소(`features/bookings/booking-draft-store.ts`)에 사용 인원을 더한다. 제목과 같은 범위, 같은 때에 비운다. "사용자가 건드렸는지"를 같이 둔다 (6단계의 기본값에 쓴다).
  - 지금 저장소는 제목과 방식이 그대로인 변경을 버린다. 사용 인원만 바뀐 변경이 버려지지 않게 그 비교를 넓힌다.
  - 예약에 성공하면 지금은 제목만 비운다. 사용 인원의 값과 "건드렸는지"도 같이 비운다 (목록 보기의 패널은 성공 뒤에도 열려 있다).
- 공간 상세의 양식: 펼치는 부분 안에 시작·끝, 사용 인원, 제목 순서. 펼침 버튼의 글자를 "예약 내용 바꾸기"로 바꾼다. 시작·끝·제목처럼, 사용 인원에 오류가 있으면 자동으로 펼친다.
- 예약 줄: 예약 방식과 제목 사이에 둔다.
- 보여주는 조건: 예약할 수 있는 공간이고 정원이 1이 아닐 때.
- 요약에 "· 5명"을 붙인다 (공간 상세의 요약, 예약 줄의 왼쪽 요약).
- `OVER_CAPACITY`의 문구를 `ui-errors.ts`의 방식에 더한다. 문구에 정원이 들어가므로 정원을 넘겨받게 한다. 제출 훅(`use-booking-mutation.ts`)은 지금 문구와 필드 오류만 내보낸다. 코드와 `message`를 같이 내보내거나, 이 코드를 `attendeeCount`의 필드 오류로 바꿔 내보내서, 양식이 그 입력 아래에 문구를 보여주고 펼칠 수 있게 한다. 입력으로 포커스를 옮긴다.
- 하루 일정의 블록: `attendeeCount`가 있으면 "· 5명"을 붙인다.
- 내 예약의 목록과 달력, 홈의 다음 예약: 값이 있으면 "5명" 배지. 없으면 아무것도 없다.
- 컴포넌트 테스트: 늘리기와 줄이기, "미정"으로 돌아가는 것, 정원에서 멈추는 것, 정원 1인 공간에 입력이 없는 것, 직접 적은 큰 값에서 제출이 비활성인 것, 제출하는 값에 `attendeeCount`가 실리는 것, 성공하면 비워지는 것, `OVER_CAPACITY`에서 문구가 보이고 펼쳐지는 것, 예약 줄과 공간 상세 사이를 오가도 값이 남는 것, 요약의 "· 5명".

### 5. 인원 조건: 주소, 거르는 함수, 도구 줄

`ui3-people-filter.png`. `docs/spec/booking-2.md`의 "인원으로 거르기".

- 순수 함수: 주소의 `people` 값을 읽는다 (2–50의 정수, 그 밖은 없음). 테스트한다.
- 순수 함수: 조회 결과의 공간 목록과 조건, 지금 고른 공간을 받아 남는 공간, 숨긴 수, 묶음별 수(전체와 "지금 비어 있음")를 돌려준다. 규칙은 명세대로. 테스트한다 (정원이 모자람, 정원이 null, 예약할 수 없는 공간, 전용 공간, 좌석이 있는 데스크 구역, 고른 공간은 남음, 영업 중이 아닐 때 "지금 비어 있음"을 세지 않음, 모두 빠진 묶음).
- 층 화면 안에서 주소를 바꾸는 모든 길이 `people`을 그대로 둔다. `FloorNavigationLink`는 지금 `view`만 자동으로 실어 보낸다. `people`도 같이 싣는다. 이 링크를 거치지 않는 길도 고친다: 시간표의 빈 칸을 눌러 공간이 바뀔 때(`floor-timetable-row.tsx`가 넘기는 주소와 컨텍스트의 `selectSlot`), 달력의 날짜(`floor-date-picker.tsx`), 시트를 Esc나 덮개로 닫을 때(`space-detail-container.tsx`), 예약 줄의 닫기와 성공 뒤의 닫기(`closeAfterBooking`), 보기 전환. 주소를 손으로 만드는 곳이 흩어져 있으면 "지금 주소에서 실어 갈 쿼리"를 정하는 도우미 하나로 모은다.
- 도구 줄의 조건: 1024px 이상에서는 첫 줄의 오른쪽, 보기 앞 (도구 줄의 격자는 `lg`에서 바뀐다). 1024px 미만에서는 운영 상태와 보기가 있는 줄 아래에 한 줄을 더해 왼쪽에 둔다. 줄이기·늘리기·지우기는 `people`만 바꾼 주소의 링크이고, 누르면 서버에 다시 묻지 않고 주소만 바꾼다 (보기 전환과 같은 방식. `floor-view.tsx`에 진행 중인 이동과 겹칠 때의 처리가 있다. 같은 처리를 쓴다). 경계(없음 ↔ 2, 50)와 이름, `aria-live`는 명세대로.
- 층 페이지의 `<Suspense key>`와 선택 키에 `people`을 넣지 않는다. 조건을 바꿀 때 스켈레톤이 보이면 안 된다.
- 테스트: 링크의 주소(다른 쿼리를 보존한다), 경계에서의 모양, 누르면 값이 바뀌고 이동 함수(서버 이동)를 부르지 않는 것, `booking-pages.test.tsx`의 키 테스트에 `people`이 달라도 키가 같다는 것. 그리고 조건이 있는 채로 빈 칸을 누른 뒤, 달력에서 날짜를 고른 뒤, Esc로 시트를 닫은 뒤, 층 탭을 누른 뒤의 주소에 `people`이 남아 있다.

### 6. 목록과 시간표에 적용, 알림 줄, 기본값

- 목록 보기와 시간표 보기가 5단계의 함수 결과로 그린다. 묶음의 제목은 남은 공간으로 센 값이다. 남은 공간이 없는 묶음은 그리지 않는다.
- 층 화면의 상태에 올려 두는 조회 결과(예약 줄과 시트가 공간 이름을 찾는 곳. `registerFloor`)는 거르지 않은 전체다. 거른 결과는 그리는 데만 쓴다.
- "숨긴 공간"의 수는 조건이 없을 때 그려지는 줄 가운데 빠진 줄의 수다 (전용 공간, 라운지, 데스크 구역의 줄도 센다).
- 알림 줄(`role="status"`)과 "모두 보기", 남은 공간이 없을 때의 안내는 명세대로. 쉬는 날에는 안내 하나만 보인다.
- 시간표의 키보드 이동은 남은 행으로만 계산한다.
- 고른 공간이 조건에 맞지 않아도 그 줄은 남는다.
- 사용 인원의 기본값: 조건이 있고 사용자가 사용 인원을 건드리지 않았으면 조건의 값이 사용 인원이다 (요약에 보이고 제출에 실린다). 조건의 값이 정원보다 크면 기본값을 두지 않는다. 한 번이라도 바꾸거나 비우면 따라가지 않는다.
- 스켈레톤은 바꾸지 않는다.
- 컴포넌트 테스트: 조건이 있으면 두 보기에서 같은 공간이 남는다. 알림 줄의 숫자. "모두 보기"의 주소. 남은 공간이 없을 때의 안내. 조건 5에서 정원 8인 공간을 고르면 요약에 "5명"이 있고 제출에 실린다. 사용 인원을 비운 뒤에는 조건을 바꿔도 비어 있다.

### 7. 문서와 마무리

- `README.md`(저장소 루트)에 사용 인원, 인원으로 거르기, 주소의 `people`을 더한다.
- `tests/e2e/smoke.spec.ts`는 고치지 않은 채 통과해야 한다.

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
| 예산 | `getFloorDay`, `getSpaceDay`, 내 예약 조회의 단계와 문장 수가 늘지 않음 |
| 노출 | 제목이 보이지 않는 사람에게 `attendeeCount`가 내려가지 않음. 구간 데이터에 없음 |
| 서버에 묻지 않기 | 인원 조건을 바꿀 때 서버 이동이 없고 스켈레톤이 보이지 않음 |
| 링크 | 조건의 줄이기·늘리기·지우기, "모두 보기"가 `<a href>`로 그려짐 |
| 색 | 컴포넌트에 hex 색과 그림자 값이 없음 |
| `git status` | 이 작업의 변경은 모두 커밋됨 |

브라우저에서 보이는 모습은 "확인 못 함"으로 적고, 사람이 확인할 순서를 보고에 적는다: `pnpm db:migrate`와 `pnpm db:seed` → 층 화면에서 회의실 고르기 → "예약 내용 바꾸기"를 펼쳐 사용 인원 넣기 → 정원보다 많이 적어 보기 → 예약하고 내 예약에서 인원 보기 → 도구 줄에서 인원을 5로 → 숨긴 공간 수와 "모두 보기" → 그 상태로 회의실을 골라 요약에 "5명"이 있는지.

## 막혔을 때

- 인원 조건을 주소만 바꾸는 방식으로 할 수 없으면(보기 전환과 같은 문제가 나면), 보통의 링크 이동으로 하되 공간 목록 영역이 스켈레톤이 되지 않게 하고 보고에 적는다.
- 정원 검사를 위해 예약의 다른 규칙을 바꿔야 할 것 같으면, 바꾸지 말고 알린다.
- 시안과 명세가 다르면 명세가 맞다. 둘 다 없으면 더 단순한 쪽으로 정하고 보고에 적는다.
- 문서끼리 다르면 `AGENTS.md`, `docs/spec/booking-2.md`, `docs/spec/ui-2.md`, `docs/spec/ui.md`, `docs/spec/booking.md`, 이 지시서 순으로 우선한다.

## 최종 보고

`AGENTS.md`의 "최종 보고 형식"을 따른다. "사람이 해야 하는 일"에 `pnpm db:migrate`와 `pnpm db:seed`를 적는다.
