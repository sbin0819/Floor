# 데이터 모델

Neon Postgres 기준이다. 이 문서가 스키마의 기준이고, Drizzle 스키마(`lib/db/schema`)는 이 문서를 그대로 옮긴다.

## 공통 규칙

- 모든 `id`는 `uuid`이고 기본값은 `gen_random_uuid()`다.
- 시간은 `timestamptz`. 예약·점검 구간은 `tstzrange`이고 경계는 `[시작, 끝)`이다.
- 테이블과 컬럼은 snake_case, TypeScript 필드는 camelCase다.
- `created_at timestamptz not null default now()`는 모든 테이블에 둔다. 아래 표에서는 생략한다.
- 외래 키의 삭제 동작은 따로 적지 않으면 `restrict`다. Drizzle의 기본값은 `no action`이므로 모든 FK에 `onDelete: 'restrict'`를 명시한다.
- jsonb 컬럼은 Drizzle에서 `$type<>`로 타입을 붙인다: `document`는 `FloorPlanDocument`, `limits`는 `Partial<RoleLimits>`, 나머지는 `Record<string, unknown>`.
- 필요한 확장: `btree_gist` (예약 겹침 금지 제약과 `space_blocks`의 gist 인덱스에 쓴다. Neon에서 `CREATE EXTENSION btree_gist`로 켠다). 확장을 켜는 마이그레이션은 테이블을 만드는 마이그레이션보다 앞에 와야 한다.
- 제약 이름은 아래에 적힌 이름을 그대로 쓴다. 테스트와 오류 변환이 이름에 기댈 수 있다.

## 핵심 생각

공간의 정체(무엇인가)는 테이블에, 모양(어디에 어떻게 생겼나)은 층별 평면도 JSON에 나눠 저장한다. 평면도의 도형은 `spaceId`로 `spaces` 행을 가리키기만 한다. 예약은 도형이 아니라 공간 id에 붙으므로 도면이 바뀌어도 예약은 깨지지 않는다.

"사용 중", "점검 중" 같은 실시간 상태는 평면도에 저장하지 않고 `bookings`, `space_blocks`에서 계산한다.

## enum

| 이름 | 값 |
| --- | --- |
| `access_scope` | `everyone`, `teams`, `closed` |
| `space_type` | `meeting_room`, `phone_booth`, `seminar`, `desk_area`, `desk`, `lounge` |
| `plan_status` | `draft`, `published`, `archived` |
| `booking_status` | `confirmed`, `cancelled` |
| `chat_room_kind` | `booking`, `channel`, `inquiry`, `team` |
| `message_kind` | `text`, `system` |
| `team_role` | `admin`, `member` |
| `app_role` | `user`, `team_member`, `team_admin`, `operator` |
| `grant_target` | `floor`, `space` |
| `join_request_status` | `pending`, `approved`, `rejected`, `cancelled` |

## 테이블

### users

사용자다. Better Auth의 user 모델을 이 테이블에 매핑한다 (`docs/spec/auth.md`). 인증용 테이블을 따로 두지 않으므로 다른 테이블의 `user_id`가 곧 로그인한 사용자다.

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| email | text | not null, unique. 소문자로 저장 |
| email_verified | boolean | not null, 기본값 false |
| name | text | not null |
| avatar_url | text | null 허용. Better Auth의 `image`에 해당 |
| updated_at | timestamptz | not null, 기본값 now() |
| default_branch_id | uuid | null 허용, FK → branches, on delete set null. 주로 쓰는 지점. "기본 지점으로 설정"을 누를 때 바뀌고, 비어 있는 채로 처음 예약에 성공하면 그 지점으로 채워진다 (`docs/spec/booking.md`) |

- 셋업 때 있던 `auth_id` 컬럼은 없앤다.
- `default_branch_id`는 Better Auth가 쓰지 않는 컬럼이다. Better Auth의 필드로 등록하지 않고 `lib/dal`로만 읽고 쓴다.

### auth_sessions, auth_accounts, auth_verifications (인증)

Better Auth의 session, account, verification 모델이다. 컬럼 구성은 설치한 Better Auth 버전이 요구하는 것을 그대로 따르고, 이름만 이 문서의 규칙(snake_case, uuid id, `timestamptz`)에 맞춘다.

