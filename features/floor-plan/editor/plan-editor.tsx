"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  MousePointer2,
  Square,
  Pentagon,
  Undo2,
  Redo2,
  Eye,
  AlertTriangle,
  Armchair,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useWideScreen } from "@/features/bookings/components/use-wide-screen";
import { PlanCanvas } from "../components/plan-canvas";
import { saveFloorPlanDraft } from "@/features/floor-plan/actions";
import type { PlanEditorData } from "../editor-types";
import type { SaveFloorPlanDraftInput } from "../editor-schema";
import type { FloorPlanDocument, PlanPoint } from "@/lib/floor-plan/types";
import type { PlanStates, PlanShapeState } from "@/lib/floor-plan/render/types";
import { floorPlanSchema } from "@/lib/floor-plan/schema";
import { hydrateSeatLabels } from "@/lib/floor-plan/seats";
import { createPlanEditorStore, type PlanEditorSource } from "./store";
import { createPlanAutosave } from "./autosave";
import { createPlanValidation } from "./validation";
import {
  PlanEditorContext,
  useEditorStore,
  useEditorValue,
} from "./editor-context";
import { PlanEditorFrame } from "./editor-frame";
import { EditorCanvas } from "./editor-canvas";
import { EditorProperties } from "./editor-properties";
import { EditorConnectDialog } from "./editor-connect-dialog";
import { SeatArrayPanel } from "./seat-array-panel";
import { EditorPublishing, type EditorPublishReads } from "./editor-publishing";
import {
  connectSpaceCommand,
  createFixtureCommand,
  createSpaceCommand,
} from "./transforms";

