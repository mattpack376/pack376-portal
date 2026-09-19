import type { ConsentStatus } from "@/generated/prisma/enums";
import { CONSENT_BADGE_CLASSES, CONSENT_STATUS_LABELS } from "@/lib/photoConsentLabels";

/** One "<where>: Consented/Declined/Pending" pill — shared by the leader roster and the Parent Dashboard. */
export default function ConsentStatusBadge({ label, status }: { label: string; status: ConsentStatus }) {
  return (
    <span className={`badge-pill ${CONSENT_BADGE_CLASSES[status]}`} style={{ marginRight: 6 }}>
      {label}: {CONSENT_STATUS_LABELS[status]}
    </span>
  );
}
