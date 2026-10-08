"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AuthFeedback } from "@/features/auth/components/auth-fields";
import { useAuthRequest } from "@/features/auth/components/use-auth-request";
import { authMessages } from "@/features/auth/messages";
import { authClient } from "@/lib/auth/client";
import { redirectAfterSignOut } from "@/lib/auth/redirect-after-sign-out";

export function OperatorAccountNotice() {
  const request = useAuthRequest();

  return (
    <div className="space-y-4">
      <p>{authMessages.notOperator}</p>
      <AuthFeedback message={request.message} />
      <Button asChild variant="outline" className="w-full">
        <Link href="/">홈으로</Link>
      </Button>
      <Button
        type="button"
        className="w-full"
        disabled={request.pending}
        onClick={() =>
          request.run(async () => {
            const { error } = await authClient.signOut();
            if (error) {
              request.setMessage(authMessages.genericError);
              return;
            }
            redirectAfterSignOut("/admin/login");
          })
        }
      >
        {request.pending ? "로그아웃하고 있어요…" : "다른 계정으로 로그인"}
      </Button>
    </div>
  );
}
