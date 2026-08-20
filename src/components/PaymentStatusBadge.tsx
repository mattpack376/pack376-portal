import { paymentStatus } from "@/lib/paymentStatus";

/** Paid / Partial / Unpaid pill. Pass remainingCents null when no fee is set. */
export default function PaymentStatusBadge({
  remainingCents,
  paidCents,
}: {
  remainingCents: number | null;
  paidCents: number;
}) {
  const { label, cls } = paymentStatus(remainingCents, paidCents);
  return <span className={`badge-pill ${cls}`}>{label}</span>;
}
