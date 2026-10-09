# 평면도 데이터 형식

평면도는 층마다 JSON 문서 한 개이고 `floor_plans.document`에 저장한다. 이 형식은 zod 스키마 하나(`lib/floor-plan/schema.ts`)로 정의해서 편집기 저장, 게시 검증, 렌더러 로드에 똑같이 쓴다.

## 좌표

- 단위는 밀리미터 정수다. 소수 오차 없이 저장·비교하기 위해서다.
- 원점은 왼쪽 위, x는 오른쪽으로, y는 아래로 커진다. 캔버스 좌표계와 방향이 같다.
- 점은 `[x, y]` 튜플이다.
- 곡선은 지원하지 않는다. 직선만 쓴다.

## 문서 구조

```json
{
  "schema": 1,
  "unit": "mm",
  "bounds": { "w": 42000, "h": 28000 },
  "walls": [
    { "id": "w1", "points": [[0,0],[42000,0],[42000,28000],[0,28000]], "thickness": 200, "closed": true }
  ],
  "openings": [
    { "id": "d1", "wallId": "w1", "at": 0.35, "width": 900, "kind": "door" }
  ],
  "spaces": [
    { "id": "sh_b", "spaceId": "<spaces.id uuid>", "polygon": [[8000,1000],[18000,1000],[18000,7000],[8000,7000]], "label": { "at": [13000,4000] } }
  ],
  "seats": [
    { "id": "k07", "spaceId": "<spaces.id uuid>", "at": [3600,11200], "size": [1400,700], "rotation": 0, "label": "A-07" }
  ],
  "fixtures": [
    { "id": "f1", "kind": "core", "polygon": [[26000,20000],[33000,20000],[33000,27000],[26000,27000]], "label": "코어 · 엘리베이터" }
  ],
  "background": { "transform": [1,0,0,1,0,0], "opacity": 0.5 }
}
```

| 도형 | 필드 | 설명 |
| --- | --- | --- |
| `walls[]` | `id`, `points`(2개 이상), `thickness`(mm), `closed` | 외벽과 칸막이를 같은 방식으로. polyline |
| `openings[]` | `id`, `wallId`, `at`(0–1, 벽 위 위치), `width`(mm), `kind`(`door` 또는 `opening`) | 벽을 옮겨도 문이 따라간다 |
| `spaces[]` | `id`, `spaceId`(uuid), `polygon`(3개 이상), `label.at` | ㄱ자 같은 오목한 방도 표현한다 |
| `seats[]` | `id`, `spaceId`(uuid, type=desk 공간), `at`(중심점), `size`(`[w, h]`), `rotation`(도), `label`(선택, 1–20자) | 수백 개라 다각형보다 가볍게. `label`은 편집기가 쓰는 좌석 이름이다 (아래 "좌석 이름") |
| `fixtures[]` | `id`, `kind`(`core`, `stairs`, `storage`), `polygon`, `label`(선택) | 예약 불가. 배경처럼 그린다 |
| `background` | `transform`(2D 변환 행렬 6개 값), `opacity`(0–1) | 선택. 편집용이고 멤버 화면에는 내려보내지 않는다. 이미지의 저장소 키는 문서가 아니라 `floor_plans.background_image` 컬럼에 둔다 |

- `schema`는 지금 `1`만 허용한다. `unit`은 `"mm"`만 허용한다.
- 도형의 `id`는 문서 안에서 유일한 짧은 문자열이다. DB의 id가 아니다.
- `spaces[].spaceId`와 `seats[].spaceId`만 DB(`spaces.id`)를 가리킨다. `fixtures[]`는 DB 행이 없다.
- `walls`, `openings`, `spaces`, `seats`, `fixtures`는 필수 배열이고 빈 배열을 허용한다. `background`만 생략할 수 있다.
- `spaces[].label`은 필수다. `fixtures[].label`은 선택이다.
- 정의하지 않은 키는 거부한다 (zod `strict`).
- `rotation`은 정수(도)다. 편집기는 0, 90, 180, 270만 만든다. 스키마는 정수면 받는다.
- `label`은 지시서 39에서 더한다. 앞뒤 공백을 뺀 1–20자. 스키마 버전은 `1` 그대로다 (선택 필드라 지금 문서가 그대로 통과한다).

## 검증 규칙

### 스키마에서 바로 검사 (셋업 범위)

zod 스키마와 `superRefine`으로 검사한다. DB가 필요 없다.

- 좌표, 크기, 두께는 정수. `bounds.w`, `bounds.h`, `thickness`, `width`, `size`는 양수
- `polygon`은 꼭짓점 3개 이상, `walls[].points`는 2개 이상
- 모든 점은 `bounds` 안 (0 ≤ x ≤ w, 0 ≤ y ≤ h). 좌석은 중심점 `at`만 검사한다
- 도형 `id`는 문서 전체에서 중복 없음
- `openings[].wallId`는 문서 안의 벽 id
- 같은 `spaceId`를 가리키는 `spaces[]` 도형은 1개, `seats[]`도 1개
- 크기 상한 (지시서 38): 공간 도형 300개, 좌석 2000개, 벽 300개, 문 300개, 고정물 100개, 다각형·벽의 꼭짓점 64개. JSON으로 바꾼 크기 1MB
- `at`(openings)은 0 이상 1 이하, `opacity`는 0 이상 1 이하

### 게시할 때 검사 (지시서 38–39, PFQV-41)

