import { connection } from "next/server";
import { createCallWebhookHandler } from "@/features/calls/webhook";

export async function POST(request: Request) {
  await connection();
  return createCallWebhookHandler()(request);
}
