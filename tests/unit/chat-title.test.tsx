import { Activity } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatMentions } from "@/features/chat/components/chat-mentions";
import { unreadTitle } from "@/features/chat/unread-title";

const navigation = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/realtime-provider", () => ({
  useRealtimeChannel: () => {},
  useRealtimeReauthorize: () => vi.fn(),
}));
vi.mock("sonner", () => ({ toast: vi.fn() }));

const NativeObserver = globalThis.MutationObserver;
let deliveries = 0;
let exhausted = false;
let active = 0;
let peakActive = 0;
let client: QueryClient;
const refresh = async () => undefined;

// 실제 DOM observer를 쓰되 회귀가 생겨도 microtask가 테스트를 영원히 막지 않는다.
class BoundedObserver implements MutationObserver {
  private native: MutationObserver;
  private connected = false;

  constructor(callback: MutationCallback) {
    this.native = new NativeObserver((records) => {
      deliveries += 1;
      if (deliveries > 40) {
        exhausted = true;
        this.disconnect();
        return;
      }
      callback(records, this);
    });
  }

  observe(target: Node, options?: MutationObserverInit) {
    if (!this.connected) {
      this.connected = true;
      active += 1;
      peakActive = Math.max(peakActive, active);
    }
    this.native.observe(target, options);
  }

  disconnect() {
    if (this.connected) active -= 1;
    this.connected = false;
    this.native.disconnect();
  }

  takeRecords() {
    return this.native.takeRecords();
  }
}

function ui(count: number, visible = true) {
  return (
    <QueryClientProvider client={client}>
      <Activity mode={visible ? "visible" : "hidden"}>
        <ChatMentions userId="me" count={count} refresh={refresh} />
      </Activity>
    </QueryClientProvider>
  );
}

function titleElement(text: string) {
  const title = document.createElement("title");
  title.textContent = text;
  document.head.append(title);
  return title;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(exhausted).toBe(false);
}

beforeEach(() => {
  document.head.querySelectorAll("title").forEach((title) => title.remove());
  navigation.pathname = "/";
  deliveries = 0;
  exhausted = false;
  active = 0;
  peakActive = 0;
  client = new QueryClient();
  vi.stubGlobal("MutationObserver", BoundedObserver);
});

afterEach(() => {
  cleanup();
  client.clear();
  expect(active).toBe(0);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.head.querySelectorAll("title").forEach((title) => title.remove());
});

describe("unread title normalization", () => {
  it.each(["", " \t\r\n\f ", "(1)", " (15) \t "])(
    "does not manufacture a title from %j",
    (title) => {
      expect(unreadTitle(title, 1)).toBeNull();
      expect(unreadTitle(title, 0)).toBeNull();
    },
  );

  it("normalizes spacing and remains stable when the unread count changes", () => {
    expect(unreadTitle(" \t(3) Floor\n친구 ", 1)).toBe("(1) Floor 친구");
    expect(unreadTitle("(1) Floor 친구", 1)).toBe("(1) Floor 친구");
    expect(unreadTitle("(1) Floor 친구", 0)).toBe("Floor 친구");
  });
});

describe("chat document title observer", () => {
  it.each(["", " \t\r\n\f ", "(1) "])(
    "does not loop or write while the title is %j, then resumes when metadata arrives",
    async (initial) => {
      const title = titleElement(initial);
      const write = vi.spyOn(document, "title", "set");
      render(ui(1));
      await settle();
      expect(write).not.toHaveBeenCalled();
      title.textContent = "Floor";
      await settle();
      expect(document.title).toBe("(1) Floor");
      expect(write).toHaveBeenCalledTimes(1);
      expect(deliveries).toBe(2);
    },
  );

  it("waits for a missing title and tolerates removal followed by later reinsertion", async () => {
    const write = vi.spyOn(document, "title", "set");
    render(ui(1));
    await settle();
    expect(document.head.querySelector("title")).toBeNull();
    expect(write).not.toHaveBeenCalled();
    const first = titleElement("Floor");
    await settle();
    expect(document.title).toBe("(1) Floor");
    first.remove();
    await settle();
    expect(document.head.querySelector("title")).toBeNull();
    titleElement("친구 | Floor");
    await settle();
    expect(document.title).toBe("(1) 친구 | Floor");
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("yields while an existing title is temporarily cleared during navigation", async () => {
    const title = titleElement("Floor");
    render(ui(1));
    await settle();
    const write = vi.spyOn(document, "title", "set");
    title.textContent = "";
    await settle();
    expect(document.title).toBe("");
    expect(write).not.toHaveBeenCalled();
    title.textContent = " \t\n ";
    await settle();
    expect(document.title).toBe("");
    expect(write).not.toHaveBeenCalled();
    title.textContent = "친구 | Floor";
    await settle();
    expect(document.title).toBe("(1) 친구 | Floor");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("handles replaced title nodes and character-data updates with one write each", async () => {
    const first = titleElement("Floor");
    render(ui(1));
    await settle();
    const write = vi.spyOn(document, "title", "set");
    const next = document.createElement("title");
    next.textContent = "친구 | Floor";
    first.replaceWith(next);
    await settle();
    expect(document.title).toBe("(1) 친구 | Floor");
    expect(write).toHaveBeenCalledTimes(1);
    const text = next.firstChild;
    expect(text).not.toBeNull();
    text!.nodeValue = "내 예약 | Floor";
    await settle();
    expect(document.title).toBe("(1) 내 예약 | Floor");
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("does not read or rewrite the title for unrelated head mutations", async () => {
    titleElement("Floor");
    render(ui(1));
    await settle();
    const read = vi.spyOn(document, "title", "get");
    const write = vi.spyOn(document, "title", "set");
    const style = document.createElement("style");
    try {
      document.head.append(style);
      style.textContent = "body {}";
      await settle();
      style.firstChild!.nodeValue = "main {}";
      await settle();
      style.remove();
      await settle();
      expect(read).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    } finally {
      style.remove();
    }
  });

  it("updates counts and paths without retaining the previous observer", async () => {
    titleElement("Floor");
    const write = vi.spyOn(document, "title", "set");
    const view = render(ui(0));
    await settle();
    expect(document.title).toBe("Floor");
    view.rerender(ui(1));
    await settle();
    expect(document.title).toBe("(1) Floor");
    navigation.pathname = "/friends";
    view.rerender(ui(1));
    await settle();
    expect(document.title).toBe("(1) Floor");
    view.rerender(ui(0));
    await settle();
    expect(document.title).toBe("Floor");
    expect(write).toHaveBeenCalledTimes(2);
    expect(peakActive).toBe(1);
  });

  it("disconnects during Activity hiding and resumes once when restored", async () => {
    titleElement("Floor");
    const view = render(ui(1));
    await settle();
    view.rerender(ui(1, false));
    await settle();
    expect(active).toBe(0);
    document.title = "친구 | Floor";
    await settle();
    expect(document.title).toBe("친구 | Floor");
    view.rerender(ui(1));
    await settle();
    expect(document.title).toBe("(1) 친구 | Floor");
    expect(peakActive).toBe(1);
  });

  it("does not handle queued or future mutations after unmount", async () => {
    const title = titleElement("Floor");
    const view = render(ui(1));
    await settle();
    const write = vi.spyOn(document, "title", "set");
    title.textContent = "친구 | Floor";
    view.unmount();
    await settle();
    expect(document.title).toBe("친구 | Floor");
    title.textContent = "로그인 | Floor";
    await settle();
    expect(document.title).toBe("로그인 | Floor");
    expect(write).not.toHaveBeenCalled();
  });
});
