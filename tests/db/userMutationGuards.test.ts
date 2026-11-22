/*
 * assertCanMutateUser on every path that writes to a login, against a real
 * database: a plain Admin can't change a master-only account — a master
 * admin, a ledger account, or the all-dens Den Leader test login "denmatt" —
 * through its dens, linked children, households, role, status or contact
 * details; a master admin can. Also: denmatt can't be recreated once freed,
 * the payment deletes refuse non-admins before any lookup, contact fields
 * are bounded, and the public photo route only fetches our own event photos.
 */
import assert from "node:assert/strict";
import { afterEach, before, describe, it, mock } from "node:test";
import { withTestDatabase } from "../support/db";
import { asAnonymous, form, resetTestState, runAs, settle, type SessionUser } from "../support/context";
import { MASTER_ADMIN_USERNAMES } from "@/lib/masterAdmins";

const db = withTestDatabase("user_mutation_guards");
let users: typeof import("@/lib/actions/users");
let parents: typeof import("@/lib/actions/parents");
let households: typeof import("@/lib/actions/households");
let events: typeof import("@/lib/actions/events");
let authz: typeof import("@/lib/authorize");
let auth: typeof import("@/lib/auth");
let photoRoute: typeof import("@/app/album-photos/[photoId]/[size]/route");

type Fixture = SessionUser & { username: string };
let master: Fixture;
let admin: Fixture;
let denmatt: Fixture;
let denLeader: Fixture;
let denId = "";
let scoutId = "";
let householdId = "";

const MASTER = MASTER_ADMIN_USERNAMES[0];

before(async () => {
  await db.ready;
  users = await import("@/lib/actions/users");
  parents = await import("@/lib/actions/parents");
  households = await import("@/lib/actions/households");
  events = await import("@/lib/actions/events");
  authz = await import("@/lib/authorize");
  auth = await import("@/lib/auth");
  photoRoute = await import("@/app/album-photos/[photoId]/[size]/route");

  const den = await db.prisma.den.create({ data: { rank: "WOLF", scoutingYear: "2026-2027" } });
  denId = den.id;
  scoutId = (await db.prisma.scout.create({ data: { denId, firstName: "Sam", lastName: "Scout" } })).id;
  householdId = (await db.prisma.household.create({ data: { name: "Scout family" } })).id;

  async function make(username: string, role: Fixture["role"]): Promise<Fixture> {
    const user = await db.prisma.user.create({ data: { username, passwordHash: "x", role, displayName: username } });
    return { id: user.id, username, role, sessionVersion: 0 };
  }
  master = await make(MASTER, "ADMIN");
  admin = await make("guards-admin", "ADMIN");
  denmatt = await make("denmatt", "DEN");
  denLeader = await make("guards-den", "DEN");
});

afterEach(() => {
  resetTestState();
  mock.restoreAll();
});

const row = (id: string) =>
  db.prisma.user.findUniqueOrThrow({
    where: { id },
    include: { denAssignments: true, parentContacts: true },
  });

