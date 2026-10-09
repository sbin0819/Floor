import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnv } from "@/lib/env";
import { assertAdminObjectKey } from "./admin-keys";
import {
  AdminStorageMissingError,
  AdminStoragePreconditionError,
  type AdminObjectStorage,
} from "./admin-types";

export type R2Config = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};
type R2Environment = Pick<
  ReturnType<typeof getEnv>,
  "R2_ENDPOINT" | "R2_BUCKET" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY"
>;

let warnedPartial = false;
export function adminFilesEnabled(env: R2Environment = getEnv()): boolean {
  const values = [
    env.R2_ENDPOINT,
    env.R2_BUCKET,
    env.R2_ACCESS_KEY_ID,
    env.R2_SECRET_ACCESS_KEY,
  ];
  if (values.every(Boolean)) return true;
  if (values.some(Boolean) && !warnedPartial) {
    warnedPartial = true;
    console.warn("R2 설정이 일부만 있어요");
  }
  return false;
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("$metadata" in error))
    return undefined;
  const metadata = error.$metadata;
  return typeof metadata === "object" &&
    metadata !== null &&
    "httpStatusCode" in metadata &&
    typeof metadata.httpStatusCode === "number"
    ? metadata.httpStatusCode
    : undefined;
}
function storageError(): Error {
  return new Error("Admin object storage request failed.");
}

export function createR2ObjectStorage(
  config: R2Config,
  dependencies: {
    client?: S3Client;
    requestHandler?: S3ClientConfig["requestHandler"];
  } = {},
): AdminObjectStorage {
  const client =
    dependencies.client ??
    new S3Client({
      endpoint: config.endpoint,
      region: "auto",
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // 브라우저가 보낼 본문은 여기 없으므로 빈 본문의 체크섬을 서명하지 않는다.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      maxAttempts: 1,
      ...(dependencies.requestHandler
        ? { requestHandler: dependencies.requestHandler }
        : {}),
    });
  const object = (key: string) => {
    assertAdminObjectKey(key);
    return { Bucket: config.bucket, Key: key };
  };
  const storage: AdminObjectStorage = {
    async createUploadUrl(key, options) {
      const input = object(key);
      if (
        !key.startsWith("pending/") ||
        options.contentType !== "image/webp" ||
        !Number.isSafeInteger(options.contentLength) ||
        options.contentLength < 1 ||
        !Number.isSafeInteger(options.expiresIn) ||
        options.expiresIn < 1 ||
        options.expiresIn > 300 ||
        Object.entries(options.metadata).some(
          ([name, value]) =>
            !/^[a-z][a-z0-9-]*$/.test(name) || !/^[\x20-\x7e]*$/.test(value),
        )
      )
        throw new Error("Invalid admin upload options.");
      try {
        return await getSignedUrl(
          client,
          new PutObjectCommand({
            ...input,
            ContentType: options.contentType,
            ContentLength: options.contentLength,
            Metadata: options.metadata,
          }),
          {
            expiresIn: options.expiresIn,
            signableHeaders: new Set(["content-type", "content-length"]),
          },
        );
      } catch {
        throw storageError();
      }
    },
    async head(key) {
      const input = object(key);
      try {
        const result = await client.send(new HeadObjectCommand(input));
        if (
          !Number.isSafeInteger(result.ContentLength) ||
          result.ContentLength === undefined ||
          result.ContentLength < 0 ||
          !result.ETag
        )
          throw storageError();
        return {
          size: result.ContentLength,
          contentType: result.ContentType ?? null,
          etag: result.ETag,
          metadata: { ...result.Metadata },
        };
      } catch (error) {
        if (statusOf(error) === 404) return null;
        throw storageError();
      }
    },
    async readRange(key, start, end, options) {
      const input = object(key);
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end < start ||
        end - start + 1 > 1024 * 1024 ||
        !options.ifMatch
      )
        throw new Error("Invalid admin object range.");
      try {
        const result = await client.send(
          new GetObjectCommand({
            ...input,
            Range: `bytes=${start}-${end}`,
            IfMatch: options.ifMatch,
          }),
        );
        if (!result.Body) throw storageError();
        const reader = result.Body.transformToWebStream().getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > end - start + 1) throw storageError();
            chunks.push(value);
          }
        } finally {
          await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return bytes;
      } catch (error) {
        if (statusOf(error) === 404) throw new AdminStorageMissingError();
        if (statusOf(error) === 412) throw new AdminStoragePreconditionError();
        throw storageError();
      }
    },
    async readStream(key) {
      const input = object(key);
      try {
        const result = await client.send(new GetObjectCommand(input));
        if (!result.Body) throw storageError();
        const reader = result.Body.transformToWebStream().getReader();
        const close = () => reader.releaseLock();
        return new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const { value, done } = await reader.read();
              if (done) {
                close();
                controller.close();
              } else controller.enqueue(value);
            } catch {
              await reader.cancel().catch(() => undefined);
              close();
              controller.error(storageError());
            }
          },
          async cancel() {
            await reader.cancel().catch(() => undefined);
            close();
          },
        });
      } catch (error) {
        if (statusOf(error) === 404) return null;
        throw storageError();
      }
    },
    async copy(from, to, options) {
      object(from);
      const target = object(to);
      if (!options.sourceEtag || options.ifAbsent !== true || from === to)
        throw new Error("Invalid admin copy options.");
      const command = new CopyObjectCommand({
        ...target,
        CopySource: `${encodeURIComponent(config.bucket)}/${from}`,
        CopySourceIfMatch: options.sourceEtag,
        MetadataDirective: "COPY",
      });
      // R2 전용 조건은 명령별로 서명 전에 넣는다. 공유 클라이언트에는 남기지 않는다.
      command.middlewareStack.add(
        (next) => async (args) => {
          const request = args.request;
          if (
            typeof request !== "object" ||
            request === null ||
            !("headers" in request) ||
            typeof request.headers !== "object" ||
            request.headers === null
          )
            throw storageError();
          (request.headers as Record<string, string>)[
            "cf-copy-destination-if-none-match"
          ] = "*";
          return next(args);
        },
        { step: "build", name: "adminCopyCreateOnly" },
      );
      try {
        await client.send(command);
        return "created";
      } catch (error) {
        if (statusOf(error) === 412) {
          // 같은 412가 source 변경에도 쓰인다. 최종 파일이 없으면 충돌 성공이 아니다.
          if (await storage.head(to)) return "exists";
          throw new AdminStoragePreconditionError();
        }
        throw storageError();
      }
    },
    async remove(key) {
      const input = object(key);
      try {
        await client.send(new DeleteObjectCommand(input));
      } catch {
        throw storageError();
      }
    },
  };
  return storage;
}

let runtime: { config: R2Config; storage: AdminObjectStorage } | undefined;
export function getAdminObjectStorage(): AdminObjectStorage | null {
  const env = getEnv();
  if (
    !adminFilesEnabled(env) ||
    !env.R2_ENDPOINT ||
    !env.R2_BUCKET ||
    !env.R2_ACCESS_KEY_ID ||
    !env.R2_SECRET_ACCESS_KEY
  )
    return null;
  const config = {
    endpoint: env.R2_ENDPOINT,
    bucket: env.R2_BUCKET,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  };
  if (
    !runtime ||
    Object.entries(config).some(
      ([key, value]) => runtime!.config[key as keyof R2Config] !== value,
    )
  )
    runtime = { config, storage: createR2ObjectStorage(config) };
  return runtime.storage;
}
