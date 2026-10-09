import { useContext, useLayoutEffect, useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AnnouncementForm } from "@/features/admin/components/announcement-form";
import {
  AnnouncementColumns,
  AnnouncementFrame,
  AnnouncementHistory,
  AnnouncementSkeleton,
} from "@/features/admin/components/announcement-frame";
import {
  AnnouncementPreview,
  AnnouncementPreviewContext,
} from "@/features/admin/components/announcement-preview";
import { AdminShellFrame } from "@/features/admin/components/admin-shell-frame";
import { AdminShellNavigation } from "@/features/admin/components/admin-shell-navigation";
import { announcementPath } from "@/features/admin/announcement-navigation";
import type { AdminShellData } from "@/features/admin/admin-shell-types";
import type { LoungeAvailability } from "@/features/admin/announcement-types";
import {
  announcementBranchId,
  announcementRequest,
  announcementPreviewFixture,
  announcementsFixture,
} from "@/tests/helpers/announcements";

const shell: AdminShellData = {
  branchId: announcementBranchId,
  branches: [
    {
      id: announcementBranchId,
      name: "강남점",
      menus: [
        "dashboard",
        "bookings",
        "spaces",
        "maintenance",
        "plans",
        "announcements",
        "roles",
      ],
    },
  ],
  user: { name: "김도윤" },
};
function FakePreview({ lounge }: { lounge: LoungeAvailability }) {
  const context = useContext(AnnouncementPreviewContext);
  const result = useMemo(
    () => ({
      ok: true as const,
      data: { ...announcementPreviewFixture(), lounge },
    }),
    [lounge],
  );
  return context?.key ? (
    <AnnouncementPreview requestKey={context.key} result={result} />
  ) : null;
}
function AnnouncementStory({
  mode = "both",
}: {
  mode?: "both" | "lounge" | "audience" | "unavailable" | "empty" | "loading";
}) {
  const [client] = useState(() => new QueryClient());
  useLayoutEffect(() => {
    const previous = window.location.href;
    window.history.replaceState(
      window.history.state,
      "",
      `${announcementPath(announcementBranchId)}${window.location.search}`,
    );
    return () =>
      window.history.replaceState(window.history.state, "", previous);
  }, []);
  const data = announcementsFixture(
    mode === "unavailable"
      ? {
          lounge: {
            available: false,
            reason: "missing_channel",
            memberCount: 0,
          },
        }
      : mode === "empty"
        ? { rows: [] }
        : {},
  );
  const initialRequest = announcementRequest(
    !["audience", "unavailable"].includes(mode),
    mode !== "lounge",
  );
  return (
    <QueryClientProvider client={client}>
      <AnnouncementFrame>
        {mode === "loading" ? (
          <AnnouncementSkeleton />
        ) : (
          <AnnouncementColumns
            form={
              <AnnouncementForm data={data} initialRequest={initialRequest}>
                <FakePreview lounge={data.lounge} />
              </AnnouncementForm>
            }
            history={<AnnouncementHistory data={data} />}
          />
        )}
      </AnnouncementFrame>
    </QueryClientProvider>
  );
}
const meta = {
  title: "운영자/Announcements",
  component: AnnouncementStory,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
      navigation: { pathname: announcementPath(announcementBranchId) },
    },
    docs: {
      description: {
        component:
          "고정된 가상 자료의 공지 입력·수신 인원 미리보기예요. 실제 조회·발송·API는 사용하지 않고 전송은 거절해요.",
      },
    },
  },
  decorators: [
    (Story) => (
      <AdminShellFrame
        sidebar={<AdminShellNavigation data={shell} />}
        mobile={<AdminShellNavigation data={shell} mobile />}
      >
        <Story />
      </AdminShellFrame>
    ),
  ],
} satisfies Meta<typeof AnnouncementStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const BothDestinations: Story = {};
export const LoungeOnly: Story = { args: { mode: "lounge" } };
export const AudienceOnly: Story = { args: { mode: "audience" } };
export const LoungeUnavailable: Story = { args: { mode: "unavailable" } };
export const NoHistory: Story = { args: { mode: "empty" } };
export const Loading: Story = { args: { mode: "loading" } };
