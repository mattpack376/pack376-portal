import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import EnlargeableImage from "@/components/EnlargeableImage";
import TripRegistrationForm from "@/components/TripRegistrationForm";
import {
  getOrCreateTripPage,
  getTripMeals,
  getTripDutySlots,
  getTripActivities,
  currentTripPriceCents,
  CAMP_CONRON_SLUG,
  DAY_LABELS,
  MEAL_TYPE_LABELS,
} from "@/lib/tripPageData";
import { formatCents } from "@/lib/duesData";

export const metadata: Metadata = {
  title: "Camp Conron Halloween Weekend — Pack 376",
  description:
    "Register for the Camp Conron Halloween Weekend — a joint Pack 376 / Troop 376 camping trip, October 9–12 in Holmes, NY.",
};

// Not statically prerenderable: pricing depends on the current date, admin
// content (menu, duty roster, registrations) should never be stale, and
// getOrCreateTripPage can write on first load — none of that belongs
// happening once at build time the way a static public page normally would.
export const dynamic = "force-dynamic";

function formatDate(date: Date | null) {
  if (!date) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(
    date,
  );
}

export default async function CampConronPage() {
  const trip = await getOrCreateTripPage(CAMP_CONRON_SLUG);

  if (!trip.published) {
    return (
      <>
        <Header homeHref="https://www.pack376nyc.org" />
        <div className="site-banner">
          ⚠️ This page is in testing — everything listed is a placeholder for visual purposes only and is not finalized yet.
        </div>
        <section className="page-hero">
          <h1>{trip.title}</h1>
          <p>Details for this trip are coming soon — check back shortly.</p>
        </section>
        <Footer />
      </>
    );
  }

  const [meals, dutySlots, activities] = await Promise.all([
    getTripMeals(trip.id),
    getTripDutySlots(trip.id),
    getTripActivities(trip.id),
  ]);

  const priceCents = currentTripPriceCents(trip);
  const isEarlyBird = trip.earlyBirdPriceCents !== null && priceCents === trip.earlyBirdPriceCents;

  const generalDuties = dutySlots.filter((d) => !d.tripMealId);
  const dutyByMeal = new Map<string, typeof dutySlots>();
  for (const duty of dutySlots) {
    if (!duty.tripMealId) continue;
    if (!dutyByMeal.has(duty.tripMealId)) dutyByMeal.set(duty.tripMealId, []);
    dutyByMeal.get(duty.tripMealId)!.push(duty);
  }

  // activities is already sorted chronologically (day, then sortOrder, then
  // creation order) by getTripActivities, so grouping same-day runs
  // sequentially is enough — no re-sort needed here.
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
      <Header homeHref="https://www.pack376nyc.org" />
      <div className="site-banner">
        ⚠️ This page is in testing — everything listed is a placeholder for visual purposes only and is not finalized yet.
      </div>

      <section className="page-hero">
        <div className="eyebrow" style={{ background: "rgba(255,255,255,0.15)", color: "var(--scout-gold)" }}>
          Pack 376 &amp; Troop 376 Joint Trip
        </div>
        <h1>{trip.title}</h1>
        <p>
          {trip.location}
          {trip.startDate && trip.endDate && ` · ${formatDate(trip.startDate)} – ${formatDate(trip.endDate)}`}
        </p>
      </section>
      <div className="wave-divider" style={{ marginTop: -1 }}>
        <svg viewBox="0 0 1200 70" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M0,40 C150,90 350,0 600,30 C850,60 1050,0 1200,40 L1200,70 L0,70 Z"
            fill="var(--cream)"
            style={{ transform: "scaleY(-1)", transformOrigin: "center" }}
          />
        </svg>
      </div>

      <section style={{ paddingTop: 16 }}>
        <div className="container contact-grid">
          <div>
            {trip.flyerUrl && (
              <div style={{ marginBottom: 24, textAlign: "center" }}>
                <EnlargeableImage
                  src={trip.flyerUrl}
                  alt={`${trip.title} flyer`}
                  width={360}
                  height={465}
                  enlargedWidth={680}
                  enlargedHeight={880}
                  fit="contain"
                />
              </div>
            )}

            <div className="info-card" style={{ marginBottom: 24 }}>
              <h3 style={{ marginTop: 0 }}>Event Details</h3>
              {trip.detailsHtml && <p>{trip.detailsHtml}</p>}
              {trip.rsvpDeadline && <p style={{ fontWeight: 700, marginBottom: 0 }}>RSVP &amp; payment due by {formatDate(trip.rsvpDeadline)}.</p>}
            </div>

            <div className="info-card" style={{ marginBottom: 24 }}>
              <h3 style={{ marginTop: 0 }}>Price</h3>
              <p style={{ fontSize: 28, fontWeight: 800, color: "var(--scout-blue-dark)", margin: "0 0 4px" }}>
                {formatCents(trip.regularPriceCents)} <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-soft)" }}>per person</span>
              </p>
              {trip.earlyBirdPriceCents !== null && trip.earlyBirdDeadline && (
                <p style={{ margin: "0 0 8px", fontWeight: 700, color: isEarlyBird ? "var(--carnival-red)" : "var(--ink-soft)" }}>
                  {isEarlyBird
                    ? `Early-Bird Special: ${formatCents(trip.earlyBirdPriceCents)}/person if paid in full by ${formatDate(trip.earlyBirdDeadline)}.`
                    : `Early-bird pricing (${formatCents(trip.earlyBirdPriceCents)}/person) ended ${formatDate(trip.earlyBirdDeadline)}.`}
                </p>
              )}
              {trip.freeAgeAndUnder !== null && (
                <p style={{ marginBottom: 0 }}>
                  Age {trip.freeAgeAndUnder} and under: <strong>free</strong>.
                </p>
              )}
            </div>

            <div className="info-card" style={{ marginBottom: 24 }}>
              <h3 style={{ marginTop: 0 }}>Menu</h3>
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

            <div className="info-card" style={{ marginBottom: 24 }}>
              <h3 style={{ marginTop: 0 }}>Schedule</h3>
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

            <div className="info-card">
              <h3 style={{ marginTop: 0 }}>Duty Roster</h3>
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

          <div className="info-card">
            <h3 style={{ marginTop: 0 }}>Register Your Family</h3>
            <TripRegistrationForm
              tripPageId={trip.id}
              currentPriceCents={priceCents}
              packPaymentInstructions={trip.packPaymentInstructions}
              troopPaymentInstructions={trip.troopPaymentInstructions}
              rsvpDeadlineLabel={trip.rsvpDeadline ? formatDate(trip.rsvpDeadline) : null}
            />
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
