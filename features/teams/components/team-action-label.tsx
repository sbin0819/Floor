import { LoaderCircle } from "lucide-react";

export function TeamActionLabel({
  pending,
  label,
  pendingLabel,
}: {
  pending: boolean;
  label: string;
  pendingLabel: string;
}) {
  return (
    <>
      {pending && (
        <LoaderCircle
          className="size-4 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
      {pending ? pendingLabel : label}
    </>
  );
}
