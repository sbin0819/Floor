import { z } from "zod";
import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/types";
import { readDownloadAttachment } from "@/lib/dal/chat-files";
import type { DalDatabase } from "@/lib/dal/database";
import {
  createMemoryRateLimiter,
  type RateLimiter,
} from "@/lib/rate-limit/memory";
import { getFileStorage } from "@/lib/storage";
import type { FileStorage } from "@/lib/storage/types";
import { UPLOAD_LIFETIME_MS } from "./upload-types";

const downloadLimiter = createMemoryRateLimiter();
export type FileDownloadDependencies = {
  database?: DalDatabase;
  requireSession?: () => Promise<Session>;
  now?: () => Date;
  limiter?: RateLimiter;
  storage?: FileStorage;
};

export function fileDisposition(name: string, inline: boolean) {
  const ascii = name.replace(/[^\x20-\x7e]|["\\%;]/gu, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*!]/g,
    (value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function matchesFileEtag(header: string | null, etag: string) {
  return (
    header?.split(",").some((item) => {
      const tag = item.trim();
      return tag === "*" || tag.replace(/^W\//, "") === etag;
    }) ?? false
  );
}

export function createFileDownloads(
  dependencies: FileDownloadDependencies = {},
) {
  return {
    async getFile(request: Request, attachmentId: string): Promise<Response> {
      const parsed = z.uuid().safeParse(attachmentId);
      const etag = `"${parsed.success ? parsed.data.toLowerCase() : "invalid"}"`;
      const headers = new Headers({
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Cache-Control": "private, no-cache",
        ETag: etag,
      });
      const fail = (status: number, code: string) =>
        Response.json({ code }, { status, headers });
      try {
        const session = await (dependencies.requireSession ?? requireSession)();
        if (!parsed.success) return fail(404, "NOT_FOUND");
        const rate = (dependencies.limiter ?? downloadLimiter).consume(
          `chat:download:${session.userId}`,
          300,
          60_000,
        );
        if (!rate.allowed) {
          headers.set("Retry-After", String(rate.retryAfter));
          return fail(429, "RATE_LIMITED");
        }
        const now = dependencies.now?.() ?? new Date();
        const attachment = await readDownloadAttachment(
          parsed.data,
          session.userId,
          new Date(now.getTime() - UPLOAD_LIFETIME_MS),
          dependencies.database,
        );
        if (!attachment) return fail(404, "NOT_FOUND");
        const storage = dependencies.storage ?? getFileStorage();
        if (storage.kind === "disabled") return fail(404, "NOT_FOUND");
        const object = await storage.stat(attachment.storageKey);
        if (!object || object.size !== attachment.size)
          return fail(404, "NOT_FOUND");
        if (matchesFileEtag(request.headers.get("If-None-Match"), etag))
          return new Response(null, { status: 304, headers });
        const contentHeaders = new Headers(headers);
        contentHeaders.set(
          "Content-Type",
          attachment.kind === "image"
            ? attachment.contentType
            : "application/octet-stream",
        );
        contentHeaders.set("Content-Length", String(attachment.size));
        contentHeaders.set(
          "Content-Disposition",
          fileDisposition(
            attachment.name,
            attachment.kind === "image" &&
              new URL(request.url).searchParams.get("download") !== "1",
          ),
        );
        const stream = await storage.readStream(attachment.storageKey);
        if (!stream) return fail(404, "NOT_FOUND");
        return new Response(stream, { headers: contentHeaders });
      } catch (error) {
        if (error instanceof ActionError && error.code === "UNAUTHENTICATED")
          return fail(401, "UNAUTHENTICATED");
        console.error("File download failed.");
        return fail(500, "INTERNAL");
      }
    },
  };
}
