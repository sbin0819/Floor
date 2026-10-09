"use client";

import { useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Monitor, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AuthField } from "@/features/auth/components/auth-fields";
import type { AccountSettings as AccountSettingsData } from "../types";
import * as actions from "@/features/settings/actions";
import { changePasswordSchema } from "../schema";
import { SettingsCard } from "./settings-shell";

const labels = {
  credential: "비밀번호",
  google: "Google",
  github: "GitHub",
} as const;
const date = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value));
export function AccountSettings({
  data,
  changePassword = actions.changePassword,
  revokeSession = actions.revokeSession,
  revokeOtherSessions = actions.revokeOtherSessions,
}: {
  data: AccountSettingsData;
  changePassword?: typeof actions.changePassword;
  revokeSession?: typeof actions.revokeSession;
  revokeOtherSessions?: typeof actions.revokeOtherSessions;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const lock = useRef(false);
  const mutation = useMutation({
    mutationFn: (id: string | null) =>
      id ? revokeSession({ sessionId: id }) : revokeOtherSessions({}),
    retry: false,
  });
  async function revoke(id: string | null) {
    if (lock.current) return;
    lock.current = true;
    setError("");
    try {
      const result = await mutation.mutateAsync(id);
      if (!result.ok) {
        setError("로그아웃하지 못했어요. 다시 시도해 주세요");
        return;
      }
      toast.success("로그아웃했어요");
      router.refresh();
    } catch {
      setError("로그아웃하지 못했어요. 다시 시도해 주세요");
    } finally {
      lock.current = false;
    }
  }
  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        <SettingsCard title="이메일">
          <p className="break-all">
            {data.email}{" "}
            <span className="ml-2 text-xs text-muted-foreground">
              {data.emailVerified ? "인증됨" : "인증 대기"}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            이메일 바꾸기는 메일 발송 서비스를 붙인 뒤에 열려요
          </p>
        </SettingsCard>
        <SettingsCard title="비밀번호 바꾸기">
          {data.providers.includes("credential") ? (
            <PasswordForm action={changePassword} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {data.providers
                .filter((provider) => provider !== "credential")
                .map((provider) => labels[provider])
                .join("·") || "소셜 계정"}
              로 로그인하는 계정이에요. 비밀번호도 쓰려면 로그아웃한 뒤
              ‘비밀번호를 잊었어요’로 정할 수 있어요.
            </p>
          )}
        </SettingsCard>
      </div>
      <div className="space-y-5">
        <SettingsCard title="로그인 수단">
          <ul className="divide-y divide-border">
            {(["credential", "google", "github"] as const).map((provider) => (
              <li
                key={provider}
                className="flex min-h-11 items-center justify-between gap-4 text-sm"
              >
                <span>{labels[provider]}</span>
                <span className="text-muted-foreground">
                  {data.providers.includes(provider) ? "사용 중" : "없음"}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            같은 이메일의 Google·GitHub로 로그인하면 이 계정에 연결돼요. 처음
            연결될 때 비밀번호는 지워지고 다른 기기의 로그인이 끊겨요.
          </p>
        </SettingsCard>
        <SettingsCard title="로그인한 기기">
          <Button
            variant="outline"
            disabled={
              mutation.isPending ||
              !data.sessions.some((session) => !session.current)
            }
            onClick={() => void revoke(null)}
          >
            다른 기기 모두 로그아웃
          </Button>
          <ul className="divide-y divide-border">
            {data.sessions.map((session) => (
              <li key={session.id} className="flex items-start gap-3 py-4">
                {session.device === "mobile" ? (
                  <Smartphone
                    aria-hidden="true"
                    className="mt-1 size-5 shrink-0"
                  />
                ) : (
                  <Monitor
                    aria-hidden="true"
                    className="mt-1 size-5 shrink-0"
                  />
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-semibold">
                    {session.browser} · {session.os}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    최근 사용 {date(session.updatedAt)}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {date(session.createdAt)} 로그인
                  </p>
                  {session.current && <span className="text-xs">이 기기</span>}
                </div>
                {!session.current && (
                  <Button
                    variant="outline"
                    disabled={mutation.isPending}
                    aria-label={`${session.browser} · ${session.os} 로그아웃`}
                    onClick={() => void revoke(session.id)}
                  >
                    로그아웃
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </SettingsCard>
      </div>
    </div>
  );
}

function PasswordForm({ action }: { action: typeof actions.changePassword }) {
  const id = useId();
  const router = useRouter();
  const [values, setValues] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
    revokeOtherSessions: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const lock = useRef(false);
  const mutation = useMutation({
    mutationFn: (input: unknown) => action(input),
    retry: false,
  });
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (lock.current) return;
        const parsed = changePasswordSchema.safeParse(values);
        if (!parsed.success) {
          setErrors(
            Object.fromEntries(
              parsed.error.issues.map((issue) => [
                String(issue.path[0]),
                issue.message,
              ]),
            ),
          );
          return;
        }
        lock.current = true;
        setErrors({});
        try {
          const result = await mutation.mutateAsync(parsed.data);
          if (!result.ok) {
            setErrors(
              result.code === "PASSWORD_INCORRECT"
                ? { currentPassword: "지금 비밀번호가 맞지 않아요" }
                : result.fieldErrors
                  ? Object.fromEntries(
                      Object.entries(result.fieldErrors).map(
                        ([key, errors]) => [key, errors[0]!],
                      ),
                    )
                  : {
                      form:
                        result.message === "password_attempts"
                          ? "잠시 뒤에 다시 해 주세요"
                          : "비밀번호를 바꾸지 못했어요. 다시 시도해 주세요",
                    },
            );
            return;
          }
          setValues((current) => ({
            ...current,
            currentPassword: "",
            newPassword: "",
            confirmPassword: "",
          }));
          toast.success("비밀번호를 바꿨어요");
          router.refresh();
        } catch {
          setErrors({ form: "비밀번호를 바꾸지 못했어요. 다시 시도해 주세요" });
        } finally {
          lock.current = false;
        }
      }}
    >
      {(
        [
          ["currentPassword", "지금 비밀번호"],
          ["newPassword", "새 비밀번호"],
          ["confirmPassword", "새 비밀번호 확인"],
        ] as const
      ).map(([key, label]) => (
        <AuthField
          key={key}
          label={label}
          type="password"
          value={values[key]}
          error={errors[key]}
          autoComplete={
            key === "currentPassword" ? "current-password" : "new-password"
          }
          disabled={mutation.isPending}
          onChange={(event) =>
            setValues({ ...values, [key]: event.target.value })
          }
        />
      ))}
      <Label
        htmlFor={`${id}-revoke`}
        className="flex min-h-11 items-center gap-2"
      >
        <input
          type="checkbox"
          id={`${id}-revoke`}
          className="size-4 accent-primary focus-visible:outline-2 focus-visible:outline-ring"
          checked={values.revokeOtherSessions}
          disabled={mutation.isPending}
          onChange={(event) =>
            setValues({ ...values, revokeOtherSessions: event.target.checked })
          }
        />
        다른 기기에서 모두 로그아웃
      </Label>
      <Button type="submit" disabled={mutation.isPending}>
        비밀번호 바꾸기
      </Button>
      {errors.form && (
        <p role="alert" className="text-sm text-destructive">
          {errors.form}
        </p>
      )}
    </form>
  );
}