스키마 검사를 통과한 문서에 DB의 공간 목록을 더해 검사한다. 순수 함수 `validatePlan(document, context): PlanIssue[]`(`lib/floor-plan/validate.ts`) 하나를 편집기(입력할 때마다, 화면에 표시)와 게시 액션(트랜잭션 안에서 다시 읽은 값으로)이 같이 쓴다. 예약에 관한 검사(아래 표의 "서버만")는 DB가 필요해서 게시 액션만 한다.

```ts
export type PlanIssue = { code: PlanIssueCode; shapeId?: string; message: string };
type PlanContext = {
  floorId: string;
  floorAccess: AccessScope; floorAllowedTeamIds: string[];
  spaces: { id: string; floorId: string; type: SpaceType; name: string; bookable: boolean;
            archived: boolean; access: AccessScope | null; allowedTeamIds: string[] }[]; // 이 층의 보관되지 않은 공간 + 문서가 가리키는 행
};
```

| 코드 | 뜻 | 막는가 | 어디서 |
| --- | --- | --- | --- |
| `SPACE_UNKNOWN` | 공간 도형의 `spaceId`가 DB에 없음 | 막음 | 둘 다 |
| `SPACE_OTHER_FLOOR` | 다른 층의 공간을 가리킴 | 막음 | 둘 다 |
| `SPACE_ARCHIVED` | 보관된 공간을 가리킴 | 막음 | 둘 다 |
| `SPACE_IS_DESK` | 공간 도형이 좌석(`desk`) 행을 가리킴. 좌석은 `seats[]`로만 | 막음 | 둘 다 |
| `SHAPE_MISSING` | 이 층의 보관되지 않은 공간(좌석 제외) 가운데 도형이 없는 것. 라운지도 포함 | 막음 | 둘 다 |
| `POLYGON_SELF_INTERSECT` | 다각형의 변이 서로 교차함 (이웃한 변이 꼭짓점을 나누는 것은 교차가 아님) | 막음 | 둘 다 |
| `POLYGON_TOO_SMALL` | 면적 0.5㎡(500,000㎟) 미만 | 막음 | 둘 다 |
| `SPACE_OVERLAP` | 공간 도형끼리, 또는 공간 도형과 고정물이 겹침. 변이 맞닿는 것은 괜찮다 | 막음 | 둘 다 |
| `LABEL_OUTSIDE` | `label.at`이 그 다각형 밖 | 막음 | 둘 다 |
| `SEAT_OUTSIDE_AREA` | 좌석의 중심이 `desk_area` 공간 도형 정확히 하나의 안에 있지 않음 | 막음 | 둘 다 |
| `SEAT_OVERLAP` | 좌석의 사각형(회전 반영)끼리 겹침 | 막음 | 둘 다 |
| `SEAT_LABEL_MISSING` | 이름이 없는 좌석 (DB에 없는 새 좌석은 `label`이 꼭 있어야 한다) | 막음 | 둘 다 |
| `SEAT_LABEL_DUPLICATE` | 같은 층에서 좌석 이름이 겹침 (대소문자 무시) | 막음 | 둘 다 |
| `SEAT_NOT_DESK` | 좌석의 `spaceId`가 DB에 있는데 `desk`가 아님, 또는 다른 층의 좌석 | 막음 | 둘 다 |
| `ACCESS_TEAMS_EMPTY` | 이용 대상이 "지정한 팀"인데 허용 팀이 없음 (층 또는 공간) | 막음 | 둘 다 |
| `ACCESS_WIDER_THAN_FLOOR` | 공간의 이용 대상이 층보다 넓음 | 막음 | 둘 다 |
| `SEAT_REMOVED_WITH_BOOKINGS` | 이번 게시로 없어지는 좌석에 앞으로의 확정 예약이 있음. `shapeId` 없음, `message`에 좌석 이름 | 막음 | 서버만 |
| `AREA_HAS_BOOKINGS` | 처음 좌석이 생기는 `desk_area`에 구역 단위의 앞으로의 확정 예약이 있음 | 막음 | 서버만 |
| `SPACE_NO_SEATS` | 좌석 행이 있던 `desk_area`에서 좌석이 모두 없어짐 (구역은 계속 `bookable = false`) | 알림만 | 둘 다 |

- 겹침 판정은 정수 좌표의 단순 다각형끼리다: 한쪽의 변이 다른 쪽의 변과 끝점이 아닌 곳에서 교차하거나, 한쪽의 꼭짓점이 다른 쪽의 안(경계 위는 밖으로 친다)에 있거나, 두 다각형이 같으면 겹친다. 오목한 다각형도 같은 방법으로 본다. 곱셈은 `number`의 안전한 정수 범위 안이다 (좌표가 100,000mm 이하라서).
- "막음"이 하나라도 있으면 게시할 수 없다 (`PLAN_INVALID`, `message`는 쓰지 않고 결과의 `issues`로 돌려준다). "알림만"은 게시 확인 창에 보여주고 게시를 막지 않는다.
- 편집기에서는 문제가 있는 도형을 주황(아래 "색"의 "편집기의 검사 문제")으로 강조하고, 위쪽의 "검사 문제 N" 버튼과 오른쪽 패널의 목록에서 그 도형으로 이동할 수 있다.
- 메시지 문장은 화면 문구로 쓴다. 예: "회의실 D: 이용 대상이 '지정한 팀'인데 허용 팀이 없어요."

