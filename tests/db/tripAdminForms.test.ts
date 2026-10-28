/*
 * The event admin page's Price Structure and registration edit forms carry a
 * fingerprint of what they were filled in with, and their actions turn down
 * a save whose fingerprint no longer matches (review 2026-10-27; the
 * refusals themselves are in tripPricing.test.ts and tripRegistration.test.ts).
 * This checks the page and the actions agree: the fingerprint the real Admin
 * page renders is accepted while nothing has changed, and refused once
 * something has.
 *
 * Async server components can't be rendered whole outside Next, so the page
 * is called as a function and its element tree searched, as in
 * tripFlyerPages.test.ts.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { withTestDatabase } from "../support/db";
import { resetTestState, type SessionUser } from "../support/context";
import {
  createUser,
  editRegistration,
  familyForm,
  freshTrip,
  loadTripActions,
  register,
  registrationsOf,
  savePricing,
  type TripActions,
} from "./tripHelpers";

const db = withTestDatabase("trip_admin_forms");
let actions: TripActions;
let admin: SessionUser;
let TripAdminView: typeof import("@/components/TripAdminView").default;
let TripAdminForm: typeof import("@/components/TripAdminForm").default;
let sites: typeof import("@/lib/tripSites");

before(async () => {
  await db.ready;
  actions = await loadTripActions();
  admin = await createUser(db.prisma, "ADMIN");
  ({ default: TripAdminView } = await import("@/components/TripAdminView"));
  ({ default: TripAdminForm } = await import("@/components/TripAdminForm"));
  sites = await import("@/lib/tripSites");
});

beforeEach(() => resetTestState());

/** Every element anywhere in an (unrendered) element tree that `match` accepts. */
function findElements(node: ReactNode, match: (element: ReactElement) => boolean, found: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, match, found);
  } else if (isValidElement(node)) {
    if (match(node)) found.push(node);
    for (const value of Object.values(node.props as Record<string, unknown>)) {
      if (Array.isArray(value) || isValidElement(value)) findElements(value as ReactNode, match, found);
    }
  }
  return found;
}

/** The value of the hidden field `name` inside a form element. */
function hiddenValue(formElement: ReactElement, name: string): string | undefined {
  const [input] = findElements(formElement, (element) => {
    const props = element.props as { type?: string; name?: string };
    return element.type === "input" && props.type === "hidden" && props.name === name;
  });
  return input ? String((input.props as { value: unknown }).value) : undefined;
}

/** The Admin page's forms whose action is `action`, as rendered now. */
async function formsFor(action: unknown) {
  const tree = await TripAdminView({ site: sites.CYCLONES_SITE, role: "ADMIN", affiliationParam: undefined });
  return findElements(tree, (element) => element.type === TripAdminForm && (element.props as { action: unknown }).action === action);
}

describe("the event admin page's edit forms", () => {
  it("the Price Structure form carries the fingerprint its save checks", async () => {
    const trip = await freshTrip(db.prisma);
    const [pricingForm] = await formsFor(actions.page.updateTripPricingAction);
    assert.ok(pricingForm, "the Admin page has a Price Structure form");
    const loaded = hiddenValue(pricingForm, "version");
    assert.ok(loaded, "it carries a fingerprint of the pricing it shows");

    // Saved from that page as rendered: goes through.
    assert.deepEqual(await savePricing(actions, admin, trip.id, { regularPrice: "40", version: loaded }), {});
    // The refreshed page carries a new one; the old one is now refused.
    const [refreshed] = await formsFor(actions.page.updateTripPricingAction);
    assert.notEqual(hiddenValue(refreshed, "version"), loaded);
    const stale = await savePricing(actions, admin, trip.id, { regularPrice: "0", priceTbd: true, version: loaded });
    assert.equal(stale.stale, true);
    assert.equal((await db.prisma.tripPage.findUniqueOrThrow({ where: { id: trip.id } })).priceTbd, false);
  });

  it("each registration's edit form carries the fingerprint its save checks", async () => {
    const trip = await freshTrip(db.prisma, { priceTbd: false, regularPriceCents: 4000 });
    assert.equal((await register(actions, familyForm(trip.id, { payingCount: 2 }))).success, true);
    assert.equal((await register(actions, familyForm(trip.id, { payingCount: 3 }))).success, true);
    const rows = await registrationsOf(db.prisma, trip.id);

    const editForms = await formsFor(actions.registration.updateTripRegistrationAction);
    assert.equal(editForms.length, 2);
    const versionOf = new Map(editForms.map((f) => [hiddenValue(f, "id"), hiddenValue(f, "version")]));
    assert.notEqual(versionOf.get(rows[0].id), versionOf.get(rows[1].id));

    // Each form's fingerprint is accepted for its own registration...
    const [first, second] = rows;
    assert.deepEqual(
      await editRegistration(actions, admin, first, { amountOwed: "60.00", version: versionOf.get(first.id) ?? "" }),
      {},
    );
    // ...and, once that registration has changed, the page it was on is out of date.
    const stale = await editRegistration(actions, admin, first, { amountOwed: "80.00", version: versionOf.get(first.id) ?? "" });
    assert.equal(stale.stale, true);
    assert.equal((await db.prisma.tripRegistration.findUniqueOrThrow({ where: { id: first.id } })).amountOwedCents, 6000);
    // The other registration's form is unaffected.
    assert.deepEqual(
      await editRegistration(actions, admin, second, { contactPhone: "2125550199", version: versionOf.get(second.id) ?? "" }),
      {},
    );
  });
});
