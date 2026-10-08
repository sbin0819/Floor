import { connection } from "next/server";
import { createChatUploads } from "@/features/chat/uploads";

export async function PUT(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
) {
  await connection();
  const { attachmentId } = await context.params;
  return createChatUploads().putUpload(request, attachmentId);
}
