export function unreadTitle(title: string, count: number): string | null {
  const base = title
    .replace(/[\t\n\f\r ]+/g, " ")
    .trim()
    .replace(/^\(\d+\)\s*/, "")
    .trim();

  // 빈 제목에 붙인 끝 공백을 DOM getter가 제거하면 같은 값을 계속 쓰게 된다.
  if (!base) return null;
  return Number.isSafeInteger(count) && count > 0 ? `(${count}) ${base}` : base;
}
