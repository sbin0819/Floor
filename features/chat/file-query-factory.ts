import { z } from "zod";
import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/types";
import { canReadRoom } from "@/lib/dal/chat-access";
import { listRoomFiles } from "@/lib/dal/chat-files";
import type { DalDatabase } from "@/lib/dal/database";
import {
  createMemoryRateLimiter,
  RateLimitError,
  type RateLimiter,
} from "@/lib/rate-limit/memory";
import { roomFilesQueryInput, roomFilesQuerySchema } from "./file-schema";
import type { RoomFilesPage } from "./file-types";

const pageLimiter = createMemoryRateLimiter();
export type FileQueryDependencies = {
  database?: DalDatabase;
  requireSession?: () => Promise<Session>;
  now?: () => Date;
  limiter?: RateLimiter;
};

export function createFileQueries(dependencies: FileQueryDependencies = {}) {
  return {
    async getRoomFiles(roomId: string, query: unknown): Promise<RoomFilesPage> {
      const session = await (dependencies.requireSession ?? requireSession)();
      const parsed = roomFilesQuerySchema.safeParse(roomFilesQueryInput(query));
      if (!parsed.success) throw new ActionError("INVALID_INPUT");
      const rate = (dependencies.limiter ?? pageLimiter).consume(
        `chat:files:${session.userId}`,
        60,
        60_000,
      );
      if (!rate.allowed) throw new RateLimitError(rate.retryAfter);
      if (!z.uuid().safeParse(roomId).success)
        throw new ActionError("NOT_FOUND");
      const now = dependencies.now?.() ?? new Date();
      const [room, rows] = await Promise.all([
        canReadRoom(session.userId, roomId, dependencies.database, now),
        listRoomFiles(
          roomId,
          session.userId,
          parsed.data,
          dependencies.database,
        ),
      ]);
      if (!room) throw new ActionError("NOT_FOUND");
      const hasMore = rows.length > 30;
      const page = rows.slice(0, 30);
      const last = page.at(-1);
      return {
        files: page.map((file) => ({
          id: file.id,
          name: file.name,
          size: file.size,
          kind: file.kind,
          width: file.width,
          height: file.height,
          uploaderName: file.uploaderName,
          messageId: file.messageId,
          seq: file.seq,
          sentAt: file.sentAt.toISOString(),
        })),
        hasMore,
        nextCursor: hasMore && last ? `${last.seq}_${last.position}` : null,
      };
    },
  };
}
