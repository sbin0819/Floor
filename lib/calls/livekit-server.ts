import { getEnv } from "@/lib/env";
import type { LiveKitServer } from "./types";

type LiveKitEnvironment = Pick<
  ReturnType<typeof getEnv>,
  "LIVEKIT_URL" | "LIVEKIT_API_KEY" | "LIVEKIT_API_SECRET"
>;
type LiveKitSdk = typeof import("livekit-server-sdk");
export type LiveKitConfig = {
  serverUrl: string;
  apiKey: string;
  apiSecret: string;
};

export function callsEnabled(env: LiveKitEnvironment = getEnv()): boolean {
  return Boolean(
    env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET,
  );
}

export function createLiveKitServer(
  config: LiveKitConfig,
  dependencies: {
    loadSdk?: () => Promise<LiveKitSdk>;
    logger?: Pick<Console, "error">;
  } = {},
): LiveKitServer {
  const loadSdk = dependencies.loadSdk ?? (() => import("livekit-server-sdk"));
  const logger = dependencies.logger ?? console;
  let sdk: Promise<LiveKitSdk> | undefined;
  let roomService: InstanceType<LiveKitSdk["RoomServiceClient"]> | undefined;
  let receiver: InstanceType<LiveKitSdk["WebhookReceiver"]> | undefined;
  const getSdk = () => (sdk ??= loadSdk());

  return {
    serverUrl: config.serverUrl,
    async issueToken(input) {
      const { AccessToken, RoomConfiguration, TrackSource } = await getSdk();
      const token = new AccessToken(config.apiKey, config.apiSecret, {
        identity: input.participantId,
        name: input.name,
        attributes: {
          participantId: input.participantId,
          userId: input.userId,
          name: input.name,
        },
        ttl: 600,
      });
      token.addGrant({
        room: input.room,
        roomJoin: true,
        canSubscribe: true,
        canPublish: true,
        canPublishSources: [
          TrackSource.MICROPHONE,
          TrackSource.CAMERA,
          TrackSource.SCREEN_SHARE,
          TrackSource.SCREEN_SHARE_AUDIO,
        ],
        canPublishData: false,
        canUpdateOwnMetadata: false,
      });
      token.roomConfig = new RoomConfiguration({
        maxParticipants: input.maxParticipants,
      });
      return token.toJwt();
    },
    async removeParticipant(room, participantId) {
      try {
        const { RoomServiceClient } = await getSdk();
        // 설치된 SDK가 ws(s) 주소를 HTTP(S)로 바꾸므로 같은 서버 주소를 쓴다.
        roomService ??= new RoomServiceClient(
          config.serverUrl,
          config.apiKey,
          config.apiSecret,
        );
        await roomService.removeParticipant(room, participantId);
      } catch {
        logger.error("Call participant removal failed.");
      }
    },
    async verifyWebhook(body, authHeader) {
      const { WebhookReceiver } = await getSdk();
      receiver ??= new WebhookReceiver(config.apiKey, config.apiSecret);
      const event = await receiver.receive(body, authHeader);
      return {
        event: event.event,
        ...(event.room ? { roomName: event.room.name } : {}),
        ...(event.participant
          ? {
              participant: {
                identity: event.participant.identity,
                attributes: event.participant.attributes,
              },
            }
          : {}),
      };
    },
  };
}

let runtime: { config: LiveKitConfig; server: LiveKitServer } | undefined;

export function getLiveKitServer(): LiveKitServer | null {
  const env = getEnv();
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET)
    return null;
  const config = {
    serverUrl: env.LIVEKIT_URL,
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
  };
  if (
    !runtime ||
    runtime.config.serverUrl !== config.serverUrl ||
    runtime.config.apiKey !== config.apiKey ||
    runtime.config.apiSecret !== config.apiSecret
  ) {
    runtime = { config, server: createLiveKitServer(config) };
  }
  return runtime.server;
}
