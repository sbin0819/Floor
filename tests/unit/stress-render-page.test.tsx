import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import StressRenderPage from "@/app/dev/stress-render/page";

const state = vi.hoisted(() => ({ mode: "development" }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ NODE_ENV: state.mode }) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/features/floor-plan/components/stress-render", () => ({
  StressRender: () => <div>stress canvas</div>,
}));

describe("stress render page", () => {
  it("shows the deterministic renderer without a session in development", () => {
    state.mode = "development";
    expect(renderToString(<StressRenderPage />)).toContain("평면도 성능 측정");
  });
  it.each(["production", "test"])(
    "returns notFound before rendering in %s",
    (mode) => {
      state.mode = mode;
      expect(() => renderToString(<StressRenderPage />)).toThrow("NOT_FOUND");
    },
  );
});