describe("a plain Admin can't change denmatt; a master admin can", () => {
  it("assertCanMutateUser itself", async () => {
    const asAdmin = await settle(runAs(admin, () => auth.getSession().then((s) => authz.assertCanMutateUser(s!, denmatt))));
    assert.ok(!asAdmin.ok && asAdmin.error.message === authz.MASTER_ONLY_ACCOUNT_MESSAGE);
    const asMaster = await settle(runAs(master, () => auth.getSession().then((s) => authz.assertCanMutateUser(s!, denmatt))));
    assert.ok(asMaster.ok);
  });

  it("den assignments", async () => {
    const before = await row(denmatt.id);
    const refused = await settle(runAs(admin, () => users.updateUserDensAction(form({ userId: denmatt.id, denIds: [denId] }))));
    assert.ok(!refused.ok);
    assert.equal(refused.error.message, authz.MASTER_ONLY_ACCOUNT_MESSAGE);
    const after = await row(denmatt.id);
    assert.equal(after.denAssignments.length, 0);
    assert.equal(after.sessionVersion, before.sessionVersion, "a refused change still signed the account out");

    await runAs(master, () => users.updateUserDensAction(form({ userId: denmatt.id, denIds: [denId] })));
    assert.equal((await row(denmatt.id)).denAssignments.length, 1);
    await runAs(master, () => users.updateUserDensAction(form({ userId: denmatt.id })));
  });

  it("linked children: attach, unlink and remove", async () => {
    const refusedAttach = await settle(runAs(admin, () => parents.attachParentToScoutAction(form({ userId: denmatt.id, scoutId }))));
    assert.ok(!refusedAttach.ok && refusedAttach.error.message === authz.MASTER_ONLY_ACCOUNT_MESSAGE);
    assert.equal((await row(denmatt.id)).parentContacts.length, 0);

    await runAs(master, () => parents.attachParentToScoutAction(form({ userId: denmatt.id, scoutId })));
    const contact = (await row(denmatt.id)).parentContacts[0];
    assert.ok(contact);
    const sv = (await row(denmatt.id)).sessionVersion;

    const refusedUnlink = await runAs(admin, () => parents.unlinkParentScoutAction(contact.id));
    assert.equal(refusedUnlink.ok, false);
    const refusedRemove = await settle(runAs(admin, () => parents.removeParentAction(form({ parentId: contact.id }))));
    assert.ok(!refusedRemove.ok);
    assert.equal((await row(denmatt.id)).parentContacts.length, 1);
    assert.equal((await row(denmatt.id)).sessionVersion, sv);

    const unlinked = await runAs(master, () => parents.unlinkParentScoutAction(contact.id));
    assert.equal(unlinked.ok, true);
    assert.equal((await row(denmatt.id)).parentContacts.length, 0);
    await db.prisma.parent.delete({ where: { id: contact.id } });
  });

  it("households", async () => {
    const refusedAdd = await settle(runAs(admin, () => households.addUserToHouseholdAction(form({ householdId, userId: denmatt.id }))));
    assert.ok(!refusedAdd.ok && refusedAdd.error.message === authz.MASTER_ONLY_ACCOUNT_MESSAGE);
    assert.equal((await row(denmatt.id)).householdId, null);

    await runAs(master, () => households.addUserToHouseholdAction(form({ householdId, userId: denmatt.id })));
    assert.equal((await row(denmatt.id)).householdId, householdId);

    const refusedRemove = await settle(
      runAs(admin, () => households.removeUserFromHouseholdAction(form({ householdId, userId: denmatt.id }))),
    );
    assert.ok(!refusedRemove.ok);
    assert.equal((await row(denmatt.id)).householdId, householdId);
    await runAs(master, () => households.removeUserFromHouseholdAction(form({ householdId, userId: denmatt.id })));
    assert.equal((await row(denmatt.id)).householdId, null);
  });

  it("contact details, role, status, password and deleting it", async () => {
    const before = await row(denmatt.id);
    for (const [action, values] of [
      [users.updateUserEmailAction, { email: "x@example.com" }],
      [users.updateUserPhoneAction, { phone: "2125551234" }],
      [users.updateUserDisplayNameAction, { displayName: "Renamed" }],
      [users.setUserActiveAction, { active: "false" }],
    ] as const) {
      const refused = await settle(runAs(admin, () => action(form({ userId: denmatt.id, ...values }))));
      assert.ok(!refused.ok, action.name);
    }
    const role = await runAs(admin, () => users.updateUserRoleAction({}, form({ userId: denmatt.id, role: "COMMITTEE" })));
    assert.deepEqual(role, { error: authz.MASTER_ONLY_ACCOUNT_MESSAGE });
    assert.deepEqual(await runAs(admin, () => users.resetPasswordAction(denmatt.id)), {
      ok: false,
      error: authz.MASTER_ONLY_ACCOUNT_MESSAGE,
    });
    assert.deepEqual(await runAs(admin, () => users.deleteUserAction(denmatt.id)), {
      ok: false,
      error: authz.MASTER_ONLY_ACCOUNT_MESSAGE,
    });

    const after = await row(denmatt.id);
    assert.equal(after.email, null);
    assert.equal(after.phone, null);
    assert.equal(after.displayName, "denmatt");
    assert.equal(after.role, "DEN");
    assert.equal(after.active, true);
    assert.equal(after.sessionVersion, before.sessionVersion);

    // The master admin can.
    await runAs(master, () => users.updateUserDisplayNameAction(form({ userId: denmatt.id, displayName: "Den Matt" })));
    assert.equal((await row(denmatt.id)).displayName, "Den Matt");
  });

  it("an ordinary Den Leader login stays any Admin's to change", async () => {
    await runAs(admin, () => users.updateUserDensAction(form({ userId: denLeader.id, denIds: [denId] })));
    assert.equal((await row(denLeader.id)).denAssignments.length, 1);
    await runAs(admin, () => households.addUserToHouseholdAction(form({ householdId, userId: denLeader.id })));
    assert.equal((await row(denLeader.id)).householdId, householdId);
  });
});

