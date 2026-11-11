/*
 * Audits -> Advancement: who sees which dens, what each record's status comes
 * out as against the real database, and the flag / resolve / clear actions —
 * including that a Den Leader can't use them and that editing a record makes
 * an Admin's mark stop counting.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { withTestDatabase } from "../support/db";
import { form, resetTestState, runAs, settle, type SessionUser } from "../support/context";
import { packFixtures } from "./fixtures/pack";

const db = withTestDatabase("advancement_audit");
let data: typeof import("@/lib/advancementAuditData");
let actions: typeof import("@/lib/actions/advancementAudit");
let exportsLib: typeof import("@/lib/advancementAuditExport");
let fx: ReturnType<typeof packFixtures>;

before(async () => {
  await db.ready;
  data = await import("@/lib/advancementAuditData");
  actions = await import("@/lib/actions/advancementAudit");
  exportsLib = await import("@/lib/advancementAuditExport");
  fx = packFixtures(db.prisma);
});

beforeEach(() => resetTestState());

const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const filters = (overrides: Record<string, string> = {}) =>
  data.parseAdvancementAuditFilters({ year: "2026-2027", ...overrides });

/** Two Wolf dens, one scout each: one clean record, one with an award before completion, one never completed. */
async function setup() {
  const denA = await fx.den("WOLF");
  const denB = await fx.den("WOLF");
  const scoutA = await fx.scout(denA.id, { firstName: "Avery" });
  const scoutB = await fx.scout(denB.id, { firstName: "Blake" });
  const [adv1, adv2, adv3] = [await fx.adventure("WOLF"), await fx.adventure("WOLF"), await fx.adventure("WOLF")];
  const clean = await db.prisma.advancementRecord.create({
    data: { scoutId: scoutA.id, adventureId: adv1.id, completed: true, completedDate: d("2026-09-18") },
  });
  const bad = await db.prisma.advancementRecord.create({
    data: {
      scoutId: scoutB.id,
      adventureId: adv2.id,
      completed: true,
      completedDate: d("2026-10-09"),
      awardedDate: d("2026-09-01"),
    },
  });
  await db.prisma.advancementRecord.create({ data: { scoutId: scoutB.id, adventureId: adv3.id, completed: false } });
  const admin = await fx.user("ADMIN");
  const junior = await fx.user("JUNIOR_ADMIN");
  const leaderA = await fx.user("DEN", { denIds: [denA.id] });
  return { denA, denB, scoutA, scoutB, clean, bad, admin, junior, leaderA };
}

const statusOf = (records: { recordId: string; status: string }[], id: string) =>
  records.find((r) => r.recordId === id)?.status;

function post(user: SessionUser, values: Record<string, string | string[]>) {
  return settle(runAs(user, () => actions.advancementAuditAction(form(values))));
}

const redirectOf = (result: Awaited<ReturnType<typeof post>>) =>
  result.ok ? null : ((result.error as Error & { redirect?: string }).redirect ?? null);

describe("advancement audit: what each viewer sees", () => {
  it("an Admin sees every den, with each record's status", async () => {
    const { clean, bad, admin } = await setup();
    const { records, metrics } = await runAs(admin, async () => {
      const session = (await import("@/lib/auth")).getSession();
      return data.loadAdvancementAudit((await session)!, filters());
    });
    assert.equal(statusOf(records, clean.id), "READY_FOR_AWARD");
    assert.equal(statusOf(records, bad.id), "FLAGGED");
    assert.deepEqual(records.find((r) => r.recordId === bad.id)?.discrepancies, ["AWARDED_BEFORE_COMPLETED"]);
    // The never-completed record isn't audited; flagged rows sort first.
    assert.ok(records.length >= 2);
    assert.equal(records[0].status, "FLAGGED");
    assert.ok(metrics.needsReview >= 1 && metrics.readyForAward >= 1);
  });

  it("a Den Leader sees only their own den", async () => {
    const { clean, bad, leaderA } = await setup();
    const { records, dens } = await runAs(leaderA, async () =>
      data.loadAdvancementAudit((await (await import("@/lib/auth")).getSession())!, filters()),
    );
    assert.ok(records.some((r) => r.recordId === clean.id));
    assert.ok(!records.some((r) => r.recordId === bad.id));
    assert.ok(records.every((r) => leaderA.denIds!.includes(r.denId)));
    assert.deepEqual(
      dens.map((den) => den.id),
      leaderA.denIds,
    );
  });

  it("filters by status, search and completion date on the server", async () => {
    const { clean, bad, admin } = await setup();
    const run = (f: ReturnType<typeof filters>) =>
      runAs(admin, async () => data.loadAdvancementAudit((await (await import("@/lib/auth")).getSession())!, f));
    const review = await run(filters({ status: "review" }));
    assert.ok(review.records.some((r) => r.recordId === bad.id));
    assert.ok(!review.records.some((r) => r.recordId === clean.id));
    const search = await run(filters({ q: "avery" }));
    assert.ok(search.records.every((r) => r.scoutName.startsWith("Avery")));
    const dated = await run(filters({ from: "2026-10-01", to: "2026-10-31" }));
    assert.ok(dated.records.some((r) => r.recordId === bad.id));
    assert.ok(!dated.records.some((r) => r.recordId === clean.id));
  });

  it("the export loader turns away roles outside the audit and narrows a Den Leader", async () => {
    const { bad, leaderA } = await setup();
    const committee = await fx.user("COMMITTEE");
    const refused = await runAs(committee, () => exportsLib.loadAdvancementAuditExport(new URLSearchParams()));
    assert.deepEqual(refused, { status: 403 });
    const leader = await runAs(leaderA, () =>
      exportsLib.loadAdvancementAuditExport(new URLSearchParams({ year: "2026-2027" })),
    );
    if ("status" in leader) throw new Error(`refused with ${leader.status}`);
    assert.ok(!leader.records.some((r) => r.recordId === bad.id));
    assert.match(exportsLib.buildAdvancementAuditCsv(leader.records), /^Scout,Den,Rank/);
  });
});

