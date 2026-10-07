export type PlanPoint = [number, number];

export type FloorPlanDocument = {
  schema: 1;
  unit: "mm";
  bounds: { w: number; h: number };
  walls: {
    id: string;
    points: PlanPoint[];
    thickness: number;
    closed: boolean;
  }[];
  openings: {
    id: string;
    wallId: string;
    at: number;
    width: number;
    kind: "door" | "opening";
  }[];
  spaces: {
    id: string;
    spaceId: string;
    polygon: PlanPoint[];
    label: { at: PlanPoint };
  }[];
  seats: {
    id: string;
    spaceId: string;
    at: PlanPoint;
    size: [number, number];
    rotation: number;
  }[];
  fixtures: {
    id: string;
    kind: "core" | "stairs" | "storage";
    polygon: PlanPoint[];
    label?: string;
  }[];
  background?: {
    transform: [number, number, number, number, number, number];
    opacity: number;
  };
};
