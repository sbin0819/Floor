"use client";

import { useId } from "react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  permissionKeys,
  roles,
  type PermissionKey,
  type Role,
} from "@/lib/permissions/keys";
import type { RoleLimits } from "@/lib/permissions/types";
import { permissionCell, effectiveRoleLimits } from "../role-settings-editor";
import type { RoleSettingsValues } from "../role-settings-types";
import {
  limitKeys,
  limitLabels,
  permissionLabels,
  roleLabels,
} from "./admin-role-settings-frame";

const reasons = {
  operator_required: "끌 수 없어요",
  operator_only: "운영자만 가질 수 있어요",
  team_scoped: "팀 안의 권한이라 지점에서 바꿀 수 없어요",
};
function ChangedDot() {
  return (
    <span
      className="inline-block size-2 shrink-0 rounded-full bg-status-busy-strong"
      role="img"
      aria-label="바꾼 칸"
    />
  );
}
type FieldsProps = {
  before: RoleSettingsValues;
  draft: RoleSettingsValues;
  disabled: boolean;
  onPermission: (role: Role, key: PermissionKey, checked: boolean) => void;
  onLimit: (role: Role, key: keyof RoleLimits, value: number | null) => void;
};
function PermissionControl({
  role,
  permission,
  before,
  draft,
  disabled,
  onPermission,
}: FieldsProps & { role: Role; permission: PermissionKey }) {
  const id = useId();
  const cell = permissionCell(role, permission, draft[role].permissions);
  const changed =
    !cell.disabled &&
    before[role].permissions.includes(permission) !==
      draft[role].permissions.includes(permission);
  return (
    <div className="flex min-h-11 items-center justify-end gap-3 lg:justify-center">
      {changed && <ChangedDot />}
      <Switch
        aria-label={`${roleLabels[role]}: ${permissionLabels[permission]}`}
        checked={cell.checked}
        disabled={disabled || cell.disabled}
        onCheckedChange={(checked) => onPermission(role, permission, checked)}
        aria-describedby={cell.reason ? id : undefined}
        className="after:-inset-x-1.5 after:-inset-y-[13px]"
      />
      {cell.reason && (
        <span id={id} className="sr-only">
          {reasons[cell.reason]}
        </span>
      )}
    </div>
  );
}
function limitText(key: keyof RoleLimits, value: number | null | undefined) {
  if (value === null) return "제한 없음";
  if (value === undefined) return "기본값";
  return key === "maxDaysAhead"
    ? `${value}일`
    : value % 60 === 0
      ? `${value / 60}시간`
      : `${Math.floor(value / 60) ? `${Math.floor(value / 60)}시간 ` : ""}30분`;
}
function LimitControl({
  role,
  field,
  before,
  draft,
  disabled,
  onLimit,
}: FieldsProps & { role: Role; field: keyof RoleLimits }) {
  const value = effectiveRoleLimits(role, draft[role].limits)[field];
  const changed =
    effectiveRoleLimits(role, before[role].limits)[field] !== value;
  const choices =
    field === "maxDaysAhead"
      ? Array.from({ length: 90 }, (_, i) => i + 1)
      : Array.from({ length: 48 }, (_, i) => (i + 1) * 30);
  return (
    <div className="flex min-h-11 items-center justify-end gap-2 lg:justify-center">
      {changed && <ChangedDot />}
      <Select
        value={value === null ? "unlimited" : String(value)}
        disabled={disabled}
        onValueChange={(next) =>
          onLimit(role, field, next === "unlimited" ? null : Number(next))
        }
      >
        <SelectTrigger
          aria-label={`${roleLabels[role]}: ${limitLabels[field]}`}
          className="min-h-11 w-36 tabular-nums"
        >
          <SelectValue>{limitText(field, value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unlimited" className="min-h-11">
            제한 없음
          </SelectItem>
          {choices.map((choice) => (
            <SelectItem
              key={choice}
              value={String(choice)}
              className="min-h-11 tabular-nums"
            >
              {limitText(field, choice)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
export function AdminRoleSettingsFields(props: FieldsProps) {
  return (
    <>
      <section className="hidden space-y-4 rounded-xl border bg-card p-6 lg:block">
        <h2 className="font-semibold">역할별 권한</h2>
        <p className="text-sm text-muted-foreground">
          각 역할의 권한은 더해져요. 운영자도 일반 사용자 권한을 함께 받아요.
        </p>
        <table
          aria-label="역할별 권한"
          className="w-full table-fixed text-left text-sm"
        >
          <thead>
            <tr>
              <th className="w-[36%] py-3">권한</th>
              {roles.map((role) => (
                <th key={role} className="text-center">
                  {roleLabels[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {permissionKeys.map((permission) => (
              <tr key={permission} className="border-t">
                <th scope="row" className="py-3 pr-4 font-normal">
                  <p className="font-medium">{permissionLabels[permission]}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {permission}
                  </p>
                </th>
                {roles.map((role) => (
                  <td key={role}>
                    <PermissionControl
                      {...props}
                      role={role}
                      permission={permission}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs leading-5 text-muted-foreground">
          팀 스페이스 쓰기·팀 스페이스 메시지 지우기·팀원 관리는 팀 안의
          권한이라 지점에서 바꿀 수 없어요. 운영자만의 권한은 다른 역할에 줄 수
          없어요.
        </p>
      </section>
      <section className="hidden space-y-4 rounded-xl border bg-card p-6 lg:block">
        <h2 className="font-semibold">예약 한도</h2>
        <p className="text-sm text-muted-foreground">
          팀 관리자는 팀원 한도를 따라요. 이미 잡힌 예약에는 영향을 주지 않아요.
        </p>
        <table
          aria-label="예약 한도"
          className="w-full table-fixed text-left text-sm"
        >
          <thead>
            <tr>
              <th className="w-[36%] py-3">한도</th>
              {(["user", "team_member", "operator"] as const).map((role) => (
                <th key={role} className="text-center">
                  {roleLabels[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {limitKeys.map((field) => (
              <tr key={field} className="border-t">
                <th scope="row" className="py-4 font-medium">
                  {limitLabels[field]}
                </th>
                {(["user", "team_member", "operator"] as const).map((role) => (
                  <td key={role}>
                    <LimitControl {...props} role={role} field={field} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section
        aria-label="역할별 권한과 예약 한도"
        className="space-y-3 lg:hidden"
      >
        {roles.map((role, index) => (
          <details
            key={role}
            open={index === 0}
            className="rounded-xl border bg-card"
          >
            <summary className="min-h-11 cursor-pointer px-4 py-3 font-semibold focus-visible:outline-2 focus-visible:outline-ring">
              {roleLabels[role]}
            </summary>
            <div className="space-y-4 border-t p-4">
              <p className="text-xs text-muted-foreground">
                잠긴 권한은 이 지점에서 바꿀 수 없어요.
              </p>
              <ul className="divide-y">
                {permissionKeys.map((permission) => (
                  <li
                    key={permission}
                    className="flex items-center justify-between gap-4 py-2"
                  >
                    <div className="min-w-0 text-sm">
                      <p>{permissionLabels[permission]}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {permission}
                      </p>
                    </div>
                    <PermissionControl
                      {...props}
                      role={role}
                      permission={permission}
                    />
                  </li>
                ))}
              </ul>
              <h2 className="font-semibold">예약 한도</h2>
              {role === "team_admin" ? (
                <p className="text-sm text-muted-foreground">
                  팀원 한도를 따라요
                </p>
              ) : (
                limitKeys.map((field) => (
                  <div
                    key={field}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span>{limitLabels[field]}</span>
                    <LimitControl {...props} role={role} field={field} />
                  </div>
                ))
              )}
            </div>
          </details>
        ))}
      </section>
    </>
  );
}
