export const amenityKeys = [
  "monitor",
  "whiteboard",
  "video_conf",
  "projector",
  "phone",
  "power",
] as const;

export type AmenityKey = (typeof amenityKeys)[number];

export const amenityLabels: Record<AmenityKey, string> = {
  monitor: "모니터",
  whiteboard: "화이트보드",
  video_conf: "화상회의",
  projector: "프로젝터",
  phone: "전화",
  power: "전원",
};
