import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/page-container";

export function RouteNotFound({ admin = false }: { admin?: boolean }) {
  return (
    <PageContainer as="main" className="space-y-6 py-16">
      <h1 className="text-2xl font-semibold">찾을 수 없는 화면이에요</h1>
      <Button asChild variant="outline">
        <Link href={admin ? "/admin" : "/"}>
          {admin ? "운영자 홈으로" : "홈으로"}
        </Link>
      </Button>
    </PageContainer>
  );
}
