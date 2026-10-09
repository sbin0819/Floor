import { createStore, type StoreApi } from "zustand/vanilla";

import type { ActionErrorCode } from "@/lib/actions/result";
import type { PlanIssue } from "@/lib/floor-plan/issues";
import type { Camera } from "@/lib/floor-plan/render/types";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import type { Command } from "./commands";

export type EditorTool = "select" | "rectangle" | "polygon" | "seat-array";
export type PlanDraft = { planId: string; version: number; revision: number };
export type PlanEditorSource = {
  floorId: string;
  basePlanId: string | null;
  document: FloorPlanDocument;
  draft: PlanDraft | null;
  savedAt: string | null;
};
export type PlanEditorState = PlanEditorSource & {
  selectedIds: readonly string[];
  tool: EditorTool;
  snap: boolean;
  camera: Camera | null;
  undoStack: readonly Command[];
  redoStack: readonly Command[];
  changeId: number;
  ackChangeId: number;
  epoch: number;
  saveState: "idle" | "saving" | "saved" | "error" | "stale";
  saveError: ActionErrorCode | null;
  issues: readonly PlanIssue[];
  validationPending: boolean;
  writeLocked: boolean;
  execute(command: Command | null): boolean;
  undo(): boolean;
  redo(): boolean;
  select(ids: readonly string[]): void;
  setTool(tool: EditorTool): void;
  setSnap(enabled: boolean): void;
  setCamera(camera: Camera | null): void;
  setWriteLocked(locked: boolean): void;
  replaceSource(source: PlanEditorSource): void;
};
export type PlanEditorStore = StoreApi<PlanEditorState>;

function selection(document: FloorPlanDocument, ids: readonly string[]) {
  const available = new Set(
    [...document.spaces, ...document.fixtures, ...document.seats].map(
      ({ id }) => id,
    ),
  );
  return [...new Set(ids)].filter((id) => available.has(id));
}
function sameIds(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
function sourceFields(source: PlanEditorSource): PlanEditorSource {
  const { floorId, basePlanId, document, draft, savedAt } = source;
  return { floorId, basePlanId, document, draft, savedAt };
}

export function createPlanEditorStore(
  source: PlanEditorSource,
): PlanEditorStore {
  return createStore<PlanEditorState>((set, get) => ({
    ...sourceFields(source),
    selectedIds: [],
    tool: "select",
    snap: true,
    camera: null,
    undoStack: [],
    redoStack: [],
    changeId: 0,
    ackChangeId: 0,
    epoch: 0,
    saveState: source.savedAt ? "saved" : "idle",
    saveError: null,
    issues: [],
    validationPending: false,
    writeLocked: false,
    execute(command) {
      if (!command) return false;
      const state = get();
      if (state.writeLocked || state.saveState === "stale") return false;
      const document = command.apply(state.document);
      if (document === state.document) return false;
      set({
        document,
        selectedIds: selection(document, state.selectedIds),
        undoStack: [...state.undoStack, command].slice(-100),
        redoStack: [],
        changeId: state.changeId + 1,
      });
      return true;
    },
    undo() {
      const state = get();
      if (state.writeLocked || state.saveState === "stale") return false;
      const command = state.undoStack.at(-1);
      if (!command) return false;
      const document = command.revert(state.document);
      set({
        document,
        selectedIds: selection(document, state.selectedIds),
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, command],
        changeId: state.changeId + 1,
      });
      return true;
    },
    redo() {
      const state = get();
      if (state.writeLocked || state.saveState === "stale") return false;
      const command = state.redoStack.at(-1);
      if (!command) return false;
      const document = command.apply(state.document);
      set({
        document,
        selectedIds: selection(document, state.selectedIds),
        undoStack: [...state.undoStack, command].slice(-100),
        redoStack: state.redoStack.slice(0, -1),
        changeId: state.changeId + 1,
      });
      return true;
    },
    select(ids) {
      const state = get();
      const selectedIds = selection(state.document, ids);
      if (!sameIds(state.selectedIds, selectedIds)) set({ selectedIds });
    },
    setTool(tool) {
      if (tool !== get().tool) set({ tool });
    },
    setSnap(snap) {
      if (snap !== get().snap) set({ snap });
    },
    setCamera(camera) {
      const current = get().camera;
      if (
        current === camera ||
        (current &&
          camera &&
          current.x === camera.x &&
          current.y === camera.y &&
          current.scale === camera.scale)
      )
        return;
      set({ camera });
    },
    setWriteLocked(writeLocked) {
      if (writeLocked !== get().writeLocked) set({ writeLocked });
    },
    replaceSource(next) {
      set({
        ...sourceFields(next),
        selectedIds: [],
        tool: "select",
        camera: null,
        undoStack: [],
        redoStack: [],
        changeId: 0,
        ackChangeId: 0,
        epoch: get().epoch + 1,
        saveState: next.savedAt ? "saved" : "idle",
        saveError: null,
        issues: [],
        validationPending: false,
        writeLocked: false,
      });
    },
  }));
}
