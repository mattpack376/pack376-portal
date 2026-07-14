import Image from "next/image";
import { prisma } from "@/lib/prisma";
import PhotoConsentForm from "@/components/PhotoConsentForm";

export default async function PhotoConsentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const record = await prisma.photoConsent.findUnique({
    where: { token },
    include: { scout: { select: { firstName: true } } },
  });

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ maxWidth: 480 }}>
        <div className="brand">
          <Image src="/cub-scout-emblem.png" alt="Pack 376 Cub Scouts emblem" width={48} height={48} />
          <span className="brand-text">
            <span className="pack-name">Pack 376</span>
          </span>
        </div>
        <h1>{record ? "Photo Consent" : "Link Invalid"}</h1>

        {record ? (
          <>
            <p className="sub">
              Please let us know whether we can use photos of <strong>{record.scout.firstName}</strong> in each of
              the following places.
            </p>
            <PhotoConsentForm
              token={token}
              scoutFirstName={record.scout.firstName}
              facebook={record.facebook}
              website={record.website}
              fliers={record.fliers}
              signedByName={record.signedByName}
            />
          </>
        ) : (
          <div className="form-error">This link isn&apos;t valid. Ask your den leader for a new one.</div>
        )}
      </div>
    </div>
  );
}
