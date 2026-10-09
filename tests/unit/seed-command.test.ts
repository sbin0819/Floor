import { describe, expect, it, vi } from "vitest";
import { parseEnv } from "@/lib/env";
import { SeedError } from "@/lib/seed/errors";
import { loadSeedData } from "@/lib/seed/data";
import {
  floorPlansTarget,
  type FloorPlansReceipt,
} from "@/lib/seed/floor-plans-receipt";
import {
  chatSpacesTarget,
  type ChatSpacesReceipt,
} from "@/lib/seed/chat-spaces-receipt";
import {
  bookingRound2HostHash,
  type BookingRound2Receipt,
} from "@/lib/seed/booking-round2-receipt";
import {
  runSeedCommand,
  seedUsage,
  type SeedCommandDependencies,
} from "@/scripts/seed-command";

const currentTime = new Date("2026-10-07T03:00:00.000Z");
const connectionString =
  "postgresql://sql-user:private-db-password@localhost:5432/private-db-name?sslmode=require";
const authSecret = "private-auth-secret-with-at-least-32-bytes";

function dependencies(
  environment: Partial<
    ReturnType<SeedCommandDependencies["getEnvironment"]>
  > = {},
) {
  return {
    getEnvironment: vi.fn<SeedCommandDependencies["getEnvironment"]>(() => ({
      NODE_ENV: "development",
      DATABASE_URL: connectionString,
      AUTH_SECRET: authSecret,
      ...environment,
    })),
    now: vi.fn(() => currentTime),
    runSeed: vi.fn<SeedCommandDependencies["runSeed"]>().mockResolvedValue({
      counts: { branches: 2, users: 1 },
      skippedBookings: 3,
      accounts: ["fixture@example.test"],
    }),
    closeDatabase: vi
      .fn<SeedCommandDependencies["closeDatabase"]>()
      .mockResolvedValue(),
    readReceipt: vi
      .fn<SeedCommandDependencies["readReceipt"]>()
      .mockResolvedValue(null),
    writeReceipt: vi
      .fn<SeedCommandDependencies["writeReceipt"]>()
      .mockResolvedValue(),
    archiveReceipt: vi
      .fn<SeedCommandDependencies["archiveReceipt"]>()
      .mockResolvedValue(null),
    readChatSpacesReceipt: vi
      .fn<SeedCommandDependencies["readChatSpacesReceipt"]>()
      .mockResolvedValue(null),
    writeChatSpacesReceipt: vi
      .fn<SeedCommandDependencies["writeChatSpacesReceipt"]>()
      .mockResolvedValue(),
    archiveChatSpacesReceipt: vi
      .fn<SeedCommandDependencies["archiveChatSpacesReceipt"]>()
      .mockResolvedValue(null),
    readFloorPlansReceipt: vi
      .fn<SeedCommandDependencies["readFloorPlansReceipt"]>()
      .mockResolvedValue(null),
    writeFloorPlansReceipt: vi
      .fn<SeedCommandDependencies["writeFloorPlansReceipt"]>()
      .mockResolvedValue(),
    archiveFloorPlansReceipt: vi
      .fn<SeedCommandDependencies["archiveFloorPlansReceipt"]>()
      .mockResolvedValue(null),
    stdout: vi.fn(),
    stderr: vi.fn(),
  };
}

function expectNoDatabaseUse(deps: ReturnType<typeof dependencies>) {
  expect(deps.runSeed).not.toHaveBeenCalled();
  expect(deps.closeDatabase).not.toHaveBeenCalled();
  expect(deps.now).not.toHaveBeenCalled();
}

