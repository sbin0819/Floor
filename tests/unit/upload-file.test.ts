import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadFile, UploadHttpError } from "@/features/chat/upload-file";
import { ApiError } from "@/lib/http/errors";

class FakeXhr {
  static current: FakeXhr;
  status = 204;
  timeout = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  upload = {
    onprogress: null as
      | ((event: {
          lengthComputable: boolean;
          loaded: number;
          total: number;
        }) => void)
      | null,
  };
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => this.onabort?.());
  constructor() {
    FakeXhr.current = this;
  }
}
describe("XHR file upload", () => {
  beforeEach(() => vi.stubGlobal("XMLHttpRequest", FakeXhr));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const start = (controller = new AbortController()) => {
    const onProgress = vi.fn();
    const file = new File(["abc"], "a.txt");
    const promise = uploadFile("/upload", file, {
      headers: { "Content-Type": "application/octet-stream" },
      onProgress,
      signal: controller.signal,
    });
    return { promise, onProgress, file };
  };
  it("streams the original File with PUT, configured headers and measurable progress", async () => {
    const { promise, onProgress, file } = start();
    const xhr = FakeXhr.current;
    expect(xhr.open).toHaveBeenCalledExactlyOnceWith("PUT", "/upload");
    expect(xhr.send).toHaveBeenCalledExactlyOnceWith(file);
    expect(xhr.timeout).toBe(120_000);
    expect(xhr.setRequestHeader).toHaveBeenCalledExactlyOnceWith(
      "Content-Type",
      "application/octet-stream",
    );
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 1, total: 0 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 0 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 });
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(25);
    xhr.onload?.();
    await expect(promise).resolves.toBeUndefined();
    expect(xhr.upload.onprogress).toBeNull();
    expect(xhr.ontimeout).toBeNull();
  });
  it.each([400, 404, 409, 500])(
    "exposes only HTTP status %s",
    async (status) => {
      const { promise } = start();
      FakeXhr.current.status = status;
      FakeXhr.current.onload?.();
      await expect(promise).rejects.toMatchObject({
        status,
        message: "File upload failed.",
      });
    },
  );
  it("represents network failure without response details", async () => {
    const { promise } = start();
    FakeXhr.current.onerror?.();
    await expect(promise).rejects.toEqual(new UploadHttpError(0));
  });
  it("distinguishes the native 120-second timeout from abort and network errors", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const { promise } = start(controller);
    const xhr = FakeXhr.current;
    const lateLoad = xhr.onload;
    const lateProgress = xhr.upload.onprogress;
    xhr.ontimeout?.();
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      status: 0,
      kind: "timeout",
      message: "파일을 올리는 시간이 초과됐어요. 다시 시도해 주세요.",
    });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(xhr.onload).toBeNull();
    expect(xhr.onerror).toBeNull();
    expect(xhr.onabort).toBeNull();
    expect(xhr.ontimeout).toBeNull();
    expect(xhr.upload.onprogress).toBeNull();
    lateLoad?.();
    lateProgress?.({ lengthComputable: true, loaded: 1, total: 1 });
    controller.abort();
    expect(xhr.abort).not.toHaveBeenCalled();
    expect(xhr.send).toHaveBeenCalledTimes(1);
  });
  it("aborts an active PUT and removes the abort listener afterward", async () => {
    const controller = new AbortController();
    const { promise } = start(controller);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeXhr.current.abort).toHaveBeenCalledTimes(1);
    expect(FakeXhr.current.onabort).toBeNull();
  });
  it("settles cancellation even if abort emits no event or throws", async () => {
    for (const shouldThrow of [false, true]) {
      const controller = new AbortController();
      const { promise } = start(controller);
      const xhr = FakeXhr.current;
      xhr.abort.mockImplementation(() => {
        if (shouldThrow) throw new Error("private request details");
      });
      controller.abort();
      await expect(promise).rejects.toMatchObject({ name: "AbortError" });
      expect(xhr.onabort).toBeNull();
      expect(xhr.ontimeout).toBeNull();
    }
  });
  it("checks cancellation again after installing the listener and never sends", async () => {
    const controller = new AbortController();
    vi.spyOn(controller.signal, "addEventListener").mockImplementationOnce(() =>
      controller.abort(),
    );
    const { promise } = start(controller);
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeXhr.current.send).not.toHaveBeenCalled();
    expect(FakeXhr.current.abort).toHaveBeenCalledTimes(1);
  });
  it.each(["open", "setRequestHeader", "send"] as const)(
    "sanitizes synchronous %s errors and removes event handlers",
    async (method) => {
      class ThrowingXhr extends FakeXhr {
        constructor() {
          super();
          this[method].mockImplementation(() => {
            throw new Error("private URL, header and body");
          });
        }
      }
      vi.stubGlobal("XMLHttpRequest", ThrowingXhr);
      const controller = new AbortController();
      const remove = vi.spyOn(controller.signal, "removeEventListener");
      const { promise } = start(controller);
      await expect(promise).rejects.toMatchObject({
        kind: "network",
        status: 0,
        message: "File upload failed.",
      });
      expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
      expect(FakeXhr.current.onload).toBeNull();
      expect(FakeXhr.current.ontimeout).toBeNull();
      expect(FakeXhr.current.upload.onprogress).toBeNull();
    },
  );
  it("sanitizes request construction errors", async () => {
    vi.stubGlobal(
      "XMLHttpRequest",
      class {
        constructor() {
          throw new Error("private URL");
        }
      },
    );
    await expect(start().promise).rejects.toMatchObject({
      status: 0,
      kind: "network",
      message: "File upload failed.",
    });
  });
  it("stops and settles the request if a progress callback throws", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const { promise, onProgress } = start(controller);
    onProgress.mockImplementation(() => {
      throw new Error("private file name");
    });
    const xhr = FakeXhr.current;
    const lateProgress = xhr.upload.onprogress;
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 });
    await expect(promise).rejects.toMatchObject({
      kind: "network",
      message: "File upload failed.",
    });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(xhr.abort).toHaveBeenCalledTimes(1);
    expect(xhr.ontimeout).toBeNull();
    expect(xhr.upload.onprogress).toBeNull();
    lateProgress?.({ lengthComputable: true, loaded: 2, total: 4 });
    expect(onProgress).toHaveBeenCalledTimes(1);
  });
  it("does not start an already-aborted request", async () => {
    const previous = FakeXhr.current;
    const controller = new AbortController();
    controller.abort();
    await expect(start(controller).promise).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(FakeXhr.current).toBe(previous);
  });
});
