import { describe, expect, it } from "vitest";
import {
  filterQuickSwitchItems,
  quickSwitchItems,
  quickSwitchShortcut,
} from "@/features/chat/quick-switch";
import { nav, contacts, id } from "./quick-switch-fixture";

describe("quick switch list", () => {
  const items = quickSwitchItems(nav, contacts);
  it("uses rooms, spaces and safe people from the existing navigation", () => {
    expect(
      items.filter(({ kind }) => kind === "room").map(({ href }) => href),
    ).toEqual([
      `/s/${id(1)}/${id(2)}`,
      `/s/${id(1)}/${id(3)}`,
      `/dm/${id(4)}`,
      `/dm/${id(5)}`,
      `/m/${id(7)}`,
    ]);
    expect(items.find(({ kind }) => kind === "space")?.href).toBe(
      `/s/${id(1)}`,
    );
    expect(
      items.filter(({ kind }) => kind === "person").map(({ href }) => href),
    ).toEqual([`/dm/${id(4)}`, null]);
    expect(
      quickSwitchItems({ ...nav, blockedUserIds: [id(20)] }, contacts).some(
        (row) => row.kind === "person" && row.id === id(20),
      ),
    ).toBe(false);
    expect(quickSwitchItems(undefined, contacts)).toEqual([]);
  });
  it("matches NFC, case-insensitive usernames, space names and group member names", () => {
    expect(
      filterQuickSwitchItems(items, "한글", []).map(({ id }) => id),
    ).toEqual([id(2), id(3), id(1)]);
    expect(filterQuickSwitchItems(items, " HaEuN ", [])).toHaveLength(2);
    expect(filterQuickSwitchItems(items, "서연", [])[0]?.id).toBe(id(5));
    expect(filterQuickSwitchItems(items, "회의실", [])[0]?.id).toBe(id(6));
    expect(filterQuickSwitchItems(items, "ㅎㄱ", [])).toEqual([]);
  });
  it("shows recent rooms in order then unread rooms exactly once, never unlisted ids", () => {
    expect(
      filterQuickSwitchItems(items, " ", [id(3), id(2), id(99)]).map(
        ({ id }) => id,
      ),
    ).toEqual([id(3), id(2), id(5), id(6)]);
    const muted = structuredClone(nav);
    muted.spaces[0]!.muted = true;
    expect(
      filterQuickSwitchItems(quickSwitchItems(muted, contacts), "", []).map(
        ({ id }) => id,
      ),
    ).toEqual([id(5), id(6)]);
  });
});

describe("quick switch shortcut", () => {
  const event = {
    key: "k",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    keyCode: 75,
  };
  it.each(["MacIntel", "iPad"])("uses meta on %s", (platform) => {
    expect(quickSwitchShortcut({ ...event, metaKey: true }, platform)).toBe(
      true,
    );
    expect(quickSwitchShortcut({ ...event, ctrlKey: true }, platform)).toBe(
      false,
    );
  });
  it.each(["Win32", "Linux x86_64"])("uses control on %s", (platform) => {
    expect(quickSwitchShortcut({ ...event, ctrlKey: true }, platform)).toBe(
      true,
    );
    expect(quickSwitchShortcut({ ...event, metaKey: true }, platform)).toBe(
      false,
    );
  });
  it.each([
    { isComposing: true },
    { keyCode: 229 },
    { altKey: true },
    { shiftKey: true },
    { key: "a" },
  ])("ignores composition and other shortcuts %o", (extra) => {
    expect(
      quickSwitchShortcut({ ...event, ctrlKey: true, ...extra }, "Win32"),
    ).toBe(false);
  });
});
