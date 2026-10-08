import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { PageContainer, PageHeading } from "@/components/page-container";
import { BranchCard } from "@/features/bookings/components/branch-card";
import type { BranchListItem } from "@/features/bookings/types";

const branch: BranchListItem = {
  lounge: { spaceId: "example-lounge", joined: true },
  id: "example-branch",
  name: "가상 강남점",
  address: "서울 가상구 가상로 12",
  timezone: "Asia/Seoul",
  openHours: {
    mon: { open: "08:00", close: "22:00" },
    tue: { open: "08:00", close: "22:00" },
    wed: { open: "08:00", close: "22:00" },
    thu: { open: "08:00", close: "22:00" },
    fri: { open: "08:00", close: "22:00" },
    sat: { open: "09:00", close: "18:00" },
    sun: null,
  },
  cover: {
    path: "/seed/photos/lobby-oak.webp",
    alt: "가상 강남점 안내 데스크와 입구",
  },
  isDefault: true,
  todayHours: { open: "08:00", close: "22:00" },
  accessibleFloorCount: 3,
  bookableSpaceCount: 14,
  freeSpaceCount: 6,
  operatingState: {
    status: "open",
    date: "2026-10-07",
    hours: { open: "08:00", close: "22:00" },
    window: {
      start: "2026-10-07T08:00:00+09:00",
      end: "2026-10-07T22:00:00+09:00",
    },
    nextOpening: null,
  },
};
function QueryPreview({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const meta = {
  title: "예약/BranchCard",
  component: BranchCard,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <QueryPreview>
        <Story />
      </QueryPreview>
    ),
  ],
  args: { branch, onSetDefault: () => {} },
  render: (args) => (
    <div className="mx-auto w-full max-w-[478px]">
      <BranchCard {...args} />
    </div>
  ),
} satisfies Meta<typeof BranchCard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const DefaultBranch: Story = {};
export const OtherBranch: Story = {
  args: {
    branch: {
      ...branch,
      isDefault: false,
      lounge: { spaceId: "example-lounge", joined: false },
    },
  },
};
export const BeforeOpening: Story = {
  args: {
    branch: {
      ...branch,
      freeSpaceCount: null,
      operatingState: { ...branch.operatingState, status: "before_open" },
    },
  },
};
export const AfterClosing: Story = {
  args: {
    branch: {
      ...branch,
      freeSpaceCount: null,
      operatingState: { ...branch.operatingState, status: "after_close" },
    },
  },
};
export const Closed: Story = {
  args: {
    branch: {
      ...branch,
      freeSpaceCount: null,
      todayHours: null,
      operatingState: {
        ...branch.operatingState,
        status: "closed",
        date: "2026-10-11",
        hours: null,
        window: null,
      },
    },
  },
};
export const NoAccessibleFloor: Story = {
  args: {
    branch: {
      ...branch,
      accessibleFloorCount: 0,
      bookableSpaceCount: 0,
      freeSpaceCount: 0,
    },
  },
};
export const NoPhoto: Story = {
  args: { branch: { ...branch, cover: null, isDefault: false } },
};
export const HalfHours: Story = {
  args: {
    branch: {
      ...branch,
      openHours: {
        mon: { open: "08:30", close: "22:30" },
        wed: { open: "08:30", close: "22:00" },
        sun: null,
      },
    },
  },
};
export const Saving: Story = {
  args: {
    branch: { ...branch, isDefault: false },
    pending: true,
    saving: true,
  },
};
export const BranchGrid: Story = {
  render: () => (
    <PageContainer width="branches" className="space-y-6">
      <PageHeading
        title="지점"
        description="이용할 지점을 골라 주세요. 층과 공간은 지점 안에서 고를 수 있어요."
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <BranchCard branch={branch} onSetDefault={() => {}} />
        <BranchCard
          branch={{
            ...branch,
            id: "example-other",
            name: "가상 성수점",
            isDefault: false,
            cover: {
              path: "/seed/photos/lobby-sage.webp",
              alt: "가상 성수점 안내 데스크와 입구",
            },
          }}
          onSetDefault={() => {}}
        />
      </div>
    </PageContainer>
  ),
};
