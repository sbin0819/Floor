export const BLOCKED_FILE_EXTENSIONS = [
  "exe",
  "msi",
  "msix",
  "appx",
  "bat",
  "cmd",
  "com",
  "scr",
  "cpl",
  "hta",
  "lnk",
  "reg",
  "ps1",
  "vbs",
  "vbe",
  "js",
  "jse",
  "mjs",
  "wsf",
  "jar",
  "sh",
  "command",
  "app",
  "dmg",
  "pkg",
  "apk",
  "html",
  "htm",
  "xhtml",
  "xht",
  "shtml",
  "mht",
  "mhtml",
  "svg",
  "svgz",
] as const;
const blockedExtensions = new Set<string>(BLOCKED_FILE_EXTENSIONS);

export function normalizeFileName(name: string): string {
  const cleaned = name
    .normalize("NFC")
    .replace(/[\/\\\p{Cc}\p{Cf}]/gu, "")
    .replace(/^[\s.]+|[\s.]+$/gu, "");
  if (!cleaned) return "file";
  const characters = Array.from(cleaned);
  if (characters.length <= 200) return cleaned;
  const lastDot = characters.lastIndexOf(".");
  const suffix = lastDot > 0 ? characters.slice(lastDot) : [];
  // 200자를 넘는 확장자 자체는 보존할 수 없지만, 보통 확장자는 줄이기 뒤에도 그대로 둔다.
  const shortened =
    suffix.length > 0 && suffix.length < 200
      ? [...characters.slice(0, 200 - suffix.length), ...suffix]
      : characters.slice(0, 200);
  return shortened.join("").replace(/[\s.]+$/gu, "") || "file";
}

export function isBlockedName(name: string): boolean {
  const normalized = normalizeFileName(name);
  const dot = normalized.lastIndexOf(".");
  return (
    dot >= 0 && blockedExtensions.has(normalized.slice(dot + 1).toLowerCase())
  );
}

export type ImageMime = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
export type FileSniff = ImageMime | "blocked" | null;

function startsWith(head: Uint8Array, prefix: readonly number[], offset = 0) {
  return (
    head.length >= prefix.length + offset &&
    prefix.every((byte, index) => head[index + offset] === byte)
  );
}

function ascii(head: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...head.subarray(start, end));
}

function sniffText(head: Uint8Array) {
  const prefix = head.subarray(0, 512);
  if (startsWith(prefix, [0xff, 0xfe]))
    return new TextDecoder("utf-16le").decode(prefix);
  if (startsWith(prefix, [0xfe, 0xff]))
    return new TextDecoder("utf-16be").decode(prefix);
  return new TextDecoder("utf-8").decode(prefix);
}

export function sniff(head: Uint8Array): FileSniff {
  if (
    startsWith(head, [0x4d, 0x5a]) ||
    startsWith(head, [0x7f, 0x45, 0x4c, 0x46]) ||
    startsWith(head, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWith(head, [0xce, 0xfa, 0xed, 0xfe]) ||
    startsWith(head, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWith(head, [0xcf, 0xfa, 0xed, 0xfe])
  )
    return "blocked";
  const text = sniffText(head)
    .replace(/^[\s\uFEFF]+/u, "")
    .toLowerCase();
  if (
    /^(?:<!doctype html|<html|<head|<script|<iframe|<h1|<div|<font|<table|<a|<style|<title|<b|<body|<br|<p|<!--)(?:[\t\n\f\r >])/u.test(
      text,
    ) ||
    text.startsWith("<?xml") ||
    text.includes("<svg")
  )
    return "blocked";
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return "image/png";
  if (ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a")
    return "image/gif";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP")
    return "image/webp";
  return null;
}
