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
| `booking_cancel_kind` | `operator`, `maintenance` (지시서 35. 운영자가 예약 현황에서, 또는 점검 등록으로 취소한 예약. 본인·팀 관리자의 취소는 null이고 `cancelled_by`로 가린다) |
| `report_resolution` | `dismissed`, `message_deleted`, `member_banned` (지시서 42) |
| `chat_space_kind` | `team`, `branch`, `community` (지시서 20) |
| `chat_room_kind` | `text`, `voice`, `dm`, `group_dm`, `meeting` (지시서 20에서 바꿈. 전에는 `booking`, `channel`, `inquiry`, `team`) |
| `reaction_emoji` | `thumbs_up`, `heart`, `joy`, `tada`, `open_mouth`, `cry`, `pray`, `check` (지시서 22) |
| `friendship_status` | `pending`, `accepted`, `declined`, `cancelled` (지시서 23) |
| `chat_member_status` | `active`, `requested`, `declined`, `left` (지시서 23. `requested`, `declined`, `left`는 지시서 24부터 쓴다) |
| `user_status` | `online`, `away`, `dnd` (지시서 24. 내가 고른 상태. 오프라인은 저장하지 않는다) |
| `report_reason` | `spam`, `harassment`, `inappropriate`, `other` (지시서 24) |
| `space_icon_color` | `blue`, `green`, `orange`, `purple`, `pink`, `teal`, `yellow`, `gray` (지시서 26) |
| `chat_space_role` | `owner`, `admin`, `member` (지시서 26) |
| `chat_space_member_status` | `active`, `banned` (지시서 26) |
| `call_kind` | `voice`, `huddle` (지시서 27) |
| `attachment_kind` | `image`, `file` (지시서 28) |
| `avatar_color` | `blue`, `green`, `orange`, `purple`, `pink`, `teal`, `yellow`, `gray` (지시서 30. 사람 아바타의 색. `space_icon_color`와 값은 같지만 따로 둔다) |
| `message_kind` | `text`, `system` |
| `team_role` | `admin`, `member` |
| `app_role` | `user`, `team_member`, `team_admin`, `operator` |
| `grant_target` | `floor`, `space` |
| `join_request_status` | `pending`, `approved`, `rejected`, `cancelled` |
| `notification_type` | `booking_invited`, `booking_changed`, `booking_cancelled`, `booking_removed`, `participant_left`, `booking_reminder`, `friend_request`, `friend_accepted` (지시서 23), `message_request` (지시서 24), `space_invite` (지시서 26), `team_removed`, `team_role_changed`, `team_deleted` (지시서 31), `branch_announcement` (지시서 41) |

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
| username | text | null 허용, 유일 (`users_username_unique`). `CHECK` (`users_username_format`): `username ~ '^[a-z0-9._]{3,20}$'`. 사람을 찾는 이름 (지시서 23, `docs/spec/chat.md` "사용자 이름"). 소문자로만 저장한다 |
| username_changed_at | timestamptz | null 허용. 사용자 이름을 마지막으로 바꾼 시각. 처음 정할 때는 남기지 않는다 (지시서 23) |
| status | user_status | not null, 기본값 `online`. 내가 고른 상태 (지시서 24). 남에게 보이는 상태는 Ably presence에서 온다 |
| avatar_color | avatar_color | null 허용. 고른 아바타 색. null이면 사용자 id로 정한 색 (지시서 30, `docs/spec/settings.md`) |
| avatar_photo | boolean | not null, 기본값 false. 켜져 있고 `avatar_url`이 허용 주소면 그 사진을 아바타로 (지시서 30) |
| chat_toasts | boolean | not null, 기본값 true. 채팅 토스트 (지시서 30) |
| tab_badge | boolean | not null, 기본값 true. 탭 제목의 안 읽은 수 (지시서 30) |
| reminder_minutes | smallint[] | not null, 기본값 `{30,10,5,0}`. 보이게 할 미리 알림의 분. `CHECK` (`users_reminder_minutes_valid`): `reminder_minutes <@ '{30,10,5,0}'::smallint[]` (지시서 30) |
| home_checklist_dismissed_at | timestamptz | null 허용. 홈의 "Floor 시작하기"를 닫은 시각 (지시서 32) |

- 셋업 때 있던 `auth_id` 컬럼은 없앤다.
- `default_branch_id`, `username`, `username_changed_at`, `status`, 그리고 지시서 30·32가 더하는 컬럼은 Better Auth가 쓰지 않는 컬럼이다. Better Auth의 필드로 등록하지 않고 `lib/dal`로만 읽고 쓴다.

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
| cover_photo_path | text | null 허용. 지점의 대표 사진. 사이트 안의 경로 (`docs/spec/ui-2.md`의 "사진") |
| cover_photo_alt | text | null 허용. 대표 사진의 대체 글 |

- 대표 사진의 경로와 대체 글은 둘 다 있거나 둘 다 없다: check `(cover_photo_path is null) = (cover_photo_alt is null)` (이름 `branches_cover_photo_pair`)
- 경로의 형식: check `cover_photo_path is null or (cover_photo_path ~ '^/[a-z0-9/_-]+\.(webp|png|jpg)$' and cover_photo_path !~ '//')` (이름 `branches_cover_photo_path_format`)
- 대체 글의 길이: check `cover_photo_alt is null or char_length(cover_photo_alt) between 1 and 120` (이름 `branches_cover_photo_alt_length`)

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

### space_photos (공간 사진)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| space_id | uuid | not null, FK → spaces, on delete cascade |
| path | text | not null. 사이트 안의 경로. 예: `/seed/photos/meeting-small-sage.webp` |
| alt | text | not null. 대체 글 |
| sort_order | integer | not null. 0부터. 0이 대표 사진이다 |

