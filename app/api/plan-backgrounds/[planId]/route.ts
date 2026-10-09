import { connection } from "next/server";
import { getPlanBackground } from "@/features/floor-plan/queries";

export async function GET(
  _request: Request,
  context: { params: Promise<{ planId: string }> },
) {
  await connection();
  const { planId } = await context.params;
  return getPlanBackground(planId);
}
