import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireOperatorPage } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions/result";
import {
  getAnnouncements,
  previewAnnouncementAudience,
} from "@/features/admin/queries";
import { getAnnouncementsInputSchema } from "@/features/admin/announcement-schema";
import {
  announcementPreviewRequest,
  type AnnouncementSearch,
  type AnnouncementPreviewRequest,
} from "@/features/admin/announcement-navigation";
import {
  AnnouncementFrame,
  AnnouncementColumns,
  AnnouncementHistory,
  AnnouncementSkeleton,
} from "@/features/admin/components/announcement-frame";
import { AnnouncementForm } from "@/features/admin/components/announcement-form";
import {
  AnnouncementPreview,
  type AnnouncementPreviewResult,
} from "@/features/admin/components/announcement-preview";
import { AdminForbidden } from "@/features/admin/components/admin-forbidden";

type Props = {
  params: Promise<{ branchId: string }>;
  searchParams: Promise<AnnouncementSearch>;
};
function safePreview(
  request: AnnouncementPreviewRequest,
): Promise<AnnouncementPreviewResult> {
  return previewAnnouncementAudience(request.input).then(
    (data) => ({ ok: true as const, data }),
    (error: unknown) => {
      if (!(error instanceof ActionError)) throw error;
      if (["INVALID_INPUT", "NOT_FOUND", "FORBIDDEN"].includes(error.code))
        return {
          ok: false as const,
          message:
            error.code === "INVALID_INPUT"
              ? "날짜·층·공간을 다시 확인해 주세요"
              : "이 지점의 공지를 관리할 수 없어요. 권한을 다시 확인해 주세요",
        };
      throw error;
    },
  );
}
async function PreviewContent({
  request,
  result,
}: {
  request: AnnouncementPreviewRequest;
  result: Promise<AnnouncementPreviewResult>;
}) {
  return (
    <AnnouncementPreview
      requestKey={`${request.inputKey}:${request.nonce}`}
      result={await result}
    />
  );
}
async function Content({ params, searchParams }: Props) {
  await requireOperatorPage();
  const [{ branchId }, search] = await Promise.all([params, searchParams]);
  const parsed = getAnnouncementsInputSchema.safeParse({ branchId });
  if (!parsed.success) notFound();
  const request = announcementPreviewRequest(parsed.data.branchId, search);
  // 같은 요청의 권한·지점 메타는 조회 계층에서 공유하고 두 영역을 병렬 시작한다.
  const preview = request ? safePreview(request) : null;
  // 목록이 먼저 거절되어 경계가 사라져도 시작한 읽기의 거절을 방치하지 않는다.
  void preview?.catch(() => undefined);
  const data = await getAnnouncements(parsed.data).catch((error: unknown) => {
    if (error instanceof ActionError && error.code === "NOT_FOUND") notFound();
    if (error instanceof ActionError && error.code === "FORBIDDEN") return null;
    throw error;
  });
  if (!data) return <AdminForbidden />;
  return (
    <AnnouncementColumns
      form={
        <AnnouncementForm
          key={data.branch.id}
          data={data}
          initialRequest={request}
        >
          {request && preview && (
            <Suspense
              key={`${request.inputKey}:${request.nonce}`}
              fallback={null}
            >
              <PreviewContent request={request} result={preview} />
            </Suspense>
          )}
        </AnnouncementForm>
      }
      history={<AnnouncementHistory data={data} />}
    />
  );
}
export default function AnnouncementsPage(props: Props) {
  return (
    <AnnouncementFrame>
      <Suspense fallback={<AnnouncementSkeleton />}>
        <Content {...props} />
      </Suspense>
    </AnnouncementFrame>
  );
}
