import { describe, expect, it } from "vitest";
import { getLoginNotice, isInvalidReset } from "@/features/auth/messages";

describe("login notices", () => {
  it.each(["TOKEN_EXPIRED", "INVALID_TOKEN"])(
    "prioritizes %s over verified=1 and offers resend",
    (code) => {
      expect(getLoginNotice(code, "1")).toEqual({
        message:
          "인증 링크가 만료됐거나 잘못됐어요. 인증 메일을 다시 받아 주세요",
        href: "/verify-email",
        linkLabel: "인증 메일 다시 받기",
      });
    },
  );
  it("maps the installed OAuth account linking error to password recovery", () => {
    expect(getLoginNotice("account_not_linked", undefined)?.href).toBe(
      "/forgot-password",
    );
    expect(getLoginNotice("account_not_linked", undefined)?.message).toBe(
      "이 이메일로 시작한 가입이 있어요. 비밀번호를 재설정한 뒤 로그인해 주세요",
    );
  });
  it.each(["email_not_verified", "provider_email_not_verified"])(
    "maps %s to a verified-email explanation",
    (code) => {
      expect(getLoginNotice(code, undefined)?.message).toBe(
        "이메일이 인증되지 않은 계정이라 로그인할 수 없어요",
      );
    },
  );
  it.each(["<script>private</script>", ["INVALID_TOKEN", "private"], ""])(
    "never reflects arbitrary error values",
    (value) => {
      expect(getLoginNotice(value, "1")).toEqual({
        message: "로그인하지 못했어요. 다시 시도해 주세요",
      });
    },
  );
  it("shows verification success only without an error", () => {
    expect(getLoginNotice(undefined, "1")?.message).toBe(
      "이메일 인증이 끝났어요. 로그인해 주세요",
    );
    expect(getLoginNotice(undefined, undefined)).toBeUndefined();
  });
  it("recognizes the reset callback's lowercase and API uppercase errors", () => {
    expect(isInvalidReset("invalid_token")).toBe(true);
    expect(isInvalidReset("INVALID_TOKEN")).toBe(true);
    expect(isInvalidReset("TOKEN_EXPIRED")).toBe(true);
    expect(isInvalidReset("network_error")).toBe(false);
  });
});
