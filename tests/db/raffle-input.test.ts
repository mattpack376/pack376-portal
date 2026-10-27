/*
 * Raffle input bounds, the record importer, the payer-history lookup, and the
 * guarded migrations behind the buyer-name index and the CHECK constraints.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { withTestDatabase } from "../support/db";
import { form, runAs, settle } from "../support/context";
import { editEntryForm, newId, raffleTestKit, type RaffleActions, type TestUser } from "./raffle-support";

const db = withTestDatabase("raffle_input");
const kit = raffleTestKit(db);
let raffles: RaffleActions;
let raffleData: typeof import("@/lib/raffleData");
let admin: TestUser;
let helper: TestUser;

before(async () => {
  await db.ready;
  raffles = await import("@/lib/actions/raffles");
  raffleData = await import("@/lib/raffleData");
  admin = await kit.makeUser("ADMIN");
  helper = await kit.makeUser("PHOTOGRAPHER", { raffleHelper: true });
});

const long = (length: number) => "x".repeat(length);

/** A redirect thrown by a successful create/import (the next/navigation stand-in). */
function redirectTarget(error: unknown) {
  return (error as { redirect?: string }).redirect ?? null;
}

describe("text and amount limits", () => {
  it("buyer names, payer names and notes are bounded, with nothing saved when refused", async () => {
    const raffle = await kit.makeRaffle();
    const tooLong = await runAs(helper, () => raffles.assignBoxesAction(form({ raffleId: raffle.id, name: long(121), boxes: "1" })));
    assert.match(tooLong.error ?? "", /buyer's name can be at most 120 characters/);
    const payer = await runAs(helper, () =>
      raffles.assignBoxesAction(form({ raffleId: raffle.id, name: "Ann", boxes: "1", paid: "CASH", payerName: long(121) })),
    );
    assert.match(payer.error ?? "", /can be at most 120 characters/);
    const nul = await runAs(helper, () => raffles.assignBoxesAction(form({ raffleId: raffle.id, name: "A\u0000nn", boxes: "1" })));
    assert.match(nul.error ?? "", /invisible NUL character/);
    assert.deepEqual(await kit.boardOf(raffle.id), []);

    const ann = await kit.sell(helper, raffles, raffle.id, long(120), "1");
    const notes = await runAs(helper, () => raffles.updateEntryAction(editEntryForm(ann, { name: "Ann", notes: long(2001) })));
    assert.match(notes.error ?? "", /notes can be at most 2000 characters/);
    assert.deepEqual(await runAs(helper, () => raffles.updateEntryAction(editEntryForm(ann, { name: "Ann", notes: long(2000) }))), {});
  });

  it("payment amounts, notes and void reasons are bounded", async () => {
    const raffle = await kit.makeRaffle();
    const ann = await kit.sell(helper, raffles, raffle.id, "Ann", "1");
    const pay = (fields: Record<string, string>) =>
      runAs(helper, () => raffles.recordPaymentAction(form({ raffleId: raffle.id, entryId: ann.id, method: "CASH", amount: "10", ...fields })));
    for (const amount of ["1000000.01", "1e3", "-5", "0", "10.001"]) {
      assert.match((await pay({ amount })).error ?? "", /Enter the amount received/, amount);
    }
    assert.match((await pay({ note: long(2001) })).error ?? "", /note can be at most 2000 characters/);
    assert.equal(await db.prisma.rafflePayment.count({ where: { raffleId: raffle.id } }), 0);

    assert.deepEqual(await pay({ amount: "1000000" }), {});
    const payment = await db.prisma.rafflePayment.findFirstOrThrow({ where: { raffleId: raffle.id } });
    const voided = await runAs(helper, () => raffles.voidPaymentAction(form({ paymentId: payment.id, reason: long(2001) })));
    assert.match(voided.error ?? "", /reason can be at most 2000 characters/);
    assert.equal((await db.prisma.rafflePayment.findUniqueOrThrow({ where: { id: payment.id } })).voidedAt, null);
  });

  it("raffle terms are bounded: name, notes, digits-only counts, and a whole board under $1,000,000", async () => {
    const create = (fields: Record<string, string | number>) =>
      settle(runAs(admin, () => raffles.createRaffleAction(form({ name: "Spring 50/50", boxCount: 100, price: "10", prizePercent: 50, ...fields }))));
    const refusals: [Record<string, string | number>, RegExp][] = [
      [{ name: long(121) }, /raffle name can be at most 120 characters/],
      [{ notes: long(2001) }, /notes can be at most 2000 characters/],
      [{ boxCount: "1e2" }, /number of boxes must be between 1 and 500/],
      [{ boxCount: 501 }, /between 1 and 500/],
      [{ prizePercent: "" }, /whole percentage from 0 to 100/],
      [{ prizePercent: "50.5" }, /whole percentage/],
      [{ boxCount: 500, price: "2000.01" }, /more than \$1,000,000/],
    ];
    for (const [fields, message] of refusals) {
      const result = await create(fields);
      assert.ok(result.ok, `refused with a message, not thrown: ${JSON.stringify(fields)}`);
      assert.match(result.value.error ?? "", message);
    }
    assert.equal(await db.prisma.raffle.count({ where: { name: "Spring 50/50" } }), 0);

    const created = await create({ boxCount: 500, price: "2000" });
    assert.ok(!created.ok && redirectTarget(created.error)?.startsWith("/portal/admin/raffles/"), "a full $1,000,000 board is allowed");
    const raffle = await db.prisma.raffle.findFirstOrThrow({ where: { name: "Spring 50/50" } });
    assert.equal(await kit.auditCount("raffle.create", raffle.id), 1);

    const edit = await runAs(admin, () =>
      raffles.updateRaffleAction(form({ raffleId: raffle.id, name: "Spring 50/50", boxCount: 500, price: "2000", prizePercent: 50, notes: long(2001) })),
    );
    assert.match(edit.error ?? "", /notes can be at most 2000/);
  });

  it("the winner's name is bounded and the winning box must be a plain number on the board", async () => {
    const raffle = await kit.makeRaffle({ boxCount: 20 });
    await kit.sell(helper, raffles, raffle.id, "Ann", "7");
    const draw = (fields: Record<string, string | number>) =>
      runAs(admin, () => raffles.recordWinnerAction(form({ raffleId: raffle.id, winningBox: 7, ...fields })));
    assert.match((await draw({ winnerName: long(121) })).error ?? "", /winner's name can be at most 120/);
    for (const winningBox of ["7.0", "0x7", "21", "0", ""]) {
      assert.match((await draw({ winningBox })).error ?? "", /from 1 to 20/, String(winningBox));
    }
    assert.deepEqual(await draw({}), {});
    assert.equal((await db.prisma.raffle.findUniqueOrThrow({ where: { id: raffle.id } })).winnerName, "Ann");
  });

  it("a closed raffle refuses changes with a message until it's reopened", async () => {
    const raffle = await kit.makeRaffle();
    assert.deepEqual(await runAs(admin, () => raffles.closeRaffleAction(form({ raffleId: raffle.id }))), {});
    const refused = await runAs(helper, () => raffles.assignBoxesAction(form({ raffleId: raffle.id, name: "Ann", boxes: "1" })));
    assert.match(refused.error ?? "", /closed\. Reopen it/);
    assert.deepEqual(await runAs(admin, () => raffles.reopenRaffleAction(form({ raffleId: raffle.id }))), {});
    await kit.sell(helper, raffles, raffle.id, "Ann", "1");
  });
});

describe("payer history", () => {
  it("matches payer names exactly (ignoring case), never as a pattern", async () => {
    const raffle = await kit.makeRaffle();
    const ann = await kit.sell(helper, raffles, raffle.id, "Ann", "1");
    assert.deepEqual(
      await runAs(helper, () =>
        raffles.recordPaymentAction(form({ raffleId: raffle.id, entryId: ann.id, amount: "10", method: "ZELLE", payerName: "Frank Smith" })),
      ),
      {},
    );
    const history = await raffleData.getPayerHistory(["%", "Fr_nk Smith", " FRANK smith "]);
    assert.deepEqual([...history.entries()], [["frank smith", "Ann"]]);
  });

  it("matches accented capitals the way buyer names match", async () => {
    const raffle = await kit.makeRaffle();
    const bea = await kit.sell(helper, raffles, raffle.id, "Bea", "1");
    assert.deepEqual(
      await runAs(helper, () =>
        raffles.recordPaymentAction(form({ raffleId: raffle.id, entryId: bea.id, amount: "10", method: "ZELLE", payerName: "Ángel Núñez" })),
      ),
      {},
    );
    // The Payments tab looks the hint up by buyerNameKey of the payer name.
    const history = await raffleData.getPayerHistory(["ÁNGEL NÚÑEZ"]);
    assert.deepEqual([...history.entries()], [["ángel núñez", "Bea"]]);
  });
});

describe("importing a past raffle record", () => {
  function record(overrides: Record<string, unknown> = {}) {
    return {
      format: "pack376-raffle-v1",
      name: `Imported ${newId("r")}`,
      drawingDate: "2026-10-10",
      boxCount: 50,
      priceDollars: 10,
      prizePercent: 50,
      closed: true,
      winner: { box: 2, paid: true, paidOn: "2026-10-11", method: "CASH" },
      buyers: [
        { name: "Frank Smith", boxes: [1, 2], payments: [{ method: "CASH", amountDollars: 20, verified: true }] },
        { name: "Frank Jones", boxes: [3], payments: [{ method: "zelle", amountDollars: 10, receivedOn: "2026-10-09", payerName: "F. Jones" }] },
        { name: "Jose Diaz", boxes: [4] },
      ],
      ...overrides,
    };
  }

  function importing(data: unknown) {
    const formData = new FormData();
    formData.set("file", new File([JSON.stringify(data)], "record.json", { type: "application/json" }));
    return settle(runAs(admin, () => raffles.importRaffleAction(formData)));
  }

  it("imports a whole record, namesakes with distinguishing names included", async () => {
    const data = record();
    const result = await importing(data);
    assert.ok(!result.ok, "a successful import redirects");
    assert.match(redirectTarget(result.error) ?? "", /^\/portal\/admin\/raffles\//);

    const raffle = await db.prisma.raffle.findFirstOrThrow({ where: { name: data.name }, include: { entries: true, boxes: true, payments: true } });
    assert.deepEqual(
      [raffle.status, raffle.winningBox, raffle.winnerName, raffle.prizeCents, raffle.prizePaid],
      ["CLOSED", 2, "Frank Smith", 2000, true],
    );
    assert.deepEqual(raffle.entries.map((entry) => entry.name).sort(), ["Frank Jones", "Frank Smith", "Jose Diaz"]);
    assert.equal(raffle.boxes.length, 4);
    assert.deepEqual(raffle.payments.map((payment) => payment.amountCents).sort(), [1000, 2000]);
    assert.equal(await kit.auditCount("raffle.import", raffle.id), 1);
  });

  it("refuses a record with two buyers of one name, an impossible date, or out-of-range values — saving nothing", async () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ buyers: [{ name: "Ana", boxes: [1] }, { name: "ANA", boxes: [2] }] }, /Ana and ANA are listed as two buyers with the same name/],
      [{ buyers: [{ name: "Ana María", boxes: [1] }, { name: "ANA MARÍA", boxes: [2] }] }, /Ana María and ANA MARÍA are listed as two buyers/],
      [{ drawingDate: "2026-02-31" }, /drawing date should be a real date/],
      [{ winner: { box: 2, paid: true, paidOn: "2026-13-01" } }, /date the prize was paid should be a real date/],
      [{ priceDollars: 0.001 }, /price per box should be a dollar amount/],
      [{ boxCount: 500, priceDollars: 2500 }, /more than \$1,000,000/],
      [{ buyers: [{ name: "Big", boxes: [1], payments: [{ method: "CASH", amountDollars: 2_000_000 }] }], winner: null }, /payment amount for Big/],
      [{ buyers: [{ name: long(121), boxes: [1] }], winner: null }, /name can be at most 120 characters/],
      [{ notes: long(2001) }, /raffle notes can be at most 2000 characters/],
      [{ buyers: [{ name: "Nul\u0000", boxes: [1] }], winner: null }, /invisible NUL character/],
    ];
    for (const [overrides, message] of cases) {
      const data = record(overrides);
      const result = await importing(data);
      assert.ok(result.ok, `refused with a message: ${JSON.stringify(overrides).slice(0, 60)}`);
      assert.match(result.value.error ?? "", message);
      assert.equal(await db.prisma.raffle.count({ where: { name: data.name } }), 0);
    }
  });

  it("the same record imported twice at once lands once", async () => {
    const data = record();
    const results = await Promise.all([importing(data), importing(data)]);
    const redirected = results.filter((result) => !result.ok && redirectTarget(result.error));
    const refused = results.filter((result) => result.ok && result.value.error);
    assert.equal(redirected.length, 1);
    assert.equal(refused.length, 1);
    assert.equal(await db.prisma.raffle.count({ where: { name: data.name } }), 1);
  });
});