- 한 공간에서 순서는 겹치지 않는다: `unique (space_id, sort_order)` (이름 `space_photos_space_order_unique`). 지시서 43부터 `DEFERRABLE INITIALLY IMMEDIATE`다 (순서를 한 문장으로 바꿀 때 문장 끝에서 검사하도록)
- 순서의 범위: check `sort_order between 0 and 9` (이름 `space_photos_sort_order_range`). 공간 하나에 10장까지다
- 경로의 형식: check `path ~ '^/[a-z0-9/_-]+\.(webp|png|jpg)$' and path !~ '//'` (이름 `space_photos_path_format`). 바깥 주소와 `..`가 들어갈 수 없다 (`.`은 확장자 앞에만 올 수 있다)
- 대체 글의 길이: check `char_length(alt) between 1 and 120` (이름 `space_photos_alt_length`)
- 사진의 크기는 저장하지 않는다. 화면이 가로세로 비율을 정하고 사진을 그 안에 채운다.
- 같은 파일을 여러 공간이 가리킬 수 있다.
- 운영자가 올린 사진(지시서 43)의 경로는 `/api/space-photos/{photoId}.webp`이고 파일은 저장소 키 `space-photos/{photoId}.webp`에 있다. 화면의 상한은 공간마다 8장이다 (DB는 10장).
- 누구에게 보이는지는 `docs/spec/ui-2.md`의 "사진"이 정한다. 공간의 이름을 볼 수 없는 사람에게는 사진도 내려보내지 않는다.
- 인덱스: `(space_id, sort_order)`는 위의 unique가 겸한다

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
| revision | integer | not null, 기본값 0. 초안을 저장할 때마다 1씩 올린다. 편집기의 낙관적 동시성 (지시서 38) |
| updated_at | timestamptz | null 허용. 초안을 마지막으로 저장한 시각 (지시서 38) |
| updated_by | uuid | null 허용, FK → users. 마지막으로 저장한 사람 (지시서 38) |

- `unique (floor_id, version)`
- 층마다 draft는 최대 1개: `unique (floor_id) where status = 'draft'` (부분 유니크 인덱스, 이름 `floor_plans_one_draft`)
- 층마다 published도 최대 1개: `unique (floor_id) where status = 'published'` (이름 `floor_plans_one_published`)
- 게시된 문서는 수정하지 않는다. 바꾸려면 새 버전을 만든다.
- `CHECK (revision >= 0)` (이름 `floor_plans_revision_nonnegative`, 지시서 38).
- 저장·게시의 규칙은 `docs/spec/floor-plan.md`의 "버전과 게시", "편집기".

### bookings (예약)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| space_id | uuid | not null, FK → spaces |
| user_id | uuid | not null, FK → users (예약한 사람) |
| team_id | uuid | null 허용, FK → teams. 값이 있으면 "팀 이름으로" 한 예약 |
| during | tstzrange | not null |
| title | text | null 허용 |
| attendee_count | integer | null 허용. 사용 인원. 좌석 예약은 언제나 null (`docs/spec/booking-2.md`) |
| status | booking_status | not null, 기본값 `confirmed` |
| cancelled_at | timestamptz | null 허용. 취소한 시각 |
| cancelled_by | uuid | null 허용, FK → users. 취소한 사람. 본인일 수도, 팀 관리자나 운영자일 수도 있다 |
| updated_at | timestamptz | null 허용. 예약을 바꾼 시각. 바꾼 적이 없으면 null |
| cancel_kind | booking_cancel_kind | null 허용. 운영자 취소(`operator`)와 점검 취소(`maintenance`)만 값이 있다 (지시서 35) |
| cancel_reason | text | null 허용. 운영자·점검 취소의 이유. 1–200자 (지시서 35) |

- 겹침 금지 (이름 `bookings_no_overlap`): `EXCLUDE USING gist (space_id WITH =, during WITH &&) WHERE (status = 'confirmed')`
- 구간 검사 (이름 `bookings_during_valid`): `CHECK (NOT isempty(during) AND NOT lower_inf(during) AND NOT upper_inf(during) AND lower_inc(during) AND NOT upper_inc(during))`. 경계가 `[)`가 아니면 맞닿은 예약이 겹침으로 잡히므로 DB에서 강제한다.
- 취소 기록 (이름 `bookings_cancel_consistent`): `CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))`. 취소된 예약에는 취소 시각이 있고, 확정 예약에는 없다.
- 취소의 종류와 이유 (이름 `bookings_cancel_kind_consistent`, 지시서 35): `CHECK ((cancel_kind IS NULL OR status = 'cancelled') AND ((cancel_kind IS NULL) = (cancel_reason IS NULL)))`. 이유의 길이 (이름 `bookings_cancel_reason_length`): `CHECK (cancel_reason IS NULL OR char_length(cancel_reason) BETWEEN 1 AND 200)`.
- 사용 인원 (이름 `bookings_attendee_count_range`): `CHECK (attendee_count IS NULL OR attendee_count BETWEEN 1 AND 500)`. 정원을 넘는지는 DB가 아니라 예약할 때 서버가 본다.
- 좌석 예약은 `space_id`가 좌석 행(`type = 'desk'`)인 예약이다. 오전·오후·종일 구간은 따로 저장하지 않고 `during`으로 판정한다 (`docs/spec/booking-2.md`).
- 예약은 지우지 않는다. 취소하면 상태만 바꾼다. (시드 스크립트가 자기 id의 예약을 다시 넣는 것만 예외다.)
- 인덱스: `(user_id)`, `(team_id)`
- 겹치는 예약을 넣으면 Postgres가 SQLSTATE `23P01`을 낸다. 액션 래퍼가 이것을 `BOOKING_CONFLICT`로 바꾼다.

### booking_participants (예약의 참석자)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| booking_id | uuid | not null, FK → bookings, on delete cascade |
| user_id | uuid | not null, FK → users. 초대받은 사람. 예약한 사람은 넣지 않는다 |
| created_at | timestamptz | not null, 기본값 now(). 참석자로 들어온 시각. 액션은 주입한 지금 시각으로 넣는다 (지시서 25에서 더함. 그 전에는 이 테이블에만 `created_at`이 없었다) |

- PK는 `(booking_id, user_id)`다 (`id` 컬럼이 없다).
- 인덱스: `(user_id)`
- 한 예약에 20명까지, "예약한 사람 + 참석자"가 정원 이하라는 규칙은 DB가 아니라 서버가 본다 (`docs/spec/booking-2.md`).
- 참석자가 스스로 빠지거나 예약한 사람이 빼면 행을 지운다. 예약이 취소돼도 행은 남긴다.

