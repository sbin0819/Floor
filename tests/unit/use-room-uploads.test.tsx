import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { useRoomUploads } from "@/features/chat/components/use-room-uploads";
import {
  createUploads,
  completeUploads,
  discardUploads,
} from "@/features/chat/upload-actions";
import { uploadFile, UploadHttpError } from "@/features/chat/upload-file";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/errors/messages";

vi.mock("@/features/chat/upload-actions", () => ({
  createUploads: vi.fn(),
  completeUploads: vi.fn(),
  discardUploads: vi.fn(),
}));
vi.mock("@/features/chat/upload-file", async (original) => ({
  ...(await original<typeof import("@/features/chat/upload-file")>()),
  uploadFile: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }));
const file = () => new File(["hello"], "자료.txt", { type: "text/plain" });
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.mocked(createUploads).mockImplementation(async () => ({
    ok: true,
    data: [
      {
        attachmentId: crypto.randomUUID(),
        uploadUrl: "/api/uploads/file",
        method: "PUT",
        headers: {},
      },
    ],
  }));
  vi.mocked(completeUploads).mockResolvedValue({ ok: true, data: [] });
  vi.mocked(discardUploads).mockResolvedValue({ ok: true, data: {} });
  vi.mocked(uploadFile).mockResolvedValue();
});
afterEach(() => vi.useRealTimers());
function setup() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    () => ({
      one: useRoomUploads("one", null),
      two: useRoomUploads("two", null),
    }),
    { wrapper },
  );
}

describe("manual room upload session failure", () => {
  it.each(["reservation", "upload", "completion"] as const)(
    "deduplicates %s failures across room controllers with one QueryClient",
    async (phase) => {
      if (phase === "reservation")
        vi.mocked(createUploads).mockResolvedValue({
          ok: false,
          code: "UNAUTHENTICATED",
        });
      else if (phase === "upload")
        vi.mocked(uploadFile).mockRejectedValue(new UploadHttpError(401));
      else
        vi.mocked(completeUploads).mockResolvedValue({
          ok: false,
          code: "UNAUTHENTICATED",
        });
      const { result, unmount } = setup();
      await act(async () => {
        result.current.one.add([file()]);
        result.current.two.add([file()]);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(toast.error).toHaveBeenCalledWith(
        SESSION_EXPIRED_MESSAGE,
        expect.objectContaining({
          id: "session-expired",
          action: expect.objectContaining({ label: "로그인하기" }),
        }),
      );
      for (const controller of [result.current.one, result.current.two]) {
        expect(controller.getSnapshot()[0]).toMatchObject({
          status: "failed",
          name: "자료.txt",
          error: SESSION_EXPIRED_MESSAGE,
        });
      }
      unmount();
    },
  );
  it("ignores expired reservation responses after leaving the room", async () => {
    let finish!: (value: Awaited<ReturnType<typeof createUploads>>) => void;
    vi.mocked(createUploads).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { result, unmount } = setup();
    await act(async () => {
      result.current.one.add([file()]);
    });
    unmount();
    await act(async () => {
      finish({ ok: false, code: "UNAUTHENTICATED" });
    });
    expect(toast.error).not.toHaveBeenCalled();
  });
});
