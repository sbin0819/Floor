"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useIsMutating, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MessageBody } from "@/features/chat/components/message-body";
import { sendAnnouncement } from "@/features/admin/announcement-actions";
import {
  previewAnnouncementAudienceSchema,
  sendAnnouncementSchema,
} from "../announcement-schema";
import {
  announcementPath,
  announcementPreviewHref,
  announcementSendLabel,
  announcementTargetKey,
  type AnnouncementPreviewRequest,
  type AnnouncementTargetInput,
} from "../announcement-navigation";
import type { AnnouncementsData } from "../announcement-types";
import {
  AnnouncementDestinations,
  loungeUnavailableMessage,
  type AnnouncementDestinationDraft,
} from "./announcement-destinations";
import {
  AnnouncementPreviewContext,
  type AnnouncementPreviewResult,
} from "./announcement-preview";
import { adminErrorMessage } from "./use-admin-mutation";

export function AnnouncementForm({
  data,
  initialRequest = null,
  children,
}: {
  data: AnnouncementsData;
  initialRequest?: AnnouncementPreviewRequest | null;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState<AnnouncementDestinationDraft>(() => ({
    lounge: (initialRequest?.input.lounge ?? true) && data.lounge.available,
    audience:
      initialRequest?.input.audience !== undefined &&
      initialRequest.input.audience !== null,
    date: initialRequest?.input.audience?.date ?? data.today,
    floorId: initialRequest?.input.audience?.floorId ?? "",
    spaceId: initialRequest?.input.audience?.spaceId ?? "",
  }));
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [request, setRequest] = useState(initialRequest);
  const [approval, setApproval] = useState<{
    key: string;
    result: AnnouncementPreviewResult;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const mounted = useRef(false);
  const lifetime = useRef(0);
  const submitting = useRef(false);
  const pending = useIsMutating({ mutationKey: ["admin-actions"] }) > 0;
  const path = announcementPath(data.branch.id);
  const current = useCallback(
    () => mounted.current && window.location.pathname === path,
    [path],
  );
  useLayoutEffect(() => {
    mounted.current = true;
    lifetime.current += 1;
    return () => {
      mounted.current = false;
      lifetime.current += 1;
    };
  }, [path]);
  const input: AnnouncementTargetInput = useMemo(
    () => ({
      branchId: data.branch.id,
      lounge: draft.lounge,
      audience: draft.audience
        ? {
            date: draft.date,
            floorId: draft.floorId || null,
            spaceId: draft.spaceId || null,
          }
        : null,
    }),
    [data.branch.id, draft],
  );
  const valid =
    previewAnnouncementAudienceSchema.safeParse(input).success &&
    (!input.audience ||
      (draft.date >= data.today && draft.date <= data.maxDate));
  const inputKey = valid ? announcementTargetKey(input) : null;
  const requestKey =
    request && request.inputKey === inputKey
      ? `${request.inputKey}:${request.nonce}`
      : null;
  useEffect(() => {
    if (!inputKey || request?.inputKey === inputKey) return;
    const timer = setTimeout(() => {
      if (!current()) return;
      const next = { input, inputKey, nonce: crypto.randomUUID() };
      setRequest(next);
      setApproval(null);
      startTransition(() =>
        router.replace(announcementPreviewHref(next), { scroll: false }),
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [current, input, inputKey, request?.inputKey, router]);
  const accept = useCallback(
    (key: string, result: AnnouncementPreviewResult) => {
      if (!current() || key !== requestKey) return;
      if (result.ok && !result.data.lounge.available)
        setDraft((previous) =>
          previous.lounge ? { ...previous, lounge: false } : previous,
        );
      setApproval((previous) =>
        previous?.key === key && previous.result === result
          ? previous
          : { key, result },
      );
    },
    [current, requestKey],
  );
  const result = approval?.key === requestKey ? approval?.result : null;
  const approved = result?.ok ? result.data : null;
  const lounge = approved?.lounge ?? data.lounge;
  const count = draft.audience ? (approved?.recipientCount ?? null) : 0;
  const mutation = useMutation({
    mutationKey: ["admin-actions"],
    scope: { id: "admin-actions" },
    retry: false,
    mutationFn: (value: unknown) => sendAnnouncement(value),
  });
  async function submit() {
    if (submitting.current || pending || !current()) return;
    const parsed = sendAnnouncementSchema.safeParse({ ...input, title, body });
    setMessage("");
    setErrors({});
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues)
        next[issue.path.join(".") || "form"] ??= issue.message;
      setErrors(next);
      setMessage("입력한 내용을 확인해 주세요");
      return;
    }
    if (!valid || (draft.audience && count === null)) return;
    submitting.current = true;
    const generation = lifetime.current;
    try {
      const response = await mutation.mutateAsync(parsed.data);
      if (!current() || generation !== lifetime.current) return;
      if (!response.ok) {
        const text =
          response.message === "announce_daily"
            ? "한 지점에는 하루에 공지를 20개까지 보낼 수 있어요"
            : response.message === "announce_recipients"
              ? "알림을 받을 사람이 500명을 넘어요. 층이나 공간을 좁혀 주세요"
              : response.message === "lounge_unavailable"
                ? "지금은 라운지에 공지를 쓸 수 없어요. 받는 곳을 다시 확인해 주세요"
                : adminErrorMessage(response.code);
        setMessage(text);
        toast.error(text);
        setErrors(
          Object.fromEntries(
            Object.entries(response.fieldErrors ?? {}).map(([key, values]) => [
              key,
              values[0] ?? text,
            ]),
          ),
        );
        if (response.message === "lounge_unavailable") {
          setRequest(null);
          setApproval(null);
          router.refresh();
        }
        return;
      }
      setTitle("");
      setBody("");
      setPreviewOpen(false);
      setRequest(null);
      setApproval(null);
      setDraft({
        lounge: data.lounge.available,
        audience: false,
        date: data.today,
        floorId: "",
        spaceId: "",
      });
      toast.success("공지를 보냈어요");
      startTransition(() => {
        router.replace(path, { scroll: false });
        router.refresh();
      });
    } catch {
      if (current() && generation === lifetime.current) {
        const text = adminErrorMessage("INTERNAL");
        setMessage(text);
        toast.error(text);
      }
    } finally {
      submitting.current = false;
    }
  }
  const titleCount = Array.from(title).length;
  const bodyCount = Array.from(body).length;
  const blocked =
    !valid ||
    (!draft.lounge && !draft.audience) ||
    (draft.lounge && !lounge.available) ||
    (draft.audience &&
      (count === null || count > 500 || (!draft.lounge && count === 0)));
  return (
    <AnnouncementPreviewContext.Provider value={{ key: requestKey, accept }}>
      {children}
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <AnnouncementDestinations
          data={data}
          draft={draft}
          lounge={lounge}
          count={count}
          busy={pending}
          onChange={setDraft}
        />
        {!valid && (
          <p role="alert" className="text-sm text-destructive">
            오늘부터 30일 안의 날짜와 올바른 받는 곳을 골라 주세요
          </p>
        )}
        {draft.lounge && !lounge.available && (
          <p role="alert" className="text-sm text-destructive">
            {loungeUnavailableMessage(lounge.reason)}
          </p>
        )}
        {result && !result.ok && (
          <p role="alert" className="text-sm text-destructive">
            {result.message}
          </p>
        )}
        {draft.audience && !draft.lounge && count === 0 && (
          <p className="text-sm text-muted-foreground">
            알림을 받을 사람이 없어요. 날짜나 범위를 바꿔 주세요
          </p>
        )}
        {count !== null && count > 500 && (
          <p role="alert" className="text-sm text-destructive">
            알림을 받을 사람이 500명을 넘어요. 층이나 공간을 좁혀 주세요
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor="announcement-title">제목</Label>
          <Input
            id="announcement-title"
            value={title}
            disabled={pending}
            onChange={(event) => setTitle(event.target.value)}
            aria-invalid={!!errors.title || titleCount > 60}
            aria-describedby="announcement-title-hint"
          />
          <p
            id="announcement-title-hint"
            className="text-xs text-muted-foreground tabular-nums"
          >
            {errors.title ?? `${titleCount}/60자`}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="announcement-body">내용</Label>
          <Textarea
            id="announcement-body"
            rows={6}
            value={body}
            disabled={pending}
            onChange={(event) => setBody(event.target.value)}
            aria-invalid={!!errors.body || bodyCount > 500}
            aria-describedby="announcement-body-hint"
          />
          <p
            id="announcement-body-hint"
            className="text-xs text-muted-foreground tabular-nums"
          >
            {errors.body ??
              `${500 - bodyCount}자 남음 · 링크는 자동으로 걸려요`}
          </p>
        </div>
        {message && (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setPreviewOpen(true)}
            disabled={pending || (!title.trim() && !body.trim())}
          >
            미리보기
          </Button>
          <Button type="submit" disabled={pending || blocked}>
            {pending
              ? "보내고 있어요"
              : announcementSendLabel(draft.lounge, draft.audience, count)}
          </Button>
        </div>
      </form>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>공지 미리보기</DialogTitle>
            <DialogDescription>
              고른 받는 곳에 아래와 같이 보여요
            </DialogDescription>
          </DialogHeader>
          {draft.lounge && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">
                {data.branch.name} 라운지 # 공지
              </h3>
              <div className="rounded-lg bg-chat-mine p-4 text-chat-mine-foreground">
                <MessageBody
                  tone="mine"
                  body={`${title.trim()}\n\n${body.trim()}\n\n<@everyone>`}
                />
              </div>
            </section>
          )}
          {draft.audience && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">예약한 사람 알림</h3>
              <div className="flex gap-3 rounded-lg border p-4">
                <Megaphone aria-hidden="true" className="size-5 shrink-0" />
                <div className="min-w-0 space-y-2">
                  <p className="text-sm font-semibold wrap-anywhere">
                    {data.branch.name} 공지 · {title.trim()}
                  </p>
                  <p className="text-sm wrap-anywhere whitespace-pre-wrap">
                    {body.trim()}
                  </p>
                </div>
              </div>
            </section>
          )}
        </DialogContent>
      </Dialog>
    </AnnouncementPreviewContext.Provider>
  );
}