describe("seed command safety and output", () => {
  it("reports skipped meeting messages separately from skipped bookings", async () => {
    const deps = dependencies();
    deps.runSeed.mockResolvedValue({
      counts: { meetingRooms: 20, chatMessages: 40 },
      skippedBookings: 1,
      skippedMeetingMessages: 3,
      accounts: [],
    });
    expect(await runSeedCommand([], deps)).toBe(0);
    expect(deps.stdout).toHaveBeenCalledWith("건너뛴 예약: 1개");
    expect(deps.stdout).toHaveBeenCalledWith("건너뛴 회의 메시지: 3개");
  });
  const branchIds = loadSeedData()
    .branches.slice(0, 2)
    .map(({ id }) => id);

  it.each([
    "",
    "invalid",
    crypto.randomUUID(),
    `${branchIds[0]},${branchIds[0]}`,
  ])(
    "rejects invalid branch selection before environment access: %s",
    async (ids) => {
      const deps = dependencies();
      expect(await runSeedCommand(["--branches", ids], deps)).toBe(1);
      expect(deps.getEnvironment).not.toHaveBeenCalled();
      expectNoDatabaseUse(deps);
    },
  );

  it("rejects branch selection with password reset before environment access", async () => {
    const deps = dependencies();
    expect(
      await runSeedCommand(
        ["--branches", branchIds.join(","), "--reset-passwords"],
        deps,
      ),
    ).toBe(1);
    expect(deps.getEnvironment).not.toHaveBeenCalled();
    expectNoDatabaseUse(deps);
  });

  it("runs additive selection without an auth secret and reports only newly inserted counts", async () => {
    const deps = dependencies({ AUTH_SECRET: undefined });
    deps.runSeed.mockResolvedValue({
      counts: { branches: 1, users: 0 },
      skippedBookings: 0,
      accounts: ["admin@ai.com"],
      branchScope: {
        addedBranchIds: [branchIds[0]!],
        skippedBranchIds: [branchIds[1]!],
      },
    });
    expect(
      await runSeedCommand(
        ["--branches", branchIds.map((id) => id.toUpperCase()).join(",")],
        deps,
      ),
    ).toBe(0);
    expect(deps.runSeed).toHaveBeenCalledExactlyOnceWith({
      now: currentTime,
      resetPasswords: false,
      branchIds,
    });
    expect(deps.stdout).toHaveBeenCalledWith("추가한 지점: 1개");
    expect(deps.stdout).toHaveBeenCalledWith("이미 있어 건너뛴 지점: 1개");
    expect(deps.stdout).toHaveBeenCalledWith(
      "다음 건수는 이번에 추가한 행이며 DB 전체 건수가 아니에요.",
    );
    expect(deps.stdout).toHaveBeenCalledWith(
      "참조한 기존 계정 (변경 없음): admin@ai.com",
    );
    expect(JSON.stringify(deps.stdout.mock.calls)).not.toContain("비밀번호는");
    expect(deps.closeDatabase).toHaveBeenCalledOnce();
  });

  it("shows help without reading settings or using the database", async () => {
    const deps = dependencies();
    deps.getEnvironment.mockImplementation(() => {
      throw new Error("Environment must not be read");
    });
    expect(await runSeedCommand(["--help"], deps)).toBe(0);
    expect(deps.stdout).toHaveBeenCalledExactlyOnceWith(seedUsage);
    expect(deps.getEnvironment).not.toHaveBeenCalled();
    expect(deps.stderr).not.toHaveBeenCalled();
    expectNoDatabaseUse(deps);
  });

  it.each([
    "--unknown=private-password",
    "private-positional-secret",
    "--reset-passwords=false",
  ])("rejects unsupported arguments without echoing %s", async (argument) => {
    const deps = dependencies();
    expect(await runSeedCommand([argument], deps)).toBe(1);
    expect(deps.getEnvironment).not.toHaveBeenCalled();
    expect(JSON.stringify(deps.stderr.mock.calls)).not.toContain(argument);
    expectNoDatabaseUse(deps);
  });

  it.each(["localhost", "remote.example.test"])(
    "blocks production before any database work even for %s",
    async (host) => {
      const deps = dependencies({
        NODE_ENV: "production",
        DATABASE_URL: `postgresql://user:password@${host}/floor`,
        SEED_ALLOW_HOST: host,
      });
      expect(await runSeedCommand([], deps)).toBe(1);
      expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(
        "배포 환경에서는 개발용 시드를 실행할 수 없어요.",
      );
      expect(deps.stdout).not.toHaveBeenCalled();
      expectNoDatabaseUse(deps);
    },
  );

  it("requires exact remote host authorization and prints only that hostname", async () => {
    const deps = dependencies({
      DATABASE_URL:
        "postgresql://sql-user:private-db-password@remote.example.test/private-db-name",
    });
    expect(await runSeedCommand([], deps)).toBe(1);
    expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(
      "이 DB에 시드를 넣으려면 .env.local에 SEED_ALLOW_HOST=remote.example.test를 적어 주세요.",
    );
    expect(JSON.stringify(deps.stderr.mock.calls)).not.toMatch(
      /sql-user|private-db-password|private-db-name|postgresql:/,
    );
    expectNoDatabaseUse(deps);
  });

  it.each([
    "example.test",
    "remote.example.test.evil",
    "REMOTE.EXAMPLE.TEST",
    " remote.example.test",
    "remote.example.test:5432",
    "*",
  ])("does not broaden the allowlist value %s", async (allowed) => {
    const deps = dependencies({
      DATABASE_URL: "postgresql://user:password@remote.example.test/floor",
      SEED_ALLOW_HOST: allowed,
    });
    expect(await runSeedCommand([], deps)).toBe(1);
    expectNoDatabaseUse(deps);
  });

  it("allows a remote host only when SEED_ALLOW_HOST matches", async () => {
    const deps = dependencies({
      DATABASE_URL:
        "postgresql://user:password@remote.example.test/floor?sslmode=require",
      SEED_ALLOW_HOST: "remote.example.test",
    });
    expect(await runSeedCommand([], deps)).toBe(0);
    expect(deps.runSeed).toHaveBeenCalledExactlyOnceWith({
      now: currentTime,
      resetPasswords: false,
    });
    expect(deps.stdout).toHaveBeenNthCalledWith(
      1,
      "시드를 넣을 DB 호스트: remote.example.test",
    );
    expect(deps.closeDatabase).toHaveBeenCalledOnce();
  });

  it.each(["localhost", "127.0.0.1"])(
    "allows local host %s without an allowlist",
    async (host) => {
      const deps = dependencies({
        DATABASE_URL: `postgres://user:password@${host}/floor`,
      });
      expect(await runSeedCommand([], deps)).toBe(0);
      expect(deps.runSeed).toHaveBeenCalledOnce();
      expect(deps.stderr).not.toHaveBeenCalled();
    },
  );

  it.each(["localhost.evil.example", "127.0.0.1.evil.example", "[::1]"])(
    "does not implicitly allow other hosts such as %s",
    async (host) => {
      const deps = dependencies({
        DATABASE_URL: `postgresql://user:password@${host}/floor`,
      });
      expect(await runSeedCommand([], deps)).toBe(1);
      expectNoDatabaseUse(deps);
    },
  );

  it.each([
    "postgresql://localhost/floor?host=remote.example.test",
    "postgresql://localhost/floor?%68ost=remote.example.test",
    "postgresql://allowed.example.test/floor?host=remote.example.test&host=another.example.test",
  ])("rejects driver host overrides before database use: %s", async (url) => {
    const deps = dependencies({
      DATABASE_URL: url,
      SEED_ALLOW_HOST: "allowed.example.test",
    });
    expect(await runSeedCommand([], deps)).toBe(1);
    expectNoDatabaseUse(deps);
    expect(JSON.stringify(deps.stderr.mock.calls)).not.toContain(url);
  });

  it.each([
    "private-invalid-connection",
    "https://localhost/floor",
    "socket:/tmp/postgres",
    "postgresql:///floor",
  ])(
    "rejects malformed or unsupported database targets without echoing %s",
    async (url) => {
      const deps = dependencies({ DATABASE_URL: url });
      expect(await runSeedCommand([], deps)).toBe(1);
      expectNoDatabaseUse(deps);
      expect(JSON.stringify(deps.stderr.mock.calls)).not.toContain(url);
    },
  );

  it.each([
    [{ DATABASE_URL: undefined }, "DATABASE_URL"],
    [{ AUTH_SECRET: undefined }, "AUTH_SECRET"],
    [{ DATABASE_URL: "", AUTH_SECRET: "" }, "DATABASE_URL, AUTH_SECRET"],
  ] as const)(
    "names missing configuration %j",
    async (environment, missing) => {
      const deps = dependencies(environment);
      expect(await runSeedCommand([], deps)).toBe(1);
      expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(
        `.env.local에 ${missing}을 설정해 주세요.`,
      );
      expectNoDatabaseUse(deps);
    },
  );

  it("passes the explicit reset flag and one injected instant, never printing credentials", async () => {
    const deps = dependencies();
    const resultWithExtraSecrets = {
      counts: { users: 1, branches: 2 },
      skippedBookings: 3,
      accounts: ["fixture@example.test"],
      password: "private-seed-password",
    };
    deps.runSeed.mockResolvedValue(resultWithExtraSecrets);
    expect(await runSeedCommand(["--reset-passwords"], deps)).toBe(0);
    expect(deps.now).toHaveBeenCalledOnce();
    expect(deps.runSeed).toHaveBeenCalledExactlyOnceWith({
      now: currentTime,
      resetPasswords: true,
    });
    expect(deps.stdout).toHaveBeenCalledWith("users: 1개");
    expect(deps.stdout).toHaveBeenCalledWith("branches: 2개");
    expect(deps.stdout).toHaveBeenCalledWith("건너뛴 예약: 3개");
    expect(deps.stdout).toHaveBeenCalledWith("계정: fixture@example.test");
    expect(deps.stdout).toHaveBeenCalledWith("비밀번호는 README에 있어요.");
    const output = JSON.stringify([
      deps.stdout.mock.calls,
      deps.stderr.mock.calls,
    ]);
    for (const secret of [
      connectionString,
      authSecret,
      "private-db-password",
      "private-seed-password",
      "sql-user",
      "private-db-name",
    ])
      expect(output).not.toContain(secret);
    expect(deps.stdout.mock.invocationCallOrder[0]).toBeLessThan(
      deps.runSeed.mock.invocationCallOrder[0]!,
    );
    expect(deps.closeDatabase).toHaveBeenCalledOnce();
  });

  it("redacts environment validation errors before accessing the database", async () => {
    const deps = dependencies();
    deps.getEnvironment.mockImplementation(() =>
      parseEnv({ AUTH_SECRET: "private-secret-too-short" }),
    );
    expect(await runSeedCommand([], deps)).toBe(1);
    expect(JSON.stringify(deps.stderr.mock.calls)).not.toContain(
      "private-secret-too-short",
    );
    expectNoDatabaseUse(deps);
  });

  it("prints only the explicitly safe SeedError message and closes the connection", async () => {
    const deps = dependencies();
    const message = "팀 fixture-id: 같은 이름의 다른 팀과 충돌해요.";
    deps.runSeed.mockRejectedValue(
      Object.assign(new SeedError(message), {
        cause: new Error("private-driver-secret"),
      }),
    );
    expect(await runSeedCommand([], deps)).toBe(1);
    expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(message);
    expect(deps.stdout).not.toHaveBeenCalledWith("시드 데이터를 준비했어요.");
    expect(deps.closeDatabase).toHaveBeenCalledOnce();
  });

  it("redacts unexpected runtime errors and closes the connection", async () => {
    const deps = dependencies();
    deps.runSeed.mockRejectedValue(
      new Error("SQL password=private-db-password token=private-token"),
    );
    expect(await runSeedCommand([], deps)).toBe(1);
    expect(JSON.stringify(deps.stderr.mock.calls)).not.toMatch(
      /SQL|private-db-password|private-token/,
    );
    expect(deps.closeDatabase).toHaveBeenCalledOnce();
  });

  it("redacts cleanup errors and returns a failing exit code", async () => {
    const deps = dependencies();
    deps.closeDatabase.mockRejectedValue(
      new Error("private-connection-secret"),
    );
    expect(await runSeedCommand([], deps)).toBe(1);
    expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(
      "데이터베이스 연결을 정리하지 못했어요.",
    );
  });
});

