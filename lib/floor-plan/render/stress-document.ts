import type { FloorPlanDocument } from "../types";

const uuid = (index: number) =>
  `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;

export function createStressDocument(seed = 34): FloorPlanDocument {
  let value = seed >>> 0;
  const random = () => {
    value = (Math.imul(1664525, value) + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
  const document: FloorPlanDocument = {
    schema: 1,
    unit: "mm",
    bounds: { w: 90_000, h: 67_500 },
    spaces: [],
    seats: [],
    walls: [],
    openings: [],
    fixtures: [],
  };
  for (let index = 0; index < 300; index++) {
    const x = (index % 20) * 4500 + 200;
    const y = Math.floor(index / 20) * 4500 + 200;
    const width = 3900 + Math.floor(random() * 200);
    document.spaces.push({
      id: `space-${index}`,
      spaceId: uuid(index + 1),
      polygon: [
        [x, y],
        [x + width, y],
        [x + width, y + 4100],
        [x, y + 4100],
      ],
      label: { at: [x + Math.floor(width / 2), y + 2050] },
    });
    if (index < 200) {
      document.walls.push({
        id: `wall-${index}`,
        points: [
          [x, y],
          [x + width, y],
        ],
        thickness: random() < 0.5 ? 100 : 200,
        closed: false,
      });
    }
  }
  for (let index = 0; index < 2000; index++) {
    const area = index % 300;
    const position = Math.floor(index / 300);
    document.seats.push({
      id: `seat-${index}`,
      spaceId: uuid(index + 1001),
      at: [
        (area % 20) * 4500 + 1000 + (position % 3) * 1100,
        Math.floor(area / 20) * 4500 + 1000 + Math.floor(position / 3) * 1100,
      ],
      size: [600, 500],
      rotation: Math.floor(random() * 4) * 90,
    });
  }
  return document;
}
