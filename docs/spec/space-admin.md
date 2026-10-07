# 운영자의 지점·층·공간 관리

운영자가 양식으로 지점 정보, 층, 공간, 이용 대상을 입력하는 쪽을 정한다. 평면도 위의 모양은 여기서 다루지 않는다. 모양은 평면도 편집기(PFQV-38)에서 그리고, 모양이 없는 공간도 목록에서 예약할 수 있다.

## 사용자 행동과 데이터

| # | 운영자 행동 | 주소·호출 | 읽기 | 쓰기 | 필요한 권한 |
| --- | --- | --- | --- | --- | --- |
| 1 | 운영하는 지점을 고른다 | `/admin` | `branch_staff`, `branches` | – | 어느 지점이든 운영자 |
| 2 | 지점 정보와 운영 시간을 고친다 | `updateBranch` | `branches` | `branches.name`, `address`, `open_hours` | `space.manage` |
| 3 | 층을 더하거나 고친다 | `createFloor`, `updateFloor` | `floors` | `floors` | `space.manage` |
| 4 | 공간을 더하거나 고친다 | `createSpace`, `updateSpace` | `spaces` | `spaces` | `space.manage` |
| 5 | 공간을 보관하거나 되살린다 | `archiveSpace`, `restoreSpace` | `spaces`, 앞으로의 `bookings` | `spaces.archived_at` | `space.manage` |
| 6 | 층의 이용 대상을 정한다 | `setFloorAccess` | `floors`, `access_grants`, `teams` | `floors.access`, `access_grants`, 필요하면 그 층 공간의 `access` | `plan.edit` |
| 7 | 공간의 이용 대상을 정한다 | `setSpaceAccess` | `spaces`, `floors`, `access_grants` | `spaces.access`, `access_grants` | `plan.edit` |
| 8 | 허용할 팀을 찾는다 | 층 화면의 `?team=` | `teams`(이름), `branches`(주 이용 지점 이름) | – | 그 지점의 운영자 |

4번에서 "예약 가능"을 끌 때와 5번은 그 공간의 끝나지 않은 `bookings`를 읽는다.

모든 권한은 그 지점에 대해 판정한다: `can(ctx, 권한, { branchId })`. `branchId`는 클라이언트가 보낸 값이 아니라 고치려는 층·공간 행에서 거슬러 올라가 읽는다. 다른 지점의 운영자는 일반 사용자와 같다.

## 주소

| 주소 | 내용 |
| --- | --- |
| `/admin` | 운영하는 지점 목록. 지점을 누르면 그 지점으로 간다. 운영하는 지점이 하나면 바로 그 지점으로 보낸다 |
| `/admin/branches/[branchId]` | 지점 정보와 운영 시간, 층 목록, 층 더하기 |
| `/admin/branches/[branchId]/floors/[floorId]` | 층 정보, 층의 이용 대상, 공간 목록, 공간 더하기·고치기 |

- 모두 `admin` 그룹이고 모든 페이지가 `requireOperatorPage()`를 부른다. 그다음 그 지점의 운영자인지 queries가 확인하고, 아니면 `notFound()`다.
- 층 화면의 조회는 주소의 `branchId`를 믿지 않는다. 층 행에서 지점을 읽어 그 지점의 운영자인지 확인하고, 그 지점이 주소의 `branchId`와 다르면 `NOT_FOUND`다. 주소의 지점만 확인하고 층을 읽으면 A 지점 운영자가 B 지점의 층을 볼 수 있다.
- 지점을 새로 만드는 화면은 없다. 지점은 `pnpm admin:create --create-branch`나 시드로 만든다.

## 입력 규칙

### 지점

| 입력 | 규칙 |
| --- | --- |
| 이름 | 앞뒤 공백을 뺀 1–40자 |
| 주소 | 100자 이하. 비울 수 있다 |
| 운영 시간 | 요일마다 "쉬는 날" 또는 시작·끝 시각. 30분 단위, 시작 < 끝, 끝은 24:00까지. 모양은 `docs/spec/booking.md`의 "운영 시간". 저장할 때는 일곱 요일을 모두 채워 넣는다 |