### notifications (알림)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| user_id | uuid | not null, FK → users. 받는 사람 |
| type | notification_type | not null |
| booking_id | uuid | null 허용, FK → bookings, on delete cascade |
| actor_id | uuid | null 허용, FK → users. 그 일을 한 사람. 미리 알림은 null |
| data | jsonb | not null. 알림을 그릴 때 쓰는 그때의 값 (`docs/spec/booking-2.md`의 "알림") |
| scheduled_for | timestamptz | not null. 보이기 시작하는 시각. 바로 보이는 알림은 넣는 시각 |
| expires_at | timestamptz | null 허용. 이 시각이 지나면 목록과 읽지 않은 수에서 빠진다. 미리 알림은 예약의 끝 시각, 다른 알림은 null |
| read_at | timestamptz | null 허용. 읽은 시각 |

- 인덱스: `(user_id, scheduled_for desc)`, 읽지 않은 것만의 부분 인덱스 `(user_id) where read_at is null`, `(booking_id)` (취소·시간 변경·참석 안 함에서 그 예약의 미리 알림을 지울 때 쓴다)
- 같은 사람, 같은 예약, 같은 시각의 미리 알림은 하나뿐이다: `unique (user_id, booking_id, scheduled_for) where type = 'booking_reminder'` (이름 `notifications_reminder_unique`)
- 알림을 읽는 조회는 `scheduled_for <= 지금`이고 (`expires_at`이 null이거나 `expires_at > 지금`)인 것만 돌려준다. 미리 알림은 예약이 정해질 때 앞으로의 시각으로 미리 넣어 둔다.
- `data`의 타입은 `NotificationData`다 (jsonb에 `$type<>`). 이메일과 사용자 id를 넣지 않는다.

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
- 같은 공간의 점검끼리는 겹치지 않는다 (이름 `space_blocks_no_overlap`, 지시서 36): `EXCLUDE USING gist (space_id WITH =, during WITH &&)`. 넣을 때 `23P01`이면 액션이 `INVALID_INPUT`(필드 `start`)으로 바꾼다.
- 등록·고치기·해제·지우기는 `docs/spec/admin.md`의 "점검".

### chat_spaces (스페이스, 지시서 20)

디스코드의 서버, 슬랙의 워크스페이스에 해당한다. 뜻과 규칙은 `docs/spec/chat.md`의 "스페이스".

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| kind | chat_space_kind | not null |
| team_id | uuid | null 허용, FK → teams, 유일 (`chat_spaces_team_unique`) |
| branch_id | uuid | null 허용, FK → branches, 유일 (`chat_spaces_branch_unique`) |
| name | text | null 허용. 커뮤니티 스페이스만 쓴다. 팀 스페이스와 지점 라운지는 팀·지점의 이름을 그대로 보여준다 |
| created_by | uuid | null 허용, FK → users. 커뮤니티 스페이스를 만든 사람 |
| deleted_at | timestamptz | null 허용. 지운 스페이스(커뮤니티, 그리고 지시서 31부터 지운 팀의 팀 스페이스)는 아무도 읽을 수 없다 |
| icon_color | space_icon_color | not null, 기본값 `blue`. 커뮤니티의 아이콘 색 (지시서 26) |

- `CHECK` (`chat_spaces_kind_ref`): `team`이면 `team_id`만 있고 `branch_id`·`name`은 없다. `branch`면 `branch_id`만 있고 `team_id`·`name`은 없다. `community`면 `name`과 `created_by`가 있고 `team_id`·`branch_id`는 없다.
- 팀 스페이스의 멤버는 저장하지 않는다 (`team_members`에서 계산). 지점 라운지와 커뮤니티 스페이스의 멤버는 `chat_space_members`에 둔다 (지시서 26).

### chat_rooms (방, 지시서 20에서 새로 만듦)

메시지가 쌓이는 곳 하나. 텍스트 채널, 음성 채널, DM, 그룹 DM, 회의 채널.

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| kind | chat_room_kind | not null |
| space_id | uuid | null 허용, FK → chat_spaces. 채널(`text`, `voice`)만 |
| name | text | null 허용. 채널만. 1–30자 |
| topic | text | null 허용. 0–200자 |
| admin_only | boolean | not null, 기본값 false. 관리자만 쓰는 채널 |
| last_seq | bigint | not null, 기본값 0. Drizzle에서는 `bigint({ mode: 'number' })`. 이 방의 마지막 메시지 번호 |
| last_message_at | timestamptz | null 허용 |
| archived_at | timestamptz | null 허용 |
| dm_low_user_id | uuid | null 허용, FK → users. 1:1 DM의 두 사람 가운데 id가 작은 쪽 (지시서 23) |
| dm_high_user_id | uuid | null 허용, FK → users. id가 큰 쪽 (지시서 23) |
| booking_id | uuid | null 허용, FK → bookings, on delete cascade, 유일 (`chat_rooms_booking_unique`). 회의 채널의 예약 (지시서 25) |
| voice_capacity | integer | null 허용. 음성 채널의 최대 인원. `CHECK` (`chat_rooms_voice_capacity`): `voice`면 2–25, 다른 종류는 null (지시서 27) |

- `CHECK` (`chat_rooms_kind_ref`): `text`, `voice`이면 `space_id`와 `name`이 있고 `dm_low_user_id`, `dm_high_user_id`가 없다. `dm`이면 두 사람이 있고 `dm_low_user_id < dm_high_user_id`이며 `space_id`와 `name`이 없다 (지시서 23에서 바꿈). `group_dm`이면 `space_id`와 두 사람이 없다 (이름은 있어도 없어도 된다. 지시서 24). `meeting`이면 `booking_id`가 있고 스페이스·DM의 두 사람·이름이 없다. 다른 종류에는 `booking_id`가 없다 (지시서 25).
- 1:1 DM은 두 사람에 하나다: `unique (dm_low_user_id, dm_high_user_id) WHERE kind = 'dm'` (`chat_rooms_dm_pair_unique`).
- `CHECK` (`chat_rooms_name_length`): `name`이 있으면 1–30자, `topic`이 있으면 200자 이하.
- 같은 스페이스에서 보관되지 않은 채널의 이름은 대소문자를 무시하고 유일하다 (`chat_rooms_space_name_unique`, `(space_id, lower(name)) WHERE archived_at IS NULL`).
- 인덱스: `(space_id)`, `(dm_high_user_id)` (내 DM을 찾을 때 작은 쪽은 유일 인덱스가 받는다).