| 테이블 | 내용 | 꼭 지킬 것 |
| --- | --- | --- |
| auth_sessions | 로그인 세션. `user_id`, `token`, `expires_at`, 접속 정보 | `user_id` FK → users, on delete cascade. `token` unique |
| auth_accounts | 로그인 수단. 제공자(`provider_id`)와 그쪽 계정 id(`account_id`), 비밀번호 해시 | `user_id` FK → users, on delete cascade. `unique (provider_id, account_id)` |
| auth_verifications | 이메일 인증과 비밀번호 재설정 토큰 | `expires_at` not null |

- 비밀번호는 Better Auth가 만든 해시만 저장한다. 평문을 저장하거나 로그에 남기지 않는다.
- 이 세 테이블은 Better Auth만 읽고 쓴다. 앱 코드는 직접 쿼리하지 않는다. 운영자 계정 스크립트도 인증 인스턴스를 통해서만 쓴다.
- Drizzle 속성 이름은 Better Auth의 필드 이름(camelCase)과 같게 둔다. 어댑터의 필드 매핑은 DB 컬럼 이름이 아니라 Drizzle 속성 이름을 쓴다.

### branches (지점)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| name | text | not null |
| address | text | null 허용 |
| timezone | text | not null, 기본값 `'Asia/Seoul'` |
| open_hours | jsonb | not null, 기본값 `'{}'`. 요일별 운영 시간. 모양과 기본값은 `docs/spec/booking.md`의 "운영 시간". Drizzle 타입은 `OpenHours` |

### floors (층)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| branch_id | uuid | not null, FK → branches |
| level | integer | not null (예: 7) |
| name | text | not null (예: "7F") |
| sort_order | integer | not null, 기본값 0 |
| published_plan_id | uuid | null 허용, FK → floor_plans |
| access | access_scope | not null, 기본값 `everyone` |

- `unique (branch_id, level)`
- `floors.published_plan_id`와 `floor_plans.floor_id`는 서로를 가리킨다. 순환 참조이므로 FK 하나는 테이블 생성 뒤에 추가한다.

### spaces (공간)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| floor_id | uuid | not null, FK → floors |
| parent_id | uuid | null 허용, FK → spaces |
| type | space_type | not null |
| name | text | not null |
| capacity | integer | null 허용 |
| bookable | boolean | not null, 기본값 true |
| amenities | text[] | not null, 기본값 `'{}'` |
| booking_rules | jsonb | not null, 기본값 `'{}'` |
| access | access_scope | null 허용. null이면 층 설정을 따른다 |
| archived_at | timestamptz | null 허용. 값이 있으면 보관된 공간이다. 멤버 화면과 예약에서 빠진다 |

- 좌석은 따로 테이블을 두지 않는다. `type = 'desk'`이고 `parent_id`가 `desk_area` 공간을 가리키는 행이 좌석이다.
- 코어, 계단, 창고 같은 고정물은 평면도 JSON의 `fixtures[]`에만 있고 `spaces` 행을 만들지 않는다.
- 좌석 행이 있는 `desk_area`는 `bookable = false`로 둔다. 구역과 그 안의 좌석을 같은 시간에 따로 예약하는 일을 겹침 제약이 막지 못하기 때문이다. 좌석 행 없이 구역 단위로만 운영하는 `desk_area`는 `bookable = true`가 될 수 있다.
- 공간의 접근 범위는 층보다 넓을 수 없다. 이 규칙은 DB가 아니라 저장할 때 서버에서 검사한다 (`docs/spec/roles-and-access.md`).
- 같은 층의 보관되지 않은 공간은 이름이 유일하다 (대소문자 무시): `unique (floor_id, lower(name)) where archived_at is null` (이름 `spaces_floor_name_unique`)
- `amenities`에는 `docs/spec/booking.md`의 여섯 개 키만 넣는다. DB가 아니라 저장할 때 서버에서 검사한다.
- 인덱스: `(floor_id)`, `(parent_id)`

