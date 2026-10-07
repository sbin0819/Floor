# 작업 지시서 06 — 운영자의 지점·층·공간 관리

지시서 05(공간 찾기와 예약)가 끝난 뒤에 한다. `features/bookings/`와 결과 코드 `SPACE_IN_USE`가 없으면 시작하지 말고 알린다.

## 목표

운영자가 화면에서 지점 정보, 층, 공간, 이용 대상을 입력하고 고친다. 끝났을 때 아래가 모두 참이어야 한다.

- 운영자가 `/admin`에서 자기 지점을 골라 운영 시간을 고치고, 층과 공간을 더하고 고칠 수 있다.
- 새로 만든 공간이 멤버의 공간 목록에 나오고 예약된다.
- 공간을 보관하면 멤버 화면에서 사라진다. 앞으로의 예약이 있으면 보관할 수 없다.
- 층과 공간의 이용 대상(모두 / 지정한 팀 / 닫힘)을 정할 수 있고, "공간은 층보다 넓을 수 없다"가 서버에서 지켜진다.
- 다른 지점의 운영자와 일반 회원은 아무것도 고칠 수 없다.

## 시작 전에

1. `AGENTS.md`를 읽는다.
2. `docs/spec/space-admin.md`를 처음부터 끝까지 읽는다. 이 작업의 기준 문서다.
3. `docs/spec/roles-and-access.md`의 권한 표(`space.manage`, `plan.edit`), `can()`, "층과 공간의 접근 범위", `canAccess()`를 읽는다.
4. `docs/spec/data-model.md`의 `branches`, `floors`, `spaces`, `access_grants`와 "테스트로 확인할 제약" 17을 읽는다. `docs/spec/booking.md`의 "운영 시간"과 편의 시설 목록을 읽는다.
5. `docs/design/floor-admin.png`를 본다. 왼쪽 메뉴와 오른쪽 내용의 틀만 따른다. 이미지를 열 수 없으면 `docs/spec/space-admin.md`의 "화면"만으로 진행하고 보고에 적는다.
6. 지금 코드를 읽는다: `app/admin/`, `features/admin/`, `features/bookings/`(예약하기의 본체), `features/teams/`의 팀 찾기, `lib/dal/`, `lib/permissions/`, `lib/time/open-hours.ts`, `lib/spaces/amenities.ts`.

## 환경에 대한 전제

지시서 05와 같다. 실제 DB가 없으므로 PGlite로 검증하고, 브라우저에서의 실제 흐름은 "확인 못 함"으로 보고한다.

## 범위

| 단계 | 내용 | Jira |
| --- | --- | --- |
| 1 | 스키마 변경 | PFQV-37 |
| 2 | 이용 대상 규칙 (순수 함수) | PFQV-61 |
| 3 | 데이터 접근 계층 | PFQV-37 |
| 4 | 지점·층·공간 액션 | PFQV-37 |
| 5 | 이용 대상 액션 | PFQV-61 |
| 6 | 조회 | PFQV-37 |
| 7 | 화면 | PFQV-37, PFQV-61 |
| 8 | 문서와 마무리 | PFQV-37 |

단계마다 커밋한다. 7단계는 커밋을 둘로 나눈다: 지점·층·공간 화면은 PFQV-37, 이용 대상 구역은 PFQV-61.

## 범위 밖 (하지 않는다)

`docs/spec/space-admin.md`의 "아직 하지 않는 것" 전부. 특히:

- 평면도 편집, 게시, 평면도 JSON 올리기
- 좌석 만들기
- 점검 등록, 역할과 권한 설정, 대시보드, 예약 현황
- 지점 만들기·지우기, 층 지우기, 공간 지우기(보관만 한다)

## 단계

### 1. 스키마 변경

- `spaces_floor_name_unique` 부분 유니크 인덱스를 더한다 (`docs/spec/data-model.md`).
- 시드 데이터는 이 인덱스에 걸리지 않는다. 데이터를 고치는 마이그레이션은 쓰지 않는다.
- `tests/db/constraints.test.ts`에 제약 17을 더한다.
- `pnpm db:generate`를 다시 돌렸을 때 새 파일이 생기지 않아야 한다.

