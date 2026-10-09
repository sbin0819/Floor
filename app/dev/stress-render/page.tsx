import { notFound } from "next/navigation";
import { StressRender } from "@/features/floor-plan/components/stress-render";
import { getEnv } from "@/lib/env";

export default function StressRenderPage() {
  if (getEnv().NODE_ENV !== "development") notFound();
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <h1 className="text-[26px] font-bold">평면도 성능 측정</h1>
      <p className="text-sm text-muted-foreground">
        실제 데이터 없이 같은 렌더러의 확대·이동 속도를 확인해요.
      </p>
      <StressRender />
    </main>
  );
}
