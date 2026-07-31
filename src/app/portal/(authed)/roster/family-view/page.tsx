import Link from "next/link";
import { requireParentContactsSession } from "@/lib/authorize";
import { getParentDashboardData } from "@/lib/parentDashboardData";
import { getAllGuestGroups, getOpenEventsForSelfRegistration } from "@/lib/eventsData";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/duesData";
import { RANK_ORDER, denDisplayName } from "@/lib/rankConfig";
import type { Rank } from "@/generated/prisma/enums";
import { DEADLINE_CATEGORY_LABELS, DEADLINE_CATEGORY_ICONS, formatDueDate } from "@/lib/deadlineCategories";
import { getPublicBaseUrl } from "@/lib/appUrl";
import DenSwitcher from "@/components/DenSwitcher";
import CollapsibleGroup from "@/components/CollapsibleGroup";
import SortableColumnHeader from "@/components/SortableColumnHeader";
import { sortGuestGroups } from "@/lib/guestSort";
import { registerMyGuestGroupForEventAction, removeMyGuestGroupAction } from "@/lib/actions/events";

export default async function FamilyViewPage({
  searchParams,
}: {
  searchParams: Promise<{ denId?: string; guestSort?: string }>;
}) {
  const session = await requireParentContactsSession();
  const canRecordPayments = session.role === "ADMIN" || session.role === "DEN";
  // Junior admins can see guest groups (read-only, same as they already see
  // scout registrations) but can't record payments or self-register guests.
  const canViewGuestGroups = canRecordPayments || session.role === "JUNIOR_ADMIN";
  const isDenScoped = session.role === "DEN";

  if (isDenScoped && session.denIds.length === 0) {
    return <div className="info-card">You don&apos;t have a den assigned yet. Contact an admin.</div>;
  }

  const { denId: requestedDenId, guestSort } = await searchParams;
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
  const { scouts, nextMeeting, announcements, deadlines, volunteerNeeds, eventBalances } = await getParentDashboardData(
    scoutIds,
    session.userId,
  );

  const [rawGuestGroups, myOpenGuestEvents] = await Promise.all([
    canViewGuestGroups ? getAllGuestGroups() : Promise.resolve([]),
    canRecordPayments ? getOpenEventsForSelfRegistration([], session.userId) : Promise.resolve([]),
  ]);
  // Guest groups aren't tied to a den, so unlike scout registrations they
  // can't be scoped by session.denIds — a den login only sees groups it
  // self-registered (matches assertGuestGroupAccess's write-side scoping in
  // src/lib/authorize.ts). Admin/junior admin keep the pack-wide view they
  // already have everywhere else.
  const allGuestGroups = isDenScoped ? rawGuestGroups.filter((g) => g.addedByUserId === session.userId) : rawGuestGroups;
  const openGuestEvents = myOpenGuestEvents.filter((e) => e.adultFeeCents !== null || e.guestChildFeeCents !== null);

  const scoutInfoById = new Map(scouts.map((s) => [s.id, s]));
  type Den = (typeof scouts)[number]["den"];
  type ScoutBalance = (typeof eventBalances)[number];
  type GuestGroupBalance = (typeof allGuestGroups)[number];

  function sortDens<T extends { den: Den | null }>(groups: T[]) {
    return groups.sort((a, b) => {
      if (!a.den) return 1;
      if (!b.den) return -1;
      if (a.den.scoutingYear !== b.den.scoutingYear) return b.den.scoutingYear.localeCompare(a.den.scoutingYear);
      return RANK_ORDER.indexOf(a.den.rank as Rank) - RANK_ORDER.indexOf(b.den.rank as Rank);
    });
  }

  // Event -> Den -> scouts, plus that event's guest groups — so an
  // admin/den leader scans one event at a time instead of a wall of boxes
  // mixing every event and every kid together.
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
  for (const group of allGuestGroups) {
    if (!eventGroupsById.has(group.event.id)) {
      eventGroupsById.set(group.event.id, { event: group.event, denGroups: new Map(), guestGroups: [] });
    }
    eventGroupsById.get(group.event.id)!.guestGroups.push(group);
  }

  const eventPaymentGroups = Array.from(eventGroupsById.values())
    .sort((a, b) => a.event.eventDate.getTime() - b.event.eventDate.getTime())
    .map((group) => {
      const denGroups = sortDens(Array.from(group.denGroups.values()));
      for (const denGroup of denGroups) {
        denGroup.regs.sort((a, b) => {
          const scoutA = scoutInfoById.get(a.scoutId);
          const scoutB = scoutInfoById.get(b.scoutId);
          const lastCmp = (scoutA?.lastName ?? "").localeCompare(scoutB?.lastName ?? "");
          if (lastCmp !== 0) return lastCmp;
          return (scoutA?.firstName ?? "").localeCompare(scoutB?.firstName ?? "");
        });
      }
      return { event: group.event, denGroups, guestGroups: sortGuestGroups(group.guestGroups, guestSort) };
    });

  const guestSortHref = (key: string) => {
    const qs = new URLSearchParams();
    if (denId) qs.set("denId", denId);
    qs.set("guestSort", key);
    return `/portal/roster/family-view?${qs.toString()}`;
  };

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
        <div className="eyebrow">Lend a Hand</div>
        <h2>Volunteer Needs</h2>
      </div>
      {volunteerNeeds.length === 0 ? (
        <div className="info-card" style={{ marginBottom: 32 }}>
          <p style={{ marginBottom: 0 }}>No open volunteer needs posted right now.</p>
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
      {eventPaymentGroups.length === 0 ? (
        <div className="info-card" style={{ marginBottom: 32 }}>
          <p style={{ marginBottom: 0 }}>No paid events on the books right now.</p>
        </div>
      ) : (
        <div style={{ marginBottom: 32 }}>
          {eventPaymentGroups.map(({ event, denGroups, guestGroups }) => (
            <details className="info-card" key={event.id} style={{ marginBottom: 20 }}>
              <summary className="event-toggle">
                <p className="form-note" style={{ marginBottom: 4 }}>
                  {DEADLINE_CATEGORY_LABELS[event.category].toUpperCase()} · {formatDueDate(event.eventDate)}
                </p>
                <h3 style={{ marginTop: 0, marginBottom: 0 }}>{event.title}</h3>
              </summary>

              <div style={{ marginTop: 14 }}>
              {denGroups.map(({ den, regs }) => (
                <CollapsibleGroup
                  key={den?.id ?? "none"}
                  label={`${den ? denDisplayName(den.rank, den.scoutingYear, den.label) : "No Den Assigned"} (${regs.length})`}
                >
                  <table className="data-table" style={{ marginBottom: 0 }}>
                    <thead>
                      <tr>
                        <th>Scout</th>
                        <th>Paid</th>
                        <th>Remaining</th>
                        <th>Status</th>
                        {canRecordPayments && <th></th>}
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
                            {canRecordPayments && (
                              <td className="actions">
                                <Link
                                  className="btn btn-outline btn-small"
                                  style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
                                  href={`/portal/admin/events/${event.id}/${reg.id}`}
                                >
                                  Record Payment
                                </Link>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CollapsibleGroup>
              ))}

              {guestGroups.length > 0 && (
                <div>
                  <p className="form-note" style={{ marginBottom: 6 }}>GUEST GROUPS</p>
                  <table className="data-table" style={{ marginBottom: 0 }}>
                    <thead>
                      <tr>
                        <SortableColumnHeader href={guestSortHref("family")} label="Family Name / Guest Name" active={guestSort === "family"} />
                        <SortableColumnHeader href={guestSortHref("guestof")} label="Guest Of" active={guestSort === "guestof"} />
                        <th>Adults</th>
                        <th>Kids</th>
                        <th>Paid</th>
                        <th>Remaining</th>
                        <th>Status</th>
                        {canRecordPayments && <th></th>}
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
                            <td>{group.guestOfLabel ?? "—"}</td>
                            <td>{group.adultCount}</td>
                            <td>{group.childCount}</td>
                            <td>{formatCents(group.paidCents)}</td>
                            <td>{formatCents(group.remainingCents)}</td>
                            <td><span className={`badge-pill ${status.cls}`}>{status.label}</span></td>
                            {canRecordPayments && (
                              <td className="actions">
                                <Link
                                  className="btn btn-outline btn-small"
                                  style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
                                  href={`/portal/admin/events/${event.id}/guests/${group.id}`}
                                >
                                  Record Payment
                                </Link>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              </div>
            </details>
          ))}
        </div>
      )}

      {canRecordPayments && (
        <>
          <div className="section-head">
            <div className="eyebrow">Sign Up</div>
            <h2>Register Yourself &amp; Guests for an Event</h2>
          </div>
          {openGuestEvents.length === 0 ? (
            <div className="info-card">
              <p style={{ marginBottom: 0 }}>No upcoming events open for guest self-registration right now.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {openGuestEvents.map((event) => (
                <div className="info-card" key={event.id} style={{ marginBottom: 0 }}>
                  <p className="form-note" style={{ marginBottom: 4 }}>
                    {DEADLINE_CATEGORY_LABELS[event.category].toUpperCase()} · {formatDueDate(event.eventDate)}
                    {event.adultFeeCents !== null && ` · ${formatCents(event.adultFeeCents)} per adult`}
                    {event.guestChildFeeCents !== null && ` · ${formatCents(event.guestChildFeeCents)} per guest child`}
                  </p>
                  <p style={{ marginBottom: event.description ? 6 : 10, fontWeight: 700, color: "var(--scout-blue-dark)" }}>{event.title}</p>
                  {event.description && <p style={{ marginBottom: 10 }}>{event.description}</p>}

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
                      <label htmlFor={`familyName-${event.id}`}>Family Name / Guest Name</label>
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
                    <button type="submit" className="btn btn-primary btn-small">Register</button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