## 버전과 게시

- 게시된 문서는 수정하지 않고 새 버전으로만 바꾼다. 그래서 클라이언트는 (평면도 id)를 키로 문서를 영구 캐시할 수 있다.
- 층마다 초안은 하나다 (`floor_plans_one_draft`). 초안은 편집기에서 처음 저장할 때 만든다: 게시본이 있으면 그 문서와 배경 이미지 키를 복사하고, 없으면 빈 문서(벽·도형 없음, `bounds`는 30,000×20,000)로 시작한다. 버전 번호는 그 층의 가장 큰 번호 + 1이다.
- 초안 저장은 `revision`으로 낙관적 동시성을 지킨다 (아래 "편집기"의 "저장").
- 게시 트랜잭션(지시서 39): 층 행 잠금 → 초안 잠금 → 다시 검사(위 표, 서버만 포함) → 좌석 행 맞추기(아래 "좌석 행") → 기존 게시본 `archived` → 초안 `published`(`published_at` = 지금) → `floors.published_plan_id` 갱신. 커밋 뒤 `floor:{floorId}`에 `plan.published`를 보낸다.
- 지난 버전(`published`, `archived`)은 편집기의 "버전" 목록에서 본다. "이 버전으로 초안 만들기"는 그 문서를 지금 초안에 덮어쓴다 (초안이 있으면 확인을 받는다. 초안이 없으면 새로 만든다). 지난 버전을 바로 다시 게시하는 기능은 없다. 초안을 거쳐 같은 검사를 받는다.

### 좌석 행 (지시서 39)

좌석은 `spaces`의 `type = 'desk'` 행이다 (`docs/spec/data-model.md`). 편집하는 동안에는 문서에만 있고, DB 행은 게시할 때 맞춘다.

| 문서의 좌석 | DB | 게시할 때 |
| --- | --- | --- |
| `spaceId`가 이 층의 보관되지 않은 좌석 | 있음 | 이름(`label`)이나 속한 구역이 바뀌었으면 `name`, `parent_id`를 고친다 |
| `spaceId`가 DB에 없음 (편집기가 만든 새 uuid) | 없음 | 그 id로 행을 만든다: `type = 'desk'`, `parent_id` = 중심이 들어 있는 `desk_area`, `name` = `label`, `capacity` = 1, `bookable` = true, `access` = null, `amenities` = `{}` |
| 없음 | 이 층의 보관되지 않은 좌석 | `archived_at` = 지금. 앞으로의 확정 예약이 있으면 게시를 막는다 (`SEAT_REMOVED_WITH_BOOKINGS`) |

- 처음 좌석이 생긴 `desk_area`는 `bookable = false`로 바꾼다 (`docs/spec/data-model.md`의 `spaces` 규칙). 구역 단위의 앞으로의 예약이 있으면 막는다 (`AREA_HAS_BOOKINGS`).
- 좌석의 이름 유일성은 `spaces_floor_name_unique`가 DB에서도 지킨다. 같은 게시 안에서 이름을 맞바꾸는 경우(A-01 ↔ A-02)를 위해 이름을 바꾸는 행은 먼저 임시 이름(`~{id 앞 8자}`)으로 바꾼 뒤 최종 이름으로 바꾼다.
- 보관된 좌석의 id가 문서에 다시 나오면 되살리지 않는다. 편집기는 새 좌석에 언제나 새 uuid를 준다.
- 좌석 예약의 겹침과 보관 사이의 경쟁: 게시는 보관할 좌석 행을 `FOR UPDATE`로 잠근 뒤 앞으로의 예약을 센다. 좌석 예약 액션은 이미 좌석 행을 `FOR SHARE`로 잠근다 (`lib/dal/bookings.ts`의 `lockSpaceForBooking`). 잠근 뒤 `archived_at`을 다시 보는지는 지시서 39가 확인하고, 보지 않으면 더한다.

## 예시 파일

- `docs/spec/examples/gangnam-7f.plan.json` — 가상 지점 "강남점 7층" 평면도. 회의실 4, 폰부스 2, 오픈 데스크 구역 1(좌석 24), 라운지, 세미나룸, 코어
- `docs/spec/examples/gangnam-7f.spaces.json` — 위 문서가 가리키는 `spaces` 행 (id, 유형, 이름, 정원, 부모, 접근 범위)

`plan.json`은 스키마 테스트의 통과 사례다. `spaces.json`은 평면도 문서가 아니라 교차 검사용 데이터다: plan의 모든 `spaceId`가 `spaces` 목록에 있고, 좌석이 가리키는 행은 `type = 'desk'`다. 지점, 팀, 허용 팀(`accessGrants`)도 들어 있어 `canAccess()` 테스트의 입력으로 쓸 수 있다.

실패 사례(범위 밖 좌표, 중복 id, 꼭짓점 2개짜리 다각형, 없는 `wallId`)는 테스트 안에서 `plan.json`을 조금씩 바꿔서 만든다.

- `docs/spec/examples/seed-plans.json`과 `docs/spec/examples/plans/*.plan.json` (지시서 33) — 강남점 7층을 뺀 10개 층의 시드 평면도. 형식은 `seed.json`의 `floorPlans`와 같다. 모든 문서가 스키마와 위 "게시할 때 검사"(서버만인 것 빼고)를 통과해야 한다. 좌석은 없다.

## 렌더러 (지시서 33–34, PFQV-15–18, 21)

