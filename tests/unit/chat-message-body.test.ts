import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  excerptOf,
  extractMentions,
  MAX_MESSAGE_MENTIONS,
  mentionLabel,
  parseMessageBody,
  type MessageBodyPart,
} from "@/features/chat/message-text";
import { MessageBody } from "@/features/chat/components/message-body";

const userId = "d0ad95fd-7671-49cb-a7c4-b7d1c10c079d";
const otherId = "e9e41a35-55b7-4d53-bf33-c7b8564bdf2d";
const names = new Map([[userId, "이서연"]]);

function html(body: string) {
  return renderToStaticMarkup(createElement(MessageBody, { body, names }));
}

function flatten(parts: MessageBodyPart[]): string {
  return parts
    .map((part) => {
      if ("children" in part) return flatten(part.children);
      if (part.type === "mention") return mentionLabel(part.userId, names);
      return part.text;
    })
    .join("");
}

describe("safe message formatting", () => {
  it("renders bold, italic, nested emphasis and preserves line breaks", () => {
    const rendered = html("**굵게 *기울임***\n*강조*\n**따로**");
    expect(rendered).toContain("<em>강조</em>");
    expect(rendered).toContain("<strong>따로</strong>");
    expect(flatten(parseMessageBody("**굵게**\n*기울임*"))).toBe(
      "굵게\n기울임",
    );
    expect(html("**굵게 *안쪽* 그대로**")).toContain(
      "<strong>굵게 <em>안쪽</em> 그대로</strong>",
    );
    expect(html("*기울임 **안쪽** 그대로*")).toContain(
      "<em>기울임 <strong>안쪽</strong> 그대로</em>",
    );
  });

  it.each([
    "2*3*4",
    "a * b * c",
    "** 앞**",
    "**뒤 **",
    "* 앞*",
    "*뒤 *",
    "**닫히지 않음",
    "*줄\n바꿈*",
    "**줄\n바꿈**",
    "별표***그대로",
    "```,",
  ])("keeps malformed and non-emphasis text literal: %s", (body) => {
    const rendered = html(body);
    expect(rendered).not.toMatch(/<(?:em|strong)>/u);
    expect(flatten(parseMessageBody(body))).toBe(body);
  });

  it("protects inline code from mentions, links and emphasis", () => {
    const body = `\`**굵게** <@${userId}> https://a.com\``;
    expect(parseMessageBody(body)).toEqual([
      { type: "code", text: body.slice(1, -1) },
    ]);
    expect(html(body)).not.toContain("<a ");
    expect(html(body)).not.toContain("data-mention");
    expect(extractMentions(body)).toEqual({
      userIds: [],
      everyone: false,
      exceedsLimit: false,
    });
  });

  it("recognizes line-start fences before inline code and discards the language line", () => {
    const body = `앞\n\`\`\`ts\nconst text = "\`code\` **bold** <@${userId}> https://a.com";\n\`\`\`\n뒤`;
    const rendered = html(body);
    expect(rendered).toContain("<pre ");
    expect(rendered).not.toContain("```ts");
    expect(rendered).not.toContain("<strong>");
    expect(rendered).not.toContain("<a ");
    expect(extractMentions(body).userIds).toEqual([]);
    expect(flatten(parseMessageBody(body))).toBe(
      `앞\nconst text = "\`code\` **bold** <@${userId}> https://a.com";\n\n뒤`,
    );
  });

  it("keeps unclosed and non-line-start fences literal", () => {
    for (const body of [
      "```ts\n아직 닫히지 않음",
      "중간 ```ts\n본문\n```",
      "```ts",
    ])
      expect(html(body)).not.toContain("<pre ");
  });

  it("does not pair emphasis across a fenced block", () => {
    expect(html("**앞\n```\n코드\n```\n뒤**")).not.toContain("<strong>");
  });

  it("keeps earlier mention and code pieces protected inside emphasis", () => {
    const rendered = html(`**안녕 <@${userId}> \`그대로\` 님**`);
    expect(rendered).toContain("<strong>");
    expect(rendered).toContain("@이서연");
    expect(rendered).toContain("<code ");
    expect(rendered).toContain("님</strong>");
  });

  it("never treats HTML, script, event handlers or non-http schemes as markup", () => {
    const rendered = html(
      '<script>alert(1)</script><img src=x onerror="alert(1)"> javascript:alert(1) data:text/html,test',
    );
    expect(rendered).toContain("&lt;script&gt;");
    expect(rendered).toContain("&lt;img");
    expect(rendered).not.toContain("<script");
    expect(rendered).not.toContain("<img");
    expect(rendered).not.toContain("<a ");
  });
});

