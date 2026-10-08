const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const key = (userId: string) => `floor:recent-rooms:${userId}`;

export function readRecentRooms(userId: string): string[] {
  try {
    const data: unknown = JSON.parse(
      window.localStorage.getItem(key(userId)) ?? "[]",
    );
    if (!Array.isArray(data)) return [];
    return [
      ...new Set(
        data
          .filter(
            (value): value is string =>
              typeof value === "string" && uuid.test(value),
          )
          .map((value) => value.toLowerCase()),
      ),
    ].slice(0, 5);
  } catch {
    return [];
  }
}

export function rememberRoom(userId: string, roomId: string) {
  if (!uuid.test(roomId)) return;
  try {
    const id = roomId.toLowerCase();
    window.localStorage.setItem(
      key(userId),
      JSON.stringify(
        [id, ...readRecentRooms(userId).filter((value) => value !== id)].slice(
          0,
          5,
        ),
      ),
    );
  } catch {
    // 저장소를 사용할 수 없어도 빠른 이동은 계속 제공한다.
  }
}
