import { z } from "zod";
import { permissionKeys, roles } from "@/lib/permissions/keys";

export type { RoleSettingInput } from "./role-settings-types";

const id = z.uuid().transform((value) => value.toLowerCase());
const minutes = z.number().int().min(30).max(1440).multipleOf(30).nullable();
const limits = z.strictObject({
  maxMinutesPerBooking: minutes.optional(),
  maxMinutesPerDay: minutes.optional(),
  maxDaysAhead: z.number().int().min(1).max(90).nullable().optional(),
});
const expectedUpdatedAt = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString())
  .nullable();

export const roleSettingSchema = z
  .strictObject({
    role: z.enum(roles),
    permissions: z.array(z.enum(permissionKeys)),
    limits,
  })
  .superRefine((value, context) => {
    if (value.role === "team_admin" && Object.keys(value.limits).length) {
      context.addIssue({
        code: "custom",
        path: ["limits"],
        message: "팀 관리자는 팀원 한도를 따라요.",
      });
    }
  });

export const resetRoleSettingsSchema = z.strictObject({
  branchId: id,
  expectedUpdatedAt,
});

export const updateRoleSettingsSchema = resetRoleSettingsSchema.extend({
  roles: z
    .array(roleSettingSchema)
    .min(1)
    .max(4)
    .refine(
      (values) =>
        new Set(values.map(({ role }) => role)).size === values.length,
      "같은 역할을 두 번 보낼 수 없어요.",
    ),
});
