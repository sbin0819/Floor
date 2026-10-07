"use client";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth/client";
import { safeNext } from "@/lib/auth/safe-next";
import { getAuthErrorMessage } from "@/features/auth/messages";
import type { useAuthRequest } from "@/features/auth/components/use-auth-request";

export type AuthProvider = "google" | "github";

export function SocialButtons({
  providers,
  next,
  request,
  separator = true,
}: {
  providers: AuthProvider[];
  next: string;
  request: ReturnType<typeof useAuthRequest>;
  separator?: boolean;
}) {
  if (providers.length === 0) return null;
  return (
    <div className="space-y-4">
      <div className="grid gap-3">
        {providers.map((provider) => (
          <Button
            key={provider}
            type="button"
            variant="outline"
            className="w-full"
            disabled={request.pending}
            onClick={() =>
              request.run(async () => {
                const { error } = await authClient.signIn.social({
                  provider,
                  callbackURL: safeNext(next),
                  errorCallbackURL: "/login",
                });
                if (error) request.setMessage(getAuthErrorMessage(error.code));
              })
            }
          >
            <span
              aria-hidden="true"
              className="inline-flex size-5 items-center justify-center text-xs font-semibold"
            >
              {provider === "google" ? "G" : "GH"}
            </span>
            {provider === "google" ? "Google" : "GitHub"}로 계속하기
          </Button>
        ))}
      </div>
      {separator && (
        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-muted-foreground">또는</span>
          <Separator className="flex-1" />
        </div>
      )}
    </div>
  );
}