### 2. 이용 대상 규칙

`features/admin/access-rules.ts`에 순수 함수로 만든다. `docs/spec/space-admin.md`의 "이용 대상"을 따른다.

- 공간의 값이 층에 비추어 허용되는지 검사하는 함수: 층의 값과 허용 팀, 공간의 값과 허용 팀을 받아 통과 또는 이유를 돌려준다.
- 층의 값이 바뀔 때 그 층의 공간들이 어떻게 바뀌어야 하는지 계산하는 함수: 바뀔 공간과 새 값·새 허용 팀의 목록을 돌려준다.
- 화면이 쓸 "이 층에서 공간이 고를 수 있는 값" 목록도 같은 파일에서 만든다.
- 단위 테스트는 표로 쓴다. 층 3가지 × 공간 4가지(null 포함)의 허용 여부, 층이 A·B팀일 때 공간의 팀이 A / A·C / C인 경우, `teams`인데 팀이 0개인 경우. 층이 `teams`로 좁아질 때: `everyone`이던 공간(null이 됨), 일부 팀만 남는 공간, 팀이 하나도 남지 않는 공간(`closed`가 됨), `closed`이던 공간, null이던 공간. 층이 `closed`가 될 때: 어떤 공간도 바뀌지 않음.
- 자동 조정이 접근을 바꾸지 않는다는 것을 테스트로 확인한다: 팀 A, B, C의 팀원과 팀 없는 사용자 각각에 대해, "새 층 값 + 조정하기 전의 공간 설정"으로 계산한 `canAccess()`와 "새 층 값 + 조정한 뒤의 공간 설정"으로 계산한 `canAccess()`가 모든 공간에서 같다. 조정은 저장된 값을 규칙에 맞게 정리할 뿐 누구의 접근도 바꾸지 않는다는 뜻이다. 층을 `closed`로 했다가 다시 원래 값으로 돌리면 모든 공간의 판정이 처음과 같다.

### 3. 데이터 접근 계층

`lib/dal`에 필요한 함수만 더한다. DAL은 권한을 판정하지 않는다.

- 지점 고치기, 층 만들기·고치기, 지점의 가장 큰 `sort_order`.
- 공간 만들기·고치기, 보관(`archived_at`에 받은 현재 시각)과 되살리기, 층의 공간 목록(보관된 것 포함 옵션)과 공간별 허용 팀, 구역별 좌석 수.
- 공간의 끝나지 않은 확정 예약 수.
- 층·공간의 `access` 바꾸기, 대상의 허용 팀을 주어진 목록으로 맞추기(없는 것은 넣고 남는 것은 지운다).
- 팀 id 목록이 모두 실제 팀인지 확인.
- 행 잠금: 공간 `FOR UPDATE`, 층 `FOR UPDATE`와 `FOR SHARE`.
- 유니크 위반(`23505`)을 제약 이름으로 구분한다: 층 번호의 유니크 제약과 `spaces_floor_name_unique`. 층 번호 제약의 실제 이름은 마이그레이션 파일에서 확인한다.

### 4. 지점·층·공간 액션

`features/admin/`에 둔다. 05와 같은 방식이다: 일은 의존성(DB, 현재 시각, 발행 구현)을 주입받는 함수가 하고, `actions.ts`는 `createAction`으로 감싼다. 파일을 나누는 방식은 `features/teams/`와 `features/bookings/`를 따른다.

