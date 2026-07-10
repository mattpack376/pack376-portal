import { requireAttendanceSession } from "@/lib/authorize";

export default async function AdminAttendanceLayout({ children }: { children: React.ReactNode }) {
  await requireAttendanceSession();
  return <>{children}</>;
}
