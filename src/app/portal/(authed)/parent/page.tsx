import Link from "next/link";
import { requireParentSession } from "@/lib/authorize";
import { getParentDashboardData } from "@/lib/parentDashboardData";
import { getScoutsAdvancementByIds } from "@/lib/denData";
import { formatCents } from "@/lib/duesData";
import { denDisplayName } from "@/lib/rankConfig";
import { DEADLINE_CATEGORY_LABELS, DEADLINE_CATEGORY_ICONS, formatDueDate } from "@/lib/deadlineCategories";
import { getPublicBaseUrl } from "@/lib/appUrl";
import ScoutChecklist from "@/components/ScoutChecklist";

export default async function ParentDashboardPage() {
  const session = await requireParentSession();
  const [{ scouts, nextMeeting, announcements, deadlines, volunteerNeeds, eventBalances }, advancement] =
    await Promise.all([
      getParentDashboardData(session.scoutIds),
      getScoutsAdvancementByIds(session.scoutIds),
    ]);

  const scoutNames = scouts.map((s) => s.firstName).join(" & ") || null;
  const showScoutNameOnEvents = scouts.length > 1;

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Parent Dashboard</div>
        <h2>Welcome, {session.displayName}</h2>
        <p>
          {scouts.length === 0
            ? "No scouts are linked to your account yet — contact an admin if that doesn't look right."
            : `Following ${scoutNames} — ${scouts
                .map((s) => denDisplayName(s.den.rank, s.den.scoutingYear, s.den.label))
                .join(", ")}.`}
        </p>
      </div>

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
          <p style={{ marginBottom: 0 }}>Nothing on the calendar right now — check Parent Resources for the full pack calendar.</p>
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
        <div className="eyebrow">Per Scout</div>
        <h2>Forms &amp; Dues</h2>
      </div>
      {scouts.length === 0 ? (
        <div className="info-card" style={{ marginBottom: 32 }}>
          <p style={{ marginBottom: 0 }}>Nothing to show until a scout is linked to your account.</p>
        </div>
      ) : (
        scouts.map((scout) => (
          <div className="info-card" key={scout.id} style={{ marginBottom: 20 }}>
            <h3 style={{ marginTop: 0 }}>{scout.firstName} {scout.lastName}</h3>

            <p className="form-note" style={{ marginBottom: 6 }}>FORMS</p>
            {scout.photoConsent === null ? (
              <p>No forms pending — your den leader will send a link if one is needed.</p>
            ) : scout.photoConsent.needsSignature ? (
              <p>
                <span className="badge-pill badge-pending" style={{ marginRight: 8 }}>Action Needed</span>
                <Link href={`/consent/${scout.photoConsent.token}`} className="link" style={{ fontWeight: 700 }}>
                  Fill Out Photo Consent Form →
                </Link>
              </p>
            ) : (
              <p><span className="badge-pill badge-consent">Complete</span> Photo consent form on file.</p>
            )}

            <p className="form-note" style={{ marginTop: 14, marginBottom: 6 }}>ANNUAL DUES</p>
            {!scout.dues || scout.dues.amountCents === null ? (
              <p style={{ marginBottom: 0 }}>Dues amount for this scouting year hasn&apos;t been set yet.</p>
            ) : scout.dues.remainingCents !== null && scout.dues.remainingCents <= 0 ? (
              <p style={{ marginBottom: 0 }}>
                <span className="badge-pill badge-attendance" style={{ marginRight: 8 }}>Paid in Full</span>
                {formatCents(scout.dues.paidCents)} paid.
              </p>
            ) : (
              <p style={{ marginBottom: 0 }}>
                <span className="badge-pill badge-pending" style={{ marginRight: 8 }}>
                  {formatCents(scout.dues.remainingCents ?? 0)} Due
                </span>
                {formatCents(scout.dues.paidCents)} of {formatCents(scout.dues.amountCents)} paid so far — see the
                Committee Treasurer or Committee Chair to make a payment.
              </p>
            )}
          </div>
        ))
      )}

      <div className="section-head">
        <div className="eyebrow">Per Scout</div>
        <h2>🏅 Advancement Progress</h2>
      </div>
      {advancement.length === 0 ? (
        <div className="info-card" style={{ marginBottom: 32 }}>
          <p style={{ marginBottom: 0 }}>Nothing to show until a scout is linked to your account.</p>
        </div>
      ) : (
        <div style={{ marginBottom: 32 }}>
          <ScoutChecklist scouts={advancement} editable={false} />
        </div>
      )}

      <div className="section-head">
        <div className="eyebrow">Per Event</div>
        <h2>💳 Event Payments</h2>
      </div>
      {eventBalances.length === 0 ? (
        <div className="info-card" style={{ marginBottom: 32 }}>
          <p style={{ marginBottom: 0 }}>No paid events on the books for your scout(s) right now.</p>
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
                      {DEADLINE_CATEGORY_LABELS[reg.event.category].toUpperCase()} · {formatDueDate(reg.event.eventDate)}
                      {showScoutNameOnEvents && ` · ${reg.scoutFirstName}`}
                    </p>
                    <p style={{ marginBottom: 0, fontWeight: 700, color: "var(--scout-blue-dark)" }}>{reg.event.title}</p>
                  </div>
                  <span className={`badge-pill ${status.cls}`}>{status.label}</span>
                </div>
                <p style={{ marginTop: 8, marginBottom: 0 }}>
                  {formatCents(reg.paidCents)} of {formatCents(reg.amountOwedCents)} paid
                  {reg.remainingCents > 0 && ` — ${formatCents(reg.remainingCents)} remaining`}
                  {reg.remainingCents > 0 && " — see the Committee Treasurer or Committee Chair to make a payment."}
                </p>
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
          <p style={{ marginBottom: 12 }}>No open volunteer needs posted right now.</p>
          <a
            className="btn btn-outline"
            href={`${getPublicBaseUrl()}/volunteer`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
          >
            See Volunteer Roles
          </a>
        </div>
      ) : (
        <div className="resource-grid">
          {volunteerNeeds.map((need) => (
            <div className="resource-card" key={need.id}>
              <div className="icon-badge">🙋</div>
              <div>
                <h3>{need.title}</h3>
                {need.description && <p>{need.description}</p>}
                <a href={`${getPublicBaseUrl()}/volunteer`} target="_blank" rel="noopener noreferrer" className="link">Volunteer With Us →</a>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
