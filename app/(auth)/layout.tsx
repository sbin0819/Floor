import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center px-6 py-8">
      <div className="w-full max-w-[400px]">{children}</div>
    </main>
  );
}
