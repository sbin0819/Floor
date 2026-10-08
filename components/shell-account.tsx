import { cn } from "cn";
import {
  AccountMenu,
  type AccountMenuVariant,
} from "@/components/account-menu";
import { getAccountMenuData } from "@/features/auth/queries";
import { getSession } from "@/lib/auth/session";

export async function HeaderAccount({
  variant = "pill",
}: {
  variant?: AccountMenuVariant;
}) {
  if (!(await getSession())) return null;
  return <AccountMenu {...await getAccountMenuData()} variant={variant} />;
}

export function AccountMenuPlaceholder({
  variant = "pill",
}: {
  variant?: AccountMenuVariant;
}) {
  return (
    <div
      aria-busy="true"
      className={cn(
        "flex items-center",
        variant === "pill" &&
          "h-11 w-36 gap-2 rounded-full border border-border px-2",
        variant === "card" && "h-14 w-full gap-3 rounded-lg px-3",
        variant === "avatar" && "size-11 justify-center rounded-full bg-muted",
      )}
    >
      {variant !== "avatar" && (
        <>
          <span
            aria-hidden="true"
            className={cn(
              "shrink-0 rounded-full bg-muted",
              variant === "card" ? "size-8" : "size-7",
            )}
          />
          <span
            aria-hidden="true"
            className={cn(
              "h-4 rounded bg-muted",
              variant === "card" ? "w-24" : "w-16",
            )}
          />
        </>
      )}
      <span role="status" className="sr-only">
        불러오고 있어요
      </span>
    </div>
  );
}
