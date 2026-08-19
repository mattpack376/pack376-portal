import Link from "next/link";
import { requireTripPageSession } from "@/lib/authorize";
import {
  getOrCreateTripPage,
  getTripMeals,
  getTripDutySlots,
  getTripActivities,
  getTripRegistrations,
  currentTripPriceCents,
  CAMP_CONRON_SLUG,
  DAY_LABELS,
  MEAL_TYPE_LABELS,
  TRIP_DAY_ORDER,
} from "@/lib/tripPageData";
import { formatCents } from "@/lib/duesData";
import { formatAuditTooltip } from "@/lib/auditTooltip";
import CollapsibleGroup from "@/components/CollapsibleGroup";
import {
  updateTripDetailsAction,
  updateTripPricingAction,
  updateTripPaymentInstructionsAction,
  updateTripMealsAction,
  createDutySlotAction,
  updateDutySlotAction,
  deleteDutySlotAction,
  createActivityAction,
  updateActivityAction,
  deleteActivityAction,
  toggleTripPublishedAction,
} from "@/lib/actions/tripPage";
import {
  updateTripRegistrationAction,
  addTripPaymentAction,
  deleteTripPaymentAction,
  deleteTripRegistrationAction,
} from "@/lib/actions/tripRegistration";
import TripRegistrationCountFields from "@/components/TripRegistrationCountFields";
import TripViewerView from "./TripViewerView";

function toDateInputValue(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : "";
}

const CARD_WIDTH = 480;

