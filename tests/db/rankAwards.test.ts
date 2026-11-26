/*
 * Rank badge awards against the real database: the audit page's rank rows and
 * checks, Pending Awards' rank items, the bulk award and Undo carrying them,
 * the card's set / change / clear, the audit log for each, Flag/Resolve on a
 * badge, the read-only status the Parent Dashboard and roster show, and the
 * season link Promote Den makes for "Previous ranks".
 *
 * Bear only, on a five-adventure Bear checklist made once in before():
 * "earned" means every required adventure of the rank, so a stray extra one
 * would un-earn every scout.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { withTestDatabase } from "../support/db";
import { asAnonymous, form, resetTestState, runAs, settle, type SessionUser } from "../support/context";
import { packFixtures } from "./fixtures/pack";

const db = withTestDatabase("rank_awards");
let advancement: typeof import("@/lib/actions/advancement");
let auditActions: typeof import("@/lib/actions/advancementAudit");
let dens: typeof import("@/lib/actions/dens");
let pending: typeof import("@/lib/pendingAwardsData");
let audit: typeof import("@/lib/advancementAuditData");
let rankStatus: typeof import("@/lib/rankStatus");
let denData: typeof import("@/lib/denData");
let fx: ReturnType<typeof packFixtures>;
let admin: SessionUser;

const NOW = new Date("2026-11-25T15:00:00Z");
const NO_FILTERS = { denId: null, type: "all" as const, adventure: null, before: null };
const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const ymd = (date: Date | null | undefined) => date?.toISOString().slice(0, 10) ?? null;

before(async () => {
  await db.ready;
  advancement = await import("@/lib/actions/advancement");
  auditActions = await import("@/lib/actions/advancementAudit");
  dens = await import("@/lib/actions/dens");
  pending = await import("@/lib/pendingAwardsData");
  audit = await import("@/lib/advancementAuditData");
  rankStatus = await import("@/lib/rankStatus");
  denData = await import("@/lib/denData");
  fx = packFixtures(db.prisma);
  admin = await fx.user("ADMIN");
  // A small Bear checklist of our own: two required adventures, three electives.
  if ((await db.prisma.adventure.count({ where: { rank: "BEAR" } })) === 0) {
    await db.prisma.adventure.createMany({
      data: [
        { rank: "BEAR", name: "Bear Required A", type: "REQUIRED", sortOrder: 1 },
        { rank: "BEAR", name: "Bear Required B", type: "REQUIRED", sortOrder: 2 },
        { rank: "BEAR", name: "Bear Elective A", type: "ELECTIVE", sortOrder: 3 },
        { rank: "BEAR", name: "Bear Elective B", type: "ELECTIVE", sortOrder: 4 },
        { rank: "BEAR", name: "Bear Elective C", type: "ELECTIVE", sortOrder: 5 },
      ],
    });
  }
});

beforeEach(() => resetTestState());

/** Bear's required adventures and its first two electives — exactly what earns the badge. */
async function bearAdventures() {
  const all = await db.prisma.adventure.findMany({ where: { rank: "BEAR" }, orderBy: { sortOrder: "asc" } });
  return {
    required: all.filter((a) => a.type === "REQUIRED"),
    electives: all.filter((a) => a.type === "ELECTIVE").slice(0, 2),
  };
}

/** Completes every adventure the badge needs; the last required one on `lastDate`. */
async function earnBear(scoutId: string, lastDate = "2026-10-20") {
  const { required, electives } = await bearAdventures();
  const list = [...electives, ...required];
  for (const [i, adv] of list.entries()) {
    await db.prisma.advancementRecord.create({
      data: {
        scoutId,
        adventureId: adv.id,
        completed: true,
        completedDate: d(i === list.length - 1 ? lastDate : "2026-09-20"),
      },
    });
  }
  return { required, electives, last: list[list.length - 1] };
}

async function bearDen() {
  const den = await fx.den("BEAR");
  const earned = await fx.scout(den.id, { firstName: "Avery" });
  const partway = await fx.scout(den.id, { firstName: "Blake" });
  const { required, last } = await earnBear(earned.id);
  await db.prisma.advancementRecord.create({
    data: { scoutId: partway.id, adventureId: required[0].id, completed: true, completedDate: d("2026-09-20") },
  });
  const leader = await fx.user("DEN", { denIds: [den.id] });
  return { den, earned, partway, required, last, leader };
}

const rankItem = (scoutId: string) => ({ scoutId, adventureId: "rank:BEAR" });

