import { Activity, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParticipantInput } from "@/components/participant-input";
import type { SearchParticipants } from "@/features/bookings/participant-search-client";
import { ApiError } from "@/lib/http/errors";
import type {
  BookingParticipantDraft,
  ParticipantSearchResult,
} from "@/features/bookings/participants";

const colleague: ParticipantSearchResult = {
  userId: "first",
  name: "이서연",
  avatar: { color: "blue" as const, photoUrl: null },
  sharedTeamNames: ["디자인팀"],
  maskedEmail: "se•••@floor.example",
};
const guest: ParticipantSearchResult = {
  userId: "second",
  name: "김하은",
  avatar: { color: "blue" as const, photoUrl: null },
  sharedTeamNames: [],
  maskedEmail: "ha•••@floor.example",
};
afterEach(() => {
  vi.useRealTimers();
});
function display({
  value = [],
  search = vi.fn<SearchParticipants>().mockResolvedValue([colleague]),
  maxParticipants = 7,
}: {
  value?: BookingParticipantDraft[];
  search?: SearchParticipants;
  maxParticipants?: number;
} = {}) {
  const client = new QueryClient();
  const changes = vi.fn();
  function Frame() {
    const [selected, setSelected] = useState(value);
    return (
      <QueryClientProvider client={client}>
        <ParticipantInput
          value={selected}
          onChange={(next) => {
            changes(next);
            setSelected(next);
          }}
          maxParticipants={maxParticipants}
          search={search}
        />
      </QueryClientProvider>
    );
  }
  return { ...render(<Frame />), client, changes, search };
}
async function pause(ms = 251) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}
describe("ParticipantInput", () => {
  it("releases a hidden Activity search and resumes with the same input but a fresh request", async () => {
    const pending: {
      signal: AbortSignal;
      resolve: (value: ParticipantSearchResult[]) => void;
    }[] = [];
    const search: SearchParticipants = (_query, signal) =>
      new Promise((resolve) => pending.push({ signal, resolve }));
    const client = new QueryClient();
    const tree = (mode: "hidden" | "visible") => (
      <QueryClientProvider client={client}>
        <Activity mode={mode}>
          <ParticipantInput value={[]} onChange={() => {}} search={search} />
        </Activity>
      </QueryClientProvider>
    );
    const view = render(tree("visible"));
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "이서" } });
    await pause();
    expect(pending).toHaveLength(1);
    view.rerender(tree("hidden"));
    await waitFor(() => expect(pending[0]!.signal.aborted).toBe(true));
    view.rerender(tree("visible"));
    expect(screen.getByRole("combobox")).toBe(input);
    expect(input).toHaveValue("이서");
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => pending[1]!.resolve([guest]));
    await screen.findByRole("option", { name: /김하은/ });
    await act(async () => pending[0]!.resolve([colleague]));
    expect(
      screen.queryByRole("option", { name: /이서연/ }),
    ).not.toBeInTheDocument();
    view.unmount();
    client.clear();
  });
  it("cancels the owned search when Escape closes its list and keeps the input", async () => {
    let signal: AbortSignal | undefined;
    const { unmount } = display({
      search: (_query, nextSignal) => {
        signal = nextSignal;
        return new Promise(() => {});
      },
    });
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "이서" } });
    await pause();
    expect(signal?.aborted).toBe(false);
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(input).toHaveValue("이서");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    unmount();
  });

  it("cancels a running search when the input is disabled", async () => {
    let signal: AbortSignal | undefined;
    const client = new QueryClient();
    const tree = (disabled: boolean) => (
      <QueryClientProvider client={client}>
        <ParticipantInput
          value={[]}
          onChange={() => {}}
          defaultQuery="이서"
          disabled={disabled}
          search={(_query, nextSignal) => {
            signal = nextSignal;
            return new Promise(() => {});
          }}
        />
      </QueryClientProvider>
    );
    const view = render(tree(false));
    await pause();
    expect(signal?.aborted).toBe(false);
    view.rerender(tree(true));
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(screen.getByRole("combobox")).toBeDisabled();
    view.unmount();
    client.clear();
  });
  it("debounces consecutive input and searches only normalized terms of 2–254 characters", async () => {
    vi.useFakeTimers();
    const { search } = display();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "이" } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(search).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "이서" } });
    await act(() => vi.advanceTimersByTimeAsync(249));
    expect(search).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "  이서연   님 " } });
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(search).toHaveBeenCalledOnce();
    expect(search).toHaveBeenCalledWith("이서연 님", expect.any(AbortSignal));
    fireEvent.change(input, { target: { value: "a".repeat(255) } });
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(search).toHaveBeenCalledOnce();
  });
  it("supports arrows and Enter, announces additions/removals and leaves full email out of same-team drafts", async () => {
    const { changes } = display();
    await userEvent.type(screen.getByRole("combobox"), "이서");
    await screen.findByRole("option", { name: /이서연/ });
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(changes).toHaveBeenLastCalledWith([colleague]);
    expect(screen.getByText("이서연 님을 넣었어요")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(screen.getByText("나 포함 2명")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "이서연 빼기" })).toHaveClass(
      "size-11",
    );
    await userEvent.keyboard("{Backspace}");
    expect(changes).toHaveBeenLastCalledWith([]);
    expect(screen.getByText("이서연 님을 뺐어요")).toBeInTheDocument();
  });
  it("does not select duplicates and Escape closes the list without removing the input", async () => {
    const { changes } = display({ value: [colleague] });
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "이서");
    const option = await screen.findByRole("option");
    expect(option).toHaveTextContent("넣었어요");
    expect(option).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(option);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(changes).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
  it("disables search at capacity while retaining accessible removal", async () => {
    const { changes } = display({ value: [colleague], maxParticipants: 1 });
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByText("정원이 찼어요")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "이서연 빼기" }));
    expect(changes).toHaveBeenLastCalledWith([]);
    expect(screen.getByRole("combobox")).toBeEnabled();
  });
  it("blocks a sixth guest without blocking team members", async () => {
    const chosen = Array.from({ length: 5 }, (_, index) => ({
      ...guest,
      userId: `guest-${index}`,
      name: `손님${index}`,
      avatar: { color: "blue" as const, photoUrl: null },
    }));
    const { changes } = display({
      value: chosen,
      maxParticipants: 20,
      search: async () => [guest, colleague],
    });
    await userEvent.type(screen.getByRole("combobox"), "haneul@floor.example");
    const external = await screen.findByRole("option", { name: /김하은/ });
    expect(external).toHaveTextContent("손님은 5명까지예요");
    await userEvent.click(external);
    expect(changes).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("option", { name: /이서연/ }));
    expect(changes).toHaveBeenLastCalledWith([...chosen, colleague]);
  });
  it("keeps proof email only in the selected draft, never in query keys or data, and removes the cache on unmount", async () => {
    const proof = "HANEUL@floor.example";
    const { changes, client, unmount } = display({
      search: async () => [guest],
    });
    await userEvent.type(screen.getByRole("combobox"), proof);
    const option = await screen.findByRole("option");
    const serializeCache = () =>
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((query) => ({ key: query.queryKey, data: query.state.data })),
      );
    expect(serializeCache()).not.toContain(proof);
    await userEvent.click(option);
    expect(changes).toHaveBeenLastCalledWith([{ ...guest, email: proof }]);
    expect(serializeCache()).not.toContain(proof);
    expect(screen.getByRole("combobox")).toHaveValue("");
    unmount();
    await pause(5);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
  it("aborts immediately on new text and ignores reversed results even when the transport ignores abort", async () => {
    const pending: {
      signal: AbortSignal;
      resolve: (results: ParticipantSearchResult[]) => void;
    }[] = [];
    const search = vi.fn<SearchParticipants>(
      (_query, signal) =>
        new Promise((resolve) => {
          pending.push({ signal, resolve });
        }),
    );
    const { changes } = display({ search });
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "old@floor.example" } });
    await pause();
    expect(pending).toHaveLength(1);
    fireEvent.change(input, { target: { value: "new@floor.example" } });
    await waitFor(() => expect(pending[0]!.signal.aborted).toBe(true));
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    await pause();
    await act(async () => {
      pending[1]!.resolve([guest]);
    });
    await screen.findByRole("option", { name: /김하은/ });
    await act(async () => {
      pending[0]!.resolve([colleague]);
    });
    expect(
      screen.queryByRole("option", { name: /이서연/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: /김하은/ }));
    expect(changes).toHaveBeenLastCalledWith([
      { ...guest, email: "new@floor.example" },
    ]);
  });
  it.each([429, 500])(
    "shows a safe status for HTTP %s without echoing error details",
    async (status) => {
      const error = new ApiError("http", { status });
      error.message = "private@example.com";
      display({
        search: async () => {
          throw error;
        },
      });
      await userEvent.type(screen.getByRole("combobox"), "이서");
      expect(
        await screen.findByText(
          status === 429
            ? "잠시 뒤 다시 찾아 주세요"
            : "사람을 찾지 못했어요. 잠시 뒤 다시 찾아 주세요",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText("private@example.com")).not.toBeInTheDocument();
    },
  );
  it.each([
    ["timeout", "응답이 늦어지고 있어요. 잠시 뒤 다시 시도해 주세요"],
    ["network", "연결을 확인한 뒤 다시 시도해 주세요"],
  ] as const)(
    "shows common %s guidance without clearing the search input",
    async (kind, message) => {
      const error = new ApiError(kind);
      error.message = "private@example.com";
      display({
        search: async () => {
          throw error;
        },
      });
      const input = screen.getByRole("combobox");
      await userEvent.type(input, "이서");
      expect(await screen.findByText(message)).toBeVisible();
      expect(input).toHaveValue("이서");
      expect(screen.queryByText("private@example.com")).not.toBeInTheDocument();
    },
  );
});
