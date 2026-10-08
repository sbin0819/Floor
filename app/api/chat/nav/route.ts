import { connection } from "next/server";
import { getMyChatNav } from "@/features/chat/queries";
import { ActionError } from "@/lib/actions/result";

export async function GET() {
  await connection();
  const headers = { "Cache-Control": "private, no-store" };
  try {
    return Response.json(await getMyChatNav(), { headers });
  } catch (error) {
    if (error instanceof ActionError && error.code === "UNAUTHENTICATED")
      return Response.json(
        { code: "UNAUTHENTICATED" },
        { status: 401, headers },
      );
    return Response.json({ code: "INTERNAL" }, { status: 500, headers });
  }
}