async function auditPage(user: SessionUser, denId: string) {
  return runAs(user, async () => {
    const { getSession } = await import("@/lib/auth");
    return audit.loadAdvancementAudit((await getSession())!, audit.parseAdvancementAuditFilters({ year: "2026-2027", denId }, NOW));
  });
}

const rankRow = (records: { kind: string; scoutId: string }[], scoutId: string) =>
  records.find((r) => r.kind === "rank" && r.scoutId === scoutId) as
    | (Awaited<ReturnType<typeof auditPage>>["records"][number])
    | undefined;

describe("rank awards: listing", () => {
  it("shows an earned badge as Ready for award on the audit page and in Pending Awards, with the same count", async () => {
    const { den, earned, partway, leader } = await bearDen();
    const page = await auditPage(leader, den.id);
    const row = rankRow(page.records, earned.id)!;
    assert.equal(row.status, "READY_FOR_AWARD");
    assert.equal(row.adventureName, "Bear rank badge");
    assert.equal(row.completedDate, "2026-10-20", "earned on the last needed completion");
    assert.equal(rankRow(page.records, partway.id), undefined, "in progress: no row");

    const list = await runAs(leader, async () => {
      const { getSession } = await import("@/lib/auth");
      return pending.loadPendingAwards((await getSession())!, { ...NO_FILTERS, denId: den.id }, NOW);
    });
    assert.equal(list.readyForAwardTotal, page.metrics.readyForAward);
    const ranksOnly = await runAs(leader, async () => {
      const { getSession } = await import("@/lib/auth");
      return pending.loadPendingAwards((await getSession())!, { ...NO_FILTERS, denId: den.id, type: "ranks" }, NOW);
    });
    assert.deepEqual(ranksOnly.items.map((i) => i.key), [`${earned.id}:rank:BEAR`]);
  });
});

describe("rank awards: bulk award and undo", () => {
  it("awards the badge with adventures, skips one earned after the date, and logs it in the scout's entry", async () => {
    const { den, earned, partway, last, leader } = await bearDen();
    const late = await fx.scout(den.id, { firstName: "Casey" });
    await earnBear(late.id, "2026-11-20");

    const result = await runAs(leader, () =>
      advancement.awardPendingAction(
        [rankItem(earned.id), { scoutId: earned.id, adventureId: last.id }, rankItem(late.id), rankItem(partway.id)],
        "2026-11-15",
      ),
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.awarded, 2);
    assert.equal(result.undo?.items.length, 2);
    assert.deepEqual(
      result.skipped.map((s) => [s.scoutName.split(" ")[0], s.reason]).sort(),
      [["Blake", "not_pending"], ["Casey", "completed_after"]],
    );
    const row = await db.prisma.scoutRankAward.findUniqueOrThrow({ where: { scoutId_rank: { scoutId: earned.id, rank: "BEAR" } } });
    assert.equal(ymd(row.awardedDate), "2026-11-15");
    assert.ok(row.updatedByUserId);

    const entry = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "advancement.update", entityId: earned.id } });
    assert.match(entry.summary, /^Awarded 1 adventure and the Bear rank badge for Avery .* \(award date Nov 15, 2026\)$/);
    assert.deepEqual(entry.details, [
      { label: last.name, from: "Complete Oct 20, 2026", to: "Complete Oct 20, 2026 · awarded Nov 15, 2026" },
      { label: "Bear rank badge", from: "—", to: "Awarded Nov 15, 2026" },
    ]);

    const page = await auditPage(admin, den.id);
    const auditRow = rankRow(page.records, earned.id)!;
    assert.equal(auditRow.status, "AWARDED");
    const history = await audit.getAdvancementHistory([auditRow]);
    assert.equal(history.get(auditRow.recordId)?.length, 1, "the audit page's History finds it");

    // Awarding it again does nothing more.
    const again = await runAs(leader, () => advancement.awardPendingAction([rankItem(earned.id)], "2026-11-16"));
    assert.ok(again.ok && again.awarded === 0 && again.skipped[0].reason === "not_pending");
  });

  it("refuses another rank's badge, another den's scout and a parent", async () => {
    const { earned, leader } = await bearDen();
    const other = await bearDen();
    assert.deepEqual(
      await runAs(leader, () => advancement.awardPendingAction([{ scoutId: earned.id, adventureId: "rank:WOLF" }], "2026-11-15")),
      { ok: false, error: "One or more of those rank badges isn't its scout's rank. Reload the page and try again." },
    );
    assert.deepEqual(await runAs(leader, () => advancement.awardPendingAction([rankItem(other.earned.id)], "2026-11-15")), {
      ok: false,
      error: "Not authorized for this den.",
    });
    const parent = await fx.user("PARENT", { scoutIds: [earned.id] });
    assert.equal((await runAs(parent, () => advancement.awardPendingAction([rankItem(earned.id)], "2026-11-15"))).ok, false);
    assert.equal(await db.prisma.scoutRankAward.count({ where: { scoutId: { in: [earned.id, other.earned.id] } } }), 0);
  });

  it("undo deletes the badge the batch created, unless it was changed since", async () => {
    const { earned } = await bearDen();
    const second = await bearDen();
    const result = await runAs(admin, () =>
      advancement.awardPendingAction([rankItem(earned.id), rankItem(second.earned.id)], "2026-11-15"),
    );
    assert.ok(result.ok && result.undo && result.undo.items.length === 2);

    // Someone changes the second one's date on its card.
    const changed = await runAs(second.leader, () => advancement.setRankAwardAction(second.earned.id, "2026-11-16"));
    assert.ok(changed.ok);

    const undo = await runAs(admin, () => advancement.undoAwardBatchAction(result.undo!));
    assert.ok(undo.ok, JSON.stringify(undo));
    assert.equal(undo.cleared, 1);
    assert.equal(undo.changedSince, 1);
    assert.deepEqual(undo.clearedKeys, [`${earned.id}:rank:BEAR`]);
    assert.equal(await db.prisma.scoutRankAward.count({ where: { scoutId: earned.id } }), 0);
    const kept = await db.prisma.scoutRankAward.findFirstOrThrow({ where: { scoutId: second.earned.id } });
    assert.equal(ymd(kept.awardedDate), "2026-11-16");

    const entry = await db.prisma.auditLog.findFirstOrThrow({
      where: { action: "advancement.update", entityId: earned.id, summary: { startsWith: "Undid" } },
    });
    assert.deepEqual(entry.details, [{ label: "Bear rank badge", from: "Awarded Nov 15, 2026", to: "—" }]);
  });
});

