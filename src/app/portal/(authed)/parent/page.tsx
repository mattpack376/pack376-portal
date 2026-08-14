import Link from "next/link";
import { requireParentSession } from "@/lib/authorize";
import { getParentDashboardData } from "@/lib/parentDashboardData";
import { getScoutsAdvancementByIds } from "@/lib/denData";
import { formatCents } from "@/lib/duesData";
import { RANK_ORDER, denDisplayName } from "@/lib/rankConfig";
import { DEADLINE_CATEGORY_LABELS, DEADLINE_CATEGORY_ICONS, formatDueDate } from "@/lib/deadlineCategories";
import { getPublicBaseUrl } from "@/lib/appUrl";
import ScoutChecklist from "@/components/ScoutChecklist";
import CollapsibleGroup from "@/components/CollapsibleGroup";
import PaymentInstructionsCard from "@/components/PaymentInstructionsCard";
import EventFlyer from "@/components/EventFlyer";
import {
  registerMyScoutsForEventAction,
  registerMyGuestGroupForEventAction,
  removeMyGuestGroupAction,
} from "@/lib/actions/events";
import type { Rank } from "@/generated/prisma/enums";

export default async function ParentDashboardPage() {
  const session = await requireParentSession();
  const [
    {
      scouts,
      nextMeeting,
      announcements,
      deadlines,
      volunteerNeeds,
      eventBalances,
      guestGroupBalances,
      openEvents,
      upcomingEvents,
    },
    advancement,
  ] = await Promise.all([
    getParentDashboardData(session.scoutIds, session.userId),
    getScoutsAdvancementByIds(session.scoutIds),
  ]);

  const scoutNames = scouts.map((s) => s.firstName).join(" & ") || null;

  // Event -> Den -> scouts, plus that event's guest groups — one card per
  // event instead of a flat list mixing every scout and guest together,
  // same layout as the admin/den leader Family View.
  type Den = (typeof scouts)[number]["den"];
  type ScoutBalance = (typeof eventBalances)[number];
  type GuestGroupBalance = (typeof guestGroupBalances)[number];
  const scoutInfoById = new Map(scouts.map((s) => [s.id, s]));

  const eventGroupsById = new Map<
    string,
    { event: ScoutBalance["event"]; denGroups: Map<string, { den: Den | null; regs: ScoutBalance[] }>; guestGroups: GuestGroupBalance[] }
  >();
  for (const reg of eventBalances) {
    if (!eventGroupsById.has(reg.event.id)) {
      eventGroupsById.set(reg.event.id, { event: reg.event, denGroups: new Map(), guestGroups: [] });
    }
    const entry = eventGroupsById.get(reg.event.id)!;
    const scout = scoutInfoById.get(reg.scoutId);
    const denKey = scout?.den?.id ?? "none";
    if (!entry.denGroups.has(denKey)) entry.denGroups.set(denKey, { den: scout?.den ?? null, regs: [] });
    entry.denGroups.get(denKey)!.regs.push(reg);
  }
  for (const group of guestGroupBalances) {
    if (!eventGroupsById.has(group.event.id)) {
      eventGroupsById.set(group.event.id, { event: group.event, denGroups: new Map(), guestGroups: [] });
    }
    eventGroupsById.get(group.event.id)!.guestGroups.push(group);
  }

  const eventPaymentGroups = Array.from(eventGroupsById.values())
    .sort((a, b) => a.event.eventDate.getTime() - b.event.eventDate.getTime())
    .map((group) => {
      const denGroups = Array.from(group.denGroups.values()).sort((a, b) => {
        if (!a.den) return 1;
        if (!b.den) return -1;
        if (a.den.scoutingYear !== b.den.scoutingYear) return b.den.scoutingYear.localeCompare(a.den.scoutingYear);
        return RANK_ORDER.indexOf(a.den.rank as Rank) - RANK_ORDER.indexOf(b.den.rank as Rank);
      });
      for (const denGroup of denGroups) {
        denGroup.regs.sort((a, b) => a.scoutFirstName.localeCompare(b.scoutFirstName));
      }
      return { event: group.event, denGroups, guestGroups: group.guestGroups };
    });

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

        <PaymentInstructionsCard />
      </div>

      <div className="section-head">
        <div className="eyebrow">What&apos;s Coming Up</div>
        <h2>🎉 Upcoming Events</h2>
      </div>
      {upcomingEvents.length === 0 ? (
        <div className="info-card" style={{ marginBottom: 32 }}>
          <p style={{ marginBottom: 0 }}>No upcoming events posted right now.</p>
        </div>
      ) : (
        <div className="resource-grid" style={{ marginBottom: 32 }}>
          {upcomingEvents.map((event) => (
            <div className="resource-card" key={event.id}>
              <div className="icon-badge">{DEADLINE_CATEGORY_ICONS[event.category]}</div>
              <div>
                <p className="form-note" style={{ marginBottom: 4 }}>
                  {DEADLINE_CATEGORY_LABELS[event.category].toUpperCase()} · {formatDueDate(event.eventDate)}
                </p>
                <h3>{event.title}</h3>
                {event.description && <p style={{ marginBottom: 10 }}>{event.description}</p>}
                <EventFlyer flyerUrl={event.flyerUrl} title={event.title} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-head">
        <div className="eyebrow">Lend a Hand</div>
        <h2>Volunteer Needs</h2>
      </div>
      {volunteerNeeds.length === 0 ? (
        <div className="info-card" style={{ marginBottom: 32 }}>
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
        <div className="resource-grid" style={{ marginBottom: 32 }}>
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
        <div className="eyebrow">Sign Up</div>
        <h2>🎪 Register for Events</h2>
      </div>
      {openEvents.length === 0 ? (
        <div className="info-card" style={{ marginBottom: 32 }}>
          <p style={{ marginBottom: 0 }}>No upcoming events open for registration right now.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
          {openEvents.map((event) => {
            const unregisteredScouts = scouts.filter((s) => !event.registeredScoutIds.includes(s.id));
            const registeredScouts = scouts.filter((s) => event.registeredScoutIds.includes(s.id));
            const showGuestForm = event.adultFeeCents !== null || event.guestChildFeeCents !== null;
            return (
              <div className="info-card" key={event.id} style={{ marginBottom: 0 }}>
                <p className="form-note" style={{ marginBottom: 4 }}>
                  {DEADLINE_CATEGORY_LABELS[event.category].toUpperCase()} · {formatDueDate(event.eventDate)}
                  {event.feeCents !== null && ` · ${formatCents(event.feeCents)} per scout`}
                  {event.adultFeeCents !== null && ` · ${formatCents(event.adultFeeCents)} per adult`}
                  {event.guestChildFeeCents !== null && ` · ${formatCents(event.guestChildFeeCents)} per guest child`}
                </p>
                <p style={{ marginBottom: event.description ? 6 : 10, fontWeight: 700, color: "var(--scout-blue-dark)" }}>{event.title}</p>
                {event.description && <p style={{ marginBottom: 10 }}>{event.description}</p>}

                {registeredScouts.length > 0 && (
                  <p style={{ marginBottom: 10 }}>
                    <span className="badge-pill badge-attendance" style={{ marginRight: 8 }}>Registered</span>
                    {registeredScouts.map((s) => s.firstName).join(", ")}
                  </p>
                )}
                {event.feeCents !== null && unregisteredScouts.length > 0 && (
                  <form action={registerMyScoutsForEventAction} style={{ marginBottom: showGuestForm ? 14 : 0 }}>
                    <input type="hidden" name="eventId" value={event.id} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                      {unregisteredScouts.map((s) => (
                        <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15 }}>
                          <input type="checkbox" name="scoutId" value={s.id} defaultChecked={unregisteredScouts.length === 1} />
                          {s.firstName} {s.lastName}
                        </label>
                      ))}
                    </div>
                    <button type="submit" className="btn btn-primary btn-small">Register Scout(s)</button>
                  </form>
                )}

                {showGuestForm && (
                  <div>
                    {event.myGuestGroups.length > 0 && (
                      <div style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                        {event.myGuestGroups.map((g) => (
                          <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15 }}>
                            <span className="badge-pill badge-attendance">Registered</span>
                            {g.familyName} — {g.adultCount} adult{g.adultCount === 1 ? "" : "s"}, {g.childCount} kid{g.childCount === 1 ? "" : "s"}
                            <form action={removeMyGuestGroupAction}>
                              <input type="hidden" name="guestGroupId" value={g.id} />
                              <button type="submit" className="btn btn-outline btn-small" style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}>
                                Remove
                              </button>
                            </form>
                          </div>
                        ))}
                      </div>
                    )}
                    <form action={registerMyGuestGroupForEventAction} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                      <input type="hidden" name="eventId" value={event.id} />
                      <div className="form-field" style={{ marginBottom: 0, flex: "1 1 200px" }}>
                        <label htmlFor={`familyName-${event.id}`}>Family Name / Guest Name (guests attending)</label>
                        <input id={`familyName-${event.id}`} name="familyName" required defaultValue={session.displayName} />
                      </div>
                      {event.adultFeeCents !== null && (
                        <div className="form-field" style={{ marginBottom: 0, flex: "1 1 90px" }}>
                          <label htmlFor={`adultCount-${event.id}`}>Adults</label>
                          <input id={`adultCount-${event.id}`} name="adultCount" type="number" min="0" step="1" defaultValue={1} />
                        </div>
                      )}
                      {event.guestChildFeeCents !== null && (
                        <div className="form-field" style={{ marginBottom: 0, flex: "1 1 90px" }}>
                          <label htmlFor={`childCount-${event.id}`}>Kids</label>
                          <input id={`childCount-${event.id}`} name="childCount" type="number" min="0" step="1" defaultValue={0} />
                        </div>
                      )}
                      <button type="submit" className="btn btn-outline btn-small" style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}>
                        Add Guests
                      </button>
                    </form>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="section-head">
        <div className="eyebrow">Per Event</div>
        <h2>💳 Event Payments</h2>
      </div>
      {eventPaymentGroups.length === 0 ? (
        <div className="info-card" style={{ marginBottom: 32 }}>
          <p style={{ marginBottom: 0 }}>No paid events on the books for your scout(s) or any guests you&apos;ve registered right now.</p>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 12 }}>
            {eventPaymentGroups.map(({ event, denGroups, guestGroups }) => (
              <div className="info-card" key={event.id} style={{ marginBottom: 20 }}>
                <p className="form-note" style={{ marginBottom: 4 }}>
                  {DEADLINE_CATEGORY_LABELS[event.category].toUpperCase()} · {formatDueDate(event.eventDate)}
                </p>
                <h3 style={{ marginTop: 0, marginBottom: 14 }}>{event.title}</h3>

                {denGroups.map(({ den, regs }) => (
                  <CollapsibleGroup
                    key={den?.id ?? "none"}
                    label={`${den ? denDisplayName(den.rank, den.scoutingYear, den.label) : "No Den Assigned"} (${regs.length})`}
                  >
                    <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Scout</th>
                          <th>Paid</th>
                          <th>Remaining</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {regs.map((reg) => {
                          const status =
                            reg.remainingCents <= 0
                              ? { label: reg.remainingCents < 0 ? "Overpaid" : "Paid in Full", cls: "badge-attendance" }
                              : reg.paidCents > 0
                              ? { label: "Partial", cls: "badge-junior" }
                              : { label: "Unpaid", cls: "badge-photographer" };
                          return (
                            <tr key={reg.id}>
                              <td>{reg.scoutFirstName}</td>
                              <td>{formatCents(reg.paidCents)}</td>
                              <td>{formatCents(reg.remainingCents)}</td>
                              <td><span className={`badge-pill ${status.cls}`}>{status.label}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                  </CollapsibleGroup>
                ))}

                {guestGroups.length > 0 && (
                  <div>
                    <p className="form-note" style={{ marginBottom: 6 }}>GUEST GROUPS</p>
                    <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Family Name / Guest Name</th>
                          <th>Adults</th>
                          <th>Kids</th>
                          <th>Paid</th>
                          <th>Remaining</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {guestGroups.map((group) => {
                          const status =
                            group.remainingCents <= 0
                              ? { label: group.remainingCents < 0 ? "Overpaid" : "Paid in Full", cls: "badge-attendance" }
                              : group.paidCents > 0
                              ? { label: "Partial", cls: "badge-junior" }
                              : { label: "Unpaid", cls: "badge-photographer" };
                          return (
                            <tr key={group.id}>
                              <td>{group.familyName}</td>
                              <td>{group.adultCount}</td>
                              <td>{group.childCount}</td>
                              <td>{formatCents(group.paidCents)}</td>
                              <td>{formatCents(group.remainingCents)}</td>
                              <td><span className={`badge-pill ${status.cls}`}>{status.label}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="form-note" style={{ marginBottom: 32 }}>
            See the Committee Treasurer or Committee Chair to make a payment on any balance above.
          </p>
        </>
      )}

      <div className="section-head">
        <div className="eyebrow">Per Scout</div>
        <h2>🏅 Advancement Progress</h2>
      </div>
      {advancement.length === 0 ? (
        <div className="info-card">
          <p style={{ marginBottom: 0 }}>Nothing to show until a scout is linked to your account.</p>
        </div>
      ) : (
        <ScoutChecklist scouts={advancement} editable={false} />
      )}
    </>
  );
}