- 시간대는 고치지 않는다. 이미 있는 예약의 현지 시각이 달라지기 때문이다.
- 운영 시간을 줄여도 이미 있는 예약은 그대로 둔다.

### 층

| 입력 | 규칙 |
| --- | --- |
| 층 번호 (`level`) | -5에서 100 사이의 정수. 0은 안 된다. 한 지점에서 유일하다 |
| 이름 | 1–20자. 예: "7F" |
| 순서 (`sort_order`) | 0에서 999 사이의 정수. 기본값은 지금 가장 큰 값 + 1 |

- 같은 층 번호가 있으면 `INVALID_INPUT`이고 `fieldErrors.level`을 채운다. 유니크 제약 위반(`23505`)으로 판정한다.
- 층을 지우는 기능은 없다.

### 액션의 입력

아래 일곱 액션의 입력이다. 모두 `z.strictObject`로 만들고, 적힌 것 말고 다른 키가 오면 `INVALID_INPUT`이다. 이 일곱 액션은 `parentId`, `access`, `archivedAt`, `timezone`, `bookingRules`를 받지 않는다. `type`과 `floorId`는 만들 때만, `branchId`는 `updateBranch`와 `createFloor`만 받는다. 이용 대상은 아래 "이용 대상"의 두 액션으로만 바꾼다.

```ts
updateBranch  { branchId, name, address, openHours }      // openHours는 일곱 요일을 모두 채운 값
createFloor   { branchId, level, name, sortOrder? }
updateFloor   { floorId, level, name, sortOrder }
createSpace   { floorId, type, name, capacity, bookable, amenities }
updateSpace   { spaceId, name, capacity, bookable, amenities }
archiveSpace  { spaceId }
restoreSpace  { spaceId }
```

- `address`는 빈 문자열이면 null로 저장한다. `capacity`는 라운지에서만 null을 받는다.
- 이미 보관된 공간을 보관하거나 보관되지 않은 공간을 되살리면 아무것도 바꾸지 않고 성공으로 돌려준다.

### 공간

| 입력 | 규칙 |
| --- | --- |
| 종류 | `meeting_room` 회의실, `seminar` 세미나실, `phone_booth` 폰부스, `desk_area` 데스크 구역, `lounge` 라운지. 좌석(`desk`)은 여기서 만들지 않는다 |
| 이름 | 앞뒤 공백을 뺀 1–40자. 같은 층의 보관되지 않은 공간 사이에서 대소문자를 무시하고 유일하다 |
| 정원 | 1–500의 정수. 라운지는 비울 수 있다 |
| 예약 가능 | 회의실·세미나실·폰부스만 켜고 끌 수 있다. 데스크 구역과 라운지는 꺼짐으로 고정이다 |
| 편의 시설 | `docs/spec/booking.md`의 여섯 개 중에서 고른다 |

- 종류는 만든 뒤에 바꿀 수 없다.
- 같은 이름이 있으면 `INVALID_INPUT`이고 `fieldErrors.name`을 채운다. 유니크 인덱스 위반으로 판정한다.
- 좌석 행(`type = 'desk'`)은 목록에 개수만 보여주고 고치지 않는다.
- `booking_rules`는 쓰지 않는다. 빈 값으로 둔다.

### 보관

- 공간은 지우지 않고 보관한다 (`archived_at`). 보관된 공간은 멤버 화면과 예약에서 사라지고, 운영자 목록에는 "보관됨"으로 남아 되살릴 수 있다.
- 아직 끝나지 않은 확정 예약이 하나라도 있으면 보관할 수 없다 (`SPACE_IN_USE`). "예약 가능"을 끌 때도 같다.
- "끝나지 않은"과 `archived_at`에 쓰는 현재 시각은 DB의 `now()`가 아니라 서비스 함수가 받은 현재 시각을 바인딩해서 쓴다. 테스트가 시각을 고정할 수 있어야 한다.
- 확인과 변경은 한 트랜잭션에서 한다. 그 공간 행을 `FOR UPDATE`로 잠근 뒤 예약을 센다. `createBooking`도 같은 공간 행을 `FOR SHARE`로 잠근 뒤 넣어서, 보관과 예약이 동시에 일어나도 보관된 공간에 예약이 생기지 않게 한다.
- 되살릴 때 같은 이름의 공간이 그 사이에 생겼으면 `INVALID_INPUT`.

