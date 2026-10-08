import { isValidElement, Suspense, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DirectPage from "@/app/(app)/dm/[roomId]/page";
import NewMessagePage from "@/app/(app)/messages/new/page";
import { requirePageSession } from "@/lib/auth/session";
import { getDirectMessageView } from "@/features/chat/queries";
import { getMessageContacts } from "@/features/people/queries";
import { resolvePageContent } from "./page-test-utils";
const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth/session", () => ({ requirePageSession: vi.fn() }));
vi.mock("@/features/chat/queries", () => ({ getDirectMessageView: vi.fn() }));
vi.mock("@/features/people/queries", () => ({ getMessageContacts: vi.fn() }));
vi.mock("@/features/chat/components/channel-screen", () => ({
  DirectMessageScreen: () => null,
}));
vi.mock("@/features/chat/components/message-contacts", () => ({
  MessageContacts: () => null,
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePageSession).mockResolvedValue({
    userId: "me",
    name: "나",
    email: "own@example.test",
  });
  vi.mocked(getMessageContacts).mockResolvedValue([]);
});
describe("direct messages page guards", () => {
  it.each(["invalid", "10000000-0000-4000-8000-000000000001"])(
    "returns the same not-found state for unavailable room %s",
    async (roomId) => {
      vi.mocked(getDirectMessageView).mockResolvedValue(null);
      const page = DirectPage({ params: Promise.resolve({ roomId }) });
      expect(page.type).toBe(Suspense);
      expect(requirePageSession).not.toHaveBeenCalled();
      await expect(resolvePageContent(page)).rejects.toThrow("NEXT_NOT_FOUND");
      expect(requirePageSession).toHaveBeenCalledExactlyOnceWith(
        `/dm/${roomId}`,
      );
      expect(getDirectMessageView).toHaveBeenCalledExactlyOnceWith(roomId);
    },
  );
  it("never reads a private room before the session guard passes", async () => {
    vi.mocked(requirePageSession).mockRejectedValue(new Error("LOGIN"));
    await expect(
      resolvePageContent(
        DirectPage({ params: Promise.resolve({ roomId: "private" }) }),
      ),
    ).rejects.toThrow("LOGIN");
    expect(getDirectMessageView).not.toHaveBeenCalled();
  });
  it("keeps the new-message title above the suspense-bound guarded contacts lookup", async () => {
    const page = NewMessagePage();
    const [heading, suspense] = page.props.children;
    expect(heading.props.title).toBe("새 메시지");
    expect(suspense.type).toBe(Suspense);
    expect(getMessageContacts).not.toHaveBeenCalled();
    const result = await resolvePageContent(suspense);
    expect(requirePageSession).toHaveBeenCalledExactlyOnceWith("/messages/new");
    expect(result.props.people).toEqual([]);
    expect(getMessageContacts).toHaveBeenCalledOnce();
    expect(isValidElement<ReactNode>(result)).toBe(true);
  });
});
