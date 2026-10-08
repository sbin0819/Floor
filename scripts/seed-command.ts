import { parseArgs } from "node:util";
import { SeedError } from "@/lib/seed/errors";
import type { SeedResult } from "@/lib/seed/run-seed";
import { loadSeedData } from "@/lib/seed/data";
import { validateSeedBranchIds } from "@/lib/seed/scope";
import {
  bookingRound2HostHash,
  type BookingRound2Receipt,
} from "@/lib/seed/booking-round2-receipt";

export const seedUsage =
  "pnpm db:seed [--reset-passwords] [--help]\npnpm db:seed --branches <UUID,UUID,...> (없는 지점만 추가, 기존 지점·계정은 변경하지 않음)\npnpm db:seed --booking-round2 (예약 2차 추가분만 적용, 다른 범위·비밀번호 초기화와 함께 사용 불가)";

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
    branchIds?: readonly string[];
    bookingRound2?: { hostHash: string; receipt: BookingRound2Receipt | null };
  }) => Promise<SeedResult>;
  readReceipt: (hostHash: string) => Promise<BookingRound2Receipt | null>;
  writeReceipt: (receipt: BookingRound2Receipt) => Promise<void>;
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
  if (
    values["booking-round2"] &&
    (values.branches !== undefined || values["reset-passwords"])
  ) {
    dependencies.stderr(
      "--booking-round2는 --branches나 --reset-passwords와 함께 쓸 수 없어요.",
    );
    return 1;
  }
  let branchIds: string[] | undefined;
  if (values.branches !== undefined) {
    try {
      branchIds = validateSeedBranchIds(
        values.branches.split(","),
        loadSeedData(),
        values["reset-passwords"],
      );
    } catch {
      dependencies.stderr(
        "추가할 시드 지점 ID를 중복 없이 확인해 주세요. --branches와 --reset-passwords는 함께 쓸 수 없어요.",
      );
      return 1;
    }
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
      ...(!branchIds && !values["booking-round2"] && !environment.AUTH_SECRET
        ? ["AUTH_SECRET"]
        : []),
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

  let bookingRound2:
    { hostHash: string; receipt: BookingRound2Receipt | null } | undefined;
  if (values["booking-round2"]) {
    try {
      const hostHash = bookingRound2HostHash(hostname);
      bookingRound2 = {
        hostHash,
        receipt: await dependencies.readReceipt(hostHash),
      };
    } catch {
      dependencies.stderr(
        "예약 2차 적용 표식을 읽지 못했어요. DB를 변경하지 않았어요. 표식과 적용 상태를 확인해 주세요.",
      );
      return 1;
    }
  }
  let exitCode = 0;
  let appliedWithoutReceipt = false;
  try {
    dependencies.stdout(`시드를 넣을 DB 호스트: ${hostname}`);
    const result = await dependencies.runSeed({
      now: dependencies.now(),
      resetPasswords: values["reset-passwords"],
      ...(branchIds ? { branchIds } : {}),
      ...(bookingRound2 ? { bookingRound2 } : {}),
    });
    if (bookingRound2) {
      if (!result.bookingRound2)
        throw new SeedError(
          "예약 2차 적용 결과를 확인하지 못했어요. 자동으로 다시 실행하지 말고 DB와 적용 표식을 확인해 주세요.",
        );
      if (result.bookingRound2.applied) {
        appliedWithoutReceipt = true;
        if (result.bookingRound2.receipt.hostHash !== bookingRound2.hostHash)
          throw new Error("Receipt host mismatch");
        await dependencies.writeReceipt(result.bookingRound2.receipt);
        appliedWithoutReceipt = false;
      }
      dependencies.stdout(
        result.bookingRound2.applied
          ? "예약 2차 추가분을 적용하고 완료 표식을 저장했어요."
          : "예약 2차 적용 표식을 확인했어요. DB를 변경하지 않았어요.",
      );
      dependencies.stdout(
        "다음 건수는 이번에 추가·보완한 행이며 DB 전체 건수가 아니에요.",
      );
    }
    dependencies.stdout("시드 데이터를 준비했어요.");
    if (result.branchScope) {
      dependencies.stdout(
        `추가한 지점: ${result.branchScope.addedBranchIds.length}개`,
      );
      dependencies.stdout(
        `이미 있어 건너뛴 지점: ${result.branchScope.skippedBranchIds.length}개`,
      );
      dependencies.stdout(
        "다음 건수는 이번에 추가한 행이며 DB 전체 건수가 아니에요.",
      );
    }
    for (const [table, count] of Object.entries(result.counts))
      dependencies.stdout(`${table}: ${count}개`);
    dependencies.stdout(`건너뛴 예약: ${result.skippedBookings}개`);
    dependencies.stdout(
      `${result.branchScope || bookingRound2 ? "참조한 기존 계정 (변경 없음)" : "계정"}: ${result.accounts.join(", ")}`,
    );
    if (!result.branchScope && !bookingRound2)
      dependencies.stdout("비밀번호는 README에 있어요.");
  } catch (error) {
    dependencies.stderr(
      appliedWithoutReceipt
        ? "DB 적용은 끝났지만 완료 표식을 저장하지 못했어요. 자동 재실행·복구하지 말고 DB와 적용 표식을 직접 확인해 주세요."
        : error instanceof SeedError
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
      "booking-round2": { type: "boolean", default: false },
      branches: { type: "string" },
      help: { type: "boolean", default: false },
    },
  }).values;
}
