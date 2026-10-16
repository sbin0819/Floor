import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { requestJson } from "@/lib/http/client";
import { HTTP_TIMEOUT_MS } from "@/lib/http/config";
import {
  ApiError,
  isRequestCanceled,
  parseRetryAfter,
} from "@/lib/http/errors";

const schema = z.object({ value: z.string() });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("browser JSON client", () => {
  it("uses the fetch adapter with cookies, no-store, safe headers and schema validation", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ value: "ok", secret: "hidden" }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(requestJson("/api/example", schema)).resolves.toEqual({
      value: "ok",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/example");
    expect(init).toMatchObject({
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
    });
    expect(new Headers(init.headers).get("accept")).toBe("application/json");
    expect(new Headers(init.headers).has("authorization")).toBe(false);
  });
  it("keeps published plan caching and JSON POST serialization", async () => {
    const fetcher = vi.fn(async () => Response.json({ value: "ok" }));
    vi.stubGlobal("fetch", fetcher);
    await requestJson("/api/floor-plans/plan", schema, { cache: "default" });
    await requestJson("/api/realtime/token", schema, {
      method: "POST",
      data: { rooms: ["one"] },
    });
    const first = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const second = fetcher.mock.calls[1] as unknown as [string, RequestInit];
    expect(first[1].cache).toBe("default");
    expect(second[1].body).toBe('{"rooms":["one"]}');
    expect(new Headers(second[1].headers).get("content-type")).toBe(
      "application/json",
    );
  });
  it.each([
    "https://other.test/api/x",
    "//other.test/api/x",
    "/login",
    "/api/../login",
    "/api/%2e%2e/login",
    "/api/x#fragment",
    "/api/\\other.test",
  ])("rejects a target outside the API boundary: %s", async (path) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(requestJson(path, schema)).rejects.toBeInstanceOf(ApiError);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 409, 429, 500, 503])(
    "keeps HTTP %s without diagnostics or retries",
    async (status) => {
      const fetcher = vi.fn(async () =>
        Response.json(
          {
            code: "UNAUTHENTICATED",
            message: "private@ai.com",
            token: "secret",
          },
          { status, headers: { "Retry-After": "2" } },
        ),
      );
      vi.stubGlobal("fetch", fetcher);
      const error: unknown = await requestJson(
        "/api/example?q=private%40ai.com",
        schema,
      ).catch((error: unknown) => error);
      expect(error).toMatchObject({
        kind: "http",
        status,
        code: "UNAUTHENTICATED",
        retryAfterMs: status === 429 ? 2000 : undefined,
      });
      expect(error).not.toHaveProperty("cause");
      expect(error).not.toHaveProperty("config");
      expect(error).not.toHaveProperty("response");
      expect(String(error) + JSON.stringify(error)).not.toMatch(
        /private|secret|example\?/,
      );
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
  it("does not trust unknown server error codes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ code: "private@ai.com" }, { status: 500 }),
      ),
    );
    await expect(requestJson("/api/example", schema)).rejects.toMatchObject({
      kind: "http",
      status: 500,
      code: undefined,
    });
  });
  it.each(["not json private@ai.com", '{"value": 1}', "null"])(
    "hides malformed JSON/schema errors",
    async (body) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(body)),
      );
      const error: unknown = await requestJson("/api/example", schema).catch(
        (error: unknown) => error,
      );
      expect(error).toMatchObject({ kind: "invalid_response", status: 200 });
      expect(String(error) + JSON.stringify(error)).not.toContain(body);
    },
  );
  it("sanitizes exceptions thrown inside a Zod response transform", async () => {
    const privateValue = "private@ai.com signed-url-secret";
    const transformed = z.object({
      value: z.string().transform((value): unknown => JSON.parse(value)),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ value: privateValue })),
    );
    const error: unknown = await requestJson("/api/example", transformed).catch(
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: "invalid_response", status: 200 });
    expect(error).not.toHaveProperty("cause");
    expect(String(error) + JSON.stringify(error)).not.toMatch(
      /private@|signed-url/,
    );
  });
  it("normalizes network errors without keeping the original cause", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("secret signed URL");
      }),
    );
    const error: unknown = await requestJson("/api/example", schema).catch(
      (error: unknown) => error,
    );
    expect(error).toEqual(new ApiError("network"));
    expect(error).not.toHaveProperty("cause");
  });
  it("does not start a request with an already aborted signal", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    controller.abort("private reason");
    await expect(
      requestJson("/api/example", schema, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError", message: "Aborted" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["abort", "timeout"] as const)(
    "aborts the transport for %s and cleans the timer",
    async (mode) => {
      vi.useFakeTimers();
      let transportSignal: AbortSignal | null | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (_url: string, init: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              transportSignal = init.signal;
              init.signal?.addEventListener(
                "abort",
                () => reject(init.signal?.reason),
                { once: true },
              );
            }),
        ),
      );
      const controller = new AbortController();
      const pending = requestJson("/api/example", schema, {
        signal: controller.signal,
      });
      const rejected =
        mode === "abort"
          ? expect(pending).rejects.toMatchObject({ name: "AbortError" })
          : expect(pending).rejects.toMatchObject({
              kind: "timeout",
              status: undefined,
            });
      await vi.advanceTimersByTimeAsync(0);
      if (mode === "abort") controller.abort("private reason");
      else {
        await vi.advanceTimersByTimeAsync(HTTP_TIMEOUT_MS - 1);
        expect(transportSignal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
      }
      await rejected;
      expect(transportSignal?.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("cleans the deadline and caller abort listener after success", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ value: "ok" })),
    );
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await requestJson("/api/example", schema, { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps the deadline active while a successful response body is stalled", async () => {
    vi.useFakeTimers();
    let transportSignal: AbortSignal | null | undefined;
    let response: Response | undefined;
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      transportSignal = init.signal;
      response = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"value":'));
            init.signal?.addEventListener(
              "abort",
              () => controller.error(init.signal?.reason),
              { once: true },
            );
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
      return response;
    });
    vi.stubGlobal("fetch", fetcher);
    const rejected = expect(
      requestJson("/api/example", schema),
    ).rejects.toMatchObject({
      kind: "timeout",
      status: undefined,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(response?.status).toBe(200);
    expect(response?.bodyUsed).toBe(true);
    await vi.advanceTimersByTimeAsync(HTTP_TIMEOUT_MS - 1);
    expect(transportSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(transportSignal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("parses Retry-After seconds/date safely and recognizes only cancellation", () => {
    expect(parseRetryAfter("2")).toBe(2000);
    expect(parseRetryAfter("Thu, 01 Jan 1970 00:00:03 GMT", 1000)).toBe(2000);
    expect(parseRetryAfter("bad")).toBe(1000);
    expect(parseRetryAfter("", 0)).toBe(1000);
    expect(parseRetryAfter("99999999999999999")).toBe(2_147_483_647);
    expect(isRequestCanceled(new DOMException("Aborted", "AbortError"))).toBe(
      true,
    );
    expect(isRequestCanceled(new ApiError("timeout"))).toBe(false);
  });
});
