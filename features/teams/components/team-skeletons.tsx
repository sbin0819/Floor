import { SkeletonRegion } from "@/components/skeleton-region";
import { SkeletonHeading, SkeletonRows } from "@/components/skeleton-shapes";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { teamLinkClassName } from "./team-display";

export function HomeSkeleton() {
  return (
    <SkeletonRegion width="wide" className="space-y-6">
      <Skeleton className="h-8 w-72 max-w-full" />
      {[0, 1].map((key) => (
        <div
          key={key}
          className="max-w-2xl space-y-5 rounded-xl border bg-card p-5"
        >
          <SkeletonHeading />
          <Skeleton className="h-11 w-36" />
        </div>
      ))}
    </SkeletonRegion>
  );
}

export function TeamStartSkeleton() {
  return (
    <SkeletonRegion width="standard" className="space-y-6">
      <Skeleton className="h-8 w-52" />
      <div className="grid gap-5 sm:grid-cols-2">
        {[0, 1].map((key) => (
          <div key={key} className="space-y-5 rounded-xl border bg-card p-6">
            <Skeleton className="size-8" />
            <SkeletonHeading />
            <SkeletonRows count={3} />
            <Skeleton className="h-11 w-full" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function TeamDetailSkeleton() {
  return (
    <SkeletonRegion width="standard" className="space-y-6">
      <Link href="/teams" className={teamLinkClassName}>
        ‹ 팀
      </Link>
      <SkeletonHeading />
      <div className="space-y-4 rounded-xl border bg-card p-5">
        <h2 className="font-semibold">팀원 목록</h2>
        <Table>
          <TableHeader>
            <TableRow>
              {["이름", "이메일", "직함", "역할"].map((label) => (
                <TableHead key={label}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {[0, 1, 2].map((row) => (
              <TableRow key={row} data-slot="skeleton-row" className="h-11">
                {[0, 1, 2, 3].map((column) => (
                  <TableCell key={column}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </SkeletonRegion>
  );
}

export function InviteSkeleton() {
  return (
    <SkeletonRegion width="form">
      <div className="mx-auto max-w-[480px] space-y-5 rounded-xl border bg-card p-6">
        <SkeletonHeading />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-4 w-40" />
        <div className="flex gap-3">
          <Skeleton className="h-11 w-24" />
          <Skeleton className="h-11 w-24" />
        </div>
      </div>
    </SkeletonRegion>
  );
}

export function TeamsSkeleton() {
  return (
    <SkeletonRegion width="standard" className="space-y-8">
      <SkeletonHeading />
      <TeamsSkeletonRows />
    </SkeletonRegion>
  );
}

function TeamsSkeletonRows() {
  return (
    <>
      <div className="space-y-4 rounded-xl border bg-card p-5">
        <SkeletonHeading compact />
        <SkeletonRows count={2} action />
      </div>
      <div className="space-y-4 rounded-xl border bg-card p-5">
        <SkeletonHeading compact />
        <SkeletonRows count={2} />
      </div>
    </>
  );
}

export function TeamsContentSkeleton() {
  return (
    <SkeletonRegion className="space-y-8">
      <TeamsSkeletonRows />
    </SkeletonRegion>
  );
}
