import { vi } from "vitest";

// jsdom에는 배치가 없으므로 가상 목록이 실제로 사용하는 크기/스크롤 API만 제공한다.
export function installChatViewport(height = 600) {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(
    height,
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute("data-index") ? 80 : height;
    },
  );
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return (
        Number.parseFloat(
          this.querySelector<HTMLElement>("[data-message-list]")?.style
            .height ?? "0",
        ) || height
      );
    },
  );
  const original = HTMLElement.prototype.scrollTo;
  HTMLElement.prototype.scrollTo = function (
    options?: ScrollToOptions | number,
    y?: number,
  ) {
    const top = typeof options === "number" ? (y ?? 0) : (options?.top ?? 0);
    this.scrollTop = Math.max(
      0,
      Math.min(top, this.scrollHeight - this.clientHeight),
    );
    queueMicrotask(() => {
      if (this.isConnected) this.dispatchEvent(new Event("scroll"));
    });
  };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  return () => {
    HTMLElement.prototype.scrollTo = original;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  };
}
