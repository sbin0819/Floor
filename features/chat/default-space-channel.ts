import type { ChatSpaceNav } from "./types";

export function defaultSpaceChannel(
  space: Pick<ChatSpaceNav, "kind" | "channels">,
) {
  return (
    (space.kind === "branch"
      ? space.channels.find(({ name }) => name === "라운지")
      : undefined) ??
    space.channels[0] ??
    null
  );
}