### floor_plans (평면도 버전)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| floor_id | uuid | not null, FK → floors |
| version | integer | not null |
| status | plan_status | not null, 기본값 `draft` |
| document | jsonb | not null (형식은 `docs/spec/floor-plan.md`) |
| background_image | text | null 허용. 편집용 배경 도면의 저장소 키. 평면도 JSON에는 키를 넣지 않는다 |
| created_by | uuid | not null, FK → users |
| published_at | timestamptz | null 허용 |

- `unique (floor_id, version)`
- 층마다 draft는 최대 1개: `unique (floor_id) where status = 'draft'` (부분 유니크 인덱스, 이름 `floor_plans_one_draft`)
- 층마다 published도 최대 1개: `unique (floor_id) where status = 'published'` (이름 `floor_plans_one_published`)
- 게시된 문서는 수정하지 않는다. 바꾸려면 새 버전을 만든다.

### bookings (예약)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| space_id | uuid | not null, FK → spaces |
| user_id | uuid | not null, FK → users (예약한 사람) |
| team_id | uuid | null 허용, FK → teams. 값이 있으면 "팀 이름으로" 한 예약 |
| during | tstzrange | not null |
| title | text | null 허용 |
| status | booking_status | not null, 기본값 `confirmed` |
| cancelled_at | timestamptz | null 허용. 취소한 시각 |
| cancelled_by | uuid | null 허용, FK → users. 취소한 사람. 본인일 수도, 팀 관리자나 운영자일 수도 있다 |

- 겹침 금지 (이름 `bookings_no_overlap`): `EXCLUDE USING gist (space_id WITH =, during WITH &&) WHERE (status = 'confirmed')`
- 구간 검사 (이름 `bookings_during_valid`): `CHECK (NOT isempty(during) AND NOT lower_inf(during) AND NOT upper_inf(during) AND lower_inc(during) AND NOT upper_inc(during))`. 경계가 `[)`가 아니면 맞닿은 예약이 겹침으로 잡히므로 DB에서 강제한다.
- 취소 기록 (이름 `bookings_cancel_consistent`): `CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))`. 취소된 예약에는 취소 시각이 있고, 확정 예약에는 없다.
- 예약은 지우지 않는다. 취소하면 상태만 바꾼다. (시드 스크립트가 자기 id의 예약을 다시 넣는 것만 예외다.)
- 인덱스: `(user_id)`, `(team_id)`
- 겹치는 예약을 넣으면 Postgres가 SQLSTATE `23P01`을 낸다. 액션 래퍼가 이것을 `BOOKING_CONFLICT`로 바꾼다.

### space_blocks (점검)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| space_id | uuid | not null, FK → spaces |
| during | tstzrange | not null |
| reason | text | null 허용 |
| created_by | uuid | not null, FK → users |

- 인덱스: `gist (space_id, during)`
- `bookings`와 같은 구간 검사를 둔다 (이름 `space_blocks_during_valid`). 끝이 없는 점검은 지원하지 않는다.
- 예약 액션은 겹치는 점검이 있으면 `SPACE_BLOCKED`로 거절한다.

### chat_rooms (채팅방)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| kind | chat_room_kind | not null |
| booking_id | uuid | null 허용, FK → bookings, unique |
| floor_id | uuid | null 허용, FK → floors |
| team_id | uuid | null 허용, FK → teams |

- `CHECK` (이름 `chat_rooms_kind_ref`): `(kind <> 'booking' OR booking_id IS NOT NULL) AND (kind <> 'channel' OR floor_id IS NOT NULL) AND (kind <> 'team' OR team_id IS NOT NULL)`. `channel`은 라운지 채널, `team`은 팀 채널이다. 다른 참조 컬럼이 비어 있어야 한다는 제한은 두지 않는다.
- `inquiry`(운영자 문의) 방이 어떤 컬럼으로 지점과 문의자를 가리킬지는 채팅 작업(PFQV-4)에서 정한다. 지금은 제약을 두지 않는다.

