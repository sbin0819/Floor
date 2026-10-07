import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBookingNow } from "@/features/bookings/request-clock";

const request = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  keys: [] as unknown[][],
}));
vi.mock("react", () => ({
  cache:
    <Arguments extends unknown[], Result>(fn: (...args: Arguments) => Result) =>
    (...args: Arguments): Result => {
      request.keys.push(args);
      const key = JSON.stringify(args);
      if (!request.values.has(key)) request.values.set(key, fn(...args));
      return request.values.get(key) as Result;
    },
}));
beforeEach(() => {
  request.values.clear();
  request.keys.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("request-scoped booking instant", () => {
  it("shares one primitive instant across cards and returns independent Date objects", () => {
    const clock = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(2_000);
    const first = readBookingNow();
    first.setTime(50_000);
    expect(readBookingNow().getTime()).toBe(1_000);
    expect(clock).toHaveBeenCalledTimes(1);
    expect(request.keys).toEqual([[], []]);
    expect([...request.values.values()]).toEqual([1_000]);
  });

  it("bypasses request memo when a database is injected", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(2_000);
    expect(readBookingNow(true).getTime()).toBe(1_000);
    expect(readBookingNow(true).getTime()).toBe(2_000);
    expect(request.keys).toEqual([]);
  });

  it("does not reuse an instant across request cache lifetimes", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValueOnce(2_000);
    expect(readBookingNow().getTime()).toBe(1_000);
    request.values.clear();
    expect(readBookingNow().getTime()).toBe(2_000);
  });
});
