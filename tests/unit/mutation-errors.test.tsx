import { useState, type ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
  MutationCache,
} from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/actions/result";
import { ApiError } from "@/lib/http/errors";
import { errorMessage, SESSION_EXPIRED_MESSAGE } from "@/lib/errors/messages";
import { notifySessionExpired } from "@/lib/errors/session-expired";
import { useAdminMutation } from "@/features/admin/components/use-admin-mutation";
import { useBookingMutation } from "@/features/bookings/components/use-booking-mutation";
import { useTeamMutation } from "@/features/teams/components/use-team-mutation";
import { usePeopleMutation } from "@/features/people/components/people-mutation";
import { useSpaceMutation } from "@/features/chat/components/use-space-mutation";

const router = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() },
}));

type Action = (input: unknown) => Promise<ActionResult<object>>;
const input = { title: "입력 유지" };
const schema = z.object({ title: z.string() });
const adapters = [
  {
    name: "admin",
    inline: true,
    useAdapter(action: Action) {
      const mutation = useAdminMutation({ action });
      return {
        submit: () => mutation.submit(schema, input),
        message: mutation.message,
      };
    },
  },
  {
    name: "booking",
    inline: true,
    useAdapter(action: Action) {
      const mutation = useBookingMutation({
        action,
        successMessage: "저장했어요",
      });
      return {
        submit: () => mutation.submit(input),
        message: mutation.message,
      };
    },
  },
  {
    name: "team",
    inline: true,
    useAdapter(action: Action) {
      const mutation = useTeamMutation({
        action,
        successMessage: "저장했어요",
      });
      return {
        submit: () => mutation.submit(input),
        message: mutation.message,
      };
    },
  },
  {
    name: "people",
    inline: false,
    useAdapter(action: Action) {
      const mutation = usePeopleMutation(action);
      return { submit: () => mutation.run(input, "저장했어요"), message: "" };
    },
  },
  {
    name: "space",
    inline: true,
    useAdapter(action: Action) {
      const mutation = useSpaceMutation(action);
      return { submit: () => mutation.submit(input), message: mutation.error };
    },
  },
];
function setup() {
  const client = new QueryClient({
    mutationCache: new MutationCache({
      onError: (error) => {
        notifySessionExpired(client, error);
      },
      onSuccess: (result) => {
        notifySessionExpired(client, result);
      },
    }),
    defaultOptions: { mutations: { retry: false } },
  });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}
beforeEach(() => vi.clearAllMocks());

describe.each(adapters)("$name mutation common failures", (adapter) => {
  it.each(["result", "http"] as const)(
    "deduplicates %s expiry and keeps input without navigating",
    async (source) => {
      const action = vi.fn<Action>();
      if (source === "result")
        action.mockResolvedValue({ ok: false, code: "UNAUTHENTICATED" });
      else action.mockRejectedValue(new ApiError("http", { status: 401 }));
      const { wrapper } = setup();
      function Form() {
        const mutation = adapter.useAdapter(action);
        const [title, setTitle] = useState("입력 유지");
        return (
          <>
            <input
              aria-label="제목"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <button onClick={() => void mutation.submit()}>저장</button>
            <p role="status">{mutation.message}</p>
          </>
        );
      }
      render(<Form />, { wrapper });
      fireEvent.change(screen.getByLabelText("제목"), {
        target: { value: "아직 저장하지 않은 제목" },
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        await act(async () =>
          fireEvent.click(screen.getByRole("button", { name: "저장" })),
        );
        await waitFor(() => expect(action).toHaveBeenCalledTimes(attempt + 1));
      }
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(toast.error).toHaveBeenCalledWith(
        SESSION_EXPIRED_MESSAGE,
        expect.objectContaining({
          id: "session-expired",
          action: expect.objectContaining({ label: "로그인하기" }),
        }),
      );
      if (adapter.inline)
        expect(screen.getByRole("status")).toHaveTextContent(
          SESSION_EXPIRED_MESSAGE,
        );
      expect(screen.getByLabelText("제목")).toHaveValue(
        "아직 저장하지 않은 제목",
      );
      expect(router.push).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
      expect(router.refresh).not.toHaveBeenCalled();
    },
  );

  it.each(["timeout", "network"] as const)(
    "uses the shared %s message",
    async (kind) => {
      const error = new ApiError(kind);
      const action = vi.fn<Action>().mockRejectedValue(error);
      const { wrapper } = setup();
      const { result } = renderHook(() => adapter.useAdapter(action), {
        wrapper,
      });
      await act(async () => {
        await result.current.submit();
      });
      if (adapter.inline)
        expect(result.current.message).toBe(errorMessage(error));
      if (adapter.name === "space") expect(toast.error).not.toHaveBeenCalled();
      else
        expect(toast.error).toHaveBeenCalledExactlyOnceWith(
          errorMessage(error),
        );
      expect(router.refresh).not.toHaveBeenCalled();
    },
  );

  it("silences abort and releases its lock for the next submission", async () => {
    const action = vi
      .fn<Action>()
      .mockRejectedValueOnce(new DOMException("Aborted", "AbortError"))
      .mockResolvedValueOnce({ ok: true, data: {} });
    const { wrapper } = setup();
    const { result } = renderHook(() => adapter.useAdapter(action), {
      wrapper,
    });
    await act(async () => {
      await result.current.submit();
    });
    expect(result.current.message).toBe("");
    expect(toast.error).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.submit();
    });
    expect(action).toHaveBeenCalledTimes(2);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});

it("keeps booking field errors and conflict refresh behavior", async () => {
  const action = vi.fn<Action>().mockResolvedValue({
    ok: false,
    code: "BOOKING_CONFLICT",
    fieldErrors: { start: ["시간을 다시 골라 주세요"] },
  });
  const { wrapper } = setup();
  const { result } = renderHook(
    () => useBookingMutation({ action, successMessage: "저장했어요" }),
    { wrapper },
  );
  await act(async () => {
    await result.current.submit(input);
  });
  expect(result.current.fieldErrors).toEqual({
    start: ["시간을 다시 골라 주세요"],
  });
  expect(result.current.message).toBe(
    "방금 다른 예약이 들어왔어요. 시간을 다시 골라 주세요",
  );
  expect(router.refresh).toHaveBeenCalledTimes(1);
});
