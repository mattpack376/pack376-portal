import { requireAttendanceSession } from "@/lib/authorize";

export default async function AdminAlbumsLayout({ children }: { children: React.ReactNode }) {
  await requireAttendanceSession();
  return <>{children}</>;
}
