import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import EditAlbumForm from "@/components/EditAlbumForm";

export default async function EditAlbumPage({
  params,
}: {
  params: Promise<{ albumId: string }>;
}) {
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
