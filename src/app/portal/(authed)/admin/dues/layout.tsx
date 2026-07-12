import { requireAdminSession } from "@/lib/authorize";

export default async function AdminDuesLayout({ children }: { children: React.ReactNode }) {
  await requireAdminSession();
  return <>{children}</>;
}
