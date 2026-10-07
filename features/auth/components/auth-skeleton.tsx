import { SkeletonRegion } from "@/components/skeleton-region";
import { SkeletonFields, SkeletonHeading } from "@/components/skeleton-shapes";
import { Skeleton } from "@/components/ui/skeleton";

export type AuthSkeletonVariant =
  "login" | "signup" | "email" | "reset" | "operator";

export function AuthSkeleton({
  variant = "login",
}: {
  variant?: AuthSkeletonVariant;
}) {
  const social = variant === "login" || variant === "signup";
  const fields =
    variant === "signup"
      ? 3
      : variant === "email" || variant === "reset"
        ? 1
        : 2;
  return (
    <SkeletonRegion className="w-full space-y-6 rounded-xl border bg-card p-5">
      <div className="space-y-3">
        <Skeleton className="h-11 w-12" />
        <SkeletonHeading />
      </div>
      {social && (
        <div className="space-y-3">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="my-5 h-px w-full" />
        </div>
      )}
      <SkeletonFields count={fields} />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="mx-auto h-5 w-40" />
    </SkeletonRegion>
  );
}
