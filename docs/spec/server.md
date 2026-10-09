# 서버 구성

별도 API 서버 없이 Next.js 안에서 서버 로직을 처리한다. 쓰기는 전부 Server Actions, DB는 Neon Postgres다.

## 어떤 일을 어느 방식으로 하나

| 하는 일 | 처리 방식 | 이유 |
| --- | --- | --- |
| 예약 생성·변경·취소·연장 | Server Action | 겹침 방지는 DB 제약이 최종 방어선. 액션은 인증·검증·결과 반환 |
| 메시지 전송, 공지, 문의 응답 | Server Action | `client_id`로 중복 방지, 커밋 뒤 실시간 채널에 발행 |
| 공간 상태 변경, 평면도 초안 저장·게시 | Server Action | 게시는 검증과 트랜잭션을 한 액션 안에서 |
| 통화 입장 토큰, 데모 계정 로그인 | Server Action | 비밀 키가 서버에만 있음 |
| 가입, 로그인, 로그아웃, 이메일 인증, 비밀번호 재설정 | Better Auth의 Route Handler (`/api/auth/[...all]`) | 인증 라이브러리가 쿠키와 OAuth 콜백을 직접 다룸 |
| 팀 만들기, 초대, 가입 요청 | Server Action | 다른 쓰기와 같은 래퍼를 쓴다 |
| 첫 화면 데이터 | Server Component에서 `features/*/queries.ts` 호출 | 읽기에는 액션을 쓰지 않음 |
| 게시된 평면도 JSON | Route Handler (GET, 캐시) | 액션은 POST라 캐시가 안 되고, 한 번에 하나씩만 실행됨 |
| 채팅의 이전 메시지와 빠진 메시지, 채팅 목록의 안 읽음 | Route Handler (GET, `private, no-store`. 지시서 21) `/api/rooms/[roomId]/messages`, `/api/chat/nav` | 액션은 한 번에 하나씩만 실행되어 보내기를 늦춤 |
| 참석자 찾기 (입력하는 동안의 검색), 알림의 수와 목록 (주기적으로 다시 읽기) | Route Handler (GET, `Cache-Control: private, no-store`) | 액션은 한 번에 하나씩 실행돼 입력을 따라가지 못하고, `router.refresh()`는 그 화면의 모든 조회를 다시 돌림. 핸들러는 `features/*/queries.ts`를 부르기만 하고, 세션 확인은 그 함수가 한다 (`docs/spec/booking-2.md`) |
| 실시간 반영 (예약 상태, 새 메시지, 평면도 게시) | 브라우저가 실시간 채널(Ably)을 직접 구독. 토큰은 Route Handler `POST /api/realtime/token` | 액션은 서버가 먼저 보내는 통신을 못 함. 액션은 하나씩 차례로 실행되므로 토큰 발급에 쓰지 않음 |
| 도면 이미지·공간 사진 업로드 (운영자) | 액션이 R2의 서명된 PUT 주소 발급 → 브라우저가 R2로 직접 업로드 → 확인 액션 (지시서 40, 43. `docs/spec/admin.md`의 "운영자 파일 저장소") | 액션 요청 본문 기본 한도가 1MB |
| 운영자 파일 보기 | Route Handler (GET) `/api/space-photos/[file]`(지시서 43), `/api/plan-backgrounds/[planId]`(지시서 40) | 비공개 버킷에서 권한 확인 뒤 흐름으로 내려 준다 |
| 운영자 화면의 미리보기 (점검의 겹치는 예약, 공지의 받는 사람 수, 게시 전 검사) | Server Action (지시서 36, 39, 41) | "읽기에는 액션을 쓰지 않음"의 예외. 입력이 멈춘 뒤 한 번씩만 부르고, 쓰기 액션과 같은 판정·잠금 없는 같은 계산을 써야 해서 |
| 통화 종료 같은 외부 웹훅 | Route Handler (POST) | 외부 서비스가 호출할 고정 주소가 필요. LiveKit 웹훅 `POST /api/livekit/webhook`(서명 확인, 지시서 27) |
| 파일 올리기의 몸통 (`local` 저장소) | Route Handler (PUT) `/api/uploads/[attachmentId]` | 25MB를 흐름으로 받는다. 뒤의 저장소에서는 서명된 주소로 바로 올리므로 없다. `Origin` 확인 (지시서 28) |
| 파일 내려받기, 방의 파일 목록 | Route Handler (GET) `/api/files/[attachmentId]`, `/api/rooms/[roomId]/files` | 권한 확인 뒤 흐름으로 내려 주고 머리(`nosniff`, `sandbox` CSP, `attachment`)를 붙인다. 목록은 되풀이 읽기 (지시서 28) |
| 사람 찾기, 프로필 카드, ⌘K의 사람 목록 | Route Handler (GET, `private, no-store`) `/api/people/search`, `/api/people/[userId]`(지시서 23), `/api/people/contacts`(지시서 26) | 입력을 따라 되풀이해 읽는다. 핸들러는 `features/people/queries.ts`를 부르기만 하고, 세션 확인은 그 함수가 한다 |
| 통화의 아직 있음·나가기 | Route Handler (POST) `/api/calls/heartbeat`, `/api/calls/leave` | 30초마다 보내는 요청이 Server Action의 줄을 막지 않게, 탭을 닫을 때 `sendBeacon`으로 보낼 수 있게. `Origin` 확인 (지시서 27) |

