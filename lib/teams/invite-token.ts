export function isQueryableInviteToken(token: string): boolean {
  // 생성하는 base64url 토큰 밖의 문자는 DB 인코딩 오류보다 먼저 거절한다.
  return token.length > 0 && !/[^A-Za-z0-9_-]/u.test(token);
}
