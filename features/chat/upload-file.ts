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

export class UploadHttpError extends Error {
  constructor(readonly status: number) {
    super("File upload failed.");
  }
}

export const uploadFile: UploadFile = (url, file, options) =>
  new Promise((resolve, reject) => {
    if (options.signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = (error?: Error) => {
      options.signal.removeEventListener("abort", abort);
      xhr.onload = xhr.onerror = xhr.onabort = null;
      xhr.upload.onprogress = null;
      if (error) reject(error);
      else resolve();
    };
    xhr.open("PUT", url);
    Object.entries(options.headers).forEach(([name, value]) =>
      xhr.setRequestHeader(name, value),
    );
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        options.onProgress(
          Math.min(100, Math.round((event.loaded / event.total) * 100)),
        );
    };
    xhr.onload = () =>
      finish(
        xhr.status >= 200 && xhr.status < 300
          ? undefined
          : new UploadHttpError(xhr.status),
      );
    xhr.onerror = () => finish(new UploadHttpError(0));
    xhr.onabort = () => finish(new DOMException("Aborted", "AbortError"));
    options.signal.addEventListener("abort", abort, { once: true });
    xhr.send(file);
  });
