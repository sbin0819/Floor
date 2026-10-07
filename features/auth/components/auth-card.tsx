import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

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
    <Card className="w-full gap-6 rounded-xl border bg-card py-5 shadow-none">
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

export function AuthLoading() {
  return (
    <p
      role="status"
      className="py-10 text-center text-sm text-muted-foreground"
    >
      화면을 준비하고 있어요.
    </p>
  );
}
