import Link from "next/link";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  shouldInterceptNavigation,
  useOptimisticNavigation,
  useRouterOptimisticNavigation,
  type NavigateAction,
} from "@/components/optimistic-navigation";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => vi.clearAllMocks());

describe("optimistic navigation", () => {
  it("starts navigation immediately and shows the selection before the response", async () => {
    const response = deferred();
    const navigateAction = vi.fn<NavigateAction>(() => response.promise);
    const { result } = renderHook(() =>
      useOptimisticNavigation("old", navigateAction),
    );
    expect(result.current.value).toBe("old");
    expect(result.current.isPending).toBe(false);
    await act(async () => {
      result.current.change("selected", "/branches/selected");
      expect(navigateAction).toHaveBeenCalledExactlyOnceWith(
        "/branches/selected",
        {},
      );
    });
    expect(result.current.value).toBe("selected");
    expect(result.current.isPending).toBe(true);
    await act(async () => {
      response.resolve();
      await response.promise;
    });
    expect(result.current.value).toBe("old");
    expect(result.current.isPending).toBe(false);
  });

  it("uses new server props on direct rendering and after a pending response", async () => {
    const response = deferred();
    const navigateAction = vi.fn<NavigateAction>(() => response.promise);
    const { result, rerender } = renderHook(
      ({ base }) => useOptimisticNavigation(base, navigateAction),
      { initialProps: { base: "current" } },
    );
    rerender({ base: "direct-url" });
    expect(result.current.value).toBe("direct-url");
    expect(result.current.isPending).toBe(false);
    await act(async () => {
      result.current.change("requested", "/requested");
    });
    rerender({ base: "server-normalized" });
    expect(result.current.value).toBe("requested");
    await act(async () => {
      response.resolve();
      await response.promise;
    });
    expect(result.current.value).toBe("server-normalized");
    expect(result.current.isPending).toBe(false);
  });

  it("handles an object selection without changing the supplied server data", async () => {
    const response = deferred();
    const navigateAction: NavigateAction = () => response.promise;
    const base = {
      floor: "7",
      date: "2026-10-07",
      space: "room-a" as string | null,
    };
    const next = { ...base, floor: "8", space: null };
    const { result } = renderHook(() =>
      useOptimisticNavigation(base, navigateAction),
    );
    await act(async () => {
      result.current.change(next, "/floor/8");
    });
    expect(result.current.value).toBe(next);
    expect(base).toEqual({ floor: "7", date: "2026-10-07", space: "room-a" });
    await act(async () => {
      response.resolve();
      await response.promise;
    });
    expect(result.current.value).toBe(base);
  });

  it("passes replace through to an injected action", async () => {
    const response = deferred();
    const navigateAction = vi.fn<NavigateAction>(() => response.promise);
    const { result } = renderHook(() =>
      useOptimisticNavigation<string | null>("room", navigateAction),
    );
    await act(async () => {
      result.current.change(null, "/floor/7", { replace: true });
    });
    expect(result.current.value).toBeNull();
    expect(navigateAction).toHaveBeenCalledExactlyOnceWith("/floor/7", {
      replace: true,
    });
    await act(async () => {
      response.resolve();
      await response.promise;
    });
  });

  it("keeps the latest selection when another navigation starts before the first completes", async () => {
    const first = deferred();
    const second = deferred();
    const navigateAction = vi
      .fn<NavigateAction>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { result } = renderHook(() =>
      useOptimisticNavigation("base", navigateAction),
    );
    await act(async () => {
      result.current.change("first", "/first");
    });
    await act(async () => {
      result.current.change("second", "/second");
    });
    expect(result.current.value).toBe("second");
    await act(async () => {
      first.resolve();
      await first.promise;
    });
    expect(result.current.value).toBe("second");
    expect(result.current.isPending).toBe(true);
    await act(async () => {
      second.resolve();
      await second.promise;
    });
    expect(result.current.value).toBe("base");
    expect(result.current.isPending).toBe(false);
  });

  it("connects push and replace to the Next router separately from optimistic state", async () => {
    const { result } = renderHook(() => useRouterOptimisticNavigation("old"));
    await act(async () => {
      result.current.change("new", "/next");
    });
    expect(router.push).toHaveBeenCalledExactlyOnceWith("/next");
    expect(router.replace).not.toHaveBeenCalled();
    await act(async () => {
      result.current.change("closed", "/next?date=today", { replace: true });
    });
    expect(router.replace).toHaveBeenCalledExactlyOnceWith("/next?date=today");
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("keeps a real Link href while marking the clicked item before loading finishes", async () => {
    const response = deferred();
    const navigateAction = vi.fn<NavigateAction>(() => response.promise);
    function Selection() {
      const { value, isPending, change } = useOptimisticNavigation(
        "old",
        navigateAction,
      );
      const href = "/branches/a/floors/7?space=selected";
      return (
        <>
          <Link
            href={href}
            aria-current={value === "selected" ? "true" : undefined}
            onClick={(event) => {
              if (!shouldInterceptNavigation(event)) return;
              event.preventDefault();
              change("selected", href);
            }}
          >
            회의실
          </Link>
          {isPending && value !== "old" ? (
            <p role="status">선택한 공간을 불러와요</p>
          ) : (
            <p>현재 공간</p>
          )}
        </>
      );
    }
    render(<Selection />);
    const link = screen.getByRole("link", { name: "회의실" });
    expect(link).toHaveAttribute("href", "/branches/a/floors/7?space=selected");
    await act(async () => {
      fireEvent.click(link);
    });
    expect(link).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("status")).toHaveTextContent(
      "선택한 공간을 불러와요",
    );
    await act(async () => {
      response.resolve();
      await response.promise;
    });
    expect(link).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("현재 공간")).toBeVisible();
  });
});

describe("native link behavior", () => {
  function event(
    overrides: Partial<Parameters<typeof shouldInterceptNavigation>[0]> = {},
  ) {
    const currentTarget = document.createElement("a");
    currentTarget.href = "/branches";
    return {
      button: 0,
      defaultPrevented: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      currentTarget,
      ...overrides,
    };
  }

  it("intercepts an unmodified left click and keyboard-generated click", () => {
    expect(shouldInterceptNavigation(event())).toBe(true);
  });

  it.each(["altKey", "ctrlKey", "metaKey", "shiftKey"] as const)(
    "preserves %s",
    (key) => {
      expect(shouldInterceptNavigation(event({ [key]: true }))).toBe(false);
    },
  );

  it.each([1, 2, 3])("preserves mouse button %i", (button) => {
    expect(shouldInterceptNavigation(event({ button }))).toBe(false);
  });

  it("preserves a click already handled by another listener", () => {
    expect(shouldInterceptNavigation(event({ defaultPrevented: true }))).toBe(
      false,
    );
  });

  it.each(["_blank", "_BLANK", "_parent", "_top", "other-frame"])(
    "preserves target %s",
    (target) => {
      const click = event();
      click.currentTarget.target = target;
      expect(shouldInterceptNavigation(click)).toBe(false);
    },
  );

  it("allows an explicit same-frame target", () => {
    const click = event();
    click.currentTarget.target = "_self";
    expect(shouldInterceptNavigation(click)).toBe(true);
  });

  it("does not intercept a download", () => {
    const click = event();
    click.currentTarget.download = "floor.json";
    expect(shouldInterceptNavigation(click)).toBe(false);
  });
});
