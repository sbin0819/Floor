import { useLayoutEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminShellFrame } from "@/features/admin/components/admin-shell-frame";
import { AdminShellNavigation } from "@/features/admin/components/admin-shell-navigation";
import {
  SpaceDetailFrame,
  SpaceDetailSkeleton,
} from "@/features/admin/components/space-detail-frame";
import { SpacePhotos } from "@/features/admin/components/space-photos";
import { PhotoUploadProgress } from "@/features/admin/components/photo-upload-progress";
import {
  adminPhotosFixture,
  photoPath,
  photoSpaceId,
} from "@/tests/helpers/space-photos";
import type { AdminShellData } from "@/features/admin/admin-shell-types";
function PhotosStory({
  count = 4,
  enabled = true,
  canManage = true,
  uploading = false,
  loading = false,
}: {
  count?: number;
  enabled?: boolean;
  canManage?: boolean;
  uploading?: boolean;
  loading?: boolean;
}) {
  const [client] = useState(() => new QueryClient()),
    [progress, setProgress] = useState(uploading);
  useLayoutEffect(() => {
    const previous = location.href;
    const query = new URLSearchParams(location.search);
    query.set("tab", "photos");
    history.replaceState(history.state, "", `${photoPath}?${query}`);
    return () => history.replaceState(history.state, "", previous);
  }, []);
  const branchId = "e3000000-0000-4000-8000-000000000001";
  const data: AdminShellData = {
    branchId,
    user: { name: "김도윤" },
    branches: [
      {
        id: branchId,
        name: "강남점",
        menus: [
          "dashboard",
          "bookings",
          "spaces",
          "maintenance",
          "plans",
          "announcements",
          "reports",
          "roles",
        ],
      },
    ],
  };
  return (
    <QueryClientProvider client={client}>
      <AdminShellFrame
        sidebar={<AdminShellNavigation data={data} />}
        mobile={<AdminShellNavigation data={data} mobile />}
      >
        <SpaceDetailFrame>
          {loading ? (
            <SpaceDetailSkeleton />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                공간 관리 › 7F ›{" "}
                <span className="font-semibold text-foreground">회의실 B</span>
              </p>
              <div className="flex min-h-11 items-center gap-6 border-b text-sm">
                <span>정보</span>
                <span>이용 대상</span>
                <span className="font-semibold">사진 {count}</span>
              </div>
              <SpacePhotos
                spaceId={photoSpaceId}
                path={photoPath}
                photos={adminPhotosFixture(count)}
                enabled={enabled}
                canManage={canManage}
              />
              {progress && (
                <div className="max-w-72">
                  <PhotoUploadProgress
                    progress={62}
                    onCancel={() => setProgress(false)}
                  />
                </div>
              )}
            </>
          )}
        </SpaceDetailFrame>
      </AdminShellFrame>
    </QueryClientProvider>
  );
}
const meta = {
  title: "운영자/Space Photos",
  component: PhotosStory,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "가상 사진이에요. 모든 액션은 쓰기를 거절해 DB·R2에 접속하지 않아요. 진행 카드는 가짜 62% 표시예요.",
      },
    },
  },
} satisfies Meta<typeof PhotosStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Photos: Story = {};
export const Empty: Story = { args: { count: 0 } };
export const Eight: Story = { args: { count: 8 } };
export const StorageDisabled: Story = { args: { enabled: false } };
export const ReadOnly: Story = { args: { canManage: false } };
export const Uploading: Story = { args: { count: 3, uploading: true } };
export const Loading: Story = { args: { loading: true } };
