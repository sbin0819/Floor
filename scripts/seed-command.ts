import { parseArgs } from "node:util";
import { SeedError } from "@/lib/seed/errors";
import type { SeedResult } from "@/lib/seed/run-seed";

export const seedUsage = "pnpm db:seed [--reset-passwords] [--help]";

export type SeedCommandDependencies = {
  getEnvironment: () => {
    NODE_ENV: "development" | "production" | "test";
    DATABASE_URL?: string;
    AUTH_SECRET?: string;
    SEED_ALLOW_HOST?: string;
  };
  now: () => Date;
  runSeed: (options: {
    now: Date;
    resetPasswords: boolean;
  }) => Promise<SeedResult>;
  closeDatabase: () => Promise<void>;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
};

function databaseHost(connectionString: string): string {
  const url = new URL(connectionString);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
    throw new Error("Invalid database protocol");
  // 드라이버와 같은 hostname 정규화를 쓰되 쿼리의 host 덮어쓰기는 허용하지 않는다.
  const parsed = new URL(`http:${connectionString.slice(url.protocol.length)}`);
  if (!parsed.hostname || parsed.searchParams.has("host"))
    throw new Error("Invalid database host");
  return parsed.hostname;
}

export async function runSeedCommand(
  args: string[],
  dependencies: SeedCommandDependencies,
): Promise<number> {
  let values: ReturnType<typeof parseSeedArguments>;
  try {
    values = parseSeedArguments(args);
  } catch {
    dependencies.stderr(
      "실행 인자를 확인해 주세요. pnpm db:seed --help로 사용법을 볼 수 있어요.",
    );
    return 1;
  }
  if (values.help) {
    dependencies.stdout(seedUsage);
    return 0;
  }

  let hostname: string;
  try {
    const environment = dependencies.getEnvironment();
    if (environment.NODE_ENV === "production") {
      dependencies.stderr("배포 환경에서는 개발용 시드를 실행할 수 없어요.");
      return 1;
    }
    const missing = [
      ...(!environment.DATABASE_URL ? ["DATABASE_URL"] : []),
      ...(!environment.AUTH_SECRET ? ["AUTH_SECRET"] : []),
    ];
    if (missing.length > 0) {
      dependencies.stderr(
        `.env.local에 ${missing.join(", ")}을 설정해 주세요.`,
      );
      return 1;
    }
    hostname = databaseHost(environment.DATABASE_URL!);
    if (
      hostname !== "localhost" &&
      hostname !== "127.0.0.1" &&
      environment.SEED_ALLOW_HOST !== hostname
    ) {
      dependencies.stderr(
        `이 DB에 시드를 넣으려면 .env.local에 SEED_ALLOW_HOST=${hostname}를 적어 주세요.`,
      );
      return 1;
    }
  } catch {
    dependencies.stderr(
      "환경 설정을 확인해 주세요. DATABASE_URL은 호스트 덮어쓰기 옵션이 없는 PostgreSQL 연결 문자열이어야 해요.",
    );
    return 1;
  }

  let exitCode = 0;
  try {
    dependencies.stdout(`시드를 넣을 DB 호스트: ${hostname}`);
    const result = await dependencies.runSeed({
      now: dependencies.now(),
      resetPasswords: values["reset-passwords"],
    });
    dependencies.stdout("시드 데이터를 준비했어요.");
    for (const [table, count] of Object.entries(result.counts))
      dependencies.stdout(`${table}: ${count}개`);
    dependencies.stdout(`건너뛴 예약: ${result.skippedBookings}개`);
    dependencies.stdout(`계정: ${result.accounts.join(", ")}`);
    dependencies.stdout("비밀번호는 README에 있어요.");
  } catch (error) {
    dependencies.stderr(
      error instanceof SeedError
        ? error.publicMessage
        : "시드를 넣지 못했어요. 데이터와 데이터베이스 연결, 마이그레이션 적용 상태를 확인해 주세요.",
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
  return exitCode;
}

function parseSeedArguments(args: string[]) {
  return parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      "reset-passwords": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  }).values;
}
