import type { SpaceSettings } from "./space-settings-queries";

export function spaceSettingsTabs(space: Pick<SpaceSettings, "kind" | "role">) {
  return [
    { key: "overview", name: "개요" },
    { key: "members", name: "멤버" },
    ...(space.kind === "community"
      ? [
          { key: "invites", name: "초대" },
          ...(space.role !== "member"
            ? [{ key: "banned", name: "들어올 수 없는 사람" }]
            : []),
          ...(space.role === "owner" ? [{ key: "danger", name: "위험" }] : []),
        ]
      : []),
  ];
}
