"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  adminNavigationEvent,
  type AdminNavigationRequest,
} from "../admin-navigation-guard";

export function useAdminRoleSettingsNavigation(path: string, dirty: boolean) {
  const router = useRouter();
  const [request, setRequest] = useState<AdminNavigationRequest | null>(null);
  const pending = useRef<AdminNavigationRequest | null>(null);
  const blocked = useRef(false);
  const lifetime = useRef(0);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!dirty) return;
    blocked.current = true;
    lifetime.current += 1;
    const current = () => blocked.current && window.location.pathname === path;
    const ask = (value: AdminNavigationRequest) => {
      if (pending.current) return;
      trigger.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      pending.current = value;
      setRequest(value);
    };
    function navigation(event: Event) {
      if (!current()) return;
      event.preventDefault();
      ask((event as CustomEvent<AdminNavigationRequest>).detail);
    }
    function click(event: MouseEvent) {
      if (
        !current() ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.hasAttribute("download") ||
        (anchor.target && anchor.target !== "_self")
      )
        return;
      const next = new URL(anchor.href, window.location.href);
      if (
        next.origin !== window.location.origin ||
        (next.pathname === window.location.pathname &&
          next.search === window.location.search)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      ask({
        proceed: () =>
          router.push(`${next.pathname}${next.search}${next.hash}`),
      });
    }
    function unload(event: BeforeUnloadEvent) {
      if (!current()) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener(adminNavigationEvent, navigation);
    document.addEventListener("click", click, true);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener(adminNavigationEvent, navigation);
      document.removeEventListener("click", click, true);
      window.removeEventListener("beforeunload", unload);
      pending.current = null;
      blocked.current = false;
      lifetime.current += 1;
      setRequest(null);
    };
  }, [path, dirty, router]);
  function cancel() {
    pending.current = null;
    setRequest(null);
  }
  function proceed() {
    const value = pending.current;
    const generation = lifetime.current;
    blocked.current = false;
    cancel();
    if (window.location.pathname !== path) return;
    void Promise.resolve()
      .then(() => value?.proceed())
      .catch(() => false)
      .then((leavingDocument) => {
        if (
          leavingDocument !== true &&
          generation === lifetime.current &&
          window.location.pathname === path
        )
          blocked.current = true;
      });
  }
  return { request, cancel, proceed, trigger };
}
