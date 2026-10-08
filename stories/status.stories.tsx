import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountMenu } from "@/components/account-menu";
import { StatusDot } from "@/features/people/components/person-status";
import { statusLabel } from "@/features/people/status";

function Frame({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const meta = {
  title: "People/Status",
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Frame>
        <Story />
      </Frame>
    ),
  ],
  render: () => (
    <div className="flex max-w-72 flex-col gap-4">
      {(["online", "away", "dnd", "offline"] as const).map((status) => (
        <div key={status} className="flex items-center gap-2">
          <StatusDot status={status} />
          <span>{statusLabel(status)}</span>
        </div>
      ))}
      <p className="text-sm text-muted-foreground">
        확인 중인 상대에게는 상태 점을 표시하지 않아요.
      </p>
      <AccountMenu
        avatar={{ color: "blue", photoUrl: null }}
        name="김하은"
        email="haeun@example.test"
        username="haeun.kim"
        isOperator={false}
        myStatus="dnd"
        variant="card"
      />
    </div>
  ),
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const StatesAndAccountMenu: Story = {};
