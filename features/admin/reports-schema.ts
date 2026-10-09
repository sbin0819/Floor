import { z } from "zod";

export const getBranchReportsSchema = z.strictObject({
  branchId: z.uuid().transform((value) => value.toLowerCase()),
  tab: z.enum(["open", "resolved"]).default("open"),
});
export type GetBranchReportsInput = z.input<typeof getBranchReportsSchema>;