describe("message links", () => {
  it.each([
    ["https://a.com.", "https://a.com", "."],
    ["http://a.com,!?", "http://a.com", ",!?"],
    ["https://a.com에서", "https://a.com", "에서"],
    ["(https://a.com/a(b)).", "https://a.com/a(b)", ")."],
    ["https://a.com/a(b(c))!", "https://a.com/a(b(c))", "!"],
    ["https://a.com/(닫히지", "https://a.com/", "(닫히지"],
    ["https://a.com?q=hello&v=2", "https://a.com?q=hello&v=2", ""],
  ])("links only the safe balanced address in %s", (body, expected, ending) => {
    const parts = parseMessageBody(body);
    const link = parts.find((part) => part.type === "link");
    expect(link).toMatchObject({ type: "link", text: expected });
    expect(flatten(parts)).toBe(body);
    expect(html(body)).toContain(
      'target="_blank" rel="noopener noreferrer nofollow"',
    );
    expect(flatten(parts).endsWith(ending)).toBe(true);
  });

  it("does not include quotes or HTML closing delimiters in links", () => {
    const rendered = html('https://a.com/\" onclick="alert(1) <https://b.com>');
    expect(rendered).toContain('href="https://a.com/"');
    expect(rendered).not.toContain(' onclick="');
    expect(rendered).toContain('href="https://b.com/"');
  });

  it.each(["http://", "https://?", "https://:bad", "https://:badhttps://:bad"])(
    "leaves invalid addresses literal: %s",
    (body) => {
      expect(parseMessageBody(body).some((part) => part.type === "link")).toBe(
        false,
      );
      expect(flatten(parseMessageBody(body))).toBe(body);
    },
  );
});

describe("mention extraction and excerpts", () => {
  it("normalizes UUIDs, deduplicates before filtering, and keeps everyone separate", () => {
    expect(
      extractMentions(
        `<@${userId.toUpperCase()}> <@${userId}> <@everyone> <@${otherId}>`,
      ),
    ).toEqual({
      userIds: [userId, otherId],
      everyone: true,
      exceedsLimit: false,
    });
  });

  it("ignores malformed tokens and tokens in either kind of code", () => {
    const body = `<@no> <@${userId.slice(1)}> <@${userId} > <@${userId}\n> <@EVERYONE> \`<@everyone>\`\n\`\`\`\n<@${otherId}>\n\`\`\``;
    expect(extractMentions(body)).toEqual({
      userIds: [],
      everyone: false,
      exceedsLimit: false,
    });
    expect(html(body)).not.toContain("data-mention");
  });

  it("reports the 21st distinct token before any authorization filtering", () => {
    const ids = Array.from(
      { length: 21 },
      (_, i) => `00000000-0000-4000-8000-${i.toString().padStart(12, "0")}`,
    );
    const body = ids.map((id) => `<@${id}>`).join(" ");
    expect(extractMentions(body)).toEqual({
      userIds: ids,
      everyone: false,
      exceedsLimit: true,
    });
    expect(
      extractMentions(
        ids
          .slice(0, MAX_MESSAGE_MENTIONS)
          .map((id) => `<@${id}>`)
          .join(" ") + " <@everyone>",
      ).exceedsLimit,
    ).toBe(false);
  });

  it("resolves names from maps and records, or gives a safe unknown label", () => {
    expect(mentionLabel(userId, names)).toBe("@이서연");
    expect(mentionLabel(userId, { [userId]: "김하은" })).toBe("@김하은");
    expect(mentionLabel(otherId, names)).toBe("@알 수 없는 사용자");
    expect(mentionLabel("everyone", names)).toBe("@모두");
    expect(mentionLabel("constructor", {})).toBe("@알 수 없는 사용자");
  });

  it("escapes even names that look like HTML", () => {
    const rendered = renderToStaticMarkup(
      createElement(MessageBody, {
        body: `<@${userId}>`,
        names: { [userId]: "<img src=x>" },
      }),
    );
    expect(rendered).toContain("@&lt;img src=x&gt;");
    expect(rendered).not.toContain("<img");
  });

  it("replaces tokens before truncating at 80 Unicode code points", () => {
    expect(excerptOf(`<@${userId}>${"😀".repeat(90)}`, names)).toBe(
      `@이서연${"😀".repeat(76)}`,
    );
    expect(excerptOf(`${"가".repeat(76)}<@${userId}> 안녕`, names)).toBe(
      `${"가".repeat(76)}@이서연`,
    );
    expect(excerptOf(`<@everyone> <@${otherId}>`, names)).toBe(
      "@모두 @알 수 없는 사용자",
    );
  });

  it("leaves code literal in excerpts just as in the rendered message", () => {
    expect(excerptOf(`\`<@${userId}>\``, names)).toBe(`\`<@${userId}>\``);
    expect(excerptOf("**강조**\n다음 줄", names)).toBe("**강조** 다음 줄");
  });
});

describe("bounded forward parsing", () => {
  it("parses each adversarial 4000-character body well below 10ms on average", () => {
    const samples = [
      "가".repeat(4000),
      "*".repeat(4000),
      "`".repeat(4000),
      "*a ".repeat(1334).slice(0, 4000),
      "https://".repeat(500),
      "https://:bad".repeat(364).slice(0, 4000),
      "https://a(".repeat(400),
      "<@".repeat(2000),
      "**a *b\n".repeat(572).slice(0, 4000),
    ];
    for (const body of samples) {
      for (let i = 0; i < 5; i++) parseMessageBody(body);
      const start = performance.now();
      for (let i = 0; i < 20; i++) parseMessageBody(body);
      expect((performance.now() - start) / 20).toBeLessThan(10);
    }
  });
});