describe("explicit full-data reset safety", () => {
  const args = ["--reset-data", "--confirm-reset"];
  const resetResult = {
    counts: { users: 21, branches: 5 },
    skippedBookings: 0,
    accounts: ["admin@ai.com", "test1@ai.com"],
    reset: { migrationCount: 25, counts: { users: 7, branches: 2 } },
  };

  it.each([
    ["--reset-data"],
    ["--confirm-reset"],
    ["--confirm-reset", "--reset-passwords"],
    [...args, "--reset-passwords"],
    [...args, "--booking-round2"],
    [...args, "--branches", "invalid"],
    [...args, "--branches", ""],
  ])(
    "rejects invalid reset arguments %j before settings or DB access",
    async (...input) => {
      const deps = dependencies();
      expect(await runSeedCommand(input, deps)).toBe(1);
      expect(deps.getEnvironment).not.toHaveBeenCalled();
      expect(deps.readReceipt).not.toHaveBeenCalled();
      expect(deps.archiveReceipt).not.toHaveBeenCalled();
      expectNoDatabaseUse(deps);
    },
  );

  it.each(["localhost", "127.0.0.1", "remote.example.test"])(
    "requires exact explicit authorization even for %s",
    async (host) => {
      const deps = dependencies({
        DATABASE_URL: `postgresql://user:private-password@${host}/floor`,
      });
      expect(await runSeedCommand(args, deps)).toBe(1);
      expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(
        `이 DB를 초기화하려면 SEED_ALLOW_HOST=${host}를 정확히 설정해 주세요. 로컬 DB도 예외가 아니에요.`,
      );
      expect(deps.archiveReceipt).not.toHaveBeenCalled();
      expectNoDatabaseUse(deps);
    },
  );

  it.each(["LOCALHOST", " localhost", "localhost:5432", "*"])(
    "does not broaden local reset authorization %s",
    async (allowed) => {
      const deps = dependencies({ SEED_ALLOW_HOST: allowed });
      expect(await runSeedCommand(args, deps)).toBe(1);
      expectNoDatabaseUse(deps);
    },
  );

  it("blocks reset in production even with both confirmations and matching host", async () => {
    const deps = dependencies({
      NODE_ENV: "production",
      SEED_ALLOW_HOST: "localhost",
    });
    expect(await runSeedCommand(args, deps)).toBe(1);
    expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(
      "배포 환경에서는 개발용 시드를 실행할 수 없어요.",
    );
    expect(deps.archiveReceipt).not.toHaveBeenCalled();
    expectNoDatabaseUse(deps);
  });

  it("requires the auth secret to recreate accounts", async () => {
    const deps = dependencies({
      AUTH_SECRET: undefined,
      SEED_ALLOW_HOST: "localhost",
    });
    expect(await runSeedCommand(args, deps)).toBe(1);
    expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(
      ".env.local에 AUTH_SECRET을 설정해 주세요.",
    );
    expectNoDatabaseUse(deps);
  });

  it("reports the host first and archives only its receipt after the successful reset", async () => {
    const deps = dependencies({ SEED_ALLOW_HOST: "localhost" });
    deps.runSeed.mockResolvedValue(resetResult);
    deps.archiveReceipt.mockResolvedValue("receipt.reset-archive");
    expect(await runSeedCommand(args, deps)).toBe(0);
    expect(deps.runSeed).toHaveBeenCalledExactlyOnceWith({
      now: currentTime,
      resetPasswords: false,
      resetData: true,
    });
    expect(deps.stdout).toHaveBeenNthCalledWith(
      1,
      "시드를 넣을 DB 호스트: localhost",
    );
    expect(deps.stdout.mock.invocationCallOrder[1]).toBeLessThan(
      deps.runSeed.mock.invocationCallOrder[0]!,
    );
    expect(deps.archiveReceipt).toHaveBeenCalledExactlyOnceWith(
      bookingRound2HostHash("localhost"),
    );
    expect(deps.runSeed.mock.invocationCallOrder[0]).toBeLessThan(
      deps.archiveReceipt.mock.invocationCallOrder[0]!,
    );
    expect(deps.readReceipt).not.toHaveBeenCalled();
    expect(deps.writeReceipt).not.toHaveBeenCalled();
    expect(deps.stdout).toHaveBeenCalledWith(
      "기존 개발 데이터를 삭제하고 시드 데이터를 다시 만들었어요. 삭제한 데이터는 복구할 수 없어요.",
    );
    expect(deps.stdout).toHaveBeenCalledWith(
      "삭제한 기존 행: 9개 · 확인한 마이그레이션: 25개",
    );
    expect(deps.closeDatabase).toHaveBeenCalledOnce();
    const output = JSON.stringify([
      deps.stdout.mock.calls,
      deps.stderr.mock.calls,
    ]);
    for (const secret of [
      connectionString,
      authSecret,
      "private-db-password",
      "private-db-name",
    ])
      expect(output).not.toContain(secret);
  });

  it("allows a successful reset when that host has no previous receipt", async () => {
    const deps = dependencies({ SEED_ALLOW_HOST: "localhost" });
    deps.runSeed.mockResolvedValue(resetResult);
    expect(await runSeedCommand(args, deps)).toBe(0);
    expect(deps.stdout).toHaveBeenCalledWith(
      "이 호스트의 이전 예약 2차 적용 표식은 없어요.",
    );
  });

  it("never archives receipts when the reset transaction fails", async () => {
    const deps = dependencies({ SEED_ALLOW_HOST: "localhost" });
    deps.runSeed.mockRejectedValue(new SeedError("초기화를 롤백했어요."));
    expect(await runSeedCommand(args, deps)).toBe(1);
    expect(deps.archiveReceipt).not.toHaveBeenCalled();
    expect(deps.stderr).toHaveBeenCalledExactlyOnceWith("초기화를 롤백했어요.");
    expect(deps.closeDatabase).toHaveBeenCalledOnce();
  });

  it("distinguishes a committed reset from an archival failure without retrying or exposing errors", async () => {
    const deps = dependencies({ SEED_ALLOW_HOST: "localhost" });
    deps.runSeed.mockResolvedValue(resetResult);
    deps.archiveReceipt.mockRejectedValue(
      new Error("private-receipt-path private-token"),
    );
    expect(await runSeedCommand(args, deps)).toBe(1);
    expect(deps.runSeed).toHaveBeenCalledOnce();
    expect(deps.archiveReceipt).toHaveBeenCalledOnce();
    expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(
      "DB 초기화와 시드 재생성은 끝났지만 이전 적용 표식을 모두 보관하지 못했어요. 자동으로 다시 실행하지 말고 예약 2차·스페이스·평면도 표식을 직접 확인해 주세요. 삭제한 데이터는 복구할 수 없어요.",
    );
    expect(deps.stdout).not.toHaveBeenCalledWith("시드 데이터를 준비했어요.");
    expect(deps.closeDatabase).toHaveBeenCalledOnce();
  });

  it("does not archive the receipt while reset completion is still pending", async () => {
    const deps = dependencies({ SEED_ALLOW_HOST: "localhost" });
    let commit!: (result: typeof resetResult) => void;
    deps.runSeed.mockReturnValue(
      new Promise((resolve) => {
        commit = resolve;
      }),
    );
    const command = runSeedCommand(args, deps);
    expect(deps.runSeed).toHaveBeenCalledOnce();
    expect(deps.archiveReceipt).not.toHaveBeenCalled();
    commit(resetResult);
    expect(await command).toBe(0);
    expect(deps.archiveReceipt).toHaveBeenCalledOnce();
  });

  it("does not archive or claim reset success when the runner omits reset confirmation", async () => {
    const deps = dependencies({ SEED_ALLOW_HOST: "localhost" });
    expect(await runSeedCommand(args, deps)).toBe(1);
    expect(deps.archiveReceipt).not.toHaveBeenCalled();
    expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(
      "초기화 완료 여부를 확인하지 못했어요. 자동으로 다시 실행하지 말고 DB와 적용 표식을 직접 확인해 주세요.",
    );
    expect(deps.closeDatabase).toHaveBeenCalledOnce();
  });

  it.each([[], ["--reset-passwords"], ["--help"]])(
    "never forwards resetData or archives a receipt for other modes %j",
    async (...input) => {
      const deps = dependencies();
      expect(await runSeedCommand(input, deps)).toBe(0);
      expect(deps.archiveReceipt).not.toHaveBeenCalled();
      for (const [options] of deps.runSeed.mock.calls)
        expect(options).not.toHaveProperty("resetData");
    },
  );
});

