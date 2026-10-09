export type FrameStats = {
  p50: number;
  p95: number;
  frames: number;
  elapsed: number;
};

export function frameStats(
  samples: readonly number[],
  elapsed: number,
): FrameStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (fraction: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
  return {
    p50: percentile(0.5),
    p95: percentile(0.95),
    frames: sorted.length,
    elapsed,
  };
}

export function startStressAnimation({
  draw,
  complete,
  now = () => performance.now(),
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
}: {
  draw: (elapsed: number) => void;
  complete: (stats: FrameStats) => void;
  now?: () => number;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (id: number) => void;
}) {
  let active = true;
  let start: number | null = null;
  let previous = 0;
  let frame = 0;
  const samples: number[] = [];
  const tick = () => {
    if (!active) return;
    const current = now();
    if (start === null) start = current;
    else samples.push(current - previous);
    previous = current;
    const elapsed = current - start;
    draw(elapsed);
    if (elapsed >= 5000) {
      active = false;
      complete(frameStats(samples, elapsed));
    } else frame = requestFrame(tick);
  };
  frame = requestFrame(tick);
  return () => {
    active = false;
    cancelFrame(frame);
  };
}
