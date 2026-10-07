# 서버 구성

별도 API 서버 없이 Next.js 안에서 서버 로직을 처리한다. 쓰기는 전부 Server Actions, DB는 Neon Postgres다.

## 어떤 일을 어느 방식으로 하나

| 하는 일 | 처리 방식 | 이유 |
| --- | --- | --- |
| 예약 생성·변경·취소·연장 | Server Action | 겹침 방지는 DB 제약이 최종 방어선. 액션은 인증·검증·결과 반환 |
| 메시지 전송, 공지, 문의 응답 | Server Action | `client_id`로 중복 방지, 커밋 뒤 실시간 채널에 발행 |
| 공간 상태 변경, 평면도 초안 저장·게시 | Server Action | 게시는 검증과 트랜잭션을 한 액션 안에서 |
| 통화 입장 토큰, 로그인·데모 계정 | Server Action | 비밀 키가 서버에만 있음 |
| 첫 화면 데이터 | Server Component에서 `features/*/queries.ts` 호출 | 읽기에는 액션을 쓰지 않음 |
| 게시된 평면도 JSON, 이전 메시지 불러오기 | Route Handler (GET) | 액션은 POST라 캐시가 안 되고, 한 번에 하나씩만 실행됨 |
| 실시간 반영 (예약 상태, 새 메시지, 평면도 게시) | 브라우저가 실시간 채널을 직접 구독 | 액션은 서버가 먼저 보내는 통신을 못 함 |
| 도면 이미지 업로드 | 액션이 서명된 업로드 주소 발급 → 브라우저가 저장소로 직접 업로드 | 액션 요청 본문 기본 한도가 1MB |
| 통화 종료 같은 외부 웹훅 | Route Handler (POST) | 외부 서비스가 호출할 고정 주소가 필요 |

## 계층

```
화면 (Server Component / Client Component)
  └─ features/<도메인>/actions.ts   Server Action. lib/actions 래퍼로 만든다
  └─ features/<도메인>/queries.ts   Server Component가 부르는 읽기 함수
        └─ lib/permissions          can(), canAccess()
        └─ lib/dal                  DB를 읽고 쓰는 유일한 곳
              └─ lib/db             Drizzle 클라이언트와 스키마
```

- `lib/db`는 `lib/db`, `lib/dal`, `drizzle.config.*`, `tests/db` 안에서만 import한다.
- 액션 핸들러는 `lib/db`를 import할 수 없으므로, 여러 쓰기를 묶을 때는 `lib/dal`이 내보내는 `withTransaction(fn)`을 쓴다. `lib/dal` 함수는 드라이버마다 모양이 다른 `db.execute()`의 원시 결과에 기대지 않는다.
- `lib/dal` 함수는 "누가 부르는지"를 인자로 받지 않는 순수한 데이터 함수다. 권한 판정은 그 위(액션, 쿼리)에서 한다. 단, 접근 범위에 따라 공간 이름·상태를 걸러 주는 조회는 `lib/dal`이 아니라 `features/*/queries.ts`에서 `canAccess()`를 거쳐 만든다.

## 액션 결과 타입

액션은 예외를 던지지 않는다. 클라이언트가 분기할 수 있게 코드를 돌려준다.

```ts
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ActionErrorCode; message?: string; fieldErrors?: Record<string, string[]> };

export type ActionErrorCode =
  | 'UNAUTHENTICATED'    // 세션 없음
  | 'FORBIDDEN'          // can() 또는 canAccess() 실패
  | 'INVALID_INPUT'      // zod 검증 실패. fieldErrors를 채운다
  | 'NOT_FOUND'
  | 'BOOKING_CONFLICT'   // 겹치는 예약 (Postgres 23P01)
  | 'SPACE_BLOCKED'      // 점검 구간과 겹침
  | 'LIMIT_EXCEEDED'     // 역할별 예약 한도 초과
  | 'PLAN_INVALID'       // 평면도 게시 검증 실패
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
export async function requireSession(): Promise<Session>; // 없으면 ActionError('UNAUTHENTICATED')
```

