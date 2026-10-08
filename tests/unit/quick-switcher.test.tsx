import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  QuickSwitcher,
  QuickSwitchButton,
} from "@/features/chat/components/quick-switcher";
import { CHAT_NAV_KEY } from "@/features/chat/nav-state";
import type { MessageContact } from "@/features/people/types";
import type { ActionResult } from "@/lib/actions/result";
import { readRecentRooms, rememberRoom } from "@/features/chat/recent-rooms";
import { contacts, id, nav } from "./quick-switch-fixture";

const route = vi.hoisted(() => ({ pathname: "/", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ push: route.push }),
}));
vi.mock("@/features/chat/actions", () => ({ openDirectMessage: vi.fn() }));
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  route.pathname = "/";
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount({
  read = vi.fn(async (signal: AbortSignal): Promise<MessageContact[]> => {
    void signal;
    return contacts;
  }),
  open = vi.fn(
    async (input: unknown): Promise<ActionResult<{ roomId: string }>> => {
      void input;
      return {
        ok: true,
        data: { roomId: id(90) },
      };
    },
  ),
} = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  client.setQueryData(CHAT_NAV_KEY, nav);
  const tree = (userId = id(100)) => (
    <QueryClientProvider client={client}>
      <textarea
        aria-label="메시지 입력"
        onKeyDown={(event) => event.stopPropagation()}
      />
      <QuickSwitchButton />
      <input
        aria-label="제목 입력"
        onKeyDown={(event) => event.stopPropagation()}
      />
      <QuickSwitcher
        userId={userId}
        readContacts={read}
        openConversation={open}
      />
    </QueryClientProvider>
  );
  const result = render(tree());
  return { ...result, client, read, open, tree };
}
function shortcut(
  target: HTMLElement | Window = window,
  extra: KeyboardEventInit = {},
) {
  const event = new KeyboardEvent("keydown", {
    key: "k",
    metaKey: true,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}
async function show() {
  await userEvent.click(screen.getByRole("button", { name: "찾기" }));
  return screen.getByRole("combobox");
}
async function search(value: string) {
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value } });
  await waitFor(() => expect(input).toHaveValue(value));
}

