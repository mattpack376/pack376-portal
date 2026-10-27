import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAlbumSession } from "@/lib/authorize";
import EditAlbumForm from "@/components/EditAlbumForm";

export default async function EditAlbumPage({
  params,
}: {
  params: Promise<{ albumId: string }>;
}) {
  // Checked here as well as in the layout: a layout isn't re-run on every
  // navigation and doesn't stop this page rendering, so the page guards its own data.
  await requireAlbumSession();
  const { albumId } = await params;
  const album = await prisma.photoAlbum.findUnique({ where: { id: albumId } });
  if (!album) notFound();

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Admin</div>
        <h2>Edit Photo Album</h2>
      </div>
      <EditAlbumForm album={album} />
    </>
  );
}
