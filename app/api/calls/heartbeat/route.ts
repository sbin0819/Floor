import { connection } from "next/server";
import { createCallHttpHandlers } from "@/features/calls/http";

export async function POST(request: Request) {
  await connection();
  return createCallHttpHandlers().heartbeat(request);
}