## 계층

```
화면 (Server Component / Client Component)
  └─ features/<도메인>/actions.ts   Server Action. lib/actions 래퍼로 만든다
  └─ features/<도메인>/queries.ts   Server Component가 부르는 읽기 함수
        └─ lib/permissions          can(), canAccess()
        └─ lib/dal                  DB를 읽고 쓰는 유일한 곳
              └─ lib/db             Drizzle 클라이언트와 스키마
```

- `lib/db`는 `lib/db`, `lib/dal`, `lib/auth/auth.ts`, `drizzle.config.*`, `tests/db` 안에서만 import한다.
- 액션 핸들러는 `lib/db`를 import할 수 없으므로, 여러 쓰기를 묶을 때는 `lib/dal`이 내보내는 `withTransaction(fn)`을 쓴다. `lib/dal` 함수는 드라이버마다 모양이 다른 `db.execute()`의 원시 결과에 기대지 않는다.
- `lib/dal` 함수는 "누가 부르는지"를 인자로 받지 않는 순수한 데이터 함수다. 권한 판정은 그 위(액션, 쿼리)에서 한다. 단, 접근 범위에 따라 공간 이름·상태를 걸러 주는 조회는 `lib/dal`이 아니라 `features/*/queries.ts`에서 `canAccess()`를 거쳐 만든다.

## 액션 결과 타입

액션은 예외를 던지지 않는다. 클라이언트가 분기할 수 있게 코드를 돌려준다.

