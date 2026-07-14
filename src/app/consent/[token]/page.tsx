import Image from "next/image";
import { prisma } from "@/lib/prisma";
import PhotoConsentForm from "@/components/PhotoConsentForm";

/** Pack is based in Brooklyn, NY — "today" for a paper-style signature date should follow local time, not UTC. */
function todayInPackTimeZone() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

export default async function PhotoConsentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const record = await prisma.photoConsent.findUnique({
    where: { token },
    include: { scout: { select: { firstName: true } } },
  });
  const signedDate = record?.signedDate ? record.signedDate.toISOString().slice(0, 10) : todayInPackTimeZone();

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
              signedDate={signedDate}
            />
          </>
        ) : (
          <div className="form-error">This link isn&apos;t valid. Ask your den leader for a new one.</div>
        )}
      </div>
    </div>
  );
}
