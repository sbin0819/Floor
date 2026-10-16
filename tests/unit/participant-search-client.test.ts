import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchParticipants } from "@/features/bookings/participant-search-client";

const person = {
  userId: "first",
  name: "이서연",
  avatar: { color: "blue" as const, photoUrl: null },
  sharedTeamNames: ["디자인팀"],
  maskedEmail: "se•••@floor.example",
};
afterEach(() => vi.unstubAllGlobals());
describe("participant search transport", () => {
  it("passes the signal and no-store request without exposing the raw query in returned data", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ results: [person] }));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    expect(await fetchParticipants("seoyeon@floor.example", signal)).toEqual([
      person,
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "/api/participants/search?q=seoyeon%40floor.example",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        cache: "no-store",
        credentials: "same-origin",
        method: "GET",
      }),
    );
  });
  it.each([401, 429, 500])(
    "converts HTTP %s to a safe error without exposing the response body",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(new Response("private@example.com", { status })),
      );
      await expect(
        fetchParticipants("이서", new AbortController().signal),
      ).rejects.toMatchObject({ kind: "http", status });
    },
  );
  it.each([
    { ...person, maskedEmail: "seoyeon@floor.example" },
    { ...person, email: "seoyeon@floor.example" },
  ])("rejects a response that discloses a full email", async (result) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ results: [result] })),
    );
    await expect(
      fetchParticipants("이서", new AbortController().signal),
    ).rejects.toMatchObject({
      name: "ApiError",
      kind: "invalid_response",
      status: 200,
    });
  });
  it.each([
    { color: "blue", photoUrl: "https://unsafe.example.test/photo" },
    { color: "blue", photoUrl: null, avatarPhoto: true },
    { color: "unknown", photoUrl: null },
  ])("rejects unsafe or expanded avatar data", async (avatar) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ results: [{ ...person, avatar }] })),
    );
    await expect(
      fetchParticipants("이서", new AbortController().signal),
    ).rejects.toMatchObject({
      name: "ApiError",
      kind: "invalid_response",
      status: 200,
    });
  });
  it("replaces malformed response details with a fixed safe error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("private@example.com")),
    );
    await expect(
      fetchParticipants("이서", new AbortController().signal),
    ).rejects.toMatchObject({
      name: "ApiError",
      kind: "invalid_response",
      status: 200,
    });
  });
});
