"use client";

import {
  useCallback,
  useOptimistic,
  useTransition,
  type MouseEvent,
} from "react";
import { useRouter } from "next/navigation";

export type NavigationOptions = { replace?: boolean };
export type NavigateAction = (
  href: string,
  options: NavigationOptions,
) => void | Promise<void>;

export function useOptimisticNavigation<T>(
  baseValue: T,
  navigateAction: NavigateAction,
) {
  const [value, setValue] = useOptimistic<T, T>(baseValue, (_, next) => next);
  const [isPending, startTransition] = useTransition();
  const change = useCallback(
    (next: T, href: string, options: NavigationOptions = {}) => {
      startTransition(async () => {
        setValue(next);
        await navigateAction(href, options);
      });
    },
    [navigateAction, setValue],
  );
  return { value, isPending, change };
}

export function useRouterOptimisticNavigation<T>(baseValue: T) {
  const router = useRouter();
  const navigateAction = useCallback<NavigateAction>(
    (href, { replace }) => {
      if (replace) router.replace(href);
      else router.push(href);
    },
    [router],
  );
  return useOptimisticNavigation(baseValue, navigateAction);
}

type NavigationClickEvent = Pick<
  MouseEvent<HTMLAnchorElement>,
  | "defaultPrevented"
  | "button"
  | "altKey"
  | "ctrlKey"
  | "metaKey"
  | "shiftKey"
  | "currentTarget"
>;

export function shouldInterceptNavigation(
  event: NavigationClickEvent,
): boolean {
  const target = event.currentTarget.target.toLowerCase();
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    (!target || target === "_self") &&
    !event.currentTarget.hasAttribute("download")
  );
}
