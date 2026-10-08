import { createMemoryRateLimiter } from "./memory";

// 미리 보기와 참여가 같은 사용자별 한 시간 창을 공유한다.
export const spaceInviteLimiter = createMemoryRateLimiter();
