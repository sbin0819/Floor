import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountMenuData } from "@/features/auth/queries";
import { ActionError } from "@/lib/actions/result";
import { avatarColorFor } from "@/lib/avatar";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  readAccountMenu: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/dal/people-status", () => ({
  readAccountMenu: mocks.readAccountMenu,
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireSession.mockResolvedValue({
    userId: "member",
    name: "회원",
    email: "member@example.test",
  });
  mocks.readAccountMenu.mockResolvedValue({
    name: "회원",
    avatar: {
      id: "member",
      avatarColor: null,
      avatarPhoto: false,
      avatarUrl: null,
    },
    isOperator: false,
    myStatus: "online",
    username: null,
  });
});

describe("account menu server data", () => {
  it("checks the session independently before querying staff membership", async () => {
    mocks.requireSession.mockRejectedValue(new ActionError("UNAUTHENTICATED"));
    await expect(getAccountMenuData()).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(mocks.readAccountMenu).not.toHaveBeenCalled();
  });

  it("returns only the profile, own status and derived operator boolean", async () => {
    expect(await getAccountMenuData()).toEqual({
      name: "회원",
      avatar: { color: avatarColorFor("member", null), photoUrl: null },
      email: "member@example.test",
      isOperator: false,
      myStatus: "online",
      username: null,
    });
    expect(mocks.readAccountMenu).toHaveBeenCalledExactlyOnceWith("member");
  });

  it("does not expose operator branch rows", async () => {
    mocks.readAccountMenu.mockResolvedValue({
      name: "회원",
      avatar: {
        id: "member",
        avatarColor: null,
        avatarPhoto: false,
        avatarUrl: null,
      },
      isOperator: true,
      myStatus: "dnd",
      username: "member",
      branches: [{ id: "branch-secret-id", name: "가상 지점" }],
    });
    expect(await getAccountMenuData()).toEqual({
      name: "회원",
      avatar: { color: avatarColorFor("member", null), photoUrl: null },
      email: "member@example.test",
      isOperator: true,
      myStatus: "dnd",
      username: "member",
    });
  });

  it("lets membership failures reach the error boundary instead of hiding them", async () => {
    const failure = new Error("membership failed");
    mocks.readAccountMenu.mockRejectedValue(failure);
    await expect(getAccountMenuData()).rejects.toBe(failure);
  });
  it("reads the current name and avatar instead of an older cached session name", async () => {
    mocks.readAccountMenu.mockResolvedValue({
      name: "바뀐 이름",
      avatar: {
        id: "member",
        avatarColor: "teal",
        avatarPhoto: true,
        avatarUrl: "https://avatars.githubusercontent.com/u/1",
      },
      isOperator: false,
      myStatus: "online",
      username: null,
    });
    expect(await getAccountMenuData()).toMatchObject({
      name: "바뀐 이름",
      avatar: {
        color: "teal",
        photoUrl: "https://avatars.githubusercontent.com/u/1",
      },
    });
    expect(mocks.readAccountMenu).toHaveBeenCalledTimes(1);
  });
});
