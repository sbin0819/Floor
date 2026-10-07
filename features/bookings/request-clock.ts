import { cache } from "react";

const requestInstant = cache(() => Date.now());

// 숫자만 공유해 호출자가 Date를 바꾸어도 같은 요청의 다른 카드에 번지지 않는다.
export function readBookingNow(databaseInjected = false): Date {
  return new Date(databaseInjected ? Date.now() : requestInstant());
}