describe("quick switch command dialog", () => {
  it("captures shortcuts inside textarea, prevents the browser action, toggles and restores focus", async () => {
    mount();
    const input = screen.getByRole("textbox", { name: "메시지 입력" });
    input.focus();
    expect(shortcut(input).defaultPrevented).toBe(true);
    expect(await screen.findByRole("dialog", { name: "찾기" })).toBeVisible();
    expect(screen.getByRole("combobox")).toHaveFocus();
    expect(shortcut(screen.getByRole("combobox")).defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(input).toHaveFocus());
  });
  it("uses Ctrl+K on non-Mac systems and opens from an input even if it stops bubbling", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    mount();
    expect(screen.getByRole("button", { name: "찾기" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Control+K",
    );
    shortcut(window, { metaKey: true, ctrlKey: false });
    expect(screen.queryByRole("dialog")).toBeNull();
    shortcut(screen.getByRole("textbox", { name: "제목 입력" }), {
      metaKey: false,
      ctrlKey: true,
    });
    expect(await screen.findByRole("dialog")).toBeVisible();
  });
  it.each([{ isComposing: true }, { keyCode: 229 }])(
    "does not interrupt Korean composition %o",
    (extra) => {
      const { read } = mount();
      const event = shortcut(window, extra);
      expect(event.defaultPrevented).toBe(false);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(read).not.toHaveBeenCalled();
    },
  );
  it.each(["dialog", "alertdialog"])(
    "does not open over another %s",
    async (role) => {
      mount();
      const dialog = document.createElement("div");
      dialog.setAttribute("role", role);
      document.body.append(dialog);
      shortcut();
      expect(screen.queryByRole("combobox")).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "찾기" }));
      expect(screen.queryByRole("combobox")).toBeNull();
      dialog.remove();
      shortcut();
      expect(await screen.findByRole("combobox")).toBeVisible();
    },
  );
  it("reads contacts only on opening and reuses the user cache for five minutes", async () => {
    const { read, client } = mount();
    expect(read).not.toHaveBeenCalled();
    await show();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    shortcut();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await show();
    await search("하은");
    expect(await screen.findAllByRole("option")).toHaveLength(2);
    expect(read).toHaveBeenCalledTimes(1);
    shortcut();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    act(() =>
      client.setQueryData(["people", "contacts", id(100)], contacts, {
        updatedAt: Date.now() - 300_001,
      }),
    );
    await show();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });
  it("uses navigation cache updates without making its own navigation HTTP request", async () => {
    const { client } = mount();
    await show();
    await search("공지");
    expect(
      await screen.findByRole("option", { name: "#공지 · 한글 모임" }),
    ).toBeVisible();
    act(() => client.setQueryData(CHAT_NAV_KEY, { ...nav, spaces: [] }));
    await waitFor(() =>
      expect(
        screen.queryByRole("option", { name: "#공지 · 한글 모임" }),
      ).toBeNull(),
    );
  });
  it("shows recent and unread rooms, grouped searches, and NFC user/space matches", async () => {
    rememberRoom(id(100), id(3));
    mount();
    await show();
    expect((await screen.findAllByRole("option"))[0]).toHaveTextContent(
      "#공지",
    );
    expect(screen.queryByText("사람", { exact: true })).toBeNull();
    await search("한글");
    expect(screen.getByText("방", { exact: true })).toBeVisible();
    expect(screen.getByText("스페이스", { exact: true })).toBeVisible();
    await search("HaEuN");
    expect(await screen.findByText("사람", { exact: true })).toBeVisible();
  });
  it.each([
    ["공지", "#공지 · 한글 모임", `/s/${id(1)}/${id(3)}`],
    ["한글", "한글 모임", `/s/${id(1)}`],
    ["기획", "기획 회의, 안 읽은 메시지 있음", `/m/${id(7)}`],
    ["하은", "김하은 · @haeun", `/dm/${id(4)}`],
  ])(
    "navigates to selected %s without opening a new DM",
    async (query, name, href) => {
      const { open } = mount();
      await show();
      await search(query);
      await userEvent.click(await screen.findByRole("option", { name }));
      expect(route.push).toHaveBeenCalledExactlyOnceWith(href);
      expect(open).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );
  it("opens a person's new DM once and ignores a late result after closing", async () => {
    let resolve!: (result: ActionResult<{ roomId: string }>) => void;
    const open = vi.fn(
      (input: unknown) =>
        new Promise<ActionResult<{ roomId: string }>>((done) => {
          void input;
          resolve = done;
        }),
    );
    mount({ open });
    await show();
    await search("유나");
    const option = await screen.findByRole("option", {
      name: "정유나 · @yuna",
    });
    fireEvent.click(option);
    fireEvent.click(option);
    await waitFor(() =>
      expect(open).toHaveBeenCalledExactlyOnceWith({ userId: id(23) }),
    );
    shortcut();
    await act(async () => resolve({ ok: true, data: { roomId: id(90) } }));
    expect(route.push).not.toHaveBeenCalled();
  });
  it("navigates after creating a DM and reports a fixed failure without leaking server data", async () => {
    const { open } = mount();
    await show();
    await search("유나");
    await userEvent.click(
      await screen.findByRole("option", { name: "정유나 · @yuna" }),
    );
    await waitFor(() =>
      expect(route.push).toHaveBeenCalledExactlyOnceWith(`/dm/${id(90)}`),
    );
    open.mockRejectedValueOnce(new Error("private@example.test"));
    await show();
    await search("유나");
    await userEvent.click(
      await screen.findByRole("option", { name: "정유나 · @yuna" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "대화를 열지 못했어요",
    );
    expect(document.body.textContent).not.toContain("private@example.test");
  });
  it("allows keyboard-only selection and Escape returns focus to the find button", async () => {
    mount();
    await show();
    await search("공지");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await waitFor(() =>
      expect(route.push).toHaveBeenCalledExactlyOnceWith(
        `/s/${id(1)}/${id(3)}`,
      ),
    );
    await show();
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "찾기" })).toHaveFocus(),
    );
  });
  it("records actual room navigation and clears dialog state between accounts", async () => {
    route.pathname = `/s/${id(1)}/${id(3)}`;
    const { rerender, tree, read } = mount();
    expect(readRecentRooms(id(100))).toEqual([id(3)]);
    await show();
    await search("유나");
    rerender(tree(id(101)));
    expect(screen.queryByRole("dialog")).toBeNull();
    await show();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("combobox")).toHaveValue("");
  });
  it("keeps cached rooms usable while people load or fail, without an unconfirmed empty state", async () => {
    let reject!: (reason: Error) => void;
    const read = vi.fn(
      (signal: AbortSignal) =>
        new Promise<MessageContact[]>((_resolve, no) => {
          void signal;
          reject = no;
        }),
    );
    mount({ read });
    await show();
    await search("유나");
    expect(screen.getByRole("status")).toHaveTextContent(
      "사람 목록을 불러오고 있어요",
    );
    expect(screen.queryByText("찾는 항목이 없어요")).toBeNull();
    await act(async () => reject(new Error("secret")));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "사람 목록을 불러오지 못했어요",
    );
    expect(screen.queryByText("찾는 항목이 없어요")).toBeNull();
    await search("공지");
    await userEvent.click(
      screen.getByRole("option", { name: "#공지 · 한글 모임" }),
    );
    expect(route.push).toHaveBeenCalled();
  });
});
