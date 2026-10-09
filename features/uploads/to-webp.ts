export type ToWebpOptions = {
  maxLongSide?: number;
  crop?: { width: number; height: number };
  maxBytes: number;
  signal?: AbortSignal;
};
export type WebpResult = { blob: Blob; width: number; height: number };
export type ToWebpDependencies = {
  decode?: (file: Blob) => Promise<ImageBitmap>;
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
};

export class WebpConversionError extends Error {
  constructor(
    readonly code: "invalid_input" | "unsupported" | "too_large" | "too_small",
  ) {
    super(
      code === "too_small"
        ? "1200×750 이상인 사진을 골라 주세요."
        : code === "unsupported"
          ? "이 브라우저에서는 이미지를 올릴 수 없어요."
          : code === "too_large"
            ? "이미지가 너무 복잡해요. 다른 이미지를 골라 주세요."
            : "10MB 이하의 JPG, PNG, WebP 이미지를 골라 주세요.",
    );
    this.name = "WebpConversionError";
  }
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
function checkAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

export async function toWebp(
  file: Blob,
  options: ToWebpOptions,
  dependencies: ToWebpDependencies = {},
): Promise<WebpResult> {
  checkAborted(options.signal);
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size < 1 ||
    file.size > 10 * 1024 * 1024 ||
    !positiveInteger(options.maxBytes) ||
    (options.maxLongSide !== undefined &&
      (!positiveInteger(options.maxLongSide) || options.maxLongSide > 16384)) ||
    (options.crop !== undefined &&
      (!positiveInteger(options.crop.width) ||
        !positiveInteger(options.crop.height) ||
        options.crop.width > 16384 ||
        options.crop.height > 16384 ||
        options.crop.width * options.crop.height > 50_000_000)) ||
    (options.crop !== undefined && options.maxLongSide !== undefined)
  )
    throw new WebpConversionError("invalid_input");
  let bitmap: ImageBitmap;
  try {
    bitmap = await (dependencies.decode ?? createImageBitmap)(file);
  } catch {
    checkAborted(options.signal);
    throw new WebpConversionError("unsupported");
  }
  let canvas: HTMLCanvasElement | undefined;
  try {
    checkAborted(options.signal);
    if (!positiveInteger(bitmap.width) || !positiveInteger(bitmap.height))
      throw new WebpConversionError("invalid_input");
    let sourceWidth = bitmap.width;
    let sourceHeight = bitmap.height;
    let left = 0;
    let top = 0;
    let width: number;
    let height: number;
    if (options.crop) {
      ({ width, height } = options.crop);
      if (bitmap.width < width || bitmap.height < height)
        throw new WebpConversionError("too_small");
      const scale = Math.max(width / bitmap.width, height / bitmap.height);
      sourceWidth = width / scale;
      sourceHeight = height / scale;
      left = (bitmap.width - sourceWidth) / 2;
      top = (bitmap.height - sourceHeight) / 2;
    } else {
      const scale = Math.min(
        1,
        (options.maxLongSide ?? 16384) / Math.max(bitmap.width, bitmap.height),
      );
      width = Math.max(1, Math.round(bitmap.width * scale));
      height = Math.max(1, Math.round(bitmap.height * scale));
    }
    if (width * height > 50_000_000)
      throw new WebpConversionError("invalid_input");
    canvas = dependencies.createCanvas
      ? dependencies.createCanvas(width, height)
      : document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new WebpConversionError("unsupported");
    context.drawImage(
      bitmap,
      left,
      top,
      sourceWidth,
      sourceHeight,
      0,
      0,
      width,
      height,
    );
    for (const quality of [0.85, 0.75, 0.65]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas!.toBlob(resolve, "image/webp", quality),
      );
      checkAborted(options.signal);
      if (!blob || blob.type !== "image/webp" || blob.size === 0)
        throw new WebpConversionError("unsupported");
      if (blob.size <= options.maxBytes) return { blob, width, height };
    }
    throw new WebpConversionError("too_large");
  } catch (error) {
    if (
      error instanceof WebpConversionError ||
      (error instanceof DOMException && error.name === "AbortError")
    )
      throw error;
    throw new WebpConversionError("unsupported");
  } finally {
    bitmap.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
}