멤버의 평면도 보기, 운영자 대시보드의 이용률 지도, 편집기가 같은 렌더러를 쓴다. Canvas 2D로 그린다. 공간과 좌석이 수백–수천 개가 되어도 DOM 노드를 늘리지 않고, 상태가 바뀐 곳만 다시 그리기 위해서다. 화면 읽기 프로그램과 키보드는 캔버스 대신 아래 "접근성"의 DOM이 맡는다.

### 모듈

`lib/floor-plan/render/`에 React와 무관한 순수 TypeScript로 둔다. React 쪽은 `features/floor-plan/components/plan-canvas.tsx` 하나가 감싼다.

| 모듈 | 하는 일 |
| --- | --- |
| `camera.ts` | 월드(mm) ↔ 화면(CSS px) 변환. `{ scale, x, y }`. 화면 맞춤(`fit(bounds, viewport, padding)`), 한 점을 고정한 확대(`zoomAt`), 이동(`pan`). 배율은 맞춤 배율의 0.5–8배로 제한 |
| `scene.ts` | 문서를 그리기 좋은 모양으로 한 번 바꾼다: 도형마다 `Path2D`, 경계 상자, 라벨 위치, 문(벽 위의 위치를 점과 방향으로). 문서가 바뀔 때만 다시 만든다 |
| `spatial-index.ts` | 경계 상자의 R-tree. 화면에 보이는 도형 고르기와 히트 테스트에 쓴다. 외부 의존성 `rbush`를 쓴다 |
| `layers.ts` | 세 층의 캔버스: 고정(벽, 고정물, 공간의 바탕과 테두리, 좌석의 바탕), 상태(공간과 좌석의 상태 색, 라벨), 덧그림(hover, 선택, 포커스 고리, 편집기의 손잡이). 각 층은 겹친 `<canvas>`다 |
| `draw.ts` | 층마다의 그리기 함수. 색은 아래 "색"에서 받은 값만 쓴다 |
| `hit-test.ts` | 화면 점 → 월드 점 → R-tree 후보 → 정확한 판정(점이 다각형 안, 좌석은 회전한 사각형 안). 좌석이 공간보다 먼저 맞는다 |
| `worker.ts` (지시서 34) | 문서의 전처리(경계 상자, 라벨 위치, 문 위치, R-tree에 넣을 항목)를 Web Worker에서 한다. 결과는 구조화 복제가 되는 값만(숫자 배열). `Path2D`는 워커에서 만들 수 없으므로 메인 스레드가 결과의 좌표로 만든다. Worker를 쓸 수 없으면 같은 함수를 메인 스레드에서 부른다 |

- 그리기는 `requestAnimationFrame` 한 번에 모은다. 카메라가 바뀌면 세 층을 모두, 상태가 바뀌면 상태 층의 그 도형이 차지하는 영역(dirty rect, 화면 좌표의 경계 상자 + 2px)만, hover·선택이 바뀌면 덧그림 층만 다시 그린다.
- `devicePixelRatio`를 반영해 캔버스 크기를 정하고, `ResizeObserver`로 크기 변화를 받는다.
- 문(`openings[]`)의 `at`은 벽 polyline 전체 길이에 대한 비율이다 (닫힌 벽은 마지막 점에서 첫 점으로 가는 변까지 포함한 길이). 그 위치의 변 위에 폭만큼 벽을 끊고, `door`면 사분원 호를 그린다.
- 라벨은 도형이 화면에서 충분히 클 때만 그린다: 공간 이름은 화면 너비 54px 이상, 아랫줄(정원·상태)은 높이 46px 이상, 좌석 이름은 좌석 너비 34px 이상. 글자 크기는 11–13px (`docs/spec/design-tokens.md`의 "평면도 라벨").

### 색

컴포넌트와 렌더러에 hex를 쓰지 않는다. 캔버스는 CSS 변수를 읽을 수 없으므로 `features/floor-plan/components/use-plan-colors.ts`가 마운트할 때와 색 모드가 바뀔 때 `getComputedStyle(document.documentElement)`로 토큰을 읽어 렌더러에 넘긴다.

| 상태 | 채움 | 테두리 | 글자 |
| --- | --- | --- | --- |
| 비어 있음 | `--status-free` | `--status-free-border` | `--status-free-foreground` |
| 예약됨 | `--booked` | `--border` | `--foreground` |
| 내 예약 | `--status-mine-strong` | `--status-mine-strong` | `--primary-foreground` |
| 점검 중 | 빗금(아래) | `--status-maintenance-border` | `--status-maintenance-foreground` |
| 전용 공간(접근할 수 없음) | `--status-restricted` | `--status-restricted-border` | `--status-restricted-foreground` |
| 예약 없이 쓰는 곳(라운지, 좌석 없는 비예약 구역) | `--background` | `--border` | `--foreground` |
| 고정물 | `--secondary` | `--border` | `--muted-foreground` |
| 편집기의 검사 문제 | `--status-busy` | `--status-busy-strong` | `--status-busy-foreground` |

