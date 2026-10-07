export function floorChannel(floorId: string): string {
  return `floor:${floorId}`;
}

export function roomChannel(roomId: string): string {
  return `room:${roomId}`;
}

export function userChannel(userId: string): string {
  return `user:${userId}`;
}
