import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { AuthSkeleton, type AuthSkeletonVariant } from "./auth-skeleton";

export { AuthFormSkeleton } from "./auth-skeleton";

export type AuthPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="mx-auto w-full max-w-[400px] gap-6 rounded-xl border bg-card py-5 shadow-none">
      <CardHeader className="gap-3 px-5">
        <Link
          href="/"
          className="inline-flex min-h-11 w-fit items-center rounded-lg text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          Floor
        </Link>
        <h1 className="text-2xl font-semibold tracking-[-0.01em]">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-5 px-5">{children}</CardContent>
    </Card>
  );
}

export function AuthLoading({ variant }: { variant?: AuthSkeletonVariant }) {
  return <AuthSkeleton variant={variant} />;
}
