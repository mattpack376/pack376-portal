import { requireDuesViewSession } from "@/lib/authorize";

export default async function AdminDuesLayout({ children }: { children: React.ReactNode }) {
  await requireDuesViewSession();
  return <>{children}</>;
}