describe("chat-spaces additions command", () => {
  const target = chatSpacesTarget(connectionString);
  const receipt: ChatSpacesReceipt = {
    version: 1,
    mode: "chat-spaces",
    targetHash: target.targetHash,
    manifestHash: "a".repeat(64),
    bundleHash: "b".repeat(64),
    appliedAt: currentTime.toISOString(),
    lounges: [
      {
        branchId: "15eeb72a-6e7f-57ca-a905-d8797f988992",
        spaceId: "8ac46e85-57e5-55cf-aa23-1608a7664b1d",
        roomId: "04b9ed91-94b2-5940-97bb-c67bca0132e7",
      },
    ],
  };
  const applied = {
    counts: { communitySpaces: 1, spaceMembers: 6, chatMessages: 6 },
    skippedBookings: 0,
    accounts: ["test1@ai.com"],
    chatSpaces: { applied: true, receipt },
  };
  const deps = () =>
    dependencies({ AUTH_SECRET: undefined, SEED_ALLOW_HOST: "localhost" });
  it.each([
    ["--reset-passwords"],
    ["--branches", "invalid"],
    ["--booking-round2"],
    ["--reset-data", "--confirm-reset"],
    ["--confirm-reset"],
  ])("rejects other modes %j before environment/DB reads", async (...other) => {
    const d = deps();
    expect(await runSeedCommand(["--chat-spaces", ...other], d)).toBe(1);
    expect(d.getEnvironment).not.toHaveBeenCalled();
    expect(d.readChatSpacesReceipt).not.toHaveBeenCalled();
    expectNoDatabaseUse(d);
  });
  it("requires exact allowed host including localhost", async () => {
    const d = dependencies({ AUTH_SECRET: undefined });
    expect(await runSeedCommand(["--chat-spaces"], d)).toBe(1);
    expectNoDatabaseUse(d);
    expect(d.readChatSpacesReceipt).not.toHaveBeenCalled();
  });
  it("writes a private target receipt only after commit and never initializes auth", async () => {
    const d = deps();
    let commit!: (value: typeof applied) => void;
    d.runSeed.mockReturnValue(
      new Promise((resolve) => {
        commit = resolve;
      }),
    );
    const command = runSeedCommand(["--chat-spaces"], d);
    await vi.waitFor(() => expect(d.runSeed).toHaveBeenCalledOnce());
    expect(d.runSeed).toHaveBeenCalledWith({
      now: currentTime,
      resetPasswords: false,
      chatSpaces: {
        targetHash: target.targetHash,
        databaseName: target.databaseName,
        receipt: null,
      },
    });
    expect(d.writeChatSpacesReceipt).not.toHaveBeenCalled();
    commit(applied);
    expect(await command).toBe(0);
    expect(d.writeChatSpacesReceipt).toHaveBeenCalledExactlyOnceWith(receipt);
    expect(d.writeReceipt).not.toHaveBeenCalled();
    expect(d.closeDatabase).toHaveBeenCalledOnce();
    const output = JSON.stringify([d.stdout.mock.calls, d.stderr.mock.calls]);
    expect(output).toContain("참조한 기존 계정 (변경 없음)");
    for (const value of [
      connectionString,
      target.databaseName,
      target.targetHash,
      "private-db-password",
      "비밀번호는",
    ])
      expect(output).not.toContain(value);
  });
  it("reuses a valid receipt without rewriting it", async () => {
    const d = deps();
    d.readChatSpacesReceipt.mockResolvedValue(receipt);
    d.runSeed.mockResolvedValue({
      ...applied,
      counts: {},
      chatSpaces: { applied: false, receipt },
    });
    expect(await runSeedCommand(["--chat-spaces"], d)).toBe(0);
    expect(d.runSeed).toHaveBeenCalledWith(
      expect.objectContaining({
        chatSpaces: {
          targetHash: target.targetHash,
          databaseName: target.databaseName,
          receipt,
        },
      }),
    );
    expect(d.writeChatSpacesReceipt).not.toHaveBeenCalled();
    expect(d.stdout).toHaveBeenCalledWith(
      "스페이스 적용 표식을 확인했어요. DB를 변경하지 않았어요.",
    );
  });
  it("blocks unreadable receipts before any DB access", async () => {
    const d = deps();
    d.readChatSpacesReceipt.mockRejectedValue(new Error("private receipt"));
    expect(await runSeedCommand(["--chat-spaces"], d)).toBe(1);
    expectNoDatabaseUse(d);
    expect(JSON.stringify(d.stderr.mock.calls)).not.toContain("private");
  });
  it("reports committed-but-unrecorded failure and never retries", async () => {
    const d = deps();
    d.runSeed.mockResolvedValue(applied);
    d.writeChatSpacesReceipt.mockRejectedValue(new Error("private path"));
    expect(await runSeedCommand(["--chat-spaces"], d)).toBe(1);
    expect(d.runSeed).toHaveBeenCalledOnce();
    expect(d.stderr).toHaveBeenCalledWith(
      "DB 적용은 끝났지만 완료 표식을 저장하지 못했어요. 자동 재실행·복구하지 말고 DB와 적용 표식을 직접 확인해 주세요.",
    );
    expect(d.stdout).not.toHaveBeenCalledWith("시드 데이터를 준비했어요.");
  });
  it("never records failed transactions or a mismatched committed result", async () => {
    const d = deps();
    d.runSeed.mockRejectedValue(new SeedError("부분 적용을 확인해 주세요."));
    expect(await runSeedCommand(["--chat-spaces"], d)).toBe(1);
    expect(d.writeChatSpacesReceipt).not.toHaveBeenCalled();
    d.runSeed.mockResolvedValue({
      ...applied,
      chatSpaces: {
        applied: true,
        receipt: { ...receipt, targetHash: "f".repeat(64) },
      },
    });
    expect(await runSeedCommand(["--chat-spaces"], d)).toBe(1);
    expect(d.writeChatSpacesReceipt).not.toHaveBeenCalled();
  });
  it("archives both mode receipts only after successful reset", async () => {
    const d = dependencies({ SEED_ALLOW_HOST: "localhost" });
    d.runSeed.mockResolvedValue({
      ...applied,
      chatSpaces: undefined,
      reset: { migrationCount: 27, counts: { users: 21 } },
    });
    expect(await runSeedCommand(["--reset-data", "--confirm-reset"], d)).toBe(
      0,
    );
    expect(d.archiveChatSpacesReceipt).toHaveBeenCalledExactlyOnceWith(
      target.targetHash,
    );
    expect(
      d.archiveChatSpacesReceipt.mock.invocationCallOrder[0],
    ).toBeGreaterThan(d.runSeed.mock.invocationCallOrder[0]!);
  });
  it("reports a failed chat receipt archive after the booking receipt was already archived", async () => {
    const d = dependencies({ SEED_ALLOW_HOST: "localhost" });
    d.runSeed.mockResolvedValue({
      ...applied,
      chatSpaces: undefined,
      reset: { migrationCount: 27, counts: { users: 21 } },
    });
    d.archiveReceipt.mockResolvedValue("booking.reset-archive");
    d.archiveChatSpacesReceipt.mockRejectedValue(
      new Error("private receipt path"),
    );
    expect(await runSeedCommand(["--reset-data", "--confirm-reset"], d)).toBe(
      1,
    );
    expect(d.runSeed).toHaveBeenCalledOnce();
    expect(d.archiveReceipt).toHaveBeenCalledOnce();
    expect(d.archiveChatSpacesReceipt).toHaveBeenCalledExactlyOnceWith(
      target.targetHash,
    );
    expect(d.stderr).toHaveBeenCalledExactlyOnceWith(
      "DB 초기화와 시드 재생성은 끝났지만 이전 적용 표식을 모두 보관하지 못했어요. 자동으로 다시 실행하지 말고 예약 2차·스페이스·평면도 표식을 직접 확인해 주세요. 삭제한 데이터는 복구할 수 없어요.",
    );
    expect(d.stdout).not.toHaveBeenCalledWith("시드 데이터를 준비했어요.");
    expect(d.closeDatabase).toHaveBeenCalledOnce();
  });
  it("rejects doubly encoded DB names before reading receipts or accessing the DB", async () => {
    const d = dependencies({
      DATABASE_URL: "postgres://localhost/%2546loor",
      SEED_ALLOW_HOST: "localhost",
    });
    expect(await runSeedCommand(["--chat-spaces"], d)).toBe(1);
    expect(d.readChatSpacesReceipt).not.toHaveBeenCalled();
    expectNoDatabaseUse(d);
    expect(JSON.stringify(d.stderr.mock.calls)).not.toContain("%2546loor");
  });
});