### messages (메시지)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| room_id | uuid | not null, FK → chat_rooms, on delete cascade |
| seq | bigint | not null. 방별로 1씩 증가. Drizzle에서는 `bigint({ mode: 'number' })`. 기본값 없이 넣을 때 지정하고, 번호를 매기는 방식은 채팅 작업(PFQV-4)에서 정한다 |
| author_id | uuid | null 허용, FK → users. 시스템 메시지는 null |
| kind | message_kind | not null, 기본값 `text` |
| body | text | not null |
| space_ref | uuid | null 허용, FK → spaces (공간 태그) |
| client_id | text | null 허용. 재전송 중복 방지용 |

- `unique (room_id, seq)` — 재연결 뒤 빠진 메시지를 `seq`로 찾는다.
- `unique (room_id, client_id) where client_id is not null`

### call_sessions (통화)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| room_id | uuid | not null, FK → chat_rooms |
| livekit_room | text | not null |
| started_at | timestamptz | not null, 기본값 now() |
| ended_at | timestamptz | null 허용 |

- 방당 진행 중인 통화는 1개: `unique (room_id) where ended_at is null` (이름 `call_sessions_one_active`)

### teams (팀)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| name | text | not null. 2–40자. 정규화(NFC, 앞뒤 공백 제거, 연속 공백 하나로)한 값을 저장 |
| created_by | uuid | not null, FK → users. 만든 사람이 첫 팀 관리자 |
| home_branch_id | uuid | null 허용, FK → branches. 주 이용 지점. 참고 정보이고 권한 판정에는 쓰지 않는다 |
| headcount | integer | null 허용. 인원 규모 |
| contact_phone | text | null 허용. 담당자 연락처. 숫자와 맨 앞의 `+`만 저장. 팀 관리자에게만 내려보낸다 (`docs/spec/auth.md`) |

- 이름은 대소문자를 무시하고 유일하다: `unique (lower(name))` (이름 `teams_name_unique`)
- `CHECK (headcount is null or headcount between 1 and 1000)` (이름 `teams_headcount_valid`)
- 셋업 뒤에 추가된 세 컬럼은 null을 허용한다. 필수 여부는 팀 만들기 양식에서 검사한다 (`docs/spec/auth.md`).

### team_members (팀 소속)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| team_id | uuid | not null, FK → teams, on delete cascade |
| user_id | uuid | not null, FK → users |
| role | team_role | not null, 기본값 `member` |
| title | text | null 허용. 그 팀에서의 직함 |

- PK `(team_id, user_id)` (이름 `team_members_team_id_user_id_pk`). 한 사람이 여러 팀에 속할 수 있고, 팀이 없어도 된다.
- 인덱스: `(user_id)`

### team_invites (초대)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| team_id | uuid | not null, FK → teams, on delete cascade |
| email | text | null 허용. 소문자로 저장. 이메일 초대는 값이 있고, 공유 링크 초대(이후 작업)는 null |
| token | text | not null, unique. 추측할 수 없는 무작위 값 |
| message | text | null 허용. 초대 메시지, 200자 이하 |
| expires_at | timestamptz | not null (기본 7일 뒤) |
| accepted_at | timestamptz | null 허용 |
| declined_at | timestamptz | null 허용 |
| revoked_at | timestamptz | null 허용. 팀 관리자가 취소한 시각 |
| created_by | uuid | not null, FK → users |

- `accepted_at`, `declined_at`, `revoked_at`이 모두 null이면 대기 중이다. 대기 중이어도 `expires_at`이 지났으면 쓸 수 없다.
- 같은 팀이 같은 이메일에 보낸 대기 중 초대는 하나: `unique (team_id, email) where email is not null and accepted_at is null and declined_at is null and revoked_at is null` (이름 `team_invites_one_pending`)
- 만료된 초대가 대기 중으로 남아 있을 수 있으므로, 다시 초대할 때는 이전 초대를 취소하고 새로 만드는 일을 한 트랜잭션으로 한다.
- 인덱스: `(email)`

### team_join_requests (가입 요청)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| team_id | uuid | not null, FK → teams, on delete cascade |
| user_id | uuid | not null, FK → users. 요청한 사람 |
| message | text | null 허용. 200자 이하 |
| status | join_request_status | not null, 기본값 `pending` |
| decided_by | uuid | null 허용, FK → users. 승인·거절한 팀 관리자. 초대 수락으로 승인 처리된 요청은 초대를 보낸 사람 |
| decided_at | timestamptz | null 허용 |

