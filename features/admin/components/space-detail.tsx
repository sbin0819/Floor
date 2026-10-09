"use client";
import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminSpaceDetailData } from "../space-detail-types";
import {
  adminSpaceHref,
  adminSpacePath,
  type SpaceDetailTab,
} from "../space-detail-navigation";
import { SpaceForm } from "./space-form";
import { AccessEditor } from "./access-editor";
import { SpacePhotos } from "./space-photos";
import { SpaceDetailSkeleton } from "./space-detail-frame";

export function SpaceDetail({
  data,
  tab,
}: {
  data: AdminSpaceDetailData;
  tab: SpaceDetailTab;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, select] = useOptimistic(tab);
  const path = adminSpacePath(data.branch.id, data.floor.id, data.space.id);
  return (
    <div className="space-y-5">
      <nav
        aria-label="경로"
        className="flex min-h-11 flex-wrap items-center gap-2 text-sm"
      >
        <Link
          className="inline-flex min-h-11 items-center rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
          href={`/admin/branches/${data.branch.id}/spaces`}
        >
          공간 관리
        </Link>
        <span aria-hidden="true">›</span>
        <Link
          className="inline-flex min-h-11 items-center rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
          href={`/admin/branches/${data.branch.id}/floors/${data.floor.id}`}
        >
          {data.floor.name}
        </Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page" className="font-semibold">
          {data.space.name}
        </span>
      </nav>
      <nav aria-label="공간 설정" className="flex gap-5 border-b">
        {(
          [
            ["info", "정보"],
            ["access", "이용 대상"],
            ["photos", `사진 ${data.photos.length}`],
          ] as const
        ).map(([value, label]) => (
          <Link
            key={value}
            href={adminSpaceHref(path, value)}
            aria-current={selected === value ? "page" : undefined}
            className="inline-flex min-h-11 items-center border-b-2 border-transparent px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:border-foreground aria-[current=page]:font-semibold"
            onClick={(event) => {
              if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.altKey ||
                event.shiftKey
              )
                return;
              event.preventDefault();
              if (window.location.pathname !== path) return;
              startTransition(() => {
                select(value);
                router.push(adminSpaceHref(path, value), { scroll: false });
              });
            }}
          >
            {label}
          </Link>
        ))}
      </nav>
      {pending && selected !== tab ? (
        <SpaceDetailSkeleton />
      ) : tab === "photos" ? (
        <SpacePhotos
          key={data.space.id}
          spaceId={data.space.id}
          path={path}
          photos={data.photos}
          enabled={data.filesEnabled}
          canManage={data.permissions.manageSpaces}
        />
      ) : (
        <section className="max-w-3xl rounded-xl border bg-card p-5 shadow-card">
          {tab === "info" ? (
            <SpaceForm
              key={data.space.id}
              floorId={data.floor.id}
              space={data.space}
              canManage={data.permissions.manageSpaces}
            />
          ) : (
            <AccessEditor
              key={data.space.id}
              data={{ ...data, spaces: [data.space] }}
              space={data.space}
              searchHref={(query) => adminSpaceHref(path, "access", query)}
            />
          )}
        </section>
      )}
    </div>
  );
}
