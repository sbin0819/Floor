import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MessageAttachments,
  FileCard,
} from "@/features/chat/components/message-attachments";
import { AttachmentStrip } from "@/features/chat/components/attachment-strip";
import { MessageComposer } from "@/features/chat/components/message-composer";
import { UploadDropArea } from "@/features/chat/components/upload-drop-area";
import { MessageRow } from "@/features/chat/components/message-row";
import {
  createUploadController,
  uploadErrors,
  type UploadActions,
} from "@/features/chat/upload-controller";
import type { UploadFile } from "@/features/chat/upload-file";
import {
  emptyMessageDetails,
  type ChatAttachment,
} from "@/features/chat/types";
import { fileIconKind, formatFileSize } from "@/features/chat/file-format";

const image: ChatAttachment = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "리뷰 사진.png",
  size: 1024,
  kind: "image",
  width: 800,
  height: 600,
};
const second: ChatAttachment = {
  ...image,
  id: "00000000-0000-4000-8000-000000000002",
  name: "긴 사진.jpg",
  width: 100,
  height: 10000,
};
const document: ChatAttachment = {
  ...image,
  id: "00000000-0000-4000-8000-000000000003",
  name: "리뷰 자료.pdf",
  kind: "file",
  width: null,
  height: null,
};
const controllers: ReturnType<typeof createUploadController>[] = [];
beforeEach(() =>
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
);
afterEach(() => {
  controllers.splice(0).forEach((value) => value.dispose());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function uploads(
  upload: UploadFile = async (_url, _file, options) => {
    options.onProgress(70);
  },
) {
  const actions = {
    create: vi.fn<UploadActions["create"]>().mockResolvedValue({
      ok: true,
      data: [
        {
          attachmentId: image.id,
          uploadUrl: "/upload",
          method: "PUT",
          headers: {},
        },
      ],
    }),
    complete: vi.fn<UploadActions["complete"]>().mockResolvedValue({
      ok: true,
      data: [
        {
          attachmentId: image.id,
          ok: true,
          name: image.name,
          size: image.size,
          kind: image.kind,
          width: image.width,
          height: image.height,
        },
      ],
    }),
    discard: vi
      .fn<UploadActions["discard"]>()
      .mockResolvedValue({ ok: true, data: {} }),
  };
  const notify = vi.fn();
  const controller = createUploadController({
    roomId: "room",
    actions,
    upload,
    notify,
    objectUrls: { create: () => "blob:preview", revoke: vi.fn() },
  });
  controllers.push(controller);
  return { controller, actions, notify };
}

describe("message attachments", () => {
  it.each([false, true])(
    "uses the protected attachment URL for temporary messages and hides deleted attachments: deleted=%s",
    (deleted) => {
      render(
        <MessageRow
          message={{
            ...emptyMessageDetails(),
            id: "temporary",
            clientId: "draft",
            seq: 0,
            authorId: null,
            authorName: null,
            body: "",
            kind: "text",
            createdAt: "2026-10-08T01:00:00Z",
            delivery: "pending",
            attachments: [image],
            deletedAt: deleted ? "2026-10-08T01:01:00Z" : null,
          }}
          grouped
          dateDivider={false}
          unread={false}
          now="2026-10-08T01:00:00Z"
          onRetry={vi.fn()}
          onRemove={vi.fn()}
          actions={{
            userId: "me",
            canWrite: true,
            canReact: true,
            filesEnabled: true,
            admin: false,
            names: new Map(),
            react: async () => true,
            onDelete: vi.fn(),
          }}
        />,
      );
      if (deleted) expect(screen.queryByRole("img")).not.toBeInTheDocument();
      else
        expect(screen.getByRole("img")).toHaveAttribute(
          "src",
          `/api/files/${image.id}`,
        );
    },
  );
  it("reserves the single image dimensions, caps both axes and bypasses authenticated image optimization", () => {
    render(<MessageAttachments attachments={[second]} />);
    const button = screen.getByRole("button", {
      name: `${second.name} 크게 보기`,
    });
    expect(button).toHaveStyle({
      aspectRatio: "100/10000",
      width: "100px",
      maxHeight: "360px",
    });
    expect(button).toHaveClass("max-w-full");
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("src", `/api/files/${second.id}`);
    expect(img).not.toHaveAttribute("srcset");
  });
  it("lays multiple images in square two-column slots and returns focus after gallery keyboard navigation", async () => {
    const user = userEvent.setup();
    render(<MessageAttachments attachments={[image, second]} />);
    const first = screen.getByRole("button", {
      name: `${image.name} 크게 보기`,
    });
    expect(first).toHaveClass("aspect-square", "w-42.5");
    expect(first.parentElement).toHaveClass("grid-cols-2");
    await user.click(first);
    expect(screen.getByRole("dialog")).toHaveAccessibleName(image.name);
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("dialog")).toHaveAccessibleName(second.name);
    expect(
      within(screen.getByRole("dialog")).getByRole("link", {
        name: "내려받기",
      }),
    ).toHaveAttribute("href", `/api/files/${second.id}?download=1`);
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("dialog")).toHaveAccessibleName(image.name);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(first).toHaveFocus();
  });
  it("shows downloadable cards, extension icons and meaningful sizes", async () => {
    const user = userEvent.setup();
    render(<FileCard attachment={document} />);
    await user.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(document.name);
    await user.keyboard("{Escape}");
    expect(
      screen.getByRole("link", { name: `${document.name} 내려받기` }),
    ).toHaveAttribute("download");
    expect(formatFileSize(830 * 1024)).toBe("830KB");
    expect(formatFileSize(2.4 * 1024 * 1024)).toBe("2.4MB");
    expect(
      ["a.pdf", "b.csv", "c.pptx", "d.zip", "e.bin"].map(fileIconKind),
    ).toEqual(["document", "spreadsheet", "presentation", "archive", "file"]);
  });
  it("uses safe unavailable cards instead of images or download links when storage is disabled", () => {
    render(
      <MessageAttachments attachments={[image, document]} enabled={false} />,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getAllByText("지금은 받을 수 없어요")).toHaveLength(2);
  });
  it("uses injected image URLs only when explicitly supplied for offline stories", () => {
    render(
      <MessageAttachments
        attachments={[image]}
        fileUrl={() => "/seed/photos/meeting-small-oak.webp"}
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/seed/photos/meeting-small-oak.webp",
    );
  });
  it("shows progress, failed retry and remove controls with file-specific accessible names", async () => {
    const onRemove = vi.fn();
    const onRetry = vi.fn();
    const user = userEvent.setup();
    const base = {
      id: "one",
      file: new File(["a"], "a.txt"),
      name: "a.txt",
      size: 1,
      progress: 30,
      previewUrl: null,
    };
    render(
      <AttachmentStrip
        items={[
          { ...base, status: "uploading" },
          {
            ...base,
            id: "two",
            name: "b.txt",
            status: "failed",
            error: uploadErrors.failed,
          },
        ]}
        onRemove={onRemove}
        onRetry={onRetry}
      />,
    );
    expect(
      screen.getByRole("progressbar", { name: "a.txt 올리는 중" }),
    ).toHaveAttribute("aria-valuenow", "30");
    await user.click(screen.getByRole("button", { name: "다시 올리기" }));
    expect(onRetry).toHaveBeenCalledWith("two");
    await user.click(screen.getByRole("button", { name: "a.txt 빼기" }));
    expect(onRemove).toHaveBeenCalledWith("one");
  });
});

