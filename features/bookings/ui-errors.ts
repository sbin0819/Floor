import type { ActionErrorCode } from "@/lib/actions/result";
import type { RoleLimits } from "@/lib/permissions/types";

export function bookingErrorMessage(
  result: { code: ActionErrorCode; message?: string },
  options: {
    limits?: RoleLimits;
    isToday?: boolean;
    restricted?: boolean;
    capacity?: number | null;
  } = {},
): string {
  switch (result.code) {
    case "BOOKING_CONFLICT":
      return "방금 다른 예약이 들어왔어요. 시간을 다시 골라 주세요";
    case "SPACE_BLOCKED":
      return "점검 중인 시간이에요";
    case "OUTSIDE_HOURS":
      return "운영 시간이 아니에요";
    case "OVER_CAPACITY":
      return options.capacity == null
        ? "공간의 정원을 확인해 주세요"
        : result.message === "participants"
          ? `참석자가 정원(${options.capacity}명)보다 많아요`
          : `정원은 ${options.capacity}명이에요`;
    case "LIMIT_EXCEEDED":
      if (
        result.message === "per_booking" &&
        options.limits?.maxMinutesPerBooking != null
      )
        return `한 번에 ${options.limits.maxMinutesPerBooking / 60}시간까지 예약할 수 있어요`;
      if (
        result.message === "days_ahead" &&
        options.limits?.maxDaysAhead != null
      )
        return `${options.limits.maxDaysAhead}일 뒤까지만 예약할 수 있어요`;
      if (result.message === "per_day")
        return `${options.isToday === false ? "이 날" : "오늘"} 예약할 수 있는 시간을 다 썼어요`;
      return "예약 한도를 확인해 주세요";
    case "FORBIDDEN":
      return options.restricted
        ? "이 공간은 지정된 팀만 예약할 수 있어요"
        : "이 작업을 할 권한이 없어요";
    case "NOT_FOUND":
      return "찾을 수 없어요. 화면을 새로 고쳐 주세요";
    case "INVALID_INPUT":
      return "입력한 내용을 확인해 주세요";
    case "UNAUTHENTICATED":
      return "로그인이 필요해요. 다시 로그인해 주세요";
    default:
      return "문제가 생겼어요. 잠시 뒤 다시 시도해 주세요";
  }
}
