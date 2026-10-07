import { z } from "zod";

export const operatorInputSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: z.string().trim().min(1).max(50).optional(),
  branch: z.string().trim().min(1),
  createBranch: z.boolean().default(false),
  password: z.string().min(8).max(128).optional(),
  resetPassword: z.boolean().default(false),
});

export type OperatorInput = z.input<typeof operatorInputSchema>;

export type OperatorErrorCode =
  | "INVALID_INPUT"
  | "BRANCH_NOT_FOUND"
  | "BRANCH_AMBIGUOUS"
  | "NAME_REQUIRED"
  | "UNVERIFIED_ACCOUNT"
  | "INTERNAL";

export class OperatorError extends Error {
  constructor(public readonly code: OperatorErrorCode) {
    super(code);
    this.name = "OperatorError";
  }
}
