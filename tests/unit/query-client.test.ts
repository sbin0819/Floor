import { afterEach, describe, expect, it, vi } from "vitest";
import { environmentManager } from "@tanstack/react-query";
import { getQueryClient } from "@/app/providers";

afterEach(() => vi.restoreAllMocks());

describe("query client lifetime", () => {
  it("isolates server requests", () => {
    vi.spyOn(environmentManager, "isServer").mockReturnValue(true);
    expect(getQueryClient()).not.toBe(getQueryClient());
  });
  it("keeps one client in the browser", () => {
    vi.spyOn(environmentManager, "isServer").mockReturnValue(false);
    expect(getQueryClient()).toBe(getQueryClient());
    expect(getQueryClient().getDefaultOptions().queries?.staleTime).toBe(
      60_000,
    );
  });
});
