export type CallKind = "voice" | "huddle";
export type CallPerson = { userId: string; name: string };
export type CallView = {
  sessionId: string;
  kind: CallKind;
  startedAt: string;
  participantCount: number;
  participants: CallPerson[];
};
export type JoinedCall = {
  participantId: string;
  sessionId: string;
  serverUrl: string;
  token: string;
  room: string;
  kind: CallKind;
};

export type MyCall = {
  participantId: string;
  sessionId: string;
  roomId: string;
  kind: CallKind;
  joinedAt: string;
  stale: boolean;
};
