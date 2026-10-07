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
    { "id": "k07", "spaceId": "<spaces.id uuid>", "at": [3600,11200], "size": [1400,700], "rotation": 0 }
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
| `seats[]` | `id`, `spaceId`(uuid, type=desk 공간), `at`(중심점), `size`(`[w, h]`), `rotation`(도) | 수백 개라 다각형보다 가볍게 |
| `fixtures[]` | `id`, `kind`(`core`, `stairs`, `storage`), `polygon`, `label`(선택) | 예약 불가. 배경처럼 그린다 |
| `background` | `transform`(2D 변환 행렬 6개 값), `opacity`(0–1) | 선택. 편집용이고 멤버 화면에는 내려보내지 않는다. 이미지의 저장소 키는 문서가 아니라 `floor_plans.background_image` 컬럼에 둔다 |

- `schema`는 지금 `1`만 허용한다. `unit`은 `"mm"`만 허용한다.
- 도형의 `id`는 문서 안에서 유일한 짧은 문자열이다. DB의 id가 아니다.
- `spaces[].spaceId`와 `seats[].spaceId`만 DB(`spaces.id`)를 가리킨다. `fixtures[]`는 DB 행이 없다.
- `walls`, `openings`, `spaces`, `seats`, `fixtures`는 필수 배열이고 빈 배열을 허용한다. `background`만 생략할 수 있다.
- `spaces[].label`은 필수다. `fixtures[].label`은 선택이다.
- 정의하지 않은 키는 거부한다 (zod `strict`).
- `rotation`은 정수(도)다.

## 검증 규칙

### 스키마에서 바로 검사 (셋업 범위)

zod 스키마와 `superRefine`으로 검사한다. DB가 필요 없다.

- 좌표, 크기, 두께는 정수. `bounds.w`, `bounds.h`, `thickness`, `width`, `size`는 양수
- `polygon`은 꼭짓점 3개 이상, `walls[].points`는 2개 이상
- 모든 점은 `bounds` 안 (0 ≤ x ≤ w, 0 ≤ y ≤ h). 좌석은 중심점 `at`만 검사한다
- 도형 `id`는 문서 전체에서 중복 없음
- `openings[].wallId`는 문서 안의 벽 id
- 같은 `spaceId`를 가리키는 `spaces[]` 도형은 1개, `seats[]`도 1개
- `at`(openings)은 0 이상 1 이하, `opacity`는 0 이상 1 이하

### 게시할 때 검사 (이후 작업 PFQV-41)

하나라도 실패하면 게시할 수 없고, 편집기에서 해당 도형을 강조한다. 셋업에서는 구현하지 않고, 검사 결과 타입만 정해 둔다.

- 모든 도형의 `spaceId`가 존재하고 같은 층에 속함
- 예약 가능한 공간은 도형이 정확히 1개
- 다각형은 자기 교차 없음, 면적 0.5㎡ 이상
- 공간끼리 겹치지 않음 (좌석은 자기 구역 다각형 안에만)
- 라벨 위치는 공간 안
- 이용 대상이 "지정한 팀"이면 허용 팀이 1개 이상, 공간의 이용 대상은 층보다 넓지 않음

```ts
export type PlanIssue = { code: string; shapeId?: string; message: string };
```

## 버전과 게시

- 게시된 문서는 수정하지 않고 새 버전으로만 바꾼다. 그래서 클라이언트는 (층 id, 버전)을 키로 평면도를 영구 캐시할 수 있다.
- 게시 트랜잭션: 기존 게시본 → `archived`, 초안 → `published`, `floors.published_plan_id` 갱신을 한 번에 처리하고, 커밋 뒤 실시간 채널로 `plan.published` 이벤트를 보낸다.

## 예시 파일

- `docs/spec/examples/gangnam-7f.plan.json` — 가상 지점 "강남점 7층" 평면도. 회의실 4, 폰부스 2, 오픈 데스크 구역 1(좌석 24), 라운지, 세미나룸, 코어
- `docs/spec/examples/gangnam-7f.spaces.json` — 위 문서가 가리키는 `spaces` 행 (id, 유형, 이름, 정원, 부모, 접근 범위)

`plan.json`은 스키마 테스트의 통과 사례다. `spaces.json`은 평면도 문서가 아니라 교차 검사용 데이터다: plan의 모든 `spaceId`가 `spaces` 목록에 있고, 좌석이 가리키는 행은 `type = 'desk'`다. 지점, 팀, 허용 팀(`accessGrants`)도 들어 있어 `canAccess()` 테스트의 입력으로 쓸 수 있다.

실패 사례(범위 밖 좌표, 중복 id, 꼭짓점 2개짜리 다각형, 없는 `wallId`)는 테스트 안에서 `plan.json`을 조금씩 바꿔서 만든다.
