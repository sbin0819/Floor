import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

async function AdminSession() {
  if (!(await getSession())) redirect("/admin/login");
  return null;
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <AdminSession />
      </Suspense>
      {children}
    </>
  );
}
