import { describe, expect, it } from "vitest";
import { messageCopyText } from "@/features/chat/copy-message";

const first = "a1b2c3d4-0000-4000-8000-000000000001";
const second = "a1b2c3d4-0000-4000-8000-000000000002";
const names = { [first]: "김하은", [second]: "박지훈" };

describe("plain-text message copy", () => {
  it.each(["", "안녕하세요", "  앞뒤 공백  \n\n다음 줄\t\r\n"])(
    "preserves a raw body with no mentions exactly (%j)",
    (body) => expect(messageCopyText(body)).toBe(body),
  );

  it("replaces known user mentions and everyone with the existing Korean labels", () => {
    expect(
      messageCopyText(
        `<@${first}> 님, <@${second}> 님과 <@everyone> 안녕하세요`,
        names,
      ),
    ).toBe("@김하은 님, @박지훈 님과 @모두 안녕하세요");
  });

  it("uses the unknown-user label without requiring a names lookup", () => {
    expect(messageCopyText(`<@${first}> <@everyone>`)).toBe(
      "@알 수 없는 사용자 @모두",
    );
  });

  it("accepts a readonly Map and does not change its entries", () => {
    const map = new Map(Object.entries(names));
    const before = [...map];
    expect(messageCopyText(`<@${first}>/<@${second}>`, map)).toBe(
      "@김하은/@박지훈",
    );
    expect([...map]).toEqual(before);
  });

  it("keeps markdown, URLs and line breaks instead of copying rendered markup", () => {
    const body = `**<@${first}>**\n*<@everyone>*\nhttps://example.com/path?a=1&b=2\n`;
    expect(messageCopyText(body, names)).toBe(
      "**@김하은**\n*@모두*\nhttps://example.com/path?a=1&b=2\n",
    );
  });

  it("preserves inline and fenced code because tokens there are not mentions", () => {
    const body = [
      `밖 <@${first}>`,
      `인라인 \`<@${first}> <@everyone>\``,
      "```text",
      `<@${second}> <@everyone>`,
      "```",
      "끝 <@everyone>",
    ].join("\n");
    expect(messageCopyText(body, names)).toBe(
      [
        "밖 @김하은",
        `인라인 \`<@${first}> <@everyone>\``,
        "```text",
        `<@${second}> <@everyone>`,
        "```",
        "끝 @모두",
      ].join("\n"),
    );
  });

  it("leaves malformed mention syntax untouched", () => {
    const body = [
      "<@not-a-uuid>",
      "<@Everyone>",
      "<@everyone >",
      `<@ ${first}>`,
      `<@${first}`,
      `<@${first}x>`,
      "<@z1b2c3d4-0000-4000-8000-000000000001>",
    ].join("\n");
    expect(messageCopyText(body, names)).toBe(body);
  });

  it("normalizes UUID lookup just like the message renderer", () => {
    expect(messageCopyText(`<@${first.toUpperCase()}>`, names)).toBe("@김하은");
  });

  it("replaces adjacent and repeated tokens without losing Unicode boundaries", () => {
    expect(
      messageCopyText(`🙂<@${first}><@everyone>👨‍👩‍👧‍👦<@${first}>끝`, names),
    ).toBe("🙂@김하은@모두👨‍👩‍👧‍👦@김하은끝");
  });

  it("copies the entire body without excerpt truncation or whitespace normalization", () => {
    const long = "가🙂".repeat(200);
    expect(messageCopyText(`  ${long}\n<@${first}>\n  `, names)).toBe(
      `  ${long}\n@김하은\n  `,
    );
  });

  it("treats HTML-like text and entities as literal text, without conversion or evaluation", () => {
    const body = `<img src=x onerror="alert(1)">&lt;b&gt; <@${first}>`;
    expect(messageCopyText(body, names)).toBe(
      '<img src=x onerror="alert(1)">&lt;b&gt; @김하은',
    );
  });

  it("does not reinterpret replacement names as markup or another mention", () => {
    const literalName = `**김하은** <@everyone> <b>글자</b>`;
    const record = Object.freeze({ [first]: literalName });
    expect(messageCopyText(`<@${first}>`, record)).toBe(`@${literalName}`);
    expect(record[first]).toBe(literalName);
  });
});