describe("rank awards: the card", () => {
  it("sets, changes and clears the award, logging each", async () => {
    const { earned, partway, leader } = await bearDen();
    const set = (scoutId: string, date: string | null, user = leader) =>
      runAs(user, () => advancement.setRankAwardAction(scoutId, date));

    assert.deepEqual(await set(partway.id, "2026-11-15"), {
      ok: false,
      error: "Blake hasn't earned the Bear rank badge yet — check off its adventures first.",
    });
    const early = await set(earned.id, "2026-10-19");
    assert.match(early.ok ? "" : early.error, /can't be before Avery earned the Bear rank badge \(Oct 20, 2026\)/);
    assert.deepEqual(await set(earned.id, "2099-01-01"), { ok: false, error: "The award date can't be in the future." });
    assert.equal(await db.prisma.scoutRankAward.count({ where: { scoutId: earned.id } }), 0);

    const first = await set(earned.id, "2026-11-15");
    assert.ok(first.ok && first.award?.awardedDate === "2026-11-15");
    const second = await set(earned.id, "2026-11-18");
    assert.ok(second.ok && second.award?.awardedDate === "2026-11-18");
    const same = await set(earned.id, "2026-11-18");
    assert.ok(same.ok);
    const cleared = await set(earned.id, null);
    assert.deepEqual(cleared, { ok: true, award: null });

    const entries = await db.prisma.auditLog.findMany({
      where: { action: "advancement.update", entityId: earned.id },
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(
      entries.map((e) => e.details),
      [
        [{ label: "Bear rank badge", from: "—", to: "Awarded Nov 15, 2026" }],
        [{ label: "Bear rank badge", from: "Awarded Nov 15, 2026", to: "Awarded Nov 18, 2026" }],
        [{ label: "Bear rank badge", from: "Awarded Nov 18, 2026", to: "—" }],
      ],
      "an unchanged save isn't logged",
    );
    assert.match(entries[2].summary, /^Cleared the Bear rank badge award for Avery/);
  });

  it("refuses another den's leader, a parent, a signed-out user and an inactive scout", async () => {
    const { earned } = await bearDen();
    const other = await bearDen();
    assert.deepEqual(await runAs(other.leader, () => advancement.setRankAwardAction(earned.id, "2026-11-15")), {
      ok: false,
      error: "Not authorized for this den.",
    });
    const parent = await fx.user("PARENT", { scoutIds: [earned.id] });
    assert.equal((await runAs(parent, () => advancement.setRankAwardAction(earned.id, "2026-11-15"))).ok, false);
    const anon = await asAnonymous(() => advancement.setRankAwardAction(earned.id, "2026-11-15"));
    assert.deepEqual(anon.result, { ok: false, error: "Not authorized." });
    await db.prisma.scout.update({ where: { id: earned.id }, data: { active: false } });
    const inactive = await runAs(admin, () => advancement.setRankAwardAction(earned.id, "2026-11-15"));
    assert.equal(inactive.ok, false);
    assert.equal(await db.prisma.scoutRankAward.count({ where: { scoutId: earned.id } }), 0);
  });
});

describe("rank awards: audit checks and marks", () => {
  it("keeps an award whose adventure was unchecked, flags it, and lets an Admin resolve it until it's edited", async () => {
    const { den, earned, required } = await bearDen();
    assert.ok((await runAs(admin, () => advancement.setRankAwardAction(earned.id, "2026-11-15"))).ok);
    const uncheck = await runAs(admin, () =>
      advancement.applyAdventureChangesAction(earned.id, [{ adventureId: required[0].id, completed: false, completedDate: null, awardedDate: null }]),
    );
    assert.deepEqual(uncheck, { ok: true });

    let row = rankRow((await auditPage(admin, den.id)).records, earned.id)!;
    assert.equal(row.status, "FLAGGED");
    assert.deepEqual(row.discrepancies, ["RANK_NO_LONGER_EARNED"]);
    assert.equal(row.awardedDate, "2026-11-15", "the award is kept");

    const post = (values: Record<string, string | string[]>) =>
      settle(runAs(admin, () => auditActions.advancementAuditAction(form(values))));
    await post({ intent: "resolve", recordId: row.recordId, note: "Retook it at camp", back: "" });
    row = rankRow((await auditPage(admin, den.id)).records, earned.id)!;
    assert.equal(row.status, "RESOLVED");
    assert.equal(row.mark?.note, "Retook it at camp");
    const markEntry = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "advancement.audit.resolve", entityType: "ScoutRankAward" } });
    assert.match(markEntry.summary, /the Bear rank badge for Avery/);

    // Re-checking the adventure is an edit: the mark stops counting, and the badge is clean again.
    await runAs(admin, () =>
      advancement.applyAdventureChangesAction(earned.id, [{ adventureId: required[0].id, completed: true, completedDate: "2026-09-20", awardedDate: null }]),
    );
    row = rankRow((await auditPage(admin, den.id)).records, earned.id)!;
    assert.equal(row.status, "AWARDED");

    // A Den Leader can't mark a badge.
    const leader = await fx.user("DEN", { denIds: [den.id] });
    await settle(runAs(leader, () => auditActions.advancementAuditAction(form({ intent: "flag", recordId: row.recordId, note: "x", back: "" }))));
    assert.equal(await db.prisma.advancementAuditMark.count({ where: { kind: "NEEDS_CORRECTION" } }), 0);
  });

  it("flags an award dated before the badge was earned", async () => {
    const { den, earned } = await bearDen();
    await db.prisma.scoutRankAward.create({ data: { scoutId: earned.id, rank: "BEAR", awardedDate: d("2026-10-01") } });
    const row = rankRow((await auditPage(admin, den.id)).records, earned.id)!;
    assert.deepEqual(row.discrepancies, ["RANK_AWARDED_BEFORE_EARNED"]);
  });
});

