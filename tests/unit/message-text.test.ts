import { describe, expect, it } from "vitest";
import { excerptOf } from "@/features/chat/message-text";
import type { AttachmentSummary } from "@/features/chat/types";

describe("attachment-aware message excerpts", () => {
  it.each([
    [[{ kind: "image", name: "가.jpg" }], "사진"],
    [
      [
        { kind: "image", name: "가.jpg" },
        { kind: "image", name: "나.png" },
      ],
      "사진 2장",
    ],
    [[{ kind: "file", name: "회의 자료.pdf" }], "파일: 회의 자료.pdf"],
    [
      [
        { kind: "file", name: "가.pdf" },
        { kind: "file", name: "나.txt" },
      ],
      "파일 2개",
    ],
    [
      [
        { kind: "image", name: "가.jpg" },
        { kind: "file", name: "나.pdf" },
      ],
      "파일 2개",
    ],
  ] as const)(
    "uses ordered attachment metadata when the body is empty: %j",
    (attachments, expected) => {
      expect(excerptOf("", {}, attachments)).toBe(expected);
      expect(excerptOf(" \n\t", {}, attachments)).toBe(expected);
      const summary: AttachmentSummary = {
        images: attachments.filter(({ kind }) => kind === "image").length,
        files: attachments.filter(({ kind }) => kind === "file").length,
        firstName: attachments[0].name,
      };
      expect(excerptOf("", {}, summary)).toBe(expected);
    },
  );

  it("keeps the existing body and mention rules when attachments also exist", () => {
    const userId = "10000000-0000-4000-8000-000000000001";
    const names = new Map([[userId, "김하은"]]);
    const attachments = [{ kind: "file", name: "무시할 이름.txt" }] as const;
    for (const body of [
      `안녕 <@${userId}>`,
      `\`<@${userId}>\``,
      "**강조**\n줄바꿈",
      "😀".repeat(100),
      " 본문은 유지해요 ",
    ])
      expect(excerptOf(body, names, attachments)).toBe(excerptOf(body, names));
    expect(excerptOf(`<@${userId}> 확인해 주세요`, names, attachments)).toBe(
      "@김하은 확인해 주세요",
    );
    expect(
      Array.from(excerptOf("😀".repeat(100), names, attachments)),
    ).toHaveLength(80);
  });

  it("does not invent an attachment label for absent or empty metadata", () => {
    for (const attachments of [
      undefined,
      null,
      [],
      { images: 0, files: 0, firstName: "" },
    ] as const) {
      expect(excerptOf("", {}, attachments)).toBe("");
      expect(excerptOf(" ", {}, attachments)).toBe(" ");
      expect(excerptOf("본문", {}, attachments)).toBe("본문");
    }
  });
});
