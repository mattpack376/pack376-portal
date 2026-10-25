import "server-only";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { RANK_ORDER } from "@/lib/rankConfig";
import { consentGroup, type ConsentGroup } from "@/lib/photoConsentGroups";
import type { ConsentStatus, Rank, SignerRelationship } from "@/generated/prisma/enums";

/*
 * What the Photo Consent exports (CSV and PDF) list. Same visibility as the
 * Photo Consent page — Admin, Junior Admin, Committee Member and Photographer
 * see every den, a Den Leader only their own — and the same tabs. Never
 * carries the consent link token: that is what lets a parent sign, and the
 * page hides it from read-only roles for the same reason.
 */

export type PhotoConsentExportView = "all" | ConsentGroup;

export const PHOTO_CONSENT_VIEW_LABELS: Record<PhotoConsentExportView, string> = {
  all: "All scouts",
  consented: "Consented",
  declined: "No Consent",
  unanswered: "Not Answered",
};

/** Filename fragment per tab, e.g. pack376-photo-consent-not-answered.csv. */
export const PHOTO_CONSENT_VIEW_SLUGS: Record<PhotoConsentExportView, string> = {
  all: "all",
  consented: "consented",
  declined: "no-consent",
  unanswered: "not-answered",
};

export type PhotoConsentExportScout = {
  firstName: string;
  lastName: string;
  group: ConsentGroup;
  facebook: ConsentStatus;
  website: ConsentStatus;
  fliers: ConsentStatus;
  signedByName: string | null;
  signedRelationship: SignerRelationship | null;
  signedDate: Date | null;
};

export type PhotoConsentExportDen = {
  rank: Rank;
  scoutingYear: string;
  label: string;
  scouts: PhotoConsentExportScout[];
};

export function parsePhotoConsentView(raw: string | null | undefined): PhotoConsentExportView {
  return raw === "consented" || raw === "declined" || raw === "unanswered" ? raw : "all";
}

/** Dens that have at least one scout in `view`, in the order the page lists them, or the HTTP status to answer with when the caller isn't allowed. */
export async function loadPhotoConsentExport(
  view: PhotoConsentExportView
): Promise<{ status: 401 | 403 } | { dens: PhotoConsentExportDen[] }> {
  const session = await getSession();
  if (!session) return { status: 401 };
  if (
    session.role !== "ADMIN" &&
    session.role !== "JUNIOR_ADMIN" &&
    session.role !== "COMMITTEE" &&
    session.role !== "DEN" &&
    session.role !== "PHOTOGRAPHER"
  ) {
    return { status: 403 };
  }

  const dens = await prisma.den.findMany({
    where: session.role === "DEN" ? { id: { in: session.denIds } } : undefined,
    include: {
      scouts: {
        where: { active: true },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        include: { photoConsent: true },
      },
    },
  });
  dens.sort((a, b) => {
    if (a.scoutingYear !== b.scoutingYear) return b.scoutingYear.localeCompare(a.scoutingYear);
    return RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank);
  });

  return {
    dens: dens
      .map((den) => ({
        rank: den.rank,
        scoutingYear: den.scoutingYear,
        label: den.label,
        scouts: den.scouts
          .map((scout) => ({
            firstName: scout.firstName,
            lastName: scout.lastName,
            group: consentGroup(scout.photoConsent),
            facebook: scout.photoConsent?.facebook ?? ("PENDING" as const),
            website: scout.photoConsent?.website ?? ("PENDING" as const),
            fliers: scout.photoConsent?.fliers ?? ("PENDING" as const),
            signedByName: scout.photoConsent?.signedByName ?? null,
            signedRelationship: scout.photoConsent?.signedRelationship ?? null,
            signedDate: scout.photoConsent?.signedDate ?? null,
          }))
          .filter((scout) => view === "all" || scout.group === view),
      }))
      .filter((den) => den.scouts.length > 0),
  };
}
