# 역할, 권한, 접근 범위

두 가지를 따로 판정한다.

- 권한: "무엇을 할 수 있나". 역할에 붙는다. `can()`
- 접근 범위: "어디에서 할 수 있나". 층과 공간마다 정한다. `canAccess()`

계정은 하나이고 기본은 일반 사용자다. 팀에는 초대로 들어가고, 팀이 없어도 되고 여러 팀에 속해도 된다.

## 역할 4개 (고정)

새 역할은 만들 수 없다. 운영자가 지점별로 역할의 권한을 켜고 끄는 것만 가능하다.

| 역할 | 키 | 누가 | 어디에 적용되나 |
| --- | --- | --- | --- |
| 일반 사용자 | `user` | 로그인한 모든 계정 | 어디서나 기본으로 |
| 팀원 | `team_member` | 팀에 초대받아 수락한 사람 | 그 팀의 공간·채널·예약에만 |
| 팀 관리자 | `team_admin` | 팀을 만들었거나 관리자로 지정된 사람 | 그 팀 안에서만 |
| 운영자 | `operator` | `branch_staff`에 있는 사람 | 그 지점 전체 |

한 사람이 A팀에서는 팀 관리자, B팀에서는 팀원, 강남점에서는 운영자일 수 있다. 그래서 역할은 사람에게 고정된 값이 아니라 "이 사람이 이 대상에 대해 가진 역할"로 계산한다.

## 권한 키와 기본값

역할마다 "그 역할이 더해 주는 권한"만 가진다. 실제로 할 수 있는 일은 가진 역할들의 권한을 합친 것이다.

| 권한 키 | 뜻 | 기본으로 주는 역할 |
| --- | --- | --- |
| `floor.view` | 평면도·공간 보기 | user |
| `booking.own` | 공용 공간 예약, 내 예약 변경·취소 | user |
| `chat.lounge` | 라운지 채널 글쓰기, 운영자 문의 | user |
| `booking.team` | 팀 전용 공간 예약, 팀 이름으로 예약 | team_member |
| `chat.team` | 팀 채널 읽기·쓰기 | team_member |
| `booking.manage_team` | 팀원 예약 변경·취소 | team_admin |
| `chat.team.moderate` | 팀 채널 메시지 삭제 | team_admin |
| `team.manage_members` | 팀원 초대·내보내기 | team_admin |
| `booking.manage_all` | 모든 예약 변경·취소 | operator |
| `branch.announce` | 공지 보내기, 라운지 메시지 삭제 | operator |
| `space.manage` | 공간 상태·점검 관리 | operator |
| `plan.edit` | 평면도 편집·게시, 층·공간 이용 대상 설정 | operator |
| `stats.view` | 이용률 통계 보기 | operator |
| `roles.manage` | 역할과 권한 설정 | operator |

- 운영자는 팀 채널을 읽을 수 없다 (`chat.team` 없음). 팀의 사적인 공간이기 때문이다.
- 운영자는 기본으로 `booking.team`이 없다.
- `operator`의 `roles.manage`는 끌 수 없다. 스스로 잠그는 사고를 막기 위해서다. 저장할 때 서버가 강제로 넣는다.
- 사람별·채널별 예외는 두지 않는다. 권한은 역할에만 붙인다.

## 가진 역할 계산

```ts
type Target = { branchId?: string; teamId?: string };

// 이 사용자가 이 대상에 대해 가진 역할
heldRoles(ctx, target):
  'user'         항상
  'team_member'  target.teamId가 있고, 그 팀의 team_members에 있을 때 (role 무관)
  'team_admin'   target.teamId가 있고, 그 팀에서 role = 'admin'일 때
  'operator'     target.branchId가 있고, 그 지점의 branch_staff에 있을 때
```

## can()

```ts
type PermissionContext = {
  userId: string;
  teams: { teamId: string; role: 'admin' | 'member' }[];
  staffBranchIds: string[];
  // 지점별로 저장된 역할 설정. 행이 없는 지점·역할은 들어 있지 않다
  roleSettings: Record<string /* branchId */, Partial<Record<Role, PermissionKey[]>>>;
};

can(ctx, permission, target): boolean
```

1. `heldRoles(ctx, target)`를 구한다.
2. 역할마다 권한 목록을 구한다. `target.branchId`가 있고 그 지점에 그 역할의 `role_settings` 행이 있으면 그 값을, 없으면 위 표의 기본값을 쓴다. 역할별로 따로 판단한다.
3. `operator`의 목록에는 저장된 값과 상관없이 `roles.manage`를 항상 넣는다. (저장할 때 강제하는 것은 PFQV-60에서 한다.)
4. 합친 목록에 `permission`이 있으면 true.

위 권한 표는 "역할이 더해 주는 권한"이다. `can()`의 결과는 가진 역할의 합집합이므로, 예를 들어 팀 관리자는 `booking.team`(team_member가 줌)과 `floor.view`(user가 줌)도 할 수 있다.

- 판정 부분은 DB를 부르지 않는 순수 함수로 만든다. 소속과 설정을 불러오는 로더(`lib/dal`)와 분리해서 표 기반 단위 테스트를 쓸 수 있게 한다.
- `target.branchId`가 없는 판정(팀 채널, 팀원 관리처럼 지점과 무관한 일)은 기본값을 쓴다. 팀을 지점에 묶을지는 아직 정하지 않았다.