- 토큰 이름은 `docs/spec/design-tokens.md`와 `app/globals.css`를 따른다. 렌더러는 토큰 이름을 모르고, `use-plan-colors.ts`가 만든 색 객체(`{ free: { fill, stroke, text }, ... }`)만 받는다.
- 빗금은 135도, 8px 간격의 두 색으로 만든 `CanvasPattern`이다. 두 색은 지시서 33이 토큰 `--status-maintenance-hatch-a`(`#F1F0EC`), `--status-maintenance-hatch-b`(`#E6E5E1`)로 더하고, 지금의 `bg-status-maintenance-hatch` 유틸리티도 이 토큰을 쓰게 바꾼다.
- 오픈 데스크 구역(좌석이 있는 `desk_area`)은 바탕을 비우고 점선 테두리만 그린다.
- 이용률 지도(운영자)는 지시서 35가 토큰 `--heat-1`–`--heat-4`(`docs/spec/design-tokens.md`의 "이용률 4단계")로 더해 0–24, 25–49, 50–74, 75–100%에 쓴다. 75% 이상 칸의 글자는 `--primary-foreground`, 나머지는 `--status-mine-foreground`.

### 성능 (지시서 34, PFQV-21)

- `/dev/stress-render`(개발 모드에서만 열리는 페이지. 배포 빌드에서는 `notFound()`)가 공간 400개, 좌석 3,000개, 벽 200개의 합성 문서를 만들어 그린다. 문서는 시드 값으로 만드는 결정적 함수(`lib/floor-plan/render/stress-document.ts`)다.
- Playwright 테스트가 그 페이지에서 확대·이동을 5초 동안 되풀이하며 프레임 시간을 잰다 (`performance.now()`로 rAF 간격). 목표 p95 16ms 이하. CI의 기계 차이를 생각해 테스트는 p95 33ms를 넘으면 실패하고, 결과(p50, p95)를 출력해 둔다.
- 상태 하나가 바뀔 때 상태 층 전체를 다시 그리지 않는다는 것을 단위 테스트로 확인한다 (그리기 함수에 기록용 가짜 컨텍스트를 주입).

## 멤버의 평면도 보기 (지시서 33–34)

화면은 `docs/design/ui6-floor-plan.png`, `ui6-floor-desk.png`, `ui6-floor-mobile.png`.

### 보기와 주소

- 층 화면의 보기에 "평면도"를 더한다: `FloorView = 'plan' | 'list' | 'timeline'`. 순서는 평면도, 목록, 시간표다.
- 게시된 평면도가 없는 층은 "평면도" 탭을 보여주지 않는다. 주소나 쿠키가 `plan`이어도 목록으로 그린다.
- 기본 보기: 쿠키 `floor_view`가 있으면 그 값, 없으면 화면이 1024px 이상이고 평면도가 있으면 `plan`, 그 밖은 `list`. 서버는 화면 너비를 모르므로 쿠키가 없을 때는 지금처럼 클라이언트가 정한다(`use-wide-screen`).
- 평면도에서 공간을 고르면 목록과 같은 `space` 주소 값과 같은 오른쪽 상세(420px)·아래 시트를 쓴다. 다른 주소 값(`date`, `people`, `detail`)도 같다.

### 데이터

- `getFloorDay`의 결과에 `plan: { id: string; version: number } | null`을 더한다. 층 행을 읽는 문장에 `floor_plans`를 붙여 읽는다 (문장을 더하지 않는다).
- 문서는 Route Handler `GET /api/floor-plans/[planId]`가 준다 (AGENTS.md의 "캐시되는 GET(게시된 평면도 JSON)"). 세션이 있고, 그 평면도가 `published` 또는 `archived`이고, 그 층에 접근할 수 있어야 한다 (`canAccessFloor`). 아니면 404. 응답은 문서에서 `background`와 좌석의 `label`을 뺀 것이다. 헤더 `Cache-Control: private, max-age=31536000, immutable`. 게시된 문서는 바뀌지 않으므로 평면도 id가 곧 캐시 키다.
- 브라우저는 TanStack Query의 키 `['floor-plan', planId]`, `staleTime: Infinity`로 읽는다.
- 상태는 `getFloorDay`의 공간별 `intervals`와 `summary`에서 계산한다 (새 조회 없음). 접근할 수 없는 공간(`kind: 'restricted'`)은 이름 없이 "전용 공간"과 자물쇠로만 그린다.
- 좌석의 상태는 층 단위로 읽지 않는다. 좌석은 구역을 골랐을 때 `getSpaceDay`의 좌석 데이터로 칠한다 (아래 "좌석 고르기"). 구역을 고르기 전에는 좌석을 바탕색(테두리만)으로 그리고, 구역 라벨 아랫줄에 "빈 자리 17석" 같은 구간 요약(`deskParts`)을 쓴다.

### 시간 막대

- 평면도 위쪽에 "11:30 기준"과 막대를 둔다. 범위는 그날의 운영 시간, 30분 단위. 이전·다음 버튼과 "지금".
- 처음 값: 오늘이면 지금을 30분 단위로 내린 시각(운영 시간 전이면 여는 시각, 끝난 뒤면 마지막 칸), 다른 날이면 여는 시각. 쉬는 날은 막대 없이 "쉬는 날이에요".
- 막대의 값은 주소에 넣지 않는다 (클라이언트 상태). 날짜를 바꾸면 처음 값으로 돌아간다.
- 그 시각의 상태: 점검 > 내 예약 > 예약됨 > 비어 있음. 예약할 수 없는 공간(라운지)은 언제나 "예약 없이 쓰는 곳"이다.
- 라벨 아랫줄은 목록의 상태 줄(`space-status-line.ts`)과 같은 문장을 그 시각 기준으로 만든다: "6인 · 14:00까지 비어 있음", "8인 · 12:30까지 예약됨", "점검 중 · 내일 12:00까지".
- 요약 줄: "빈 공간 4 · 예약됨 3 · 점검 1" (그 시각, 접근할 수 있는 예약 가능 공간만).

