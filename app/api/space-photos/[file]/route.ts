import { connection } from "next/server";
import { getSpacePhoto } from "@/features/admin/photo-queries";

export async function GET(
  _request: Request,
  context: { params: Promise<{ file: string }> },
) {
  await connection();
  const { file } = await context.params;
  return getSpacePhoto(file);
}
