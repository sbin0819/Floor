"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SendInviteForm } from "./send-invite-form";

export function TeamInviteDialog({
  teamId,
  canSendEmail,
}: {
  teamId: string;
  canSendEmail: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>팀원 초대</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>팀원 초대</DialogTitle>
          <DialogDescription>
            이메일 주소로 초대를 보내요. 초대받은 분이 수락하면 팀원이 돼요.
          </DialogDescription>
        </DialogHeader>
        <SendInviteForm
          teamId={teamId}
          canSendEmail={canSendEmail}
          onSuccess={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
