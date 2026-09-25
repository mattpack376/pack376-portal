import { formatCents } from "@/lib/duesData";
import { formatAuditTooltip } from "@/lib/auditTooltip";
import CollapsibleGroup from "@/components/CollapsibleGroup";
import Linkify from "@/components/Linkify";
import { paymentStatus, paymentRowClass } from "@/lib/paymentStatus";
import {
  DAY_LABELS,
  MEAL_TYPE_LABELS,
  type getOrCreateTripPage,
  type getTripMeals,
  type getTripDutySlots,
  type getTripActivities,
  type getTripRegistrations,
} from "@/lib/tripPageData";

const CARD_WIDTH = 480;

function formatDate(date: Date | null) {
  if (!date) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(
    date,
  );
}

/**
 * Read-only rendering of the trip page — no forms, no buttons, nothing
 * mutable anywhere in this tree. Kept as a completely separate component from
 * the editable admin view rather than threading a "can this role edit" check
 * through every section of that page, so there's no section here that could
 * accidentally end up with a live edit control on it.
 *
 * Two audiences:
 * - "troop" (TRIP_VIEWER, e.g. a shared Troop376 login): per-family detail
 *   (contact info, payment history) for Troop 376 only; Pack 376 is
 *   summarized as totals, no names or contact info, since this login is
 *   shared outside the Pack.
 * - "pack" (Junior Admin): Pack staff, so both Pack and Troop families are
 *   listed in full.
 */