### messages (메시지, 지시서 20에서 새로 만듦)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| room_id | uuid | not null, FK → chat_rooms, on delete cascade |
| seq | bigint | not null. 방별 번호. 넣을 때 그 방의 `last_seq`를 1 올려 받는다 (`docs/spec/chat.md` "데이터") |
| author_id | uuid | null 허용, FK → users. 시스템 메시지는 null |
| kind | message_kind | not null, 기본값 `text` |
| body | text | not null |
| client_id | text | null 허용. 브라우저가 만든 id. 다시 보내기가 두 번 저장되지 않게 |
| reply_to_id | uuid | null 허용, FK → messages, ON DELETE SET NULL. 같은 방의 메시지 (지시서 22) |
| mentions_everyone | boolean | not null, 기본값 false. `@모두` (지시서 22) |
| edited_at | timestamptz | null 허용 (지시서 22) |
| deleted_at | timestamptz | null 허용 (지시서 22). 지운 메시지는 본문이 빈 문자열이다 |
| deleted_by | uuid | null 허용, FK → users (지시서 22) |
| system_data | jsonb | null 허용. 시스템 메시지의 종류와 값 (`$type<SystemMessageData>`. 지시서 24. id와 이메일은 넣지 않는다) |

- `unique (room_id, seq)` (`messages_room_id_seq_unique`) — 다시 연결한 뒤 빠진 메시지를 번호로 찾는다.
- `unique (room_id, client_id) WHERE client_id IS NOT NULL` (`messages_room_id_client_id_unique`).
- `CHECK` (`messages_author_kind`): `kind = 'system'`이면 `author_id`가 null이고, `text`면 null이 아니다.
- `CHECK` (`messages_body_length`): 지워지지 않은 `text` 메시지는 `char_length(body)`가 0–4000(빈 본문은 첨부가 있을 때만. 앱이 지킨다), 지워지지 않은 `system` 메시지는 1–4000, 지운 메시지(`deleted_at`이 있음)는 빈 문자열 (지시서 22, 28에서 고침).
- 본문 안의 멘션은 `<@{userId}>`, `<@everyone>`으로 저장한다 (`docs/spec/chat.md` "메시지").
- 인덱스: `@모두` 메시지만의 부분 인덱스 `messages_everyone_idx` `(room_id, seq) WHERE mentions_everyone AND deleted_at IS NULL` (지시서 22, 안 읽은 멘션 수).
- `CHECK` (`messages_system_data`): `kind = 'system'`이면 `system_data`가 있고, `text`면 없다 (지시서 24). 시스템 메시지의 `body`는 그 문장이다.
- 지금의 `space_ref`(공간 태그) 컬럼은 없앴다. 공간 태그는 뒤로 미룬다.

### message_reactions (리액션, 지시서 22)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| message_id | uuid | not null, FK → messages, on delete cascade |
| user_id | uuid | not null, FK → users |
| emoji | reaction_emoji | not null. `thumbs_up`, `heart`, `joy`, `tada`, `open_mouth`, `cry`, `pray`, `check` |

- 기본 키 `(message_id, user_id, emoji)`.

### message_mentions (멘션, 지시서 22)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| message_id | uuid | not null, FK → messages, on delete cascade |
| user_id | uuid | not null, FK → users |

- 기본 키 `(message_id, user_id)`. 인덱스 `(user_id, message_id)`.
- `@모두`는 행으로 펼치지 않고 `messages.mentions_everyone`으로 둔다.

### chat_space_prefs (스페이스의 개인 설정, 지시서 22)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| space_id | uuid | not null, FK → chat_spaces, on delete cascade |
| user_id | uuid | not null, FK → users |
| muted | boolean | not null, 기본값 false |
| updated_at | timestamptz | not null |

- 기본 키 `(space_id, user_id)`. 멤버 여부가 아니라 설정만 담는다.

### chat_room_reads (읽은 자리, 지시서 21)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| room_id | uuid | not null, FK → chat_rooms, on delete cascade |
| user_id | uuid | not null, FK → users |
| last_read_seq | bigint | not null, 0 이상 (`chat_room_reads_seq_valid`). Drizzle에서는 `bigint({ mode: 'number' })` |
| muted | boolean | not null, 기본값 false (지시서 22부터 쓴다) |
| updated_at | timestamptz | not null |

- 기본 키 `(room_id, user_id)`.
- 채널, DM(지시서 23), 그룹 DM과 회의 채널의 읽은 자리를 모두 여기에 둔다. "들어온 시각"은 방 종류에 따라 다르다: 팀 스페이스의 채널은 `team_members.created_at`, DM·그룹 DM은 `chat_room_members.joined_at`, 회의 채널은 예약한 사람이면 `bookings.created_at`, 참석자면 `booking_participants.created_at` (지시서 25부터 두 `created_at`은 액션이 주입한 시각으로 넣는다), 라운지·커뮤니티의 채널은 `chat_space_members.joined_at` (지시서 26).
- 행이 없으면 "들어온 뒤의 남의 메시지가 안 읽음"이다 (`docs/spec/chat.md` "읽음과 알림", 지시서 21). 읽은 번호는 줄지 않고 그 방의 `last_seq`를 넘지 않는다 (쓰는 문장이 `GREATEST`와 `LEAST`로 지킨다).

### chat_room_members (DM의 멤버, 지시서 23)

1:1 DM과 그룹 DM의 멤버만 둔다. 채널의 멤버는 스페이스에서, 회의 채널의 멤버는 예약에서 계산한다.

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| room_id | uuid | not null, FK → chat_rooms, on delete cascade |
| user_id | uuid | not null, FK → users |
| status | chat_member_status | not null. 1:1 DM은 지시서 23에서 언제나 `active`. 메시지 요청(지시서 24)이 `requested`, `declined`를, 그룹 DM 나가기(지시서 24)가 `left`를 쓴다 |
| requested_at | timestamptz | null 허용. 메시지 요청을 받은 쪽의 행에만. 이번 요청을 시작한 시각 (지시서 24. 하루 10명과 3개를 셀 때 쓴다) |
| joined_at | timestamptz | not null. 안 읽음의 시작점 |
| status_changed_at | timestamptz | not null |

