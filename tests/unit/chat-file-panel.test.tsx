import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FilePanel } from "@/features/chat/components/file-panel";
import { roomFilesKey, type ReadRoomFiles } from "@/features/chat/file-client";
import type { RoomFile, RoomFilesPage } from "@/features/chat/file-types";

const roomId = "10000000-0000-4000-8000-000000000001";
beforeEach(() => {
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

function file(index: number, image = false): RoomFile {
  return {
    id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    name: image ? `사진 ${index}.jpg` : `자료 ${index}.pdf`,
    size: 2457600,
    kind: image ? "image" : "file",
    width: image ? 640 : null,
    height: image ? 480 : null,
    uploaderName: "김하은",
    sentAt: "2026-10-08T15:30:00.000Z",
    messageId: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    seq: 100 - index,
  };
}
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
function show(
  readFiles: ReadRoomFiles,
  options: {
    filesEnabled?: boolean;
    onJump?: (seq: number, messageId: string) => void;
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const onJump = options.onJump ?? vi.fn();
  const view = (id = roomId) => (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <FilePanel
          roomId={id}
          filesEnabled={options.filesEnabled ?? true}
          onJump={onJump}
          readFiles={readFiles}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
  const rendered = render(view());
  return {
    ...rendered,
    client,
    onJump,
    move: (id: string) => rendered.rerender(view(id)),
  };
}

describe("room file panel", () => {
  it("shows usable filters before data and never calls loading an empty list", async () => {
    const pending = deferred<RoomFilesPage>();
    const read = vi.fn<ReadRoomFiles>().mockReturnValue(pending.promise);
    show(read);
    expect(
      screen.getByRole("radiogroup", { name: "파일 종류" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "전체" })).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent(
      "파일을 불러오고 있어요",
    );
    expect(
      screen.queryByText("아직 올라온 파일이 없어요"),
    ).not.toBeInTheDocument();
    await act(async () => pending.resolve(page()));
    expect(
      await screen.findByText("아직 올라온 파일이 없어요"),
    ).toBeInTheDocument();
  });

  it("renders Korean local sent dates, sizes, a download row and message navigation", async () => {
    const entry = file(1);
    const read = vi.fn<ReadRoomFiles>().mockResolvedValue(page(entry));
    const { onJump } = show(read);
    const link = await screen.findByRole("link", {
      name: "자료 1.pdf 내려받기",
    });
    expect(link).toHaveAttribute("href", `/api/files/${entry.id}?download=1`);
    expect(link).toHaveAttribute("download");
    expect(link).toHaveTextContent("김하은");
    expect(link).toHaveTextContent("10월 9일");
    expect(link).toHaveTextContent("2.3MB");
    await userEvent.click(
      screen.getByRole("button", { name: "자료 1.pdf 메시지로 가기" }),
    );
    expect(onJump).toHaveBeenCalledExactlyOnceWith(entry.seq, entry.messageId);
  });

  it("loads filter-specific pages, aborts the previous request and ignores a late old result", async () => {
    const old = deferred<RoomFilesPage>();
    const read = vi
      .fn<ReadRoomFiles>()
      .mockImplementation((_roomId, { kind }) =>
        kind === "all" ? old.promise : Promise.resolve(page(file(2, true))),
      );
    show(read);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const oldSignal = read.mock.calls[0]![1].signal!;
    await userEvent.click(screen.getByRole("radio", { name: "이미지" }));
    expect(
      await screen.findByRole("button", { name: "사진 2.jpg 크게 보기" }),
    ).toBeInTheDocument();
    expect(oldSignal.aborted).toBe(true);
    await act(async () => old.resolve(page(file(1))));
    expect(
      screen.queryByRole("link", { name: "자료 1.pdf 내려받기" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "이미지" })).toBeChecked();
  });

  it("fetches older files using the returned composite cursor only once per pending click", async () => {
    const more = deferred<RoomFilesPage>();
    const read = vi.fn<ReadRoomFiles>().mockImplementation((_room, query) =>
      query.before
        ? more.promise
        : Promise.resolve({
            files: Array.from({ length: 30 }, (_, index) => file(index + 1)),
            hasMore: true,
            nextCursor: "70_0",
          }),
    );
    show(read);
    await screen.findByRole("button", { name: "더 보기" });
    await userEvent.dblClick(screen.getByRole("button", { name: "더 보기" }));
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[1]![1]).toMatchObject({
      kind: "all",
      before: "70_0",
    });
    expect(
      screen.getByRole("button", { name: "불러오는 중이에요" }),
    ).toBeDisabled();
    await act(async () => more.resolve(page(file(31))));
    expect(
      await screen.findByRole("link", { name: "자료 31.pdf 내려받기" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(31);
    expect(
      screen.queryByRole("button", { name: "더 보기" }),
    ).not.toBeInTheDocument();
  });

  it("keeps loaded rows when another page fails and retries without displaying server details", async () => {
    const read = vi
      .fn<ReadRoomFiles>()
      .mockResolvedValueOnce({
        files: [file(1)],
        hasMore: true,
        nextCursor: "99_0",
      })
      .mockRejectedValueOnce(new Error("private-storage-path"))
      .mockResolvedValueOnce(page(file(2)));
    show(read);
    await userEvent.click(
      await screen.findByRole("button", { name: "더 보기" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "다음 파일을 불러오지 못했어요",
    );
    expect(
      screen.getByRole("link", { name: "자료 1.pdf 내려받기" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/private-storage-path/u)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "더 보기" }));
    expect(
      await screen.findByRole("link", { name: "자료 2.pdf 내려받기" }),
    ).toBeInTheDocument();
  });

  it("keeps existing inputs, rows and focus during a background refresh", async () => {
    const update = deferred<RoomFilesPage>();
    const read = vi
      .fn<ReadRoomFiles>()
      .mockResolvedValueOnce(page(file(1)))
      .mockReturnValueOnce(update.promise);
    const { client } = show(read);
    const link = await screen.findByRole("link", {
      name: "자료 1.pdf 내려받기",
    });
    link.focus();
    await act(async () => {
      void client.invalidateQueries({ queryKey: roomFilesKey(roomId) });
    });
    expect(screen.getByRole("link", { name: "자료 1.pdf 내려받기" })).toBe(
      link,
    );
    expect(link).toHaveFocus();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await act(async () => update.resolve(page(file(1), file(2))));
    expect(
      await screen.findByRole("link", { name: "자료 2.pdf 내려받기" }),
    ).toBeInTheDocument();
    expect(link).toHaveFocus();
  });

  it("opens image originals, navigates only this message's images and returns focus on Escape", async () => {
    const first = file(1, true);
    const next = {
      ...file(2, true),
      messageId: first.messageId,
      seq: first.seq,
    };
    const unrelated = file(3, true);
    const read = vi
      .fn<ReadRoomFiles>()
      .mockResolvedValue(page(next, first, unrelated));
    show(read);
    const trigger = await screen.findByRole("button", {
      name: "사진 1.jpg 크게 보기",
    });
    expect(within(trigger).getByRole("img")).toHaveAttribute("loading", "lazy");
    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: first.name }),
    ).toBeInTheDocument();
    await userEvent.keyboard("{ArrowRight}");
    expect(
      within(dialog).getByRole("heading", { name: next.name }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/2\/2/u)).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("still reads files when storage is disabled but exposes no image or download request", async () => {
    const read = vi
      .fn<ReadRoomFiles>()
      .mockResolvedValue(page(file(1), file(2, true)));
    const { onJump } = show(read, { filesEnabled: false });
    expect(await screen.findAllByText("지금은 받을 수 없어요")).toHaveLength(2);
    expect(read).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /크게 보기/u }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "사진 2.jpg 메시지로 가기" }),
    );
    expect(onJump).toHaveBeenCalledExactlyOnceWith(98, file(2).messageId);
  });

  it("resets filters and gallery when changing rooms and does not show the previous room response", async () => {
    const late = deferred<RoomFilesPage>();
    const otherRoom = "10000000-0000-4000-8000-000000000002";
    const read = vi
      .fn<ReadRoomFiles>()
      .mockImplementation((id) =>
        id === roomId ? late.promise : Promise.resolve(page(file(2))),
      );
    const rendered = show(read);
    fireEvent.click(screen.getByRole("radio", { name: "이미지" }));
    rendered.move(otherRoom);
    expect(
      await screen.findByRole("link", { name: "자료 2.pdf 내려받기" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "전체" })).toBeChecked();
    await act(async () => late.resolve(page(file(1, true))));
    expect(
      screen.queryByRole("button", { name: "사진 1.jpg 크게 보기" }),
    ).not.toBeInTheDocument();
  });

  it("does not show an empty-state message on an initial read failure and permits retry", async () => {
    const read = vi
      .fn<ReadRoomFiles>()
      .mockRejectedValueOnce(new Error("private body"))
      .mockResolvedValueOnce(page());
    show(read);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "파일을 불러오지 못했어요",
    );
    expect(
      screen.queryByText("아직 올라온 파일이 없어요"),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "다시 불러오기" }),
    );
    expect(
      await screen.findByText("아직 올라온 파일이 없어요"),
    ).toBeInTheDocument();
  });
});
