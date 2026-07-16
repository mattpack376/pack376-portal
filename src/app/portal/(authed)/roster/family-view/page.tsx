import Link from "next/link";
import { requireParentContactsSession } from "@/lib/authorize";
import { getParentDashboardData } from "@/lib/parentDashboardData";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/duesData";
import { denDisplayName } from "@/lib/rankConfig";
import { DEADLINE_CATEGORY_LABELS, DEADLINE_CATEGORY_ICONS, formatDueDate } from "@/lib/deadlineCategories";
import { getPublicBaseUrl } from "@/lib/appUrl";
import DenSwitcher from "@/components/DenSwitcher";

export default async function FamilyViewPage({
  searchParams,
}: {
  searchParams: Promise<{ denId?: string }>;
}) {
  const session = await requireParentContactsSession();
  const canRecordPayments = session.role === "ADMIN" || session.role === "DEN";
  const isDenScoped = session.role === "DEN";

  if (isDenScoped && session.denIds.length === 0) {
    return <div className="info-card">You don&apos;t have a den assigned yet. Contact an admin.</div>;
  }

  const { denId: requestedDenId } = await searchParams;
  const denId = isDenScoped
    ? requestedDenId && session.denIds.includes(requestedDenId)
      ? requestedDenId
      : session.denIds[0]
    : undefined;

  const den = denId ? await prisma.den.findUnique({ where: { id: denId }, include: { scouts: { select: { id: true } } } }) : null;
  if (denId && !den) {
    return <div className="info-card">Your den could not be found. Contact an admin.</div>;
  }

  const scoutIds = den ? den.scouts.map((s) => s.id) : (await prisma.scout.findMany({ select: { id: true } })).map((s) => s.id);
  const { nextMeeting, announcements, deadlines, volunteerNeeds, eventBalances } = await getParentDashboardData(scoutIds);

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">
          <Link href="/portal/roster">← Roster</Link>
        </div>
        <h2>Family View</h2>
        <p style={{ fontSize: 17 }}>
          {den
            ? `What families in ${denDisplayName(den.rank, den.scoutingYear, den.label)} see on their Parent Dashboard`
            : "What families see on their Parent Dashboard"}{" "}
          — dues and consent forms aren&apos;t shown here since those aren&apos;t applicable to this view.
        </p>
      </div>

      {isDenScoped && <DenSwitcher denIds={session.denIds} currentDenId={denId!} basePath="/portal/roster/family-view" />}

      <div className="two-col" style={{ marginBottom: 32 }}>
        <div className="info-card">
          <h3 style={{ marginTop: 0 }}>🗓️ Next Meeting</h3>
          {nextMeeting ? (
            <p style={{ fontSize: 18, fontWeight: 700, color: "var(--scout-blue-dark)" }}>{nextMeeting.formatted}</p>
          ) : (
            <p>No meeting date on the calendar yet.</p>
          )}
          <p className="form-note">Weekly meetings — Fridays, 7:00–9:30 PM, Veltri Hall, Our Lady of Grace.</p>
        </div>

        <div className="info-card">
          <h3 style={{ marginTop: 0 }}>📣 Announcements</h3>
          {announcements.length === 0 ? (
            <p>No announcements right now — check back soon.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {announcements.map((a) => (
                <div key={a.id}>
                  <p style={{ marginBottom: 2, fontWeight: 700, color: "var(--scout-blue-dark)" }}>
                    {a.pinned && "📌 "}
                    {a.title}
                  </p>
                  <p style={{ marginBottom: 0, fontSize: 14 }}>{a.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="section-head">
        <div className="eyebrow">Mark Your Calendar</div>
        <h2>Upcoming Deadlines</h2>
      </div>
      {deadlines.length === 0 ? (
        <div className="info-card" style={{ marginBottom: 32 }}>
          <p style={{ marginBottom: 0 }}>Nothing on the calendar right now.</p>
        </div>
      ) : (
        <div className="resource-grid" style={{ marginBottom: 32 }}>
          {deadlines.map((d) => (
            <div className="resource-card" key={d.id}>
              <div className="icon-badge">{DEADLINE_CATEGORY_ICONS[d.category]}</div>
              <div>
                <p className="form-note" style={{ marginBottom: 4 }}>{DEADLINE_CATEGORY_LABELS[d.category].toUpperCase()}</p>
                <h3>{d.title}</h3>
                <p style={{ marginBottom: d.description ? 6 : 0, fontWeight: 700, color: "var(--carnival-red)" }}>
                  Due {formatDueDate(d.dueDate)}
                </p>
                {d.description && <p style={{ marginBottom: 0 }}>{d.description}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-head">
        <div className="eyebrow">Per Event</div>
        <h2>💳 Event Payments</h2>
      </div>
      {eventBalances.length === 0 ? (
        <div className="info-card" style={{ marginBottom: 32 }}>
          <p style={{ marginBottom: 0 }}>No paid events on the books right now.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
          {eventBalances.map((reg) => {
            const status =
              reg.remainingCents <= 0
                ? { label: reg.remainingCents < 0 ? "Overpaid" : "Paid in Full", cls: "badge-attendance" }
                : reg.paidCents > 0
                ? { label: "Partial", cls: "badge-junior" }
                : { label: "Unpaid", cls: "badge-photographer" };
            return (
              <div className="info-card" key={reg.id} style={{ marginBottom: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <div>
                    <p className="form-note" style={{ marginBottom: 4 }}>
                      {DEADLINE_CATEGORY_LABELS[reg.event.category].toUpperCase()} · {formatDueDate(reg.event.eventDate)} · {reg.scoutFirstName}
                    </p>
                    <p style={{ marginBottom: 0, fontWeight: 700, color: "var(--scout-blue-dark)" }}>{reg.event.title}</p>
                  </div>
                  <span className={`badge-pill ${status.cls}`}>{status.label}</span>
                </div>
                <p style={{ marginTop: 8, marginBottom: canRecordPayments ? 8 : 0 }}>
                  {formatCents(reg.paidCents)} of {formatCents(reg.amountOwedCents)} paid
                  {reg.remainingCents > 0 && ` — ${formatCents(reg.remainingCents)} remaining`}
                </p>
                {canRecordPayments && (
                  <Link
                    href={`/portal/admin/events/${reg.event.id}/${reg.id}`}
                    className="btn btn-outline btn-small"
                    style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
                  >
                    Record Payment
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="section-head">
        <div className="eyebrow">Lend a Hand</div>
        <h2>Volunteer Needs</h2>
      </div>
      {volunteerNeeds.length === 0 ? (
        <div className="info-card">
          <p style={{ marginBottom: 0 }}>No open volunteer needs posted right now.</p>
        </div>
      ) : (
        <div className="resource-grid">
          {volunteerNeeds.map((need) => (
            <div className="resource-card" key={need.id}>
              <div className="icon-badge">🙋</div>
              <div>
                <h3>{need.title}</h3>
                {need.description && <p>{need.description}</p>}
                <a href={`${getPublicBaseUrl()}/volunteer`} className="link">Volunteer With Us →</a>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
