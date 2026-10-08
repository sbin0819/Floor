import { Phone } from "lucide-react";

export function CallIndicator({ count }: { count: number | undefined }) {
  return count === undefined || count <= 0 ? null : (
    <span
      role="img"
      aria-label={`통화 중, ${count}명`}
      className="relative ml-auto inline-flex shrink-0 items-center gap-1 text-xs tabular-nums"
    >
      <Phone aria-hidden="true" className="size-3" />
      {count}
    </span>
  );
}