describe("advancement audit: flag, resolve, clear", () => {
  it("an Admin flags a record for correction; it clears itself once the record is edited", async () => {
    const { clean, admin } = await setup();
    const result = await post(admin, { intent: "flag", recordId: [clean.id], note: "Check the date", back: "year=2026-2027" });
    assert.match(redirectOf(result) ?? "", /done=flag&n=1&skipped=0/);

    const mark = await db.prisma.advancementAuditMark.findUniqueOrThrow({ where: { recordId: clean.id } });
    assert.equal(mark.kind, "NEEDS_CORRECTION");
    const log = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "advancement.audit.flag", entityId: clean.id } });
    assert.match(log.summary, /Check the date/);

    const load = () =>
      runAs(admin, async () => data.loadAdvancementAudit((await (await import("@/lib/auth")).getSession())!, filters()));
    assert.equal(statusOf((await load()).records, clean.id), "NEEDS_CORRECTION");

    // The den leader fixes it: any save bumps updatedAt.
    await db.prisma.advancementRecord.update({ where: { id: clean.id }, data: { completedDate: d("2026-09-19") } });
    assert.equal(statusOf((await load()).records, clean.id), "READY_FOR_AWARD");
  });

  it("resolve only takes records that fail a check; clear removes the mark", async () => {
    const { clean, bad, junior } = await setup();
    const result = await post(junior, { intent: "resolve", recordId: [clean.id, bad.id], note: "Award date is right", back: "" });
    assert.match(redirectOf(result) ?? "", /done=resolve&n=1&skipped=1/);
    assert.equal((await db.prisma.advancementAuditMark.findUnique({ where: { recordId: clean.id } })), null);
    assert.equal((await db.prisma.advancementAuditMark.findUniqueOrThrow({ where: { recordId: bad.id } })).kind, "RESOLVED");

    const cleared = await post(junior, { intent: "clear", recordId: [bad.id], back: "" });
    assert.match(redirectOf(cleared) ?? "", /done=clear&n=1/);
    assert.equal(await db.prisma.advancementAuditMark.count({ where: { recordId: bad.id } }), 0);
  });

  it("a note is required to flag or resolve", async () => {
    const { bad, admin } = await setup();
    const result = await post(admin, { intent: "flag", recordId: [bad.id], note: "   ", back: "" });
    assert.match(redirectOf(result) ?? "", /error=note/);
    assert.equal(await db.prisma.advancementAuditMark.count({ where: { recordId: bad.id } }), 0);
  });

  it("a Den Leader can't flag or resolve, even in their own den", async () => {
    const { clean, leaderA } = await setup();
    const result = await post(leaderA, { intent: "resolve", recordId: [clean.id], note: "fine", back: "" });
    assert.match(redirectOf(result) ?? "", /error=denied/);
    const flagged = await post(leaderA, { intent: "flag", recordId: [clean.id], note: "x", back: "" });
    assert.match(redirectOf(flagged) ?? "", /error=denied/);
    assert.equal(await db.prisma.advancementAuditMark.count({ where: { recordId: clean.id } }), 0);
  });

  it("the redirect stays on the audit page whatever 'back' says", async () => {
    const { bad, admin } = await setup();
    const result = await post(admin, { intent: "clear", recordId: [bad.id], back: "//evil.example/x" });
    assert.match(redirectOf(result) ?? "", /^\/portal\/audits\/advancement\?/);
  });
});