```ts
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ActionErrorCode; message?: string; fieldErrors?: Record<string, string[]>;
      issues?: PlanIssue[] }; // PLAN_INVALID일 때만 (지시서 39. docs/spec/floor-plan.md)

export type ActionErrorCode =
  | 'UNAUTHENTICATED'    // 세션 없음
  | 'FORBIDDEN'          // can() 또는 canAccess() 실패
  | 'INVALID_INPUT'      // zod 검증 실패. fieldErrors를 채운다
  | 'NOT_FOUND'
  | 'BOOKING_CONFLICT'   // 겹치는 예약 (Postgres 23P01)
  | 'SPACE_BLOCKED'      // 점검 구간과 겹침
  | 'LIMIT_EXCEEDED'     // 한도 초과 (역할별 예약 한도, 관리하는 팀 수, 대기 중 초대·요청 수, 채팅의 하루 수와 인원 — message로 구분: send_rate, friend_daily, request_daily, space_count, call_full, password_attempts(지시서 30), admin_teams(지시서 31) 등)
  | 'PLAN_INVALID'       // 평면도 게시 검증 실패. issues를 채운다
  | 'STALE'              // 읽은 뒤에 다른 사람이 먼저 바꿈: 평면도 초안의 revision(지시서 38), 역할 설정(지시서 37), 점검의 겹치는 예약(지시서 36)
  | 'TEAM_NAME_TAKEN'    // 같은 이름의 팀이 있음
  | 'ALREADY_MEMBER'     // 이미 그 팀의 팀원
  | 'ALREADY_REQUESTED'  // 대기 중인 가입 요청이 있음
  | 'INVITE_INVALID'     // 초대가 만료·취소·처리됐거나 다른 사람의 초대. 스페이스 초대(지시서 26)도 이유를 가리지 않고 이것 하나
  | 'OUTSIDE_HOURS'      // 운영 시간 밖이거나 쉬는 날
  | 'SPACE_IN_USE'       // 앞으로의 예약이 있어 공간을 보관하거나 예약 불가로 바꿀 수 없음
  | 'OVER_CAPACITY'      // 사용 인원이나 "예약한 사람 + 참석자"가 공간의 정원보다 많음
  | 'USERNAME_TAKEN'     // 다른 사람이 쓰는 사용자 이름 (지시서 23)
  | 'CHANNEL_NAME_TAKEN' // 같은 스페이스에 같은 이름의 채널이 있음 (지시서 26)
  | 'PASSWORD_INCORRECT' // 비밀번호 바꾸기에서 지금 비밀번호가 틀림 (지시서 30)
  | 'LAST_ADMIN'         // 마지막 팀 관리자를 팀원으로 바꾸거나 그 사람이 나가려 함 (지시서 31)
  | 'INTERNAL';          // 그 밖의 오류. 서버 로그에만 자세히 남긴다
```

- `message`는 사용자에게 보여줄 문장이 아니다. 화면 문구는 클라이언트가 `code`로 고른다.
- `INTERNAL`일 때 내부 오류 내용을 클라이언트로 보내지 않는다.

## 액션 래퍼

모든 액션은 래퍼로 만든다. 래퍼가 순서를 강제한다: 세션 확인 → zod 검증 → 권한 확인 → 실행.

```ts
// 사용하는 쪽의 모양 (이름과 세부는 구현하면서 다듬어도 된다)
export const cancelBooking = createAction({
  input: z.object({ bookingId: z.uuid() }),   // zod 4 기준. 설치된 버전의 문법을 따른다
  authorize: async ({ session, input }) => { /* can()/canAccess()로 판정, boolean 반환 */ },
  handler: async ({ session, input }) => { /* lib/dal 호출, data 반환 */ },
});
```

래퍼가 하는 일

1. `getSession()`이 없으면 `UNAUTHENTICATED`. 로그인 없이 부르는 액션은 `auth: 'public'`처럼 명시해서만 허용하고, 그때 `session`의 타입은 `Session | null`이다.
2. `input` 스키마로 `safeParse`. 실패하면 `INVALID_INPUT`과 `fieldErrors`.
3. `authorize`가 false면 `FORBIDDEN`. `authorize`를 빼먹을 수 없게 타입에서 필수로 둔다 (권한이 필요 없으면 `authorize: 'none'`을 명시).
4. `handler` 실행. 알려진 오류는 코드로 바꾼다: Postgres `23P01` → `BOOKING_CONFLICT`, 도메인 오류 클래스(`ActionError(code)`) → 그 코드. `authorize`에서 던진 `ActionError`도 같은 방식으로 바꾼다 (예: 대상이 없으면 `NOT_FOUND`).
5. 그 밖의 예외는 로그를 남기고 `INTERNAL`.

계약

- 래퍼가 돌려주는 함수의 모양은 `(input: unknown) => Promise<ActionResult<T>>`다.
- `create-action.ts` 자체에는 `'use server'`를 넣지 않는다. `'use server'`는 액션을 내보내는 `features/*/actions.ts`에 넣는다.
- SQLSTATE는 오류의 `cause` 사슬을 따라가며 찾는다. Drizzle이 드라이버 오류를 감싸므로 바깥 오류의 `code`에는 값이 없다.
- 테스트에서 uuid가 필요하면 `crypto.randomUUID()`나 예시 파일의 값을 쓴다. 임의로 지어낸 uuid는 zod의 uuid 검사를 통과하지 못할 수 있다.

