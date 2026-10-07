import { parseArgs } from "node:util";
import {
  OperatorError,
  type OperatorErrorCode,
  type OperatorInput,
} from "@/lib/auth/operator-input";
import type { OperatorResult } from "@/lib/auth/operators";

export const adminCreateUsage =
  'pnpm admin:create --email ops@example.com --name "운영자 이름" --branch "가상 지점" [--create-branch] [--password "비밀번호"] [--reset-password]';

const errorMessages: Record<OperatorErrorCode, string> = {
  INVALID_INPUT:
    "이메일, 이름, 지점과 비밀번호를 확인해 주세요. 비밀번호는 8–128자예요.",
  BRANCH_NOT_FOUND:
    "지점을 찾을 수 없어요. 새로 만들려면 --create-branch를 함께 사용해 주세요.",
  BRANCH_AMBIGUOUS:
    "같은 이름의 지점이 둘 이상 있어요. 지점 이름을 먼저 정리해 주세요.",
  NAME_REQUIRED: "새 계정을 만들려면 --name으로 이름을 입력해 주세요.",
  UNVERIFIED_ACCOUNT:
    "이메일 인증을 마치지 않은 계정이에요. --reset-password로 비밀번호를 새로 정해 주세요.",
  INTERNAL:
    "운영자 계정을 준비하지 못했어요. 데이터베이스 연결과 마이그레이션 적용 상태를 확인해 주세요.",
};

export type AdminCreateDependencies = {
  getEnvironment: () => { DATABASE_URL?: string; AUTH_SECRET?: string };
  createOperator: (input: OperatorInput) => Promise<OperatorResult>;
  closeDatabase: () => Promise<void>;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

export async function runAdminCreate(
  args: string[],
  dependencies: AdminCreateDependencies,
): Promise<number> {
  let values: ReturnType<typeof parseAdminArguments>;
  try {
    values = parseAdminArguments(args);
  } catch {
    dependencies.stderr(
      "실행 인자를 확인해 주세요. pnpm admin:create --help로 사용법을 볼 수 있어요.",
    );
    return 1;
  }
  if (values.help) {
    dependencies.stdout(adminCreateUsage);
    return 0;
  }

  let result: OperatorResult | undefined;
  let exitCode = 0;
  try {
    const env = dependencies.getEnvironment();
    const missing = [
      ...(!env.DATABASE_URL ? ["DATABASE_URL"] : []),
      ...(!env.AUTH_SECRET ? ["AUTH_SECRET"] : []),
    ];
    if (missing.length > 0) {
      dependencies.stderr(
        `.env.local에 ${missing.join(", ")}을 설정해 주세요.`,
      );
      exitCode = 1;
    } else {
      result = await dependencies.createOperator({
        email: values.email ?? "",
        name: values.name,
        branch: values.branch ?? "",
        createBranch: values["create-branch"],
        password: values.password,
        resetPassword: values["reset-password"],
      });
    }
  } catch (error) {
    dependencies.stderr(
      errorMessages[error instanceof OperatorError ? error.code : "INTERNAL"],
    );
    exitCode = 1;
  } finally {
    try {
      await dependencies.closeDatabase();
    } catch {
      dependencies.stderr("데이터베이스 연결을 정리하지 못했어요.");
      exitCode = 1;
    }
  }

  if (result) {
    dependencies.stdout("운영자 계정을 준비했어요.");
    for (const warning of result.warnings) dependencies.stderr(warning);
    if (result.generatedPassword)
      dependencies.stdout(`생성한 비밀번호: ${result.generatedPassword}`);
  }
  return exitCode;
}

function parseAdminArguments(args: string[]) {
  return parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      email: { type: "string" },
      name: { type: "string" },
      branch: { type: "string" },
      password: { type: "string" },
      "create-branch": { type: "boolean", default: false },
      "reset-password": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  }).values;
}