describe("floor-plans additions command", () => {
  const target = floorPlansTarget(connectionString);
  const receipt: FloorPlansReceipt = {
    version: 1,
    mode: "floor-plans",
    targetHash: target.targetHash,
    manifestHash: "a".repeat(64),
    appliedAt: currentTime.toISOString(),
    added: [],
    skipped: [
      {
        floorId: loadSeedData().floorPlans[0]!.floorId,
        reason: "existing_plan",
      },
    ],
  };
  const applied = {
    counts: { floorPlans: 10 },
    skippedBookings: 0,
    accounts: [],
    floorPlans: { applied: true, receipt },
  };
  const deps = () =>
    dependencies({ AUTH_SECRET: undefined, SEED_ALLOW_HOST: "localhost" });
  it.each([
    ["--reset-passwords"],
    ["--branches", "invalid"],
    ["--booking-round2"],
    ["--chat-spaces"],
    ["--reset-data", "--confirm-reset"],
    ["--confirm-reset"],
  ])(
    "rejects other modes %j before configuration or DB work",
    async (...flags) => {
      const d = deps();
      expect(await runSeedCommand(["--floor-plans", ...flags], d)).toBe(1);
      expect(d.getEnvironment).not.toHaveBeenCalled();
      expect(d.readFloorPlansReceipt).not.toHaveBeenCalled();
      expectNoDatabaseUse(d);
    },
  );
  it.each([undefined, "other", "LOCALHOST"])(
    "requires exact local host approval (%s)",
    async (allowed) => {
      const d = dependencies({
        AUTH_SECRET: undefined,
        SEED_ALLOW_HOST: allowed,
      });
      expect(await runSeedCommand(["--floor-plans"], d)).toBe(1);
      expect(d.readFloorPlansReceipt).not.toHaveBeenCalled();
      expectNoDatabaseUse(d);
    },
  );
  it("writes the target receipt only after commit and reports skipped floors without credentials", async () => {
    const d = deps();
    let commit!: (value: typeof applied) => void;
    d.runSeed.mockReturnValue(
      new Promise((resolve) => {
        commit = resolve;
      }),
    );
    const command = runSeedCommand(["--floor-plans"], d);
    await vi.waitFor(() => expect(d.runSeed).toHaveBeenCalledOnce());
    expect(d.runSeed).toHaveBeenCalledWith({
      now: currentTime,
      resetPasswords: false,
      floorPlans: {
        targetHash: target.targetHash,
        databaseName: target.databaseName,
        receipt: null,
      },
    });
    expect(d.writeFloorPlansReceipt).not.toHaveBeenCalled();
    commit(applied);
    expect(await command).toBe(0);
    expect(d.writeFloorPlansReceipt).toHaveBeenCalledExactlyOnceWith(receipt);
    expect(d.stdout).toHaveBeenCalledWith(
      expect.stringMatching(/건너뛴 층: 강남점.*평면도가 이미 있어요/u),
    );
    const output = JSON.stringify([d.stdout.mock.calls, d.stderr.mock.calls]);
    for (const secret of [
      connectionString,
      target.databaseName,
      target.targetHash,
      "private-db-password",
      "비밀번호는",
    ])
      expect(output).not.toContain(secret);
    expect(d.closeDatabase).toHaveBeenCalledOnce();
  });
  it("does not rewrite a validated completion receipt", async () => {
    const d = deps();
    d.readFloorPlansReceipt.mockResolvedValue(receipt);
    d.runSeed.mockResolvedValue({
      ...applied,
      counts: { floorPlans: 0 },
      floorPlans: { applied: false, receipt },
    });
    expect(await runSeedCommand(["--floor-plans"], d)).toBe(0);
    expect(d.writeFloorPlansReceipt).not.toHaveBeenCalled();
    expect(d.stdout).toHaveBeenCalledWith(
      "현재 DB의 평면도를 확인했어요. DB를 변경하지 않았어요.",
    );
  });
  it("records later additions even when an earlier receipt exists", async () => {
    const d = deps();
    d.readFloorPlansReceipt.mockResolvedValue(receipt);
    const next = {
      ...receipt,
      added: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          floorId: "00000000-0000-4000-8000-000000000002",
          createdBy: "00000000-0000-4000-8000-000000000003",
        },
      ],
    };
    d.runSeed.mockResolvedValue({
      ...applied,
      counts: { floorPlans: 1 },
      floorPlans: { applied: true, receipt: next },
    });
    expect(await runSeedCommand(["--floor-plans"], d)).toBe(0);
    expect(d.writeFloorPlansReceipt).toHaveBeenCalledExactlyOnceWith(next);
    expect(
      d.writeFloorPlansReceipt.mock.invocationCallOrder[0],
    ).toBeGreaterThan(d.runSeed.mock.invocationCallOrder[0]!);
  });
  it("records a first no-write audit and prints missing-floor and changed-space reasons", async () => {
    const d = deps();
    const seed = loadSeedData();
    const skipped: FloorPlansReceipt["skipped"] = [
      { floorId: seed.floors[0]!.id, reason: "missing_floor" },
      { floorId: seed.floors[1]!.id, reason: "changed_spaces" },
    ];
    const next = { ...receipt, skipped };
    d.runSeed.mockResolvedValue({
      ...applied,
      counts: { floorPlans: 0 },
      floorPlans: { applied: false, receipt: next },
    });
    expect(await runSeedCommand(["--floor-plans"], d)).toBe(0);
    expect(d.writeFloorPlansReceipt).toHaveBeenCalledExactlyOnceWith(next);
    expect(d.stdout).toHaveBeenCalledWith(
      expect.stringContaining("DB에 층이 없어요"),
    );
    expect(d.stdout).toHaveBeenCalledWith(
      expect.stringContaining("보관되지 않은 공간 구성이 달라요"),
    );
  });
  it("rejects unreadable receipts before DB work", async () => {
    const d = deps();
    d.readFloorPlansReceipt.mockRejectedValue(new Error("private file"));
    expect(await runSeedCommand(["--floor-plans"], d)).toBe(1);
    expectNoDatabaseUse(d);
    expect(JSON.stringify(d.stderr.mock.calls)).not.toContain("private file");
  });
  it("does not record failed transactions and reports committed receipt failure without retry or rollback claims", async () => {
    const d = deps();
    d.runSeed.mockRejectedValue(new SeedError("fixture failure"));
    expect(await runSeedCommand(["--floor-plans"], d)).toBe(1);
    expect(d.writeFloorPlansReceipt).not.toHaveBeenCalled();
    d.runSeed.mockResolvedValue(applied);
    d.writeFloorPlansReceipt.mockRejectedValue(new Error("private file"));
    expect(await runSeedCommand(["--floor-plans"], d)).toBe(1);
    expect(d.runSeed).toHaveBeenCalledTimes(2);
    expect(d.stderr).toHaveBeenLastCalledWith(
      "DB 적용은 끝났지만 완료 표식을 저장하지 못했어요. 자동 재실행·복구하지 말고 DB와 적용 표식을 직접 확인해 주세요.",
    );
    expect(d.stdout).not.toHaveBeenCalledWith("시드 데이터를 준비했어요.");
  });
  it("archives the new receipt only after a confirmed successful reset", async () => {
    const d = dependencies({ SEED_ALLOW_HOST: "localhost" });
    d.runSeed.mockResolvedValue({
      ...applied,
      floorPlans: undefined,
      reset: { migrationCount: 25, counts: {} },
    });
    expect(await runSeedCommand(["--reset-data", "--confirm-reset"], d)).toBe(
      0,
    );
    expect(d.archiveFloorPlansReceipt).toHaveBeenCalledExactlyOnceWith(
      target.targetHash,
    );
    expect(
      d.archiveFloorPlansReceipt.mock.invocationCallOrder[0],
    ).toBeGreaterThan(d.runSeed.mock.invocationCallOrder[0]!);
    d.archiveFloorPlansReceipt.mockRejectedValue(new Error("private path"));
    expect(await runSeedCommand(["--reset-data", "--confirm-reset"], d)).toBe(
      1,
    );
    expect(d.stderr).toHaveBeenLastCalledWith(
      expect.stringContaining("예약 2차·스페이스·평면도 표식"),
    );
  });
});

