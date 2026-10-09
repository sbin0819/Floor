"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
} from "@/components/ui/dialog";
import {
  updateRoleSettings,
  resetRoleSettings,
} from "@/features/admin/role-settings-actions";
import {
  applyRoleSettingsChanges,
  changedRoleSettings,
  countRoleSettingsChanges,
  effectiveRoleLimits,
  lostPermissions,
  permissionCell,
  permissionLabels,
} from "../role-settings-editor";
import type {
  RoleSettingInput,
  RoleSettingsEditorData,
  RoleSettingsValues,
} from "../role-settings-types";
import type { ActionResult } from "@/lib/actions/result";
import type { PermissionKey, Role } from "@/lib/permissions/keys";
import type { RoleLimits } from "@/lib/permissions/types";
import { defaultLimits, defaultPermissions } from "@/lib/permissions/defaults";
import { roles } from "@/lib/permissions/keys";
import { AdminRoleSettingsFrame } from "./admin-role-settings-frame";
import { AdminRoleSettingsFields } from "./admin-role-settings-fields";
import { useAdminRoleSettingsNavigation } from "./use-admin-role-settings-navigation";
import { adminErrorMessage } from "./use-admin-mutation";

export const staleRoleSettingsMessage =
  "다른 운영자가 먼저 바꿨어요. 새로 불러온 뒤 다시 바꿔 주세요";
const successMessage =
  "저장했어요. 이미 잡힌 예약은 바뀌지 않고, 다음 예약부터 적용돼요";
