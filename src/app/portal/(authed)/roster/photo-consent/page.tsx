import Link from "next/link";
import { requirePhotoConsentSession } from "@/lib/authorize";
import { prisma } from "@/lib/prisma";
import { RANK_ORDER, denDisplayName } from "@/lib/rankConfig";
import type { Rank } from "@/generated/prisma/enums";
import type { ConsentStatus, SignerRelationship } from "@/generated/prisma/enums";
import { getPublicBaseUrl } from "@/lib/appUrl";
import { generatePhotoConsentLinkAction } from "@/lib/actions/photoConsent";
import { CopyConsentLinkButton, RegenerateConsentLinkButton } from "@/components/PhotoConsentLinkControls";
import EmailConsentLinkButton from "@/components/EmailConsentLinkButton";

const RELATIONSHIP_LABELS: Record<SignerRelationship, string> = {
  PARENT: "Parent",
  GUARDIAN: "Guardian",
  GRANDPARENT: "Grandparent",
  AUNT_UNCLE: "Aunt/Uncle",
  ADULT_SIBLING: "Adult Sibling (18+)",
};

function StatusBadge({ label, status }: { label: string; status: ConsentStatus }) {
  const badgeClass = status === "CONSENT" ? "badge-consent" : status === "DECLINE" ? "badge-decline" : "badge-pending";
  const statusLabel = status === "CONSENT" ? "Consented" : status === "DECLINE" ? "Declined" : "Pending";
  return (
    <span className={`badge-pill ${badgeClass}`} style={{ marginRight: 6 }}>
      {label}: {statusLabel}
    </span>
  );
}

export default async function PhotoConsentPage() {
  const session = await requirePhotoConsentSession();
  const canManage = session.role !== "PHOTOGRAPHER";

  if (session.role === "DEN" && session.denIds.length === 0) {
    return <div className="info-card">You don&apos;t have a den assigned yet. Contact an admin.</div>;
  }

  const dens = await prisma.den.findMany({
    where: session.role === "DEN" ? { id: { in: session.denIds } } : undefined,
    include: {
      scouts: {
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        include: { photoConsent: true, parents: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
  dens.sort((a, b) => {
    if (a.scoutingYear !== b.scoutingYear) return b.scoutingYear.localeCompare(a.scoutingYear);
    return RANK_ORDER.indexOf(a.rank as Rank) - RANK_ORDER.indexOf(b.rank as Rank);
  });
  const years = Array.from(new Set(dens.map((d) => d.scoutingYear)));
  const baseUrl = getPublicBaseUrl();

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">
          <Link href="/portal/roster">← Roster</Link>
        </div>
        <h2>Photo Consent</h2>
        <p style={{ fontSize: 17 }}>
          {canManage
            ? "Generate a per-scout link for parents to consent (or decline) to photos on Instagram/Facebook, the pack website, and printed fliers — no portal account needed on their end."
            : "Consent status for photos on Instagram/Facebook, the pack website, and printed fliers, per scout."}
        </p>
      </div>

      {dens.length === 0 && <div className="info-card" style={{ fontSize: 16 }}>No dens yet.</div>}

      {years.map((year) => (
        <div key={year} style={{ marginBottom: 32 }}>
          <h3 style={{ fontSize: 19, marginBottom: 14 }}>{year}</h3>
          {dens
            .filter((d) => d.scoutingYear === year)
            .map((den) => (
              <div className="info-card" key={den.id} style={{ marginBottom: 20 }}>
                <h3 style={{ marginTop: 0, fontSize: 19 }}>{denDisplayName(den.rank, den.scoutingYear, den.label)}</h3>
                {den.scouts.length === 0 ? (
                  <p style={{ marginBottom: 0, fontSize: 16 }}>No scouts yet.</p>
                ) : (
                  den.scouts.map((scout) => {
                    const parentEmail = scout.parents.find((p) => p.email)?.email;
                    return (
                      <div
                        key={scout.id}
                        style={{ marginBottom: 18, paddingBottom: 18, borderBottom: "1px solid var(--cream-dark)" }}
                      >
                        <h4 style={{ marginBottom: 8, fontSize: 18 }}>
                          {scout.firstName} {scout.lastName}
                        </h4>

                        {!scout.photoConsent ? (
                          canManage ? (
                            <form action={generatePhotoConsentLinkAction}>
                              <input type="hidden" name="scoutId" value={scout.id} />
                              <button type="submit" className="btn btn-primary btn-small">
                                Generate Link
                              </button>
                            </form>
                          ) : (
                            <p style={{ fontSize: 14, color: "var(--ink-soft)", marginBottom: 0 }}>
                              No consent link generated yet.
                            </p>
                          )
                        ) : (
                          <>
                            <div style={{ marginBottom: 8 }}>
                              <StatusBadge label="Instagram/Facebook" status={scout.photoConsent.facebook} />
                              <StatusBadge label="Website" status={scout.photoConsent.website} />
                              <StatusBadge label="Fliers" status={scout.photoConsent.fliers} />
                            </div>
                            {scout.photoConsent.signedByName && (
                              <p style={{ fontSize: 14, marginBottom: 8 }}>
                                Signed by <strong>{scout.photoConsent.signedByName}</strong>
                                {scout.photoConsent.signedRelationship &&
                                  ` (${RELATIONSHIP_LABELS[scout.photoConsent.signedRelationship]})`}
                                {scout.photoConsent.signedDate &&
                                  ` on ${scout.photoConsent.signedDate.toLocaleDateString("en-US", {
                                    timeZone: "UTC",
                                    year: "numeric",
                                    month: "long",
                                    day: "numeric",
                                  })}`}
                              </p>
                            )}
                            {canManage && (
                              <>
                                <div
                                  style={{
                                    display: "flex",
                                    gap: 8,
                                    flexWrap: "wrap",
                                    alignItems: "center",
                                    background: "var(--cream)",
                                    padding: "8px 12px",
                                    borderRadius: 8,
                                  }}
                                >
                                  <code style={{ fontSize: 13, flex: "1 1 260px", overflowWrap: "anywhere" }}>
                                    {`${baseUrl}/consent/${scout.photoConsent.token}`}
                                  </code>
                                  <CopyConsentLinkButton url={`${baseUrl}/consent/${scout.photoConsent.token}`} />
                                  <RegenerateConsentLinkButton
                                    scoutId={scout.id}
                                    scoutName={`${scout.firstName} ${scout.lastName}`}
                                  />
                                </div>
                                <div style={{ marginTop: 8 }}>
                                  {parentEmail ? (
                                    <EmailConsentLinkButton scoutId={scout.id} parentEmail={parentEmail} />
                                  ) : (
                                    <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>
                                      No parent email on file — copy the link above instead.
                                    </span>
                                  )}
                                </div>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            ))}
        </div>
      ))}
    </>
  );
}