## 액션 작성 규칙

- 클라이언트는 id와 바꿀 값만 보낸다. 소유자·역할·팀 소속은 서버가 세션으로 다시 조회한다.
- 액션은 한 클라이언트에서 한 번에 하나씩 순서대로 실행된다. 드래그 중에는 호출하지 않고 놓을 때 한 번만, 초안 자동 저장은 디바운스하고, `Promise.all`로 여러 액션을 병렬 호출하지 않는다.
- 낙관적 UI는 TanStack Query mutation 안에서 액션을 호출하는 형태로 만든다. 실시간으로 들어온 변경도 같은 캐시에 합치기 위해서다.
- 요청 본문 기본 한도는 1MB다. 평면도 초안이 한도에 가까워지면 바뀐 부분만 보내거나 Next.js 설정의 `serverActions.bodySizeLimit`을 올린다 (설정 위치는 설치된 버전의 문서에서 확인한다).
- 새로 배포하면 열려 있던 탭에서 "Failed to find Server Action" 오류가 날 수 있다. 새로고침 안내로 처리한다.

## 세션

```ts
export type Session = { userId: string; email: string; name: string };
export async function getSession(): Promise<Session | null>;
export async function requireSession(): Promise<Session>;                 // 없으면 ActionError('UNAUTHENTICATED'). 액션과 queries용
export async function requirePageSession(next: string): Promise<Session>; // 없으면 redirect('/login?next=…'). (app) 페이지용
export async function requireOperatorPage(): Promise<Session>;            // admin 페이지용. docs/spec/auth.md
```

- 인증은 Better Auth를 직접 운영한다. 자세한 규칙은 `docs/spec/auth.md`에 있다.
- Better Auth는 이 함수들 뒤에 숨긴다. 다른 코드는 인증 라이브러리를 직접 부르지 않는다. 예외는 `lib/auth/*`(인증 인스턴스, 운영자 생성 함수), `/api/auth/[...all]` Route Handler, `(auth)` 화면과 머리글 로그아웃 버튼이 쓰는 인증 클라이언트뿐이다.
- `getSession()`은 세션 쿠키가 없으면 인증 인스턴스를 만들지 않고 null을 돌려준다.
- 셋업 때 만든 데모 세션(`AUTH_MODE`, `floor_session` 쿠키, `createSessionCookie`, `clearSessionCookie`)은 인증 작업(PFQV-63)에서 없앤다.
- Cache Components가 켜져 있으므로 세션을 읽는 컴포넌트는 `<Suspense>` 아래에 둔다. 세션이나 권한 결과를 읽는 함수에는 `use cache` 종류를 어느 것도 붙이지 않는다.
- 레이아웃은 보호 수단이 아니다. `(app)`의 모든 페이지가 `requirePageSession()`을, `admin`의 모든 페이지가 `requireOperatorPage()`를, queries의 모든 함수와 액션이 세션 확인을 직접 한다.
- `lib/db`를 import할 수 있는 곳에 인증 인스턴스를 만드는 파일 하나(`lib/auth/auth.ts`)를 더한다. Drizzle 어댑터가 DB와 스키마를 직접 받아야 하기 때문이다.

## 메일

- 메일은 `lib/email`의 `EmailSender` 인터페이스로만 보낸다 (`docs/spec/auth.md`). 구현은 콘솔과 테스트용 메모리 두 가지이고, 실제 발송 서비스는 아직 정하지 않았다. 콘솔 구현은 배포 환경에서 출력하지 않고 오류를 던진다.
- 메일을 보내는 일은 DB 커밋 뒤에 한다. 메일 발송이 실패해도 이미 저장한 초대나 요청을 되돌리지 않고, 실패를 로그에 남긴다.

