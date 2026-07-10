import { requireAdminSession } from "@/lib/authorize";

export default async function AdminDensLayout({ children }: { children: React.ReactNode }) {
  await requireAdminSession();
  return <>{children}</>;
}
