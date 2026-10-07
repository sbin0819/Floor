import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-8 md:px-8">
      <div className="w-full">{children}</div>
    </main>
  );
}