## 이용 대상

값과 뜻은 `docs/spec/roles-and-access.md`의 "층과 공간의 접근 범위"를 따른다.

### 층 (`setFloorAccess`)

```ts
input: { floorId: string; access: 'everyone' | 'teams' | 'closed'; teamIds: string[] }
```

- `teams`이면 `teamIds`가 1개 이상 20개 이하이고 모두 실제 팀이어야 한다. 다른 값이면 `teamIds`는 빈 배열이어야 한다.
- 한 트랜잭션에서 한다: `floors.access`를 바꾸고, 그 층의 `access_grants`를 `teamIds`로 맞춘다.
- 규칙에 어긋나게 된 공간은 같은 트랜잭션에서 고친다. 새 값이 `teams`이면 이전 값이 무엇이었든 아래를 적용한다. 보관된 공간과 좌석 행도 대상이다. 이 정리는 저장된 값을 규칙에 맞출 뿐이고, 누구의 접근도 바꾸지 않는다.
  - 층이 `closed`가 되면: 공간의 `access`와 허용 팀은 건드리지 않는다. 판정은 `canAccess()`가 층을 보고 닫힘으로 본다. 층을 다시 열면 공간의 설정이 그대로 살아난다.
  - 층이 `teams`가 되면: `access`가 `everyone`이던 공간은 null로 바꾼다(층의 팀만 쓰게 되므로 좁아진다). `teams`이던 공간은 허용 팀에서 층의 허용 팀에 없는 팀을 빼고, 하나도 남지 않으면 `closed`로 바꾸고 허용 팀을 지운다. null로 바꾸면 안 된다. A팀 전용이던 방이 층의 B팀에게 열리게 된다.
  - 층이 `everyone`이 되면: 공간은 그대로 둔다.
- 응답으로 같이 바뀐 공간의 목록(id, 이름, 새 값)을 돌려주고 화면이 알려준다.
- 이미 있는 예약은 그대로 둔다. 이용 대상에서 빠진 팀의 예약도 취소하지 않는다.

### 공간 (`setSpaceAccess`)

```ts
input: { spaceId: string; access: 'everyone' | 'teams' | 'closed' | null; teamIds: string[] }
```

- null은 "층 설정을 따름"이다.
- 층보다 넓을 수 없다. 층이 `teams`이면 공간은 null, `teams`(층의 허용 팀 중 일부), `closed`만 된다. 층이 `closed`인 동안에는 null과 `closed`만 새로 정할 수 있다 (이미 있던 값은 그대로 남아 있을 수 있다). 어긋나면 `INVALID_INPUT`.
- `teams`이면 `teamIds`가 1개 이상이어야 한다.
- 좌석 행과 보관된 공간은 대상이 아니다 (`NOT_FOUND`).
- 한 트랜잭션에서 층 행을 `FOR SHARE`로, 이어서 공간 행을 `FOR UPDATE`로 잠근 뒤 검사하고 바꾼다. 층의 이용 대상이 동시에 바뀌거나 같은 공간을 두 사람이 동시에 고쳐도 규칙이 깨지지 않게 하려는 것이다. 잠그는 순서는 언제나 층 → 공간 → 사용자·팀이다.

### 팀 고르기

- 허용할 팀은 이름으로 찾는다. 검색어는 정규화한 뒤 2–40자, 대소문자 무시, 최대 10건이고 결과는 팀 이름과 주 이용 지점 이름이다. 팀 가입 요청에서 쓰는 팀 찾기와 같은 DAL 함수를 쓴다.
- 운영자에게 팀원 목록이나 담당자 연락처를 보여주지 않는다.

## 액션 공통

- `features/admin/actions.ts`에 `createAction`으로 만든다. 모든 액션의 `authorize`가 대상 행에서 지점을 읽어 `can()`으로 판정한다.
- 없는 지점·층·공간이거나 내가 운영하지 않는 지점의 것이면 `NOT_FOUND`. 다른 지점에 무엇이 있는지 드러내지 않는다.
- 내 지점이지만 권한이 꺼져 있으면 `FORBIDDEN`. (운영자가 역할 설정에서 자기 권한을 끈 경우다.)
- 성공하면 서버 데이터를 다시 읽는다.
- 공간 하나가 바뀌는 액션(고치기, 보관, 되살리기, 공간의 이용 대상)은 커밋 뒤 `floor:{floorId}` 채널에 `{ type: 'space.status_changed', spaceId }`를 발행한다. 층 단위 변경은 발행하지 않는다. 맞는 이벤트가 아직 없고, 실시간 작업에서 더한다.

