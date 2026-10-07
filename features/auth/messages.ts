export const authMessages = {
  loginFailed: "이메일 또는 비밀번호가 맞지 않아요",
  genericError: "요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요",
  signupSent: "인증 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요",
  resetSent: "메일을 보냈어요. 받은 편지함을 확인해 주세요",
  emailUnavailable:
    "지금은 이메일로 가입하거나 재설정할 수 없어요. Google이나 GitHub로 계속해 주세요",
  invalidReset:
    "재설정 링크가 만료됐거나 잘못됐어요. 재설정 메일을 다시 받아 주세요",
  notOperator: "운영자 계정이 아니에요",
} as const;

export type AuthNotice = { message: string; href?: string; linkLabel?: string };

function normalizeCode(value: unknown): string {
  return typeof value === "string"
    ? value.toLowerCase().replaceAll(" ", "_")
    : "";
}

export function getLoginNotice(
  error: unknown,
  verified: unknown,
): AuthNotice | undefined {
  if (error !== undefined) {
    switch (normalizeCode(error)) {
      case "invalid_token":
      case "token_expired":
        return {
          message:
            "인증 링크가 만료됐거나 잘못됐어요. 인증 메일을 다시 받아 주세요",
          href: "/verify-email",
          linkLabel: "인증 메일 다시 받기",
        };
      case "account_not_linked":
        return {
          message:
            "이 이메일로 시작한 가입이 있어요. 비밀번호를 재설정한 뒤 로그인해 주세요",
          href: "/forgot-password",
          linkLabel: "비밀번호 재설정",
        };
      case "email_not_verified":
      case "provider_email_not_verified":
        return {
          message: "이메일이 인증되지 않은 계정이라 로그인할 수 없어요",
        };
      default:
        return { message: "로그인하지 못했어요. 다시 시도해 주세요" };
    }
  }
  if (verified === "1")
    return { message: "이메일 인증이 끝났어요. 로그인해 주세요" };
}

export function isUnverifiedEmail(error: unknown): boolean {
  return normalizeCode(error) === "email_not_verified";
}

export function isInvalidReset(error: unknown): boolean {
  return ["invalid_token", "token_expired", "missing_token"].includes(
    normalizeCode(error),
  );
}

export function getAuthErrorMessage(error: unknown): string {
  switch (normalizeCode(error)) {
    case "password_too_short":
    case "password_too_long":
      return "비밀번호는 8자 이상 128자 이하로 입력해 주세요";
    case "too_many_requests":
      return "요청이 많아요. 잠시 뒤 다시 시도해 주세요";
    default:
      return authMessages.genericError;
  }
}