## DB 연결

- Drizzle + Neon 드라이버를 쓴다. 게시와 예약은 여러 문장을 묶는 트랜잭션이 필요하므로, 대화형 트랜잭션을 지원하는 연결 방식을 고른다. Drizzle 문서 기준으로 `neon-http`는 단일 비대화형 트랜잭션용이고, 대화형 트랜잭션은 `neon-serverless`(WebSocket)가 지원한다.
- 테스트는 실제 Neon에 붙지 않는다. PGlite에 같은 마이그레이션을 적용해서 돌린다. 그래서 `lib/dal` 함수는 DB 클라이언트를 주입받을 수 있게 만든다 (기본값은 실제 클라이언트).
- `DATABASE_URL`이 없어도 `pnpm build`, `pnpm test`, `pnpm db:generate`는 통과해야 한다.

## 실시간

서비스는 Ably다 (지시서 20). 서버는 커밋 뒤에 이벤트를 발행하고, 브라우저는 채널을 구독한다. 규칙 전체는 `docs/spec/chat.md`의 "실시간 (Ably)".

```ts
// 서버
export interface RealtimePublisher {
  publish(channel: string, event: RealtimeEvent): Promise<void>;
  publishMany(items: { channel: string; event: RealtimeEvent }[]): Promise<void>; // 지시서 22
}
// 브라우저
export interface RealtimeSubscriber {
  subscribe(channel: string, onEvent: (e: RealtimeEvent) => void): () => void; // 해제 함수 반환
}
```

- 채널 이름은 헬퍼로만 만든다: `floor:{floorId}`, `room:{roomId}`, `user:{userId}`, `space:{spaceId}`.
- 이벤트에는 내용 전체가 아니라 "무엇이 바뀌었는지"만 싣는다. 브라우저는 그걸 받아 해당 데이터를 다시 조회한다. 채팅 메시지만 예외로 본문을 포함하고, 놓친 메시지는 `seq`로 보정한다. 이메일은 어떤 이벤트에도 싣지 않는다.

