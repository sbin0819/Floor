import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "@/app/api/space-photos/[file]/route";
import { getSpacePhoto } from "@/features/admin/photo-queries";
import { getAdminSpace } from "@/features/admin/queries";

const calls = vi.hoisted(() => ({
  connection: vi.fn(),
  getSpacePhoto: vi.fn(),
  getAdminSpace: vi.fn(),
}));
vi.mock("next/server", () => ({ connection: calls.connection }));
vi.mock("@/features/admin/photo-query-factory", () => ({
  createSpacePhotoQueries: () => calls,
}));
vi.mock("@/features/admin/space-detail-query-factory", () => ({
  createAdminSpaceQueries: () => calls,
}));
beforeEach(() => vi.resetAllMocks());
it("awaits connection and asynchronous file params before delegating to the guarded query", async () => {
  let connected: (() => void) | undefined;
  calls.connection.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        connected = resolve;
      }),
  );
  const response = new Response("image");
  calls.getSpacePhoto.mockResolvedValue(response);
  const result = GET(
    new Request("https://floor.test/api/space-photos/example.webp"),
    { params: Promise.resolve({ file: "example.webp" }) },
  );
  expect(calls.getSpacePhoto).not.toHaveBeenCalled();
  connected?.();
  expect(await result).toBe(response);
  expect(calls.getSpacePhoto).toHaveBeenCalledExactlyOnceWith("example.webp");
});
it("never caches or reuses a consumed photo Response", async () => {
  calls.getSpacePhoto.mockImplementation(async () => new Response("image"));
  const first = await getSpacePhoto("example.webp"),
    second = await getSpacePhoto("example.webp");
  expect(first).not.toBe(second);
  expect(await first.text()).toBe("image");
  expect(await second.text()).toBe("image");
  expect(calls.getSpacePhoto).toHaveBeenCalledTimes(2);
});
it("forwards all actual parent IDs and tab/search options through the public RSC query", async () => {
  const result = { space: { id: "space" } };
  calls.getAdminSpace.mockResolvedValue(result);
  const options = { tab: "access" as const, team: "그로스" };
  expect(await getAdminSpace("branch", "floor", "space", options)).toBe(result);
  expect(calls.getAdminSpace).toHaveBeenCalledExactlyOnceWith(
    "branch",
    "floor",
    "space",
    options,
  );
});
