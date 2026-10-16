import { UPLOAD_TIMEOUT_MS } from "@/lib/http/config";
import { ApiError } from "@/lib/http/errors";

export type UploadToR2Options = {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
  createXhr?: () => XMLHttpRequest;
};

export class R2UploadError extends ApiError {
  constructor(
    readonly status: number,
    kind: "http" | "network" | "timeout" = status === 0 ? "network" : "http",
  ) {
    super(kind, { status });
    this.name = "R2UploadError";
    this.message =
      kind === "timeout"
        ? "이미지를 올리는 시간이 초과됐어요. 다시 시도해 주세요."
        : "이미지를 올리지 못했어요. 다시 시도해 주세요.";
  }
}

function attempt(url: string, blob: Blob, options: UploadToR2Options) {
  return new Promise<void>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    let xhr: XMLHttpRequest | undefined;
    let finished = false;
    const stop = () => {
      try {
        xhr?.abort();
      } catch {
        // 이미 끝난 요청의 abort 실패가 확정한 결과를 바꾸면 안 된다.
      }
    };
    const abort = () => {
      if (finished) return;
      finish(new DOMException("Aborted", "AbortError"));
      stop();
    };
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      options.signal?.removeEventListener("abort", abort);
      if (xhr) {
        xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = null;
        xhr.upload.onprogress = null;
      }
      if (error) reject(error);
      else resolve();
    };
    const reportProgress = (percent: number) => {
      if (finished) return;
      try {
        options.onProgress?.(percent);
      } catch {
        finish(new R2UploadError(0));
        stop();
      }
    };
    try {
      const request = (xhr = options.createXhr?.() ?? new XMLHttpRequest());
      request.open("PUT", url);
      request.timeout = UPLOAD_TIMEOUT_MS;
      request.setRequestHeader("Content-Type", "image/webp");
      request.upload.onprogress = (event) => {
        if (!finished && event.lengthComputable && event.total > 0)
          reportProgress(
            Math.max(
              0,
              Math.min(100, Math.round((event.loaded / event.total) * 100)),
            ),
          );
      };
      request.onload = () => {
        if (finished) return;
        if (request.status >= 200 && request.status < 300) {
          reportProgress(100);
          finish();
        } else finish(new R2UploadError(request.status));
      };
      request.onerror = () => finish(new R2UploadError(0));
      request.ontimeout = () => finish(new R2UploadError(0, "timeout"));
      request.onabort = () => finish(new DOMException("Aborted", "AbortError"));
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      else request.send(blob);
    } catch {
      finish(new R2UploadError(0));
      stop();
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
