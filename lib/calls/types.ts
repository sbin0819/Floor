export type CallKind = "voice" | "huddle";

export type CallTokenInput = {
  participantId: string;
  userId: string;
  name: string;
  room: string;
  maxParticipants: number;
};

export type CallWebhookEvent = {
  event: string;
  roomName?: string;
  participant?: {
    identity: string;
    attributes: Record<string, string>;
  };
};

export interface LiveKitServer {
  readonly serverUrl: string;
  issueToken(input: CallTokenInput): Promise<string>;
  removeParticipant(room: string, participantId: string): Promise<void>;
  verifyWebhook(body: string, authHeader: string): Promise<CallWebhookEvent>;
}