```ts
export type ChatRoomKind = 'text' | 'voice' | 'dm' | 'group_dm' | 'meeting'; // roomKind는 지시서 23부터, bookingId(회의 채널만 값)는 지시서 25부터
// SystemMessageData는 features/chat/system-messages.ts의 zod 타입 (지시서 24. docs/codex/24-people-requests-groups.md 1단계)
export type AvatarColor = 'blue' | 'green' | 'orange' | 'purple' | 'pink' | 'teal' | 'yellow' | 'gray'; // 지시서 30
export type Avatar = { color: AvatarColor; photoUrl: string | null }; // 사람 아바타. 색은 고른 것이 없으면 사용자 id로 정한 것 (docs/spec/settings.md)
export type ReactionEmoji = 'thumbs_up' | 'heart' | 'joy' | 'tada' | 'open_mouth' | 'cry' | 'pray' | 'check'; // 지시서 22

export type RealtimeEvent =
  | { type: 'booking.changed'; spaceId: string }
  | { type: 'space.status_changed'; spaceId: string }            // 점검 등록·해제
  | { type: 'plan.published'; floorId: string; version: number }
  | { type: 'message.created'; roomId: string; id: string; seq: number;
      authorId: string | null; authorName: string | null; kind: 'text' | 'system';
      authorAvatar: Avatar | null; // 지시서 30. 시스템 메시지는 null
      body: string; clientId: string | null; createdAt: string;
      // 지시서 22부터. 새 메시지라 editedAt·deletedAt은 null, reactions는 []. attachments는 지시서 28부터
      replyTo: { id: string; authorName: string | null; excerpt: string; deleted: boolean;
                 attachmentSummary: { images: number; files: number; firstName: string | null } | null /* 지시서 28 */ } | null;
      systemData: SystemMessageData | null; // 지시서 24. text면 null
      mentions: { userId: string; name: string }[]; mentionsEveryone: boolean;
      editedAt: null; deletedAt: null; reactions: [];
      attachments: { id: string; name: string; size: number; kind: 'image' | 'file'; width: number | null; height: number | null }[] }
  | { type: 'room.activity'; spaceId: string | null; roomId: string; roomKind: ChatRoomKind; bookingId: string | null; seq: number; authorId: string | null;
      preview: { messageId: string; authorName: string | null; excerpt: string } | null } // 채널은 space:로 preview 없이 (지시서 21). DM은 상대의 user:로 preview와 함께 (지시서 23)
  | { type: 'room.read'; roomId: string; userId: string; seq: number } // room: 채널. DM에서만 (지시서 23)
  | { type: 'message.updated'; roomId: string; id: string; seq: number; body: string; mentions: { userId: string; name: string }[]; mentionsEveryone: boolean; editedAt: string } // 지시서 22
  | { type: 'message.deleted'; roomId: string; id: string; seq: number }
  | { type: 'reaction.changed'; roomId: string; messageId: string; emoji: ReactionEmoji; userId: string; added: boolean; count: number }
  | { type: 'mention.created'; spaceId: string | null; roomId: string; roomKind: ChatRoomKind; bookingId: string | null; roomName: string; messageId: string; seq: number; authorName: string; excerpt: string } // user: 채널. DM이면 roomName은 보낸 사람 이름
  | { type: 'friend.changed' }          // user: 채널. 친구·요청이 바뀜, 다시 읽기 (지시서 23)
  | { type: 'notifications.changed' }   // user: 채널. 알림 종을 다시 읽기 (지시서 23)
  | { type: 'room.changed'; roomId: string }   // room: 채널. 방 정보·멤버·요청 상태가 바뀜, 다시 읽기 (지시서 24)
  | { type: 'realtime.reauth' }                // user: 채널. 붙은 방을 다시 확인하고 토큰을 다시 받기 (지시서 24)
  | { type: 'status.changed'; status: 'online' | 'away' | 'dnd' } // user: 채널. 내 다른 탭 (지시서 24)
  | { type: 'space.changed'; spaceId: string }   // space: 채널. 채널·멤버·이름·역할이 바뀜, 다시 읽기 (지시서 26)
  | { type: 'call.changed'; roomId: string; roomKind: ChatRoomKind; spaceId: string | null; bookingId: string | null;
      sessionId: string | null; kind: 'voice' | 'huddle' | null; participantCount: number; participants: { userId: string; name: string }[] } // room:과 space:(채널) 또는 멤버의 user:. 라운지의 space:는 participants가 빈 배열 (지시서 27)
  | { type: 'call.ringing'; roomId: string; sessionId: string; callerId: string; callerName: string } // 1:1 DM 상대의 user: (지시서 27)
  | { type: 'call.declined'; roomId: string; sessionId: string };  // 시작한 사람과 거절한 사람의 user: (지시서 27)
```

