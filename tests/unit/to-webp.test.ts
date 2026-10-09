import { describe, expect, it, vi } from "vitest";
import {
  toWebp,
  WebpConversionError,
  type ToWebpDependencies,
} from "@/features/uploads/to-webp";

const file = () => new Blob(["input"], { type: "image/png" });
const output = (size: number, type = "image/webp") =>
  new Blob([new Uint8Array(size)], { type });
function fixture(
  width = 8000,
  height = 4000,
  blobs: (Blob | null)[] = [output(10)],
) {
  const close = vi.fn();
  const bitmap = { width, height, close } as unknown as ImageBitmap;
  const drawImage = vi.fn();
  const toBlob = vi
    .fn<(callback: BlobCallback, type?: string, quality?: number) => void>()
    .mockImplementation((callback) => callback(blobs.shift() ?? null));
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ drawImage })),
    toBlob,
  } as unknown as HTMLCanvasElement;
  const dependencies = {
    decode: vi.fn(async () => bitmap),
    createCanvas: vi.fn(() => canvas),
  } satisfies ToWebpDependencies;
  return { dependencies, canvas, close, drawImage, toBlob, bitmap };
}

describe("browser WebP conversion with injected browser APIs", () => {
  it("shrinks a long image proportionally and disposes the bitmap/canvas", async () => {
    const f = fixture();
    const result = await toWebp(
      file(),
      { maxLongSide: 4096, maxBytes: 100 },
      f.dependencies,
    );
    expect(result).toEqual({ blob: output(10), width: 4096, height: 2048 });
    expect(f.drawImage).toHaveBeenCalledExactlyOnceWith(
      f.bitmap,
      0,
      0,
      8000,
      4000,
      0,
      0,
      4096,
      2048,
    );
    expect(f.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/webp",
      0.85,
    );
    expect(f.close).toHaveBeenCalledTimes(1);
    expect([f.canvas.width, f.canvas.height]).toEqual([0, 0]);
  });
  it("does not enlarge a small input and keeps integer output dimensions", async () => {
    const f = fixture(333, 200);
    expect(
      await toWebp(
        file(),
        { maxLongSide: 4096, maxBytes: 100 },
        f.dependencies,
      ),
    ).toMatchObject({ width: 333, height: 200 });
    const small = fixture(1, 10000);
    expect(
      await toWebp(
        file(),
        { maxLongSide: 4096, maxBytes: 100 },
        small.dependencies,
      ),
    ).toMatchObject({ width: 1, height: 4096 });
  });
  it.each([
    {
      width: 2000,
      height: 1000,
      left: 200,
      top: 0,
      sourceWidth: 1600,
      sourceHeight: 1000,
    },
    {
      width: 1600,
      height: 3200,
      left: 0,
      top: 1100,
      sourceWidth: 1600,
      sourceHeight: 1000,
    },
  ])("crops the exact center of a $width×$height image", async (item) => {
    const f = fixture(item.width, item.height);
    expect(
      await toWebp(
        file(),
        { crop: { width: 1200, height: 750 }, maxBytes: 100 },
        f.dependencies,
      ),
    ).toMatchObject({ width: 1200, height: 750 });
    expect(f.drawImage).toHaveBeenCalledExactlyOnceWith(
      f.bitmap,
      item.left,
      item.top,
      item.sourceWidth,
      item.sourceHeight,
      0,
      0,
      1200,
      750,
    );
  });
  it("tries only the three specified qualities and stops as soon as the exact byte limit is met", async () => {
    const f = fixture(800, 600, [output(101), output(100), output(99)]);
    const result = await toWebp(file(), { maxBytes: 100 }, f.dependencies);
    expect(result.blob.size).toBe(100);
    expect(f.toBlob.mock.calls.map((call) => call[2])).toEqual([0.85, 0.75]);
  });
  it.each([
    [1199, 900],
    [1200, 749],
    [1000, 2000],
  ])(
    "rejects undersized crop source %s×%s without allocating a canvas",
    async (width, height) => {
      const f = fixture(width, height);
      await expect(
        toWebp(
          file(),
          { crop: { width: 1200, height: 750 }, maxBytes: 100 },
          f.dependencies,
        ),
      ).rejects.toMatchObject({ code: "too_small" });
      expect(f.dependencies.createCanvas).not.toHaveBeenCalled();
      expect(f.close).toHaveBeenCalledTimes(1);
    },
  );
  it("accepts the exact crop dimensions without upscaling", async () => {
    const f = fixture(1200, 750);
    await expect(
      toWebp(
        file(),
        { crop: { width: 1200, height: 750 }, maxBytes: 100 },
        f.dependencies,
      ),
    ).resolves.toMatchObject({ width: 1200, height: 750 });
  });
  it("returns a useful safe error when all three qualities exceed the byte limit", async () => {
    const f = fixture(800, 600, [output(103), output(102), output(101)]);
    await expect(
      toWebp(file(), { maxBytes: 100 }, f.dependencies),
    ).rejects.toMatchObject({ code: "too_large" });
    expect(f.toBlob.mock.calls.map((call) => call[2])).toEqual([
      0.85, 0.75, 0.65,
    ]);
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.canvas.width).toBe(0);
  });
  it.each([null, output(10, "image/png"), output(0)])(
    "rejects unsupported or empty canvas output",
    async (blob) => {
      const f = fixture(800, 600, [blob]);
      await expect(
        toWebp(file(), { maxBytes: 100 }, f.dependencies),
      ).rejects.toMatchObject({ code: "unsupported" });
      expect(f.toBlob).toHaveBeenCalledTimes(1);
      expect(f.close).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["image/svg+xml", "application/pdf", "image/gif", "image/heic", ""])(
    "rejects unsupported input MIME %s before decoding",
    async (type) => {
      const f = fixture();
      await expect(
        toWebp(
          new Blob(["input"], { type }),
          { maxBytes: 100 },
          f.dependencies,
        ),
      ).rejects.toMatchObject({ code: "invalid_input" });
      expect(f.dependencies.decode).not.toHaveBeenCalled();
    },
  );
  it("enforces the input 10MiB limit before decoding", async () => {
    const f = fixture();
    await expect(
      toWebp(
        new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "image/png" }),
        { maxBytes: 100 },
        f.dependencies,
      ),
    ).rejects.toBeInstanceOf(WebpConversionError);
    expect(f.dependencies.decode).not.toHaveBeenCalled();
  });
  it.each([
    { maxBytes: 0 },
    { maxBytes: Number.NaN },
    { maxBytes: 100, maxLongSide: 0 },
    { maxBytes: 100, crop: { width: 1.5, height: 100 } },
    { maxBytes: 100, crop: { width: 10000, height: 10000 } },
    { maxBytes: 100, crop: { width: 10, height: 10 }, maxLongSide: 4096 },
  ])("rejects unsafe or ambiguous canvas options %j", async (options) => {
    const f = fixture();
    await expect(toWebp(file(), options, f.dependencies)).rejects.toMatchObject(
      { code: "invalid_input" },
    );
    expect(f.dependencies.decode).not.toHaveBeenCalled();
  });
  it("sanitizes image decoder failure without exposing the source filename", async () => {
    const decode = vi
      .fn()
      .mockRejectedValue(
        new Error("private-image-name and raw decoder internals"),
      );
    await expect(
      toWebp(file(), { maxBytes: 100 }, { decode }),
    ).rejects.toMatchObject({
      code: "unsupported",
      message: "이 브라우저에서는 이미지를 올릴 수 없어요.",
    });
  });
  it("disposes decoded data on drawing failure and sanitizes a security error", async () => {
    const f = fixture();
    f.drawImage.mockImplementation(() => {
      throw new Error("secret-canvas-error");
    });
    await expect(
      toWebp(file(), { maxBytes: 100 }, f.dependencies),
    ).rejects.toMatchObject({ code: "unsupported" });
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.canvas.width).toBe(0);
  });
  it("stops before decoding for pre-abort and closes a bitmap if abort happens while decoding", async () => {
    const controller = new AbortController();
    controller.abort();
    const f = fixture();
    await expect(
      toWebp(
        file(),
        { maxBytes: 100, signal: controller.signal },
        f.dependencies,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(f.dependencies.decode).not.toHaveBeenCalled();
    const later = new AbortController();
    f.dependencies.decode.mockImplementation(async () => {
      later.abort();
      return f.bitmap;
    });
    await expect(
      toWebp(file(), { maxBytes: 100, signal: later.signal }, f.dependencies),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.dependencies.createCanvas).not.toHaveBeenCalled();
  });
  it("does not return an obsolete conversion after abort during toBlob", async () => {
    const controller = new AbortController();
    const f = fixture();
    f.toBlob.mockImplementation((callback) => {
      controller.abort();
      callback(output(10));
    });
    await expect(
      toWebp(
        file(),
        { maxBytes: 100, signal: controller.signal },
        f.dependencies,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(f.toBlob).toHaveBeenCalledTimes(1);
    expect(f.close).toHaveBeenCalledTimes(1);
  });
});
