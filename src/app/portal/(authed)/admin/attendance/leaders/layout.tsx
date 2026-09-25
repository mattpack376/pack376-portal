import { requireLeaderAttendanceSession } from "@/lib/authorize";

/**
 * Narrows the parent attendance layout (which also lets Committee Members in)
 * to the roles that take leader & committee attendance.
 */
export default async function LeaderAttendanceLayout({ children }: { children: React.ReactNode }) {
  await requireLeaderAttendanceSession();
  return <>{children}</>;
}
