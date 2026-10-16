import { Activity } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { SpacePhotos } from "@/features/admin/components/space-photos";
import * as actions from "@/features/admin/photo-actions";
import { toWebp, WebpConversionError } from "@/features/uploads/to-webp";
import { uploadToR2 } from "@/features/uploads/upload-to-r2";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/actions/result";
import { ApiError } from "@/lib/http/errors";
import {
  adminPhotosFixture,
  photoPath,
  photoSpaceId,
} from "@/tests/helpers/space-photos";
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/features/admin/photo-actions", () => ({
  createSpacePhotoUpload: vi.fn(),
  confirmSpacePhotoUpload: vi.fn(),
  reorderSpacePhotos: vi.fn(),
  updateSpacePhotoAlt: vi.fn(),
  deleteSpacePhoto: vi.fn(),
}));
vi.mock("@/features/uploads/to-webp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/uploads/to-webp")>()),
  toWebp: vi.fn(),
}));
vi.mock("@/features/uploads/upload-to-r2", () => ({ uploadToR2: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const uploadId = "e3100000-0000-4000-8000-000000000099";
const blob = new Blob(["image"], { type: "image/webp" });
function deferred<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", `${photoPath}?tab=photos`);
  vi.mocked(actions.createSpacePhotoUpload).mockResolvedValue({
    ok: true,
    data: { uploadId, url: "https://fake.test/upload" },
  });
  vi.mocked(actions.confirmSpacePhotoUpload).mockResolvedValue({
    ok: true,
    data: { photoId: uploadId },
  });
  for (const action of [
    actions.reorderSpacePhotos,
    actions.updateSpacePhotoAlt,
    actions.deleteSpacePhoto,
  ])
    vi.mocked(action).mockResolvedValue({
      ok: true,
      data: { spaceId: photoSpaceId },
    });
  vi.mocked(toWebp).mockResolvedValue({ blob, width: 1200, height: 750 });
  vi.mocked(uploadToR2).mockResolvedValue();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
});
function mount(
  options: { count?: number; enabled?: boolean; canManage?: boolean } = {},
) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const photos = adminPhotosFixture(options.count ?? 3);
  const tree = (hidden = false) => (
    <QueryClientProvider client={client}>
      <Activity mode={hidden ? "hidden" : "visible"}>
        <SpacePhotos
          spaceId={photoSpaceId}
          path={photoPath}
          photos={photos}
          enabled={options.enabled ?? true}
          canManage={options.canManage ?? true}
        />
      </Activity>
    </QueryClientProvider>
  );
  const result = render(tree());
  return { ...result, photos, tree };
}
function ids() {
  return screen
    .getAllByRole("article")
    .map((el) => el.getAttribute("data-photo-id"));
}
async function choose() {
  fireEvent.change(screen.getByLabelText("사진 고르기"), {
    target: {
      files: [new File(["input"], "photo.png", { type: "image/png" })],
    },
  });
  await screen.findByRole("dialog", { name: "사진 설명" });
}
it.each([
  ["timeout", "응답이 늦어지고 있어요. 잠시 뒤 다시 시도해 주세요"],
  ["network", "연결을 확인한 뒤 다시 시도해 주세요"],
] as const)(
  "shows a safe %s message after upload failure",
  async (kind, message) => {
    vi.mocked(uploadToR2).mockRejectedValueOnce(new ApiError(kind));
    mount();
    await choose();
    fireEvent.change(screen.getByLabelText("설명"), {
      target: { value: "사진 설명" },
    });
    fireEvent.click(screen.getByRole("button", { name: "사진 올리기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(message);
    expect(actions.confirmSpacePhotoUpload).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(screen.getByLabelText("사진 고르기")).toBeEnabled();
  },
);
it("shows labelled images and first cover without inventing stored file sizes", () => {
  mount();
  expect(screen.getAllByRole("article")).toHaveLength(3);
  expect(screen.getByText("대표 사진")).toBeVisible();
  expect(screen.getByLabelText("사진 1 설명")).toHaveValue("공간 사진 1");
  expect(screen.queryByText(/312KB/)).not.toBeInTheDocument();
});
it("only disables upload with storage disabled, leaving reorder and delete usable", () => {
  mount({ enabled: false });
  expect(screen.getByText("이 환경에서는 파일을 올릴 수 없어요")).toBeVisible();
  expect(screen.queryByLabelText("사진 고르기")).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "대표로" })[0]).toBeEnabled();
  expect(screen.getByRole("button", { name: "사진 1 지우기" })).toBeEnabled();
});
it("keeps non-managers readonly including file drop", () => {
  mount({ canManage: false });
  expect(screen.getByLabelText("사진 고르기")).toBeDisabled();
  expect(screen.getByLabelText("사진 1 설명")).toBeDisabled();
  expect(screen.getAllByRole("button", { name: "대표로" })[0]).toBeDisabled();
});
it("shows honest empty and eight-photo capacity states", () => {
  const view = mount({ count: 0 });
  expect(screen.getByText("아직 사진이 없어요")).toBeVisible();
  view.unmount();
  mount({ count: 8 });
  expect(screen.getByLabelText("사진 고르기")).toBeDisabled();
  expect(screen.getByText("사진은 공간마다 8장까지예요")).toBeVisible();
});
it("optimistically reorders with Alt arrows, announces, and restores focus", async () => {
  const { photos } = mount();
  const pending = deferred<ActionResult<{ spaceId: string }>>();
  vi.mocked(actions.reorderSpacePhotos).mockReturnValueOnce(pending.promise);
  const row = screen.getAllByRole("article")[1]!;
  row.focus();
  fireEvent.keyDown(row, { key: "ArrowLeft", altKey: true });
  expect(ids()).toEqual([photos[1]!.id, photos[0]!.id, photos[2]!.id]);
  expect(screen.getByRole("status", { name: "사진 순서" })).toHaveTextContent(
    "사진 2, 3장 가운데 1번째로 옮겼어요",
  );
  await waitFor(() =>
    expect(actions.reorderSpacePhotos).toHaveBeenCalledWith({
      spaceId: photoSpaceId,
      photoIds: ids(),
    }),
  );
  await act(async () =>
    pending.resolve({ ok: true, data: { spaceId: photoSpaceId } }),
  );
  expect(row).toHaveFocus();
  expect(router.refresh).toHaveBeenCalledTimes(1);
});
it("rolls back failed order without removing other cards or sending duplicate writes", async () => {
  const { photos } = mount();
  const pending = deferred<ActionResult<{ spaceId: string }>>();
  vi.mocked(actions.reorderSpacePhotos).mockReturnValueOnce(pending.promise);
  const row = screen.getAllByRole("article")[2]!;
  fireEvent.keyDown(row, { key: "ArrowLeft", altKey: true });
  fireEvent.keyDown(row, { key: "ArrowLeft", altKey: true });
  await waitFor(() =>
    expect(actions.reorderSpacePhotos).toHaveBeenCalledTimes(1),
  );
  await act(async () => pending.resolve({ ok: false, code: "INTERNAL" }));
  expect(ids()).toEqual(photos.map((p) => p.id));
  expect(screen.getByRole("status", { name: "사진 순서" })).toHaveTextContent(
    "원래대로",
  );
  expect(router.refresh).not.toHaveBeenCalled();
});
it("moves a representative to the front and does not intercept normal text keys", async () => {
  const { photos } = mount();
  fireEvent.keyDown(screen.getByLabelText("사진 2 설명"), {
    key: "ArrowLeft",
    altKey: true,
  });
  expect(actions.reorderSpacePhotos).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: "대표로" })[1]!);
  await waitFor(() => expect(ids()[0]).toBe(photos[2]!.id));
});
it("saves an accessible alt on blur and rejects empty, NUL and overlong Unicode text", async () => {
  mount();
  const input = screen.getByLabelText("사진 1 설명");
  for (const value of ["", "\0", "가".repeat(121)]) {
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
    expect(actions.updateSpacePhotoAlt).not.toHaveBeenCalled();
  }
  fireEvent.change(input, { target: { value: "넓은 테이블과 화이트보드" } });
  fireEvent.blur(input);
  await waitFor(() =>
    expect(actions.updateSpacePhotoAlt).toHaveBeenCalledWith({
      photoId: adminPhotosFixture()[0]!.id,
      alt: "넓은 테이블과 화이트보드",
    }),
  );
});
it("asks for confirmation before delete and keeps an inline safe failure in the dialog", async () => {
  mount();
  vi.mocked(actions.deleteSpacePhoto).mockResolvedValueOnce({
    ok: false,
    code: "INTERNAL",
  });
  fireEvent.click(screen.getByRole("button", { name: "사진 1 지우기" }));
  const dialog = screen.getByRole("dialog");
  expect(actions.deleteSpacePhoto).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "지우기" }));
  await waitFor(() =>
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "저장하지 못했어요",
    ),
  );
  expect(screen.getAllByRole("article", { hidden: true })).toHaveLength(3);
});
it("deletes only the chosen photo and compacts the remaining order", async () => {
  const { photos } = mount();
  fireEvent.click(screen.getByRole("button", { name: "사진 2 지우기" }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "지우기" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(ids()).toEqual([photos[0]!.id, photos[2]!.id]);
});
it.each(["image/heic", "text/html"])(
  "rejects %s before conversion or any action",
  (type) => {
    mount();
    fireEvent.change(screen.getByLabelText("사진 고르기"), {
      target: { files: [new File(["x"], "input", { type })] },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("JPG, PNG, WebP");
    expect(toWebp).not.toHaveBeenCalled();
    expect(actions.createSpacePhotoUpload).not.toHaveBeenCalled();
  },
);
it.each([
  ["too_small", "1200×750 이상"],
  ["too_large", "사진이 너무 복잡"],
  ["unsupported", "이 브라우저에서는"],
] as const)("shows %s without attempting upload", async (code, message) => {
  mount();
  vi.mocked(toWebp).mockRejectedValueOnce(new WebpConversionError(code));
  fireEvent.change(screen.getByLabelText("사진 고르기"), {
    target: { files: [new File(["x"], "p.png", { type: "image/png" })] },
  });
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(message),
  );
  expect(actions.createSpacePhotoUpload).not.toHaveBeenCalled();
});
it("converts, asks alt, sends exact size, PUTs with progress, then confirms once", async () => {
  mount({ count: 0 });
  const pending = deferred<void>();
  vi.mocked(uploadToR2).mockImplementationOnce(async (_url, _blob, options) => {
    options?.onProgress?.(62);
    await pending.promise;
  });
  await choose();
  expect(actions.createSpacePhotoUpload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "사진 올리기" }));
  expect(screen.getByRole("alert")).toHaveTextContent("설명을 적어");
  fireEvent.change(screen.getByLabelText("설명", { exact: true }), {
    target: { value: "테이블" },
  });
  fireEvent.click(screen.getByRole("button", { name: "사진 올리기" }));
  await waitFor(() =>
    expect(
      screen.getByRole("progressbar", { name: "사진 업로드" }),
    ).toHaveAttribute("value", "62"),
  );
  expect(actions.createSpacePhotoUpload).toHaveBeenCalledExactlyOnceWith({
    spaceId: photoSpaceId,
    size: blob.size,
  });
  expect(actions.confirmSpacePhotoUpload).not.toHaveBeenCalled();
  await act(async () => pending.resolve());
  await waitFor(() =>
    expect(actions.confirmSpacePhotoUpload).toHaveBeenCalledExactlyOnceWith({
      spaceId: photoSpaceId,
      uploadId,
      alt: "테이블",
    }),
  );
  expect(
    new URL(
      screen.getByRole("img", { name: "테이블" }).getAttribute("src")!,
      window.location.origin,
    ).pathname,
  ).toBe(`/api/space-photos/${uploadId}.webp`);
  expect(router.refresh).toHaveBeenCalledTimes(1);
});
it("does not PUT when the server rejects a new upload", async () => {
  mount();
  vi.mocked(actions.createSpacePhotoUpload).mockResolvedValueOnce({
    ok: false,
    code: "FORBIDDEN",
    message: "files_disabled",
  });
  await choose();
  fireEvent.change(screen.getByLabelText("설명", { exact: true }), {
    target: { value: "테이블" },
  });
  fireEvent.click(screen.getByRole("button", { name: "사진 올리기" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("이 환경에서는"),
  );
  expect(uploadToR2).not.toHaveBeenCalled();
});
it("aborts on unmount and ignores late conversion", async () => {
  const view = mount(),
    pending = deferred<Awaited<ReturnType<typeof toWebp>>>();
  vi.mocked(toWebp).mockReturnValueOnce(pending.promise);
  fireEvent.change(screen.getByLabelText("사진 고르기"), {
    target: { files: [new File(["x"], "p.png", { type: "image/png" })] },
  });
  const signal = vi.mocked(toWebp).mock.calls[0]![1].signal!;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve({ blob, width: 1200, height: 750 }));
  expect(actions.createSpacePhotoUpload).not.toHaveBeenCalled();
});
it("does not refresh another route after a delayed response", async () => {
  mount();
  const pending = deferred<ActionResult<{ spaceId: string }>>();
  vi.mocked(actions.reorderSpacePhotos).mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getAllByRole("button", { name: "대표로" })[0]!);
  await waitFor(() =>
    expect(actions.reorderSpacePhotos).toHaveBeenCalledTimes(1),
  );
  window.history.replaceState({}, "", "/");
  await act(async () =>
    pending.resolve({ ok: true, data: { spaceId: photoSpaceId } }),
  );
  expect(router.refresh).not.toHaveBeenCalled();
});
it.each(["tab=info", "tab=access", "", "tab=photos&tab=info"])(
  "ignores a pending photo response after the same pathname changes to %s",
  async (query) => {
    mount();
    const pending = deferred<ActionResult<{ spaceId: string }>>();
    vi.mocked(actions.reorderSpacePhotos).mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getAllByRole("button", { name: "대표로" })[0]!);
    await waitFor(() =>
      expect(actions.reorderSpacePhotos).toHaveBeenCalledTimes(1),
    );
    window.history.replaceState(
      {},
      "",
      `${photoPath}${query ? `?${query}` : ""}`,
    );
    await act(async () =>
      pending.resolve({ ok: true, data: { spaceId: photoSpaceId } }),
    );
    expect(router.refresh).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  },
);
it("does not open the description dialog when conversion finishes on another query tab", async () => {
  mount();
  const pending = deferred<Awaited<ReturnType<typeof toWebp>>>();
  vi.mocked(toWebp).mockReturnValueOnce(pending.promise);
  fireEvent.change(screen.getByLabelText("사진 고르기"), {
    target: { files: [new File(["x"], "p.png", { type: "image/png" })] },
  });
  window.history.replaceState({}, "", `${photoPath}?tab=info`);
  await act(async () => pending.resolve({ blob, width: 1200, height: 750 }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(actions.createSpacePhotoUpload).not.toHaveBeenCalled();
});
it("restores Activity without retaining a stuck conversion spinner", async () => {
  const view = mount(),
    pending = deferred<Awaited<ReturnType<typeof toWebp>>>();
  vi.mocked(toWebp).mockReturnValueOnce(pending.promise);
  fireEvent.change(screen.getByLabelText("사진 고르기"), {
    target: { files: [new File(["x"], "p.png", { type: "image/png" })] },
  });
  view.rerender(view.tree(true));
  await act(async () => pending.resolve({ blob, width: 1200, height: 750 }));
  view.rerender(view.tree());
  await waitFor(() =>
    expect(screen.getByLabelText("사진 고르기")).toBeEnabled(),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("starts a new conversion on Activity return before the aborted conversion settles", async () => {
  const view = mount();
  const first = deferred<Awaited<ReturnType<typeof toWebp>>>();
  const second = deferred<Awaited<ReturnType<typeof toWebp>>>();
  vi.mocked(toWebp)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const select = () =>
    fireEvent.change(screen.getByLabelText("사진 고르기"), {
      target: { files: [new File(["x"], "p.png", { type: "image/png" })] },
    });
  select();
  const firstSignal = vi.mocked(toWebp).mock.calls[0]![1].signal!;
  view.rerender(view.tree(true));
  view.rerender(view.tree());
  await waitFor(() =>
    expect(screen.getByLabelText("사진 고르기")).toBeEnabled(),
  );
  select();
  expect(toWebp).toHaveBeenCalledTimes(2);
  const secondSignal = vi.mocked(toWebp).mock.calls[1]![1].signal!;
  expect(firstSignal.aborted).toBe(true);
  expect(secondSignal.aborted).toBe(false);
  await act(async () => first.resolve({ blob, width: 1200, height: 750 }));
  expect(screen.getByLabelText("사진 고르기")).toBeDisabled();
  expect(screen.getByText("사진을 바꾸고 있어요")).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  select();
  expect(toWebp).toHaveBeenCalledTimes(2);
  // 이전 finally가 새 컨트롤러를 비우면 두 번째 hide가 B를 취소하지 못한다.
  view.rerender(view.tree(true));
  expect(secondSignal.aborted).toBe(true);
  await act(async () => second.resolve({ blob, width: 1200, height: 750 }));
  view.rerender(view.tree());
  await waitFor(() =>
    expect(screen.getByLabelText("사진 고르기")).toBeEnabled(),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(actions.createSpacePhotoUpload).not.toHaveBeenCalled();
});

it.each(["mouse", "touch"])(
  "reorders using the %s pointer handle and cancels safely",
  async (pointerType) => {
    const { photos } = mount();
    const handle = screen.getByRole("button", { name: "사진 1 순서 옮기기" });
    const target = screen.getAllByRole("article")[2]!;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => target),
    });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 3, pointerType });
    fireEvent.pointerMove(handle, {
      pointerId: 3,
      pointerType,
      clientX: 500,
      clientY: 200,
    });
    fireEvent.pointerCancel(handle, { pointerId: 3, pointerType });
    expect(actions.reorderSpacePhotos).not.toHaveBeenCalled();
    fireEvent.pointerDown(handle, { button: 0, pointerId: 4, pointerType });
    fireEvent.pointerMove(handle, {
      pointerId: 4,
      pointerType,
      clientX: 500,
      clientY: 200,
    });
    fireEvent.pointerUp(handle, { pointerId: 4, pointerType });
    await waitFor(() =>
      expect(actions.reorderSpacePhotos).toHaveBeenCalledWith({
        spaceId: photoSpaceId,
        photoIds: [photos[1]!.id, photos[2]!.id, photos[0]!.id],
      }),
    );
  },
);
it("cancels a pending PUT without confirming, and can choose another photo", async () => {
  mount({ count: 0 });
  vi.mocked(uploadToR2).mockImplementationOnce(
    (_url, _blob, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
  );
  await choose();
  fireEvent.change(screen.getByLabelText("설명", { exact: true }), {
    target: { value: "테이블" },
  });
  fireEvent.click(screen.getByRole("button", { name: "사진 올리기" }));
  await waitFor(() => expect(uploadToR2).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "업로드 취소" }));
  await waitFor(() =>
    expect(screen.getByLabelText("사진 고르기")).toBeEnabled(),
  );
  expect(actions.confirmSpacePhotoUpload).not.toHaveBeenCalled();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
});
