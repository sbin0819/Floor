import { describe, expect, it } from "vitest";
import {
  chooseMention,
  filterMentionCandidates,
  findMentionQuery,
  fromMessageBody,
  toMessageBody,
  updateMentionInput,
} from "@/features/chat/mention-input";
const id = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const names = new Map([
  [id, "이서연"],
  [other, "박지훈"],
]);

describe("selected mention input", () => {
  it("roundtrips known selected tokens without changing formatting or code", () => {
    const body = `**<@${id}>** \`<@${other}>\`\n\`\`\`ts\n<@${id}>\n\`\`\``;
    const value = fromMessageBody(body, names);
    expect(value.text).toContain("**@이서연**");
    expect(value.mentions).toHaveLength(1);
    expect(toMessageBody(value)).toBe(body);
  });
  it("keeps unknown tokens and non-admin everyone literal while administrators edit selected everyone", () => {
    const body = `<@${other}> <@everyone>`;
    expect(fromMessageBody(body)).toEqual({ text: body, mentions: [] });
    const admin = fromMessageBody(body, {}, true);
    expect(admin.text).toBe(`<@${other}> @모두`);
    expect(toMessageBody(admin)).toBe(body);
  });
  it("never interprets manually typed names as selected mentions", () => {
    expect(toMessageBody({ text: "@이서연", mentions: [] })).toBe("@이서연");
  });
  it("tracks UTF-16 ranges through insertion before and after a selected name", () => {
    const value = fromMessageBody(`<@${id}> 안녕`, names);
    const before = updateMentionInput(value, "👋 " + value.text);
    expect(before.mentions[0]?.start).toBe(3);
    expect(toMessageBody(before)).toBe(`👋 <@${id}> 안녕`);
    expect(toMessageBody(updateMentionInput(before, before.text + "!"))).toBe(
      `👋 <@${id}> 안녕!`,
    );
  });
  it.each(["@이서영 안녕", "@이서연님 안녕", "이서연 안녕", "@서연 안녕"])(
    "releases a mention when its selected label changes: %s",
    (text) => {
      expect(
        updateMentionInput(fromMessageBody(`<@${id}> 안녕`, names), text)
          .mentions,
      ).toEqual([]);
    },
  );
  it("does not confuse two people with identical names", () => {
    const value = fromMessageBody(
      `<@${id}> <@${other}>`,
      new Map([
        [id, "김민수"],
        [other, "김민수"],
      ]),
    );
    expect(toMessageBody(value)).toBe(`<@${id}> <@${other}>`);
  });
  it("recognizes incomplete queries but not email addresses or selected names", () => {
    expect(findMentionQuery({ text: "안녕 @이", mentions: [] }, 5)).toEqual({
      start: 3,
      end: 5,
      query: "이",
    });
    expect(findMentionQuery({ text: "a@b.com", mentions: [] }, 7)).toBeNull();
    expect(findMentionQuery(fromMessageBody(`<@${id}>`, names), 4)).toBeNull();
  });
  it("chooses one suggestion, inserts a separator, and ignores a stale query", () => {
    const value = { text: "안녕 @이", mentions: [] };
    const query = findMentionQuery(value, 5)!;
    const chosen = chooseMention(value, query, { userId: id, name: "이서연" });
    expect(chosen.caret).toBe(8);
    expect(chosen.value.text).toBe("안녕 @이서연 ");
    expect(toMessageBody(chosen.value)).toBe(`안녕 <@${id}> `);
    const stale = { text: "안녕 새내용", mentions: [] };
    expect(
      chooseMention(stale, query, { userId: id, name: "이서연" }).value,
    ).toBe(stale);
  });
  it("limits matched people to eight, deduplicates IDs, and only offers everyone to admins", () => {
    const members = Array.from({ length: 12 }, (_, index) => ({
      userId: String(index),
      name: `김민수${index}`,
    }));
    expect(
      filterMentionCandidates([...members, members[0]!], "김"),
    ).toHaveLength(8);
    expect(filterMentionCandidates(members, "", true).at(-1)).toEqual({
      userId: "everyone",
      name: "모두",
    });
    expect(filterMentionCandidates(members, "모두")).toEqual([]);
  });
});
