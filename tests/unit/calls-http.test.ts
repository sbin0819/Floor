import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCallHttpHandlers } from "@/features/calls/http";
import type { Session } from "@/lib/auth/types";

const runtime = vi.hoisted(() => ({
  getSession: vi.fn(),
  enabled: vi.fn(),
  service: vi.fn(),
  heartbeat: vi.fn(),
  leave: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ getSession: runtime.getSession }));
vi.mock("@/lib/calls/livekit-server", () => ({
  callsEnabled: runtime.enabled,
}));
vi.mock("@/features/calls/service", () => ({
  createCallService: runtime.service,
}));

const userId = "11111111-1111-4111-8111-111111111111";
const participantId = "22222222-2222-4222-8222-222222222222";
const otherUserId = "33333333-3333-4333-8333-333333333333";
const otherParticipantId = "44444444-4444-4444-8444-444444444444";
const session: Session = {
  userId,
  email: "private@floor.test",
  name: "김하은",
};
const methods = ["heartbeat", "leave"] as const;

function setup() {
  const getSession = vi.fn(async (): Promise<Session | null> => session);
  const enabled = vi.fn(() => true);
  const heartbeat = vi.fn(async () => true);
  const leave = vi.fn(async () => true);
  const deps = { getSession, enabled, heartbeat, leave };
  return { ...deps, handlers: createCallHttpHandlers(deps) };
}
function request(
  method: (typeof methods)[number],
  {
    origin = "https://floor.test",
    body = JSON.stringify({ participantId }),
    contentType = "application/json",
  }: {
    origin?: string | null;
    body?: string;
    contentType?: string;
  } = {},
) {
  const headers = new Headers({ "Content-Type": contentType });
  if (origin !== null) headers.set("Origin", origin);
  return new Request(`https://floor.test/api/calls/${method}`, {
    method: "POST",
    headers,
    body,
  });
}
async function expectResponse(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Location")).toBeNull();
  expect(await response.text()).toBe("");
}

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe.each(methods)("call %s HTTP boundary", (method) => {
  it("checks the session before origin, enabled state, input or service access", async () => {
    const deps = setup();
    deps.getSession.mockResolvedValue(null);
    deps.enabled.mockReturnValue(false);
    const req = request(method, {
      origin: "https://other.test",
      body: "bad json",
    });
    const readBody = vi.spyOn(req, "json");
    await expectResponse(await deps.handlers[method](req), 401);
    expect(deps.getSession).toHaveBeenCalledExactlyOnceWith();
    expect(deps.enabled).not.toHaveBeenCalled();
    expect(readBody).not.toHaveBeenCalled();
    expect(deps[method]).not.toHaveBeenCalled();
  });

  it.each([null, "https://other.test", "null"])(
    "rejects Origin %s before configuration and input",
    async (origin) => {
      const deps = setup();
      deps.enabled.mockReturnValue(false);
      const req = request(method, { origin, body: "bad json" });
      const readBody = vi.spyOn(req, "json");
      await expectResponse(await deps.handlers[method](req), 403);
      expect(deps.enabled).not.toHaveBeenCalled();
      expect(readBody).not.toHaveBeenCalled();
      expect(deps[method]).not.toHaveBeenCalled();
    },
  );

  it("returns disabled 404 before reading invalid input or creating a DB service", async () => {
    const deps = setup();
    deps.enabled.mockReturnValue(false);
    const req = request(method, { body: "bad json" });
    const readBody = vi.spyOn(req, "json");
    await expectResponse(await deps.handlers[method](req), 404);
    expect(deps.enabled).toHaveBeenCalledExactlyOnceWith();
    expect(readBody).not.toHaveBeenCalled();
    expect(deps[method]).not.toHaveBeenCalled();
  });

  it.each([
    "",
    "bad json",
    "null",
    "[]",
    "{}",
    JSON.stringify({ participantId: "not-a-uuid" }),
    JSON.stringify({ participantId: 5 }),
    JSON.stringify({ participantId, userId: otherUserId }),
    JSON.stringify({ participantId, sessionId: otherParticipantId }),
  ])(
    "rejects invalid or extra input %s without running a service",
    async (body) => {
      const deps = setup();
      await expectResponse(
        await deps.handlers[method](request(method, { body })),
        400,
      );
      expect(deps[method]).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    },
  );

  it.each(["application/json", "text/plain;charset=UTF-8"])(
    "accepts JSON sent as %s for fetch and sendBeacon",
    async (contentType) => {
      const deps = setup();
      const req = request(method, { contentType });
      const readBody = vi.spyOn(req, "json");
      await expectResponse(await deps.handlers[method](req), 204);
      expect(deps[method]).toHaveBeenCalledExactlyOnceWith({
        userId,
        participantId,
      });
      expect(deps.getSession.mock.invocationCallOrder[0]).toBeLessThan(
        deps.enabled.mock.invocationCallOrder[0]!,
      );
      expect(deps.enabled.mock.invocationCallOrder[0]).toBeLessThan(
        readBody.mock.invocationCallOrder[0]!,
      );
      expect(readBody.mock.invocationCallOrder[0]).toBeLessThan(
        deps[method].mock.invocationCallOrder[0]!,
      );
      expect(
        deps[method === "heartbeat" ? "leave" : "heartbeat"],
      ).not.toHaveBeenCalled();
    },
  );

  it("maps a missing or foreign participation to the same empty 404", async () => {
    const deps = setup();
    deps[method].mockResolvedValue(false);
    await expectResponse(await deps.handlers[method](request(method)), 404);
  });

  it.each(["session", "configuration", "service"])(
    "hides %s failures and logs only a fixed message",
    async (source) => {
      const deps = setup();
      const error = new Error(
        "secret-token private@floor.test SELECT private body",
      );
      if (source === "session") deps.getSession.mockRejectedValue(error);
      else if (source === "configuration")
        deps.enabled.mockImplementation(() => {
          throw error;
        });
      else deps[method].mockRejectedValue(error);
      await expectResponse(await deps.handlers[method](request(method)), 500);
      expect(console.error).toHaveBeenCalledExactlyOnceWith(
        "Call request failed.",
      );
    },
  );
});

