import { describe, expect, it, vi } from "vitest";
import * as sizes from "image-size";
import { readImageSize } from "@/lib/storage/image-size";

vi.mock("image-size", { spy: true });

function png(width: number, height: number) {
  const input = Buffer.alloc(24);
  input.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  input.write("IHDR", 12);
  input.writeUInt32BE(width, 16);
  input.writeUInt32BE(height, 20);
  return input;
}

function jpeg({
  width = 1200,
  height = 800,
  orientation = 1,
  padding = 0,
} = {}) {
  const app = Buffer.alloc(36);
  app.set([0xff, 0xe1, 0, 34]);
  app.write("Exif\0\0", 4, "ascii");
  app.write("II", 10);
  app.writeUInt16LE(42, 12);
  app.writeUInt32LE(8, 14);
  app.writeUInt16LE(1, 18);
  app.writeUInt16LE(274, 20);
  app.writeUInt16LE(3, 22);
  app.writeUInt32LE(1, 24);
  app.writeUInt16LE(orientation, 28);
  const fillers: Buffer[] = [];
  for (let remaining = padding; remaining > 0;) {
    const length = Math.min(65531, remaining);
    const filler = Buffer.alloc(length + 4);
    filler.set([0xff, 0xe2]);
    filler.writeUInt16BE(length + 2, 2);
    fillers.push(filler);
    remaining -= length;
  }
  const sof = Buffer.alloc(13);
  sof.set([0xff, 0xc0, 0, 11, 8]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app, ...fillers, sof]);
}

describe("bounded image dimensions", () => {
  it("reads PNG and respects the input view offset", () => {
    const container = Buffer.concat([
      Buffer.from("before"),
      png(320, 240),
      Buffer.from("after"),
    ]);
    const view = new Uint8Array(container.buffer, container.byteOffset + 6, 24);
    expect(readImageSize(view)).toEqual({ width: 320, height: 240 });
  });
  it.each(["GIF87a", "GIF89a"])("reads %s dimensions", (magic) => {
    const input = Buffer.alloc(10);
    input.write(magic);
    input.writeUInt16LE(400, 6);
    input.writeUInt16LE(200, 8);
    expect(readImageSize(input)).toEqual({ width: 400, height: 200 });
  });
  it("reads extended WebP dimensions", () => {
    const input = Buffer.alloc(30);
    input.write("RIFF", 0);
    input.write("WEBPVP8X", 8);
    input.writeUIntLE(319, 24, 3);
    input.writeUIntLE(239, 27, 3);
    expect(readImageSize(input)).toEqual({ width: 320, height: 240 });
  });
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "uses JPEG orientation %i for its rendered size",
    (orientation) => {
      expect(readImageSize(jpeg({ orientation }))).toEqual(
        orientation >= 5
          ? { width: 800, height: 1200 }
          : { width: 1200, height: 800 },
      );
    },
  );
  it("reads a phone JPEG with its size marker after 256KiB using a bounded retry", () => {
    const input = jpeg({ padding: 300 * 1024, orientation: 6 });
    expect(readImageSize(input.subarray(0, 256 * 1024))).toBeNull();
    expect(readImageSize(input.subarray(0, 1024 * 1024))).toEqual({
      width: 800,
      height: 1200,
    });
  });
  it.each([
    [0, 10],
    [10, 0],
    [16385, 1],
    [1, 16385],
    [10000, 5001],
  ])("demotes unsafe %i×%i images", (width, height) =>
    expect(readImageSize(png(width, height))).toBeNull(),
  );
  it("accepts exact dimension and pixel boundaries", () => {
    expect(readImageSize(png(16384, 1))).toEqual({ width: 16384, height: 1 });
    expect(readImageSize(png(10000, 5000))).toEqual({
      width: 10000,
      height: 5000,
    });
  });
  it("does not parse blocked or unapproved formats, including known DoS families", () => {
    const spy = vi.spyOn(sizes, "imageSize");
    try {
      for (const input of [
        Buffer.from("<html>"),
        Buffer.from("icns\0\0\0\0"),
        Buffer.from([0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20]),
        Buffer.from("....ftypheic"),
        Buffer.from("plain"),
      ])
        expect(readImageSize(input)).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
  it("returns null for truncated or corrupted images and refuses heads over 1MiB", () => {
    expect(readImageSize(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
    expect(readImageSize(png(10, 10).subarray(0, 20))).toBeNull();
    const oversized = new Uint8Array(1024 * 1024 + 1);
    oversized.set(png(10, 10));
    expect(readImageSize(oversized)).toBeNull();
  });
  it("passes a zero-copy Buffer view and rejects invalid or mismatched parser results", () => {
    const spy = vi.spyOn(sizes, "imageSize");
    try {
      const head = new Uint8Array(png(20, 10));
      readImageSize(head);
      const input = spy.mock.calls[0]![0];
      expect(Buffer.isBuffer(input)).toBe(true);
      expect(input.buffer).toBe(head.buffer);
      for (const result of [
        { type: "svg", width: 20, height: 10 },
        { type: "png", width: NaN, height: 10 },
        { type: "png", width: 1.5, height: 10 },
        { type: "png", width: 10, height: Infinity },
      ]) {
        spy.mockReturnValueOnce(result);
        expect(readImageSize(head)).toBeNull();
      }
    } finally {
      spy.mockRestore();
    }
  });
});
