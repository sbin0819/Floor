import { connection } from "next/server";
import { createFileDownloads } from "@/features/chat/files";

export async function GET(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
) {
  await connection();
  const { attachmentId } = await context.params;
  return createFileDownloads().getFile(request, attachmentId);
}
