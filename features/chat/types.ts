export type ChatMessage = {
  id: string;
  seq: number;
  authorId: string | null;
  authorName: string | null;
  kind: "text" | "system";
  body: string;
  createdAt: string;
  clientId: string | null;
};

export type ChatSpaceNav = {
  id: string;
  kind: "team";
  name: string;
  initial: string;
  channels: { id: string; name: string }[];
};

export type ChannelView = {
  space: { id: string; name: string };
  room: {
    id: string;
    name: string;
    topic: string | null;
    archived: boolean;
    adminOnly: boolean;
    lastSeq: number;
  };
  user: { id: string; name: string };
  members: { id: string; name: string; admin: boolean }[];
  messages: ChatMessage[];
  canWrite: boolean;
  now: string;
};
