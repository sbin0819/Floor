import Link from "next/link";
import { ChevronRight } from "lucide-react";

type BreadcrumbItem = { id: string; name: string };

export function AdminBreadcrumb({
  branch,
  floor,
}: {
  branch?: BreadcrumbItem;
  floor?: BreadcrumbItem;
}) {
  const items = [
    { href: "/admin", name: "지점" },
    ...(branch
      ? [{ href: `/admin/branches/${branch.id}`, name: branch.name }]
      : []),
    ...(branch && floor
      ? [
          {
            href: `/admin/branches/${branch.id}/floors/${floor.id}`,
            name: floor.name,
          },
        ]
      : []),
  ];
  return (
    <nav aria-label="경로">
      <ol className="flex min-h-11 flex-wrap items-center gap-x-2 text-sm">
        {items.map((item, index) => (
          <li key={item.href} className="flex min-w-0 items-center gap-2">
            {index > 0 && (
              <ChevronRight
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
            )}
            <Link
              href={item.href}
              aria-current={index === items.length - 1 ? "page" : undefined}
              className="inline-flex min-h-11 items-center rounded-sm px-1 break-all text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-[current=page]:font-medium aria-[current=page]:text-foreground"
            >
              {item.name}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
