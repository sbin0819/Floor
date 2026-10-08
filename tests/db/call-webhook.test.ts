import { and, eq, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createCallService } from "@/features/calls/service";
import { createCallWebhookHandler } from "@/features/calls/webhook";
import type { CallWebhookEvent, LiveKitServer } from "@/lib/calls/types";
import * as callRead from "@/lib/dal/call-read";
import { callParticipants, callSessions, messages } from "@/lib/db/schema";
import type { RealtimeItem } from "@/lib/realtime/types";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("verified LiveKit participant webhooks", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  let now: Date;
  let event: CallWebhookEvent;
  const removeParticipant = vi.fn<LiveKitServer["removeParticipant"]>();
  const verifyWebhook = vi.fn<LiveKitServer["verifyWebhook"]>();
  const logError = vi.fn();
  const events: RealtimeItem[] = [];
  const publisher = {
    publish: vi.fn(),
    publishMany: vi.fn(async (items: readonly RealtimeItem[]) => {
      events.push(...items);
    }),
  };
  const livekit: LiveKitServer = {
    serverUrl: "wss://fake.invalid",
    issueToken: async () => "fake-token",
    removeParticipant,
    verifyWebhook,
  };
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await database.db.execute(sql`truncate users, branches cascade`);
    actors = await seedChatActors(database);
    now = new Date(chatNow);
    events.length = 0;
    event = { event: "ignored" };
    verifyWebhook.mockImplementation(async () => event);
    removeParticipant.mockResolvedValue();
  });
  const deps = () => ({
    database: database.db,
    now: () => now,
    livekit,
    publisher,
    logError,
  });
  const join = () =>
    createCallService(deps()).join(actors.member, actors.roomId);
  const post = (extra = {}) =>
    createCallWebhookHandler({ ...deps(), ...extra })(
      new Request("https://floor.test/api/livekit/webhook", {
        method: "POST",
        body: '{ "private":"raw body" }',
        headers: { Authorization: "fake-auth" },
      }),
    );
  const participant = async (id: string) =>
    (
      await database.db
        .select()
        .from(callParticipants)
        .where(eq(callParticipants.id, id))
    )[0]!;
  function incoming(
    participantId: string,
    type: "participant_joined" | "participant_left" = "participant_joined",
  ) {
    event = {
      event: type,
      roomName: `call:${actors.roomId}`,
      participant: {
        identity: participantId,
        attributes: {
          participantId,
          userId: actors.member.userId,
          name: actors.member.name,
        },
      },
    };
  }

  it("returns disabled 404 and unsigned 401 before DB access without exposing payloads", async () => {
    const read = vi.spyOn(callRead, "readCallRoom");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let result = await post({ livekit: null });
    expect(result.status).toBe(404);
    expect(verifyWebhook).not.toHaveBeenCalled();
    verifyWebhook.mockRejectedValue(new Error("raw body and secret"));
    result = await post();
    expect(result.status).toBe(401);
    expect(await result.text()).toBe("");
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(read).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(verifyWebhook).toHaveBeenCalledExactlyOnceWith(
      '{ "private":"raw body" }',
      "fake-auth",
    );
  });
  it("touches only the matching current participant without adding messages or repeating an entry event", async () => {
    const joined = await join();
    const before = (await database.db.select().from(messages)).length;
    events.length = 0;
    now = new Date(chatNow.getTime() + 30_000);
    incoming(joined.participantId);
    expect((await post()).status).toBe(200);
    expect((await participant(joined.participantId)).lastSeenAt).toEqual(now);
    expect((await post()).status).toBe(200);
    expect((await database.db.select().from(messages)).length).toBe(before);
    expect(events).toHaveLength(0);
    expect(removeParticipant).not.toHaveBeenCalled();
  });
  it("publishes one count change when a stale joined participant becomes active again", async () => {
    const joined = await join();
    events.length = 0;
    now = new Date(chatNow.getTime() + 120_000);
    incoming(joined.participantId);
    expect((await post()).status).toBe(200);
    const changed = events.filter(({ event }) => event.type === "call.changed");
    expect(changed).toHaveLength(2);
    expect(
      changed.every(
        ({ event }) =>
          event.type === "call.changed" && event.participantCount === 1,
      ),
    ).toBe(true);
    events.length = 0;
    expect((await post()).status).toBe(200);
    expect(events).toHaveLength(0);
  });
  it("closes exactly the old participant and never a replacement from reversed delivery", async () => {
    const old = await join();
    const latest = await join();
    removeParticipant.mockClear();
    events.length = 0;
    incoming(old.participantId, "participant_left");
    expect((await post()).status).toBe(200);
    expect((await participant(latest.participantId)).leftAt).toBeNull();
    expect(events).toHaveLength(0);
    incoming(old.participantId);
    expect((await post()).status).toBe(200);
    expect(removeParticipant).toHaveBeenCalledExactlyOnceWith(
      `call:${actors.roomId}`,
      old.participantId,
    );
    expect((await participant(latest.participantId)).leftAt).toBeNull();
    expect(
      (
        await database.db
          .select()
          .from(callSessions)
          .where(eq(callSessions.id, latest.sessionId))
      )[0]?.endedAt,
    ).toBeNull();
  });
  it.each([
    "missing",
    "mismatched-identity",
    "mismatched-user",
    "mismatched-room",
    "unknown",
  ])(
    "rejects a %s participant proof without changing any valid participant",
    async (kind) => {
      const joined = await join();
      incoming(joined.participantId);
      if (kind === "missing") event.participant!.attributes = {};
      if (kind === "mismatched-identity")
        event.participant!.attributes.participantId = crypto.randomUUID();
      if (kind === "mismatched-user")
        event.participant!.attributes.userId = actors.admin.userId;
      if (kind === "mismatched-room")
        event.roomName = `call:${actors.secondRoomId}`;
      if (kind === "unknown") {
        const id = crypto.randomUUID();
        incoming(id);
      }
      now = new Date(chatNow.getTime() + 30_000);
      expect((await post()).status).toBe(200);
      expect(removeParticipant).toHaveBeenCalledExactlyOnceWith(
        event.roomName,
        event.participant!.identity,
      );
      expect(await participant(joined.participantId)).toMatchObject({
        leftAt: null,
        lastSeenAt: chatNow,
      });
    },
  );
  it("ends a last participant once, closes stale rows at lastSeen and uses exact IDs for removal", async () => {
    const joined = await join();
    await database.db.insert(callParticipants).values({
      sessionId: joined.sessionId,
      userId: actors.admin.userId,
      joinedAt: chatNow,
      lastSeenAt: chatNow,
    });
    now = new Date(chatNow.getTime() + 5 * 60_000);
    incoming(joined.participantId, "participant_left");
    expect((await post()).status).toBe(200);
    const ended = (await database.db.select().from(callSessions))[0]!;
    expect(ended.endedAt).toEqual(now);
    const stale = (
      await database.db
        .select()
        .from(callParticipants)
        .where(
          and(
            eq(callParticipants.sessionId, joined.sessionId),
            eq(callParticipants.userId, actors.admin.userId),
          ),
        )
    )[0]!;
    expect(stale.leftAt).toEqual(stale.lastSeenAt);
    const count = events.length;
    expect((await post()).status).toBe(200);
    expect(events).toHaveLength(count);
    expect(
      (await database.db.select().from(messages)).filter(
        (message) => message.systemData?.type === "huddle_ended",
      ),
    ).toHaveLength(1);
  });
  it("ignores mismatched user proof on participant_left", async () => {
    const joined = await join();
    incoming(joined.participantId, "participant_left");
    event.participant!.attributes.userId = actors.admin.userId;
    expect((await post()).status).toBe(200);
    expect((await participant(joined.participantId)).leftAt).toBeNull();
    expect(removeParticipant).not.toHaveBeenCalled();
  });
  it("returns only a fixed processing failure and keeps raw webhook content out of logs", async () => {
    const joined = await join();
    incoming(joined.participantId);
    vi.spyOn(callRead, "readCallRoom").mockRejectedValueOnce(
      new Error("private raw body"),
    );
    const result = await post();
    expect(result.status).toBe(500);
    expect(await result.text()).toBe("");
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      "Call webhook processing failed.",
    );
  });
  it.each(["room_finished", "track_published", "room_started"])(
    "ignores %s even with a valid room and participant",
    async (type) => {
      const joined = await join();
      incoming(joined.participantId);
      event.event = type;
      const read = vi.spyOn(callRead, "readCallRoom");
      expect((await post()).status).toBe(200);
      expect(read).not.toHaveBeenCalled();
      expect((await participant(joined.participantId)).leftAt).toBeNull();
    },
  );
  it.each(["unrelated-room", "call:not-uuid", `call:${crypto.randomUUID()}`])(
    "ignores unknown room %s",
    async (roomName) => {
      event = {
        event: "participant_joined",
        roomName,
        participant: { identity: crypto.randomUUID(), attributes: {} },
      };
      expect((await post()).status).toBe(200);
      expect(removeParticipant).not.toHaveBeenCalled();
    },
  );
});
