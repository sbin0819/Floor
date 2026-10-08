import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadFile, UploadHttpError } from "@/features/chat/upload-file";

class FakeXhr {
  static current: FakeXhr;
  status = 204;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
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
  afterEach(() => vi.unstubAllGlobals());
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
    expect(xhr.setRequestHeader).toHaveBeenCalledExactlyOnceWith(
      "Content-Type",
      "application/octet-stream",
    );
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 1, total: 0 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 });
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(25);
    xhr.onload?.();
    await expect(promise).resolves.toBeUndefined();
    expect(xhr.upload.onprogress).toBeNull();
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
  it("aborts an active PUT and removes the abort listener afterward", async () => {
    const controller = new AbortController();
    const { promise } = start(controller);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeXhr.current.abort).toHaveBeenCalledTimes(1);
    expect(FakeXhr.current.onabort).toBeNull();
  });
  it("does not start an already-aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(start(controller).promise).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
