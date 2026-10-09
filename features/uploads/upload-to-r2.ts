export type UploadToR2Options = {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  createXhr?: () => XMLHttpRequest;
};

export class R2UploadError extends Error {
  constructor(readonly status: number) {
    super("이미지를 올리지 못했어요. 다시 시도해 주세요.");
    this.name = "R2UploadError";
  }
}

function attempt(url: string, blob: Blob, options: UploadToR2Options) {
  return new Promise<void>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const xhr = options.createXhr?.() ?? new XMLHttpRequest();
    let finished = false;
    const abort = () => {
      xhr.abort();
      finish(new DOMException("Aborted", "AbortError"));
    };
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      options.signal?.removeEventListener("abort", abort);
      xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = null;
      xhr.upload.onprogress = null;
      if (error) reject(error);
      else resolve();
    };
    try {
      xhr.open("PUT", url);
      xhr.timeout = 120_000;
      xhr.setRequestHeader("Content-Type", "image/webp");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0)
          options.onProgress?.(
            Math.max(
              0,
              Math.min(100, Math.round((event.loaded / event.total) * 100)),
            ),
          );
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          options.onProgress?.(100);
          finish();
        } else finish(new R2UploadError(xhr.status));
      };
      xhr.onerror = xhr.ontimeout = () => finish(new R2UploadError(0));
      xhr.onabort = () => finish(new DOMException("Aborted", "AbortError"));
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      else xhr.send(blob);
    } catch {
      finish(new R2UploadError(0));
    }
  });
}

export async function uploadToR2(
  url: string,
  blob: Blob,
  options: UploadToR2Options = {},
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new R2UploadError(400);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    blob.type !== "image/webp" ||
    blob.size === 0
  )
    throw new R2UploadError(400);
  for (let count = 0; count < 2; count++) {
    try {
      await attempt(url, blob, options);
      return;
    } catch (error) {
      if (
        count === 1 ||
        !(error instanceof R2UploadError) ||
        (error.status !== 0 &&
          error.status !== 408 &&
          error.status !== 429 &&
          error.status < 500)
      )
        throw error;
    }
  }
}