- 기본 키 `(room_id, user_id)`. 인덱스 `(user_id)`.
- `CHECK` (`chat_room_members_requested`): `status`가 `requested`나 `declined`면 `requested_at`이 있다 (지시서 24).
- 읽은 번호와 알림 끔은 여기가 아니라 `chat_room_reads`에 둔다 (`docs/spec/chat.md`의 윤곽에서 바꿈. 채널과 같은 코드로 읽음을 다루려고).

### friendships (친구 관계, 지시서 23)

두 사람의 관계 한 행. 뜻과 규칙은 `docs/spec/chat.md`의 "친구".

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| user_low_id | uuid | not null, FK → users. 두 사람 가운데 id가 작은 쪽 |
| user_high_id | uuid | not null, FK → users |
| status | friendship_status | not null |
| requested_by | uuid | not null, FK → users. 마지막으로 요청한 사람 |
| requested_at | timestamptz | not null. 마지막으로 요청한 시각 (하루 20개를 셀 때 쓴다. 취소해도 남는다) |
| status_changed_at | timestamptz | not null. 거절 30일, 취소 24시간을 셀 때 쓴다 |

- 기본 키 `(user_low_id, user_high_id)`. `CHECK` (`friendships_order`): `user_low_id < user_high_id`. `CHECK` (`friendships_requester`): `requested_by`는 두 사람 가운데 하나.
- 인덱스: `(user_high_id)`, `(requested_by, requested_at)` (`friendships_requester_idx`).
- 친구 끊기는 행을 지운다. 다른 상태 변화는 같은 행을 고쳐 쓴다.

### user_blocks (차단, 지시서 24)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| blocker_id | uuid | not null, FK → users. 차단한 사람 |
| blocked_id | uuid | not null, FK → users. 차단당한 사람 |

- 기본 키 `(blocker_id, blocked_id)`. 인덱스 `(blocked_id)`. `CHECK` (`user_blocks_not_self`): `blocker_id <> blocked_id`.
- 풀면 행을 지운다.

### reports (신고, 지시서 24)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| reporter_id | uuid | not null, FK → users |
| target_user_id | uuid | not null, FK → users. 메시지 신고면 그 메시지의 작성자 |
| message_id | uuid | null 허용, FK → messages, on delete set null |
| reason | report_reason | not null |
| detail | text | null 허용. 500자 이하 (`reports_detail_length`) |

- 같은 사람이 같은 메시지를 두 번 신고할 수 없다: `unique (reporter_id, message_id) WHERE message_id IS NOT NULL` (`reports_message_unique`).
- 인덱스: `(target_user_id)`, `(reporter_id, created_at)` (하루 20개를 셀 때).

지시서 42에서 처리 기록을 더한다.

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| resolved_at | timestamptz | null 허용. 처리한 시각 |
| resolved_by | uuid | null 허용, FK → users. 처리한 운영자 |
| resolution | report_resolution | null 허용 |

- `CHECK` (`reports_resolution_consistent`): `(resolved_at IS NULL) = (resolved_by IS NULL) AND (resolved_at IS NULL) = (resolution IS NULL)`.
- 인덱스: 처리하지 않은 메시지 신고만의 부분 인덱스 `reports_open_message_idx` `(message_id) WHERE resolved_at IS NULL AND message_id IS NOT NULL`.
- 누가 처리할 수 있는지와 범위는 `docs/spec/admin.md`의 "신고".

### chat_space_members (스페이스의 멤버, 지시서 26)

지점 라운지와 커뮤니티 스페이스만. 팀 스페이스의 행은 넣지 않는다.

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| space_id | uuid | not null, FK → chat_spaces |
| user_id | uuid | not null, FK → users |
| role | chat_space_role | not null, 기본값 `member`. 라운지는 언제나 `member` (관리자는 `branch.announce`로 계산) |
| status | chat_space_member_status | not null, 기본값 `active`. `banned`는 내보낸 사람 (다시 들어올 수 없다) |
| joined_at | timestamptz | not null. 안 읽음의 시작점 |
| status_changed_at | timestamptz | not null |

- 기본 키 `(space_id, user_id)`. 인덱스 `(user_id)`.
- 한 스페이스의 소유자는 하나다: `unique (space_id) WHERE role = 'owner'` (`chat_space_members_one_owner`).
- 나가면 행을 지운다. 내보내면 `banned`로 바꾼다. 풀어 주면 행을 지운다.

### chat_space_invites (스페이스 초대, 지시서 26)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| space_id | uuid | not null, FK → chat_spaces |
| code | text | not null, 유일 (`chat_space_invites_code_unique`). 추측할 수 없는 값 (16바이트 base64url) |
| created_by | uuid | not null, FK → users |
| target_user_id | uuid | null 허용, FK → users. 직접 초대의 받을 사람. 링크는 null |
| expires_at | timestamptz | null 허용. null이면 만료 없음 |
| max_uses | integer | null 허용. 1 또는 10. null이면 횟수 제한 없음 |
| use_count | integer | not null, 기본값 0 |
| revoked_at | timestamptz | null 허용 |

- `CHECK` (`chat_space_invites_uses`): `use_count >= 0`이고 `max_uses`가 null이거나 1 이상이며 `use_count <= max_uses`.
- 인덱스: `(space_id, created_at)`(하루 20개를 셀 때), `(created_by, created_at)`, `(target_user_id)`.

### message_attachments (첨부, 지시서 28)

메시지에 붙는 파일. 올리는 중·보내기 전(메시지 없음)·붙음의 세 상태를 한 행으로 둔다. 뜻과 규칙은 `docs/spec/chat.md`의 "자료 공유".

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| room_id | uuid | not null, FK → chat_rooms, on delete cascade. 올릴 때 정한 방 |
| uploader_id | uuid | not null, FK → users |
| message_id | uuid | null 허용, FK → messages, on delete cascade. null이면 보내기 전 |
| position | smallint | null 허용. 메시지 안의 순서. `CHECK` (`message_attachments_position_range`): 0–9 |
| storage_key | text | not null, 유일 (`message_attachments_key_unique`). 저장소의 키. 이름을 넣지 않는다 |
| name | text | not null. 1–200자 (`message_attachments_name_length`). 정리한 원래 이름 |
| size | bigint | not null. 1–26214400 (`message_attachments_size_range`, 25MB). Drizzle에서는 `bigint({ mode: 'number' })` |
| content_type | text | not null. 판별한 종류. 처음(올리는 중)과 이미지가 아닌 것은 `application/octet-stream`. 브라우저가 알려 준 값은 저장하지 않는다 |
| kind | attachment_kind | not null, 기본값 `file` |
| width | integer | null 허용. 이미지만 |
| height | integer | null 허용. 이미지만 |
| uploaded_at | timestamptz | null 허용. 올림을 끝낸 시각. null이면 올리는 중 |

