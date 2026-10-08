// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { readRecentRooms, rememberRoom } from "@/features/chat/recent-rooms";
import { id } from "./quick-switch-fixture";
beforeEach(() => localStorage.clear());
it("stores only ids, separated per account, and keeps the most recent five without duplicates", () => {
  for (let n = 1; n <= 7; n++) rememberRoom(id(20), id(n));
  rememberRoom(id(20), id(4));
  rememberRoom(id(21), id(1));
  expect(readRecentRooms(id(20))).toEqual([4, 7, 6, 5, 3].map(id));
  expect(readRecentRooms(id(21))).toEqual([id(1)]);
  expect(readRecentRooms(id(22))).toEqual([]);
  expect(localStorage.getItem(`floor:recent-rooms:${id(20)}`)).toBe(
    JSON.stringify([4, 7, 6, 5, 3].map(id)),
  );
});
it.each(["{", "{}", '["https://evil.test",1,null]'])(
  "ignores corrupt or untrusted storage %s",
  (value) => {
    localStorage.setItem(`floor:recent-rooms:${id(20)}`, value);
    expect(readRecentRooms(id(20))).toEqual([]);
    rememberRoom(id(20), "javascript:alert(1)");
    expect(localStorage.getItem(`floor:recent-rooms:${id(20)}`)).toBe(value);
  },
);
it("survives storage access, read and write failures", () => {
  const spy = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new Error("denied");
  });
  expect(readRecentRooms(id(20))).toEqual([]);
  expect(() => rememberRoom(id(20), id(1))).not.toThrow();
  spy.mockRestore();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  expect(() => rememberRoom(id(20), id(1))).not.toThrow();
  vi.restoreAllMocks();
});