describe("rank awards: read-only status and previous seasons", () => {
  it("gives the Parent Dashboard the badge even when a scout id repeats, and links seasons through Promote", async () => {
    const { den, earned } = await bearDen();
    assert.ok((await runAs(admin, () => advancement.setRankAwardAction(earned.id, "2026-11-15"))).ok);

    const forParent = await denData.getScoutsAdvancementByIds([earned.id, earned.id]);
    assert.equal(forParent.length, 1);
    assert.equal(forParent[0].rankStatus?.award?.awardedDate, "2026-11-15");
    assert.equal(forParent[0].adventures.length > 0, true, "relations still load with a repeated id");

    const promoted = await settle(
      runAs(admin, () => dens.promoteDenAction({}, form({ denId: den.id, scoutingYear: "2027-2028" }))),
    );
    assert.ok(!promoted.ok && /NEXT_REDIRECT/.test(String(promoted.error)), "promote redirects to the new den");
    const next = await db.prisma.scout.findFirstOrThrow({ where: { previousScoutId: earned.id } });
    const statuses = await rankStatus.loadRankStatuses([next.id]);
    const status = statuses.get(next.id)!;
    assert.equal(status.rank, "WEBELOS");
    assert.equal(status.award, null);
    assert.deepEqual(status.previous, [{ rank: "BEAR", rankLabel: "Bear", awardedDate: "2026-11-15", scoutingYear: "2026-2027" }]);
  });
});
