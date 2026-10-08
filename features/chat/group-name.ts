import { z } from "zod";

export const groupNameSchema = z
  .string()
  .trim()
  .refine((name) => Array.from(name).length <= 30)
  .transform((name) => name || null);

export function groupDisplayName(
  name: string | null,
  memberNames: readonly string[],
  totalOtherCount = memberNames.length,
): string {
  if (name) return name;
  const shown = [...memberNames]
    .sort((a, b) => a.localeCompare(b, "ko"))
    .slice(0, 3)
    .join(", ");
  if (!shown) return "그룹 대화";
  return totalOtherCount > 3 ? `${shown} 외 ${totalOtherCount - 3}명` : shown;
}
