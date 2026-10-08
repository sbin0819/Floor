import { Buffer } from "node:buffer";
import { imageSize } from "image-size";
import { sniff, type ImageMime } from "./file-kind";

const expectedType: Record<ImageMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

export function readImageSize(
  head: Uint8Array,
): { width: number; height: number } | null {
  if (head.byteLength > 1024 * 1024) return null;
  const mime = sniff(head);
  if (mime === null || mime === "blocked") return null;
  const minimum =
    mime === "image/png"
      ? 24
      : mime === "image/gif"
        ? 10
        : mime === "image/webp"
          ? head[15] === 0x4c
            ? 25
            : 30
          : 9;
  if (head.byteLength < minimum) return null;
  try {
    // JPEG 파서가 slice로 머리를 전진시키므로 복사하는 Uint8Array 대신 Buffer 뷰를 준다.
    // 라이브러리의 DataView가 view 길이를 생략한다. 부분 view만 정확한 경계로 복사한다.
    const bounded =
      head.byteOffset === 0 && head.byteLength === head.buffer.byteLength
        ? head.buffer
        : head.buffer.slice(head.byteOffset, head.byteOffset + head.byteLength);
    const size = imageSize(Buffer.from(bounded));
    if (size.type !== expectedType[mime]) return null;
    let { width, height } = size;
    if (
      mime === "image/jpeg" &&
      size.orientation !== undefined &&
      size.orientation >= 5 &&
      size.orientation <= 8
    )
      [width, height] = [height, width];
    return Number.isSafeInteger(width) &&
      Number.isSafeInteger(height) &&
      width > 0 &&
      height > 0 &&
      width <= 16384 &&
      height <= 16384 &&
      width * height <= 50_000_000
      ? { width, height }
      : null;
  } catch {
    return null;
  }
}