it("treats leaving an already closed own participation as success but never touches its replacement", async () => {
  const deps = setup();
  const participants = new Map([
    [participantId, { userId, left: true }],
    [otherParticipantId, { userId, left: false }],
  ]);
  const leave = vi.fn(
    async (input: { userId: string; participantId: string }) => {
      const row = participants.get(input.participantId);
      if (!row || row.userId !== input.userId) return false;
      row.left = true;
      return true;
    },
  );
  const heartbeat = vi.fn(
    async (input: { userId: string; participantId: string }) => {
      const row = participants.get(input.participantId);
      return !!row && row.userId === input.userId && !row.left;
    },
  );
  const handlers = createCallHttpHandlers({ ...deps, leave, heartbeat });
  await expectResponse(await handlers.leave(request("leave")), 204);
  await expectResponse(await handlers.leave(request("leave")), 204);
  await expectResponse(await handlers.heartbeat(request("heartbeat")), 404);
  expect(participants.get(otherParticipantId)?.left).toBe(false);
  expect(leave.mock.calls.map(([input]) => input.participantId)).toEqual([
    participantId,
    participantId,
  ]);
});

describe.each(methods)("runtime call %s wiring", (method) => {
  beforeEach(() => {
    for (const mock of Object.values(runtime)) mock.mockReset();
    runtime.getSession.mockResolvedValue(session);
    runtime.enabled.mockReturnValue(true);
    runtime.service.mockReturnValue({
      heartbeat: runtime.heartbeat,
      leave: runtime.leave,
    });
    runtime.heartbeat.mockResolvedValue(true);
    runtime.leave.mockResolvedValue(true);
  });

  it("does not initialize the call service when anonymous", async () => {
    runtime.getSession.mockResolvedValue(null);
    await expectResponse(
      await createCallHttpHandlers()[method](request(method)),
      401,
    );
    expect(runtime.enabled).not.toHaveBeenCalled();
    expect(runtime.service).not.toHaveBeenCalled();
  });

  it("does not initialize configuration or service for a cross-site write", async () => {
    await expectResponse(
      await createCallHttpHandlers()[method](request(method, { origin: null })),
      403,
    );
    expect(runtime.enabled).not.toHaveBeenCalled();
    expect(runtime.service).not.toHaveBeenCalled();
  });

  it("does not initialize the call service when LiveKit is disabled", async () => {
    runtime.enabled.mockReturnValue(false);
    await expectResponse(
      await createCallHttpHandlers()[method](request(method)),
      404,
    );
    expect(runtime.service).not.toHaveBeenCalled();
  });

  it("does not initialize the call service for invalid input", async () => {
    await expectResponse(
      await createCallHttpHandlers()[method](request(method, { body: "{}" })),
      400,
    );
    expect(runtime.service).not.toHaveBeenCalled();
  });

  it("creates the service only after validation and passes the authenticated user ID", async () => {
    await expectResponse(
      await createCallHttpHandlers()[method](request(method)),
      204,
    );
    expect(runtime.service).toHaveBeenCalledExactlyOnceWith();
    expect(runtime[method]).toHaveBeenCalledExactlyOnceWith({
      userId,
      participantId,
    });
    expect(
      runtime[method === "heartbeat" ? "leave" : "heartbeat"],
    ).not.toHaveBeenCalled();
  });
});
