import { StatusBadge } from "@/components/status-badge";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col justify-center gap-6 p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Floor</h1>
        <p className="text-muted-foreground">함께 일하는 공간을 연결해요.</p>
      </div>
      <ul aria-label="공간과 초대 상태" className="flex flex-wrap gap-2">
        {(
          [
            "free",
            "busy",
            "mine",
            "maintenance",
            "restricted",
            "pending",
          ] as const
        ).map((status) => (
          <li key={status}>
            <StatusBadge status={status} />
          </li>
        ))}
      </ul>
    </main>
  );
}