describe("guarded migrations", () => {
  const nameIndexSql = readFileSync("prisma/migrations/20261027130000_raffle_buyer_name_unique/migration.sql", "utf8");
  const checksSql = readFileSync("prisma/migrations/20261027130001_raffle_check_constraints/migration.sql", "utf8");
  const CHECKS = [
    ["Raffle", "Raffle_terms_check"],
    ["Raffle", "Raffle_drawing_check"],
    ["RaffleBox", "RaffleBox_number_check"],
    ["RafflePayment", "RafflePayment_amountCents_check"],
  ] as const;

  async function hasIndex(name: string) {
    const { rows } = await db.pool.query(`SELECT 1 FROM pg_indexes WHERE indexname = $1`, [name]);
    return rows.length === 1;
  }
  async function constraints() {
    const { rows } = await db.pool.query(`SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[])`, [CHECKS.map(([, name]) => name)]);
    return rows.map((row) => row.conname as string).sort();
  }

  // These two tests change this file's own database (drop and re-add the
  // index and checks), so they run one after the other and restore it.
  it("the buyer-name index is skipped, not failed, when existing names collide", async () => {
    assert.equal(await hasIndex("RaffleEntry_raffleId_name_key"), true, "added by the migration on a clean database");
    await db.pool.query(`DROP INDEX "RaffleEntry_raffleId_name_key"`);
    const raffle = await kit.makeRaffle();
    const dupId = newId("entry");
    // The older of the two is the one a sale to that name finds.
    await db.pool.query(`INSERT INTO "RaffleEntry" (id, "raffleId", name, "createdAt") VALUES ($1, $2, 'Zed', now() - interval '1 minute')`, [
      newId("entry"),
      raffle.id,
    ]);
    await db.pool.query(`INSERT INTO "RaffleEntry" (id, "raffleId", name) VALUES ($1, $2, ' zed')`, [dupId, raffle.id]);

    await db.pool.query(nameIndexSql); // no error
    assert.equal(await hasIndex("RaffleEntry_raffleId_name_key"), false);

    // While old data still holds two "Zed"s, a sale to that name goes to the older one.
    assert.deepEqual(await runAs(helper, () => raffles.assignBoxesAction(form({ raffleId: raffle.id, name: "ZED", boxes: "1" }))), {});
    assert.deepEqual(await kit.boardOf(raffle.id), ["1:Zed"]);
    assert.equal(await db.prisma.raffleEntry.count({ where: { raffleId: raffle.id } }), 2, "no third Zed");

    await db.pool.query(`DELETE FROM "RaffleEntry" WHERE id = $1`, [dupId]);
    await db.pool.query(nameIndexSql);
    assert.equal(await hasIndex("RaffleEntry_raffleId_name_key"), true);
  });

  it("the buyer-name index is skipped, not failed, when an existing name is too long to index", async () => {
    // Names had no length limit before this branch. One past Postgres's
    // ~2.7 KB index-entry limit made CREATE INDEX fail with
    // program_limit_exceeded, which the first version's handler (unique
    // violations only) let through, failing the deploy.
    await db.pool.query(`DROP INDEX "RaffleEntry_raffleId_name_key"`);
    const raffle = await kit.makeRaffle();
    const longId = newId("entry");
    await db.pool.query(
      `INSERT INTO "RaffleEntry" (id, "raffleId", name)
       SELECT $1, $2, string_agg(md5(i::text), '') FROM generate_series(1, 120) AS i`,
      [longId, raffle.id],
    );

    await db.pool.query(nameIndexSql); // no error
    assert.equal(await hasIndex("RaffleEntry_raffleId_name_key"), false);

    await db.pool.query(`DELETE FROM "RaffleEntry" WHERE id = $1`, [longId]);
    // CREATE INDEX also indexes rows deleted so recently that an older
    // snapshot could still see them, so the long name has to be vacuumed away.
    await db.pool.query(`VACUUM "RaffleEntry"`);
    await db.pool.query(nameIndexSql);
    assert.equal(await hasIndex("RaffleEntry_raffleId_name_key"), true);
  });

  it("running either migration again on a database that already has them changes nothing and doesn't fail", async () => {
    await db.pool.query(nameIndexSql);
    await db.pool.query(checksSql);
    assert.equal(await hasIndex("RaffleEntry_raffleId_name_key"), true);
    assert.deepEqual(await constraints(), CHECKS.map(([, name]) => name).sort());
  });

  it("each CHECK constraint is skipped, not failed, when existing rows break it", async () => {
    assert.deepEqual(await constraints(), CHECKS.map(([, name]) => name).sort(), "added by the migration on a clean database");
    for (const [table, name] of CHECKS) await db.pool.query(`ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`);

    const raffle = await kit.makeRaffle();
    const zeroId = newId("pay");
    await db.pool.query(`INSERT INTO "RafflePayment" (id, "raffleId", method, "amountCents") VALUES ($1, $2, 'CASH', 0)`, [zeroId, raffle.id]);
    await db.pool.query(checksSql); // no error
    assert.deepEqual(await constraints(), ["RaffleBox_number_check", "Raffle_drawing_check", "Raffle_terms_check"]);

    await db.pool.query(`DELETE FROM "RafflePayment" WHERE id = $1`, [zeroId]);
    for (const [table, name] of CHECKS.slice(0, 3)) await db.pool.query(`ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`);
    await db.pool.query(checksSql);
    assert.deepEqual(await constraints(), CHECKS.map(([, name]) => name).sort());
  });

  it("the constraints refuse what the pages never store", async () => {
    const raffle = await kit.makeRaffle();
    const ann = await kit.sell(helper, raffles, raffle.id, "Ann", "1");
    await assert.rejects(db.pool.query(`UPDATE "Raffle" SET "winningBox" = 1 WHERE id = $1`, [raffle.id]), /Raffle_drawing_check/);
    await assert.rejects(db.pool.query(`UPDATE "Raffle" SET "prizePaid" = true WHERE id = $1`, [raffle.id]), /Raffle_drawing_check/);
    await assert.rejects(db.pool.query(`UPDATE "Raffle" SET "prizePercent" = 101 WHERE id = $1`, [raffle.id]), /Raffle_terms_check/);
    await assert.rejects(
      db.pool.query(`INSERT INTO "RaffleBox" (id, "raffleId", "entryId", number) VALUES ($1, $2, $3, 0)`, [newId("box"), raffle.id, ann.id]),
      /RaffleBox_number_check/,
    );
    await assert.rejects(
      db.pool.query(`INSERT INTO "RafflePayment" (id, "raffleId", method, "amountCents") VALUES ($1, $2, 'CASH', -100)`, [newId("pay"), raffle.id]),
      /RafflePayment_amountCents_check/,
    );
    // The winner, its clearing and the prize payout all fit the drawing rule.
    assert.deepEqual(await runAs(admin, () => raffles.recordWinnerAction(form({ raffleId: raffle.id, winningBox: 1 }))), {});
    assert.deepEqual(
      await runAs(admin, () => raffles.setPrizePaidAction(form({ raffleId: raffle.id, prizePaid: "true", prizePaidOn: "2026-10-27", prizePaidMethod: "CASH" }))),
      {},
    );
    assert.deepEqual(await runAs(admin, () => raffles.clearWinnerAction(form({ raffleId: raffle.id }))), {});
  });
});
