import "server-only";
import { escapeCsvField } from "@/lib/csv";
import { toDateOnlyString } from "@/lib/dateOnly";
import { RANK_INFO } from "@/lib/rankConfig";
import { CONSENT_STATUS_LABELS, RELATIONSHIP_LABELS } from "@/lib/photoConsentLabels";
import { PHOTO_CONSENT_VIEW_LABELS, type PhotoConsentExportDen } from "@/lib/photoConsentExport";

export function buildPhotoConsentCsv(dens: PhotoConsentExportDen[]): string {
  const header = [
    "Scouting Year",
    "Den",
    "Scout First Name",
    "Scout Last Name",
    "Status",
    "Instagram/Facebook",
    "Website",
    "Fliers",
    "Signed By",
    "Relationship",
    "Date Signed",
  ];
  const lines = [header.join(",")];

  for (const den of dens) {
    const denName = `${RANK_INFO[den.rank].label}${den.label ? ` ${den.label}` : ""}`;
    for (const scout of den.scouts) {
      lines.push(
        [
          den.scoutingYear,
          denName,
          scout.firstName,
          scout.lastName,
          // "All scouts" isn't a status; the other three are the tab names.
          PHOTO_CONSENT_VIEW_LABELS[scout.group],
          CONSENT_STATUS_LABELS[scout.facebook],
          CONSENT_STATUS_LABELS[scout.website],
          CONSENT_STATUS_LABELS[scout.fliers],
          scout.signedByName ?? "",
          scout.signedRelationship ? RELATIONSHIP_LABELS[scout.signedRelationship] : "",
          toDateOnlyString(scout.signedDate) ?? "",
        ]
          .map(escapeCsvField)
          .join(",")
      );
    }
  }

  return lines.join("\n");
}
