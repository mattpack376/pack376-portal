import { redirect } from "next/navigation";
import { requireAdvancementAuditSession } from "@/lib/authorize";

/** The Audits section has one page every audit role can open; the Audit Log is linked from it for the master admin. */
export default async function AuditsIndexPage() {
  await requireAdvancementAuditSession();
  redirect("/portal/audits/advancement");
}
