import { connection } from "next/server";
import { getMessageContacts } from "@/features/people/queries";
import { peopleErrorResponse } from "@/features/people/http";

export async function GET() {
  await connection();
  try {
    return Response.json(await getMessageContacts({ rateLimit: true }), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return peopleErrorResponse(error);
  }
}
