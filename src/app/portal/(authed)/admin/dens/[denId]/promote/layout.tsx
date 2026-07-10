import { requireAdminSession } from "@/lib/authorize";

export default async function PromoteDenLayout({ children }: { children: React.ReactNode }) {
  await requireAdminSession();
  return <>{children}</>;
}
