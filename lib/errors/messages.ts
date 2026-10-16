import { ApiError, isRequestCanceled } from "@/lib/http/errors";

export const SESSION_EXPIRED_MESSAGE =
  "로그인이 필요해요. 다시 로그인해 주세요";

function errorCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  )
    return error.code;
}

export function isSessionExpired(error: unknown): boolean {
  if (isRequestCanceled(error)) return false;
  return error instanceof ApiError
    ? error.kind === "http" && error.status === 401
    : errorCode(error) === "UNAUTHENTICATED";
}

export function errorMessage(
  error: unknown,
  fallback = "문제가 생겼어요. 잠시 뒤 다시 시도해 주세요",
): string {
  if (isRequestCanceled(error)) return "";
  if (isSessionExpired(error)) return SESSION_EXPIRED_MESSAGE;
  if (error instanceof ApiError) {
    if (error.kind === "timeout")
      return "응답이 늦어지고 있어요. 잠시 뒤 다시 시도해 주세요";
    if (error.kind === "network") return "연결을 확인한 뒤 다시 시도해 주세요";
    if (error.kind === "invalid_response")
      return "응답을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요";
    if (error.status === 403) return "이 작업을 할 권한이 없어요";
    if (error.status === 404)
      return "찾을 수 없는 항목이에요. 새로고침해 주세요";
    if (error.status === 429)
      return "요청이 많아요. 잠시 뒤 다시 시도해 주세요";
    return fallback;
  }
  switch (errorCode(error)) {
    case "INVALID_INPUT":
      return "입력한 내용을 확인해 주세요";
    case "FORBIDDEN":
      return "이 작업을 할 권한이 없어요";
    default:
      return fallback;
  }
}