### 다루기

- 마우스: 끌면 이동, 휠은 세로 이동이고 Ctrl/⌘+휠과 트랙패드 핀치는 확대. 오른쪽 아래에 +, −, 맞춤, 배율(%).
- 터치: 한 손가락 끌기는 이동, 두 손가락은 확대·이동 (Pointer Events로 직접 만든다. 제스처 라이브러리를 더하지 않는다). 탭은 고르기.
- hover(마우스만): 공간 위에 말풍선 "회의실 C · 8인 / 10:30–12:30 예약됨 · 디자인팀". 다른 사람 예약의 제목은 싣지 않는다 (목록과 같은 노출 규칙).
- 공간을 누르면 고른다: 파란 3px 테두리와 그림자, `space` 주소 값. 전용 공간은 고를 수 없고 말풍선만 "다른 팀 전용이에요".
- 처음 그릴 때와 층을 바꿀 때는 화면 맞춤. 공간을 고르면 그 공간이 화면 밖에 있을 때만 그쪽으로 옮긴다.

### 접근성 (PFQV-20)

- 캔버스는 `aria-hidden`이고, 같은 자리에 시각적으로 숨긴 목록(`sr-only`)을 둔다: 공간마다 버튼 하나. 이름은 "회의실 B, 6인, 11:30 기준 14:00까지 비어 있음". 전용 공간은 "전용 공간, 고를 수 없음"(비활성).
- 목록의 순서는 읽기 순서(라벨 위치의 y, 같은 줄이면 x. 같은 줄은 높이 2,000mm 안)다. Tab으로 평면도에 들어오면 마지막으로 포커스한 공간(없으면 첫 공간)에 포커스가 가고, 방향키는 그 방향으로 가장 가까운 공간(라벨 위치 기준, 방향 축의 거리 + 다른 축 거리의 2배가 가장 작은 것)으로 옮긴다. Enter·Space는 고르기, Esc는 고른 것 풀기.
- 포커스가 간 공간은 덧그림 층에 2px 포커스 고리를 그리고, 화면 밖이면 그쪽으로 옮긴다.
- 시간 막대는 `role="slider"`이고 값 문장은 "11시 30분".
- 범례는 글자로 같이 둔다 (색만으로 구분하지 않는다).

### 좌석 고르기 (지시서 34)

- 평면도가 있는 층에서 좌석이 있는 데스크 구역을 고르면, 그 구역으로 확대(구역이 화면의 80%)하고 좌석에 이름과 상태를 그린다. 좌석의 상태 다섯 가지와 판정은 `docs/spec/booking-2.md`의 "좌석 고르기"와 같다 (데이터도 같은 `getSpaceDay`).
- 오른쪽 상세(1024px 미만은 아래 시트)에는 지금의 좌석 고르기에서 좌석표(`SeatMap`)를 뺀 나머지가 나온다: 구간 고르기, 고른 좌석, "이 좌석의 오늘", 예약 줄. 좌석은 평면도에서 누르거나, 평면도에 포커스가 있을 때 방향키로 옮겨 고른다 (좌석 사이의 이동 규칙은 공간과 같다).
- 평면도가 없는 층, 또는 목록·시간표 보기에서는 지금의 좌석표를 그대로 쓴다.
- 구역에서 나가면(Esc, 다른 공간 고르기, 상세 닫기) 확대 전 카메라로 돌아간다.

### 모바일 (지시서 34)

- 1024px 미만에서도 "평면도" 탭이 있다. 기본 보기는 목록이다 (위 "기본 보기").
- 공간을 누르면 아래 시트가 올라온다: 이름, 상태 배지, 정원과 편의 시설, 그날의 띠, "시간 고르고 예약하기". 시트의 버튼은 지금 상세로 가는 주소(`detail=1`)다.
- 처음 평면도를 열면 "두 손가락으로 확대·이동" 안내를 한 번 보여준다 (닫으면 `localStorage`에 기억. 읽기·쓰기는 `try/catch`).

### 실시간 (지시서 34, PFQV-19)

- 층 화면은 그 층의 `floor:{floorId}`를 구독한다 (보기와 상관없이).
- `booking.changed`, `space.status_changed`를 받으면 300ms 동안 모았다가 층 데이터와 (열려 있으면) 공간 상세를 다시 읽는다. 다시 읽는 방법은 지금 그 데이터를 읽는 방법을 따른다 (서버 컴포넌트면 `router.refresh()`).
- `plan.published`를 받으면 새 평면도 id를 얻기 위해 층 데이터를 다시 읽는다. 고른 공간이 새 문서에 없으면 고른 것을 푼다.
- 다시 그린 공간은 200ms 동안 테두리를 한 번 밝혔다 돌아간다 (`prefers-reduced-motion`이면 하지 않는다).
- 실시간 토큰은 내가 접근할 수 있는 모든 층의 `floor:`에 `subscribe`만 준다 (`docs/spec/server.md`의 "실시간").
- 예약·운영자 액션의 층 이벤트 발행을 아무 일도 하지 않는 구현에서 `getRealtimePublisher()`로 바꾼다.

### 홈의 작은 평면도 (지시서 34)

