import { createHash } from "node:crypto";
import { AccessToken, TokenVerifier } from "livekit-server-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callsEnabled,
  createLiveKitServer,
  getLiveKitServer,
} from "@/lib/calls/livekit-server";
import { parseEnv } from "@/lib/env";

const environment = vi.hoisted(() => ({
  values: {} as Record<string, unknown>,
}));
vi.mock("@/lib/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/env")>();
  return { ...original, getEnv: () => original.parseEnv(environment.values) };
});

const config = {
  serverUrl: "wss://calls.example.invalid",
  apiKey: "fake-call-key",
  apiSecret: "fake-secret-for-local-tests-only-12345",
};
const tokenInput = {
  participantId: "b4a676e6-a179-46b3-a1f9-560f2ba485bf",
  userId: "5a255cc4-f5ab-41c3-bb87-ddbd79b88522",
  name: "김하은",
  room: "call:975bfab3-67c8-4aaf-95e0-42011c191a93",
  maxParticipants: 10,
};

beforeEach(() => {
  environment.values = {};
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("LiveKit server adapter without external connections", () => {
  it("is disabled for every incomplete key combination without failing environment parsing", () => {
    for (let mask = 0; mask < 8; mask++) {
      const env = parseEnv({
        LIVEKIT_URL: mask & 1 ? config.serverUrl : "",
        LIVEKIT_API_KEY: mask & 2 ? config.apiKey : "",
        LIVEKIT_API_SECRET: mask & 4 ? config.apiSecret : "",
        NEXT_PUBLIC_LIVEKIT_URL: "wss://must-not-be-used.invalid",
      });
      expect(callsEnabled(env)).toBe(mask === 7);
    }
    expect(callsEnabled()).toBe(false);
    expect(getLiveKitServer()).toBeNull();
    environment.values = {
      NEXT_PUBLIC_LIVEKIT_URL: config.serverUrl,
      LIVEKIT_API_KEY: config.apiKey,
      LIVEKIT_API_SECRET: config.apiSecret,
    };
    expect(getLiveKitServer()).toBeNull();
  });

  it("lazily shares the SDK and signs the exact participant identity, verified attributes, grants and ten-minute expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T04:00:00Z"));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const loadSdk = vi.fn(() => import("livekit-server-sdk"));
    const server = createLiveKitServer(config, { loadSdk });
    expect(loadSdk).not.toHaveBeenCalled();
    expect(server.serverUrl).toBe(config.serverUrl);
    const [token] = await Promise.all([
      server.issueToken(tokenInput),
      server.issueToken({ ...tokenInput, maxParticipants: 25 }),
    ]);
    const verified = await new TokenVerifier(
      config.apiKey,
      config.apiSecret,
    ).verify(token);
    expect(verified.sub).toBe(tokenInput.participantId);
    expect(verified.name).toBe(tokenInput.name);
    expect(verified.attributes).toEqual({
      participantId: tokenInput.participantId,
      userId: tokenInput.userId,
      name: tokenInput.name,
    });
    expect(verified.video).toEqual({
      room: tokenInput.room,
      roomJoin: true,
      canSubscribe: true,
      canPublish: true,
      canPublishSources: [
        "microphone",
        "camera",
        "screen_share",
        "screen_share_audio",
      ],
      canPublishData: false,
      canUpdateOwnMetadata: false,
    });
    expect(verified.roomConfig).toMatchObject({ maxParticipants: 10 });
    expect(verified.exp).toBe(Math.floor(Date.now() / 1000) + 600);
    expect(loadSdk).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["wss://calls.example.invalid", "https:"],
    ["ws://localhost:7880", "http:"],
  ])(
    "lets the installed SDK convert %s for removal",
    async (serverUrl, protocol) => {
      const fetch = vi.fn(
        async () =>
          new Response("{}", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      );
      vi.stubGlobal("fetch", fetch);
      const server = createLiveKitServer({ ...config, serverUrl });
      await server.removeParticipant(tokenInput.room, tokenInput.participantId);
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, request] = fetch.mock.calls[0]! as unknown as [
        URL,
        RequestInit,
      ];
      expect(url.protocol).toBe(protocol);
      expect(url.pathname).toBe("/twirp/livekit.RoomService/RemoveParticipant");
      expect(JSON.parse(String(request.body))).toMatchObject({
        room: tokenInput.room,
        identity: tokenInput.participantId,
      });
    },
  );

  it("contains removal failures and never logs participant IDs, credentials or SDK response bodies", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: "permission_denied",
            msg: "private participant and secret",
          }),
          { status: 403 },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const error = vi.fn();
    await expect(
      createLiveKitServer(config, { logger: { error } }).removeParticipant(
        tokenInput.room,
        tokenInput.participantId,
      ),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledExactlyOnceWith(
      "Call participant removal failed.",
    );
  });

  it("verifies the exact raw webhook body before mapping its minimum fields", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const body = JSON.stringify({
      event: "participant_joined",
      room: { name: tokenInput.room },
      participant: {
        identity: tokenInput.participantId,
        attributes: {
          participantId: tokenInput.participantId,
          userId: tokenInput.userId,
          name: tokenInput.name,
        },
      },
    });
    const token = new AccessToken(config.apiKey, config.apiSecret, { ttl: 60 });
    token.sha256 = createHash("sha256").update(body).digest("base64");
    const header = await token.toJwt();
    const server = createLiveKitServer(config);
    await expect(server.verifyWebhook(body, header)).resolves.toEqual({
      event: "participant_joined",
      roomName: tokenInput.room,
      participant: {
        identity: tokenInput.participantId,
        attributes: {
          participantId: tokenInput.participantId,
          userId: tokenInput.userId,
          name: tokenInput.name,
        },
      },
    });
    await expect(server.verifyWebhook(`${body} `, header)).rejects.toThrow();
    await expect(
      server.verifyWebhook(body, "invalid-signature"),
    ).rejects.toThrow();
    await expect(server.verifyWebhook(body, "")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reuses runtime adapters without loading the SDK or starting network calls", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    environment.values = {
      LIVEKIT_URL: config.serverUrl,
      LIVEKIT_API_KEY: config.apiKey,
      LIVEKIT_API_SECRET: config.apiSecret,
    };
    expect(callsEnabled()).toBe(true);
    const first = getLiveKitServer();
    expect(first?.serverUrl).toBe(config.serverUrl);
    expect(getLiveKitServer()).toBe(first);
    environment.values = {};
    expect(getLiveKitServer()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
