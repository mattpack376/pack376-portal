import { requireAlbumSession } from "@/lib/authorize";

export default async function AdminAlbumsLayout({ children }: { children: React.ReactNode }) {
  await requireAlbumSession();
  return <>{children}</>;
}
