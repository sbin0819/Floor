import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  applyCallChanged,
  CHAT_NAV_KEY,
  chatNavRevision,
  mergeChatNav,
} from "@/features/chat/nav-state";
import type { ChatNav } from "@/features/chat/types";
import type { RealtimeEvent } from "@/lib/realtime/types";

const initial = (): ChatNav => ({
  callsEnabled: true,
  calls: [],
  myCall: null,
  now: "2026-10-08T00:00:00Z",
  myStatus: "online",
  blockedUserIds: [],
  directMessages: [],
  meetings: [],
  spaces: [
    {
      id: "space",
      kind: "team",
      name: "팀",
      initial: "팀",
      iconColor: "blue",
      role: "member",
      muted: false,
      unread: false,
      unreadMentions: 0,
      channels: [
        {
          id: "text",
          name: "일반",
          muted: false,
          unread: false,
          unreadMentions: 0,
        },
      ],
      voiceChannels: [
        {
          id: "voice",
          name: "회의실",
          capacity: 10,
          participantCount: 0,
          participants: [],
        },
      ],
    },
  ],
});
const changed = (
  extra: Partial<Extract<RealtimeEvent, { type: "call.changed" }>> = {},
): Extract<RealtimeEvent, { type: "call.changed" }> => ({
  type: "call.changed",
  roomId: "voice",
  roomKind: "voice",
  spaceId: "space",
  bookingId: null,
  sessionId: "session",
  kind: "voice",
  participantCount: 1,
  participants: [{ userId: "member", name: "김서연" }],
  ...extra,
});
function clientWith(nav = initial()) {
  const client = new QueryClient();
  client.setQueryData(CHAT_NAV_KEY, nav);
  return client;
}
const read = (client: QueryClient) =>
  client.getQueryData<ChatNav>(CHAT_NAV_KEY)!;
describe("call navigation updates", () => {
  it("updates voice roster without changing unread state or text channel identity", () => {
    const nav = initial();
    const client = clientWith(nav);
    applyCallChanged(client, changed());
    expect(read(client).spaces[0]!.voiceChannels[0]).toMatchObject({
      participantCount: 1,
      participants: changed().participants,
    });
    expect(read(client).spaces[0]!.channels).toBe(nav.spaces[0]!.channels);
    expect(read(client).spaces[0]!.unread).toBe(false);
    expect(read(client).calls).toEqual([]);
  });
  it("never adds event names to lounge navigation", () => {
    const nav = initial();
    nav.spaces[0]!.kind = "branch";
    const client = clientWith(nav);
    applyCallChanged(client, changed());
    expect(read(client).spaces[0]!.voiceChannels[0]).toMatchObject({
      participantCount: 1,
      participants: [],
    });
  });
  it("replaces huddle count, deduplicates repeated events and removes ended calls", () => {
    const client = clientWith();
    const event = changed({ roomId: "text", roomKind: "text", kind: "huddle" });
    applyCallChanged(client, event);
    applyCallChanged(client, event);
    expect(read(client).calls).toEqual([
      { roomId: "text", participantCount: 1 },
    ]);
    applyCallChanged(client, { ...event, participantCount: 2 });
    expect(read(client).calls).toEqual([
      { roomId: "text", participantCount: 2 },
    ]);
    applyCallChanged(client, {
      ...event,
      sessionId: null,
      kind: null,
      participantCount: 0,
      participants: [],
    });
    expect(read(client).calls).toEqual([]);
  });
  it("does not expose unknown rooms from an event", () => {
    const client = clientWith();
    const before = read(client);
    applyCallChanged(client, changed({ roomId: "unknown", kind: "huddle" }));
    expect(read(client)).toBe(before);
  });
  it("does not create a cache before navigation arrives", () => {
    const client = new QueryClient();
    applyCallChanged(client, changed());
    expect(client.getQueryData(CHAT_NAV_KEY)).toBeUndefined();
  });
  it("protects an event received during a navigation fetch but accepts the next fresh snapshot", () => {
    const client = clientWith();
    const revision = chatNavRevision(client);
    applyCallChanged(client, changed());
    const merged = mergeChatNav(client, initial(), revision);
    expect(merged.spaces[0]!.voiceChannels[0]!.participantCount).toBe(1);
    const fresh = mergeChatNav(client, initial(), chatNavRevision(client));
    expect(fresh.spaces[0]!.voiceChannels[0]!.participantCount).toBe(0);
  });
  it("does not resurrect ended huddles from an earlier response", () => {
    const nav = initial();
    nav.calls = [{ roomId: "text", participantCount: 1 }];
    const client = clientWith(nav);
    const revision = chatNavRevision(client);
    applyCallChanged(
      client,
      changed({
        roomId: "text",
        kind: null,
        sessionId: null,
        participantCount: 0,
        participants: [],
      }),
    );
    expect(mergeChatNav(client, nav, revision).calls).toEqual([]);
  });
});
