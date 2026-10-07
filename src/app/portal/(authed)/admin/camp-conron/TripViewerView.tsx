import { formatCents } from "@/lib/duesData";
import { formatAuditTooltip } from "@/lib/auditTooltip";
import CollapsibleGroup from "@/components/CollapsibleGroup";
import Linkify from "@/components/Linkify";
import TripExpenseList from "@/components/TripExpenseList";
import TripAffiliationSummary from "@/components/TripAffiliationSummary";
import { paymentStatus, paymentRowClass, balanceClass } from "@/lib/paymentStatus";
import {
  DAY_LABELS,
  MEAL_TYPE_LABELS,
  formatTripDate,
  type getOrCreateTripPage,
  type getTripMeals,
  type getTripDutySlots,
  type getTripActivities,
  type getTripRegistrations,
  type getTripExpenses,
} from "@/lib/tripPageData";

const CARD_WIDTH = 480;

/**
 * Read-only rendering of the trip page — no forms, no buttons, nothing
 * mutable anywhere in this tree. Kept as a completely separate component from
 * the editable admin view rather than threading a "can this role edit" check
 * through every section of that page, so there's no section here that could
 * accidentally end up with a live edit control on it.
 *
 * Two audiences:
 * - "troop" (TRIP_VIEWER, e.g. a shared Troop376 login): per-family detail
 *   (contact info, payment history) for Troop 376 only. Money is Troop-only
 *   too — the Money card covers just Troop families, there's no whole-trip
 *   Headcount card, and Pack 376 appears only as a family/headcount summary
 *   with no dollar amounts — since this login is shared outside the Pack.
 * - "pack" (Junior Admin): Pack staff, so both Pack and Troop families are
 *   listed in full.
 *
 * Expenses are Pack-only: the admin page passes `expenses={null}` for the
 * Troop login, which hides the Expenses line, both Available to Spend lines
 * (subtracting either from its total would reveal the expense total), and
 * the expense list.
 */
