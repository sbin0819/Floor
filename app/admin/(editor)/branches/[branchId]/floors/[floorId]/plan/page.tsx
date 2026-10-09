import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireOperatorPage } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions/result";
import { getPlanEditor } from "@/features/floor-plan/queries";
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
  return (
    <PlanEditor
      key={data.floor.id}
      data={data}
      readKey={key.success ? key.data : null}
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
