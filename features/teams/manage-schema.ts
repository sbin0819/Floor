import { z } from "zod";
import { createTeamSchema, teamNameSchema } from "./schema";

const uuid = z.uuid().transform((value) => value.toLowerCase());
export const managedTeamSchema = z.strictObject({ teamId: uuid });
export const managedMemberSchema = managedTeamSchema.extend({ userId: uuid });
export const deleteTeamSchema = managedTeamSchema.extend({
  confirmName: teamNameSchema,
});
export const updateTeamSchema = createTeamSchema.omit({ title: true }).extend({
  teamId: uuid,
});
export const setMemberRoleSchema = managedMemberSchema.extend({
  role: z.enum(["admin", "member"]),
});
export const setMemberTitleSchema = managedMemberSchema.extend({
  title: createTeamSchema.shape.title,
});