export default function TripViewerView({
  trip,
  meals,
  dutySlots,
  activities,
  registrations,
  audience,
}: {
  audience: "troop" | "pack";
  trip: Awaited<ReturnType<typeof getOrCreateTripPage>>;
  meals: Awaited<ReturnType<typeof getTripMeals>>;
  dutySlots: Awaited<ReturnType<typeof getTripDutySlots>>;
  activities: Awaited<ReturnType<typeof getTripActivities>>;
  registrations: Awaited<ReturnType<typeof getTripRegistrations>>;
}) {
  const totalOwed = registrations.reduce((sum, r) => sum + r.amountOwedCents, 0);
  const totalPaid = registrations.reduce((sum, r) => sum + r.paidCents, 0);
  const totalAdults = registrations.reduce((sum, r) => sum + r.payingCount, 0);
  const totalKids = registrations.reduce((sum, r) => sum + r.freeCount, 0);
  const paidRegistrations = registrations.filter((r) => r.remainingCents <= 0);
  const paidAdults = paidRegistrations.reduce((sum, r) => sum + r.payingCount, 0);
  const paidKids = paidRegistrations.reduce((sum, r) => sum + r.freeCount, 0);

  const troopRegistrations = registrations.filter((r) => r.affiliation === "TROOP");
  const packRegistrations = registrations.filter((r) => r.affiliation === "PACK");
  const packAdults = packRegistrations.reduce((sum, r) => sum + r.payingCount, 0);
  const packKids = packRegistrations.reduce((sum, r) => sum + r.freeCount, 0);
  const packOwed = packRegistrations.reduce((sum, r) => sum + r.amountOwedCents, 0);
  const packPaid = packRegistrations.reduce((sum, r) => sum + r.paidCents, 0);

  const generalDuties = dutySlots.filter((d) => !d.tripMealId);
  const dutyByMeal = new Map<string, typeof dutySlots>();
  for (const duty of dutySlots) {
    if (!duty.tripMealId) continue;
    if (!dutyByMeal.has(duty.tripMealId)) dutyByMeal.set(duty.tripMealId, []);
    dutyByMeal.get(duty.tripMealId)!.push(duty);
  }

  const activityGroups: { day: (typeof activities)[number]["day"]; items: typeof activities }[] = [];
  for (const activity of activities) {
    const lastGroup = activityGroups[activityGroups.length - 1];
    if (lastGroup && lastGroup.day === activity.day) {
      lastGroup.items.push(activity);
    } else {
      activityGroups.push({ day: activity.day, items: [activity] });
    }
  }

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">{audience === "troop" ? "Troop 376 — View Only" : "View Only"}</div>
        <h2>Camp Conron Trip</h2>
        <p>Read-only — questions or changes go through a Pack 376 admin.</p>
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 24 }}>
      <div className="info-card" style={{ flex: "1 1 320px" }}>
        <h3>Headcount</h3>
        <p style={{ marginBottom: 8 }}>
          <strong>Registered:</strong> {totalAdults} adult{totalAdults === 1 ? "" : "s"}, {totalKids} kid
          {totalKids === 1 ? "" : "s"} (4 &amp; under) — {totalAdults + totalKids} total
        </p>
        <p>
          <strong>Paid in Full:</strong> {paidAdults} adult{paidAdults === 1 ? "" : "s"}, {paidKids} kid
          {paidKids === 1 ? "" : "s"} (4 &amp; under) — {paidAdults + paidKids} total
        </p>
      </div>

      <div className="info-card" style={{ flex: "1 1 320px" }}>
        <h3>Money</h3>
        <p style={{ marginBottom: 8 }}>
          <strong>Anticipated Money to be Collected:</strong> {formatCents(totalOwed)}
        </p>
        <p style={{ marginBottom: 8 }}>
          <strong>Collected So Far:</strong> {formatCents(totalPaid)}
        </p>
        <p>
          <strong>Remaining:</strong> {formatCents(totalOwed - totalPaid)}
        </p>
      </div>
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 24 }}>
      <div className="info-card" style={{ flex: "1 1 400px" }}>
        <h3>Event Details</h3>
        <p>
          <strong>{trip.title}</strong>
          {trip.location && <> — {trip.location}</>}
        </p>
        {trip.startDate && trip.endDate && (
          <p>
            {formatDate(trip.startDate)} – {formatDate(trip.endDate)}
          </p>
        )}
        {trip.detailsHtml && <p>{trip.detailsHtml}</p>}
        {trip.flyerUrl && (
          <p style={{ marginBottom: 0 }}>
            <a href={trip.flyerUrl} target="_blank" rel="noopener noreferrer" className="link">
              View flyer →
            </a>
          </p>
        )}
      </div>

      <div className="info-card" style={{ flex: "1 1 400px" }}>
        <h3>Price Structure</h3>
        <p>
          <strong>Regular:</strong> {formatCents(trip.regularPriceCents)}/person
        </p>
        {trip.earlyBirdPriceCents !== null && (
          <p>
            <strong>Early-Bird:</strong> {formatCents(trip.earlyBirdPriceCents)}/person
            {trip.earlyBirdDeadline && ` if paid in full by ${formatDate(trip.earlyBirdDeadline)}`}
          </p>
        )}
        {trip.freeAgeAndUnder !== null && (
          <p>
            Age {trip.freeAgeAndUnder} and under: <strong>free</strong>
          </p>
        )}
        {trip.rsvpDeadline && <p style={{ marginBottom: 0 }}>RSVP &amp; payment due by {formatDate(trip.rsvpDeadline)}.</p>}
      </div>
      </div>

      <div className="section-head">
        <div className="eyebrow">Weekend Menu</div>
        <h2>Menu</h2>
      </div>
      <div className="info-card" style={{ maxWidth: CARD_WIDTH, marginBottom: 24 }}>
        <div className="table-scroll">
          <table className="data-table" style={{ marginBottom: 0 }}>
            <thead>
              <tr>
                <th>Meal</th>
                <th>Menu</th>
              </tr>
            </thead>
            <tbody>
              {meals.map((meal) => (
                <tr key={meal.id}>
                  <td>
                    {DAY_LABELS[meal.day]} {MEAL_TYPE_LABELS[meal.mealType]}
                  </td>
                  <td>{meal.menuText ? <Linkify text={meal.menuText} /> : "Menu TBD"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 24 }}>
      <div style={{ flex: "1 1 400px" }}>
      <div className="section-head">
        <div className="eyebrow">Weekend Staffing</div>
        <h2>Duty Roster</h2>
      </div>
      <div className="info-card">
        {dutySlots.length === 0 ? (
          <p style={{ marginBottom: 0 }}>Not assigned yet.</p>
        ) : (
          <>
            {meals.map((meal) => {
              const duties = dutyByMeal.get(meal.id);
              if (!duties || duties.length === 0) return null;
              return (
                <div key={meal.id} style={{ marginBottom: 14 }}>
                  <p style={{ fontWeight: 700, marginBottom: 6 }}>
                    {DAY_LABELS[meal.day]} {MEAL_TYPE_LABELS[meal.mealType]}
                  </p>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {duties.map((d) => (
                      <li key={d.id}>
                        <Linkify text={d.label} />
                        {d.assignedName && (
                          <>
                            {" — "}
                            <Linkify text={d.assignedName} />
                          </>
                        )}
                        {d.arriveTime && ` (${d.arriveTime})`}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {generalDuties.length > 0 && (
              <div>
                <p style={{ fontWeight: 700, marginBottom: 6 }}>General Duties</p>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {generalDuties.map((d) => (
                    <li key={d.id}>
                      <Linkify text={d.label} />
                      {d.assignedName && (
                        <>
                          {" — "}
                          <Linkify text={d.assignedName} />
                        </>
                      )}
                      {d.arriveTime && ` (${d.arriveTime})`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
      </div>

      <div style={{ flex: "1 1 400px" }}>
      <div className="section-head">
        <div className="eyebrow">Weekend Itinerary</div>
        <h2>Activities Schedule</h2>
      </div>
      <div className="info-card">
        {activityGroups.length === 0 ? (
          <p style={{ marginBottom: 0 }}>Full schedule coming soon.</p>
        ) : (
          activityGroups.map((group) => (
            <div key={group.day} style={{ marginBottom: 14 }}>
              <p style={{ fontWeight: 700, marginBottom: 6 }}>{DAY_LABELS[group.day]}</p>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {group.items.map((activity) => (
                  <li key={activity.id}>
                    {activity.time && <strong>{activity.time} — </strong>}
                    {activity.title}
                    {activity.description && (
                      <>
                        {" — "}
                        <Linkify text={activity.description} />
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
      </div>
      </div>

      {audience === "pack" && <FamilyDetailSection name="Pack 376" registrations={packRegistrations} />}
      <FamilyDetailSection name="Troop 376" registrations={troopRegistrations} />

      {audience === "troop" && (
      <div className="info-card" style={{ maxWidth: CARD_WIDTH }}>
        <h3>Pack 376 (Summary Only)</h3>
        <p>
          {packRegistrations.length} famil{packRegistrations.length === 1 ? "y" : "ies"} registered — {packAdults} adult
          {packAdults === 1 ? "" : "s"}, {packKids} kid{packKids === 1 ? "" : "s"} · {formatCents(packPaid)} paid of{" "}
          {formatCents(packOwed)} owed.
        </p>
      </div>
      )}
    </>
  );
}

type Registrations = Awaited<ReturnType<typeof getTripRegistrations>>;

/** One affiliation's families, each expandable to its contact info and payment history. */
function FamilyDetailSection({ name, registrations }: { name: string; registrations: Registrations }) {
  const adults = registrations.reduce((sum, r) => sum + r.payingCount, 0);
  const kids = registrations.reduce((sum, r) => sum + r.freeCount, 0);
  const owed = registrations.reduce((sum, r) => sum + r.amountOwedCents, 0);
  const paid = registrations.reduce((sum, r) => sum + r.paidCents, 0);
  const paidInFull = registrations.filter((r) => r.remainingCents <= 0).length;
  // Every mixed text/value line is built as one plain string (not
  // interleaved JSX text/expression children) because this toolchain's JSX
  // transform was observed dropping the space that immediately follows a
  // `{expr}` boundary when that boundary is followed directly by more
  // literal text on the same line — reproducible and confirmed via the
  // rendered DOM's child nodes, not a typo in the source.
  const heading = `${name} Families (${registrations.length})`;
  const summaryHeading = `${name} Summary`;
  const familiesSummary = `${registrations.length} famil${registrations.length === 1 ? "y" : "ies"} — ${adults} adult${
    adults === 1 ? "" : "s"
  }, ${kids} kid${kids === 1 ? "" : "s"} (4 and under)`;
  const paidInFullSummary = `${paidInFull} of ${registrations.length} paid in full`;
  const moneySummary = `Owed ${formatCents(owed)} · Paid ${formatCents(paid)} · Remaining ${formatCents(owed - paid)}`;
  const emptyText = `No ${name} registrations yet.`;

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Registrations</div>
        <h2>{heading}</h2>
      </div>

      <div className="info-card" style={{ maxWidth: CARD_WIDTH, marginBottom: 24 }}>
        <h3>{summaryHeading}</h3>
        <p style={{ marginBottom: 8 }}>{familiesSummary}</p>
        <p style={{ marginBottom: 8 }}>
          {paidInFullSummary}
        </p>
        <p>
          {moneySummary}
        </p>
      </div>

      {registrations.length === 0 ? (
        <div className="info-card" style={{ maxWidth: CARD_WIDTH, marginBottom: 24 }}>
          <p>{emptyText}</p>
        </div>
      ) : (
        <div style={{ marginBottom: 24 }}>
          {registrations.map((reg) => {
            const status = paymentStatus(reg.remainingCents, reg.paidCents);
            return (
              <CollapsibleGroup
                key={reg.id}
                defaultOpen={false}
                labelClassName={paymentRowClass(reg.remainingCents, reg.paidCents)}
                label={`${reg.familyName} · Guest of ${reg.guestOfName} · ${reg.payingCount} paying${
                  reg.freeCount ? `, ${reg.freeCount} free` : ""
                } · ${status.label} (${formatCents(reg.remainingCents)} remaining)`}
              >
                <div className="info-card" style={{ marginTop: 8, maxWidth: CARD_WIDTH }}>
                  <p>
                    {reg.contactEmail}
                    {reg.contactPhone ? ` · ${reg.contactPhone}` : ""} · Registered{" "}
                    {reg.createdAt.toLocaleDateString("en-US", { timeZone: "UTC" })}
                  </p>
                  <p>
                    Owed {formatCents(reg.amountOwedCents)} · Paid {formatCents(reg.paidCents)} · Remaining {formatCents(reg.remainingCents)}
                  </p>
                  {reg.payments.length > 0 && (
                    <div className="table-scroll">
                      <table className="data-table" style={{ marginBottom: 0 }}>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Amount</th>
                            <th>Note</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reg.payments.map((p) => (
                            <tr key={p.id}>
                              <td className="audit-hover" data-audit={formatAuditTooltip("Recorded", p.createdAt, null)}>
                                {p.paidOn.toLocaleDateString("en-US", { timeZone: "UTC" })}
                              </td>
                              <td>{formatCents(p.amountCents)}</td>
                              <td>{p.note || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </CollapsibleGroup>
            );
          })}
        </div>
      )}
    </>
  );
}
