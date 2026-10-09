import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireOperatorPage } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions/result";
import {
  getPlanEditor,
  getPlanVersions,
  previewPublishFloorPlan,
} from "@/features/floor-plan/queries";
import type { EditorPublishReads } from "@/features/floor-plan/editor/editor-publishing";
import { PlanEditor } from "@/features/floor-plan/editor/plan-editor";
import { PlanEditorSkeleton } from "@/features/floor-plan/editor/editor-frame";
import { AdminForbidden } from "@/features/admin/components/admin-forbidden";

type Props = {
  params: Promise<{ branchId: string; floorId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};
async function EditorContent({ params, searchParams }: Props) {
  await requireOperatorPage();
  const [{ branchId, floorId }, search] = await Promise.all([
    params,
    searchParams ??
      Promise.resolve<Record<string, string | string[] | undefined>>({}),
  ]);
  const data = await getPlanEditor({ branchId, floorId }).catch(
    (error: unknown) => {
      if (error instanceof ActionError && error.code === "NOT_FOUND")
        notFound();
      if (error instanceof ActionError && error.code === "FORBIDDEN")
        return null;
      throw error;
    },
  );
  if (!data) return <AdminForbidden />;
  const key = z.uuid().safeParse(search.reload);
  const reads: EditorPublishReads = {};
  const preview = z.uuid().safeParse(search.preview);
  const draft = z.uuid().safeParse(search.draft);
  const revision = z
    .string()
    .regex(/^(0|[1-9][0-9]{0,9})$/)
    .transform(Number)
    .pipe(z.number().int().max(2_147_483_646))
    .safeParse(search.revision);
  const versions = z.uuid().safeParse(search.versions);
  if (preview.success && draft.success && revision.success)
    reads.preview = {
      key: preview.data,
      result: previewPublishFloorPlan({
        branchId: data.branch.id,
        floorId: data.floor.id,
        expectedDraftId: draft.data,
        revision: revision.data,
      }),
    };
  else if (versions.success)
    reads.versions = {
      key: versions.data,
      result: getPlanVersions({
        branchId: data.branch.id,
        floorId: data.floor.id,
      })
        .then((data) => ({ ok: true as const, data }))
        .catch((error: unknown) => {
          if (error instanceof ActionError)
            return { ok: false as const, code: error.code };
          console.error("Plan versions read failed.");
          return { ok: false as const, code: "INTERNAL" as const };
        }),
    };
  return (
    <PlanEditor
      key={data.floor.id}
      data={data}
      readKey={key.success ? key.data : null}
      reads={reads}
    />
  );
}
export default function PlanEditorPage(props: Props) {
  return (
    <Suspense fallback={<PlanEditorSkeleton />}>
      <EditorContent {...props} />
    </Suspense>
  );
}
