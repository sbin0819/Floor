import { requirePageSession } from "@/lib/auth/session";

export default async function Home() {
  const session = await requirePageSession("/");
  return (
    <main className="mx-auto max-w-5xl space-y-4 px-6 py-10">
      <h1 className="text-2xl font-semibold">안녕하세요, {session.name}님</h1>
    </main>
  );
}
