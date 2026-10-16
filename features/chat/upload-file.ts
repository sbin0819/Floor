import { UPLOAD_TIMEOUT_MS } from "@/lib/http/config";
import { ApiError } from "@/lib/http/errors";

export type UploadFileOptions = {
  headers: Record<string, string>;
  onProgress: (percent: number) => void;
  signal: AbortSignal;
};
export type UploadFile = (
  url: string,
  file: File,
  options: UploadFileOptions,
) => Promise<void>;

export class UploadHttpError extends ApiError {
  constructor(
    readonly status: number,
    kind: "http" | "network" | "timeout" = status === 0 ? "network" : "http",
  ) {
    super(kind, { status });
    this.name = "UploadHttpError";
    this.message =
      kind === "timeout"
        ? "파일을 올리는 시간이 초과됐어요. 다시 시도해 주세요."
        : "File upload failed.";
  }
}

export const uploadFile: UploadFile = (url, file, options) =>
  new Promise((resolve, reject) => {
    if (options.signal.aborted) {
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
      options.signal.removeEventListener("abort", abort);
      if (xhr) {
        xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = null;
        xhr.upload.onprogress = null;
      }
      if (error) reject(error);
      else resolve();
    };
    try {
      const request = (xhr = new XMLHttpRequest());
      request.open("PUT", url);
      request.timeout = UPLOAD_TIMEOUT_MS;
      Object.entries(options.headers).forEach(([name, value]) =>
        request.setRequestHeader(name, value),
      );
      request.upload.onprogress = (event) => {
        if (finished || !event.lengthComputable || event.total <= 0) return;
        try {
          options.onProgress(
            Math.max(
              0,
              Math.min(100, Math.round((event.loaded / event.total) * 100)),
            ),
          );
        } catch {
          finish(new UploadHttpError(0));
          stop();
        }
      };
      request.onload = () =>
        finish(
          request.status >= 200 && request.status < 300
            ? undefined
            : new UploadHttpError(request.status),
        );
      request.onerror = () => finish(new UploadHttpError(0));
      request.ontimeout = () => finish(new UploadHttpError(0, "timeout"));
      request.onabort = () => finish(new DOMException("Aborted", "AbortError"));
      options.signal.addEventListener("abort", abort, { once: true });
      if (options.signal.aborted) abort();
      else request.send(file);
    } catch {
      finish(new UploadHttpError(0));
      stop();
    }
  });