describe("booking-round2 command and commit receipts", () => {
  const hostHash = bookingRound2HostHash("localhost");
  const receipt: BookingRound2Receipt = {
    version: 1,
    mode: "booking-round2",
    hostHash,
    manifestHash: "a".repeat(64),
    appliedAt: currentTime.toISOString(),
    bundleHash: "b".repeat(64),
  };
  const appliedResult = {
    counts: {
      attendeeCounts: 6,
      bookingParticipants: 5,
      bookings: 9,
      spaceBlocks: 1,
    },
    skippedBookings: 0,
    accounts: ["test1@ai.com"],
    bookingRound2: { applied: true, receipt },
  };

  it.each([
    { other: ["--branches", "invalid"] },
    { other: ["--reset-passwords"] },
    { other: ["--branches", "", "--reset-passwords"] },
  ])(
    "rejects mutually exclusive arguments %j before configuration or receipt reads",
    async ({ other }) => {
      const deps = dependencies();
      expect(await runSeedCommand(["--booking-round2", ...other], deps)).toBe(
        1,
      );
      expect(deps.getEnvironment).not.toHaveBeenCalled();
      expect(deps.readReceipt).not.toHaveBeenCalled();
      expect(deps.writeReceipt).not.toHaveBeenCalled();
      expect(deps.stderr).toHaveBeenCalledWith(
        "--booking-round2는 --branches나 --reset-passwords와 함께 쓸 수 없어요.",
      );
      expectNoDatabaseUse(deps);
    },
  );

  it("does not require authentication configuration and only writes a receipt after the committed result", async () => {
    const deps = dependencies({ AUTH_SECRET: undefined });
    let commit!: (result: typeof appliedResult) => void;
    deps.runSeed.mockReturnValue(
      new Promise((resolve) => {
        commit = resolve;
      }),
    );
    const command = runSeedCommand(["--booking-round2"], deps);
    await vi.waitFor(() => expect(deps.runSeed).toHaveBeenCalledOnce());
    expect(deps.readReceipt).toHaveBeenCalledExactlyOnceWith(hostHash);
    expect(deps.writeReceipt).not.toHaveBeenCalled();
    expect(deps.runSeed).toHaveBeenCalledExactlyOnceWith({
      now: currentTime,
      resetPasswords: false,
      bookingRound2: { hostHash, receipt: null },
    });
    commit(appliedResult);
    expect(await command).toBe(0);
    expect(deps.writeReceipt).toHaveBeenCalledExactlyOnceWith(receipt);
    expect(deps.closeDatabase).toHaveBeenCalledOnce();
    const output = JSON.stringify(deps.stdout.mock.calls);
    expect(output).toContain("참조한 기존 계정 (변경 없음)");
    expect(output).not.toContain("비밀번호는");
    expect(output).not.toContain(receipt.bundleHash);
    expect(output).not.toContain(connectionString);
  });

  it("passes an existing receipt to the core and leaves it untouched on a validated rerun", async () => {
    const deps = dependencies({ AUTH_SECRET: undefined });
    deps.readReceipt.mockResolvedValue(receipt);
    deps.runSeed.mockResolvedValue({
      ...appliedResult,
      counts: {},
      bookingRound2: { applied: false, receipt },
    });
    expect(await runSeedCommand(["--booking-round2"], deps)).toBe(0);
    expect(deps.runSeed).toHaveBeenCalledWith({
      now: currentTime,
      resetPasswords: false,
      bookingRound2: { hostHash, receipt },
    });
    expect(deps.writeReceipt).not.toHaveBeenCalled();
    expect(deps.stdout).toHaveBeenCalledWith(
      "예약 2차 적용 표식을 확인했어요. DB를 변경하지 않았어요.",
    );
  });

  it("blocks malformed or unreadable receipts before any database work without exposing contents", async () => {
    const deps = dependencies();
    deps.readReceipt.mockRejectedValue(
      new Error("private token receipt contents"),
    );
    expect(await runSeedCommand(["--booking-round2"], deps)).toBe(1);
    expectNoDatabaseUse(deps);
    expect(deps.writeReceipt).not.toHaveBeenCalled();
    expect(JSON.stringify(deps.stderr.mock.calls)).not.toContain("private");
  });

  it("fails closed after receipt persistence failure and never retries or claims a rollback", async () => {
    const deps = dependencies();
    deps.runSeed.mockResolvedValue(appliedResult);
    deps.writeReceipt.mockRejectedValue(
      new Error("private receipt path and token"),
    );
    expect(await runSeedCommand(["--booking-round2"], deps)).toBe(1);
    expect(deps.runSeed).toHaveBeenCalledOnce();
    expect(deps.writeReceipt).toHaveBeenCalledOnce();
    expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(
      "DB 적용은 끝났지만 완료 표식을 저장하지 못했어요. 자동 재실행·복구하지 말고 DB와 적용 표식을 직접 확인해 주세요.",
    );
    expect(deps.stdout).not.toHaveBeenCalledWith("시드 데이터를 준비했어요.");
    expect(deps.closeDatabase).toHaveBeenCalledOnce();
  });

  it("never writes a receipt when the transaction fails", async () => {
    const deps = dependencies();
    deps.runSeed.mockRejectedValue(
      new SeedError("부분 적용 상태를 확인해 주세요."),
    );
    expect(await runSeedCommand(["--booking-round2"], deps)).toBe(1);
    expect(deps.writeReceipt).not.toHaveBeenCalled();
    expect(deps.closeDatabase).toHaveBeenCalledOnce();
  });

  it.each([
    { NODE_ENV: "production" as const },
    { DATABASE_URL: "postgres://user:private@remote.example.test/floor" },
  ])(
    "keeps existing production and remote-host guards for %j",
    async (environment) => {
      const deps = dependencies(environment);
      expect(await runSeedCommand(["--booking-round2"], deps)).toBe(1);
      expect(deps.readReceipt).not.toHaveBeenCalled();
      expectNoDatabaseUse(deps);
    },
  );
});
