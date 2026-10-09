export const adminNavigationEvent = "floor:admin-navigation";

export type AdminNavigationRequest = {
  proceed: () => void | Promise<boolean | void>;
};

// 이동 상태를 복제하지 않고, 현재 보이는 편집기만 이동 직전에 확인한다.
export function requestAdminNavigation(
  proceed: AdminNavigationRequest["proceed"],
): void {
  const event = new CustomEvent<AdminNavigationRequest>(adminNavigationEvent, {
    cancelable: true,
    detail: { proceed },
  });
  if (window.dispatchEvent(event)) void proceed();
}
