"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
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
import { SpaceForm } from "./space-form";
import { FormMessage } from "./form-fields";
import { useAdminMutation } from "./use-admin-mutation";

const accessLabels = {
  everyone: "전체 이용",
  teams: "지정 팀",
  closed: "사용 안 함",
  inherit: "층 설정 따름",
};

function ArchiveButton({
  space,
  disabled,
}: {
  space: AdminSpace;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const archived = Boolean(space.archivedAt);
  const mutation = useAdminMutation({
    action: archived ? restoreSpace : archiveSpace,
    successMessage: archived ? "공간을 되살렸어요" : "공간을 보관했어요",
    onSuccess: () => setOpen(false),
  });
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        disabled={disabled || mutation.pending}
        onClick={() =>
          archived
            ? void mutation.submit(restoreSpaceSchema, { spaceId: space.id })
            : setOpen(true)
        }
      >
        {archived ? "되살리기" : "보관"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
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
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const current = data.spaces.find((space) => space.id === selected);
  const spaces = data.spaces.filter(
    (space) => showArchived || !space.archivedAt,
  );
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">공간</h2>
        <Button
          disabled={!data.permissions.manageSpaces}
          onClick={() => setSelected("new")}
        >
          공간 더하기
        </Button>
      </div>
      <div className="flex min-h-11 items-center gap-3">
        <Switch
          id="archived-spaces"
          checked={showArchived}
          onCheckedChange={setShowArchived}
        />
        <Label htmlFor="archived-spaces">보관된 공간 보기</Label>
      </div>
      {spaces.length === 0 ? (
        <p className="py-6 text-muted-foreground">
          공간이 아직 없어요. 공간을 더해 주세요
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {[
                "이름",
                "종류",
                "정원",
                "예약 가능",
                "편의 시설",
                "이용 대상",
                "상태",
                "관리",
              ].map((label) => (
                <TableHead key={label}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {spaces.map((space) => (
              <TableRow key={space.id}>
                <TableCell className="font-medium">{space.name}</TableCell>
                <TableCell>
                  {spaceTypeLabels[space.type]}
                  {space.type === "desk_area" && (
                    <p className="text-xs tabular-nums">
                      좌석 {space.deskCount}석
                    </p>
                  )}
                </TableCell>
                <TableCell className="tabular-nums">
                  {space.capacity ?? "–"}
                </TableCell>
                <TableCell>{space.bookable ? "가능" : "불가"}</TableCell>
                <TableCell>
                  {space.amenities
                    .map((key) => amenityLabels[key as AmenityKey])
                    .filter(Boolean)
                    .join(", ") || "–"}
                </TableCell>
                <TableCell>{accessLabels[space.access ?? "inherit"]}</TableCell>
                <TableCell>{space.archivedAt ? "보관됨" : "운영 중"}</TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setSelected(space.id)}
                    >
                      {data.permissions.manageSpaces ? "고치기" : "상세 보기"}
                    </Button>
                    <ArchiveButton
                      space={space}
                      disabled={!data.permissions.manageSpaces}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {selected === "new" ? "공간 더하기" : "공간 정보"}
            </DialogTitle>
            <DialogDescription>
              {selected === "new"
                ? "공간 정보를 입력해 주세요"
                : "공간 정보와 이용 대상을 확인해 주세요"}
            </DialogDescription>
          </DialogHeader>
          {(selected === "new" || current) && (
            <SpaceForm
              key={selected}
              floorId={data.floor.id}
              space={current}
              canManage={data.permissions.manageSpaces}
              onSaved={() => setSelected(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
