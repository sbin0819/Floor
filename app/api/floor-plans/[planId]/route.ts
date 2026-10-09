import { connection } from "next/server";
import { getFloorPlanDocument } from "@/features/floor-plan/queries";
import { ActionError } from "@/lib/actions/result";

export async function GET(
  _request: Request,
  context: { params: Promise<{ planId: string }> },
) {
  await connection();
  try {
    const { planId } = await context.params;
    return Response.json(await getFloorPlanDocument(planId), {
      headers: { "Cache-Control": "private, max-age=31536000, immutable" },
    });
  } catch (error) {
    const code =
      error instanceof ActionError &&
      (error.code === "UNAUTHENTICATED" || error.code === "NOT_FOUND")
        ? error.code
        : "INTERNAL";
    return Response.json(
      { code },
      {
        status:
          code === "UNAUTHENTICATED" ? 401 : code === "NOT_FOUND" ? 404 : 500,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
