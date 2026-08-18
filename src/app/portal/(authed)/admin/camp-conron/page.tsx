import { requireTripPageSession } from "@/lib/authorize";
import {
  getOrCreateTripPage,
  getTripMeals,
  getTripDutySlots,
  getTripRegistrations,
  currentTripPriceCents,
  CAMP_CONRON_SLUG,
  DAY_LABELS,
  MEAL_TYPE_LABELS,
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
  deleteDutySlotAction,
  toggleTripPublishedAction,
} from "@/lib/actions/tripPage";
import { addTripPaymentAction, deleteTripPaymentAction, deleteTripRegistrationAction } from "@/lib/actions/tripRegistration";

function toDateInputValue(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : "";
}

export default async function AdminCampConronPage() {
  const session = await requireTripPageSession();
  const isAdmin = session.role === "ADMIN";

  const trip = await getOrCreateTripPage(CAMP_CONRON_SLUG);
  const [meals, dutySlots, registrations] = await Promise.all([
    getTripMeals(trip.id),
    getTripDutySlots(trip.id),
    getTripRegistrations(trip.id),
  ]);

  const priceCents = currentTripPriceCents(trip);
  const totalOwed = registrations.reduce((sum, r) => sum + r.amountOwedCents, 0);
  const totalPaid = registrations.reduce((sum, r) => sum + r.paidCents, 0);

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

      <div className="info-card" style={{ maxWidth: 520, marginBottom: 24 }}>
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

      <div className="info-card" style={{ maxWidth: 520, marginBottom: 24 }}>
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

      <div className="info-card" style={{ maxWidth: 520, marginBottom: 24 }}>
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

      <div className="section-head">
        <div className="eyebrow">Weekend Menu</div>
        <h2>Menu</h2>
        <p>Friday Dinner only, Saturday and Sunday all 3 meals, Monday Breakfast only.</p>
      </div>
      <div className="info-card" style={{ marginBottom: 24, maxWidth: 640 }}>
        <form action={updateTripMealsAction}>
          {meals.map((meal) => (
            <div key={meal.id} className="form-field">
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
          <button type="submit" className="btn btn-primary">Save Menu</button>
        </form>
      </div>

      <div className="section-head">
        <div className="eyebrow">Weekend Staffing</div>
        <h2>Duty Roster</h2>
        <p>Assign helpers to a meal, or add a standalone duty (setup, breakdown, etc.) with no meal attached.</p>
      </div>

      {dutySlots.length === 0 ? (
        <div className="info-card" style={{ marginBottom: 24 }}>
          <p style={{ marginBottom: 0 }}>No duty slots yet.</p>
        </div>
      ) : (
        <div className="table-scroll" style={{ marginBottom: 24 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Meal</th>
                <th>Duty</th>
                <th>Assigned To</th>
                <th>Arrive</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {dutySlots.map((duty) => (
                <tr key={duty.id}>
                  <td>{duty.tripMeal ? `${DAY_LABELS[duty.tripMeal.day]} ${MEAL_TYPE_LABELS[duty.tripMeal.mealType]}` : "General"}</td>
                  <td>{duty.label}</td>
                  <td>{duty.assignedName || "—"}</td>
                  <td>{duty.arriveTime || "—"}</td>
                  <td>{duty.notes || "—"}</td>
                  <td className="actions">
                    <form action={deleteDutySlotAction}>
                      <input type="hidden" name="id" value={duty.id} />
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
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="info-card" style={{ maxWidth: 480, marginBottom: 32 }}>
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

      <div
        className="section-head"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}
      >
        <div>
          <div className="eyebrow">Registrations</div>
          <h2>Families Registered ({registrations.length})</h2>
          <p>
            Owed {formatCents(totalOwed)} · Paid {formatCents(totalPaid)} · Remaining {formatCents(totalOwed - totalPaid)}
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

      {registrations.length === 0 ? (
        <div className="info-card">
          <p style={{ marginBottom: 0 }}>No registrations yet.</p>
        </div>
      ) : (
        <div>
          {registrations.map((reg) => {
            const status =
              reg.remainingCents <= 0
                ? { label: reg.remainingCents < 0 ? "Overpaid" : "Paid in Full", cls: "badge-attendance" }
                : reg.paidCents > 0
                ? { label: "Partial", cls: "badge-junior" }
                : { label: "Unpaid", cls: "badge-photographer" };
            return (
              <CollapsibleGroup
                key={reg.id}
                label={`${reg.familyName} — ${reg.affiliation === "PACK" ? "Pack 376" : "Troop 376"} · ${reg.payingCount} paying${
                  reg.freeCount ? `, ${reg.freeCount} free` : ""
                } · ${status.label} (${formatCents(reg.remainingCents)} remaining)`}
              >
                <div className="info-card" style={{ marginTop: 8 }}>
                  <p style={{ marginTop: 0 }}>
                    {reg.contactEmail}
                    {reg.contactPhone ? ` · ${reg.contactPhone}` : ""} · Registered{" "}
                    {reg.createdAt.toLocaleDateString("en-US", { timeZone: "UTC" })}
                  </p>
                  <p>
                    Owed {formatCents(reg.amountOwedCents)} · Paid {formatCents(reg.paidCents)} · Remaining {formatCents(reg.remainingCents)}
                  </p>

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
