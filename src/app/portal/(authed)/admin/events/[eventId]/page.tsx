import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminSession } from "@/lib/authorize";
import { prisma } from "@/lib/prisma";
import { getEventDetail } from "@/lib/eventsData";
import { formatCents } from "@/lib/duesData";
import { RANK_ORDER, denDisplayName } from "@/lib/rankConfig";
import { DEADLINE_CATEGORY_LABELS, formatDueDate } from "@/lib/deadlineCategories";
import { registerScoutForEventAction, removeRegistrationAction, updateEventAction } from "@/lib/actions/events";
import type { Rank } from "@/generated/prisma/enums";
import DeleteEventButton from "@/components/DeleteEventButton";

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default async function AdminEventDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  await requireAdminSession();
  const { eventId } = await params;

  const event = await getEventDetail(eventId);
  if (!event) notFound();

  const registeredScoutIds = new Set(event.registrations.map((r) => r.scout.id));

  const dens = await prisma.den.findMany({
    include: { scouts: { orderBy: [{ lastName: "asc" }, { firstName: "asc" }] } },
  });
  dens.sort((a, b) => {
    if (a.scoutingYear !== b.scoutingYear) return b.scoutingYear.localeCompare(a.scoutingYear);
    return RANK_ORDER.indexOf(a.rank as Rank) - RANK_ORDER.indexOf(b.rank as Rank);
  });
  const availableDens = dens
    .map((den) => ({ den, scouts: den.scouts.filter((s) => !registeredScoutIds.has(s.id)) }))
    .filter((d) => d.scouts.length > 0);

  return (
    <>
      <div className="section-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div className="eyebrow">
            <Link href="/portal/admin/events">← Events</Link>
          </div>
          <h2>{event.title}</h2>
          <p style={{ fontSize: 17 }}>
            {DEADLINE_CATEGORY_LABELS[event.category]} · {formatDueDate(event.eventDate)}
            {event.feeCents !== null && ` · Default fee ${formatCents(event.feeCents)}`}
          </p>
          {event.description && <p style={{ fontSize: 16 }}>{event.description}</p>}
        </div>
        <DeleteEventButton eventId={event.id} title={event.title} />
      </div>

      <div className="info-card" style={{ maxWidth: 460, marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Edit Event Details</h3>
        <form action={updateEventAction}>
          <input type="hidden" name="id" value={event.id} />
          <div className="form-field">
            <label htmlFor="edit-title">Title</label>
            <input id="edit-title" name="title" required defaultValue={event.title} />
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="form-field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="edit-category">Category</label>
              <select id="edit-category" name="category" defaultValue={event.category}>
                {Object.entries(DEADLINE_CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="form-field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="edit-eventDate">Date</label>
              <input id="edit-eventDate" name="eventDate" type="date" required defaultValue={toDateInputValue(event.eventDate)} />
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="edit-fee">Default Fee Per Scout ($, optional)</label>
            <input
              id="edit-fee"
              name="fee"
              type="number"
              min="0"
              step="0.01"
              defaultValue={event.feeCents !== null ? (event.feeCents / 100).toFixed(2) : undefined}
              placeholder="Applied when you register a scout — editable per scout"
            />
          </div>
          <div className="form-field">
            <label htmlFor="edit-description">Description (optional)</label>
            <textarea id="edit-description" name="description" rows={2} defaultValue={event.description ?? ""} />
          </div>
          <button type="submit" className="btn btn-primary">Save Changes</button>
        </form>
      </div>

      {event.registrations.length === 0 ? (
        <div className="info-card" style={{ marginBottom: 24 }}>
          <p style={{ marginBottom: 0 }}>No scouts registered yet.</p>
        </div>
      ) : (
        <table className="data-table" style={{ marginBottom: 32 }}>
          <thead>
            <tr>
              <th>Scout</th>
              <th>Den</th>
              <th>Paid</th>
              <th>Remaining</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {event.registrations.map((reg) => {
              const status =
                reg.remainingCents <= 0
                  ? { label: reg.remainingCents < 0 ? "Overpaid" : "Paid in Full", cls: "badge-attendance" }
                  : reg.paidCents > 0
                  ? { label: "Partial", cls: "badge-junior" }
                  : { label: "Unpaid", cls: "badge-photographer" };
              return (
                <tr key={reg.id}>
                  <td>{reg.scout.firstName} {reg.scout.lastName}</td>
                  <td>{denDisplayName(reg.scout.den.rank, reg.scout.den.scoutingYear, reg.scout.den.label)}</td>
                  <td>{formatCents(reg.paidCents)}</td>
                  <td>{formatCents(reg.remainingCents)}</td>
                  <td><span className={`badge-pill ${status.cls}`}>{status.label}</span></td>
                  <td className="actions">
                    <Link
                      className="btn btn-outline btn-small"
                      style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
                      href={`/portal/admin/events/${event.id}/${reg.id}`}
                    >
                      Manage Payments
                    </Link>
                    <form action={removeRegistrationAction}>
                      <input type="hidden" name="registrationId" value={reg.id} />
                      <input type="hidden" name="eventId" value={event.id} />
                      <button
                        type="submit"
                        className="btn btn-outline btn-small"
                        style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}
                      >
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="info-card" style={{ maxWidth: 460 }}>
        <h3 style={{ marginTop: 0 }}>Register Scouts</h3>
        {availableDens.length === 0 ? (
          <p style={{ marginBottom: 0 }}>Every scout is already registered for this event.</p>
        ) : (
          <form action={registerScoutForEventAction}>
            <input type="hidden" name="eventId" value={event.id} />
            <p className="form-note" style={{ marginTop: 0, marginBottom: 8 }}>
              Check every scout signing up — they&apos;ll all get the same amount owed below.
            </p>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
                maxHeight: 260,
                overflowY: "auto",
                marginBottom: 16,
                paddingRight: 4,
              }}
            >
              {availableDens.map(({ den, scouts }) => (
                <div key={den.id}>
                  <p className="form-note" style={{ marginBottom: 6 }}>
                    {denDisplayName(den.rank, den.scoutingYear, den.label).toUpperCase()}
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {scouts.map((scout) => (
                      <label key={scout.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15 }}>
                        <input type="checkbox" name="scoutId" value={scout.id} />
                        {scout.firstName} {scout.lastName}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="form-field">
              <label htmlFor="amountOwed">Amount Owed ($)</label>
              <input
                id="amountOwed"
                name="amountOwed"
                type="number"
                min="0"
                step="0.01"
                required
                defaultValue={event.feeCents !== null ? (event.feeCents / 100).toFixed(2) : undefined}
              />
            </div>
            <button type="submit" className="btn btn-primary">Register Selected Scouts</button>
          </form>
        )}
      </div>
    </>
  );
}
