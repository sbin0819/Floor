"use client";

import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Check, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { archiveSpace, restoreSpace } from "@/features/admin/actions";
import {
  archiveSpaceSchema,
  restoreSpaceSchema,
} from "@/features/admin/schema";
import type { AdminFloorData, AdminSpace } from "@/features/admin/types";
import { spaceTypeLabels } from "@/features/bookings/format";
import { amenityLabels, type AmenityKey } from "@/lib/spaces/amenities";
import { AccessEditor, accessLabels } from "./access-editor";
import { SpaceForm } from "./space-form";
import { SpaceRowMenu } from "./space-row-menu";
import { FormMessage } from "./form-fields";
import { useAdminMutation } from "./use-admin-mutation";

type EditorTarget = { id: string; section: "info" | "access" };
type OpenEditor = (
  target: EditorTarget,
  trigger: HTMLButtonElement | null,
) => void;
const spaceTypes: AdminSpace["type"][] = [
  "meeting_room",
  "seminar",
  "phone_booth",
  "desk_area",
  "lounge",
];

function SpaceActions({
  space,
  canManage,
  onEdit,
  fallbackRef,
}: {
  space: AdminSpace;
  canManage: boolean;
  onEdit: OpenEditor;
  fallbackRef: RefObject<HTMLHeadingElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(
    () => () => {
      // 대화상자가 닫힌 뒤 늦게 갱신된 목록에서 행이 사라져도 포커스를 유지해요.
      if (trigger.current === document.activeElement)
        fallbackRef.current?.focus();
    },
    [fallbackRef],
  );
  const archived = Boolean(space.archivedAt);
  const mutation = useAdminMutation({
    action: archived ? restoreSpace : archiveSpace,
    successMessage: archived ? "공간을 되살렸어요" : "공간을 보관했어요",
    onSuccess: () => setOpen(false),
  });
  return (
    <>
      <SpaceRowMenu
        name={space.name}
        archived={archived}
        canManage={canManage}
        pending={mutation.pending}
        onEdit={(button) => onEdit({ id: space.id, section: "info" }, button)}
        onAccess={(button) =>
          onEdit({ id: space.id, section: "access" }, button)
        }
        onArchive={(button) => {
          trigger.current = button;
          if (archived)
            void mutation.submit(restoreSpaceSchema, { spaceId: space.id });
          else setOpen(true);
        }}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = trigger.current;
            if (target?.isConnected) target.focus();
            else fallbackRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>이 공간을 보관할까요?</DialogTitle>
            <DialogDescription>
              멤버 화면에서 보이지 않게 돼요
            </DialogDescription>
          </DialogHeader>
          <p>{space.name}</p>
          <Button
            disabled={mutation.pending}
            onClick={() =>
              void mutation.submit(archiveSpaceSchema, { spaceId: space.id })
            }
          >
            보관하기
          </Button>
          <FormMessage message={mutation.message} />
        </DialogContent>
      </Dialog>
      {!open && (
        <FormMessage message={mutation.errors.name ?? mutation.message} />
      )}
    </>
  );
}

export function SpaceTable({ data }: { data: AdminFloorData }) {
  const id = useId();
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<EditorTarget | null>(null);
  const editorTrigger = useRef<HTMLButtonElement | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const accessHeading = useRef<HTMLHeadingElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const current = data.spaces.find((space) => space.id === selected?.id);
  const spaces = data.spaces.filter(
    (space) => showArchived || !space.archivedAt,
  );
  const openEditor: OpenEditor = (target, trigger) => {
    editorTrigger.current = trigger;
    setSelected(target);
  };
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2
          ref={heading}
          tabIndex={-1}
          className="text-lg font-semibold focus-visible:rounded focus-visible:outline-2 focus-visible:outline-ring"
        >
          공간
        </h2>
        <Button
          ref={addButton}
          disabled={!data.permissions.manageSpaces}
          onClick={(event) =>
            openEditor({ id: "new", section: "info" }, event.currentTarget)
          }
        >
          공간 더하기
        </Button>
      </div>
      <div className="flex min-h-11 items-center gap-3">
        <Switch
          id={`${id}-archived`}
          checked={showArchived}
          onCheckedChange={setShowArchived}
        />
        <Label htmlFor={`${id}-archived`}>보관된 공간 보기</Label>
      </div>
      {spaces.length === 0 ? (
        <p className="py-6 text-muted-foreground">
          공간이 아직 없어요. 공간을 더해 주세요
        </p>
      ) : (
        <div className="space-y-6">
          {spaceTypes.map((type) => {
            const rows = spaces
              .filter((space) => space.type === type)
              .sort(
                (a, b) =>
                  a.name.localeCompare(b.name, "ko") ||
                  a.id.localeCompare(b.id),
              );
            if (!rows.length) return null;
            return (
              <section
                key={type}
                aria-labelledby={`${id}-${type}`}
                className="space-y-2"
              >
                <h3 id={`${id}-${type}`} className="font-semibold">
                  {spaceTypeLabels[type]}{" "}
                  <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                    {rows.length}곳
                  </span>
                </h3>
                <Table>
                  <TableCaption className="sr-only">
                    {spaceTypeLabels[type]} 공간 관리
                  </TableCaption>
                  <TableHeader>
                    <TableRow>
                      {[
                        "이름",
                        "정원",
                        "예약 가능",
                        "편의 시설",
                        "이용 대상",
                        "동작",
                      ].map((label) => (
                        <TableHead key={label}>{label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((space) => (
                      <TableRow
                        key={space.id}
                        className={space.archivedAt ? "opacity-50" : undefined}
                      >
                        <TableCell className="font-medium">
                          <div className="flex flex-wrap items-center gap-2">
                            {space.name}
                            {space.archivedAt && (
                              <Badge variant="secondary">보관됨</Badge>
                            )}
                          </div>
                          {space.type === "desk_area" &&
                            space.deskCount > 0 && (
                              <p className="mt-1 text-xs font-normal text-muted-foreground tabular-nums">
                                좌석 {space.deskCount}석
                              </p>
                            )}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {space.capacity ?? "–"}
                        </TableCell>
                        <TableCell>
                          {space.bookable ? (
                            <Check aria-hidden="true" className="size-4" />
                          ) : (
                            <Minus
                              aria-hidden="true"
                              className="size-4 text-muted-foreground"
                            />
                          )}
                          <span className="sr-only">
                            {space.bookable ? "예약 가능" : "예약 불가"}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {space.amenities
                            .map((key) => amenityLabels[key as AmenityKey])
                            .filter(Boolean)
                            .join(", ") || "–"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {accessLabels[space.access ?? "inherit"]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <SpaceActions
                            space={space}
                            canManage={data.permissions.manageSpaces}
                            onEdit={openEditor}
                            fallbackRef={heading}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            );
          })}
        </div>
      )}
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
          onOpenAutoFocus={(event) => {
            if (selected?.section === "access" && accessHeading.current) {
              event.preventDefault();
              accessHeading.current.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = editorTrigger.current;
            if (target?.isConnected) target.focus();
            else addButton.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {selected?.id === "new" ? "공간 더하기" : "공간 정보"}
            </DialogTitle>
            <DialogDescription>
              {selected?.id === "new"
                ? "공간 정보를 입력해 주세요"
                : "공간 정보와 이용 대상을 확인해 주세요"}
            </DialogDescription>
          </DialogHeader>
          {(selected?.id === "new" || current) && (
            <SpaceForm
              key={selected?.id}
              floorId={data.floor.id}
              space={current}
              canManage={data.permissions.manageSpaces}
              onSaved={() => setSelected(null)}
            />
          )}
          {current && (
            <div className="border-t pt-5">
              <AccessEditor
                key={`${current.id}-access`}
                data={data}
                space={current}
                headingRef={accessHeading}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
