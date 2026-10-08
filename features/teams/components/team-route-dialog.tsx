"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { teamHref } from "../navigation";

const CloseTeamDialog = createContext<{
  close: () => void;
  isCurrent: () => boolean;
}>({
  close: () => {},
  isCurrent: () => true,
});
export const useCloseTeamDialog = () => useContext(CloseTeamDialog).close;
export const useTeamDialogIsCurrent = () =>
  useContext(CloseTeamDialog).isCurrent;

export function TeamRouteDialog({
  teamId,
  title,
  description,
  returnMemberId,
  children,
}: {
  teamId: string;
  title: string;
  description: string;
  returnMemberId?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const returnFocus = useRef<HTMLElement | null>(null);
  const closed = useRef(false);
  const mounted = useRef(true);
  const identity = useRef<{
    dialog: string | null;
    member: string | null;
  } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function ownsLocation() {
    const current = new URLSearchParams(window.location.search);
    return (
      window.location.pathname === `/teams/${teamId}` &&
      identity.current !== null &&
      current.get("dialog") === identity.current.dialog &&
      current.get("member") === identity.current.member
    );
  }
  function isCurrent() {
    return mounted.current && !closed.current && ownsLocation();
  }
  function close() {
    if (closed.current || !mounted.current) return;
    const changeLocation = isCurrent();
    closed.current = true;
    setOpen(false);
    // Activity가 보존한 이전 화면의 늦은 응답은 현재 주소를 바꾸지 않아요.
    if (!changeLocation) return;
    const next = new URLSearchParams(window.location.search);
    next.delete("dialog");
    next.delete("member");
    router.replace(teamHref(teamId, Object.fromEntries(next)), {
      scroll: false,
    });
  }
  return (
    <CloseTeamDialog value={{ close, isCurrent }}>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <DialogContent
          className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"
          onOpenAutoFocus={() => {
            const current = new URLSearchParams(window.location.search);
            identity.current = {
              dialog: current.get("dialog"),
              member: current.get("member"),
            };
            returnFocus.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const current = new URLSearchParams(window.location.search);
            if (
              window.location.pathname !== `/teams/${teamId}` ||
              (current.has("dialog") && !ownsLocation())
            )
              return;
            const selector = returnMemberId
              ? `[data-team-member-menu="${CSS.escape(returnMemberId)}"]`
              : "[data-team-delete-trigger]";
            const element = Array.from(
              document.querySelectorAll<HTMLElement>(selector),
            ).find((candidate) => candidate.getClientRects().length > 0);
            if (element) element.focus();
            else if (returnFocus.current?.isConnected)
              returnFocus.current.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    </CloseTeamDialog>
  );
}
