import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  PublishPlanSummary,
  PlanVersionList,
} from "@/features/floor-plan/editor/publish-summary";
import { Button } from "@/components/ui/button";
import type { PlanPublishPreview } from "@/features/floor-plan/publish-types";
import { planEditorIds } from "@/tests/helpers/plan-editor";

const preview: PlanPublishPreview = {
  draft: { planId: planEditorIds.plan, version: 2, revision: 4 },
  changedShapes: 2,
  seats: {
    created: ["A-25", "A-26", "A-27", "A-28", "A-29", "A-30"],
    renamed: [],
    archived: [],
  },
  issues: [],
  blockingBookings: [],
};
const meta = {
  title: "운영자/PlanPublication",
  component: PublishPlanSummary,
  args: { branchId: planEditorIds.branch, data: preview },
  decorators: [
    (Story) => (
      <section className="mx-auto max-w-2xl space-y-5 rounded-xl border bg-background p-6">
        <h1 className="text-xl font-bold">평면도 게시</h1>
        <p className="text-sm text-muted-foreground">
          게시하면 멤버가 새 평면도와 좌석을 볼 수 있어요.
        </p>
        <Story />
      </section>
    ),
  ],
} satisfies Meta<typeof PublishPlanSummary>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {
  render: (args) => (
    <>
      <PublishPlanSummary {...args} />
      <div className="flex justify-end gap-2">
        <Button variant="outline">닫기</Button>
        <Button>확인하고 게시</Button>
      </div>
    </>
  ),
};
export const Blocked: Story = {
  args: {
    data: {
      ...preview,
      seats: { created: [], renamed: [], archived: ["A-24"] },
      issues: [
        {
          code: "SEAT_REMOVED_WITH_BOOKINGS",
          message: "A-24에 예약이 남아 있어요",
        },
      ],
      blockingBookings: [
        {
          seatName: "A-24",
          date: "2026-10-16",
          part: "pm",
          timeRange: null,
          bookerName: "윤도현",
        },
      ],
    },
  },
  render: (args) => (
    <>
      <PublishPlanSummary {...args} />
      <div className="flex justify-end gap-2">
        <Button variant="outline">닫기</Button>
        <Button disabled>확인하고 게시</Button>
      </div>
    </>
  ),
};
export const PrivateBooking: Story = {
  args: {
    data: {
      ...preview,
      seats: { created: [], renamed: [], archived: ["A-24"] },
      issues: [
        {
          code: "SEAT_REMOVED_WITH_BOOKINGS",
          message: "A-24에 예약이 남아 있어요",
        },
      ],
      blockingBookings: [
        {
          seatName: "A-24",
          date: "2026-10-16",
          part: "pm",
          timeRange: null,
          bookerName: null,
        },
      ],
    },
  },
};
export const Versions: Story = {
  render: () => (
    <PlanVersionList
      timezone="Asia/Seoul"
      disabled={false}
      onSelect={() => {}}
      versions={[
        {
          planId: planEditorIds.plan,
          version: 3,
          status: "published",
          publishedAt: "2026-10-09T03:00:00Z",
          publishedByName: "김서준",
        },
        {
          planId: "b8000000-0000-4000-8000-000000000001",
          version: 2,
          status: "archived",
          publishedAt: "2026-10-08T01:00:00Z",
          publishedByName: "윤도현",
        },
      ]}
    />
  ),
};
