import Link from "next/link";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { PageContainer } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function HomeHeaderFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      {children}
      <Button asChild>
        <Link href="/booking">
          <Plus aria-hidden="true" />
          공간 예약하기
        </Link>
      </Button>
    </div>
  );
}

export function HomeDashboardFrame({
  header,
  primary,
  secondary,
}: {
  header: ReactNode;
  primary: ReactNode;
  secondary: ReactNode;
}) {
  return (
    <PageContainer as="main" width="wide" className="space-y-6">
      <HomeHeaderFrame>{header}</HomeHeaderFrame>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">{primary}</div>
        <div className="space-y-6">{secondary}</div>
      </div>
    </PageContainer>
  );
}

export function HomeCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title}>
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{title}</h2>
          {action}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </section>
  );
}

export function HomeCardLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
    >
      {children}
    </Link>
  );
}