- 서버의 발행기는 `lib/realtime/server.ts`의 `getRealtimePublisher()`가 고른다: `ABLY_API_KEY`가 있으면 Ably, 없으면 아무 일도 하지 않는 구현. 테스트는 메모리 구현이나 가짜를 주입한다. 발행이 실패해도 액션은 성공이고 오류는 기록만 한다.
- 예약·운영자 액션의 발행(`booking.changed` 등)은 지시서 33까지 아무 일도 하지 않는 구현을 쓰고, 지시서 34부터 `getRealtimePublisher()`를 쓴다 (PFQV-19).
- 브라우저의 토큰은 Route Handler `POST /api/realtime/token`이 Ably 토큰 요청으로 준다. `clientId`는 사용자 id, 유효 시간 10분, 권한은 정확한 채널 이름만이고 발행 권한은 없다. 권한에 방을 넣을 때마다 그 방을 읽을 수 있는지(`canReadRoom`) 판정한다.
- 브라우저의 연결은 앱의 틀에 하나만 둔다.
- presence 데이터의 모양은 채널마다 다르고 섞지 않는다: `room:`은 입력 중 `{ typing: boolean; name: string }`(지시서 22. 이름은 믿지 않고 멤버 목록에서 찾는다), `space:`는 상태 `{ status: 'online' | 'away' | 'dnd'; auto: boolean }`(지시서 24. 직접 고른 상태는 `auto: false`, 자동 자리 비움은 `auto: true`). 같은 사람의 여러 연결은 방해 금지 → 직접 고른 자리 비움 → 온라인 → 자동 자리 비움 순으로 합친다.
- 리액션 이벤트는 완전한 반응자 집합이 아니라 재조회 신호다. 기존 메시지 GET의 `before`/`after`만 써서 불러온 50개 번호 구간을 보정하고, 새 `ids` 모드나 별도 API는 만들지 않는다. 이벤트를 250ms 동안 페이지별로 묶고, QueryClient 수명의 대기열은 한 번에 하나·분당 최대 50회로 처리한다. 다시 연결하면 보이는 페이지 → 최신 페이지 → 나머지 순서, 백그라운드 페이지는 2초 간격이다. 실패 재시도와 페이지별 세대 확인으로 빠진 보정과 오래된 응답을 막는다 (지시서 22).
- 채팅 쓰기는 사용자 행을 방 행보다 먼저 잠근다. 삭제의 `deleted_by`, 리액션, 읽은 자리의 외래 키도 예외가 아니다. 여러 사용자는 id 순서로 한 번씩 필요한 최종 잠금 세기로 잡고, 방을 잡은 뒤 사용자 잠금을 올리지 않는다 (지시서 22–25).
- 지시서 24부터 토큰은 내가 속한 모든 스페이스(100개까지)의 `space:`에 `subscribe`와 `presence`를 준다. 입력의 `spaces`는 쓰지 않는다.
- 지시서 34부터 토큰은 내가 접근할 수 있는 모든 층(`canAccessFloor`. 운영자는 자기 지점의 모든 층. 200개까지)의 `floor:`에 `subscribe`만 준다. 입력으로 층을 받지 않는다. 층 이벤트에는 공간 id만 있고 이름·예약한 사람은 없다.

## 환경 변수

`lib/env.ts`에서 zod로 검증한다.

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `DATABASE_URL` | 실행 시 | Neon 연결 문자열. 빌드·테스트에는 없어도 됨 |
| `AUTH_SECRET` | 실행 시 | Better Auth 비밀 키. 빌드·테스트에는 없어도 됨 |
| `NEXT_PUBLIC_APP_URL` | 아니오 | 기본값 `http://localhost:3000`. 인증의 기준 주소로도 쓴다 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | 아니오 | 둘 다 있을 때만 구글 로그인을 켠다 |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | 아니오 | 둘 다 있을 때만 GitHub 로그인을 켠다 |
| `ABLY_API_KEY` | 아니오 | 있을 때만 실시간을 켠다 (지시서 20). 서버에서만 읽는다 |
| `FILE_STORAGE` | 아니오 | `local` 또는 `disabled`. 없으면 `NODE_ENV`가 `development`일 때만 `local`, 그 밖(배포, 테스트)은 `disabled` (지시서 28) |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET` | 아니오 | `R2_ENDPOINT`는 S3 API 주소(`https://{계정 id}.r2.cloudflarestorage.com`). 넷 다 있을 때만 운영자 파일 올리기(공간 사진, 배경 도면)를 켠다 (지시서 40). 서버에서만 읽는다. 채팅 파일은 쓰지 않는다 |
| `FILE_STORAGE_DIR` | 아니오 | `local` 저장소의 폴더. 기본값 `.floor-local/uploads` (Git에 올리지 않는다) |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | 아니오 | 셋 다 있을 때만 통화를 켠다 (지시서 27). 서버에서만 읽는다. 브라우저는 통화에 들어갈 때 서버가 돌려주는 주소로 붙는다 (`NEXT_PUBLIC_LIVEKIT_URL`은 쓰지 않는다) |

실시간, LiveKit, 파일 저장소 변수는 해당 작업에서 추가한다.
