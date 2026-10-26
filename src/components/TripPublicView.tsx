import Header from "@/components/Header";
import Footer from "@/components/Footer";
import EnlargeableImage from "@/components/EnlargeableImage";
import TripRegistrationForm from "@/components/TripRegistrationForm";
import Linkify from "@/components/Linkify";
import {
  getOrCreateTripPage,
  getTripMeals,
  getTripDutySlots,
  getTripActivities,
  currentTripPriceCents,
  registrationClosed,
  DAY_LABELS,
  MEAL_TYPE_LABELS,
  formatTripDate,
  formatTripWhen,
  none,
} from "@/lib/tripPageData";
import type { TripSite } from "@/lib/tripSites";
import { formatCents } from "@/lib/duesData";

/**
 * The public, no-login page for an event (camp trip, ballpark overnight, …).
 * Each site's route file (src/app/camp-conron, src/app/cyclones) renders this
 * and keeps its own `metadata` and `dynamic = "force-dynamic"` — the latter
 * because the page isn't statically prerenderable: pricing depends on the
 * current date, admin content (menu, duty roster, registrations) should never
 * be stale, and getOrCreateTripPage can write on first load — none of that
 * belongs happening once at build time the way a static public page normally
 * would.
 */
export default async function TripPublicView({ site }: { site: TripSite }) {
  const trip = await getOrCreateTripPage(site.slug);

  if (!trip.published) {
    const { banner, heading, body } = site.unpublished;
    return (
      <>
        <Header mainSiteOrigin="https://www.pack376nyc.org" />
        {banner && <div className="site-banner">{banner}</div>}
        <section className="page-hero">
          <h1>{heading}</h1>
          <p>{body}</p>
        </section>
        <Footer />
      </>
    );
  }

  // Only the sections this event has are read, so an event without a menu
  // never touches the meal tables.
  const [meals, dutySlots, activities] = await Promise.all([
    site.sections.menu || site.sections.dutyRoster ? getTripMeals(trip.id) : none<typeof getTripMeals>(),
    site.sections.dutyRoster ? getTripDutySlots(trip.id) : none<typeof getTripDutySlots>(),
    site.sections.schedule ? getTripActivities(trip.id) : none<typeof getTripActivities>(),
  ]);

  // Only a site with a TBD message can hold its price back.
  const priceTbd = trip.priceTbd && site.priceTbdMessage !== null;
  const priceCents = currentTripPriceCents(trip);
  const isEarlyBird = trip.earlyBirdPriceCents !== null && priceCents === trip.earlyBirdPriceCents;

  const generalDuties = dutySlots.filter((d) => !d.tripMealId);
  const dutyByMeal = new Map<string, typeof dutySlots>();
  for (const duty of dutySlots) {
    if (!duty.tripMealId) continue;
    if (!dutyByMeal.has(duty.tripMealId)) dutyByMeal.set(duty.tripMealId, []);
    dutyByMeal.get(duty.tripMealId)!.push(duty);
  }

  // activities is already sorted chronologically (day, then time of day, then
  // sortOrder, then creation order) by getTripActivities, so grouping same-day
  // runs sequentially is enough — no re-sort needed here.
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
      <Header mainSiteOrigin="https://www.pack376nyc.org" />
      {site.publicBanner && <div className="site-banner">{site.publicBanner}</div>}

      <section className="page-hero">
        <div className="eyebrow" style={{ background: "rgba(255,255,255,0.15)", color: "var(--scout-gold)" }}>
          {site.eyebrow}
        </div>
        <h1>{trip.title}</h1>
        <p>
          {trip.location}
          {trip.startDate && ` · ${formatTripWhen(trip)}`}
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

            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 24 }}>
            <div className="info-card" style={{ flex: "1 1 200px" }}>
              <h3 style={{ marginTop: 0 }}>Event Details</h3>
              {trip.detailsHtml && <p>{trip.detailsHtml}</p>}
              {trip.rsvpDeadline && <p style={{ fontWeight: 700, marginBottom: 0 }}>RSVP &amp; payment due by {formatTripDate(trip.rsvpDeadline)}.</p>}
            </div>

            <div className="info-card" style={{ flex: "1 1 200px" }}>
              <h3 style={{ marginTop: 0 }}>Price</h3>
              {priceTbd ? (
                <p style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.3, color: "var(--scout-blue-dark)", margin: 0 }}>
                  {site.priceTbdMessage}
                </p>
              ) : (
              <>
              <p style={{ fontSize: 28, fontWeight: 800, color: "var(--scout-blue-dark)", margin: "0 0 4px" }}>
                {formatCents(trip.regularPriceCents)} <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-soft)" }}>per person</span>
              </p>
              {trip.earlyBirdPriceCents !== null && trip.earlyBirdDeadline && (
                <p style={{ margin: "0 0 8px", fontWeight: 700, color: isEarlyBird ? "var(--carnival-red)" : "var(--ink-soft)" }}>
                  {isEarlyBird
                    ? `Early-Bird Special: ${formatCents(trip.earlyBirdPriceCents)}/person if paid in full by ${formatTripDate(trip.earlyBirdDeadline)}.`
                    : `Early-bird pricing (${formatCents(trip.earlyBirdPriceCents)}/person) ended ${formatTripDate(trip.earlyBirdDeadline)}.`}
                </p>
              )}
              {trip.freeAgeAndUnder !== null && (
                <p style={{ marginBottom: 0 }}>
                  Age {trip.freeAgeAndUnder} and under: <strong>free</strong>.
                </p>
              )}
              </>
              )}
            </div>
            </div>

            {site.sections.menu && (
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
                        <td data-label="Menu">{meal.menuText ? <Linkify text={meal.menuText} /> : "Menu TBD"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            )}

            {site.sections.schedule && (
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
            )}

            {site.sections.dutyRoster && (
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
            )}
          </div>

          <div className="sticky-sidebar">
          <div className="info-card">
            <h3 style={{ marginTop: 0 }}>Register Your Family</h3>
            {/* registerForTripAction refuses submissions past the deadline, so
                the form comes down with it rather than failing on submit. */}
            {registrationClosed(trip) ? (
              <>
                <p>
                  Registration closed{trip.rsvpDeadline ? ` on ${formatTripDate(trip.rsvpDeadline)}` : ""}.
                </p>
                <p style={{ marginBottom: 0 }}>
                  Still hoping to come? Get in touch and we&apos;ll see what we can do —{" "}
                  <a href="https://www.pack376nyc.org/contact" className="link">
                    contact Pack 376
                  </a>
                  .
                </p>
              </>
            ) : (
              <TripRegistrationForm
                tripPageId={trip.id}
                currentPriceCents={priceCents}
                packPaymentInstructions={trip.packPaymentInstructions}
                troopPaymentInstructions={trip.troopPaymentInstructions}
                rsvpDeadlineLabel={trip.rsvpDeadline ? formatTripDate(trip.rsvpDeadline) : null}
                registeredFor={site.registeredFor}
                freeAgeAndUnder={trip.freeAgeAndUnder}
                priceTbd={priceTbd}
              />
            )}
          </div>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
