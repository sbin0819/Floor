import {
  cloneElement,
  isValidElement,
  Suspense,
  use,
  type ReactElement,
  type ReactNode,
  type SuspenseProps,
} from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/(auth)/login/page";
import SignupPage from "@/app/(auth)/signup/page";
import ForgotPasswordPage from "@/app/(auth)/forgot-password/page";
import ResetPasswordPage from "@/app/(auth)/reset-password/page";
import VerifyEmailPage from "@/app/(auth)/verify-email/page";
import OperatorLoginPage from "@/app/(auth)/admin/login/page";
import TeamsPage from "@/app/(app)/teams/page";
import TeamStartPage from "@/app/(app)/teams/start/page";
import AdminPage from "@/app/admin/page";
import { MemberAuthFrame } from "@/features/auth/components/member-auth-frame";
import { TeamDetailSkeleton } from "@/features/teams/components/team-skeletons";
import { resolvePageContent } from "./page-test-utils";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  session: vi.fn(),
  memberGuard: vi.fn(),
  operatorGuard: vi.fn(),
  teams: vi.fn(),
  start: vi.fn(),
  operatorHome: vi.fn(),
  operatorCards: vi.fn(),
}));
vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth/session", () => ({
  getSession: mocks.session,
  requirePageSession: mocks.memberGuard,
  requireOperatorPage: mocks.operatorGuard,
}));
vi.mock("@/lib/auth/auth", () => ({
  getAuthUiOptions: () => ({ providers: [], emailEnabled: true }),
}));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ NODE_ENV: "development" }) }));
vi.mock("@/lib/dal", () => ({ getOperatorBranches: vi.fn() }));
vi.mock("@/lib/auth/client", () => ({ authClient: {} }));
vi.mock("@/features/teams/queries", () => ({
  getTeamsData: mocks.teams,
  getTeamStartData: mocks.start,
}));
vi.mock("@/features/admin/queries", () => ({
  getOperatorHome: mocks.operatorHome,
  getOperatorBranchCards: mocks.operatorCards,
}));
vi.mock("@/features/teams/components/team-start", () => ({
  TeamStart: () => <p>조회한 팀 화면</p>,
}));
vi.mock("@/features/teams/components/invite-response", () => ({
  InviteResponse: () => null,
}));
vi.mock("@/features/teams/components/request-controls", () => ({
  CancelJoinRequest: () => null,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function Streamed({ result }: { result: Promise<ReactNode> }) {
  return use(result);
}
function streamBoundary(boundary: ReactNode) {
  if (!isValidElement<SuspenseProps>(boundary) || boundary.type !== Suspense)
    throw new Error("Expected page Suspense");
  const content = boundary.props.children;
  if (
    !isValidElement<Record<string, unknown>>(content) ||
    typeof content.type !== "function"
  )
    throw new Error("Expected server component");
  const result = (
    content.type as (props: Record<string, unknown>) => Promise<ReactNode>
  )(content.props);
  return cloneElement(boundary, {}, <Streamed result={result} />);
}
function streamAuth(page: ReactElement<{ children: ReactNode }>) {
  if (page.type === MemberAuthFrame) {
    const card = page.props.children;
    if (!isValidElement<{ children: ReactNode }>(card))
      throw new Error("Expected card");
    return cloneElement(
      page,
      {},
      cloneElement(card, {}, streamBoundary(card.props.children)),
    );
  }
  return cloneElement(page, {}, streamBoundary(page.props.children));
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connection.mockResolvedValue(undefined);
  mocks.session.mockResolvedValue(null);
  mocks.memberGuard.mockResolvedValue({
    userId: "member",
    email: "member@example.test",
    name: "가상 회원",
  });
  mocks.operatorGuard.mockResolvedValue(undefined);
  mocks.teams.mockResolvedValue({ teams: [], invites: [], requests: [] });
  mocks.start.mockResolvedValue({
    branches: [],
    invites: [],
    search: { query: "", results: [] },
  });
  mocks.operatorHome.mockResolvedValue({ branches: [] });
  mocks.operatorCards.mockResolvedValue({ branches: [] });
});

describe("static page shells before request data", () => {
  it("shows team detail column labels and the back link while names and management controls remain unresolved", () => {
    render(<TeamDetailSkeleton />);
    expect(screen.getByRole("link", { name: "‹ 팀" })).toHaveAttribute(
      "href",
      "/teams",
    );
    expect(screen.getByRole("heading", { name: "팀원 목록" })).toBeVisible();
    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent),
    ).toEqual(["이름", "이메일", "직함", "역할"]);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("담당자 연락처")).not.toBeInTheDocument();
    expect(
      screen.queryByText("대기 중인 가입 요청이 없어요"),
    ).not.toBeInTheDocument();
  });
  it.each([
    [() => LoginPage({ searchParams: Promise.resolve({}) }), "Floor에 로그인"],
    [
      () => SignupPage({ searchParams: Promise.resolve({}) }),
      "Floor 계정 만들기",
    ],
    [ForgotPasswordPage, "비밀번호를 잊었나요?"],
    [
      () => ResetPasswordPage({ searchParams: Promise.resolve({}) }),
      "새 비밀번호를 정해 주세요",
    ],
    [
      () => VerifyEmailPage({ searchParams: Promise.resolve({}) }),
      "메일을 확인해 주세요",
    ],
    [OperatorLoginPage, "운영자 로그인"],
  ] as const)(
    "keeps auth shell %# visible while the request is pending",
    async (createPage, title) => {
      mocks.connection.mockReturnValue(new Promise<void>(() => {}));
      await act(async () => {
        render(streamAuth(createPage()));
      });
      expect(
        screen.getByRole("heading", { level: 1, name: title }),
      ).toBeVisible();
      expect(screen.getByRole("link", { name: "Floor" })).toHaveAttribute(
        "href",
        "/",
      );
      expect(screen.getByRole("heading", { level: 1 })).not.toHaveAttribute(
        "aria-busy",
      );
      expect(screen.getByRole("status")).toHaveTextContent("불러오고 있어요");
      expect(mocks.session).not.toHaveBeenCalled();
    },
  );

  it("keeps the team heading and navigation usable through delayed session and data, without inventing an empty list", async () => {
    const session = deferred<{ userId: string; email: string; name: string }>();
    const data = deferred<{ teams: []; invites: []; requests: [] }>();
    mocks.memberGuard.mockReturnValue(session.promise);
    mocks.teams.mockReturnValue(data.promise);
    const page = TeamsPage();
    await act(async () => {
      render(cloneElement(page, {}, streamBoundary(page.props.children)));
    });
    expect(screen.getByRole("heading", { level: 1, name: "팀" })).toBeVisible();
    expect(
      screen.getByRole("link", { name: "팀 만들기 또는 가입" }),
    ).toHaveAttribute("href", "/teams/start");
    expect(mocks.teams).not.toHaveBeenCalled();
    expect(screen.queryByText("아직 속한 팀이 없어요")).not.toBeInTheDocument();
    await act(async () => {
      session.resolve({
        userId: "member",
        email: "member@example.test",
        name: "가상 회원",
      });
    });
    expect(mocks.teams).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByText("아직 속한 팀이 없어요")).not.toBeInTheDocument();
    await act(async () => {
      data.resolve({ teams: [], invites: [], requests: [] });
    });
    expect(screen.getByText("아직 속한 팀이 없어요")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each(["choose", "create", "join"] as const)(
    "renders the %s team shell before its guard completes",
    async (mode) => {
      mocks.memberGuard.mockReturnValue(new Promise<void>(() => {}));
      const boundary = await resolvePageContent(
        TeamStartPage({
          searchParams: Promise.resolve({ mode, q: "가상 팀" }),
        }),
      );
      await act(async () => {
        render(streamBoundary(boundary));
      });
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        mode === "choose"
          ? "팀 회원으로 전환"
          : mode === "create"
            ? "새 팀 만들기"
            : "기존 팀에 가입",
      );
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(mocks.start).not.toHaveBeenCalled();
      expect(screen.queryByText("조회한 팀 화면")).not.toBeInTheDocument();
      if (mode === "choose")
        expect(
          screen.getByRole("link", { name: "새 팀 만들기" }),
        ).toHaveAttribute("href", "/teams/start?mode=create");
      if (mode === "create") {
        expect(screen.getByText("주 이용 지점")).toBeVisible();
        expect(
          screen.getByRole("button", { name: "팀 만들기" }),
        ).toBeDisabled();
      }
      if (mode === "join")
        expect(screen.getByText("팀 이름으로 찾기")).toBeVisible();
    },
  );

  it("shows operator headings before the guard without querying or displaying private branches", async () => {
    mocks.operatorGuard.mockReturnValue(new Promise<void>(() => {}));
    const page = AdminPage();
    await act(async () => {
      render(cloneElement(page, {}, streamBoundary(page.props.children)));
    });
    expect(
      screen.getByRole("heading", { level: 1, name: "운영자 화면" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 2, name: "운영 지점" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(mocks.operatorHome).not.toHaveBeenCalled();
    expect(mocks.operatorCards).not.toHaveBeenCalled();
  });
});
