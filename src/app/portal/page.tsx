import { redirect } from "next/navigation";
import { requireSession, homeForRole } from "@/lib/authorize";

export default async function PortalRootPage() {
  const session = await requireSession();
  redirect(homeForRole(session.role));
}
