export function redirectAfterSignOut(path: "/login" | "/admin/login") {
  // Activity에 남은 이전 계정의 초안과 클라이언트 캐시도 함께 버린다.
  window.location.replace(path);
}
