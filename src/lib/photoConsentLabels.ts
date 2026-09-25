import type { ConsentStatus, SignerRelationship } from "@/generated/prisma/enums";

export const RELATIONSHIP_LABELS: Record<SignerRelationship, string> = {
  PARENT: "Parent",
  GUARDIAN: "Guardian",
  GRANDPARENT: "Grandparent",
  AUNT_UNCLE: "Aunt/Uncle",
  ADULT_SIBLING: "Adult Sibling (18+)",
};

export const CONSENT_STATUS_LABELS: Record<ConsentStatus, string> = {
  CONSENT: "Consented",
  DECLINE: "Declined",
  PENDING: "Pending",
};

export const CONSENT_BADGE_CLASSES: Record<ConsentStatus, string> = {
  CONSENT: "badge-consent",
  DECLINE: "badge-decline",
  PENDING: "badge-pending",
};
