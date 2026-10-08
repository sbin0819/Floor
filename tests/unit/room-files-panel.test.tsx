import { useRef, useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RoomFilesPanel } from "@/features/chat/components/room-files-panel";
import type { ReadRoomFiles } from "@/features/chat/file-client";
import type { RoomFile, RoomFilesPage } from "@/features/chat/file-types";

const mocks = vi.hoisted(() => ({ read: vi.fn<ReadRoomFiles>() }));
vi.mock("@/features/chat/file-client", async (original) => ({
  ...(await original<typeof import("@/features/chat/file-client")>()),
  fetchRoomFiles: mocks.read,
}));

const roomA = "10000000-0000-4000-8000-000000000001";
const roomB = "10000000-0000-4000-8000-000000000002";
const entry: RoomFile = {
  id: "20000000-0000-4000-8000-000000000001",
  name: "회의 자료.pdf",
  kind: "file",
  width: null,
  height: null,
  size: 1024,
  uploaderName: "김하은",
  sentAt: "2026-10-08T03:00:00.000Z",
  messageId: "30000000-0000-4000-8000-000000000001",
  seq: 12,
};
const page = (...files: RoomFile[]): RoomFilesPage => ({
  files,
  hasMore: false,
  nextCursor: null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.read.mockReset().mockResolvedValue(page(entry));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

function Harness({
  wide,
  roomId,
  onJump,
  initialOpen,
}: {
  wide: boolean;
  roomId: string;
  onJump: (seq: number, messageId: string) => void;
  initialOpen: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const target = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button ref={trigger} onClick={() => setOpen(true)}>
        파일 열기
      </button>
      <button ref={target}>대상 메시지</button>
      <RoomFilesPanel
        roomId={roomId}
        filesEnabled
        wide={wide}
        open={open}
        id="room-files"
        trigger={trigger}
        onOpenChange={setOpen}
        onJump={(seq, messageId) => {
          onJump(seq, messageId);
          queueMicrotask(() => target.current?.focus());
        }}
      />
    </>
  );
}
function show({ wide = false, initialOpen = false } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const onJump = vi.fn();
  const tree = (width: boolean, roomId: string) => (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <Harness
          wide={width}
          roomId={roomId}
          initialOpen={initialOpen}
          onJump={onJump}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
  const result = render(tree(wide, roomA));
  return {
    ...result,
    onJump,
    change: (width: boolean, roomId = roomA) =>
      result.rerender(tree(width, roomId)),
  };
}

describe("responsive room files container", () => {
  it.each([true, false])(
    "does not fetch or render files while closed (wide=%s)",
    async (wide) => {
      show({ wide });
      await act(async () => {});
      expect(mocks.read).not.toHaveBeenCalled();
      expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    },
  );

  it("opens a fixed-width desktop aside and returns focus to its trigger when closed", async () => {
    show({ wide: true });
    const trigger = screen.getByRole("button", { name: "파일 열기" });
    await userEvent.click(trigger);
    const panel = screen.getByRole("complementary", { name: "파일" });
    expect(panel).toHaveClass("w-80", "shrink-0");
    expect(panel).toHaveAttribute("id", "room-files");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await within(panel).findByText(entry.name)).toBeInTheDocument();
    await userEvent.click(
      within(panel).getByRole("button", { name: "파일 목록 닫기" }),
    );
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it.each(["button", "escape"] as const)(
    "opens a bottom sheet and restores trigger focus through %s",
    async (method) => {
      show();
      const trigger = screen.getByRole("button", { name: "파일 열기" });
      await userEvent.click(trigger);
      const dialog = screen.getByRole("dialog", { name: "파일" });
      expect(dialog).toHaveAttribute("data-side", "bottom");
      expect(dialog).toHaveClass("h-[min(80dvh,48rem)]");
      expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
      await within(dialog).findByText(entry.name);
      if (method === "escape") await userEvent.keyboard("{Escape}");
      else
        await userEvent.click(
          within(dialog).getByRole("button", { name: "파일 목록 닫기" }),
        );
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(trigger).toHaveFocus();
    },
  );

  it.each([true, false])(
    "does not steal message-jump focus for wide=%s",
    async (wide) => {
      const { onJump } = show({ wide });
      const trigger = screen.getByRole("button", { name: "파일 열기" });
      const target = screen.getByRole("button", { name: "대상 메시지" });
      await userEvent.click(trigger);
      const focus = vi.spyOn(trigger, "focus");
      await userEvent.click(
        await screen.findByRole("button", {
          name: `${entry.name} 메시지로 가기`,
        }),
      );
      await waitFor(() => expect(target).toHaveFocus());
      expect(focus).not.toHaveBeenCalled();
      expect(onJump).toHaveBeenCalledExactlyOnceWith(
        entry.seq,
        entry.messageId,
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
      focus.mockRestore();
    },
  );

  it("preserves one dialog and its filter DOM while data finishes loading", async () => {
    const pending = deferred<RoomFilesPage>();
    mocks.read.mockReturnValue(pending.promise);
    show();
    await userEvent.click(screen.getByRole("button", { name: "파일 열기" }));
    const dialog = screen.getByRole("dialog", { name: "파일" });
    const radio = within(dialog).getByRole("radio", { name: "전체" });
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "파일을 불러오고 있어요",
    );
    expect(within(dialog).queryByText("아직 올라온 파일이 없어요")).toBeNull();
    await act(async () => pending.resolve(page(entry)));
    await within(dialog).findByText(entry.name);
    expect(screen.getAllByRole("dialog")).toEqual([dialog]);
    expect(screen.getByRole("radio", { name: "전체" })).toBe(radio);
    expect(dialog).toHaveAttribute("data-state", "open");
  });

  it("does not expose an old room's response and keeps a single panel across resize", async () => {
    const old = deferred<RoomFilesPage>();
    const other = { ...entry, name: "다른 방 자료.pdf" };
    mocks.read.mockImplementation((roomId) =>
      roomId === roomA ? old.promise : Promise.resolve(page(other)),
    );
    const view = show({ wide: true, initialOpen: true });
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    const signal = mocks.read.mock.calls[0]![1].signal!;
    view.change(true, roomB);
    await screen.findByText(other.name);
    expect(signal.aborted).toBe(true);
    await act(async () => old.resolve(page(entry)));
    expect(screen.queryByText(entry.name)).not.toBeInTheDocument();
    view.change(false, roomB);
    expect(screen.getAllByRole("dialog", { name: "파일" })).toHaveLength(1);
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(await screen.findAllByRole("radiogroup")).toHaveLength(1);
    expect(await screen.findAllByText(other.name)).toHaveLength(1);
    view.change(true, roomB);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getAllByRole("complementary")).toHaveLength(1);
    expect(await screen.findAllByRole("radiogroup")).toHaveLength(1);
    expect(await screen.findAllByText(other.name)).toHaveLength(1);
  });
});
