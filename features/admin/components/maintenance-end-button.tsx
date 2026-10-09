"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { endMaintenance } from "@/features/admin/maintenance-actions";
import { adminErrorMessage } from "./use-admin-mutation";

export function MaintenanceEndButton({
  blockId,
  spaceName,
}: {
  blockId: string;
  spaceName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const submitting = useRef(false);
  const lifetime = useRef({ active: true, generation: 0, path: "" });
  useEffect(() => {
    const current = lifetime.current;
    current.active = true;
    return () => {
      current.active = false;
      current.generation += 1;
    };
  }, []);
  const mutation = useMutation({
    mutationKey: ["admin-actions"],
    scope: { id: "admin-actions" },
    retry: false,
    mutationFn: (input: { blockId: string }) => endMaintenance(input),
  });
  function changeOpen(next: boolean) {
    lifetime.current.generation += 1;
    lifetime.current.path = window.location.pathname;
    setOpen(next);
    setMessage("");
  }
  async function submit() {
    if (submitting.current || mutation.isPending) return;
    submitting.current = true;
    const generation = lifetime.current.generation;
    const current = () =>
      lifetime.current.active &&
      generation === lifetime.current.generation &&
      window.location.pathname === lifetime.current.path;
    try {
      const result = await mutation.mutateAsync({ blockId });
      if (!current()) return;
      if (!result.ok) {
        setMessage(
          result.message === "maintenance_state"
            ? "점검 상태가 바뀌었어요. 새로고침한 뒤 다시 확인해 주세요"
            : adminErrorMessage(result.code),
        );
        return;
      }
      toast.success("점검을 해제했어요");
      setOpen(false);
      router.refresh();
    } catch {
      if (current()) setMessage(adminErrorMessage("INTERNAL"));
    } finally {
      submitting.current = false;
    }
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11"
          aria-label={`해제 · ${spaceName}`}
        >
          해제<span className="sr-only"> · {spaceName}</span>
        </Button>
      </DialogTrigger>
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (window.location.pathname !== lifetime.current.path)
            event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>지금 해제할까요?</DialogTitle>
          <DialogDescription>{spaceName}</DialogDescription>
        </DialogHeader>
        <p className="text-sm leading-relaxed">
          점검으로 취소된 예약은 되살아나지 않아요. 다음 30분 칸부터 예약할 수
          있어요
        </p>
        {message && (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => changeOpen(false)}>
            돌아가기
          </Button>
          <Button onClick={() => void submit()} disabled={mutation.isPending}>
            {mutation.isPending ? "해제하는 중…" : "해제"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