export function createEmptyPlan(): FloorPlanDocument {
  return {
    schema: 1,
    unit: "mm",
    bounds: { w: 30000, h: 20000 },
    walls: [],
    openings: [],
    spaces: [],
    seats: [],
    fixtures: [],
  };
}
export function editorSource(data: PlanEditorData): PlanEditorSource {
  return {
    floorId: data.floor.id,
    basePlanId: data.published?.planId ?? null,
    document: hydrateSeatLabels(
      data.draft?.document ?? data.published?.document ?? createEmptyPlan(),
      data.spaces,
    ),
    draft: data.draft
      ? {
          planId: data.draft.planId,
          version: data.draft.version,
          revision: data.draft.revision,
        }
      : null,
    savedAt: data.draft?.updatedAt ?? null,
  };
}
export function PlanEditor({
  data,
  readKey = null,
  save = saveFloorPlanDraft,
  reads,
}: {
  data: PlanEditorData;
  readKey?: string | null;
  save?: typeof saveFloorPlanDraft;
  reads?: EditorPublishReads;
}) {
  const [store] = useState(() => createPlanEditorStore(editorSource(data)));
  return (
    <PlanEditorContext value={store}>
      <EditorWorkspace
        data={data}
        readKey={readKey}
        save={save}
        reads={reads}
      />
    </PlanEditorContext>
  );
}
type Connection = { token: string; epoch: number } & (
  | { polygon: PlanPoint[]; shapeId?: never }
  | { shapeId: string; polygon?: never }
);
function EditorWorkspace({
  data,
  readKey,
  save,
  reads,
}: {
  data: PlanEditorData;
  readKey: string | null;
  save: typeof saveFloorPlanDraft;
  reads?: EditorPublishReads;
}) {
  const store = useEditorStore();
  const document = useEditorValue((state) => state.document);
  const selectedIds = useEditorValue((state) => state.selectedIds);
  const tool = useEditorValue((state) => state.tool);
  const writeLocked = useEditorValue((state) => state.writeLocked);
  const snap = useEditorValue((state) => state.snap);
  const saveState = useEditorValue((state) => state.saveState);
  const savedAt = useEditorValue((state) => state.savedAt);
  const issues = useEditorValue((state) => state.issues);
  const validationPending = useEditorValue((state) => state.validationPending);
  const canUndo = useEditorValue((state) => state.undoStack.length > 0);
  const canRedo = useEditorValue((state) => state.redoStack.length > 0);
  const dirty = useEditorValue((state) => state.changeId !== state.ackChangeId);
  const wide = useWideScreen();
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewButton = useRef<HTMLButtonElement>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [inputError, setInputError] = useState("");
  const [arrayPreview, setArrayPreview] = useState<{
    document: FloorPlanDocument;
    areaId: string;
    seats: readonly FloorPlanDocument["seats"][number][];
  } | null>(null);
  const [focusIds, setFocusIds] = useState<readonly string[]>([]);
  const connectionRef = useRef<Connection | null>(null);
  const [reloadKey, setReloadKey] = useState<string | null>(null);
  const appliedReload = useRef<string | null>(null);
  const router = useRouter(),
    pathname = usePathname(),
    search = useSearchParams();
  const ownPath = `/admin/branches/${data.branch.id}/floors/${data.floor.id}/plan`;
  const isCurrentPath = pathname.replace(/\/$/, "").toLowerCase() === ownPath;
  const selectedArea =
    selectedIds.length === 1
      ? document.spaces.find(
          (shape) =>
            shape.id === selectedIds[0] &&
            data.spaces.some(
              (space) =>
                space.id.toLowerCase() === shape.spaceId.toLowerCase() &&
                space.floorId === data.floor.id &&
                space.type === "desk_area" &&
                !space.archived,
            ),
        )
      : undefined;
  const openSeatArray = useCallback(() => {
    const state = store.getState();
    if (state.saveState === "stale" || state.writeLocked) return;
    const shape =
      state.selectedIds.length === 1
        ? state.document.spaces.find(({ id }) => id === state.selectedIds[0])
        : undefined;
    if (
      !shape ||
      !data.spaces.some(
        (space) =>
          space.id.toLowerCase() === shape.spaceId.toLowerCase() &&
          space.floorId === data.floor.id &&
          space.type === "desk_area" &&
          !space.archived,
      )
    ) {
      setInputError("데스크 구역을 먼저 골라 주세요");
      return;
    }
    setInputError("");
    state.setTool("seat-array");
  }, [store, data.spaces, data.floor.id]);
  const previewArray = useCallback(
    (seats: readonly FloorPlanDocument["seats"][number][] | null) => {
      setArrayPreview(
        seats && selectedArea
          ? { document, areaId: selectedArea.id, seats }
          : null,
      );
    },
    [document, selectedArea],
  );
  const mutation = useMutation({
    mutationKey: ["plan-editor-save", data.floor.id],
    scope: { id: `plan-editor-save-${data.floor.id}` },
    retry: false,
    mutationFn: (input: SaveFloorPlanDraftInput) => save(input),
  });
  const [autosave] = useState(() =>
    createPlanAutosave(store, { save: (input) => mutation.mutateAsync(input) }),
  );
  const context = useMemo(
    () => ({
      floorId: data.floor.id,
      floorAccess: data.floor.access,
      floorAllowedTeamIds: data.floor.allowedTeamIds,
      spaces: data.spaces,
    }),
    [data.floor, data.spaces],
  );
  const [validator] = useState(() => createPlanValidation(store, context));
  useEffect(() => {
    validator.setContext(context);
  }, [validator, context]);
  useEffect(() => {
    if (!isCurrentPath) return;
    autosave.start();
    validator.start();
    const visibility = () => {
      if (window.document.visibilityState === "hidden") void autosave.flush();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const state = store.getState();
      if (state.changeId !== state.ackChangeId) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.document.addEventListener("visibilitychange", visibility);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      autosave.stop();
      validator.stop();
      window.document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [autosave, validator, store, isCurrentPath]);
  useEffect(() => {
    if (
      !reloadKey ||
      readKey !== reloadKey ||
      !isCurrentPath ||
      appliedReload.current === reloadKey
    )
      return;
    appliedReload.current = reloadKey;
    store.getState().replaceSource(editorSource(data));
    connectionRef.current = null;
  }, [readKey, reloadKey, data, store, isCurrentPath]);
  const states: PlanStates = useMemo(() => {
    const values = new Map<string, PlanShapeState>(
      data.spaces
        .filter((space) => space.floorId === data.floor.id)
        .map((space) => [
          space.id,
          {
            kind: "free" as const,
            name: space.name,
            deskArea: space.type === "desk_area",
          },
        ]),
    );
    for (const seat of document.seats)
      values.set(seat.spaceId.toLowerCase(), {
        kind: "free",
        name:
          seat.label ??
          values.get(seat.spaceId.toLowerCase())?.name ??
          "이름 없는 좌석",
      });
    return values;
  }, [data.spaces, data.floor.id, document.seats]);
  const closeConnection = () => {
    connectionRef.current = null;
    setConnection(null);
  };
  const openPolygon = useCallback(
    (polygon: PlanPoint[]) => {
      const state = store.getState();
      if (state.saveState === "stale" || state.writeLocked) return;
      const test = {
        ...createEmptyPlan(),
        bounds: state.document.bounds,
        fixtures: [{ id: "temporary-editor-shape", kind: "core", polygon }],
      };
      if (!floorPlanSchema.safeParse(test).success) {
        setInputError("도형 개수, 꼭짓점과 층 범위를 확인해 주세요");
        return;
      }
      const next: Connection = {
        token: crypto.randomUUID(),
        epoch: state.epoch,
        polygon,
      };
      connectionRef.current = next;
      setConnection(next);
      setInputError("");
    },
    [store],
  );
  const connect = (
    captured: Connection,
    choice: { spaceId: string } | { kind: "core" | "stairs" | "storage" },
  ) => {
    const state = store.getState();
    if (
      connectionRef.current !== captured ||
      captured.epoch !== state.epoch ||
      state.saveState === "stale" ||
      state.writeLocked
    )
      return;
    const id = captured.shapeId ?? crypto.randomUUID();
    const command =
      "spaceId" in choice
        ? captured.shapeId
          ? connectSpaceCommand(
              state.document,
              captured.shapeId,
              choice.spaceId,
            )
          : createSpaceCommand(state.document, {
              id,
              spaceId: choice.spaceId,
              polygon: captured.polygon!,
            })
        : createFixtureCommand(state.document, {
            id,
            kind: choice.kind,
            polygon: captured.polygon!,
            label: { core: "코어", stairs: "계단", storage: "창고" }[
              choice.kind
            ],
          });
    if (!state.execute(command)) {
      setInputError("도형을 연결하지 못했어요. 공간과 층 범위를 확인해 주세요");
      closeConnection();
      return;
    }
    state.select([id]);
    state.setTool("select");
    closeConnection();
  };
  const disabled = saveState === "stale" || writeLocked;
  const saveLabel =
    saveState === "saving"
      ? "저장 중"
      : saveState === "error"
        ? "저장하지 못했어요"
        : saveState === "stale"
          ? "다른 곳에서 바꿨어요"
          : dirty
            ? "저장 대기 중"
            : savedAt
              ? `자동 저장됨 ${new Intl.DateTimeFormat("ko-KR", { timeZone: data.branch.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(savedAt))}`
              : "변경하면 자동 저장돼요";
  return (
    <>
      <PlanEditorFrame
        heading={`${data.branch.name} ${data.floor.name}`}
        backHref={`/admin/branches/${data.branch.id}/plans`}
        actions={
          <>
            <span
              role="status"
              className="rounded-md bg-muted px-2 py-1 text-xs tabular-nums"
            >
              {saveLabel}
            </span>
            {saveState === "error" && (
              <Button variant="outline" onClick={() => autosave.retry()}>
                다시 시도
              </Button>
            )}
            <Button
              variant="outline"
              size="icon"
              aria-label="실행 취소"
              disabled={disabled || !canUndo}
              onClick={() => store.getState().undo()}
            >
              <Undo2 />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="다시 실행"
              disabled={disabled || !canRedo}
              onClick={() => store.getState().redo()}
            >
              <Redo2 />
            </Button>
            <Button
              variant="outline"
              className={issues.length ? "text-status-busy-foreground" : ""}
              onClick={() => {
                const element = window.document.getElementById("editor-issues");
                element?.focus();
                element?.scrollIntoView({ block: "nearest" });
              }}
            >
              <AlertTriangle />
              검사 문제 {issues.length}
            </Button>
            <Button
              ref={previewButton}
              variant="outline"
              onClick={() => setPreviewOpen(true)}
            >
              <Eye />
              멤버 화면 미리보기
            </Button>
            <EditorPublishing
              data={data}
              autosave={autosave}
              active={wide && isCurrentPath}
              reads={reads}
            />
          </>
        }
        toolbar={
          <>
            {(
              [
                ["select", "선택 (V)", MousePointer2],
                ["rectangle", "사각형 공간 (R)", Square],
                ["polygon", "다각형 공간 (P)", Pentagon],
              ] as const
            ).map(([value, label, Icon]) => (
              <Button
                key={value}
                variant={tool === value ? "default" : "ghost"}
                size="icon"
                aria-label={label}
                aria-pressed={tool === value}
                disabled={disabled}
                onClick={() => store.getState().setTool(value)}
              >
                <Icon />
              </Button>
            ))}
            <Button
              variant={tool === "seat-array" ? "default" : "ghost"}
              size="icon"
              aria-label="좌석 배열 (S)"
              aria-pressed={tool === "seat-array"}
              disabled={disabled}
              onClick={openSeatArray}
            >
              <Armchair />
            </Button>
          </>
        }
        panel={
          tool === "seat-array" && selectedArea ? (
            <SeatArrayPanel
              key={selectedArea.id}
              document={document}
              areaId={selectedArea.id}
              spaces={data.spaces}
              disabled={disabled}
              onPreview={previewArray}
              onCancel={() => store.getState().setTool("select")}
              onCommand={(command) => {
                if (store.getState().execute(command)) setArrayPreview(null);
              }}
            />
          ) : (
            <EditorProperties
              branchId={data.branch.id}
              floorId={data.floor.id}
              document={document}
              spaces={data.spaces}
              selectedIds={selectedIds}
              issues={issues}
              validationPending={validationPending}
              tool={tool}
              snap={snap}
              disabled={disabled}
              onSnap={(value) => store.getState().setSnap(value)}
              onSeatArray={openSeatArray}
              onCommand={(command) => {
                if (!disabled) store.getState().execute(command);
              }}
              onSelect={(ids) => {
                store.getState().select(ids);
                store.getState().setTool("select");
                setFocusIds([...ids]);
              }}
              onCreatePolygon={openPolygon}
              onConnect={(shapeId) => {
                const next: Connection = {
                  token: crypto.randomUUID(),
                  epoch: store.getState().epoch,
                  shapeId,
                };
                connectionRef.current = next;
                setConnection(next);
              }}
            />
          )
        }
      >
        {wide && (
          <EditorCanvas
            states={states}
            onPolygon={openPolygon}
            focusIds={focusIds}
            onSeatArray={openSeatArray}
            previewSeats={
              tool === "seat-array" &&
              arrayPreview?.document === document &&
              arrayPreview.areaId === selectedArea?.id
                ? arrayPreview.seats
                : null
            }
          />
        )}
        {inputError && (
          <p
            role="alert"
            className="absolute top-3 left-3 max-w-md rounded-lg border bg-background p-3 text-sm text-destructive"
          >
            {inputError}
          </p>
        )}
      </PlanEditorFrame>
      {wide && connection && (
        <EditorConnectDialog
          key={connection.token}
          data={data}
          document={document}
          replaceShapeId={connection.shapeId}
          onClose={closeConnection}
          onSpace={(spaceId) => connect(connection, { spaceId })}
          onFixture={(kind) => connect(connection, { kind })}
        />
      )}
      <Dialog open={wide && previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent
          className="sm:max-w-5xl"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            previewButton.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>멤버 화면 미리보기</DialogTitle>
            <DialogDescription>
              초안의 모양만 확인해요. 모든 공간 상태는 비어 있음으로 표시해요.
            </DialogDescription>
          </DialogHeader>
          <PlanCanvas document={document} states={states} onSelect={() => {}} />
        </DialogContent>
      </Dialog>
      <Dialog open={wide && saveState === "stale"}>
        <DialogContent
          showCloseButton={false}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>다른 곳에서 이 초안을 바꿨어요</DialogTitle>
            <DialogDescription>
              새로 불러오면 지금 화면의 변경을 버리고 마지막 초안을 가져와요.
            </DialogDescription>
          </DialogHeader>
          <Button
            disabled={Boolean(reloadKey && reloadKey !== readKey)}
            onClick={() => {
              if (!isCurrentPath) return;
              const key = crypto.randomUUID();
              closeConnection();
              setInputError("");
              setReloadKey(key);
              const params = new URLSearchParams(search.toString());
              params.set("reload", key);
              router.replace(`${ownPath}?${params}`, { scroll: false });
            }}
          >
            {reloadKey && reloadKey !== readKey
              ? "불러오고 있어요"
              : "새로 불러오기"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
