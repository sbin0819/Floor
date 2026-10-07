"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth/client";

export function SignOutButton({ menuItem = false }: { menuItem?: boolean }) {
  const router = useRouter();
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function signOut() {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setFailed(false);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setFailed(true);
        return;
      }
      router.replace("/login");
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  const button = (
    <Button
      variant={menuItem ? "ghost" : "outline"}
      className={
        menuItem
          ? "w-full justify-start px-3 focus:bg-muted focus:text-foreground"
          : undefined
      }
      disabled={pending}
      onClick={signOut}
    >
      {pending ? "로그아웃하고 있어요." : "로그아웃"}
    </Button>
  );
  return (
    <div>
      {menuItem ? (
        <DropdownMenuItem
          asChild
          disabled={pending}
          onSelect={(event) => event.preventDefault()}
        >
          {button}
        </DropdownMenuItem>
      ) : (
        button
      )}
      {failed && (
        <p role="alert" className={menuItem ? "px-3 py-2 text-sm" : "text-sm"}>
          로그아웃하지 못했어요. 다시 시도해 주세요.
        </p>
      )}
    </div>
  );
}
