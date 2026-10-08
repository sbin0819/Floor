export type RateLimitResult =
  { allowed: true } | { allowed: false; retryAfter: number };

export type RateLimiter = {
  consume(key: string, limit: number, windowMs: number): RateLimitResult;
};

export function createMemoryRateLimiter(
  now: () => number = Date.now,
): RateLimiter {
  const windows = new Map<string, { count: number; endsAt: number }>();
  let sweepAt = 0;
  return {
    consume(key, limit, windowMs) {
      const current = now();
      if (current >= sweepAt) {
        for (const [id, value] of windows)
          if (value.endsAt <= current) windows.delete(id);
        sweepAt = current + 60_000;
      }
      let window = windows.get(key);
      if (!window || window.endsAt <= current) {
        window = { count: 0, endsAt: current + windowMs };
        windows.set(key, window);
      }
      if (window.count >= limit)
        return {
          allowed: false,
          retryAfter: Math.max(1, Math.ceil((window.endsAt - current) / 1000)),
        };
      window.count += 1;
      return { allowed: true };
    },
  };
}

export class RateLimitError extends Error {
  constructor(readonly retryAfter: number) {
    super("Search request limit reached.");
    this.name = "RateLimitError";
  }
}
