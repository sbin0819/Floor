"use client";

import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { PlanEditorStore } from "./store";

export const PlanEditorContext = createContext<PlanEditorStore | null>(null);
export function useEditorStore() {
  const store = useContext(PlanEditorContext);
  if (!store) throw new Error("Plan editor provider is required");
  return store;
}
export function useEditorValue<T>(
  selector: (state: ReturnType<PlanEditorStore["getState"]>) => T,
) {
  return useStore(useEditorStore(), selector);
}
