"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { SpaceForm } from "@/features/admin/components/space-form";
import { spaceTypeLabels } from "@/features/bookings/format";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import type { PlanEditorData } from "../editor-types";

function NewSpaceForm({
  floorId,
  canManage,
  onSpace,
}: {
  floorId: string;
  canManage: boolean;
  onSpace: (id: string) => void;
}) {
  const generation = useRef(0);
  const submittedGeneration = useRef<number | null>(null);
  useEffect(() => {
    const current = generation.current + 1;
    generation.current = current;
    return () => {
      generation.current = current + 1;
    };
  }, []);
  return (
    <div
      onSubmitCapture={() => {
        submittedGeneration.current = generation.current;
      }}
    >
      <SpaceForm
        floorId={floorId}
        canManage={canManage}
        onSaved={({ spaceId }) => {
          // 생성한 공간 행은 남지만 떠난 생성 화면의 도형 연결은 다시 적용하지 않는다.
          if (submittedGeneration.current !== generation.current) return;
          submittedGeneration.current = null;
          onSpace(spaceId);
        }}
      />
    </div>
  );
}

export function EditorConnectDialog({
  data,
  document,
  replaceShapeId,
  onClose,
  onSpace,
  onFixture,
}: {
  data: PlanEditorData;
  document: FloorPlanDocument;
  replaceShapeId?: string;
  onClose: () => void;
  onSpace: (id: string) => void;
  onFixture: (kind: "core" | "stairs" | "storage") => void;
}) {
  const [creating, setCreating] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const returnScope = useRef<HTMLElement | null>(null);
  const used = new Set(
    document.spaces
      .filter(({ id }) => id !== replaceShapeId)
      .map(({ spaceId }) => spaceId.toLowerCase()),
  );
  const spaces = data.spaces.filter(
    (space) =>
      space.floorId === data.floor.id &&
      !space.archived &&
      space.type !== "desk" &&
      !used.has(space.id.toLowerCase()),
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"
        onOpenAutoFocus={() => {
          const active = window.document.activeElement;
          returnFocus.current = active instanceof HTMLElement ? active : null;
          returnScope.current = returnFocus.current?.closest("main") ?? null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const canvas = returnScope.current?.querySelector<HTMLElement>(
            "[data-editor-canvas]",
          );
          const target = [returnFocus.current, canvas].find(
            (candidate) =>
              candidate?.isConnected &&
              !candidate.closest("[hidden], [inert]") &&
              candidate.getClientRects().length > 0,
          );
          target?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {creating ? "새 공간 만들기" : "연결할 공간 고르기"}
          </DialogTitle>
          <DialogDescription>
            도형이 없는 공간을 고르거나 고정물로 둘 수 있어요. 새 공간은 공간
            목록에도 바로 만들어져요.
          </DialogDescription>
        </DialogHeader>
        {creating ? (
          <>
            <NewSpaceForm
              floorId={data.floor.id}
              canManage={data.canManageSpaces}
              onSpace={onSpace}
            />
            <Button variant="outline" onClick={() => setCreating(false)}>
              목록으로
            </Button>
          </>
        ) : (
          <>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {spaces.length ? (
                spaces.map((space) => (
                  <Button
                    key={space.id}
                    variant="outline"
                    className="w-full justify-between"
                    onClick={() => onSpace(space.id)}
                  >
                    {space.name}
                    <span className="text-xs text-muted-foreground">
                      {spaceTypeLabels[space.type]}
                    </span>
                  </Button>
                ))
              ) : (
                <p className="py-4 text-sm text-muted-foreground">
                  연결할 공간이 없어요
                </p>
              )}
            </div>
            {data.canManageSpaces && (
              <Button variant="outline" onClick={() => setCreating(true)}>
                새 공간 만들기
              </Button>
            )}
            {!replaceShapeId && (
              <fieldset className="space-y-2 border-t pt-4">
                <legend className="pt-4 text-sm font-semibold">
                  고정물로 두기
                </legend>
                <div className="flex gap-2">
                  {(
                    [
                      ["core", "코어"],
                      ["stairs", "계단"],
                      ["storage", "창고"],
                    ] as const
                  ).map(([kind, label]) => (
                    <Button
                      key={kind}
                      variant="outline"
                      onClick={() => onFixture(kind)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </fieldset>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