- 팀과 사람마다 대기 중 요청은 하나: `unique (team_id, user_id) where status = 'pending'` (이름 `team_join_requests_one_pending`)
- 인덱스: `(user_id)`

### branch_staff (운영자)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| branch_id | uuid | not null, FK → branches, on delete cascade |
| user_id | uuid | not null, FK → users |

- PK `(branch_id, user_id)`. 이 표에 있으면 그 지점의 운영자다.

### role_settings (역할 설정)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| branch_id | uuid | not null, FK → branches, on delete cascade |
| role | app_role | not null |
| permissions | text[] | not null |
| limits | jsonb | not null, 기본값 `'{}'`. 키가 없으면 코드 기본값, 값이 null이면 제한 없음 |
| updated_at | timestamptz | not null, 기본값 now() |

- PK `(branch_id, role)`. 행이 없으면 코드의 기본값을 쓴다 (`docs/spec/roles-and-access.md`).

### access_grants (허용 팀)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| target_type | grant_target | not null |
| target_id | uuid | not null (floors.id 또는 spaces.id) |
| team_id | uuid | not null, FK → teams, on delete cascade |

- `unique (target_type, target_id, team_id)`
- `target_id`는 두 테이블 중 하나를 가리키므로 FK를 걸지 않는다. 층·공간을 지울 때 서버가 같이 지운다.
- 층·공간의 `access`가 `teams`일 때만 의미가 있다.

## 테스트로 확인할 제약

`tests/db`에서 마이그레이션을 적용한 DB(PGlite)에 직접 넣어 보고 확인한다. 항목은 17개이고, 한 항목에 경우가 여럿이면 경우마다 따로 단언한다. 1–10은 셋업에서, 11–14는 가입·팀 전환 작업에서, 15–16은 예약 작업에서, 17은 운영자 공간 관리 작업에서 만든다.

1. 같은 공간에 시간이 겹치는 `confirmed` 예약 두 개는 들어가지 않는다 (`23P01`).
2. 끝과 시작이 맞닿은 예약(10:00–11:00, 11:00–12:00)은 들어간다.
3. `cancelled` 예약은 같은 시간의 새 예약을 막지 않는다.
4. 다른 공간의 같은 시간 예약은 들어간다.
5. `during`이 비어 있는 경우, 시작이 무한인 경우, 끝이 무한인 경우, 경계가 `[)`가 아닌 경우(`[]`)는 각각 들어가지 않는다.
6. 한 층에 draft 두 개는 들어가지 않는다. published 두 개도 들어가지 않는다.
7. `(branch_id, level)`이 같은 층 두 개는 들어가지 않는다.
8. 한 방에 끝나지 않은 통화 두 개는 들어가지 않는다.
9. 한 방에 `seq`가 같은 메시지 두 개는 들어가지 않는다. `client_id`가 같은 메시지 두 개도 들어가지 않는다.
10. `kind`에 맞는 참조가 없는 채팅방은 들어가지 않는다.
11. 대소문자만 다른 같은 이름의 팀 두 개는 들어가지 않는다.
12. `headcount`가 0이거나 1000을 넘는 팀은 들어가지 않는다.
13. 같은 팀이 같은 이메일에 보낸 대기 중 초대 두 개는 들어가지 않는다. 앞의 초대가 취소·거절·수락된 뒤에는 들어간다.
14. 같은 팀에 같은 사람의 대기 중 가입 요청 두 개는 들어가지 않는다. 앞의 요청이 거절·취소된 뒤에는 들어간다.
15. `cancelled`인데 `cancelled_at`이 없는 예약, `confirmed`인데 `cancelled_at`이 있는 예약은 들어가지 않는다.
16. 지점을 지우면 그 지점을 기본 지점으로 둔 사용자의 `default_branch_id`가 null이 된다.
17. 같은 층에 대소문자만 다른 같은 이름의 공간 두 개는 들어가지 않는다. 앞의 공간이 보관된 뒤에는 들어간다. 다른 층에는 들어간다.
