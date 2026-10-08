import { z } from "zod";

export const roomFilesQuerySchema = z.strictObject({
  kind: z.enum(["all", "image", "file"]).default("all"),
  before: z
    .string()
    .regex(/^[1-9]\d*_[0-9]$/)
    .transform((value) => {
      const [seq, position] = value.split("_").map(Number);
      return { seq: seq!, position: position! };
    })
    .refine(({ seq }) => Number.isSafeInteger(seq))
    .optional(),
});

export function roomFilesQueryInput(query: unknown) {
  return query instanceof URLSearchParams
    ? Object.fromEntries(
        [...new Set(query.keys())].map((key) => {
          const values = query.getAll(key);
          return [key, values.length === 1 ? values[0] : values];
        }),
      )
    : query;
}