- `updateBranch`, `createFloor`, `updateFloor`, `createSpace`, `updateSpace`, `archiveSpace`, `restoreSpace`. 입력의 모양은 `docs/spec/space-admin.md`의 "액션의 입력" 그대로 `z.strictObject`로 만들고, 값의 규칙은 "입력 규칙"을 따른다. 양식과 같은 스키마를 쓴다.
- 권한: 대상 행에서 지점을 읽어 `can(ctx, 'space.manage', { branchId })`. 운영하지 않는 지점의 것이면 `NOT_FOUND`, 내 지점인데 권한이 꺼져 있으면 `FORBIDDEN`.
- `updateSpace`는 종류를 받지 않는다. 데스크 구역과 라운지의 `bookable`은 서버가 false로 고정한다. 좌석(`type = 'desk'`) 행을 대상으로 하면 `NOT_FOUND`.
- 보관, 그리고 `bookable`을 끄는 변경: 한 트랜잭션에서 공간 행을 `FOR UPDATE`로 잠그고 끝나지 않은 확정 예약을 센 뒤, 있으면 `SPACE_IN_USE`. "끝나지 않은"과 `archived_at`에는 받은 현재 시각을 바인딩한다. SQL에 `now()`를 쓰지 않는다.
- 이미 보관된 공간의 보관, 보관되지 않은 공간의 되살리기는 아무것도 바꾸지 않고 성공이다.
- 05의 `createBooking`이 공간 행을 `FOR SHARE`로 잠그고 보관·예약 불가 여부를 다시 보는지 확인한다. 빠져 있으면 더한다.
- 운영 시간을 저장할 때는 일곱 요일을 모두 채운다.
- 공간 하나가 바뀌는 액션은 커밋 뒤 `space.status_changed` 이벤트를 발행한다.

통합 테스트 (`tests/db`)

- 성공: 각 액션이 행을 기대대로 바꾼다. 새 층의 `sort_order` 기본값. 새 공간이 05의 `getFloorDay` 결과에 나오고 `createBooking`으로 예약된다.
- 입력: 정의하지 않은 키(`updateSpace`에 `type`, `floorId`, `access`, `archivedAt`을 넣은 경우 각각 `INVALID_INPUT`), 층 번호 0, 같은 층 번호(`INVALID_INPUT`과 `fieldErrors.level`), 같은 이름의 공간(`fieldErrors.name`), 대소문자만 다른 이름, 정원 0, 목록에 없는 편의 시설, 라운지에 `bookable: true`(false로 저장됨), 종류에 `desk`, 시작이 끝보다 늦은 운영 시간, 15분 단위 운영 시간.
- 권한: 일반 회원 `NOT_FOUND`, 다른 지점 운영자 `NOT_FOUND`, `role_settings`로 `space.manage`가 꺼진 운영자 `FORBIDDEN`, 로그인 안 함 `UNAUTHENTICATED`.
- 보관: 앞으로의 확정 예약이 있으면 `SPACE_IN_USE`. 예약을 취소하면 보관된다. 지난 예약만 있으면 보관된다. 보관된 공간은 `getFloorDay`에 없고 `createBooking`은 `NOT_FOUND`. 되살리면 다시 나온다. 보관한 사이 같은 이름의 공간이 생겼으면 되살리기는 `INVALID_INPUT`.
- 운영 시간을 줄인 뒤 그 밖의 시간 예약은 `OUTSIDE_HOURS`이고, 이미 있던 예약은 그대로다.

### 5. 이용 대상 액션

- `setFloorAccess`, `setSpaceAccess`. 권한은 `can(ctx, 'plan.edit', { branchId })`.
- 2단계의 순수 함수로 검사하고 계산한다. 잠금과 트랜잭션은 명세대로다: 층을 바꿀 때는 층 행 `FOR UPDATE`, 공간을 바꿀 때는 층 행 `FOR SHARE` 다음에 공간 행 `FOR UPDATE`.
- `setFloorAccess`는 같이 바뀐 공간의 목록(id, 이름, 새 값)을 돌려준다. 화면이 몇 곳이 바뀌었고 어느 공간이 "닫힘"이 됐는지 알려준다.
- 자동 조정은 새 값이 `teams`이면 이전 값과 상관없이 적용한다 (`closed`에서 `teams`로 열 때도). 보관된 공간과 좌석 행도 대상이다.
- `setSpaceAccess`의 대상이 좌석 행이거나 보관된 공간이면 `NOT_FOUND`.
- `teamIds`에 중복이 있으면 하나로 본다. 실제 팀이 아닌 id가 있으면 `INVALID_INPUT`.

통합 테스트

