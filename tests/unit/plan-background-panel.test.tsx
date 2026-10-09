import { Activity, StrictMode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BackgroundPanel,
  type BackgroundPanelProps,
} from "@/features/floor-plan/editor/background-panel";
import { PlanEditorContext } from "@/features/floor-plan/editor/editor-context";
import { createPlanAutosave } from "@/features/floor-plan/editor/autosave";
import { createPlanEditorStore } from "@/features/floor-plan/editor/store";
import {
  WebpConversionError,
  type WebpResult,
} from "@/features/uploads/to-webp";
import type { SaveFloorPlanDraftResult } from "@/features/floor-plan/editor-types";
import type { ActionResult } from "@/lib/actions/result";
import { editorDocument } from "../helpers/plan-editor-store";

vi.mock("@/features/floor-plan/actions", () => ({
  createPlanBackgroundUpload: vi.fn(),
  confirmPlanBackgroundUpload: vi.fn(),
}));
const planId = "e8000000-0000-4000-8000-000000000001";
const uploadId = "e8000000-0000-4000-8000-000000000002";
const saved: ActionResult<SaveFloorPlanDraftResult> = {
  ok: true,
  data: {
    planId,
    version: 2,
    revision: 1,
    savedAt: "2026-10-09T00:00:00.000Z",
  },
};
const image: WebpResult = {
  blob: new Blob(["webp"], { type: "image/webp" }),
  width: 400,
  height: 200,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const teardown: (() => void)[] = [];
beforeEach(() => window.history.replaceState(null, "", "/editor"));
afterEach(() => {
  teardown.splice(0).forEach((dispose) => dispose());
  vi.clearAllMocks();
});
function mount({
  background = true,
  draft = true,
}: { background?: boolean; draft?: boolean } = {}) {
  const document = editorDocument();
  if (background)
    document.background = {
      transform: [10, 0, 0, 10, 1000, 2000],
      opacity: 0.5,
    };
  const store = createPlanEditorStore({
    floorId: "e8000000-0000-4000-8000-000000000003",
    basePlanId: null,
    document,
    draft: draft ? { planId, version: 2, revision: 1 } : null,
    savedAt: null,
  });
  const save = vi
    .fn<(input: unknown) => Promise<ActionResult<SaveFloorPlanDraftResult>>>()
    .mockResolvedValue(saved);
  const autosave = createPlanAutosave(store, { save });
  const flush = vi.spyOn(autosave, "flush");
  autosave.start();
  const createUpload = vi
    .fn<NonNullable<BackgroundPanelProps["createUpload"]>>()
    .mockResolvedValue({
      ok: true,
      data: { planId, uploadId, url: "https://fake.test/secret-signed-url" },
    });
  const confirmUpload = vi
    .fn<NonNullable<BackgroundPanelProps["confirmUpload"]>>()
    .mockResolvedValue({
      ok: true,
      data: { planId, uploadId, width: 400, height: 200 },
    });
  const convert = vi
    .fn<NonNullable<BackgroundPanelProps["convert"]>>()
    .mockResolvedValue(image);
  const upload = vi
    .fn<NonNullable<BackgroundPanelProps["upload"]>>()
    .mockResolvedValue();
  const onUploaded = vi.fn(),
    onScaleStart = vi.fn(),
    onScaleEnd = vi.fn(),
    onLockedChange = vi.fn();
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  let visible = true;
  let props: BackgroundPanelProps = {
    enabled: true,
    active: true,
    autosave,
    locked: false,
    onLockedChange,
    scalePoints: [],
    onScaleStart,
    onScaleEnd,
    onUploaded,
    imageSize: { width: 400, height: 200 },
    createUpload,
    confirmUpload,
    convert,
    upload,
  };
  const view = () => (
    <StrictMode>
      <QueryClientProvider client={client}>
        <Activity mode={visible ? "visible" : "hidden"}>
          <PlanEditorContext value={store}>
            <BackgroundPanel {...props} />
          </PlanEditorContext>
        </Activity>
      </QueryClientProvider>
    </StrictMode>
  );
  const app = render(view());
  teardown.push(() => {
    autosave.dispose();
    client.clear();
  });
  const select = () =>
    fireEvent.change(screen.getByLabelText("배경 이미지 파일"), {
      target: {
        files: [new File(["image"], "비밀 이름.png", { type: "image/png" })],
      },
    });
  return {
    ...app,
    store,
    save,
    flush,
    autosave,
    createUpload,
    confirmUpload,
    convert,
    upload,
    onUploaded,
    onScaleStart,
    onScaleEnd,
    onLockedChange,
    select,
    set(next: Partial<BackgroundPanelProps>) {
      props = { ...props, ...next };
      app.rerender(view());
    },
    visibility(value: boolean) {
      visible = value;
      app.rerender(view());
    },
  };
}

describe("background panel", () => {
  it("keeps local editing available while uploads are disabled", () => {
    const h = mount();
    h.set({ enabled: false });
    expect(
      screen.getByText("이 환경에서는 파일을 올릴 수 없어요"),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "배경 이미지 바꾸기" }),
    ).toBeNull();
    h.select();
    expect(h.convert).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "90° 회전" }));
    expect(h.store.getState().undoStack).toHaveLength(1);
  });
  it("converts, flushes the first draft, uploads and confirms before one background command", async () => {
    const h = mount({ background: false, draft: false });
    const saving = deferred<ActionResult<SaveFloorPlanDraftResult>>();
    h.save.mockReturnValue(saving.promise);
    h.select();
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    expect(h.convert).toHaveBeenCalledWith(expect.any(File), {
      maxLongSide: 4096,
      maxBytes: 3 * 1024 * 1024,
      signal: expect.any(AbortSignal),
    });
    expect(h.flush).toHaveBeenCalledWith({ createDraft: true });
    expect(h.store.getState().writeLocked).toBe(true);
    expect(h.createUpload).not.toHaveBeenCalled();
    await act(async () => saving.resolve(saved));
    await waitFor(() => expect(h.onUploaded).toHaveBeenCalledTimes(1));
    expect(h.createUpload).toHaveBeenCalledWith({
      floorId: h.store.getState().floorId,
      expectedDraftId: planId,
      size: image.blob.size,
    });
    expect(h.upload).toHaveBeenCalledWith(
      "https://fake.test/secret-signed-url",
      image.blob,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        onProgress: expect.any(Function),
      }),
    );
    expect(h.confirmUpload).toHaveBeenCalledWith({
      floorId: h.store.getState().floorId,
      uploadId,
    });
    expect(h.store.getState().document.background).toEqual({
      transform: [10, 0, 0, 10, 0, 0],
      opacity: 0.35,
    });
    expect(h.store.getState().undoStack).toHaveLength(1);
    expect(h.store.getState().writeLocked).toBe(false);
    expect(document.body.textContent).not.toMatch(/secret-signed|비밀 이름/);
  });
  it("blocks same-tick duplicate selections and cancels conversion without creating a draft", async () => {
    const h = mount();
    const converting = deferred<WebpResult>();
    h.convert.mockReturnValue(converting.promise);
    h.select();
    h.select();
    expect(h.convert).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "올리기 취소" }));
    expect(h.convert.mock.calls[0]![1].signal?.aborted).toBe(true);
    await act(async () => converting.resolve(image));
    expect(h.flush).not.toHaveBeenCalled();
    expect(h.createUpload).not.toHaveBeenCalled();
    expect(h.store.getState().writeLocked).toBe(false);
  });
  it("aborts an in-flight PUT and ignores its late success", async () => {
    const h = mount();
    const uploading = deferred<void>();
    h.upload.mockImplementation(async (_url, _blob, options) => {
      options?.onProgress?.(42);
      return uploading.promise;
    });
    h.select();
    await screen.findByText("이미지를 올리고 있어요 42%");
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "42");
    expect(screen.getByRole("button", { name: "올리기 취소" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "올리기 취소" }));
    expect(h.upload.mock.calls[0]![2]?.signal?.aborted).toBe(true);
    await act(async () => uploading.resolve());
    expect(h.confirmUpload).not.toHaveBeenCalled();
    expect(h.onUploaded).not.toHaveBeenCalled();
    expect(h.store.getState().writeLocked).toBe(false);
  });
  it("accepts the first-save ACK after cancellation but does not request an upload", async () => {
    const h = mount({ background: false, draft: false });
    const saving = deferred<ActionResult<SaveFloorPlanDraftResult>>();
    h.save.mockReturnValue(saving.promise);
    h.select();
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "올리기 취소" }));
    expect(h.store.getState().writeLocked).toBe(false);
    await act(async () => saving.resolve(saved));
    expect(h.store.getState().draft?.planId).toBe(planId);
    expect(h.store.getState().document.background).toBeUndefined();
    expect(h.createUpload).not.toHaveBeenCalled();
  });
  it.each(["activity", "inactive", "unmount", "pathname"] as const)(
    "does not apply a late confirmation after %s",
    async (kind) => {
      const h = mount();
      const before = h.store.getState().document;
      const confirming =
        deferred<
          Awaited<
            ReturnType<NonNullable<BackgroundPanelProps["confirmUpload"]>>
          >
        >();
      h.confirmUpload.mockReturnValue(confirming.promise);
      h.select();
      await waitFor(() => expect(h.confirmUpload).toHaveBeenCalledTimes(1));
      if (kind === "activity") h.visibility(false);
      if (kind === "inactive") h.set({ active: false });
      if (kind === "unmount") h.unmount();
      if (kind === "pathname") window.history.replaceState(null, "", "/other");
      await act(async () =>
        confirming.resolve({
          ok: true,
          data: { planId, uploadId, width: 400, height: 200 },
        }),
      );
      expect(h.store.getState().document).toBe(before);
      expect(h.store.getState().writeLocked).toBe(false);
      expect(h.onUploaded).not.toHaveBeenCalled();
      if (kind === "activity") {
        h.visibility(true);
        expect(
          screen.queryByRole("button", { name: "올리기 취소" }),
        ).toBeNull();
        expect(
          screen.getByRole("button", { name: "배경 이미지 바꾸기" }),
        ).toBeEnabled();
      }
    },
  );
  it("preserves a new epoch's write lock when the old request settles", async () => {
    const h = mount();
    const confirming =
      deferred<
        Awaited<ReturnType<NonNullable<BackgroundPanelProps["confirmUpload"]>>>
      >();
    h.confirmUpload.mockReturnValue(confirming.promise);
    h.select();
    await waitFor(() => expect(h.confirmUpload).toHaveBeenCalledTimes(1));
    act(() => {
      const state = h.store.getState();
      state.replaceSource({
        floorId: state.floorId,
        basePlanId: null,
        document: editorDocument(),
        draft: null,
        savedAt: null,
      });
      h.store.getState().setWriteLocked(true);
    });
    await act(async () =>
      confirming.resolve({
        ok: true,
        data: { planId, uploadId, width: 400, height: 200 },
      }),
    );
    expect(h.store.getState().writeLocked).toBe(true);
    expect(h.store.getState().document.background).toBeUndefined();
    expect(h.onUploaded).not.toHaveBeenCalled();
  });
  it("does not let a cancelled conversion clear a newer operation", async () => {
    const h = mount();
    const first = deferred<WebpResult>(),
      second = deferred<WebpResult>();
    h.convert
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    h.select();
    fireEvent.click(screen.getByRole("button", { name: "올리기 취소" }));
    h.select();
    await act(async () => first.resolve(image));
    expect(screen.getByText("이미지를 준비하고 있어요")).toBeVisible();
    expect(h.createUpload).not.toHaveBeenCalled();
    await act(async () => second.resolve(image));
    await waitFor(() => expect(h.onUploaded).toHaveBeenCalledTimes(1));
    expect(h.createUpload).toHaveBeenCalledTimes(1);
  });
  it.each(["convert", "save", "create", "put", "confirm"] as const)(
    "cleans its lock and displays only fixed safe errors for %s failure",
    async (step) => {
      const h = mount({ draft: step !== "save" });
      if (step === "convert")
        h.convert.mockRejectedValue(new WebpConversionError("too_large"));
      if (step === "save")
        h.save.mockResolvedValue({ ok: false, code: "INTERNAL" });
      if (step === "create")
        h.createUpload.mockResolvedValue({
          ok: false,
          code: "FORBIDDEN",
          message: "https://secret.test",
        });
      if (step === "put")
        h.upload.mockRejectedValue(
          new Error("https://secret.test?signature=value"),
        );
      if (step === "confirm")
        h.confirmUpload.mockResolvedValue({ ok: false, code: "INTERNAL" });
      h.select();
      await screen.findByRole("alert");
      expect(document.body.textContent).not.toContain("secret.test");
      expect(h.store.getState().writeLocked).toBe(false);
      expect(h.onUploaded).not.toHaveBeenCalled();
    },
  );
  it("refuses mismatched draft acknowledgements and marks STALE without applying a background", async () => {
    const h = mount();
    h.createUpload.mockResolvedValueOnce({
      ok: true,
      data: { planId: "wrong", uploadId, url: "https://fake.test" },
    });
    h.select();
    await screen.findByRole("alert");
    expect(h.upload).not.toHaveBeenCalled();
    h.createUpload.mockResolvedValueOnce({ ok: false, code: "STALE" });
    h.select();
    await waitFor(() => expect(h.store.getState().saveState).toBe("stale"));
    expect(h.store.getState().writeLocked).toBe(false);
    expect(h.store.getState().undoStack).toHaveLength(0);
  });
  it("commits each opacity gesture once and follows undo instead of retaining its local slider draft", () => {
    const h = mount();
    const slider = screen.getByRole("slider", { name: "배경 투명도" });
    expect(slider).toHaveValue("50");
    fireEvent.change(slider, { target: { value: "70" } });
    fireEvent.change(slider, { target: { value: "80" } });
    expect(h.store.getState().undoStack).toHaveLength(0);
    fireEvent.pointerUp(slider);
    fireEvent.blur(slider);
    expect(h.store.getState().undoStack).toHaveLength(1);
    expect(h.store.getState().document.background?.opacity).toBe(0.8);
    act(() => {
      h.store.getState().undo();
    });
    expect(slider).toHaveValue("50");
    fireEvent.change(slider, { target: { value: "51" } });
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    fireEvent.blur(slider);
    expect(h.store.getState().document.background?.opacity).toBe(0.51);
    expect(h.store.getState().undoStack).toHaveLength(1);
  });
  it("scales, rotates about the image center, toggles transient lock and deletes reversibly", () => {
    const h = mount();
    fireEvent.click(
      screen.getByRole("button", { name: "축척 기준 두 점 찍기" }),
    );
    expect(h.onScaleStart).toHaveBeenCalledTimes(1);
    h.set({
      scalePoints: [
        [1000, 2000],
        [2000, 2000],
      ],
    });
    const distance = screen.getByRole("spinbutton", {
      name: "두 점 사이 실제 거리 (mm)",
    });
    fireEvent.change(distance, { target: { value: "2000" } });
    fireEvent.blur(distance);
    fireEvent.click(screen.getByRole("button", { name: "축척 적용" }));
    expect(h.store.getState().document.background?.transform).toEqual([
      20, 0, 0, 20, 1000, 2000,
    ]);
    fireEvent.click(screen.getByRole("button", { name: "90° 회전" }));
    expect(h.store.getState().document.background?.transform).toEqual([
      0, 20, -20, 0, 7000, 0,
    ]);
    const beforeLock = h.store.getState().document;
    fireEvent.click(screen.getByRole("button", { name: "배경 잠금" }));
    expect(h.onLockedChange).toHaveBeenCalledWith(true);
    expect(h.store.getState().document).toBe(beforeLock);
    h.set({ locked: true });
    expect(screen.getByRole("button", { name: "90° 회전" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "배경 지우기" }));
    expect(h.store.getState().document.background).toBeUndefined();
    act(() => {
      h.store.getState().undo();
    });
    expect(h.store.getState().document.background).toBe(beforeLock.background);
  });
  it("allows an unchanged calibration as a no-op and rejects coincident points", () => {
    const h = mount();
    h.set({
      scalePoints: [
        [0, 0],
        [1000, 0],
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "축척 적용" }));
    expect(h.store.getState().undoStack).toHaveLength(0);
    expect(h.onScaleEnd).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    h.set({
      scalePoints: [
        [0, 0],
        [0, 0],
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "축척 적용" }));
    expect(screen.getByRole("alert")).toHaveTextContent("서로 다른 두 점");
    expect(h.store.getState().undoStack).toHaveLength(0);
  });
});
