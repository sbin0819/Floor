import { Suspense, use } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BookingMeetingPending,
  BookingMeetingSheet,
  BookingMeetingSheetActions,
} from "@/features/bookings/components/booking-meeting-sheet";
import {
  bookingCalendarSearchKey,
  bookingMeetingHref,
  bookingPageHref,
} from "@/features/bookings/meeting-navigation";

const route = vi.hoisted(() => ({
  pathname: "/bookings",
  search: "",
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.search),
  useRouter: () => ({ replace: route.replace }),
}));
const a = "a03230cc-e9e0-47db-b409-c6b2c482b318";
const b = "a03230cc-e9e0-47db-b409-c6b2c482b319";
const location = "view=calendar&month=2026-10&day=2026-10-08";
function Loaded({
  value,
  bookingId,
}: {
  value: Promise<string>;
  bookingId: string;
}) {
  const text = use(value);
  return (
    <>
      <BookingMeetingSheetActions bookingId={bookingId} />
      <p>{text}</p>
    </>
  );
}
function scene(bookingId: string | null, value: Promise<string>) {
  return (
    <>
      <main>
        <h1>내 예약</h1>
        <button>보존하는 달력</button>
        <a data-chat-link={a} href={`/m/${a}`}>
          숨긴 진입 링크
        </a>
        <a data-chat-link={a} href={`/m/${a}`}>
          보이는 진입 링크
        </a>
      </main>
      <BookingMeetingSheet bookingId={bookingId}>
        <Suspense
          key={bookingId}
          fallback={<BookingMeetingPending bookingId={bookingId ?? ""} />}
        >
          <Loaded value={value} bookingId={bookingId ?? ""} />
        </Suspense>
      </BookingMeetingSheet>
    </>
  );
}
async function draw(bookingId: string | null, value: Promise<string>) {
  let view: ReturnType<typeof render> | undefined;
  await act(async () => {
    view = render(scene(bookingId, value));
  });
  if (!view) throw new Error("Expected meeting sheet render");
  return view;
}
afterEach(async () => {
  cleanup();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
beforeEach(() => {
  vi.restoreAllMocks();
  route.pathname = "/bookings";
  route.search = `${location}&chat=${a}`;
  route.replace.mockReset();
});

describe("meeting sheet independent loading", () => {
  it("keeps one open dialog and its entry state while only the content resolves", async () => {
    const pending = Promise.withResolvers<string>();
    const { container } = await draw(a, pending.promise);
    const calendar = container.querySelector("main button");
    const dialog = screen.getByRole("dialog", { name: "예약 채팅" });
    expect(dialog).toHaveClass("data-[side=right]:w-[420px]");
    expect(dialog).toHaveAttribute("data-state", "open");
    const states: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records)
        if (record.attributeName === "data-state")
          states.push(dialog.getAttribute("data-state")!);
    });
    observer.observe(dialog, { attributes: true });
    expect(screen.getByRole("status")).toHaveAccessibleName(
      "회의를 불러오고 있어요",
    );
    expect(screen.getByRole("link", { name: "크게 보기" })).toHaveAttribute(
      "href",
      `/m/${a}`,
    );
    await act(async () => pending.resolve("완료된 회의"));
    expect(await screen.findByText("완료된 회의")).toBeVisible();
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(container.querySelector("main button")).toBe(calendar);
    expect(states).toEqual([]);
    expect(dialog.querySelector("[data-chat-screen]")).toBeNull();
    observer.disconnect();
  });

  it("closes immediately and never reopens when the old response arrives", async () => {
    const pending = Promise.withResolvers<string>();
    const view = await draw(a, pending.promise);
    await userEvent.click(
      screen.getByRole("button", { name: "회의 채팅 닫기" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(route.replace).toHaveBeenCalledExactlyOnceWith(
      `/bookings?${location}`,
      { scroll: false },
    );
    await act(async () => pending.resolve("이전 응답"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    route.search = location;
    view.rerender(scene(null, pending.promise));
    route.search = `${location}&chat=${a}`;
    view.rerender(scene(a, pending.promise));
    expect(await screen.findByRole("dialog")).toBeVisible();
  });

  it("keeps the container through a rapid change and ignores the previous meeting content", async () => {
    const first = Promise.withResolvers<string>();
    const last = Promise.withResolvers<string>();
    const view = await draw(a, first.promise);
    const dialog = screen.getByRole("dialog");
    route.search = `${location}&chat=${b}`;
    await act(async () => {
      view.rerender(scene(a, first.promise));
    });
    expect(screen.getByRole("dialog")).toBe(dialog);
    await act(async () => {
      view.rerender(scene(b, last.promise));
    });
    await act(async () => first.resolve("늦은 첫 회의"));
    expect(screen.queryByText("늦은 첫 회의")).not.toBeInTheDocument();
    await act(async () => last.resolve("현재 회의"));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(await screen.findByText("현재 회의")).toBeVisible();
  });

  it.each(["escape", "outside"] as const)(
    "closes by %s and focuses only the visible originating link",
    async (method) => {
      const { container } = await draw(a, new Promise<string>(() => {}));
      const links =
        container.querySelectorAll<HTMLAnchorElement>("[data-chat-link]");
      vi.spyOn(links[0]!, "getClientRects").mockReturnValue(
        [] as unknown as DOMRectList,
      );
      vi.spyOn(links[1]!, "getClientRects").mockReturnValue([
        {},
      ] as unknown as DOMRectList);
      if (method === "escape") await userEvent.keyboard("{Escape}");
      else
        await userEvent.click(
          document.querySelector('[data-slot="sheet-overlay"]')!,
        );
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(route.replace).toHaveBeenCalledWith(`/bookings?${location}`, {
        scroll: false,
      });
      expect(links[1]).toHaveFocus();
    },
  );

  it("returns direct-entry focus to the page heading and removes its temporary tabindex on blur", async () => {
    const { container } = await draw(a, new Promise<string>(() => {}));
    await userEvent.keyboard("{Escape}");
    const heading = container.querySelector("h1")!;
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveAttribute("tabindex", "-1");
    heading.blur();
    expect(heading).not.toHaveAttribute("tabindex");
  });

  it("does not navigate or reopen when a preserved workspace is no longer the bookings route", async () => {
    route.pathname = "/friends";
    await draw(a, new Promise<string>(() => {}));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(route.replace).not.toHaveBeenCalled();
  });
});

describe("meeting query isolation", () => {
  it("replaces all chat entries at the end while preserving other keys and escaping values", () => {
    const query = new URLSearchParams(
      "tab=past&chat=old&view=calendar&chat=duplicate&month=2026-10&day=2026-10-08",
    );
    expect(bookingMeetingHref(query, b)).toBe(
      `/bookings?tab=past&view=calendar&month=2026-10&day=2026-10-08&chat=${b}`,
    );
    expect(bookingMeetingHref(query, null)).toBe(
      "/bookings?tab=past&view=calendar&month=2026-10&day=2026-10-08",
    );
    expect(bookingMeetingHref(new URLSearchParams(), null)).toBe("/bookings");
    expect(bookingMeetingHref(new URLSearchParams(), "a&view=evil")).toBe(
      "/bookings?chat=a%26view%3Devil",
    );
  });
  it("excludes only chat from calendar identity and preserves scalar login-return choices", () => {
    expect(
      bookingCalendarSearchKey(new URLSearchParams(`${location}&chat=${a}`)),
    ).toBe(location);
    expect(
      bookingCalendarSearchKey(
        new URLSearchParams(`${location}&chat=${b}&chat=duplicate`),
      ),
    ).toBe(location);
    expect(
      bookingPageHref({
        view: "calendar",
        month: "2026-10",
        day: "2026-10-08",
        chat: a,
      }),
    ).toBe(`/bookings?${location}&chat=${a}`);
    expect(bookingPageHref({ tab: "past", chat: a })).toBe(
      `/bookings?tab=past&chat=${a}`,
    );
    expect(bookingPageHref({ view: ["calendar"], chat: [a, b] })).toBe(
      "/bookings",
    );
  });
});
