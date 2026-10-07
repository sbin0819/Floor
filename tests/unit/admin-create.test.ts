import { describe, expect, it, vi } from "vitest";
import { OperatorError, operatorInputSchema } from "@/lib/auth/operator-input";
import {
  adminCreateUsage,
  runAdminCreate,
  type AdminCreateDependencies,
} from "@/scripts/admin-create-command";

function dependencies() {
  return {
    getEnvironment: vi.fn(() => ({
      DATABASE_URL: "postgresql://unused.example.test/floor",
      AUTH_SECRET: "unused-test-secret",
    })),
    createOperator: vi
      .fn<AdminCreateDependencies["createOperator"]>()
      .mockResolvedValue({
        userId: crypto.randomUUID(),
        branchId: crypto.randomUUID(),
        createdUser: false,
        passwordChanged: false,
        warnings: [],
      }),
    closeDatabase: vi
      .fn<AdminCreateDependencies["closeDatabase"]>()
      .mockResolvedValue(),
    stdout: vi.fn(),
    stderr: vi.fn(),
  };
}

const requiredArgs = ["--email", "ops@example.test", "--branch", "가상 지점"];

describe("admin:create command", () => {
  it("shows help without reading environment settings or creating a connection", async () => {
    const deps = dependencies();
    await expect(runAdminCreate(["--help"], deps)).resolves.toBe(0);
    expect(deps.stdout).toHaveBeenCalledExactlyOnceWith(adminCreateUsage);
    expect(deps.getEnvironment).not.toHaveBeenCalled();
    expect(deps.createOperator).not.toHaveBeenCalled();
    expect(deps.closeDatabase).not.toHaveBeenCalled();
  });

  it("passes every supported option to the operator function", async () => {
    const deps = dependencies();
    await expect(
      runAdminCreate(
        [
          ...requiredArgs,
          "--name",
          "운영자",
          "--password",
          "my-test-password",
          "--create-branch",
          "--reset-password",
        ],
        deps,
      ),
    ).resolves.toBe(0);
    expect(deps.createOperator).toHaveBeenCalledExactlyOnceWith({
      email: "ops@example.test",
      name: "운영자",
      branch: "가상 지점",
      password: "my-test-password",
      createBranch: true,
      resetPassword: true,
    });
    expect(deps.closeDatabase).toHaveBeenCalledOnce();
    expect(JSON.stringify(deps.stdout.mock.calls)).not.toContain(
      "my-test-password",
    );
  });

  it("names missing configuration without invoking authentication", async () => {
    const deps = dependencies();
    deps.getEnvironment.mockReturnValue({ DATABASE_URL: "", AUTH_SECRET: "" });
    await expect(runAdminCreate(requiredArgs, deps)).resolves.toBe(1);
    expect(deps.stderr).toHaveBeenCalledWith(
      expect.stringContaining("DATABASE_URL, AUTH_SECRET"),
    );
    expect(deps.createOperator).not.toHaveBeenCalled();
    expect(deps.stdout).not.toHaveBeenCalled();
  });

  it("prints a committed generated password exactly once after the operation succeeds", async () => {
    const deps = dependencies();
    deps.createOperator.mockResolvedValue({
      userId: crypto.randomUUID(),
      branchId: crypto.randomUUID(),
      createdUser: true,
      passwordChanged: true,
      generatedPassword: "generated-password-once",
      warnings: ["소셜 로그인 수단이 연결돼 있어요."],
    });
    await expect(runAdminCreate(requiredArgs, deps)).resolves.toBe(0);
    expect(
      deps.stdout.mock.calls.filter(([line]) =>
        line.includes("generated-password-once"),
      ),
    ).toEqual([["생성한 비밀번호: generated-password-once"]]);
    expect(deps.stderr).toHaveBeenCalledExactlyOnceWith(
      "소셜 로그인 수단이 연결돼 있어요.",
    );
    expect(deps.createOperator.mock.invocationCallOrder[0]).toBeLessThan(
      deps.stdout.mock.invocationCallOrder[0]!,
    );
  });

  it("never echoes secrets included in argument parser errors", async () => {
    const deps = dependencies();
    await expect(
      runAdminCreate([...requiredArgs, "private-secret-positional"], deps),
    ).resolves.toBe(1);
    expect(JSON.stringify(deps.stderr.mock.calls)).not.toContain(
      "private-secret-positional",
    );
    expect(deps.createOperator).not.toHaveBeenCalled();
  });

  it.each(["environment", "database"])(
    "reports %s failures without raw messages, SQL, or passwords",
    async (stage) => {
      const deps = dependencies();
      const error = new Error(
        "SELECT auth_accounts password=private-password auth-secret=private-secret",
      );
      if (stage === "environment")
        deps.getEnvironment.mockImplementation(() => {
          throw error;
        });
      else deps.createOperator.mockRejectedValue(error);
      await expect(runAdminCreate(requiredArgs, deps)).resolves.toBe(1);
      expect(deps.closeDatabase).toHaveBeenCalledOnce();
      expect(deps.stdout).not.toHaveBeenCalled();
      expect(JSON.stringify(deps.stderr.mock.calls)).not.toMatch(
        /SELECT|private-password|private-secret/,
      );
    },
  );

  it.each([
    "INVALID_INPUT",
    "BRANCH_NOT_FOUND",
    "BRANCH_AMBIGUOUS",
    "NAME_REQUIRED",
    "UNVERIFIED_ACCOUNT",
    "INTERNAL",
  ] as const)("provides a controlled message for %s", async (code) => {
    const deps = dependencies();
    deps.createOperator.mockRejectedValue(new OperatorError(code));
    await expect(runAdminCreate(requiredArgs, deps)).resolves.toBe(1);
    expect(deps.stderr).toHaveBeenCalledOnce();
    expect(deps.stdout).not.toHaveBeenCalled();
  });

  it("redacts connection cleanup errors while preserving credentials from committed work", async () => {
    const deps = dependencies();
    deps.closeDatabase.mockRejectedValue(new Error("connection-secret"));
    deps.createOperator.mockResolvedValue({
      userId: crypto.randomUUID(),
      branchId: crypto.randomUUID(),
      createdUser: true,
      passwordChanged: true,
      generatedPassword: "committed-password",
      warnings: [],
    });
    await expect(runAdminCreate(requiredArgs, deps)).resolves.toBe(1);
    expect(deps.stdout).toHaveBeenCalledWith(
      "생성한 비밀번호: committed-password",
    );
    expect(JSON.stringify(deps.stderr.mock.calls)).not.toContain(
      "connection-secret",
    );
  });
});

describe("operator input", () => {
  it("normalizes email and names without changing password characters", () => {
    expect(
      operatorInputSchema.parse({
        email: " Ops@Example.TEST ",
        name: " 운영자 ",
        branch: " 가상 지점 ",
        password: " password ",
      }),
    ).toEqual({
      email: "ops@example.test",
      name: "운영자",
      branch: "가상 지점",
      password: " password ",
      createBranch: false,
      resetPassword: false,
    });
  });

  it.each(["short77", "x".repeat(129)])(
    "rejects out-of-range password length",
    (password) => {
      expect(
        operatorInputSchema.safeParse({
          email: "ops@example.test",
          branch: "가상 지점",
          password,
        }).success,
      ).toBe(false);
    },
  );
});