- `CHECK` (`message_attachments_attached`): `message_id`가 있으면 `position`과 `uploaded_at`이 있다.
- `CHECK` (`message_attachments_image_size`): `kind = 'image'`면 `width`, `height`가 1 이상이고, `file`이면 둘 다 null.
- 한 메시지 안에서 순서는 겹치지 않는다: `unique (message_id, position) WHERE message_id IS NOT NULL` (`message_attachments_position_unique`).
- `room_id`는 붙은 메시지의 방과 같아야 한다 (DB가 아니라 붙이는 액션이 지키고 테스트한다).
- 인덱스: `(message_id)`(메시지의 첨부와 파일 탭. 파일 탭은 메시지 번호 순이다), `(uploader_id, created_at)`(합계와 오래된 것 치우기).
- 메시지를 지우면(지시서 22의 표시만 하는 삭제) 액션이 첨부 행을 지운다. 보내기 전 첨부는 24시간 뒤 치운다.

### call_sessions (통화, 지시서 27)

한 방의 통화 한 번. 음성 채널은 사람이 있는 동안, 허들은 시작부터 마지막 사람이 나갈 때까지. LiveKit의 방 이름은 `call:{room_id}`.

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| room_id | uuid | not null, FK → chat_rooms, on delete cascade |
| kind | call_kind | not null. 음성 채널이면 `voice`, 그 밖의 방이면 `huddle` |
| started_by | uuid | null 허용, FK → users. 허들을 시작한 사람 |
| started_at | timestamptz | not null |
| ended_at | timestamptz | null 허용 |

- 방마다 열린 통화는 하나: `unique (room_id) WHERE ended_at IS NULL` (`call_sessions_one_open`).
- `CHECK` (`call_sessions_time`): `ended_at`이 있으면 `started_at` 이상.

### call_participants (통화의 참가, 지시서 27)

들어갈 때마다 새 행을 넣는다. 행의 `id`가 참가 id이고 LiveKit 토큰의 속성에 실린다 (나가기·아직 있음·웹훅이 정확히 그 참가만 다루게).

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| session_id | uuid | not null, FK → call_sessions, on delete cascade |
| user_id | uuid | not null, FK → users |
| joined_at | timestamptz | not null |
| left_at | timestamptz | null 허용 |
| last_seen_at | timestamptz | not null. 마지막 "아직 있음"(30초마다)이나 웹훅의 들어옴 |

- 한 사람이 동시에 둘 이상의 통화에 있을 수 없다: `unique (user_id) WHERE left_at IS NULL` (`call_participants_one_active`).
- 인덱스: `(session_id)`.
- "지금 있음" = `left_at IS NULL AND last_seen_at > 지금 - 2분`. 저장하지 않고 계산한다.

### teams (팀)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| name | text | not null. 2–40자. 정규화(NFC, 앞뒤 공백 제거, 연속 공백 하나로)한 값을 저장 |
| created_by | uuid | not null, FK → users. 만든 사람이 첫 팀 관리자 |
| home_branch_id | uuid | null 허용, FK → branches. 주 이용 지점. 참고 정보이고 권한 판정에는 쓰지 않는다 |
| headcount | integer | null 허용. 인원 규모 |
| contact_phone | text | null 허용. 담당자 연락처. 숫자와 맨 앞의 `+`만 저장. 팀 관리자에게만 내려보낸다 (`docs/spec/auth.md`) |
| deleted_at | timestamptz | null 허용. 지운 팀 (지시서 31, `docs/spec/teams.md`). 팀 행은 지난 예약을 위해 남긴다 |
| deleted_by | uuid | null 허용, FK → users. 지운 팀 관리자 (지시서 31) |

- 이름은 대소문자를 무시하고 유일하다: `unique (lower(name))` (이름 `teams_name_unique`). 지시서 31부터는 지우지 않은 팀끼리만 유일하다: `unique (lower(name)) where deleted_at is null` (같은 이름의 인덱스를 다시 만든다)
- `CHECK` (`teams_deleted_consistent`, 지시서 31): `(deleted_at is null) = (deleted_by is null)`
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
| updated_by | uuid | null 허용, FK → users. 마지막으로 바꾼 운영자 (지시서 37) |

- PK `(branch_id, role)`. 행이 없으면 코드의 기본값을 쓴다 (`docs/spec/roles-and-access.md`).

### announcements (공지, 지시서 41)

| 컬럼 | 타입 | 제약 |
| --- | --- | --- |
| id | uuid | PK |
| branch_id | uuid | not null, FK → branches |
| author_id | uuid | not null, FK → users |
| title | text | not null. 1–60자 |
| body | text | not null. 1–500자 |
| lounge_message_id | uuid | null 허용, FK → messages, on delete set null. 라운지 `# 공지`에 쓴 메시지 |
| audience | jsonb | null 허용. 예약한 사람 알림의 조건 `{ date: 'YYYY-MM-DD', floorId: string \| null, spaceId: string \| null }` (`$type<AnnouncementAudience>`) |
| recipient_count | integer | not null, 기본값 0. 알림을 받은 사람 수 |

- `CHECK` (`announcements_text_length`): `char_length(title) BETWEEN 1 AND 60 AND char_length(body) BETWEEN 1 AND 500`.
- 받는 곳이 하나 이상(`lounge_message_id` 또는 `audience`)인지는 넣는 액션이 지킨다. 라운지 메시지가 나중에 지워지면 `lounge_message_id`가 null이 될 수 있어서 DB 제약으로 두지 않는다.
- 인덱스: `(branch_id, created_at desc)` (보낸 공지 목록과 하루 20개를 셀 때).
- 알림은 `notifications`에 `branch_announcement`로 넣는다. `booking_id`는 null이고 `data`는 `{ branchName, title, body, announcementId }`다.

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

