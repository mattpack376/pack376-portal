import { redirect } from "next/navigation";
import { requireSession } from "@/lib/authorize";

export default async function PortalRootPage() {
  const session = await requireSession();
  redirect(session.role === "ADMIN" ? "/portal/admin" : "/portal/den");
}
