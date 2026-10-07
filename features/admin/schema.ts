import { z } from "zod";
import { amenityKeys } from "@/lib/spaces/amenities";
import { dayOpenHoursSchema } from "@/lib/time/open-hours";

export const adminSpaceTypes = [
  "meeting_room",
  "seminar",
  "phone_booth",
  "desk_area",
  "lounge",
] as const;

const idSchema = z.uuid().transform((value) => value.toLowerCase());
const textSchema = z
  .string()
  .refine(
    (value) => !value.includes("\0"),
    "저장할 수 없는 문자가 포함되어 있어요",
  );
const nameSchema = (max: number) =>
  textSchema
    .trim()
    .min(1, "이름을 입력해 주세요")
    .max(max, `이름은 ${max}자 이하로 입력해 주세요`);
const levelSchema = z
  .number("층 번호를 입력해 주세요")
  .int("층 번호는 정수로 입력해 주세요")
  .min(-5, "층 번호는 -5 이상이어야 해요")
  .max(100, "층 번호는 100 이하이어야 해요")
  .refine((value) => value !== 0, "층 번호는 0일 수 없어요");
const sortOrderSchema = z
  .number("순서를 입력해 주세요")
  .int("순서는 정수로 입력해 주세요")
  .min(0, "순서는 0 이상이어야 해요")
  .max(999, "순서는 999 이하이어야 해요");
const capacitySchema = z
  .number("정원을 입력해 주세요")
  .int("정원은 정수로 입력해 주세요")
  .min(1, "정원은 1명 이상이어야 해요")
  .max(500, "정원은 500명 이하이어야 해요")
  .nullable();
const spaceFields = {
  name: nameSchema(40),
  capacity: capacitySchema,
  bookable: z.boolean(),
  amenities: z.array(z.enum(amenityKeys)),
};

export const requiredOpenHoursSchema = z.strictObject({
  mon: dayOpenHoursSchema.nullable(),
  tue: dayOpenHoursSchema.nullable(),
  wed: dayOpenHoursSchema.nullable(),
  thu: dayOpenHoursSchema.nullable(),
  fri: dayOpenHoursSchema.nullable(),
  sat: dayOpenHoursSchema.nullable(),
  sun: dayOpenHoursSchema.nullable(),
});

export const updateBranchSchema = z.strictObject({
  branchId: idSchema,
  name: nameSchema(40),
  address: textSchema
    .trim()
    .max(100, "주소는 100자 이하로 입력해 주세요")
    .transform((value) => value || null),
  openHours: requiredOpenHoursSchema,
});
export const createFloorSchema = z.strictObject({
  branchId: idSchema,
  level: levelSchema,
  name: nameSchema(20),
  sortOrder: sortOrderSchema.optional(),
});
export const updateFloorSchema = z.strictObject({
  floorId: idSchema,
  level: levelSchema,
  name: nameSchema(20),
  sortOrder: sortOrderSchema,
});
export const createSpaceSchema = z
  .strictObject({
    floorId: idSchema,
    type: z.enum(adminSpaceTypes),
    ...spaceFields,
  })
  .refine(({ type, capacity }) => type === "lounge" || capacity !== null, {
    path: ["capacity"],
    message: "정원을 입력해 주세요",
  });
export const updateSpaceSchema = z.strictObject({
  spaceId: idSchema,
  ...spaceFields,
});
export const archiveSpaceSchema = z.strictObject({ spaceId: idSchema });
export const restoreSpaceSchema = z.strictObject({ spaceId: idSchema });

const accessSchema = z.enum(["everyone", "teams", "closed"]);
const teamIdsSchema = z
  .array(idSchema)
  .transform((values) => [...new Set(values)]);

export const setFloorAccessSchema = z
  .strictObject({
    floorId: idSchema,
    access: accessSchema,
    teamIds: teamIdsSchema,
  })
  .superRefine(({ access, teamIds }, context) => {
    if (access === "teams") {
      if (teamIds.length < 1 || teamIds.length > 20)
        context.addIssue({
          code: "custom",
          path: ["teamIds"],
          message: "이용할 팀을 1곳 이상 20곳 이하로 골라 주세요",
        });
    } else if (teamIds.length > 0)
      context.addIssue({
        code: "custom",
        path: ["teamIds"],
        message: "지정한 팀을 선택했을 때만 팀을 정할 수 있어요",
      });
  });
export const setSpaceAccessSchema = z
  .strictObject({
    spaceId: idSchema,
    access: accessSchema.nullable(),
    teamIds: teamIdsSchema,
  })
  .superRefine(({ access, teamIds }, context) => {
    if (access === "teams" && teamIds.length === 0)
      context.addIssue({
        code: "custom",
        path: ["teamIds"],
        message: "이용할 팀을 한 곳 이상 골라 주세요",
      });
    else if (access !== "teams" && teamIds.length > 0)
      context.addIssue({
        code: "custom",
        path: ["teamIds"],
        message: "지정한 팀을 선택했을 때만 팀을 정할 수 있어요",
      });
  });