export default function TripViewerView({
  trip,
  meals,
  dutySlots,
  activities,
  registrations,
  expenses,
  audience,
}: {
  audience: "troop" | "pack";
  trip: Awaited<ReturnType<typeof getOrCreateTripPage>>;
  meals: Awaited<ReturnType<typeof getTripMeals>>;
  dutySlots: Awaited<ReturnType<typeof getTripDutySlots>>;
  activities: Awaited<ReturnType<typeof getTripActivities>>;
  registrations: Awaited<ReturnType<typeof getTripRegistrations>>;
  expenses: Awaited<ReturnType<typeof getTripExpenses>> | null;
}) {
  const totalExpenses = expenses?.reduce((sum, e) => sum + e.amountCents, 0) ?? 0;
  const totalAdults = registrations.reduce((sum, r) => sum + r.payingCount, 0);
  const totalKids = registrations.reduce((sum, r) => sum + r.freeCount, 0);
  const troopRegistrations = registrations.filter((r) => r.affiliation === "TROOP");
  const packRegistrations = registrations.filter((r) => r.affiliation === "PACK");
  const packAdults = packRegistrations.reduce((sum, r) => sum + r.payingCount, 0);
  const packKids = packRegistrations.reduce((sum, r) => sum + r.freeCount, 0);
  // The Troop login's Money card covers Troop families only; see the doc comment.
  const moneyRegistrations = audience === "troop" ? troopRegistrations : registrations;
  const moneyOwed = moneyRegistrations.reduce((sum, r) => sum + r.amountOwedCents, 0);
  const moneyPaid = moneyRegistrations.reduce((sum, r) => sum + r.paidCents, 0);
  const paidRegistrations = registrations.filter((r) => r.remainingCents <= 0);
  const paidAdults = paidRegistrations.reduce((sum, r) => sum + r.payingCount, 0);
  const paidKids = paidRegistrations.reduce((sum, r) => sum + r.freeCount, 0);

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
      {audience === "pack" && (
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
      )}

      {/* Alone in this row for the Troop login, so capped rather than stretched full width. */}
      <div className="info-card" style={audience === "troop" ? { flex: "1 1 320px", maxWidth: CARD_WIDTH } : { flex: "1 1 320px" }}>
        <h3>{audience === "troop" ? "Money — Troop 376 Families" : "Money"}</h3>
        <p style={{ marginBottom: 8 }}>
          <strong>Anticipated Money to be Collected:</strong> {formatCents(moneyOwed)}
        </p>
        <p style={{ marginBottom: 8 }}>
          <strong>Collected So Far:</strong> {formatCents(moneyPaid)}
        </p>
        <p
          className={moneyOwed - moneyPaid > 0 ? "balance-negative" : undefined}
          style={expenses ? { marginBottom: 8 } : undefined}
        >
          <strong>Outstanding Payments:</strong> {formatCents(moneyOwed - moneyPaid)}
        </p>
        {expenses && (
          <>
            <p style={{ marginBottom: 8 }}>
              <strong>Expenses:</strong> {formatCents(totalExpenses)}
            </p>
            <p className={balanceClass(moneyPaid - totalExpenses)} style={{ marginBottom: 8 }}>
              <strong>Available to Spend (Collected So Far):</strong> {formatCents(moneyPaid - totalExpenses)}
            </p>
            <p className={balanceClass(moneyOwed - totalExpenses)}>
              <strong>Available to Spend (Everyone Paid in Full):</strong> {formatCents(moneyOwed - totalExpenses)}
            </p>
          </>
        )}
      </div>
      </div>

      {expenses && (
        <div style={{ marginBottom: 24 }}>
          <CollapsibleGroup
            label={`Expenses — ${formatCents(totalExpenses)} (${expenses.length} item${expenses.length === 1 ? "" : "s"})`}
          >
            <div className="info-card" style={{ marginTop: 8 }}>
              {expenses.length === 0 ? (
                <p>No expenses recorded yet.</p>
              ) : (
                <TripExpenseList expenses={expenses} />
              )}
            </div>
          </CollapsibleGroup>
        </div>
      )}

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 24 }}>
      <div className="info-card" style={{ flex: "1 1 400px" }}>
        <h3>Event Details</h3>
        <p>
          <strong>{trip.title}</strong>
          {trip.location && <> — {trip.location}</>}
        </p>
        {trip.startDate && trip.endDate && (
          <p>
            {formatTripDate(trip.startDate)} – {formatTripDate(trip.endDate)}
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
            {trip.earlyBirdDeadline && ` if paid in full by ${formatTripDate(trip.earlyBirdDeadline)}`}
          </p>
        )}
        {trip.freeAgeAndUnder !== null && (
          <p>
            Age {trip.freeAgeAndUnder} and under: <strong>free</strong>
          </p>
        )}
        {trip.rsvpDeadline && <p style={{ marginBottom: 0 }}>RSVP &amp; payment due by {formatTripDate(trip.rsvpDeadline)}.</p>}
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
                  <td data-label="Menu">{meal.menuText ? <Linkify text={meal.menuText} /> : "Menu TBD"}</td>
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
          {`${packRegistrations.length} famil${packRegistrations.length === 1 ? "y" : "ies"} registered — ${packAdults} adult${
            packAdults === 1 ? "" : "s"
          }, ${packKids} kid${packKids === 1 ? "" : "s"} (4 & under).`}
        </p>
      </div>
      )}
    </>
  );
}

type Registrations = Awaited<ReturnType<typeof getTripRegistrations>>;

/** One affiliation's families, each expandable to its contact info and payment history. */
function FamilyDetailSection({ name, registrations }: { name: string; registrations: Registrations }) {
  // Built as plain strings for the same JSX-whitespace reason noted in
  // TripAffiliationSummary.
  const heading = `${name} Families (${registrations.length})`;
  const emptyText = `No ${name} registrations yet.`;

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Registrations</div>
        <h2>{heading}</h2>
      </div>

      <TripAffiliationSummary name={name} registrations={registrations} style={{ maxWidth: CARD_WIDTH, marginBottom: 24 }} />

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
                              <td data-label="Amount">{formatCents(p.amountCents)}</td>
                              <td data-label="Note">{p.note || "—"}</td>
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
