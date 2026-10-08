import { describe, expect, it, vi } from "vitest";
import { parseEnv } from "@/lib/env";
import { SeedError } from "@/lib/seed/errors";
import { loadSeedData } from "@/lib/seed/data";
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
      accounts: ["admin@floor.com"],
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
      "참조한 기존 계정 (변경 없음): admin@floor.com",
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
    accounts: ["member@floor.com"],
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
