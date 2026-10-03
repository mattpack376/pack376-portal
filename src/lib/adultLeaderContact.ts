/**
 * A Leaders & Committee entry's email and phone. When the person is linked to
 * a portal login, that login holds the only copy (AdultLeader.email/phone are
 * cleared on linking), so it is read through the link; otherwise the entry's
 * own fields are the contact info. Every place that shows or sends to a
 * leader should go through here rather than reading the two columns directly,
 * or a linked person's address comes back blank.
 */
export function leaderContact(leader: {
  email: string | null;
  phone: string | null;
  user: { email: string | null; phone: string | null } | null;
}): { email: string | null; phone: string | null } {
  return leader.user
    ? { email: leader.user.email, phone: leader.user.phone }
    : { email: leader.email, phone: leader.phone };
}
