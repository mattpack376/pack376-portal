import { formatCents } from "@/lib/duesData";
import { formatAuditTooltip } from "@/lib/auditTooltip";
import CollapsibleGroup from "@/components/CollapsibleGroup";
import { paymentStatus } from "@/lib/paymentStatus";
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
 * Read-only rendering for TRIP_VIEWER logins (e.g. a shared Troop376
 * account) — no forms, no buttons, nothing mutable anywhere in this tree.
 * Kept as a completely separate component from the editable admin view
 * rather than threading a third "can this role edit" check through every
 * section of that page, so there's no section here that could accidentally
 * end up with a live edit control on it.
 *
 * Per-family registration detail (contact info, payment history) is shown
 * for Troop 376 only; Pack 376 registrations are summarized as pack-wide
 * totals only, no names or contact info, since this login is shared outside
 * the Pack.
 */
export default function TripViewerView({
  trip,
  meals,
  dutySlots,
  activities,
  registrations,
}: {
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
  const troopAdults = troopRegistrations.reduce((sum, r) => sum + r.payingCount, 0);
  const troopKids = troopRegistrations.reduce((sum, r) => sum + r.freeCount, 0);
  const troopOwed = troopRegistrations.reduce((sum, r) => sum + r.amountOwedCents, 0);
  const troopPaid = troopRegistrations.reduce((sum, r) => sum + r.paidCents, 0);
  const troopPaidInFull = troopRegistrations.filter((r) => r.remainingCents <= 0).length;
  const troopAdultsLabel = `${troopAdults} adult${troopAdults === 1 ? "" : "s"}`;
  const troopKidsLabel = `${troopKids} kid${troopKids === 1 ? "" : "s"}`;
  // Built as one plain string (not interleaved JSX text/expression children)
  // because this toolchain's JSX transform was observed dropping the space
  // that immediately follows a `{expr}` boundary when that boundary is
  // followed directly by more literal text on the same line — reproducible
  // and confirmed via the rendered DOM's child nodes, not a typo in the
  // source. Safest fix is avoiding the adjacency entirely.
  const troopFamiliesSummary = `${troopRegistrations.length} famil${troopRegistrations.length === 1 ? "y" : "ies"} — ${troopAdultsLabel}, ${troopKidsLabel} (4 and under)`;

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
        <div className="eyebrow">Troop 376 — View Only</div>
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
                  <td>{meal.menuText || "Menu TBD"}</td>
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
                        {d.label}
                        {d.assignedName && ` — ${d.assignedName}`}
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
                      {d.label}
                      {d.assignedName && ` — ${d.assignedName}`}
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
                    {activity.description && ` — ${activity.description}`}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
      </div>
      </div>

      <div className="section-head">
        <div className="eyebrow">Registrations</div>
        <h2>Troop 376 Families ({troopRegistrations.length})</h2>
      </div>

      <div className="info-card" style={{ maxWidth: CARD_WIDTH, marginBottom: 24 }}>
        <h3>Troop 376 Summary</h3>
        <p style={{ marginBottom: 8 }}>{troopFamiliesSummary}</p>
        <p style={{ marginBottom: 8 }}>
          {troopPaidInFull} of {troopRegistrations.length} paid in full
        </p>
        <p>
          Owed {formatCents(troopOwed)} · Paid {formatCents(troopPaid)} · Remaining {formatCents(troopOwed - troopPaid)}
        </p>
      </div>

      {troopRegistrations.length === 0 ? (
        <div className="info-card" style={{ maxWidth: CARD_WIDTH, marginBottom: 24 }}>
          <p>No Troop 376 registrations yet.</p>
        </div>
      ) : (
        <div style={{ marginBottom: 24 }}>
          {troopRegistrations.map((reg) => {
            const status = paymentStatus(reg.remainingCents, reg.paidCents);
            return (
              <CollapsibleGroup
                key={reg.id}
                defaultOpen={false}
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

      <div className="info-card" style={{ maxWidth: CARD_WIDTH }}>
        <h3>Pack 376 (Summary Only)</h3>
        <p>
          {packRegistrations.length} famil{packRegistrations.length === 1 ? "y" : "ies"} registered — {packAdults} adult
          {packAdults === 1 ? "" : "s"}, {packKids} kid{packKids === 1 ? "" : "s"} · {formatCents(packPaid)} paid of{" "}
          {formatCents(packOwed)} owed.
        </p>
      </div>
    </>
  );
}
