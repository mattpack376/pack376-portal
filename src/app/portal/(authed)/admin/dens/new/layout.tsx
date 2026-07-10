import { requireAdminSession } from "@/lib/authorize";

export default async function NewDenLayout({ children }: { children: React.ReactNode }) {
  await requireAdminSession();
  return <>{children}</>;
}
