import { requireAdvancementSession } from "@/lib/authorize";

export default async function AdminDensLayout({ children }: { children: React.ReactNode }) {
  await requireAdvancementSession();
  return <>{children}</>;
}
