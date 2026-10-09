import { parseArgs } from "node:util";
import { SeedError } from "@/lib/seed/errors";
import type { SeedResult } from "@/lib/seed/run-seed";
import { loadSeedData } from "@/lib/seed/data";
import {
  floorPlansTarget,
  type FloorPlansOptions,
  type FloorPlansReceipt,
} from "@/lib/seed/floor-plans-receipt";
import { validateSeedBranchIds } from "@/lib/seed/scope";
import {
  bookingRound2HostHash,
  type BookingRound2Receipt,
} from "@/lib/seed/booking-round2-receipt";
import {
  chatSpacesTarget,
  type ChatSpacesOptions,
  type ChatSpacesReceipt,
} from "@/lib/seed/chat-spaces-receipt";

export const seedUsage =
  "pnpm db:seed --floor-plans (평면도 행이 없는 시드 층에만 추가, 다른 모드와 병용 불가)\n" +
  "pnpm db:seed --chat-spaces (라운지·커뮤니티 추가만, 기존 계정·대화 보존. 다른 모드와 병용 불가)\n" +
  "pnpm db:seed [--reset-passwords] [--help]\npnpm db:seed --branches <UUID,UUID,...> (없는 지점만 추가, 기존 지점·계정은 변경하지 않음)\npnpm db:seed --booking-round2 (예약 2차 추가분만 적용, 다른 범위·비밀번호 초기화와 함께 사용 불가)\npnpm db:seed --reset-data --confirm-reset (기존 개발 데이터 전체 삭제 후 시드 재생성, 복구 불가. 로컬 DB도 정확한 SEED_ALLOW_HOST 필수)";

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
    resetData?: boolean;
    branchIds?: readonly string[];
    bookingRound2?: { hostHash: string; receipt: BookingRound2Receipt | null };
    chatSpaces?: ChatSpacesOptions;
    floorPlans?: FloorPlansOptions;
  }) => Promise<SeedResult>;
  readReceipt: (hostHash: string) => Promise<BookingRound2Receipt | null>;
  writeReceipt: (receipt: BookingRound2Receipt) => Promise<void>;
  archiveReceipt: (hostHash: string) => Promise<string | null>;
  readChatSpacesReceipt: (
    targetHash: string,
  ) => Promise<ChatSpacesReceipt | null>;
  writeChatSpacesReceipt: (receipt: ChatSpacesReceipt) => Promise<void>;
  archiveChatSpacesReceipt: (targetHash: string) => Promise<string | null>;
  readFloorPlansReceipt: (
    targetHash: string,
  ) => Promise<FloorPlansReceipt | null>;
  writeFloorPlansReceipt: (receipt: FloorPlansReceipt) => Promise<void>;
  archiveFloorPlansReceipt: (targetHash: string) => Promise<string | null>;
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
    values["floor-plans"] &&
    (values.branches !== undefined ||
      values["booking-round2"] ||
      values["chat-spaces"] ||
      values["reset-passwords"] ||
      values["reset-data"] ||
      values["confirm-reset"])
  ) {
    dependencies.stderr(
      "--floor-plans는 다른 시드 범위나 초기화 옵션과 함께 쓸 수 없어요.",
    );
    return 1;
  }
  if (
    values["chat-spaces"] &&
    (values.branches !== undefined ||
      values["booking-round2"] ||
      values["reset-passwords"] ||
      values["reset-data"] ||
      values["confirm-reset"])
  ) {
    dependencies.stderr(
      "--chat-spaces는 다른 시드 범위나 초기화 옵션과 함께 쓸 수 없어요.",
    );
    return 1;
  }
  if (values["reset-data"] !== values["confirm-reset"]) {
    dependencies.stderr(
      "전체 초기화에는 --reset-data와 --confirm-reset을 함께 적어 주세요. 기존 개발 데이터가 모두 삭제돼요.",
    );
    return 1;
  }
  if (
    values["reset-data"] &&
    (values.branches !== undefined ||
      values["booking-round2"] ||
      values["reset-passwords"])
  ) {
    dependencies.stderr(
      "--reset-data는 --branches, --booking-round2, --reset-passwords와 함께 쓸 수 없어요.",
    );
    return 1;
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
  let chatTarget: ReturnType<typeof chatSpacesTarget> | undefined;
  try {
    const environment = dependencies.getEnvironment();
    if (environment.NODE_ENV === "production") {
      dependencies.stderr("배포 환경에서는 개발용 시드를 실행할 수 없어요.");
      return 1;
    }
    const missing = [
      ...(!environment.DATABASE_URL ? ["DATABASE_URL"] : []),
      ...(!branchIds &&
      !values["booking-round2"] &&
      !values["chat-spaces"] &&
      !values["floor-plans"] &&
      !environment.AUTH_SECRET
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
    if (values["chat-spaces"] || values["reset-data"] || values["floor-plans"])
      chatTarget = values["floor-plans"]
        ? floorPlansTarget(environment.DATABASE_URL!)
        : chatSpacesTarget(environment.DATABASE_URL!);
    if (
      (values["reset-data"] ||
        values["chat-spaces"] ||
        values["floor-plans"] ||
        (hostname !== "localhost" && hostname !== "127.0.0.1")) &&
      environment.SEED_ALLOW_HOST !== hostname
    ) {
      dependencies.stderr(
        values["reset-data"]
          ? `이 DB를 초기화하려면 SEED_ALLOW_HOST=${hostname}를 정확히 설정해 주세요. 로컬 DB도 예외가 아니에요.`
          : `이 DB에 시드를 넣으려면 .env.local에 SEED_ALLOW_HOST=${hostname}를 적어 주세요.`,
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
  let chatSpaces: ChatSpacesOptions | undefined;
  if (values["chat-spaces"] && chatTarget) {
    try {
      chatSpaces = {
        targetHash: chatTarget.targetHash,
        databaseName: chatTarget.databaseName,
        receipt: await dependencies.readChatSpacesReceipt(
          chatTarget.targetHash,
        ),
      };
    } catch {
      dependencies.stderr(
        "스페이스 적용 표식을 읽지 못했어요. DB를 변경하지 않았어요. 표식과 적용 상태를 확인해 주세요.",
      );
      return 1;
    }
  }
  let exitCode = 0;
  let floorPlans: FloorPlansOptions | undefined;
  if (values["floor-plans"] && chatTarget) {
    try {
      floorPlans = {
        targetHash: chatTarget.targetHash,
        databaseName: chatTarget.databaseName,
        receipt: await dependencies.readFloorPlansReceipt(
          chatTarget.targetHash,
        ),
      };
    } catch {
      dependencies.stderr(
        "평면도 적용 표식을 읽지 못했어요. DB를 변경하지 않았어요. 표식과 적용 상태를 확인해 주세요.",
      );
      return 1;
    }
  }
  let appliedWithoutReceipt = false;
  let resetWithoutReceiptArchive = false;
  try {
    dependencies.stdout(`시드를 넣을 DB 호스트: ${hostname}`);
    if (values["reset-data"])
      dependencies.stdout(
        "이 호스트의 기존 개발 데이터를 모두 삭제하고 시드를 다시 만들어요. 삭제된 데이터는 복구할 수 없어요.",
      );
    const result = await dependencies.runSeed({
      now: dependencies.now(),
      resetPasswords: values["reset-passwords"],
      ...(values["reset-data"] ? { resetData: true } : {}),
      ...(branchIds ? { branchIds } : {}),
      ...(bookingRound2 ? { bookingRound2 } : {}),
      ...(chatSpaces ? { chatSpaces } : {}),
      ...(floorPlans ? { floorPlans } : {}),
    });
    if (values["reset-data"]) {
      if (!result.reset)
        throw new SeedError(
          "초기화 완료 여부를 확인하지 못했어요. 자동으로 다시 실행하지 말고 DB와 적용 표식을 직접 확인해 주세요.",
        );
      resetWithoutReceiptArchive = true;
      const archived = await dependencies.archiveReceipt(
        bookingRound2HostHash(hostname),
      );
      const archivedChat = await dependencies.archiveChatSpacesReceipt(
        chatTarget!.targetHash,
      );
      const archivedPlans = await dependencies.archiveFloorPlansReceipt(
        chatTarget!.targetHash,
      );
      resetWithoutReceiptArchive = false;
      dependencies.stdout(
        "기존 개발 데이터를 삭제하고 시드 데이터를 다시 만들었어요. 삭제한 데이터는 복구할 수 없어요.",
      );
      dependencies.stdout(
        `삭제한 기존 행: ${Object.values(result.reset.counts).reduce((sum, count) => sum + count, 0)}개 · 확인한 마이그레이션: ${result.reset.migrationCount}개`,
      );
      dependencies.stdout(
        archived
          ? `이 호스트의 이전 예약 2차 적용 표식을 같은 폴더에 보관했어요: ${archived}`
          : "이 호스트의 이전 예약 2차 적용 표식은 없어요.",
      );
      if (archivedChat)
        dependencies.stdout(
          "이 DB의 이전 스페이스 적용 표식을 같은 폴더에 보관했어요.",
        );
      if (archivedPlans)
        dependencies.stdout(
          "이 DB의 이전 평면도 적용 표식을 같은 폴더에 보관했어요.",
        );
    }
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
    if (chatSpaces) {
      if (!result.chatSpaces)
        throw new SeedError(
          "스페이스 적용 결과를 확인하지 못했어요. 자동으로 다시 실행하지 말고 DB와 적용 표식을 확인해 주세요.",
        );
      if (result.chatSpaces.applied) {
        appliedWithoutReceipt = true;
        if (result.chatSpaces.receipt.targetHash !== chatSpaces.targetHash)
          throw new Error("Receipt target mismatch");
        await dependencies.writeChatSpacesReceipt(result.chatSpaces.receipt);
        appliedWithoutReceipt = false;
      }
      dependencies.stdout(
        result.chatSpaces.applied
          ? "라운지·커뮤니티 추가분을 적용하고 완료 표식을 저장했어요."
          : "스페이스 적용 표식을 확인했어요. DB를 변경하지 않았어요.",
      );
      dependencies.stdout(
        "다음 건수는 이번에 추가한 행이며 DB 전체 건수가 아니에요.",
      );
    }
    if (floorPlans) {
      if (!result.floorPlans)
        throw new SeedError(
          "평면도 적용 결과를 확인하지 못했어요. 자동으로 다시 실행하지 말고 DB와 적용 표식을 확인해 주세요.",
        );
      if (result.floorPlans.applied || floorPlans.receipt === null) {
        appliedWithoutReceipt = true;
        if (result.floorPlans.receipt.targetHash !== floorPlans.targetHash)
          throw new Error("Receipt target mismatch");
        await dependencies.writeFloorPlansReceipt(result.floorPlans.receipt);
        appliedWithoutReceipt = false;
      }
      dependencies.stdout(
        result.floorPlans.applied
          ? "평면도 추가분을 적용하고 완료 표식을 저장했어요."
          : "현재 DB의 평면도를 확인했어요. DB를 변경하지 않았어요.",
      );
      const data = loadSeedData();
      for (const { floorId: id, reason } of result.floorPlans.receipt.skipped) {
        const floor = data.floors.find((row) => row.id === id);
        const branch = data.branches.find((row) => row.id === floor?.branchId);
        const explanation = {
          missing_floor: "DB에 층이 없어요",
          existing_plan: "평면도가 이미 있어요",
          changed_spaces: "보관되지 않은 공간 구성이 달라요",
        }[reason];
        dependencies.stdout(
          `건너뛴 층: ${branch?.name ?? "시드 지점"} ${floor?.name ?? id} · ${explanation}`,
        );
      }
      dependencies.stdout(
        "다음 건수는 이번에 추가한 행이며 DB 전체 건수가 아니에요.",
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
    if (result.skippedMeetingMessages !== undefined)
      dependencies.stdout(
        `건너뛴 회의 메시지: ${result.skippedMeetingMessages}개`,
      );
    dependencies.stdout(
      `${result.branchScope || bookingRound2 || chatSpaces || floorPlans ? "참조한 기존 계정 (변경 없음)" : "계정"}: ${result.accounts.join(", ")}`,
    );
    if (!result.branchScope && !bookingRound2 && !chatSpaces && !floorPlans)
      dependencies.stdout("비밀번호는 README에 있어요.");
  } catch (error) {
    dependencies.stderr(
      resetWithoutReceiptArchive
        ? "DB 초기화와 시드 재생성은 끝났지만 이전 적용 표식을 모두 보관하지 못했어요. 자동으로 다시 실행하지 말고 예약 2차·스페이스·평면도 표식을 직접 확인해 주세요. 삭제한 데이터는 복구할 수 없어요."
        : appliedWithoutReceipt
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
      "reset-data": { type: "boolean", default: false },
      "confirm-reset": { type: "boolean", default: false },
      "booking-round2": { type: "boolean", default: false },
      "chat-spaces": { type: "boolean", default: false },
      "floor-plans": { type: "boolean", default: false },
      branches: { type: "string" },
      help: { type: "boolean", default: false },
    },
  }).values;
}
