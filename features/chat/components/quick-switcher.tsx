"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { fetchMessageContacts } from "@/features/people/contacts-client";
import { openDirectMessage } from "@/features/chat/actions";
import { CHAT_NAV_KEY } from "../nav-state";
import type { ChatNav } from "../types";
import {
  filterQuickSwitchItems,
  quickSwitchItems,
  quickSwitchShortcut,
  type QuickSwitchItem,
} from "../quick-switch";
import { readRecentRooms, rememberRoom } from "../recent-rooms";
import type { OpenConversation } from "./message-contacts";

const OPEN_EVENT = "floor:quick-switch";
const subscribePlatform = () => () => {};
const shortcutLabel = () =>
  /mac|iphone|ipad/i.test(navigator.platform) ? "⌘K" : "Ctrl+K";
const serverShortcutLabel = () => "⌘K / Ctrl+K";

export function QuickSwitchButton({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const shortcut = useSyncExternalStore(
    subscribePlatform,
    shortcutLabel,
    serverShortcutLabel,
  );
  return (
    <Button
      type="button"
      variant="outline"
      size={compact ? "icon" : "default"}
      className={cn(
        compact ? "size-11 shrink-0" : "w-full justify-between",
        className,
      )}
      aria-label="찾기"
      aria-keyshortcuts={shortcut === "⌘K" ? "Meta+K" : "Control+K"}
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
    >
      <span className="flex items-center gap-2">
        <Search aria-hidden="true" className="size-4" />
        {!compact && "찾기"}
      </span>
      <kbd
        aria-hidden="true"
        className={cn("text-xs text-muted-foreground", compact && "sr-only")}
      >
        {shortcut}
      </kbd>
    </Button>
  );
}

type Props = {
  userId: string;
  readContacts?: typeof fetchMessageContacts;
  openConversation?: OpenConversation;
};

export function QuickSwitcher(props: Props) {
  return <QuickSwitcherSession key={props.userId} {...props} />;
}

function QuickSwitcherSession({
  userId,
  readContacts = fetchMessageContacts,
  openConversation = (input) => openDirectMessage(input),
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [error, setError] = useState("");
  const opened = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const epoch = useRef(0);
  const sending = useRef(false);
  const nav = useQuery<ChatNav>({
    queryKey: CHAT_NAV_KEY,
    queryFn: skipToken,
    enabled: false,
  }).data;
  const people = useQuery({
    queryKey: ["people", "contacts", userId],
    queryFn: ({ signal }) => readContacts(signal),
    enabled: open,
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const mutation = useMutation({
    mutationFn: (input: unknown) => openConversation(input),
    retry: false,
  });
  const items = useMemo(
    () => quickSwitchItems(nav, people.data ?? []),
    [nav, people.data],
  );
  const currentRoom = items.find(
    (item) => item.kind === "room" && item.href === pathname,
  )?.id;
  useEffect(() => {
    if (currentRoom) rememberRoom(userId, currentRoom);
  }, [userId, currentRoom, pathname]);

  const changeOpen = useCallback(
    (next: boolean) => {
      epoch.current += 1;
      opened.current = next;
      setOpen(next);
      if (next) {
        returnFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        setSearch("");
        setRecent(readRecentRooms(userId));
        setError("");
      }
    },
    [userId],
  );

  useEffect(() => {
    function openPalette() {
      if (opened.current) return;
      const anotherDialog = [
        ...document.querySelectorAll(
          '[role="dialog"], [role="alertdialog"], dialog[open]',
        ),
      ].some(
        (dialog) =>
          dialog.getAttribute("data-state") !== "closed" &&
          !dialog.closest('[hidden], [aria-hidden="true"]'),
      );
      if (!anotherDialog) changeOpen(true);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (!quickSwitchShortcut(event, navigator.platform)) return;
      event.preventDefault();
      if (opened.current) changeOpen(false);
      else openPalette();
    }
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener(OPEN_EVENT, openPalette);
    return () => {
      epoch.current += 1;
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener(OPEN_EVENT, openPalette);
    };
  }, [changeOpen]);

  async function select(item: QuickSwitchItem) {
    if (sending.current) return;
    if (item.href) {
      changeOpen(false);
      router.push(item.href);
      return;
    }
    if (item.kind !== "person") return;
    const selectedEpoch = epoch.current;
    sending.current = true;
    setError("");
    try {
      const result = await mutation.mutateAsync({ userId: item.id });
      if (epoch.current !== selectedEpoch) return;
      if (result.ok) {
        changeOpen(false);
        router.push(`/dm/${result.data.roomId}`);
      } else setError("대화를 열지 못했어요. 다시 시도해 주세요");
    } catch {
      if (epoch.current === selectedEpoch)
        setError("대화를 열지 못했어요. 다시 시도해 주세요");
    } finally {
      sending.current = false;
    }
  }

  const filtered = filterQuickSwitchItems(items, search, recent);
  return (
    <CommandDialog
      open={open}
      onOpenChange={changeOpen}
      contentProps={{
        onCloseAutoFocus: (event) => {
          event.preventDefault();
          if (returnFocus.current?.isConnected) returnFocus.current.focus();
        },
      }}
    >
      <Command shouldFilter={false} label="빠른 이동">
        <CommandInput
          value={search}
          onValueChange={setSearch}
          placeholder="방, 스페이스, 사람 찾기"
          aria-label="방, 스페이스, 사람 찾기"
        />
        <CommandList
          aria-busy={mutation.isPending}
          className="max-h-[min(18rem,calc(75dvh-4rem))]"
        >
          {(
            [
              ["room", "방"],
              ["space", "스페이스"],
              ["person", "사람"],
            ] as const
          ).map(([kind, heading]) => {
            const rows = filtered.filter((item) => item.kind === kind);
            return rows.length ? (
              <CommandGroup key={kind} heading={heading}>
                {rows.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`${kind}:${item.id}`}
                    aria-label={
                      item.unread
                        ? `${item.label}, 안 읽은 메시지 있음`
                        : item.label
                    }
                    disabled={mutation.isPending}
                    onSelect={() => void select(item)}
                  >
                    <span className="min-w-0 truncate">{item.label}</span>
                    {item.unread && (
                      <span className="sr-only">안 읽은 메시지 있음</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null;
          })}
          {!filtered.length && !people.isPending && !people.isError && (
            <p
              role="status"
              className="p-6 text-center text-sm text-muted-foreground"
            >
              {search.trim()
                ? "찾는 항목이 없어요"
                : "최근에 연 방과 안 읽은 방이 없어요"}
            </p>
          )}
          {people.isPending && (
            <p role="status" className="p-3 text-sm text-muted-foreground">
              사람 목록을 불러오고 있어요
            </p>
          )}
          {people.isError && (
            <p role="alert" className="p-3 text-sm text-destructive">
              사람 목록을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요
            </p>
          )}
          {error && (
            <p role="alert" className="p-3 text-sm text-destructive">
              {error}
            </p>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
