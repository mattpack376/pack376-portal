/*
 * The dues tracker exports (Dues page → Export PDF / Export CSV / Payments
 * CSV): who may download them, and that the model, CSVs and PDF carry the
 * page's figures — custom rates, overpaid, partial, no fee set, inactive
 * scouts, typed-in names that look like formulas, and date-only payment dates.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";
import { canExportDues } from "@/lib/authorize";
import { buildDuesExportModel, duesExportFilename, type DuesOverviewInput } from "@/lib/duesExportModel";
import { buildDuesBalancesCsv, buildDuesPaymentsCsv } from "@/lib/duesCsv";
import { buildDuesPdf } from "@/lib/duesPdf";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`); // how Prisma hands back a @db.Date

function scout(
  firstName: string,
  lastName: string,
  dueCents: number | null,
  payments: [string, number, string?][] = [],
  extra: { active?: boolean; isOverridden?: boolean } = {}
) {
  const paidCents = payments.reduce((sum, [, cents]) => sum + cents, 0);
  return {
    firstName,
    lastName,
    active: extra.active ?? true,
    dueCents,
    isOverridden: extra.isOverridden ?? false,
    paidCents,
    remainingCents: dueCents === null ? null : dueCents - paidCents,
    payments: payments.map(([iso, amountCents, note]) => ({ paidOn: d(iso), amountCents, note: note ?? null })),
  };
}

const overview: DuesOverviewInput = {
  scoutingYear: "2026-2027",
  amountCents: 10000,
  dens: [
    {
      rank: "LION",
      label: null,
      scouts: [
        scout("Ava", "Adams", 10000, [["2026-09-12", 10000]]),
        scout("Ben", "Adams", 8000, [["2026-09-12", 4000, "sibling, half now"]], { isOverridden: true }),
      ],
    },
    {
      rank: "TIGER",
      label: "B",
      scouts: [
        scout("=HYPERLINK(1)", "@Evil", 10000, [["2026-10-01", 12000, "+cmd"]]),
        scout("Cal", "Gone", 10000, [], { active: false }),
      ],
    },
    { rank: "WOLF", label: null, scouts: [] },
  ],
};

describe("dues export access", () => {
  it("lets only Admin download", () => {
    assert.equal(canExportDues({ role: "ADMIN" }), true);
    for (const role of ["JUNIOR_ADMIN", "COMMITTEE", "DEN", "ATTENDANCE_ADMIN", "PHOTOGRAPHER", "PARENT", "TRIP_VIEWER"] as const) {
      assert.equal(canExportDues({ role }), false, role);
    }
  });
});

describe("dues export model", () => {
  const model = buildDuesExportModel(overview);

  it("matches the page's three cards", () => {
    // Due: 100 + 80 + 100 + 100; paid: 100 + 40 + 120.
    assert.equal(model.totalDueCents, 38000);
    assert.equal(model.collectedCents, 26000);
    assert.equal(model.remainingCents, 12000);
    assert.equal(model.scoutCount, 4);
  });

  it("subtotals each den and keeps empty and inactive ones", () => {
    assert.deepEqual(
      model.dens.map((den) => [den.name, den.dueCents, den.paidCents, den.remainingCents, den.scouts.length]),
      [
        ["Lion", 18000, 14000, 4000, 2],
        ["Tiger B", 20000, 12000, 8000, 2],
        ["Wolf", 0, 0, 0, 0],
      ]
    );
    assert.equal(model.dens[1].scouts[1].active, false);
  });

  it("uses the page's status labels", () => {
    assert.deepEqual(
      model.dens.flatMap((den) => den.scouts.map((s) => s.status)),
      ["Paid in Full", "Partial", "Overpaid", "Unpaid"]
    );
  });

  it("lists payments in page order with the last payment date", () => {
    assert.equal(model.payments.length, 3);
    assert.equal(model.dens[0].scouts[1].paymentCount, 1);
    assert.equal(model.dens[1].scouts[1].lastPaidOn, null);
  });

  it("never invents a $0 fee when the season fee isn't set", () => {
    const unset = buildDuesExportModel({
      scoutingYear: "2027-2028",
      amountCents: null,
      dens: [{ rank: "BEAR", label: null, scouts: [scout("Dee", "Early", null, [["2027-07-04", 2500]])] }],
    });
    assert.equal(unset.totalDueCents, null);
    assert.equal(unset.remainingCents, null);
    assert.equal(unset.collectedCents, 2500);
    assert.equal(unset.dens[0].scouts[0].status, "Fee Not Set");
    const csv = buildDuesBalancesCsv(unset).split("\n");
    assert.equal(csv[1], "2027-2028,Bear,Early,Dee,Yes,,,25.00,,Fee Not Set,1,2027-07-04");
  });

  it("names the files from the year", () => {
    assert.equal(duesExportFilename("2026-2027", "balances", "pdf"), "pack376-dues-2026-2027.pdf");
    assert.equal(duesExportFilename("2026-2027", "payments", "csv"), "pack376-dues-2026-2027-payments.csv");
  });
});

describe("dues CSVs", () => {
  const model = buildDuesExportModel(overview);
  const balances = buildDuesBalancesCsv(model).split("\n");
  const payments = buildDuesPaymentsCsv(model).split("\n");

  it("writes one row per scout plus a total, money as plain dollars", () => {
    assert.equal(balances.length, 1 + 4 + 1);
    assert.equal(balances[2], "2026-2027,Lion,Adams,Ben,Yes,80.00,Yes,40.00,40.00,Partial,1,2026-09-12");
    assert.equal(balances[4], "2026-2027,Tiger B,Gone,Cal,No,100.00,,0.00,100.00,Unpaid,0,");
    assert.equal(balances[5], "2026-2027,All dens,Total,4 scouts,,380.00,,260.00,120.00,,3,");
  });

  it("keeps an overpaid balance a number and neutralizes formula-looking text", () => {
    assert.equal(balances[3], "2026-2027,Tiger B,'@Evil,'=HYPERLINK(1),Yes,100.00,,120.00,-20.00,Overpaid,1,2026-10-01");
    assert.equal(payments[3], "2026-2027,Tiger B,'@Evil,'=HYPERLINK(1),2026-10-01,120.00,'+cmd");
  });

  it("lists every payment with its date-only day and note", () => {
    assert.equal(payments[0], "Scouting Year,Den,Last Name,First Name,Paid On,Amount,Note");
    assert.equal(payments[2], '2026-2027,Lion,Adams,Ben,2026-09-12,40.00,"sibling, half now"');
  });
});

describe("dues PDF", () => {
  it("builds a readable PDF, even with characters Helvetica can't draw", async () => {
    const odd = structuredClone(overview);
    odd.dens[0].scouts[0].firstName = "Zoë 🏕️ 李";
    const bytes = await buildDuesPdf(buildDuesExportModel(odd), { now: new Date("2026-11-21T15:00:00Z") });
    const doc = await PDFDocument.load(bytes);
    assert.ok(doc.getPageCount() >= 1);
    assert.match(doc.getTitle() ?? "", /Dues 2026-2027$/);
  });

  it("runs a long den onto more pages without failing", async () => {
    const many = structuredClone(overview);
    many.dens[0].scouts = Array.from({ length: 120 }, (_, i) => scout(`Scout${i}`, "Long", 10000, [["2026-09-01", 5000]]));
    const doc = await PDFDocument.load(await buildDuesPdf(buildDuesExportModel(many)));
    assert.ok(doc.getPageCount() >= 3);
  });

  it("handles a year with no dens", async () => {
    const empty = buildDuesExportModel({ scoutingYear: "2026-2027", amountCents: null, dens: [] });
    const doc = await PDFDocument.load(await buildDuesPdf(empty));
    assert.equal(doc.getPageCount(), 1);
  });
});
