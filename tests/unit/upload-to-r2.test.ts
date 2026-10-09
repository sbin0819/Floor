import { describe, expect, it, vi } from "vitest";
import { R2UploadError, uploadToR2 } from "@/features/uploads/upload-to-r2";

class FakeXhr {
  status = 0;
  timeout = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  upload: {
    onprogress:
      | ((event: {
          loaded: number;
          total: number;
          lengthComputable: boolean;
        }) => void)
      | null;
  } = { onprogress: null };
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn<(body: Blob) => void>();
  abort = vi.fn(() => this.onabort?.());
}
const url =
  "https://test.r2.cloudflarestorage.com/bucket/pending/file.webp?signature=private-test-signature";
const blob = () => new Blob(["webp"], { type: "image/webp" });
function setup(statuses: (number | "network" | "timeout" | "hold")[]) {
  const requests: FakeXhr[] = [];
  const createXhr = vi.fn(() => {
    const xhr = new FakeXhr();
    const status = statuses[requests.length];
    if (status === undefined) throw new Error("Unexpected extra attempt");
    requests.push(xhr);
    xhr.send.mockImplementation(() => {
      if (status === "hold") return;
      if (status === "network") xhr.onerror?.();
      else if (status === "timeout") xhr.ontimeout?.();
      else {
        xhr.status = status;
        xhr.onload?.();
      }
    });
    return xhr as unknown as XMLHttpRequest;
  });
  return { requests, createXhr };
}

describe("direct R2 PUT", () => {
  it("sends the exact Blob and type without trying to set forbidden Content-Length", async () => {
    const f = setup([204]);
    const body = blob();
    const progress = vi.fn();
    await uploadToR2(url, body, {
      createXhr: f.createXhr,
      onProgress: progress,
    });
    const xhr = f.requests[0]!;
    expect(xhr.open).toHaveBeenCalledExactlyOnceWith("PUT", url);
    expect(xhr.send).toHaveBeenCalledExactlyOnceWith(body);
    expect(xhr.setRequestHeader).toHaveBeenCalledExactlyOnceWith(
      "Content-Type",
      "image/webp",
    );
    expect(xhr.timeout).toBe(120_000);
    expect(progress).toHaveBeenLastCalledWith(100);
    expect(xhr.onload).toBeNull();
    expect(xhr.onerror).toBeNull();
    expect(xhr.upload.onprogress).toBeNull();
  });
  it("reports bounded progress only for computable nonzero totals", async () => {
    const f = setup(["hold"]);
    const progress = vi.fn();
    const promise = uploadToR2(url, blob(), {
      createXhr: f.createXhr,
      onProgress: progress,
    });
    const xhr = f.requests[0]!;
    xhr.upload.onprogress?.({ loaded: 1, total: 3, lengthComputable: true });
    xhr.upload.onprogress?.({ loaded: 9, total: 3, lengthComputable: true });
    xhr.upload.onprogress?.({ loaded: 9, total: 0, lengthComputable: true });
    xhr.upload.onprogress?.({ loaded: 1, total: 3, lengthComputable: false });
    expect(progress.mock.calls).toEqual([[33], [100]]);
    xhr.status = 200;
    xhr.onload?.();
    await promise;
  });
  it.each(["network", "timeout", 408, 429, 500, 503] as const)(
    "retries %s only once",
    async (status) => {
      const f = setup([status, 204]);
      const body = blob();
      await uploadToR2(url, body, { createXhr: f.createXhr });
      expect(f.createXhr).toHaveBeenCalledTimes(2);
      for (const xhr of f.requests) expect(xhr.send).toHaveBeenCalledWith(body);
    },
  );
  it("does not start a third request and never exposes the signed URL in its error", async () => {
    const f = setup([503, 503]);
    await expect(
      uploadToR2(url, blob(), { createXhr: f.createXhr }),
    ).rejects.toMatchObject({
      status: 503,
      message: "이미지를 올리지 못했어요. 다시 시도해 주세요.",
    });
    expect(f.createXhr).toHaveBeenCalledTimes(2);
  });
  it.each([400, 401, 403, 404, 412])(
    "does not retry permanent HTTP %i",
    async (status) => {
      const f = setup([status]);
      await expect(
        uploadToR2(url, blob(), { createXhr: f.createXhr }),
      ).rejects.toMatchObject({ status });
      expect(f.createXhr).toHaveBeenCalledTimes(1);
    },
  );
  it("aborts an in-flight upload, removes listeners, and never retries", async () => {
    const f = setup(["hold"]);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const promise = uploadToR2(url, blob(), {
      createXhr: f.createXhr,
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(f.requests[0]!.abort).toHaveBeenCalledTimes(1);
    expect(f.createXhr).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(f.requests[0]!.onabort).toBeNull();
  });
  it("does not create a request if already aborted", async () => {
    const f = setup([]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadToR2(url, blob(), {
        createXhr: f.createXhr,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(f.createXhr).not.toHaveBeenCalled();
  });
  it.each([
    "http://example.invalid",
    "not-a-url",
    "https://user:password@example.invalid",
  ])("rejects unsafe upload URL %s before any request", async (input) => {
    const f = setup([]);
    await expect(
      uploadToR2(input, blob(), { createXhr: f.createXhr }),
    ).rejects.toBeInstanceOf(R2UploadError);
    expect(f.createXhr).not.toHaveBeenCalled();
  });
  it("refuses wrong or empty output instead of uploading a different MIME", async () => {
    const f = setup([]);
    for (const body of [
      new Blob(["png"], { type: "image/png" }),
      new Blob([], { type: "image/webp" }),
    ])
      await expect(
        uploadToR2(url, body, { createXhr: f.createXhr }),
      ).rejects.toMatchObject({ status: 400 });
    expect(f.createXhr).not.toHaveBeenCalled();
  });
});