describe("composer uploads", () => {
  it("disables send during upload and permits an attachment-only message once complete", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const { controller } = uploads(async (_url, _file, options) => {
      options.onProgress(35);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const send = vi.fn();
    render(
      <MessageComposer
        channelName="일반"
        onSend={send}
        uploads={controller}
        uploadUnavailable={null}
      />,
    );
    const file = new File(["abc"], "사진.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("첨부 파일 선택"), {
        target: { files: [file] },
      });
    });
    expect(screen.getByRole("button", { name: "올리는 중…" })).toBeDisabled();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "35",
    );
    await act(async () => {
      finish();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByRole("button", { name: "보내기" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(send).toHaveBeenCalledExactlyOnceWith("", undefined, [image]);
    expect(
      screen.queryByRole("list", { name: "보낼 첨부 파일" }),
    ).not.toBeInTheDocument();
  });
  it("blocks file paste and drop when disabled while preserving ordinary text paste and drags", async () => {
    const { controller, notify, actions } = uploads();
    controller.setUnavailable(uploadErrors.disabled);
    const { container } = render(
      <UploadDropArea uploads={controller}>
        <MessageComposer
          channelName="일반"
          onSend={vi.fn()}
          uploads={controller}
        />
      </UploadDropArea>,
    );
    expect(
      screen.getByRole("button", { name: uploadErrors.disabled }),
    ).toBeDisabled();
    const input = screen.getByRole("combobox", { name: "메시지" });
    const plain = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(plain, "clipboardData", { value: { files: [] } });
    fireEvent(input, plain);
    expect(plain.defaultPrevented).toBe(false);
    const file = new File(["a"], "p.png", { type: "image/png" });
    fireEvent.paste(input, { clipboardData: { files: [file] } });
    const dropzone = container.firstElementChild!;
    fireEvent.dragEnter(dropzone, { dataTransfer: { types: ["text/plain"] } });
    expect(
      screen.queryByText("여기에 놓으면 올라가요"),
    ).not.toBeInTheDocument();
    fireEvent.dragEnter(dropzone, { dataTransfer: { types: ["Files"] } });
    expect(screen.getByText("여기에 놓으면 올라가요")).toBeInTheDocument();
    fireEvent.drop(dropzone, {
      dataTransfer: { types: ["Files"], files: [file] },
    });
    expect(
      screen.queryByText("여기에 놓으면 올라가요"),
    ).not.toBeInTheDocument();
    expect(notify).toHaveBeenCalledTimes(2);
    expect(actions.create).not.toHaveBeenCalled();
  });
});
