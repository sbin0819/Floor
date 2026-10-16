import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeQueryClient } from "@/app/providers";
import { ApiError } from "@/lib/http/errors";
import {
  errorMessage,
  isSessionExpired,
  SESSION_EXPIRED_MESSAGE,
} from "@/lib/errors/messages";
import {
  notifySessionExpired,
  resetSessionExpiredNotice,
  sessionLoginHref,
} from "@/lib/errors/session-expired";
import { LoginForm } from "@/features/auth/components/login-form";
import {
  RealtimeProvider,
  RealtimeSession,
} from "@/components/realtime-provider";

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  dismiss: vi.fn(),
  login: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.error, dismiss: mocks.dismiss },
  Toaster: () => null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mocks.replace,
    refresh: mocks.refresh,
    push: vi.fn(),
  }),
}));
vi.mock("@/lib/auth/client", () => ({
  authClient: { signIn: { email: mocks.login } },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.login.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllGlobals());

describe("safe common error guidance", () => {
  it("distinguishes timeout/network/schema failures and ignores raw text", () => {
    expect(errorMessage(new ApiError("timeout"))).toContain("응답이 늦어지고");
    expect(errorMessage(new ApiError("network"))).toContain("연결을 확인");
    expect(errorMessage(new ApiError("invalid_response"))).toContain(
      "응답을 확인하지",
    );
    expect(
      errorMessage(new Error("private email and token"), "안전한 안내"),
    ).toBe("안전한 안내");
    expect(errorMessage({ code: "INVALID_INPUT", message: "private" })).toBe(
      "입력한 내용을 확인해 주세요",
    );
    expect(errorMessage(new DOMException("private", "AbortError"))).toBe("");
  });
  it("only treats current HTTP401 or an action authentication code as session expiry", () => {
    expect(isSessionExpired(new ApiError("http", { status: 401 }))).toBe(true);
    expect(isSessionExpired({ ok: false, code: "UNAUTHENTICATED" })).toBe(true);
    expect(
      isSessionExpired(
        new ApiError("http", { status: 500, code: "UNAUTHENTICATED" }),
      ),
    ).toBe(false);
    expect(isSessionExpired(new ApiError("timeout"))).toBe(false);
    expect(isSessionExpired(new DOMException("Aborted", "AbortError"))).toBe(
      false,
    );
  });
  it("deduplicates per QueryClient without navigating and can reset after login", () => {
    const first = new QueryClient();
    const before = window.location.href;
    expect(
      notifySessionExpired(first, new ApiError("http", { status: 401 })),
    ).toBe(true);
    notifySessionExpired(first, { ok: false, code: "UNAUTHENTICATED" });
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      SESSION_EXPIRED_MESSAGE,
      expect.objectContaining({
        id: "session-expired",
        duration: Infinity,
        action: { label: "로그인하기", onClick: expect.any(Function) },
      }),
    );
    expect(window.location.href).toBe(before);
    resetSessionExpiredNotice(first);
    expect(mocks.dismiss).toHaveBeenCalledWith("session-expired");
    notifySessionExpired(first, new ApiError("http", { status: 401 }));
    notifySessionExpired(
      new QueryClient(),
      new ApiError("http", { status: 401 }),
    );
    expect(mocks.error).toHaveBeenCalledTimes(3);
  });
  it("keeps the safe return URL and separate operator login", () => {
    expect(sessionLoginHref("/bookings", "?view=calendar&day=2030-01-01")).toBe(
      "/login?next=%2Fbookings%3Fview%3Dcalendar%26day%3D2030-01-01",
    );
    expect(sessionLoginHref("/admin/branches/a", "")).toBe("/admin/login");
    expect(sessionLoginHref("//evil.test", "")).toBe("/login?next=%2F");
    expect(sessionLoginHref("/api/auth", "")).toBe("/login?next=%2F");
  });
});

function Draft() {
  const client = useQueryClient();
  const [value, setValue] = useState("");
  const mutation = useMutation({
    mutationFn: async () => ({ ok: false, code: "UNAUTHENTICATED" }),
  });
  return (
    <>
      <input
        aria-label="작성 중인 제목"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button
        onClick={() => {
          void client
            .fetchQuery({
              queryKey: ["expired"],
              retry: false,
              queryFn: async () => {
                throw new ApiError("http", { status: 401 });
              },
            })
            .catch(() => {});
        }}
      >
        조회
      </button>
      <button onClick={() => mutation.mutate()}>저장</button>
    </>
  );
}

describe("query and action authentication feedback", () => {
  it("uses the same actionable notice for realtime token HTTP401", async () => {
    const client = makeQueryClient();
    const fetch = vi.fn(async () => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <RealtimeProvider>
          <RealtimeSession userId="user-a" />
          <input aria-label="token draft" defaultValue="그대로 유지" />
        </RealtimeProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
    expect(mocks.error).toHaveBeenCalledWith(
      SESSION_EXPIRED_MESSAGE,
      expect.objectContaining({
        action: expect.objectContaining({ label: "로그인하기" }),
      }),
    );
    expect(screen.getByLabelText("token draft")).toHaveValue("그대로 유지");
    expect(fetch).toHaveBeenCalledOnce();
    unmount();
    client.clear();
  });
  it("ignores pre-login query and action failures, including local handlers", async () => {
    const client = makeQueryClient();
    let failQuery!: (error: Error) => void;
    let finishAction!: (result: { ok: false; code: string }) => void;
    const query = client
      .fetchQuery({
        queryKey: ["late-auth"],
        retry: false,
        queryFn: () =>
          new Promise<never>((_resolve, reject) => (failQuery = reject)),
      })
      .catch((error: unknown) => notifySessionExpired(client, error));
    const action = client
      .getMutationCache()
      .build(client, {
        mutationFn: () =>
          new Promise<{ ok: false; code: string }>(
            (resolve) => (finishAction = resolve),
          ),
      })
      .execute(undefined)
      .then((result) => notifySessionExpired(client, result));
    await waitFor(() => expect(finishAction).toBeTypeOf("function"));
    resetSessionExpiredNotice(client);
    failQuery(new ApiError("http", { status: 401 }));
    finishAction({ ok: false, code: "UNAUTHENTICATED" });
    await Promise.all([query, action]);
    expect(mocks.error).not.toHaveBeenCalled();
    await client
      .fetchQuery({
        queryKey: ["late-auth"],
        retry: false,
        queryFn: async () => {
          throw new ApiError("http", { status: 401 });
        },
      })
      .catch(() => {});
    expect(mocks.error).toHaveBeenCalledOnce();
    client.clear();
  });
  it("keeps draft DOM/input when query and action failures arrive together", async () => {
    const client = makeQueryClient();
    render(
      <QueryClientProvider client={client}>
        <Draft />
      </QueryClientProvider>,
    );
    const input = screen.getByLabelText("작성 중인 제목");
    fireEvent.change(input, { target: { value: "진행 중인 예약" } });
    fireEvent.click(screen.getByText("조회"));
    fireEvent.click(screen.getByText("저장"));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("작성 중인 제목")).toBe(input);
    expect(input).toHaveValue("진행 중인 예약");
    client.clear();
  });
  it("does not toast for background network errors or aborted requests", async () => {
    const client = makeQueryClient();
    for (const error of [
      new ApiError("network"),
      new ApiError("timeout"),
      new DOMException("Aborted", "AbortError"),
    ]) {
      await client
        .fetchQuery({
          queryKey: [error.name, error.message],
          retry: false,
          queryFn: async () => {
            throw error;
          },
        })
        .catch(() => {});
    }
    expect(mocks.error).not.toHaveBeenCalled();
    client.clear();
  });
  it("does not retry session expiry through default Query options", async () => {
    const client = makeQueryClient();
    const request = vi.fn(async () => {
      throw new ApiError("http", { status: 401 });
    });
    await expect(
      client.fetchQuery({ queryKey: ["default-auth"], queryFn: request }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(request).toHaveBeenCalledOnce();
    client.clear();
  });
  it("clears the notice only after a successful login", async () => {
    const client = makeQueryClient();
    notifySessionExpired(client, new ApiError("http", { status: 401 }));
    render(
      <QueryClientProvider client={client}>
        <LoginForm next="/teams" />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("이메일"), {
      target: { value: "test1@ai.com" },
    });
    fireEvent.change(screen.getByLabelText("비밀번호"), {
      target: { value: "qwer1234" },
    });
    mocks.login.mockResolvedValueOnce({
      error: { code: "INVALID_EMAIL_OR_PASSWORD" },
    });
    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "로그인" })).toBeEnabled(),
    );
    expect(mocks.dismiss).not.toHaveBeenCalled();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "로그인" })),
    );
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/teams"));
    expect(mocks.dismiss).toHaveBeenCalledWith("session-expired");
    client.clear();
  });
});