export default async function AdminCampConronPage({
  searchParams,
}: {
  searchParams: Promise<{ affiliation?: string }>;
}) {
  const session = await requireTripPageSession();
  const isAdmin = session.role === "ADMIN";
  const { affiliation: affiliationParam } = await searchParams;
  const affiliationFilter = affiliationParam === "PACK" || affiliationParam === "TROOP" ? affiliationParam : "ALL";

  const trip = await getOrCreateTripPage(CAMP_CONRON_SLUG);
  const [meals, dutySlots, activities, registrations] = await Promise.all([
    getTripMeals(trip.id),
    getTripDutySlots(trip.id),
    getTripActivities(trip.id),
    getTripRegistrations(trip.id),
  ]);

  // TRIP_VIEWER (e.g. a shared Troop376 login) gets a completely separate,
  // form-free read-only render — see TripViewerView.tsx for why this isn't
  // done as inline conditionals throughout the rest of this component.
  if (session.role === "TRIP_VIEWER") {
    return <TripViewerView trip={trip} meals={meals} dutySlots={dutySlots} activities={activities} registrations={registrations} />;
  }

  const priceCents = currentTripPriceCents(trip);
  const totalOwed = registrations.reduce((sum, r) => sum + r.amountOwedCents, 0);
  const totalPaid = registrations.reduce((sum, r) => sum + r.paidCents, 0);

  const totalAdults = registrations.reduce((sum, r) => sum + r.payingCount, 0);
  const totalKids = registrations.reduce((sum, r) => sum + r.freeCount, 0);
  const paidRegistrations = registrations.filter((r) => r.remainingCents <= 0);
  const paidAdults = paidRegistrations.reduce((sum, r) => sum + r.payingCount, 0);
  const paidKids = paidRegistrations.reduce((sum, r) => sum + r.freeCount, 0);

  const visibleRegistrations =
    affiliationFilter === "ALL" ? registrations : registrations.filter((r) => r.affiliation === affiliationFilter);
  const visibleOwed = visibleRegistrations.reduce((sum, r) => sum + r.amountOwedCents, 0);
  const visiblePaid = visibleRegistrations.reduce((sum, r) => sum + r.paidCents, 0);

  return (
    <>
      <div
        className="section-head"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}
      >
        <div>
          <div className="eyebrow">Admin</div>
          <h2>Camp Conron Trip</h2>
          <p>
            Public page at{" "}
            <a href="https://conron.pack376nyc.org" target="_blank" rel="noopener noreferrer" className="link">
              conron.pack376nyc.org
            </a>{" "}
            — no login required for families to view or register.
          </p>
          <span className={`badge-pill ${trip.published ? "badge-attendance" : "badge-pending"}`}>
            {trip.published ? "Live to the public" : "Not published yet"}
          </span>
        </div>
        {isAdmin && (
          <form action={toggleTripPublishedAction}>
            <input type="hidden" name="id" value={trip.id} />
            <input type="hidden" name="published" value={String(trip.published)} />
            <button
              type="submit"
              className="btn btn-outline btn-small"
              style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
            >
              {trip.published ? "Unpublish" : "Publish"}
            </button>
          </form>
        )}
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 24 }}>
        <div className="info-card" style={{ flex: "1 1 320px" }}>
          <h3 style={{ marginTop: 0 }}>Headcount</h3>
          <p style={{ marginBottom: 8 }}>
            <strong>Registered:</strong> {totalAdults} adult{totalAdults === 1 ? "" : "s"}, {totalKids} kid
            {totalKids === 1 ? "" : "s"} (4 &amp; under) — {totalAdults + totalKids} total
          </p>
          <p style={{ marginBottom: 0 }}>
            <strong>Paid in Full:</strong> {paidAdults} adult{paidAdults === 1 ? "" : "s"}, {paidKids} kid
            {paidKids === 1 ? "" : "s"} (4 &amp; under) — {paidAdults + paidKids} total
          </p>
        </div>

        <div className="info-card" style={{ flex: "1 1 320px" }}>
          <h3 style={{ marginTop: 0 }}>Money</h3>
          <p style={{ marginBottom: 8 }}>
            <strong>Anticipated Money to be Collected:</strong> {formatCents(totalOwed)}
          </p>
          <p style={{ marginBottom: 8 }}>
            <strong>Collected So Far:</strong> {formatCents(totalPaid)}
          </p>
          <p style={{ marginBottom: 0 }}>
            <strong>Remaining:</strong> {formatCents(totalOwed - totalPaid)}
          </p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 24 }}>
      <div className="info-card" style={{ flex: "1 1 400px" }}>
        <h3 style={{ marginTop: 0 }}>Event Details</h3>
        <form action={updateTripDetailsAction}>
          <input type="hidden" name="id" value={trip.id} />
          <div className="form-field">
            <label htmlFor="title">Title</label>
            <input id="title" name="title" required defaultValue={trip.title} />
          </div>
          <div className="form-field">
            <label htmlFor="location">Location</label>
            <input id="location" name="location" defaultValue={trip.location ?? ""} />
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="form-field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="startDate">Start Date</label>
              <input id="startDate" name="startDate" type="date" defaultValue={toDateInputValue(trip.startDate)} />
            </div>
            <div className="form-field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="endDate">End Date</label>
              <input id="endDate" name="endDate" type="date" defaultValue={toDateInputValue(trip.endDate)} />
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="detailsHtml">Details</label>
            <textarea id="detailsHtml" name="detailsHtml" rows={3} defaultValue={trip.detailsHtml ?? ""} />
          </div>
          <div className="form-field">
            <label htmlFor="flyer">Flyer</label>
            {trip.flyerUrl && (
              <p style={{ marginTop: 0, marginBottom: 8 }}>
                <a href={trip.flyerUrl} target="_blank" rel="noopener noreferrer" className="link">
                  View current flyer →
                </a>
              </p>
            )}
            <input id="flyer" name="flyer" type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" />
            <p className="form-note">Image or PDF, up to 8MB. Uploading a new file replaces the current flyer.</p>
            {trip.flyerUrl && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, marginTop: 8 }}>
                <input type="checkbox" name="removeFlyer" value="true" style={{ width: "auto" }} />
                Remove current flyer
              </label>
            )}
          </div>
          <button type="submit" className="btn btn-primary">Save Details</button>
        </form>
      </div>

      <div style={{ flex: "1 1 400px", display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="info-card">
        <h3 style={{ marginTop: 0 }}>Price Structure</h3>
        <p className="form-note" style={{ marginTop: 0 }}>
          Current price: <strong>{formatCents(priceCents)}</strong>/person.
        </p>
        <form action={updateTripPricingAction}>
          <input type="hidden" name="id" value={trip.id} />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="form-field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="regularPrice">Regular Price ($/person)</label>
              <input
                id="regularPrice"
                name="regularPrice"
                type="number"
                min="0"
                step="0.01"
                required
                defaultValue={(trip.regularPriceCents / 100).toFixed(2)}
              />
            </div>
            <div className="form-field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="earlyBirdPrice">Early-Bird Price ($/person, optional)</label>
              <input
                id="earlyBirdPrice"
                name="earlyBirdPrice"
                type="number"
                min="0"
                step="0.01"
                defaultValue={trip.earlyBirdPriceCents !== null ? (trip.earlyBirdPriceCents / 100).toFixed(2) : undefined}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="form-field" style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="earlyBirdDeadline">Early-Bird Deadline (paid in full by)</label>
              <input id="earlyBirdDeadline" name="earlyBirdDeadline" type="date" defaultValue={toDateInputValue(trip.earlyBirdDeadline)} />
            </div>
            <div className="form-field" style={{ flex: 1, minWidth: 200 }}>
              <label htmlFor="rsvpDeadline">RSVP &amp; Payment Deadline</label>
              <input id="rsvpDeadline" name="rsvpDeadline" type="date" defaultValue={toDateInputValue(trip.rsvpDeadline)} />
            </div>
          </div>
          <div className="form-field" style={{ maxWidth: 220 }}>
            <label htmlFor="freeAgeAndUnder">Free Age &amp; Under (optional)</label>
            <input
              id="freeAgeAndUnder"
              name="freeAgeAndUnder"
              type="number"
              min="0"
              step="1"
              defaultValue={trip.freeAgeAndUnder ?? undefined}
            />
          </div>
          <button type="submit" className="btn btn-primary">Save Pricing</button>
        </form>
      </div>

      <div className="info-card">
        <h3 style={{ marginTop: 0 }}>Payment Instructions</h3>
        <p className="form-note" style={{ marginTop: 0 }}>
          Shown to families on the public page once they pick their affiliation.
        </p>
        <form action={updateTripPaymentInstructionsAction}>
          <input type="hidden" name="id" value={trip.id} />
          <div className="form-field">
            <label htmlFor="packPaymentInstructions">Pack 376 Instructions</label>
            <textarea id="packPaymentInstructions" name="packPaymentInstructions" rows={2} defaultValue={trip.packPaymentInstructions ?? ""} />
          </div>
          <div className="form-field">
            <label htmlFor="troopPaymentInstructions">Troop 376 Instructions</label>
            <textarea id="troopPaymentInstructions" name="troopPaymentInstructions" rows={2} defaultValue={trip.troopPaymentInstructions ?? ""} />
          </div>
          <button type="submit" className="btn btn-primary">Save Instructions</button>
        </form>
      </div>
      </div>
      </div>

      <div className="section-head">
        <div className="eyebrow">Weekend Menu</div>
        <h2>Menu</h2>
        <p>Friday Dinner only, Saturday and Sunday all 3 meals, Monday Breakfast only.</p>
      </div>
      <div className="info-card" style={{ marginBottom: 24, maxWidth: 920 }}>
        <form action={updateTripMealsAction}>
          <div style={{ display: "flex", flexWrap: "wrap", columnGap: 24 }}>
            {meals.map((meal) => (
              <div key={meal.id} className="form-field" style={{ flex: "1 1 380px" }}>
                <label htmlFor={`menuText-${meal.id}`}>
                  {DAY_LABELS[meal.day]} {MEAL_TYPE_LABELS[meal.mealType]}
                </label>
                <input type="hidden" name="mealId" value={meal.id} />
                <textarea
                  id={`menuText-${meal.id}`}
                  name={`menuText-${meal.id}`}
                  rows={2}
                  defaultValue={meal.menuText ?? ""}
                  placeholder="What's being served"
                />
              </div>
            ))}
          </div>
          <button type="submit" className="btn btn-primary">Save Menu</button>
        </form>
      </div>

      <div className="section-head">
        <div className="eyebrow">Weekend Staffing</div>
        <h2>Duty Roster</h2>
        <p>Assign helpers to a meal, or add a standalone duty (setup, breakdown, etc.) with no meal attached.</p>
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 32 }}>
      <div style={{ flex: "2 1 480px" }}>
      {dutySlots.length === 0 ? (
        <div className="info-card">
          <p style={{ marginBottom: 0 }}>No duty slots yet.</p>
        </div>
      ) : (
        <div>
          {dutySlots.map((duty) => (
            <CollapsibleGroup
              key={duty.id}
              defaultOpen={false}
              label={`${duty.tripMeal ? `${DAY_LABELS[duty.tripMeal.day]} ${MEAL_TYPE_LABELS[duty.tripMeal.mealType]}` : "General"} — ${duty.label}${
                duty.assignedName ? ` · ${duty.assignedName}` : ""
              }${duty.arriveTime ? ` (${duty.arriveTime})` : ""}`}
            >
              <div className="info-card" style={{ marginTop: 8, maxWidth: CARD_WIDTH }}>
                <form action={updateDutySlotAction}>
                  <input type="hidden" name="id" value={duty.id} />
                  <div className="form-field">
                    <label htmlFor={`duty-label-${duty.id}`}>Duty</label>
                    <input id={`duty-label-${duty.id}`} name="label" required defaultValue={duty.label} />
                  </div>
                  <div className="form-field">
                    <label htmlFor={`duty-meal-${duty.id}`}>Meal (optional)</label>
                    <select id={`duty-meal-${duty.id}`} name="tripMealId" defaultValue={duty.tripMealId ?? ""}>
                      <option value="">— General duty, no meal —</option>
                      {meals.map((meal) => (
                        <option key={meal.id} value={meal.id}>
                          {DAY_LABELS[meal.day]} {MEAL_TYPE_LABELS[meal.mealType]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <div className="form-field" style={{ flex: 1, minWidth: 160 }}>
                      <label htmlFor={`duty-assigned-${duty.id}`}>Assigned To</label>
                      <input id={`duty-assigned-${duty.id}`} name="assignedName" defaultValue={duty.assignedName ?? ""} placeholder="Name" />
                    </div>
                    <div className="form-field" style={{ flex: 1, minWidth: 160 }}>
                      <label htmlFor={`duty-arrive-${duty.id}`}>Arrive</label>
                      <input
                        id={`duty-arrive-${duty.id}`}
                        name="arriveTime"
                        defaultValue={duty.arriveTime ?? ""}
                        placeholder="e.g. 4:00 PM Fri"
                      />
                    </div>
                  </div>
                  <div className="form-field">
                    <label htmlFor={`duty-notes-${duty.id}`}>Notes (optional)</label>
                    <input id={`duty-notes-${duty.id}`} name="notes" defaultValue={duty.notes ?? ""} />
                  </div>
                  <button
                    type="submit"
                    className="btn btn-outline btn-small"
                    style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
                  >
                    Save Changes
                  </button>
                </form>
                <form action={deleteDutySlotAction} style={{ marginTop: 12 }}>
                  <input type="hidden" name="id" value={duty.id} />
                  <button
                    type="submit"
                    className="btn btn-outline btn-small"
                    style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}
                  >
                    Remove
                  </button>
                </form>
              </div>
            </CollapsibleGroup>
          ))}
        </div>
      )}
      </div>

      <div className="info-card" style={{ flex: "1 1 360px" }}>
        <h3 style={{ marginTop: 0 }}>Add a Duty Slot</h3>
        <form action={createDutySlotAction}>
          <input type="hidden" name="tripPageId" value={trip.id} />
          <div className="form-field">
            <label htmlFor="label">Duty</label>
            <input id="label" name="label" required placeholder="e.g. Head Cook, Setup Crew" />
          </div>
          <div className="form-field">
            <label htmlFor="tripMealId">Meal (optional)</label>
            <select id="tripMealId" name="tripMealId" defaultValue="">
              <option value="">— General duty, no meal —</option>
              {meals.map((meal) => (
                <option key={meal.id} value={meal.id}>
                  {DAY_LABELS[meal.day]} {MEAL_TYPE_LABELS[meal.mealType]}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="form-field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="assignedName">Assigned To</label>
              <input id="assignedName" name="assignedName" placeholder="Name" />
            </div>
            <div className="form-field" style={{ flex: 1, minWidth: 160 }}>
              <label htmlFor="arriveTime">Arrive</label>
              <input id="arriveTime" name="arriveTime" placeholder="e.g. 4:00 PM Fri" />
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="notes">Notes (optional)</label>
            <input id="notes" name="notes" />
          </div>
          <button type="submit" className="btn btn-primary">Add</button>
        </form>
      </div>
      </div>

      <div className="section-head">
        <div className="eyebrow">Weekend Itinerary</div>
        <h2>Activities Schedule</h2>
        <p>What&apos;s happening and when — shown to families on the public page.</p>
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 32 }}>
      <div style={{ flex: "2 1 480px" }}>
      {activities.length === 0 ? (
        <div className="info-card">
          <p style={{ marginBottom: 0 }}>No activities scheduled yet.</p>
        </div>
      ) : (
        <div>
          {activities.map((activity) => (
            <CollapsibleGroup
              key={activity.id}
              defaultOpen={false}
              label={`${DAY_LABELS[activity.day]}${activity.time ? ` ${activity.time}` : ""} — ${activity.title}`}
            >
              <div className="info-card" style={{ marginTop: 8, maxWidth: CARD_WIDTH }}>
                <form action={updateActivityAction}>
                  <input type="hidden" name="id" value={activity.id} />
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <div className="form-field" style={{ flex: 1, minWidth: 140 }}>
                      <label htmlFor={`activity-day-${activity.id}`}>Day</label>
                      <select id={`activity-day-${activity.id}`} name="day" defaultValue={activity.day}>
                        {TRIP_DAY_ORDER.map((day) => (
                          <option key={day} value={day}>
                            {DAY_LABELS[day]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-field" style={{ flex: 1, minWidth: 140 }}>
                      <label htmlFor={`activity-time-${activity.id}`}>Time</label>
                      <input id={`activity-time-${activity.id}`} name="time" defaultValue={activity.time ?? ""} placeholder="e.g. 4:00 PM" />
                    </div>
                  </div>
                  <div className="form-field">
                    <label htmlFor={`activity-title-${activity.id}`}>Activity</label>
                    <input id={`activity-title-${activity.id}`} name="title" required defaultValue={activity.title} />
                  </div>
                  <div className="form-field">
                    <label htmlFor={`activity-description-${activity.id}`}>Description (optional)</label>
                    <textarea
                      id={`activity-description-${activity.id}`}
                      name="description"
                      rows={2}
                      defaultValue={activity.description ?? ""}
                    />
                  </div>
                  <button
                    type="submit"
                    className="btn btn-outline btn-small"
                    style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
                  >
                    Save Changes
                  </button>
                </form>
                <form action={deleteActivityAction} style={{ marginTop: 12 }}>
                  <input type="hidden" name="id" value={activity.id} />
                  <button
                    type="submit"
                    className="btn btn-outline btn-small"
                    style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}
                  >
                    Remove
                  </button>
                </form>
              </div>
            </CollapsibleGroup>
          ))}
        </div>
      )}
      </div>

      <div className="info-card" style={{ flex: "1 1 360px" }}>
        <h3 style={{ marginTop: 0 }}>Add an Activity</h3>
        <form action={createActivityAction}>
          <input type="hidden" name="tripPageId" value={trip.id} />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="form-field" style={{ flex: 1, minWidth: 140 }}>
              <label htmlFor="activity-day">Day</label>
              <select id="activity-day" name="day" defaultValue={TRIP_DAY_ORDER[0]}>
                {TRIP_DAY_ORDER.map((day) => (
                  <option key={day} value={day}>
                    {DAY_LABELS[day]}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field" style={{ flex: 1, minWidth: 140 }}>
              <label htmlFor="activity-time">Time</label>
              <input id="activity-time" name="time" placeholder="e.g. 4:00 PM" />
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="activity-title">Activity</label>
            <input id="activity-title" name="title" required placeholder="e.g. Tent Decorating Contest" />
          </div>
          <div className="form-field">
            <label htmlFor="activity-description">Description (optional)</label>
            <textarea id="activity-description" name="description" rows={2} placeholder="Bring your best decorations!" />
          </div>
          <button type="submit" className="btn btn-primary">Add</button>
        </form>
      </div>
      </div>

      <div
        className="section-head"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}
      >
        <div>
          <div className="eyebrow">Registrations</div>
          <h2>Families Registered ({visibleRegistrations.length})</h2>
          <p>
            Owed {formatCents(visibleOwed)} · Paid {formatCents(visiblePaid)} · Remaining {formatCents(visibleOwed - visiblePaid)}
          </p>
        </div>
        {registrations.length > 0 && (
          <a
            className="btn btn-outline btn-small"
            style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
            href="/portal/admin/camp-conron/export"
          >
            Export CSV
          </a>
        )}
      </div>

      {registrations.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          <Link
            href="/portal/admin/camp-conron?affiliation=ALL"
            className={`btn btn-small ${affiliationFilter === "ALL" ? "btn-primary" : "btn-outline"}`}
            style={affiliationFilter !== "ALL" ? { borderColor: "var(--scout-blue)", color: "var(--scout-blue)" } : undefined}
          >
            All
          </Link>
          <Link
            href="/portal/admin/camp-conron?affiliation=PACK"
            className={`btn btn-small ${affiliationFilter === "PACK" ? "btn-primary" : "btn-outline"}`}
            style={affiliationFilter !== "PACK" ? { borderColor: "var(--scout-blue)", color: "var(--scout-blue)" } : undefined}
          >
            Pack 376
          </Link>
          <Link
            href="/portal/admin/camp-conron?affiliation=TROOP"
            className={`btn btn-small ${affiliationFilter === "TROOP" ? "btn-primary" : "btn-outline"}`}
            style={affiliationFilter !== "TROOP" ? { borderColor: "var(--scout-blue)", color: "var(--scout-blue)" } : undefined}
          >
            Troop 376
          </Link>
        </div>
      )}

      {visibleRegistrations.length === 0 ? (
        <div className="info-card" style={{ maxWidth: CARD_WIDTH }}>
          <p style={{ marginBottom: 0 }}>{registrations.length === 0 ? "No registrations yet." : "No registrations match this filter."}</p>
        </div>
      ) : (
        <div>
          {visibleRegistrations.map((reg) => {
            const status =
              reg.remainingCents <= 0
                ? { label: reg.remainingCents < 0 ? "Overpaid" : "Paid in Full", cls: "badge-attendance" }
                : reg.paidCents > 0
                ? { label: "Partial", cls: "badge-junior" }
                : { label: "Unpaid", cls: "badge-photographer" };
            return (
              <CollapsibleGroup
                key={reg.id}
                defaultOpen={false}
                label={`${reg.familyName} — ${reg.affiliation === "PACK" ? "Pack 376" : "Troop 376"} · Guest of ${reg.guestOfName} · ${reg.payingCount} paying${
                  reg.freeCount ? `, ${reg.freeCount} free` : ""
                } · ${status.label} (${formatCents(reg.remainingCents)} remaining)`}
              >
                <div className="info-card" style={{ marginTop: 8, maxWidth: CARD_WIDTH }}>
                  <p style={{ marginTop: 0 }}>
                    Owed {formatCents(reg.amountOwedCents)} · Paid {formatCents(reg.paidCents)} · Remaining {formatCents(reg.remainingCents)}
                  </p>

                  {isAdmin ? (
                    <form action={updateTripRegistrationAction} style={{ marginBottom: 16 }}>
                      <input type="hidden" name="id" value={reg.id} />
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <div className="form-field" style={{ flex: 1, minWidth: 180 }}>
                          <label htmlFor={`familyName-${reg.id}`}>Family / Registrant Name</label>
                          <input id={`familyName-${reg.id}`} name="familyName" required defaultValue={reg.familyName} />
                        </div>
                        <div className="form-field" style={{ flex: 1, minWidth: 160 }}>
                          <label htmlFor={`affiliation-${reg.id}`}>Affiliation</label>
                          <select id={`affiliation-${reg.id}`} name="affiliation" defaultValue={reg.affiliation}>
                            <option value="PACK">Pack 376</option>
                            <option value="TROOP">Troop 376</option>
                          </select>
                        </div>
                      </div>
                      <div className="form-field">
                        <label htmlFor={`guestOfName-${reg.id}`}>Scout/Leader Guest Of</label>
                        <input id={`guestOfName-${reg.id}`} name="guestOfName" required defaultValue={reg.guestOfName} />
                      </div>
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <div className="form-field" style={{ flex: 1, minWidth: 200 }}>
                          <label htmlFor={`contactEmail-${reg.id}`}>Email</label>
                          <input id={`contactEmail-${reg.id}`} name="contactEmail" type="email" required defaultValue={reg.contactEmail} />
                        </div>
                        <div className="form-field" style={{ flex: 1, minWidth: 160 }}>
                          <label htmlFor={`contactPhone-${reg.id}`}>Phone</label>
                          <input
                            id={`contactPhone-${reg.id}`}
                            name="contactPhone"
                            type="tel"
                            required
                            defaultValue={reg.contactPhone ?? ""}
                            placeholder="(212)555-1234"
                          />
                        </div>
                      </div>
                      <TripRegistrationCountFields
                        idPrefix={`reg-${reg.id}`}
                        pricePerPersonCents={priceCents}
                        defaultPayingCount={reg.payingCount}
                        defaultFreeCount={reg.freeCount}
                        defaultAmountOwedCents={reg.amountOwedCents}
                      />
                      <p className="form-note" style={{ marginTop: -8 }}>
                        Registered {reg.createdAt.toLocaleDateString("en-US", { timeZone: "UTC" })}.
                      </p>
                      <button
                        type="submit"
                        className="btn btn-outline btn-small"
                        style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
                      >
                        Save Changes
                      </button>
                    </form>
                  ) : (
                    <p>
                      {reg.contactEmail}
                      {reg.contactPhone ? ` · ${reg.contactPhone}` : ""} · Guest of {reg.guestOfName} · Registered{" "}
                      {reg.createdAt.toLocaleDateString("en-US", { timeZone: "UTC" })}
                    </p>
                  )}

                  {reg.payments.length > 0 && (
                    <div className="table-scroll" style={{ marginBottom: 16 }}>
                      <table className="data-table" style={{ marginBottom: 0 }}>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Amount</th>
                            <th>Note</th>
                            {isAdmin && <th></th>}
                          </tr>
                        </thead>
                        <tbody>
                          {reg.payments.map((p) => (
                            <tr key={p.id}>
                              <td
                                className="audit-hover"
                                data-audit={formatAuditTooltip("Recorded", p.createdAt, p.recordedByUser?.username ?? null)}
                              >
                                {p.paidOn.toLocaleDateString("en-US", { timeZone: "UTC" })}
                              </td>
                              <td>{formatCents(p.amountCents)}</td>
                              <td>{p.note || "—"}</td>
                              {isAdmin && (
                                <td className="actions">
                                  <form action={deleteTripPaymentAction}>
                                    <input type="hidden" name="paymentId" value={p.id} />
                                    <button
                                      type="submit"
                                      className="btn btn-outline btn-small"
                                      style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}
                                    >
                                      Delete
                                    </button>
                                  </form>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {isAdmin && (
                    <>
                      <form
                        action={addTripPaymentAction}
                        style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}
                      >
                        <input type="hidden" name="tripRegistrationId" value={reg.id} />
                        <div className="form-field" style={{ marginBottom: 0, flex: "1 1 100px" }}>
                          <label htmlFor={`amount-${reg.id}`}>Amount ($)</label>
                          <input id={`amount-${reg.id}`} name="amount" type="number" min="0.01" step="0.01" required />
                        </div>
                        <div className="form-field" style={{ marginBottom: 0, flex: "1 1 140px" }}>
                          <label htmlFor={`paidOn-${reg.id}`}>Date</label>
                          <input id={`paidOn-${reg.id}`} name="paidOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
                        </div>
                        <div className="form-field" style={{ marginBottom: 0, flex: "1 1 160px" }}>
                          <label htmlFor={`note-${reg.id}`}>Note (optional)</label>
                          <input id={`note-${reg.id}`} name="note" type="text" placeholder="Cash, Zelle…" />
                        </div>
                        <button type="submit" className="btn btn-primary">Add Payment</button>
                      </form>
                      <form action={deleteTripRegistrationAction}>
                        <input type="hidden" name="id" value={reg.id} />
                        <button
                          type="submit"
                          className="btn btn-outline btn-small"
                          style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}
                        >
                          Remove Registration
                        </button>
                      </form>
                    </>
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
