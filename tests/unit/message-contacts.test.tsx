import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageContacts } from "@/features/chat/components/message-contacts";
import type { MessageContact } from "@/features/people/types";
import type { ActionResult } from "@/lib/actions/result";

const mocks = vi.hoisted(() => ({ push: vi.fn(), error: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
vi.mock("@/features/chat/actions", () => ({ openDirectMessage: vi.fn() }));
const people: MessageContact[] = [
  {
    userId: "friend",
    name: "이서연",
    username: "seoyeon.lee",
    isFriend: true,
    sharedTeamNames: ["같은 디자인 팀"],
    directRoomId: "existing",
  },
  {
    userId: "team",
    name: "박지훈",
    username: "jihoon.park",
    isFriend: false,
    sharedTeamNames: ["개발 팀"],
    directRoomId: null,
  },
];
beforeEach(() => vi.clearAllMocks());
function setup(
  rows = people,
  open = vi.fn(async () => ({ ok: true as const, data: { roomId: "new" } })),
) {
  const renderUi = render(
    <QueryClientProvider client={new QueryClient()}>
      <MessageContacts people={rows} open={open} />
    </QueryClientProvider>,
  );
  return { ...renderUi, open, user: userEvent.setup() };
}
describe("new message contacts", () => {
  it("groups friends first without duplicating shared team members and preserves existing room navigation after selection", async () => {
    const { user, open } = setup();
    await user.click(
      within(screen.getByRole("region", { name: "친구" })).getByRole(
        "checkbox",
        { name: /이서연/ },
      ),
    );
    expect(mocks.push).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "메시지" }));
    expect(mocks.push).toHaveBeenCalledWith("/dm/existing");
    expect(open).not.toHaveBeenCalled();
    expect(
      within(screen.getByRole("region", { name: "같은 팀" })).queryByText(
        "이서연",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("이서연")).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: /프로필/ }),
    ).not.toBeInTheDocument();
  });
  it("filters locally by name and case-insensitive username without fetching or opening a room", async () => {
    const { user, open } = setup();
    await user.type(screen.getByLabelText("이름으로 거르기"), "JIHOON");
    expect(screen.getByRole("checkbox", { name: /박지훈/ })).toBeVisible();
    expect(screen.queryByText("이서연")).not.toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText("이름으로 거르기"));
    await user.type(screen.getByLabelText("이름으로 거르기"), "없는 사람");
    expect(screen.getByRole("status")).toHaveTextContent(
      "이름이 맞는 사람이 없어요",
    );
  });
  it("opens a new room once and navigates only after the saved room id returns", async () => {
    const pending = Promise.withResolvers<ActionResult<{ roomId: string }>>();
    const open = vi.fn(() => pending.promise);
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <MessageContacts people={people} open={open} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /박지훈/ }));
    const button = screen.getByRole("button", { name: "메시지" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() =>
      expect(open).toHaveBeenCalledExactlyOnceWith({ userId: "team" }),
    );
    expect(mocks.push).not.toHaveBeenCalled();
    await act(async () =>
      pending.resolve({ ok: true, data: { roomId: "new-room" } }),
    );
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/dm/new-room");
  });
  it("offers friends navigation for an empty contact list", () => {
    setup([]);
    expect(
      screen.getByText(
        "친구를 추가하거나 팀에 들어가면 메시지를 보낼 수 있어요",
      ),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "친구" })).toHaveAttribute(
      "href",
      "/friends",
    );
  });
});
