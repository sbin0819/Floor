import { describe, expect, it } from "vitest";
import {
  BLOCKED_FILE_EXTENSIONS,
  isBlockedName,
  normalizeFileName,
  sniff,
} from "@/lib/storage/file-kind";

const bytes = (value: string) => new TextEncoder().encode(value);

describe("upload names", () => {
  it.each([
    ["  ...보고서.pdf... ", "보고서.pdf"],
    ["../folder\\a.pdf", "foldera.pdf"],
    ["a\u0000\t\r\n.pdf", "a.pdf"],
    ["invoice\u202egpj.exe", "invoicegpj.exe"],
    ["a\u200db\uFEFF.txt", "ab.txt"],
    ["e\u0301.pdf", "é.pdf"],
    [" \t... ", "file"],
    ["", "file"],
  ])("normalizes %j", (input, expected) => {
    expect(normalizeFileName(input)).toBe(expected);
  });
  it("counts Unicode code points and preserves an extension when shortening", () => {
    const long = `${"😀".repeat(250)}.PDF`;
    const normalized = normalizeFileName(long);
    expect(Array.from(normalized)).toHaveLength(200);
    expect(normalized).toBe(`${"😀".repeat(196)}.PDF`);
    expect(normalizeFileName("글".repeat(250))).toBe("글".repeat(200));
    expect(Array.from(normalizeFileName(`x.${"a".repeat(250)}`))).toHaveLength(
      200,
    );
  });
  it.each(BLOCKED_FILE_EXTENSIONS)(
    "blocks normalized .%s without case or trailing-dot bypasses",
    (extension) => {
      for (const input of [
        `a.${extension}`,
        `a.${extension.toUpperCase()}. `,
        `a.${extension}\u202e`,
        `${"가".repeat(250)}.${extension}`,
      ])
        expect(isBlockedName(input)).toBe(true);
    },
  );
  it.each([
    "report.pdf",
    "archive.tar.gz",
    "file",
    "notes.js.txt",
    "a.jpeg",
    "a.JSON",
  ])("allows %s", (name) => {
    expect(isBlockedName(name)).toBe(false);
  });
});

describe("file prefix classification", () => {
  it.each([
    [[0xff, 0xd8, 0xff], "image/jpeg"],
    [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "image/png"],
    [[0x4d, 0x5a], "blocked"],
    [[0x7f, 0x45, 0x4c, 0x46], "blocked"],
    [[0xfe, 0xed, 0xfa, 0xce], "blocked"],
    [[0xce, 0xfa, 0xed, 0xfe], "blocked"],
    [[0xfe, 0xed, 0xfa, 0xcf], "blocked"],
    [[0xcf, 0xfa, 0xed, 0xfe], "blocked"],
  ])("recognizes binary magic %j", (head, expected) => {
    expect(sniff(new Uint8Array(head))).toBe(expected);
  });
  it.each(["GIF87a", "GIF89a"])("recognizes %s", (magic) =>
    expect(sniff(bytes(magic))).toBe("image/gif"),
  );
  it("requires both RIFF and WEBP", () => {
    expect(sniff(bytes("RIFF....WEBP"))).toBe("image/webp");
    expect(sniff(bytes("RIFF....WAVE"))).toBeNull();
    expect(sniff(bytes("NOPE....WEBP"))).toBeNull();
  });
  it.each([
    "<!doctype html>",
    "<HTML ",
    "<head>",
    "<script\n",
    "<iframe>",
    "<h1>",
    "<div>",
    "<font>",
    "<table>",
    "<a>",
    "<style>",
    "<title>",
    "<b>",
    "<body>",
    "<br>",
    "<p>",
    "<!-- ",
    '<?xml version="1.0"?>',
    '  <SvG width="1">',
  ])("blocks scriptable prefix %s", (input) => {
    expect(sniff(bytes(`\t\r\n ${input}`))).toBe("blocked");
  });
  it.each(["utf8", "utf16le", "utf16be"])(
    "blocks BOM-encoded HTML and SVG (%s)",
    (encoding) => {
      for (const text of [" \n<HTML>", "<?xml version='1.0'?>", " <svg>"]) {
        const head =
          encoding === "utf8"
            ? Buffer.concat([
                Buffer.from([0xef, 0xbb, 0xbf]),
                Buffer.from(text),
              ])
            : Buffer.concat([
                Buffer.from([0xff, 0xfe]),
                Buffer.from(text, "utf16le"),
              ]);
        if (encoding === "utf16be") head.swap16();
        expect(sniff(head)).toBe("blocked");
      }
    },
  );
  it("finds SVG anywhere in the first 512 bytes but bounds inspection", () => {
    expect(sniff(bytes(`${" ".repeat(507)}<svg`))).toBe("blocked");
    expect(sniff(bytes(`${" ".repeat(512)}<svg`))).toBeNull();
  });
  it.each([
    "<scripture>",
    "<dividend>",
    "<tableau>",
    "plain png filename but no image",
    "%PDF-1.7",
    "{}",
    "",
  ])("does not use an unbounded tag-prefix match for %j", (input) => {
    expect(sniff(bytes(input))).toBeNull();
  });
  it("does not accept a truncated image signature", () => {
    expect(sniff(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});