- 층을 `teams`로 바꾸면 `access_grants`가 목록과 같아진다. 목록을 바꾸면 빠진 팀의 행이 지워진다. `everyone`으로 바꾸면 층의 허용 팀이 지워진다.
- 층이 좁아질 때 공간이 명세대로 바뀌고 돌려준 수가 맞다. 바뀐 뒤 `canAccess()`의 결과가 기대대로다 (빠진 팀의 팀원은 못 쓰고, 남은 팀의 팀원은 쓴다).
- A팀 전용 공간이 있는 층을 B팀 전용으로 바꾸면 그 공간은 `closed`가 되고, B팀 팀원은 그 공간을 쓰지 못한다.
- 층을 `closed`로 바꿔도 공간의 값과 허용 팀이 그대로 남는다. 닫힌 동안 `setSpaceAccess`에 `everyone`이나 `teams`를 주면 `INVALID_INPUT`. 층을 다시 `everyone`으로 열면 A팀 전용이던 공간은 여전히 A팀만 쓴다.
- 공간을 층보다 넓게 정하면 `INVALID_INPUT`. 층이 A·B팀일 때 공간에 C팀을 넣으면 `INVALID_INPUT`. `teams`인데 팀이 없으면 `INVALID_INPUT`.
- 이용 대상을 바꿔도 이미 있는 예약은 그대로다. 빠진 팀은 그 뒤로 새 예약을 할 수 없다 (`FORBIDDEN`).
- 권한: `space.manage`만 있고 `plan.edit`가 꺼진 운영자는 `FORBIDDEN`. 다른 지점 운영자는 `NOT_FOUND`.

### 6. 조회

`features/admin/queries.ts`에 더한다. 현재 시각이 필요한 조회는 액션과 같은 방식으로 주입받는다. 모든 함수가 `requireSession()`을 부르고 그 지점의 운영자인지 확인한다. 아니면 `ActionError('NOT_FOUND')`. 층을 읽는 함수는 층 행에서 지점을 읽어 확인하고, 인자로 받은 `branchId`와 다르면 `NOT_FOUND`다.

- 지점 화면용: 지점 정보, 층 목록(층 번호, 이름, 순서, 이용 대상, 보관되지 않은 공간 수), 내가 가진 권한(`space.manage`, `plan.edit`).
- 층 화면용: 층 정보와 허용 팀(이름 포함), 공간 목록(보관 포함, 좌석 제외), 공간별 허용 팀, 구역별 좌석 수, 내가 가진 권한.
- 팀 찾기: 03의 DAL 함수를 그대로 쓰고 결과도 같다(팀 이름, 주 이용 지점 이름). 읽기이므로 Server Action이 아니라 주소의 쿼리(`?team=`)로 받는다.
- 테스트: 다른 지점 운영자와 일반 회원은 `NOT_FOUND`. A 지점 운영자가 자기 `branchId`와 B 지점의 `floorId`를 같이 주면 `NOT_FOUND`. 결과에 팀원 목록과 담당자 연락처가 없다.

### 7. 화면

`docs/spec/space-admin.md`의 "주소", "화면", "화면 문구"를 따른다. 색은 토큰만 쓴다.