## 화면

화면의 구성과 로딩 상태는 `docs/spec/ui.md`의 "운영자 화면"이 정하고, 이 절과 다르면 `docs/spec/ui.md`가 맞다. 이 절에는 첫 구현(지시서 06)의 기준이 남아 있다. 입력 규칙과 권한은 그대로 유효하다.

`docs/design/floor-admin.png`의 틀(왼쪽 메뉴, 오른쪽 내용)을 따르되, 메뉴의 색은 `docs/spec/design-tokens.md`의 "운영자 사이드바" 값을 `sidebar` 토큰으로 넣어 쓰고 컴포넌트에 hex를 직접 쓰지 않는다. 그리고 메뉴에는 지금 있는 것만 둔다: "지점", 그리고 멤버 화면으로 가는 "멤버 화면으로". 대시보드, 평면도 편집, 예약 현황, 역할과 권한, 공지·문의는 만들지 않는다.

- 지점 화면: 지점 정보 양식(이름, 주소, 요일별 운영 시간), 층 목록(층 번호, 이름, 이용 대상, 공간 수), "층 더하기".
- 층 화면: 층 정보 양식, 이용 대상 구역, 공간 표.
- 공간 표의 열: 이름, 종류, 정원, 예약 가능, 편의 시설, 이용 대상, 상태(보관됨). 보관된 공간은 기본으로 숨기고 "보관된 공간 보기"로 켠다.
- 공간 더하기와 고치기는 대화상자의 양식이다. 이용 대상은 같은 대화상자의 별도 구역이고 저장 버튼도 따로다 (권한이 다르기 때문).
- 이용 대상 구역: "모두 / 지정한 팀 / 닫힘" 세 가지 중 하나를 고른다. 공간에는 "층 설정을 따름"이 하나 더 있다. 층 때문에 고를 수 없는 값은 비활성으로 하고 이유를 한 줄로 적는다. "지정한 팀"을 고르면 팀 찾기와 고른 팀 목록이 나온다.
- 권한이 없는 구역은 숨기지 않고 읽기 전용으로 보여준다. 서버는 화면과 상관없이 판정한다.
- 양식의 오류, 제출 중 비활성, 중복 제출 방지, 토스트는 다른 화면과 같은 방식이다.

### 화면 문구

| 곳 | 문구 |
| --- | --- |
| 층 번호 중복 | 이미 있는 층이에요 |
| 공간 이름 중복 | 이 층에 같은 이름의 공간이 있어요 |
| `SPACE_IN_USE` | 예정된 예약이 있어서 바꿀 수 없어요. 예약이 끝나거나 취소된 뒤에 다시 해 주세요 |
| 보관 확인 | 이 공간을 보관할까요? 멤버 화면에서 보이지 않게 돼요 |
| 층 이용 대상 저장 뒤 (공간이 같이 바뀜) | 저장했어요. 공간 {N}곳의 이용 대상도 층에 맞게 바뀌었어요 |
| 위에서 닫힘이 된 공간이 있을 때 덧붙임 | {공간 이름}은 쓸 수 있는 팀이 없어 닫힘이 됐어요 |
| 층 때문에 고를 수 없음 | 층이 "{층의 값}"이라 고를 수 없어요 |
| 공간 없음 | 공간이 아직 없어요. 공간을 더해 주세요 |

## 아직 하지 않는 것

- 평면도 편집과 게시 (PFQV-38–41), 평면도 JSON 올리기
- 좌석(`type = 'desk'`) 만들기와 자동 배열 (PFQV-39)
- 점검 등록과 해제 (PFQV-42). 시드가 넣은 점검만 있다
- 역할별 권한과 한도 설정 화면 (PFQV-60)
- 지점 만들기·지우기, 층 지우기, 시간대 바꾸기
- 운영자의 예약 현황, 통계
