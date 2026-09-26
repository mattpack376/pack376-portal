import Link from "next/link";
import { canManagePhotoConsentForDen, requirePhotoConsentSession } from "@/lib/authorize";
import { prisma } from "@/lib/prisma";
import { RANK_ORDER, denDisplayName } from "@/lib/rankConfig";
import type { Rank } from "@/generated/prisma/enums";
import { RELATIONSHIP_LABELS } from "@/lib/photoConsentLabels";
import { formatLongDate } from "@/lib/dateOnly";
import ConsentStatusBadge from "@/components/ConsentStatusBadge";
import { getPublicBaseUrl } from "@/lib/appUrl";
import { generatePhotoConsentLinkAction } from "@/lib/actions/photoConsent";
import { CopyConsentLinkButton, RegenerateConsentLinkButton } from "@/components/PhotoConsentLinkControls";
import EmailConsentLinkButton from "@/components/EmailConsentLinkButton";
import SegmentedNav from "@/components/SegmentedNav";
import EmailAllConsentLinksButton from "@/components/EmailAllConsentLinksButton";
import { consentGroup, type ConsentGroup } from "@/lib/photoConsentGroups";

type ConsentView = "all" | ConsentGroup;

export default async function PhotoConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await requirePhotoConsentSession();
  const { view: requestedView } = await searchParams;
  const view: ConsentView =
    requestedView === "consented" || requestedView === "declined" || requestedView === "unanswered"
      ? requestedView
      : "all";

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
  const allScouts = dens.flatMap((d) => d.scouts);
  const counts = {
    all: allScouts.length,
    consented: allScouts.filter((s) => consentGroup(s.photoConsent) === "consented").length,
    declined: allScouts.filter((s) => consentGroup(s.photoConsent) === "declined").length,
    unanswered: allScouts.filter((s) => consentGroup(s.photoConsent) === "unanswered").length,
  };
  const tabs = [
    { key: "all", href: "/portal/roster/photo-consent", label: `All (${counts.all})` },
    { key: "consented", href: "/portal/roster/photo-consent?view=consented", label: `Consented (${counts.consented})` },
    { key: "declined", href: "/portal/roster/photo-consent?view=declined", label: `No Consent (${counts.declined})` },
    { key: "unanswered", href: "/portal/roster/photo-consent?view=unanswered", label: `Not Answered (${counts.unanswered})` },
  ];

  // On a filtered tab, dens (and whole years) with no matching scouts drop out
  // entirely rather than showing an empty card each.
  const shownDens = dens
    .map((d) => ({
      ...d,
      scouts: view === "all" ? d.scouts : d.scouts.filter((s) => consentGroup(s.photoConsent) === view),
    }))
    .filter((d) => view === "all" || d.scouts.length > 0);
  const years = Array.from(new Set(shownDens.map((d) => d.scoutingYear)));
  const baseUrl = getPublicBaseUrl();
  // Read-only viewers (Photographer, Committee Member outside their own den)
  // see status only — the link itself is what lets a parent sign.
  const canManageAny = dens.some((d) => canManagePhotoConsentForDen(session, d.id));
  // Email All's tally — the scouts its action will pick: unanswered, in a den
  // this login manages, split by whether a parent email is on file.
  const emailAllScouts = dens
    .filter((d) => canManagePhotoConsentForDen(session, d.id))
    .flatMap((d) => d.scouts)
    .filter((s) => consentGroup(s.photoConsent) === "unanswered");
  const emailAllCount = emailAllScouts.filter((s) => s.parents.some((p) => p.email?.trim())).length;

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">
          <Link href="/portal/roster">← Roster</Link>
        </div>
        <h2>Photo Consent</h2>
        <p style={{ fontSize: 17 }}>
          {canManageAny
            ? "Generate a per-scout link for parents to consent (or decline) to photos on Instagram/Facebook, the pack website, and printed fliers — no portal account needed on their end."
            : "Consent status for photos on Instagram/Facebook, the pack website, and printed fliers, per scout."}
        </p>
      </div>

      {dens.length > 0 && <SegmentedNav items={tabs} active={view} />}
      {view === "unanswered" && canManageAny && emailAllScouts.length > 0 && (
        <EmailAllConsentLinksButton count={emailAllCount} noEmailCount={emailAllScouts.length - emailAllCount} />
      )}

      {dens.length === 0 && <div className="info-card" style={{ fontSize: 16 }}>No dens yet.</div>}
      {dens.length > 0 && shownDens.length === 0 && (
        <div className="info-card" style={{ fontSize: 16 }}>
          {view === "consented" && "No scouts have consented to all three yet."}
          {view === "declined" && "No scouts have declined any photo use."}
          {view === "unanswered" && "Every scout's parents have answered."}
        </div>
      )}

      {years.map((year) => (
        <div key={year} style={{ marginBottom: 32 }}>
          <h3 style={{ fontSize: 19, marginBottom: 14 }}>{year}</h3>
          {shownDens
            .filter((d) => d.scoutingYear === year)
            .map((den) => {
              const canManage = canManagePhotoConsentForDen(session, den.id);
              return (
              <div className="info-card" key={den.id} style={{ marginBottom: 20 }}>
                <h3 style={{ fontSize: 19 }}>{denDisplayName(den.rank, den.scoutingYear, den.label)}</h3>
                {den.scouts.length === 0 ? (
                  <p style={{ marginBottom: 0, fontSize: 16 }}>No scouts yet.</p>
                ) : (
                  den.scouts.map((scout) => {
                    const parentEmail = scout.parents.find((p) => p.email)?.email;
                    // Once a parent has answered, the link has done its job —
                    // Copy/Regenerate/Email only show while it's still pending.
                    const answered = consentGroup(scout.photoConsent) !== "unanswered";
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
                              <ConsentStatusBadge label="Instagram/Facebook" status={scout.photoConsent.facebook} />
                              <ConsentStatusBadge label="Website" status={scout.photoConsent.website} />
                              <ConsentStatusBadge label="Fliers" status={scout.photoConsent.fliers} />
                            </div>
                            {scout.photoConsent.signedByName && (
                              <p style={{ fontSize: 14, marginBottom: 8 }}>
                                Signed by <strong>{scout.photoConsent.signedByName}</strong>
                                {scout.photoConsent.signedRelationship &&
                                  ` (${RELATIONSHIP_LABELS[scout.photoConsent.signedRelationship]})`}
                                {scout.photoConsent.signedDate &&
                                  ` on ${formatLongDate(scout.photoConsent.signedDate)}`}
                              </p>
                            )}
                            {canManage && !answered && (
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
              );
            })}
        </div>
      ))}
    </>
  );
}
