import { connection } from "next/server";
import { getPersonProfile } from "@/features/people/queries";
import { peopleErrorResponse } from "@/features/people/http";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  await connection();
  try {
    const { userId } = await params;
    return Response.json(await getPersonProfile(userId), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return peopleErrorResponse(error);
  }
}