type Outcome = {
  branchId: string;
  revision: number;
  kind: "save" | "reset";
  changes: RoleSettingInput[];
  result: ActionResult<{ updatedAt: string | null }>;
};
type State = {
  source: RoleSettingsEditorData;
  sourceReadKey: string | null;
  baseline: RoleSettingsEditorData;
  draft: RoleSettingsValues;
  reload: string | null;
  acknowledged: { version: string | null; previous: string | null } | null;
  stale: boolean;
  message: string;
};
function initial(data: RoleSettingsEditorData, readKey: string | null): State {
  return {
    source: data,
    sourceReadKey: readKey,
    baseline: data,
    draft: data.roles,
    reload: null,
    acknowledged: null,
    stale: false,
    message: "",
  };
}
function resetValues(): RoleSettingsValues {
  return {
    user: {
      permissions: [...defaultPermissions.user],
      limits: { ...defaultLimits.user },
    },
    team_member: {
      permissions: [...defaultPermissions.team_member],
      limits: { ...defaultLimits.team_member },
    },
    team_admin: { permissions: [...defaultPermissions.team_admin], limits: {} },
    operator: {
      permissions: [...defaultPermissions.operator],
      limits: { ...defaultLimits.operator },
    },
  };
}
function acceptsAcknowledged(state: State, data: RoleSettingsEditorData) {
  const acknowledgement = state.acknowledged;
  if (!acknowledgement) return true;
  if (acknowledgement.version !== null)
    return (
      data.updatedAt !== null &&
      new Date(data.updatedAt).getTime() >=
        new Date(acknowledgement.version).getTime()
    );
  return (
    data.updatedAt === null ||
    acknowledgement.previous === null ||
    new Date(data.updatedAt).getTime() >
      new Date(acknowledgement.previous).getTime()
  );
}
export function AdminRoleSettings({
  data,
  readKey = null,
}: {
  data: RoleSettingsEditorData;
  readKey?: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState(() => initial(data, readKey));
  const [confirm, setConfirm] = useState<"save" | "reset" | null>(null);
  const path = `/admin/branches/${data.branch.id}/roles`;
  const revision = useRef(0);
  const active = useRef(false);
  const submitting = useRef(false);
  const deferred = useRef<Outcome | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const changes = changedRoleSettings(state.baseline.roles, state.draft);
  const count = countRoleSettingsChanges(state.baseline.roles, state.draft);
  const lost = lostPermissions(
    state.baseline.roles,
    applyRoleSettingsChanges(state.baseline.roles, changes),
    data.context,
  );
  const navigation = useAdminRoleSettingsNavigation(path, count > 0);
  const mutation = useMutation({
    mutationKey: ["admin-actions"],
    scope: { id: "admin-actions" },
    retry: false,
    mutationFn: (input: {
      kind: "save" | "reset";
      value: unknown;
    }): Promise<ActionResult<{ updatedAt: string | null }>> =>
      input.kind === "save"
        ? updateRoleSettings(input.value)
        : resetRoleSettings(input.value),
  });
  if (state.source !== data || state.sourceReadKey !== readKey) {
    const newBranch = state.baseline.branch.id !== data.branch.id;
    const requested = state.reload !== null && state.reload === readKey;
    const replace =
      newBranch ||
      requested ||
      (!state.reload &&
        !count &&
        !mutation.isPending &&
        acceptsAcknowledged(state, data));
    setState(
      replace
        ? {
            ...initial(data, readKey),
            message: newBranch || requested ? "" : state.message,
            acknowledged: newBranch
              ? null
              : { version: data.updatedAt, previous: state.baseline.updatedAt },
          }
        : { ...state, source: data, sourceReadKey: readKey },
    );
  }
  const applyOutcome = useCallback(
    (outcome: Outcome) => {
      if (
        outcome.revision !== revision.current ||
        outcome.branchId !== data.branch.id ||
        !active.current ||
        window.location.pathname !== path
      )
        return;
      const { result } = outcome;
      if (!result.ok) {
        setConfirm(null);
        setState((old) => ({
          ...old,
          stale: result.code === "STALE",
          message:
            result.code === "STALE"
              ? staleRoleSettingsMessage
              : adminErrorMessage(result.code),
        }));
        return;
      }
      setState((old) => {
        const values =
          outcome.kind === "reset"
            ? resetValues()
            : applyRoleSettingsChanges(old.baseline.roles, outcome.changes);
        const settings = { ...old.baseline.roles };
        for (const role of roles)
          settings[role] = {
            ...values[role],
            stored:
              outcome.kind === "reset"
                ? false
                : old.baseline.roles[role].stored ||
                  outcome.changes.some((value) => value.role === role),
          };
        const baseline = {
          ...old.baseline,
          roles: settings,
          updatedAt: result.data.updatedAt,
          updatedByName: null,
        };
        return {
          ...old,
          baseline,
          draft: settings,
          stale: false,
          acknowledged: {
            version: result.data.updatedAt,
            previous: old.baseline.updatedAt,
          },
          message:
            outcome.kind === "save" ? successMessage : "기본값으로 되돌렸어요",
        };
      });
      setConfirm(null);
      toast.success(
        outcome.kind === "save" ? successMessage : "기본값으로 되돌렸어요",
      );
      router.refresh();
    },
    [path, router, data.branch.id],
  );
  useEffect(() => {
    active.current = true;
    const queued = deferred.current;
    if (queued) {
      deferred.current = null;
      queueMicrotask(() => applyOutcome(queued));
    }
    return () => {
      active.current = false;
      setConfirm(null);
    };
  }, [applyOutcome]);
  const busy = mutation.isPending || state.reload !== null;
  function editPermission(role: Role, key: PermissionKey, checked: boolean) {
    if (
      busy ||
      permissionCell(role, key, state.draft[role].permissions).disabled
    )
      return;
    revision.current += 1;
    setState((old) => ({
      ...old,
      message: "",
      draft: {
        ...old.draft,
        [role]: {
          ...old.draft[role],
          permissions: checked
            ? [...old.draft[role].permissions, key]
            : old.draft[role].permissions.filter((value) => value !== key),
        },
      },
    }));
  }
  function editLimit(role: Role, key: keyof RoleLimits, value: number | null) {
    if (busy || role === "team_admin") return;
    revision.current += 1;
    setState((old) => {
      const limits = { ...old.draft[role].limits };
      const original = old.baseline.roles[role].limits[key];
      if (
        value ===
        effectiveRoleLimits(role, old.baseline.roles[role].limits)[key]
      ) {
        if (original === undefined) delete limits[key];
        else limits[key] = original;
      } else limits[key] = value;
      return {
        ...old,
        message: "",
        draft: { ...old.draft, [role]: { ...old.draft[role], limits } },
      };
    });
  }
  function undo() {
    revision.current += 1;
    setState((old) => ({ ...old, draft: old.baseline.roles, message: "" }));
  }
  function openConfirm(kind: "save" | "reset") {
    setConfirm(kind);
  }
  async function submit(kind: "save" | "reset") {
    if (
      submitting.current ||
      busy ||
      state.stale ||
      window.location.pathname !== path
    )
      return;
    submitting.current = true;
    const current = revision.current;
    const input = {
      branchId: data.branch.id,
      expectedUpdatedAt: state.baseline.updatedAt,
    };
    try {
      const result = await mutation.mutateAsync({
        kind,
        value: kind === "save" ? { ...input, roles: changes } : input,
      });
      const outcome = {
        branchId: data.branch.id,
        revision: current,
        kind,
        changes,
        result,
      };
      if (active.current && window.location.pathname === path)
        applyOutcome(outcome);
      else deferred.current = outcome;
    } catch {
      const outcome: Outcome = {
        branchId: data.branch.id,
        revision: current,
        kind,
        changes,
        result: { ok: false, code: "INTERNAL" },
      };
      if (active.current && window.location.pathname === path)
        applyOutcome(outcome);
      else deferred.current = outcome;
    } finally {
      submitting.current = false;
    }
  }
  function reload() {
    if (window.location.pathname !== path) return;
    revision.current += 1;
    const nonce = crypto.randomUUID();
    setState((old) => ({ ...old, reload: nonce }));
    const search = new URLSearchParams(window.location.search);
    search.set("reload", nonce);
    router.replace(`${path}?${search}`, { scroll: false });
  }
  const leaving = navigation.request !== null;
  const open = leaving || confirm !== null;
  return (
    <AdminRoleSettingsFrame
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm tabular-nums" role="status">
            바꾼 것 {count}개
          </span>
          <Button variant="outline" onClick={undo} disabled={!count || busy}>
            되돌리기
          </Button>
          <Button
            onClick={() =>
              lost.length ? openConfirm("save") : void submit("save")
            }
            disabled={!count || busy || state.stale}
          >
            {mutation.isPending ? "저장하는 중…" : "저장"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">{data.branch.name}</p>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {state.baseline.updatedAt
              ? `마지막 변경 · ${state.baseline.updatedByName ?? "운영자"} · ${new Intl.DateTimeFormat("ko-KR", { timeZone: data.branch.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(state.baseline.updatedAt))}`
              : "아직 바꾸지 않았어요. 기본값을 사용해요"}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => openConfirm("reset")}
          disabled={busy || state.stale}
        >
          기본값으로 되돌리기
        </Button>
      </div>
      {state.message && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4 text-sm">
          <p role={state.stale ? "alert" : "status"}>{state.message}</p>
          {state.stale && (
            <Button
              variant="outline"
              onClick={reload}
              disabled={state.reload !== null}
            >
              {state.reload ? "불러오는 중…" : "새로 불러오기"}
            </Button>
          )}
        </div>
      )}
      <AdminRoleSettingsFields
        before={state.baseline.roles}
        draft={state.draft}
        disabled={busy}
        onPermission={editPermission}
        onLimit={editLimit}
      />
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            navigation.cancel();
            setConfirm(null);
          }
        }}
      >
        <DialogContent
          onOpenAutoFocus={() => {
            returnFocus.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (
              window.location.pathname === path &&
              returnFocus.current?.isConnected
            )
              returnFocus.current.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {leaving
                ? "저장하지 않고 떠날까요?"
                : confirm === "reset"
                  ? "기본값으로 되돌릴까요?"
                  : "내 권한도 꺼져요"}
            </DialogTitle>
            <DialogDescription>
              {leaving
                ? "바꾼 내용은 저장되지 않아요."
                : confirm === "reset"
                  ? "이 지점의 역할 설정과 예약 한도를 모두 기본값으로 되돌려요. 이미 잡힌 예약은 바뀌지 않아요."
                  : "저장하면 아래 기능을 더 이상 사용할 수 없어요. 역할과 권한은 계속 바꿀 수 있어요."}
            </DialogDescription>
          </DialogHeader>
          {!leaving && confirm === "save" && (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {lost.map((key) => (
                <li key={key}>{permissionLabels[key]}</li>
              ))}
            </ul>
          )}
          {state.stale && (
            <p role="alert" className="text-sm">
              {staleRoleSettingsMessage}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                navigation.cancel();
                setConfirm(null);
              }}
            >
              계속 편집하기
            </Button>
            <Button
              disabled={!leaving && (busy || state.stale)}
              onClick={() => {
                if (leaving) {
                  revision.current += 1;
                  navigation.proceed();
                } else void submit(confirm === "reset" ? "reset" : "save");
              }}
            >
              {leaving
                ? "저장하지 않고 이동"
                : confirm === "reset"
                  ? "기본값으로 되돌리기"
                  : "권한을 끄고 저장"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminRoleSettingsFrame>
  );
}
