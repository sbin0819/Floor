import type { ReactionEmoji } from "./types";

export const reactionGlyphs: Record<ReactionEmoji, string> = {
  thumbs_up: "👍",
  heart: "❤️",
  joy: "😂",
  tada: "🎉",
  open_mouth: "😮",
  cry: "😢",
  pray: "🙏",
  check: "✅",
};

export const reactionNames: Record<ReactionEmoji, string> = {
  thumbs_up: "좋아요",
  heart: "하트",
  joy: "웃음",
  tada: "축하",
  open_mouth: "놀람",
  cry: "슬픔",
  pray: "감사",
  check: "확인",
};

export function reactionPeople(count: number, names: readonly string[]) {
  const visible = names.slice(0, 10);
  const remaining = Math.max(0, count - visible.length);
  if (!visible.length) return `${count}명이 반응했어요`;
  return `${visible.join(", ")}${remaining ? ` 외 ${remaining}명` : ""}`;
}
