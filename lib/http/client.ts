"use client";

import axios from "axios";
import type { z } from "zod";
import { HTTP_TIMEOUT_MS } from "./config";
import {
  ApiError,
  isActionErrorCode,
  isRequestCanceled,
  parseRetryAfter,
} from "./errors";

export type JsonRequestOptions = {
  method?: "GET" | "POST";
  data?: unknown;
  signal?: AbortSignal;
  cache?: "no-store" | "default";
};

function validPath(path: string) {
  if (!path.startsWith("/api/") || /[\\\s#]/u.test(path)) return false;
  const base = "https://floor.invalid";
  const parsed = new URL(path, base);
  return parsed.origin === base && parsed.pathname.startsWith("/api/");
}

function safeCode(body: unknown) {
  try {
    const value: unknown = typeof body === "string" ? JSON.parse(body) : body;
    if (
      value &&
      typeof value === "object" &&
      "code" in value &&
      isActionErrorCode(value.code)
    )
      return value.code;
  } catch {}
  return undefined;
}

function normalizeError(error: unknown): Error {
  if (error instanceof ApiError) return error;
  if (isRequestCanceled(error) || axios.isCancel(error))
    return new DOMException("Aborted", "AbortError");
  if (axios.isAxiosError<unknown>(error)) {
    if (error.code === "ETIMEDOUT" || error.code === "ECONNABORTED")
      return new ApiError("timeout");
    if (error.response)
      return new ApiError("http", {
        status: error.response.status,
        code: safeCode(error.response.data),
        retryAfterMs:
          error.response.status === 429
            ? parseRetryAfter(error.response.headers["retry-after"])
            : undefined,
      });
  }
  return new ApiError("network");
}

const client = axios.create({
  adapter: "fetch",
  timeout: HTTP_TIMEOUT_MS,
  responseType: "text",
  transformResponse: [(data: unknown) => data],
  // JSON 전용 전송은 스트림·진행률용 Request/Response 래핑이 필요하지 않다.
  env: {
    // @ts-expect-error Axios 1.20의 타입에는 공식 Fetch adapter의 null 비활성 옵션이 빠져 있다.
    Request: null,
    // @ts-expect-error Request와 같이 공식 문서의 null 비활성 옵션을 쓴다.
    Response: null,
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      globalThis.fetch(input, { ...init, credentials: "same-origin" }),
  },
});

client.interceptors.request.use((config) => {
  if (!config.url || !validPath(config.url)) throw new ApiError("network");
  config.headers.set("Accept", "application/json");
  config.fetchOptions = {
    cache: "no-store",
    ...config.fetchOptions,
    credentials: "same-origin",
    redirect: "error",
  };
  return config;
});
client.interceptors.response.use(
  (response) => response,
  (error: unknown) => Promise.reject(normalizeError(error)),
);

export async function requestJson<T>(
  path: string,
  schema: z.ZodType<T>,
  options: JsonRequestOptions = {},
): Promise<T> {
  const response = await client.request<unknown>({
    url: path,
    method: options.method ?? "GET",
    data: options.data,
    signal: options.signal,
    fetchOptions: { cache: options.cache ?? "no-store" },
  });
  if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  try {
    const value: unknown =
      typeof response.data === "string"
        ? JSON.parse(response.data)
        : response.data;
    const result = schema.safeParse(value);
    if (result.success) return result.data;
  } catch {
    // 스키마 변환이 던진 오류에도 응답 내용이 들어갈 수 있어 밖으로 보내지 않는다.
  }
  throw new ApiError("invalid_response", { status: response.status });
}