- 홈의 "다음 예약" 카드에서, 그 예약의 층에 게시된 평면도가 있으면 오른쪽에 작은 평면도(가로 240px, 상호작용 없음)를 그리고 그 공간(좌석이면 구역과 좌석)을 내 예약 색으로 칠한다. 다른 공간은 바탕색만이다 (상태를 읽지 않는다).
- 1024px 미만에서는 그리지 않는다.

## 편집기 (지시서 38–40, PFQV-38–41)

화면은 `docs/design/ui6-editor.png`, `ui6-editor-seats.png`, `ui6-editor-publish.png`, `ui6-editor-walls.png`. 주소는 `/admin/branches/[branchId]/floors/[floorId]/plan`이고 `plan.edit`가 있어야 한다. 1024px 미만에서는 "평면도 편집은 1024px 이상 화면에서 할 수 있어요"만 보여준다.

### 틀

- 운영자 사이드바 없이 화면 전체를 쓴다: 위 막대(뒤로, "평면도 편집 · 강남점 7F", 상태 칩 "초안 · 버전 2 · 11:42 자동 저장됨", 실행 취소, 다시 실행, 검사 버튼, "멤버 화면 미리보기", "게시"), 왼쪽 도구 막대(60px), 가운데 캔버스, 오른쪽 속성 패널(320px).
- 도구와 단축키: 선택 V, 사각형 공간 R, 다각형 공간 P, 좌석 배열 S(지시서 39), 벽 W, 문 D, 축척 M(지시서 40). 도구 버튼의 이름은 "선택 (V)"처럼 단축키를 포함한다.
- 캔버스 아래 왼쪽에 "격자 100mm · 스냅 켜짐 · 층 크기 34,500 × 28,000 mm", 오른쪽 아래에 확대 버튼. 이동·확대는 멤버 보기와 같고, 스페이스바를 누른 채 끌어도 이동한다.
- "멤버 화면 미리보기"는 초안 문서를 멤버의 렌더러로 그린 창을 연다 (상태는 모두 "비어 있음").

### 상태와 실행 취소 (PFQV-40)

- 편집기 상태는 zustand 스토어 하나(`features/floor-plan/editor/store.ts`): 문서, 선택, 도구, 카메라, 실행 취소 스택, 저장 상태.
- 문서를 바꾸는 일은 모두 명령이다: `type Command = { label: string; apply(doc): doc; revert(doc): doc }`. 명령은 바뀐 도형의 앞뒤 값만 담는다 (문서 전체를 복사하지 않는다). 끌기 하나는 놓을 때 명령 하나가 된다 (끄는 동안은 미리보기만).
- 실행 취소 ⌘Z, 다시 실행 ⇧⌘Z. 스택은 100개. 저장한 뒤에도 스택은 남는다 (실행 취소도 저장된다).
- 문서는 바꾸지 않는 값(immutable)으로 다룬다. 명령의 `apply`·`revert`는 순수 함수이고 단위 테스트로 `revert(apply(doc)) = doc`를 확인한다.

### 저장

- 마지막 변경 1.5초 뒤, 그리고 탭을 떠날 때(`visibilitychange`) 자동 저장한다. 저장 중에 또 바뀌면 끝난 뒤 한 번 더 저장한다.
- 액션 `saveFloorPlanDraft({ floorId, revision, document })` (`plan.edit`): 스키마 검사(크기 상한 포함) → 층 행 잠금 → 초안이 없으면 만들고(위 "버전과 게시") 있으면 `revision`이 같은지 본다. 다르면 `STALE`. 같으면 문서를 바꾸고 `revision + 1`, `updated_at`, `updated_by`. 결과 `{ planId, version, revision, savedAt }`.
- 처음 열 때 초안이 없으면 `revision`은 `null`이고 첫 저장이 초안을 만든다. 첫 저장 전에 다른 운영자가 초안을 만들었으면 `STALE`이다.
- 상태 칩: "자동 저장됨 11:42", "저장 중", "저장하지 못했어요 · 다시 시도". `STALE`이면 "다른 곳에서 이 초안을 바꿨어요" 창에서 "새로 불러오기"(내 변경은 버린다)만 준다.
- 저장은 검사 결과와 상관없이 된다. 막는 것은 게시뿐이다.

### 공간 도형 (지시서 38)