`tests/db`에서 마이그레이션을 적용한 DB(PGlite)에 직접 넣어 보고 확인한다. 항목은 53개이고, 한 항목에 경우가 여럿이면 경우마다 따로 단언한다. 1–10은 셋업에서(8–10은 지시서 20에서 다시 썼다), 11–14는 가입·팀 전환 작업에서, 15–16은 예약 작업에서, 17은 운영자 공간 관리 작업에서, 18–20은 공간 사진 작업에서, 21은 사용 인원 작업(지시서 14)에서, 22는 참석자 초대 작업(16)에서, 23은 알림 작업(17)에서, 24는 읽음 작업(21)에서, 25–27은 메시지 다듬기(22)에서, 28–31은 사람 1(23)에서, 32–35는 사람 2(24)에서, 36은 회의 채널(25)에서, 37–39는 스페이스(26)에서, 40–42는 통화(27)에서, 43–44는 자료 공유(28)에서, 45는 프로필과 설정(30)에서, 46–47은 팀 관리(31)에서, 48은 예약 현황(35)에서, 49는 점검(36)에서, 50은 편집기 1(38)에서, 51은 공지(41)에서, 52는 신고 처리(42)에서, 53은 사진 올리기(43)에서 만든다.

1. 같은 공간에 시간이 겹치는 `confirmed` 예약 두 개는 들어가지 않는다 (`23P01`).
2. 끝과 시작이 맞닿은 예약(10:00–11:00, 11:00–12:00)은 들어간다.
3. `cancelled` 예약은 같은 시간의 새 예약을 막지 않는다.
4. 다른 공간의 같은 시간 예약은 들어간다.
5. `during`이 비어 있는 경우, 시작이 무한인 경우, 끝이 무한인 경우, 경계가 `[)`가 아닌 경우(`[]`)는 각각 들어가지 않는다.
6. 한 층에 draft 두 개는 들어가지 않는다. published 두 개도 들어가지 않는다.
7. `(branch_id, level)`이 같은 층 두 개는 들어가지 않는다.
8. 종류에 맞는 참조가 없는 스페이스는 들어가지 않는다 (`team`인데 `team_id`가 없음, `branch`인데 `name`이 있음, `community`인데 `name`이 없음 등). 같은 팀의 팀 스페이스 두 개는 들어가지 않는다. (지시서 20에서 바꿈. 전에는 통화 테이블의 제약이었다. 통화의 제약은 지시서 27이 새 번호로 더한다.)
9. 한 방에 `seq`가 같은 메시지 두 개는 들어가지 않는다. `client_id`가 같은 메시지 두 개도 들어가지 않는다 (다른 방이면 들어간다). 작성자가 없는 `text` 메시지, 작성자가 있는 `system` 메시지, 본문이 4001자인 메시지는 들어가지 않는다 (지시서 28부터 `text` 메시지의 빈 본문은 들어간다. 빈 본문은 첨부가 있을 때만이라는 규칙은 앱이 지킨다. 본문이 빈 `system` 메시지는 들어가지 않는다). 방을 지우면 그 방의 메시지도 지워진다.
10. 스페이스나 이름이 없는 채널(`text`, `voice`)은 들어가지 않는다. 같은 스페이스에 대소문자만 다른 같은 이름의 채널 두 개는 들어가지 않는다. 앞의 채널이 보관된 뒤에는 들어간다.
11. 대소문자만 다른 같은 이름의 팀 두 개는 들어가지 않는다.
12. `headcount`가 0이거나 1000을 넘는 팀은 들어가지 않는다.
13. 같은 팀이 같은 이메일에 보낸 대기 중 초대 두 개는 들어가지 않는다. 앞의 초대가 취소·거절·수락된 뒤에는 들어간다.
14. 같은 팀에 같은 사람의 대기 중 가입 요청 두 개는 들어가지 않는다. 앞의 요청이 거절·취소된 뒤에는 들어간다.
15. `cancelled`인데 `cancelled_at`이 없는 예약, `confirmed`인데 `cancelled_at`이 있는 예약은 들어가지 않는다.
16. 지점을 지우면 그 지점을 기본 지점으로 둔 사용자의 `default_branch_id`가 null이 된다.
17. 같은 층에 대소문자만 다른 같은 이름의 공간 두 개는 들어가지 않는다. 앞의 공간이 보관된 뒤에는 들어간다. 다른 층에는 들어간다.
18. 한 공간에 `sort_order`가 같은 사진 두 장은 들어가지 않는다. `sort_order`가 -1이거나 10인 사진은 들어가지 않는다. 공간을 지우면 그 공간의 사진도 지워진다.
19. 경로가 `https://example.com/a.webp`, `//example.com/a.webp`, `/a/../b.webp`, `seed/a.webp`, `/a.gif`, `/A.webp`, `/seed/photos/awebp`, `/seed/photos/a_png`인 사진은 각각 들어가지 않는다. `/seed/photos/a-1.webp`는 들어간다. 뒤의 두 경우는 정규식의 `\.`이 "아무 글자"로 바뀌지 않았는지 확인한다 (Drizzle의 `sql` 템플릿에서는 `\\.`으로 써야 `\.`이 남는다). 대체 글이 빈 문자열이거나 121자인 사진은 들어가지 않는다.
20. 지점의 대표 사진은 경로만 있거나 대체 글만 있으면 들어가지 않는다. 경로의 형식이 틀려도 들어가지 않는다.
21. `attendee_count`가 0이거나 501인 예약은 들어가지 않는다. null, 1, 500은 들어간다.
22. 같은 예약에 같은 사람의 참석자 행 두 개는 들어가지 않는다. 예약을 지우면 그 예약의 참석자 행도 지워진다.
23. 같은 사람, 같은 예약, 같은 `scheduled_for`의 `booking_reminder` 알림 두 개는 들어가지 않는다. 종류가 다르면(예: `booking_invited`) 들어간다. 예약을 지우면 그 예약의 알림도 지워진다.
24. 같은 방에 같은 사람의 읽은 자리 두 개는 들어가지 않는다. `last_read_seq`가 -1이면 들어가지 않는다. 방을 지우면 그 방의 읽은 자리도 지워진다. (지시서 21)
25. 지운 메시지의 빈 문자열이 아닌 본문, 지워지지 않은 `system` 메시지의 빈 본문은 들어가지 않는다. 지워지지 않은 `text` 메시지의 빈 본문은 들어간다. (지시서 22, 28에서 고침)
26. 같은 메시지에 같은 사람의 같은 이모지 리액션 두 개는 들어가지 않는다 (다른 이모지는 들어간다). enum에 없는 이모지는 들어가지 않는다. 메시지를 지우면(행 삭제) 리액션과 멘션도 지워진다. (지시서 22)
27. 같은 메시지에 같은 사람의 멘션 두 개, 같은 스페이스에 같은 사람의 설정 두 개는 들어가지 않는다. (지시서 22)
28. 사용자 이름이 `ab`(2자), 21자, `Subin`(대문자), `su bin`, `수빈`인 사용자는 들어가지 않는다. `sub.in_1`은 들어간다. 같은 사용자 이름 두 개는 들어가지 않는다. 사용자 이름이 null인 사용자는 여럿 들어간다. (지시서 23)
29. `user_low_id`가 `user_high_id`보다 크거나 같은 친구 관계, `requested_by`가 두 사람이 아닌 친구 관계, 같은 두 사람의 친구 관계 두 개는 들어가지 않는다. (지시서 23)
30. 두 사람이 없거나 순서가 거꾸로이거나 `space_id`가 있는 `dm` 방, 두 사람이 있는 `text` 방, 같은 두 사람의 `dm` 방 두 개는 들어가지 않는다. (지시서 23)
31. 같은 방에 같은 사람의 멤버 행 두 개는 들어가지 않는다. 방을 지우면 멤버 행도 지워진다. (지시서 23)
32. 자기 자신을 차단한 행, 같은 두 사람의 차단 행 두 개는 들어가지 않는다. 거꾸로(B가 A를)는 들어간다. (지시서 24)
33. 같은 사람이 같은 메시지를 신고한 행 두 개는 들어가지 않는다 (메시지가 없는 사용자 신고는 여러 개 들어간다). 설명이 501자인 신고는 들어가지 않는다. 메시지를 지우면(행 삭제) 신고의 `message_id`가 null이 된다. (지시서 24)
34. `space_id`나 DM의 두 사람이 있는 `group_dm` 방, `requested_at`이 없는 `requested`·`declined` 멤버 행은 들어가지 않는다. 이름이 없는 `group_dm`은 들어간다. (지시서 24)
35. `system_data`가 없는 `system` 메시지, `system_data`가 있는 `text` 메시지는 들어가지 않는다. (지시서 24)
36. `booking_id`가 없는 `meeting` 방, `booking_id`가 있는 `text` 방, 같은 예약의 `meeting` 방 두 개는 들어가지 않는다. 예약을 지우면(시드만 그렇게 한다) 그 방도 지워진다. (지시서 25)
37. 같은 스페이스에 같은 사람의 멤버 행 두 개, 소유자 두 사람은 들어가지 않는다. 관리자 두 사람은 들어간다. (지시서 26)
38. 같은 코드의 초대 두 개, `use_count`가 -1이거나 `max_uses`를 넘는 초대, `max_uses`가 0인 초대는 들어가지 않는다. (지시서 26)
39. 같은 지점의 라운지 두 개는 들어가지 않는다 (`chat_spaces_branch_unique`). enum에 없는 아이콘 색은 들어가지 않는다. (지시서 26)
40. `voice_capacity`가 없거나 1·26인 `voice` 방, `voice_capacity`가 있는 `text` 방은 들어가지 않는다. 2와 25는 들어간다. (지시서 27)
41. 한 방에 열린 통화 두 개는 들어가지 않는다. 앞의 것이 끝난 뒤에는 들어간다. 끝이 시작보다 이른 통화는 들어가지 않는다. 방을 지우면 통화도 지워진다. (지시서 27)
42. 한 사람의 `left_at`이 없는 참가 두 개는 (다른 통화여도) 들어가지 않는다. 앞의 것에 `left_at`이 있으면 들어간다. 통화를 지우면 참가도 지워진다. (지시서 27)
43. 같은 저장 키의 첨부 두 개, 크기가 0이거나 25MB를 넘는 첨부, 이름이 빈 첨부, `message_id`는 있는데 `position`이나 `uploaded_at`이 없는 첨부는 들어가지 않는다. (지시서 28)
44. 가로·세로가 없는 `image` 첨부, 가로·세로가 있는 `file` 첨부, 한 메시지에 같은 순서의 첨부 두 개는 들어가지 않는다. 메시지를 지우면(행 삭제) 첨부도 지워진다. (지시서 28)
45. `users.reminder_minutes`에 `{30,10,5,0}` 밖의 값(예: 15)은 들어가지 않는다. 빈 배열은 들어간다. (지시서 30)
46. 같은 이름(대소문자만 다른 것 포함)의 지우지 않은 팀 둘은 들어가지 않는다. 한쪽에 `deleted_at`이 있으면 들어간다. (지시서 31)
47. `teams`의 `deleted_at`과 `deleted_by`는 둘 다 있거나 둘 다 없다. (지시서 31)
48. 확정 예약에 `cancel_kind`가 있으면, 취소된 예약에 `cancel_kind`만 있고 `cancel_reason`이 없으면(또는 그 반대), `cancel_reason`이 빈 문자열이거나 201자면 들어가지 않는다. 취소된 예약에 둘 다 없거나 둘 다 있으면 들어간다. (지시서 35)
49. 같은 공간에 시간이 겹치는 점검 두 개는 들어가지 않는다 (`23P01`). 맞닿은 점검과 다른 공간의 같은 시간 점검은 들어간다. (지시서 36)
50. `revision`이 -1인 평면도는 들어가지 않는다. (지시서 38)
51. 제목이 빈 문자열이거나 61자인 공지, 내용이 501자인 공지는 들어가지 않는다. (지시서 41)
52. `resolved_at`만 있거나 `resolution`만 있는 신고는 들어가지 않는다. 셋 다 있거나 셋 다 없으면 들어간다. (지시서 42)
53. 한 공간의 사진 두 장의 `sort_order`(0과 1)를 한 문장의 `UPDATE`로 맞바꾸면 성공한다. 두 문장으로 나눠 첫 문장에서 겹치게 하면 실패한다. (지시서 43)