- 모든 페이지가 `requireOperatorPage()`를 부른다. `params`와 `searchParams`는 `<Suspense>` 아래에서 읽는다.
- `admin` 레이아웃: 왼쪽 메뉴("지점", "멤버 화면으로")와 오른쪽 내용. 1024px보다 좁으면 메뉴가 위로 올라간다. 로그아웃은 메뉴 아래에 둔다. 지금 있는 곳의 표시는 `usePathname`을 쓰는 클라이언트 컴포넌트로 빼고 `<Suspense>`로 감싼다.
- `/admin`: 운영하는 지점 목록. 지점이 하나면 바로 그 지점으로 보낸다.
- 지점 화면, 층 화면: 명세대로. 공간 표는 `table`, 더하기와 고치기는 `dialog`를 쓴다.
- 운영 시간 양식: 요일마다 "쉬는 날" 스위치와 시작·끝 선택 상자(30분 단위). 쉬는 날이면 선택 상자를 비활성으로 한다.
- 이용 대상 구역: 값은 라디오 그룹으로 고른다. 고를 수 없는 값은 비활성이고 이유가 `aria-describedby`로 이어진다.
- 권한이 없는 구역은 읽기 전용으로 보여준다.
- 왼쪽 메뉴의 색은 `docs/spec/design-tokens.md`의 "운영자 사이드바" 값(배경, 선택, 글자)이다. `app/globals.css`에 `admin` 화면 범위의 `sidebar` 토큰 값으로 넣고(예: 레이아웃 래퍼의 클래스 아래에서 변수를 다시 정의), 컴포넌트에서는 `bg-sidebar` 같은 토큰 클래스만 쓴다.
- 제출은 TanStack Query mutation 안에서 하고, 성공하면 토스트를 띄우고 `onSuccess`에서 `router.refresh()`로 서버 데이터를 다시 읽는다. 대화상자의 양식에는 대상 id로 만든 `key`를 주어 다른 공간을 열 때 이전 입력이 남지 않게 한다.
- 컴포넌트 테스트: 공간 양식의 필수 값 오류와 서버의 이름 중복 표시, 라운지를 고르면 "예약 가능"이 꺼지고 비활성이 됨, 이용 대상 구역에서 층이 "지정한 팀"일 때 "모두"가 비활성, 운영 시간 양식의 쉬는 날 전환.

### 8. 문서와 마무리

- `README.md`에 운영자 화면의 주소와 할 수 있는 일을 짧게 더한다.
- `tests/e2e`의 스모크에 한 가지를 더한다: 로그인하지 않고 `/admin/branches/<아무 uuid>`에 가면 `/admin/login`이 보인다.

## 완료 기준

직접 실행해서 확인하고, 결과를 보고에 그대로 적는다.

| 확인 | 기준 |
| --- | --- |
| `pnpm lint` | 오류 0 |
| `pnpm typecheck` | 오류 0 |
| `pnpm test` | 전부 통과, 건너뛴 테스트 없음. 제약 17과 2–7단계의 테스트 포함 |
| `pnpm build` | `DATABASE_URL`, `AUTH_SECRET` 없이 성공. Cache Components 관련 오류 없음 |
| `pnpm db:generate` | 새 마이그레이션 파일이 생기지 않음 |
| `git status` | 깨끗함 |
| 권한 | 모든 액션과 queries가 대상 행에서 읽은 지점으로 판정함. 클라이언트가 보낸 `branchId`만 믿는 곳이 없음 |
| 입력 | 모든 액션의 입력이 `z.strictObject`임. 정의하지 않은 키가 거절됨 |
| 시계 | 이 작업이 더한 SQL에 `now()`가 없음 |
| 규칙 | 층을 좁혀도 어떤 공간도 전보다 넓어지지 않음. 2단계와 5단계 테스트로 확인 |
| 노출 | 운영자 화면의 응답에 팀원 목록, 담당자 연락처, 남의 지점 데이터가 없음 |
| 보호 | 새 `page.tsx`가 모두 `requireOperatorPage()`를 부름 (목록을 보고에 적는다) |

브라우저에서의 실제 흐름은 "확인 못 함"으로 적고, 사람이 확인할 순서(관리자로 로그인 → 강남점 → 6층에 회의실 더하기 → 멤버로 로그인해 그 회의실 예약 → 관리자로 보관 시도(막힘) → 예약 취소 뒤 보관 → 8층 이용 대상에 그로스팀 더하기)를 보고에 적는다.

## 막혔을 때

- 규칙이 문서에 없으면 더 안전한 쪽(덜 허용하는 쪽)으로 정하고 보고에 적는다.
- 문서끼리 다르면 `AGENTS.md`, `docs/spec/space-admin.md`, 그 밖의 `docs/spec/`, 이 지시서 순으로 우선한다.
- 테이블, 컬럼, 제약, 결과 코드, 주소의 이름은 임의로 바꾸지 않는다.

## 최종 보고

`AGENTS.md`의 "최종 보고 형식"을 따른다.
