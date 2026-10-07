import { LockKeyhole } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const statusLabels = {
  free: "비어 있음",
  busy: "사용 중",
  mine: "내 예약",
  maintenance: "점검 중",
  restricted: "전용 공간",
  pending: "수락 대기",
} as const;
export type Status = keyof typeof statusLabels;
const statusClasses: Record<Status, string> = {
  free: "border-status-free-border bg-status-free text-status-free-foreground",
  busy: "border-status-busy-border bg-status-busy text-status-busy-foreground",
  mine: "border-status-mine-border bg-status-mine text-status-mine-foreground",
  maintenance:
    "border-status-maintenance-border bg-status-maintenance-hatch text-status-maintenance-foreground",
  restricted:
    "border-status-restricted-border bg-status-restricted text-status-restricted-foreground",
  pending:
    "border-transparent bg-status-pending text-status-pending-foreground",
};

export function StatusBadge({
  status,
  className,
}: {
  status: Status;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-6 rounded-full px-2.5 text-xs font-normal",
        statusClasses[status],
        className,
      )}
    >
      {status === "restricted" && (
        <LockKeyhole aria-hidden="true" className="size-3" />
      )}
      {statusLabels[status]}
    </Badge>
  );
}
