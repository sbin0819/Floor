"use client";

import { useState } from "react";
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
import type { ActionResult } from "@/lib/actions/result";
import { useSpaceMutation } from "./use-space-mutation";

export function SpaceConfirm({
  label,
  title,
  description,
  action,
  input,
  destructive = false,
  onSuccess,
}: {
  label: string;
  title: string;
  description: string;
  action: (input: unknown) => Promise<ActionResult<unknown>>;
  input: unknown;
  destructive?: boolean;
  onSuccess?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const mutation = useSpaceMutation(action);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">{label}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {mutation.error && (
          <p role="alert" className="text-sm text-destructive">
            {mutation.error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            돌아가기
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={mutation.pending}
            onClick={() =>
              void mutation.submit(
                input,
                () => {
                  setOpen(false);
                  onSuccess?.();
                },
                "처리했어요",
              )
            }
          >
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