## 예약 한도

`role_settings.limits`의 모양이다. DB에 저장되는 값은 `Partial<RoleLimits>`이고, 키가 없으면 코드 기본값을 쓰고 값이 null이면 제한 없음이다. `team_admin`은 자체 한도가 없고(기본값 `{}`) `team_member`의 한도를 따른다.

```ts
type RoleLimits = {
  maxMinutesPerBooking: number | null;
  maxMinutesPerDay: number | null;   // 개인 예약은 그 사람 합계, 팀 예약은 팀 합계
  maxDaysAhead: number | null;
};
```

| 예약 종류 | 적용 역할 | 1회 최대 | 하루 합계 | 예약 가능 기간 |
| --- | --- | --- | --- | --- |
| 개인으로 예약 | user | 120분 | 120분 | 7일 앞까지 |
| 팀 이름으로 예약 | team_member | 240분 | 팀 합산 480분 | 14일 앞까지 |
| 운영자가 잡는 예약 | operator | 제한 없음 | 제한 없음 | 제한 없음 |

한도를 넘으면 액션은 `LIMIT_EXCEEDED`를 돌려준다. 한도 검사 구현은 예약 작업(PFQV-62)에서 한다. 셋업에서는 타입과 기본값 상수만 둔다.

## 층과 공간의 접근 범위

| 값 | 화면 이름 | 뜻 |
| --- | --- | --- |
| `everyone` | 모두 | 로그인한 누구나 보고 예약 |
| `teams` | 지정한 팀 | `access_grants`에 있는 팀의 팀원만 |
| `closed` | 닫힘 | 운영자만 |

- `floors.access`가 층의 기본 범위다. `spaces.access`가 null이면 층 설정을 따른다.
- 공간에서는 더 좁힐 수만 있다. 층이 `teams`이면 공간은 `teams`(층의 허용 팀 중 일부) 또는 `closed`만 된다. 층이 `closed`이면 공간도 닫힌다.
- 허용 목록을 공간 단위로 줄 수 있어서 팀마다 되는 곳과 안 되는 곳이 달라진다.
- 여러 팀에 속한 사람은 속한 팀들의 허용 범위를 합친 만큼 쓴다. 팀이 없으면 `everyone`인 곳만 쓴다.
- 운영자는 자기 지점의 모든 층과 공간에 접근한다.

## canAccess()

층의 범위와 공간의 범위를 겹친 부분만 허용한다. 데이터가 규칙에 어긋나게 저장돼 있어도 결과가 넓어지지 않게 하려는 것이다.

```ts
canAccess(ctx, space): boolean   // space에는 floor(access, branchId)와 두 단계의 허용 팀 목록이 포함된다

if (운영자(ctx, space.floor.branchId)) return true;
if (floor.access === 'closed' || space.access === 'closed') return false;

// 허용 팀 집합. null은 "팀 제한 없음"
let allowed: Set<teamId> | null = null;
if (floor.access === 'teams') allowed = floor의 허용 팀;
if (space.access === 'teams') allowed = allowed === null ? space의 허용 팀 : allowed ∩ space의 허용 팀;

if (allowed === null) return true;            // 층도 공간도 everyone(또는 공간 null)
return ctx의 팀 중 하나가 allowed에 있음;
```

층만 판정하는 `canAccessFloor(ctx, floor)`도 같은 규칙의 앞부분으로 만든다.

### 판정 예시 (단위 테스트로 옮긴다)

A팀, B팀이 있고 사용자는 표의 소속을 가진다. 운영자가 아닌 경우다.

| 층 | 층 허용 팀 | 공간 | 공간 허용 팀 | 소속 없음 | A팀 | B팀 | A·B팀 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| everyone | – | null | – | ○ | ○ | ○ | ○ |
| everyone | – | teams | A | × | ○ | × | ○ |
| everyone | – | closed | – | × | × | × | × |
| teams | A, B | null | – | × | ○ | ○ | ○ |
| teams | A, B | teams | A | × | ○ | × | ○ |
| teams | A | teams | B | × | × | × | × |
| teams | A | everyone | – | × | ○ | × | ○ |
| closed | – | null | – | × | × | × | × |
| closed | – | everyone | – | × | × | × | × |

같은 표의 모든 칸에서 그 지점 운영자는 ○다. 다른 지점의 운영자는 일반 사용자와 같다.

## 서버에서 쓰는 곳

- 층·공간 목록 조회, 예약 액션, 실시간 채널 토큰 발급이 모두 같은 `canAccess()`를 거친다.
- 접근할 수 없는 층은 층 목록에 내려보내지 않는다.
- 접근 가능한 층 안의 못 쓰는 공간은 평면도에 회색 "전용 공간"으로만 보인다. 서버는 그 공간의 이름과 예약 현황을 내려보내지 않는다.
- 평면도 도형(JSON)은 그 층에 접근 가능한 모두에게 같은 캐시를 준다. 사람에 따라 달라지는 것은 공간 메타와 상태뿐이다.
- 층·공간의 이용 대상을 저장할 때 "공간은 층보다 넓을 수 없다"와 "`teams`이면 허용 팀이 1개 이상"을 검사한다.

## 아직 정하지 않은 것

- 팀을 누구나 만들 수 있게 할지, 운영자 승인을 거칠지
- 팀을 특정 지점에 묶을지 (지금은 지점과 무관)