- 실제 인증(Neon Auth 예정)은 이 두 함수 뒤에 숨긴다. 다른 코드는 인증 라이브러리를 직접 부르지 않는다.
- 셋업 단계에서는 데모 모드만 구현한다. `AUTH_MODE=demo`일 때 서명된 httpOnly 쿠키에 담긴 사용자 id로 `users` 행을 찾아 세션을 만든다. 서명 키는 `AUTH_SECRET`이다.
- 쿠키 이름은 `floor_session`, 값은 `{ sub: userId }`를 담은 HS256 JWT, 만료는 7일이다. 서명과 검증은 `jose` 같은 검증된 라이브러리로 한다.
- `lib/auth/session.ts`에 `createSessionCookie(userId)`와 `clearSessionCookie()`를 둔다. 이 둘을 부르는 로그인 액션과 화면은 셋업에서 만들지 않는다 (PFQV-46).
- `AUTH_MODE`가 `demo`가 아니면(비어 있는 문자열 포함) `getSession()`은 null을 돌려주고, 실제 인증 연결은 이후 작업(PFQV-11)으로 남긴다.

## DB 연결

- Drizzle + Neon 드라이버를 쓴다. 게시와 예약은 여러 문장을 묶는 트랜잭션이 필요하므로, 대화형 트랜잭션을 지원하는 연결 방식을 고른다. Drizzle 문서 기준으로 `neon-http`는 단일 비대화형 트랜잭션용이고, 대화형 트랜잭션은 `neon-serverless`(WebSocket)가 지원한다.
- 테스트는 실제 Neon에 붙지 않는다. PGlite에 같은 마이그레이션을 적용해서 돌린다. 그래서 `lib/dal` 함수는 DB 클라이언트를 주입받을 수 있게 만든다 (기본값은 실제 클라이언트).
- `DATABASE_URL`이 없어도 `pnpm build`, `pnpm test`, `pnpm db:generate`는 통과해야 한다.

## 실시간

실시간 서비스는 아직 정하지 않았다. 모양만 고정한다: 서버는 커밋 뒤에 이벤트를 발행하고, 브라우저는 채널을 구독한다.

```ts
// 서버
export interface RealtimePublisher {
  publish(channel: string, event: RealtimeEvent): Promise<void>;
}
// 브라우저
export interface RealtimeSubscriber {
  subscribe(channel: string, onEvent: (e: RealtimeEvent) => void): () => void; // 해제 함수 반환
}
```

- 채널 이름은 헬퍼로만 만든다: `floor:{floorId}`, `room:{roomId}`, `user:{userId}`.
- 이벤트에는 내용 전체가 아니라 "무엇이 바뀌었는지"만 싣는다. 브라우저는 그걸 받아 해당 데이터를 다시 조회한다. 채팅 메시지만 예외로 본문을 포함하고, 놓친 메시지는 `seq`로 보정한다.

```ts
export type RealtimeEvent =
  | { type: 'booking.changed'; spaceId: string }
  | { type: 'space.status_changed'; spaceId: string }            // 점검 등록·해제
  | { type: 'plan.published'; floorId: string; version: number }
  | { type: 'message.created'; roomId: string; id: string; seq: number;
      authorId: string | null; kind: 'text' | 'system'; body: string; createdAt: string };
```

- 셋업 단계에서는 아무 일도 하지 않는 구현과 테스트용 메모리 구현만 둔다. 실제 서비스 연결은 PFQV-54에서 한다.
- 실시간 채널 토큰을 발급할 때도 `canAccess()`를 거친다.

## 환경 변수

`lib/env.ts`에서 zod로 검증한다.

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `DATABASE_URL` | 실행 시 | Neon 연결 문자열. 빌드·테스트에는 없어도 됨 |
| `AUTH_MODE` | 아니오 | `demo` 또는 비움. 기본값은 비움 |
| `AUTH_SECRET` | `AUTH_MODE=demo`일 때 | 데모 세션 쿠키 서명 키 |
| `NEXT_PUBLIC_APP_URL` | 아니오 | 기본값 `http://localhost:3000` |

실시간, LiveKit, 파일 저장소 변수는 해당 작업에서 추가한다.
