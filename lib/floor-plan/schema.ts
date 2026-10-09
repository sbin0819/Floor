import { z } from "zod";

import type { FloorPlanDocument, PlanPoint } from "@/lib/floor-plan/types";

export type { FloorPlanDocument } from "@/lib/floor-plan/types";

const point = z.tuple([z.int(), z.int()]);
const positiveInteger = z.int().positive();
const shapeId = z.string().min(1);
const polygon = z.array(point).min(3).max(64);
export const MAX_FLOOR_PLAN_BYTES = 900 * 1024;

export const floorPlanSchema = z
  .strictObject({
    schema: z.literal(1),
    unit: z.literal("mm"),
    bounds: z.strictObject({
      w: positiveInteger.max(100_000),
      h: positiveInteger.max(100_000),
    }),
    walls: z
      .array(
        z.strictObject({
          id: shapeId,
          points: z.array(point).min(2).max(64),
          thickness: positiveInteger,
          closed: z.boolean(),
        }),
      )
      .max(300),
    openings: z
      .array(
        z.strictObject({
          id: shapeId,
          wallId: shapeId,
          at: z.number().min(0).max(1),
          width: positiveInteger,
          kind: z.enum(["door", "opening"]),
        }),
      )
      .max(300),
    spaces: z
      .array(
        z.strictObject({
          id: shapeId,
          spaceId: z.uuid(),
          polygon,
          label: z.strictObject({ at: point }),
        }),
      )
      .max(300),
    seats: z
      .array(
        z.strictObject({
          id: shapeId,
          spaceId: z.uuid(),
          at: point,
          size: z.tuple([positiveInteger, positiveInteger]),
          rotation: z.int(),
        }),
      )
      .max(2000),
    fixtures: z
      .array(
        z.strictObject({
          id: shapeId,
          kind: z.enum(["core", "stairs", "storage"]),
          polygon,
          label: z.string().optional(),
        }),
      )
      .max(100),
    background: z
      .strictObject({
        transform: z.tuple([
          z.number(),
          z.number(),
          z.number(),
          z.number(),
          z.number(),
          z.number(),
        ]),
        opacity: z.number().min(0).max(1),
      })
      .optional(),
  })
  .superRefine((document, ctx) => {
    if (
      new TextEncoder().encode(JSON.stringify(document)).byteLength >
      MAX_FLOOR_PLAN_BYTES
    )
      ctx.addIssue({
        code: "custom",
        message: "평면도 문서는 900KB 이하여야 해요.",
      });
    const checkPoint = (value: PlanPoint, path: (string | number)[]) => {
      if (
        value[0] < 0 ||
        value[0] > document.bounds.w ||
        value[1] < 0 ||
        value[1] > document.bounds.h
      ) {
        ctx.addIssue({
          code: "custom",
          path,
          message: "점은 도면 범위 안에 있어야 해요.",
        });
      }
    };

    const ids = new Set<string>();
    for (const collection of [
      "walls",
      "openings",
      "spaces",
      "seats",
      "fixtures",
    ] as const) {
      document[collection].forEach((shape, index) => {
        if (ids.has(shape.id)) {
          ctx.addIssue({
            code: "custom",
            path: [collection, index, "id"],
            message: "도형 id는 도면 안에서 고유해야 해요.",
          });
        }
        ids.add(shape.id);
      });
    }

    document.walls.forEach((wall, index) => {
      wall.points.forEach((value, vertex) =>
        checkPoint(value, ["walls", index, "points", vertex]),
      );
    });
    document.spaces.forEach((space, index) => {
      space.polygon.forEach((value, vertex) =>
        checkPoint(value, ["spaces", index, "polygon", vertex]),
      );
      checkPoint(space.label.at, ["spaces", index, "label", "at"]);
    });
    document.seats.forEach((seat, index) =>
      checkPoint(seat.at, ["seats", index, "at"]),
    );
    document.fixtures.forEach((fixture, index) => {
      fixture.polygon.forEach((value, vertex) =>
        checkPoint(value, ["fixtures", index, "polygon", vertex]),
      );
    });

    const wallIds = new Set(document.walls.map(({ id }) => id));
    document.openings.forEach((opening, index) => {
      if (!wallIds.has(opening.wallId)) {
        ctx.addIssue({
          code: "custom",
          path: ["openings", index, "wallId"],
          message: "문이 가리키는 벽이 도면에 있어야 해요.",
        });
      }
    });

    for (const collection of ["spaces", "seats"] as const) {
      const spaceIds = new Set<string>();
      document[collection].forEach((shape, index) => {
        const spaceId = shape.spaceId.toLowerCase();
        if (spaceIds.has(spaceId)) {
          ctx.addIssue({
            code: "custom",
            path: [collection, index, "spaceId"],
            message: "같은 공간을 가리키는 도형은 하나만 있어야 해요.",
          });
        }
        spaceIds.add(spaceId);
      });
    }
  }) satisfies z.ZodType<FloorPlanDocument>;