- 사각형 도구: 끌어서 만든다. 다각형 도구: 눌러서 점을 찍고 Enter나 첫 점을 누르면 닫는다, Esc는 취소, Backspace는 마지막 점 지우기. 꼭짓점 3–64개.
- 새 도형은 "연결할 공간 고르기" 창을 바로 연다: 이 층에서 도형이 없는 공간 목록(좌석 제외), 그리고 "새 공간 만들기"(공간 관리의 공간 양식을 그대로 띄운다. 만들면 바로 DB 행이 생긴다). 고르지 않고 닫으면 도형을 만들지 않는다.
- 선택: 누르기, Shift+누르기로 더하기, 빈 곳에서 끌어 범위 선택. Esc는 풀기. 공간 도형과 좌석, 고정물, 벽을 고를 수 있다 (벽은 지시서 40).
- 이동: 끌기, 방향키 100mm, Shift+방향키 1,000mm. 여러 개를 같이 옮길 수 있다.
- 크기: 고른 도형 하나의 경계 상자에 손잡이 8개. 사각형(축에 맞는 꼭짓점 4개)은 그대로 늘리고, 다른 다각형은 경계 상자 비율로 늘린다. 끄는 동안 "8,000 × 5,000 mm" 칩을 보여준다.
- 지우기: Delete/Backspace. 복제: ⌘D (공간 도형은 같은 공간을 두 번 가리킬 수 없으므로 복제하지 않는다. 좌석과 고정물만).
- 격자 스냅 100mm (G로 켜고 끄기, Alt를 누른 동안 끄기). 좌표는 언제나 정수 mm다.
- 오른쪽 패널(공간 도형 하나를 골랐을 때): 연결된 공간(바꾸기), X·Y·너비·높이(사각형만, mm, 입력하고 Enter), 면적, 라벨 위치(가운데 / 왼쪽 위), "공간 정보"(이름·정원·편의 시설·이용 대상은 읽기만, "공간 관리에서 열기"). 여러 개를 골랐을 때는 개수와 지우기·정렬(왼쪽·가운데·오른쪽·위·가운데·아래)만.
- 고정물: 도구 막대의 사각형 도구로 만든 뒤 "연결할 공간" 창에서 "고정물로 두기(코어·계단·창고)"를 고른다.
- 층 크기(`bounds`)는 아무것도 고르지 않았을 때 오른쪽 패널에서 바꾼다. 도형이 범위 밖으로 나가는 크기로는 줄일 수 없다.

### 좌석 배열 (지시서 39)

- 좌석 배열 도구(S)는 데스크 구역 도형을 고른 상태에서 쓴다. 오른쪽 패널: 줄, 칸(1–30), 좌석 너비·깊이(400–3,000mm), 가로·세로 간격(0–5,000mm), 방향(0°, 90°, 180°, 270°), 이름(앞글자 0–6자 + 시작 번호 1–999, 두 자리 채움. 예: "A-" + 01 → A-01 … A-24).
- 패널을 바꾸는 동안 캔버스에 미리보기(점선)를 그린다. 구역의 왼쪽 위 안쪽 1,000mm에서 시작한다. 구역 밖으로 나가는 좌석이 있으면 "구역 밖으로 나가는 좌석이 3개 있어요"와 함께 "배열 적용"을 막는다.
- "배열 적용"은 명령 하나로 그 구역 안의 좌석을 모두 바꾼다. 이름이 같은 좌석은 `spaceId`를 이어받고(예약이 이어진다), 새 이름에는 새 uuid를 준다. 패널에 "지금 좌석 24개를 바꿔요. 이름이 같은 좌석은 그대로 이어지고, 새 좌석은 게시할 때 만들어져요."
- 좌석 하나를 골랐을 때 오른쪽 패널: 이름, 방향, 너비·깊이, "예약 n건이 남아 있어요"(게시본에 있는 좌석이고 앞으로의 확정 예약이 있을 때. 편집기를 열 때 한 번 읽는다).

### 벽, 문, 꼭짓점, 배경 (지시서 40)

- 벽 도구(W): 눌러서 점을 이어 그리고 Enter로 끝낸다. 첫 점을 누르면 닫힌 벽이 된다. 두께 기본 100mm(오른쪽 패널에서 50–500mm), 외벽은 200mm로 바꿔 쓴다.
- 문 도구(D): 벽 위를 누르면 그 자리에 문이 생긴다 (폭 기본 900mm, 종류 문/뚫린 곳). 문은 벽 위에서만 끌어 옮길 수 있다. 벽을 옮기거나 꼭짓점을 바꾸면 `at`(비율) 그대로 따라간다.
- 꼭짓점 편집: 다각형이나 벽을 더블클릭하면 꼭짓점 손잡이가 나온다. 끌어서 옮기고, 변 위를 더블클릭하면 꼭짓점을 더하고, 꼭짓점을 고르고 Delete로 지운다 (다각형 3개, 벽 2개 미만은 안 된다). Esc로 나온다.
- 스냅(PFQV-39): 격자, 다른 도형의 꼭짓점(화면 8px 안), 직각(Shift를 누르면 직전 점에서 0°·45°·90°). 스냅이 걸리면 그 점이나 선을 덧그림 층에 표시한다.
- 배경 도면: 오른쪽 패널(축척 도구 M)에서 이미지(PNG, JPG, WebP, 10MB 이하)를 올린다. 브라우저가 긴 변 4,096px 이하의 WebP로 바꿔 올린다 (900KB를 넘으면 품질을 낮춰 다시. 공간 사진과 같은 방식, `docs/spec/admin.md`의 "사진"). 저장소 키는 `plan-backgrounds/{planId}/{uuid}.webp`이고 `floor_plans.background_image`에 둔다. 액션 `uploadPlanBackground`는 초안에만 쓴다.
- 배경 보기: Route Handler `GET /api/plan-backgrounds/[planId]` (`plan.edit`가 있는 그 지점의 운영자만, `private, no-store`). 멤버에게는 내려보내지 않는다.
- 축척 맞추기: 배경 위의 두 점을 찍고 실제 거리(mm)를 넣으면 배경의 `transform`의 배율을 정한다. 그다음 배경을 끌어 옮기고(`transform`의 이동), 90°씩 돌리고, 투명도(0–100%)를 바꾸고, 잠근다. 잠긴 배경은 고를 수 없다.
- 배경 지우기는 문서의 `background`와 `background_image`를 같이 지운다 (저장소의 파일은 그 초안이 게시되거나 버려질 때 지우지 않는다. 지난 버전이 가리킬 수 있다).
