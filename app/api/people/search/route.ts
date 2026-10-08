import { connection } from "next/server";
import { searchPeople } from "@/features/people/queries";
import { peopleErrorResponse } from "@/features/people/http";

export async function GET(request: Request) {
  await connection();
  try {
    const results = await searchPeople(
      new URL(request.url).searchParams.get("q"),
    );
    return Response.json(
      { results },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return peopleErrorResponse(error);
  }
}
