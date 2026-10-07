import type { Preview } from "@storybook/nextjs-vite";
import { pretendard } from "../lib/fonts";
import "../app/globals.css";

if (typeof document !== "undefined") {
  document.documentElement.classList.add(pretendard.variable);
  document.documentElement.lang = "ko";
}

const preview: Preview = {
  parameters: { nextjs: { appDirectory: true }, layout: "padded" },
  decorators: [
    (Story) => (
      <div
        className={`${pretendard.variable} bg-background p-6 font-sans text-foreground`}
      >
        <Story />
      </div>
    ),
  ],
};
export default preview;
