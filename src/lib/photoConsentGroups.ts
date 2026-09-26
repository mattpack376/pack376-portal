import type { ConsentStatus } from "@/generated/prisma/enums";

export type ConsentGroup = "consented" | "declined" | "unanswered";

/**
 * Which Photo Consent tab a scout falls under. The form makes parents answer
 * all three questions, so a signed consent is either all "Consent" or has at
 * least one "Decline" — and a single Decline puts the scout under No Consent,
 * since that's the list a photographer needs to check. Everyone else — no link
 * generated yet, or a link nobody has answered — is Not Answered.
 */
export function consentGroup(
  consent: { facebook: ConsentStatus; website: ConsentStatus; fliers: ConsentStatus } | null,
): ConsentGroup {
  if (!consent) return "unanswered";
  const answers = [consent.facebook, consent.website, consent.fliers];
  if (answers.includes("DECLINE")) return "declined";
  if (answers.every((a) => a === "CONSENT")) return "consented";
  return "unanswered";
}