describe("denmatt is reserved", () => {
  it("can't be created as a staff, den or parent login", async () => {
    const asStaff = await runAs(master, () => users.createAdminAction("DenMatt", "Impostor", "DEN"));
    assert.equal(asStaff.ok, false);
    if (!asStaff.ok) assert.match(asStaff.error, /reserved/);
    const asParent = await runAs(master, () => parents.createParentAccountAction("denmatt", "Impostor"));
    assert.equal(asParent.ok, false);
    if (!asParent.ok) assert.match(asParent.error, /reserved/);
  });
});

describe("payment deletes refuse non-admins before looking anything up", () => {
  it("a Den Leader gets the Admin refusal, not 'Payment not found', for any id", async () => {
    // Earlier tests changed this login's dens, which signs it out: sign in afresh.
    const leader = { ...denLeader, sessionVersion: (await row(denLeader.id)).sessionVersion };
    for (const action of [events.deleteEventPaymentAction, events.deleteGuestGroupPaymentAction]) {
      const result = await settle(
        runAs(leader, () => action(form({ paymentId: "does-not-exist", registrationId: "x", guestGroupId: "x", eventId: "x" }))),
      );
      assert.ok(!result.ok);
      assert.equal(result.error.message, "Not authorized: admin only.", action.name);
    }
  });
});

describe("contact fields are bounded", () => {
  it("the Users panel refuses an invalid email, an over-long name or phone", async () => {
    for (const [action, values] of [
      [users.updateUserEmailAction, { email: "not an email" }],
      [users.updateUserDisplayNameAction, { displayName: "x".repeat(121) }],
      [users.updateUserPhoneAction, { phone: "1".repeat(41) }],
    ] as const) {
      const refused = await settle(runAs(admin, () => action(form({ userId: denLeader.id, ...values }))));
      assert.ok(!refused.ok, action.name);
    }
    const after = await row(denLeader.id);
    assert.equal(after.email, null);
    assert.equal(after.phone, null);
    assert.equal(after.displayName, "guards-den");
  });

  it("parent contacts and Parent Portal logins too", async () => {
    const add = await settle(runAs(admin, () => parents.addParentAction(form({ scoutId, name: "Pat", email: "nope" }))));
    assert.ok(!add.ok);
    assert.equal(await db.prisma.parent.count({ where: { scoutId, name: "Pat" } }), 0);

    const create = await runAs(admin, () => parents.createParentAccountAction("pat@example.com", "x".repeat(121)));
    assert.equal(create.ok, false);
    const badPhone = await runAs(admin, () => parents.createParentAccountAction("pat@example.com", "Pat", undefined, "1".repeat(41)));
    assert.equal(badPhone.ok, false);
    assert.equal(await db.prisma.user.count({ where: { username: "pat@example.com" } }), 0);

    const contact = await db.prisma.parent.create({ data: { scoutId, name: "Pat Parent" } });
    const update = await settle(
      runAs(admin, () => parents.updateParentAction(form({ parentId: contact.id, name: "Pat", phone: "1".repeat(41) }))),
    );
    assert.ok(!update.ok);
    assert.equal((await db.prisma.parent.findUniqueOrThrow({ where: { id: contact.id } })).name, "Pat Parent");
  });
});

describe("the public photo route only fetches our own event photos", () => {
  async function photoWith(imageUrl: string) {
    const album = await db.prisma.photoAlbum.create({
      data: { title: "Pack Night", eventDate: new Date("2026-10-01T00:00:00Z"), isVisible: true },
    });
    return db.prisma.albumPhoto.create({ data: { albumId: album.id, imageUrl, thumbUrl: imageUrl, width: 800, height: 600, sortOrder: 0 } });
  }

  it("answers 404 without fetching when the row points anywhere else", async () => {
    mock.method(console, "error", () => {});
    const fetchMock = mock.method(globalThis, "fetch", async () => new Response("should not be fetched"));
    const photo = await photoWith("https://169.254.169.254/latest/meta-data");
    const { result } = await asAnonymous(() =>
      photoRoute.GET(new Request("http://localhost/album-photos/x/full"), {
        params: Promise.resolve({ photoId: photo.id, size: "full" }),
      }),
    );
    assert.equal(result.status, 404);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it("fetches an owned photo with no redirects and a timeout", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => new Response("jpeg-bytes", { status: 200 }));
    const photo = await photoWith("https://jyclzu7uphezevn7.public.blob.vercel-storage.com/album-photos/a.jpg");
    const { result } = await asAnonymous(() =>
      photoRoute.GET(new Request("http://localhost/album-photos/x/full"), {
        params: Promise.resolve({ photoId: photo.id, size: "full" }),
      }),
    );
    assert.equal(result.status, 200);
    assert.equal(fetchMock.mock.callCount(), 1);
    const init = fetchMock.mock.calls[0].arguments[1] as RequestInit;
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
  });
});
