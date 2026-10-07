import "server-only";

import { randomBytes } from "node:crypto";
import {
  createOperatorAuth,
  getAuth,
  type AuthInstance,
} from "@/lib/auth/auth";
import {
  OperatorError,
  operatorInputSchema,
  type OperatorInput,
} from "@/lib/auth/operator-input";
import {
  addBranchStaff,
  createBranch,
  getBranchesByName,
  getUserByEmail,
  withTransaction,
  type TransactionDatabase,
} from "@/lib/dal";

export type OperatorResult = {
  userId: string;
  branchId: string;
  createdUser: boolean;
  passwordChanged: boolean;
  generatedPassword?: string;
  warnings: string[];
};

export async function createOperator(
  input: OperatorInput,
  dependencies: { auth?: AuthInstance; db?: TransactionDatabase } = {},
): Promise<OperatorResult> {
  const parsed = operatorInputSchema.safeParse(input);
  if (!parsed.success) throw new OperatorError("INVALID_INPUT");
  const values = parsed.data;

  try {
    const auth = dependencies.auth ?? getAuth();
    return await withTransaction(async (database) => {
      const matchingBranches = await getBranchesByName(values.branch, database);
      if (matchingBranches.length > 1)
        throw new OperatorError("BRANCH_AMBIGUOUS");
      if (!matchingBranches[0] && !values.createBranch)
        throw new OperatorError("BRANCH_NOT_FOUND");

      const existingUser = await getUserByEmail(values.email, database);
      if (!existingUser && !values.name)
        throw new OperatorError("NAME_REQUIRED");
      if (existingUser && !existingUser.emailVerified && !values.resetPassword)
        throw new OperatorError("UNVERIFIED_ACCOUNT");

      const provisioning = await createOperatorAuth({ db: database, auth });
      const providers = existingUser
        ? await provisioning.listProviders(existingUser.id)
        : [];
      const passwordChanged = !existingUser || values.resetPassword;
      const generatedPassword =
        passwordChanged && values.password === undefined
          ? randomBytes(24).toString("base64url")
          : undefined;
      const password = values.password ?? generatedPassword;
      const passwordHash =
        passwordChanged && password !== undefined
          ? await provisioning.hashPassword(password)
          : undefined;

      const branch =
        matchingBranches[0] ?? (await createBranch(values.branch, database));
      const user =
        existingUser ??
        (await provisioning.createVerifiedUser({
          email: values.email,
          name: values.name!,
        }));
      if (passwordHash !== undefined) {
        await provisioning.setPassword(user.id, passwordHash);
        if (existingUser) {
          await provisioning.revokeSessions(user.id);
          await provisioning.verifyEmail(user.id);
        }
      }
      await addBranchStaff({ branchId: branch.id, userId: user.id }, database);

      const warnings: string[] = [];
      if (
        providers.some(
          (provider) => provider === "google" || provider === "github",
        )
      )
        warnings.push(
          "이 계정에는 소셜 로그인 수단이 연결돼 있어요. 해당 수단으로도 운영자 화면에 들어올 수 있어요.",
        );
      if (!passwordChanged)
        warnings.push(
          "기존 비밀번호를 유지했어요. 변경하려면 --reset-password를 함께 사용해 주세요.",
        );

      return {
        userId: user.id,
        branchId: branch.id,
        createdUser: existingUser === null,
        passwordChanged,
        ...(generatedPassword ? { generatedPassword } : {}),
        warnings,
      };
    }, dependencies.db);
  } catch (error) {
    if (error instanceof OperatorError) throw error;
    throw new OperatorError("INTERNAL");
  }
}
