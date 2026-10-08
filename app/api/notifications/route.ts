import { connection } from "next/server";
import { getNotificationSummary } from "@/features/notifications/queries";
import { ActionError } from "@/lib/actions/result";

export async function GET() {
  // 요청 시점 경계를 오류 응답 처리 밖에 두어 사전 렌더링 중단을 삼키지 않는다.
  await connection();
  const headers = { "Cache-Control": "private, no-store" };
  try {
    return Response.json(await getNotificationSummary(), { headers });
  } catch (error) {
    if (error instanceof ActionError && error.code === "UNAUTHENTICATED")
      return Response.json(
        { code: "UNAUTHENTICATED" },
        { status: 401, headers },
      );
    return Response.json({ code: "INTERNAL" }, { status: 500, headers });
  }
}
