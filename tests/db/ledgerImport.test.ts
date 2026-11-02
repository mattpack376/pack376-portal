/*
 * The Ledger's one-time Sheet import against a real database, fed a CSV (the
 * upload path) so no Google request is made. Only the ledger accounts
 * (LEDGER_USERNAMES) may run any import action: each export is called as a
 * plain Admin, a Junior Admin and an anonymous visitor (and as dianaliz while
 * she isn't listed) and must change nothing — the list is read from the
 * module, so a new action that forgets the guard fails here. Then preview →
 * confirm (batch, categories, lines, linked move, cutover, and the audit entry
 * while LEDGER_AUDIT_ENABLED is on), the refusals (a second import, a changed
 * file, rows with errors, a bad cutover), and undo → import again.
 *
 * `keeper` is the first ledger account and `treasurer` the last — the same
 * login while only one is listed (the beta from 2026-11-02).
 *
 * All names and amounts are invented; dates are relative to today.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { withTestDatabase } from "../support/db";
import { asAnonymous, form, resetTestState, runAs, settle, testState, type SessionUser } from "../support/context";
import { todayDateOnly } from "@/lib/dateOnly";
import type { LedgerImportPreview } from "@/lib/actions/ledgerImport";
import { LEDGER_USERNAMES } from "@/lib/masterAdmins";

const db = withTestDatabase("ledger_import");
let actions: typeof import("@/lib/actions/ledgerImport");
let ledgerActions: typeof import("@/lib/actions/ledger");
let ledgerData: typeof import("@/lib/ledgerData");
/** LEDGER_AUDIT_ENABLED, read after db.ready (ledgerAudit.ts loads the Prisma client). */
let auditEnabled = false;
/** How many audit entries one import or undo writes. */
const AUDITED = () => (auditEnabled ? 1 : 0);

let keeper: SessionUser;
let treasurer: SessionUser;
let plainAdmin: SessionUser;
let juniorAdmin: SessionUser;
/** Admins the import must refuse: plainAdmin, and dianaliz while she isn't in LEDGER_USERNAMES. */
let refusedAdmins: [string, SessionUser][] = [];

before(async () => {
  await db.ready;
  actions = await import("@/lib/actions/ledgerImport");
  ledgerActions = await import("@/lib/actions/ledger");
  ledgerData = await import("@/lib/ledgerData");
  ({ LEDGER_AUDIT_ENABLED: auditEnabled } = await import("@/lib/ledgerAudit"));

  async function make(username: string, role: SessionUser["role"], displayName: string): Promise<SessionUser> {
    const user = await db.prisma.user.create({ data: { username, passwordHash: "x", role, displayName } });
    return { id: user.id, role, sessionVersion: 0, displayName };
  }
  assert.ok(LEDGER_USERNAMES.length > 0, "LEDGER_USERNAMES is empty");
  const keepers: SessionUser[] = [];
  for (const username of LEDGER_USERNAMES) keepers.push(await make(username, "ADMIN", `Ledger ${username}`));
  keeper = keepers[0];
  treasurer = keepers[keepers.length - 1];
  plainAdmin = await make("import-plain-admin", "ADMIN", "Plain Admin");
  juniorAdmin = await make("import-junior", "JUNIOR_ADMIN", "Junior Admin");
  refusedAdmins = [["plain Admin", plainAdmin]];
  if (!LEDGER_USERNAMES.includes("dianaliz")) {
    refusedAdmins.push(["dianaliz (not a ledger account)", await make("dianaliz", "ADMIN", "Unlisted Treasurer")]);
  }
  await ledgerData.ensureGeneralFund();
});

beforeEach(() => resetTestState());

/** `n` days before today (pack time), as M/D/YY like a CSV saved from Sheets. */
function daysAgo(n: number) {
  const date = new Date(todayDateOnly().getTime() - n * 86_400_000);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${String(date.getUTCFullYear()).slice(2)}`;
}
const isoDaysAgo = (n: number) => new Date(todayDateOnly().getTime() - n * 86_400_000).toISOString().slice(0, 10);

/** An invented ledger tab, saved as CSV: summary boxes, the header on row 9, lines from row 10. */
function ledgerCsv(lastLine = `,${daysAgo(10)},Spring trip deposits,Spring Trip,$375.00,,"$1,390.87"`) {
  return [
    "",
    ",Pack 999 Transactions Ledger",
    ",Beginning of the year",
    ",Total Bank Balance,Available to Spend,Donations,Fundraising,Dues",
    ',"$1,390.87","$1,015.87",$100.00,$865.87,$50.00',
    "",
    "Balances for Events:,Fall Campout (Oct),Spring Trip",
    ",$0.00,$375.00",
    ",Date,Description,Category,Inflow (+),Outflow (-),Running Balance",
    `,${daysAgo(60)},Opening balance,Dues,$50.00,,$50.00`,
    `,${daysAgo(55)},Family donation,Donations,$100.00,,`,
    `,${daysAgo(50)},Popcorn sale,Fundraising,"$1,234.56",,"$1,384.56"`,
    `,${daysAgo(48)},Popcorn supplier,Fundraising,,$984.31,$400.25`,
    `,${daysAgo(30)},Fall Campout payments total,Fall Campout (Oct),"$3,405.90",,"$3,806.15"`,
    `,${daysAgo(20)},Fall Campout expenses total,Fall Campout (Oct),,"$2,790.28","$1,015.87"`,
    `,${daysAgo(15)},Close out Fall Campout,Fall Campout (Oct),,$615.62,$400.25`,
    `,${daysAgo(15)},Fall Campout leftover,Fundraising,$615.62,,"$1,015.87"`,
    lastLine,
  ].join("\r\n");
}

const csvFile = (text: string, name = "ledger.csv") => new File([text], name, { type: "text/csv" });

function previewForm(text = ledgerCsv()) {
  const data = new FormData();
  data.set("source", "csv");
  data.set("file", csvFile(text));
  return data;
}

async function preview(user: SessionUser, text = ledgerCsv()): Promise<LedgerImportPreview> {
  const result = await runAs(user, () => actions.previewLedgerImportAction(previewForm(text)));
  assert.equal(result.error, undefined, result.error);
  assert.ok(result.preview);
  return result.preview;
}

function confirmForm(
  view: LedgerImportPreview,
  options: { text?: string; pairs?: string[]; cutoverDate?: string; fingerprint?: string; targets?: Record<string, string> } = {},
) {
  const data = new FormData();
  data.set("source", "csv");
  data.set("file", csvFile(options.text ?? ledgerCsv()));
  data.set("fingerprint", options.fingerprint ?? view.parse.fingerprint);
  for (const mapping of view.mappings) {
    data.set(`target:${mapping.key}`, options.targets?.[mapping.key] ?? mapping.target);
    data.set(`kind:${mapping.key}`, mapping.kind);
  }
  for (const pair of options.pairs ?? []) data.append("pair", pair);
  data.set("cutoverDate", options.cutoverDate ?? view.defaultCutover ?? "");
  return data;
}

async function importState() {
  const [entries, categories, settings, batches, audit] = await Promise.all([
    db.prisma.ledgerEntry.findMany({ orderBy: { id: "asc" } }),
    db.prisma.ledgerCategory.findMany({ orderBy: { id: "asc" } }),
    db.prisma.ledgerSettings.findMany(),
    db.prisma.ledgerImportBatch.findMany({ orderBy: { id: "asc" } }),
    db.prisma.auditLog.count({ where: { category: "ledger" } }),
  ]);
  return JSON.stringify({ entries, categories, settings, batches, audit });
}

async function undoActive(user: SessionUser) {
  const active = await db.prisma.ledgerImportBatch.findFirst({ where: { undoneAt: null } });
  if (active) await runAs(user, () => actions.undoLedgerImportAction(form({ id: active.id })));
}

describe("only the ledger accounts can run any import action", () => {
  it("refuses a plain Admin, a Junior Admin and an anonymous visitor, changing nothing", async () => {
    const view = await preview(keeper);
    assert.deepEqual(await runAs(keeper, () => actions.confirmLedgerImportAction(confirmForm(view))), {});
    const batch = await db.prisma.ledgerImportBatch.findFirstOrThrow({ where: { undoneAt: null } });

    const forms: Record<string, () => FormData> = {
      previewLedgerImportAction: () => previewForm(),
      confirmLedgerImportAction: () => confirmForm(view),
      undoLedgerImportAction: () => form({ id: batch.id }),
    };
    const exported = Object.entries(actions).filter(([, value]) => typeof value === "function") as [
      string,
      (formData: FormData) => Promise<unknown>,
    ][];
    assert.deepEqual(
      exported.map(([name]) => name).sort(),
      Object.keys(forms).sort(),
      "every exported action needs a form here (and a guard in the action)",
    );

    resetTestState();
    const before = await importState();
    const callers: [string, (fn: () => Promise<unknown>) => Promise<unknown>][] = [
      ...refusedAdmins.map(([who, user]): [string, (fn: () => Promise<unknown>) => Promise<unknown>] => [who, (fn) => runAs(user, fn)]),
      ["Junior Admin", (fn) => runAs(juniorAdmin, fn)],
      ["anonymous", async (fn) => (await asAnonymous(fn)).result],
    ];
    for (const [name, action] of exported) {
      for (const [who, call] of callers) {
        const outcome = await settle(call(() => action(forms[name]())));
        assert.ok(!outcome.ok, `${name} let the ${who} through`);
        assert.match(outcome.error.message, /Not authorized/, `${name} as ${who}`);
        assert.equal(await importState(), before, `${name} as ${who} changed the database`);
      }
    }
    assert.equal(testState.revalidated.length, 0, "nothing was revalidated");

    await undoActive(keeper);
  });
});

describe("preview", () => {
  it("reads the CSV and saves nothing", async () => {
    const before = await importState();
    const view = await preview(treasurer);
    assert.equal(await importState(), before);

    assert.deepEqual(view.source, { kind: "csv", fileName: "ledger.csv" });
    assert.deepEqual(view.parse.errors, []);
    assert.equal(view.parse.rows.length, 9);
    assert.equal(view.parse.totals.endingBalanceCents, 139087);
    assert.equal(view.defaultCutover, isoDaysAgo(9));
    assert.deepEqual(
      view.parse.transferPairs.map((p) => p.id),
      ["16-17"],
    );
    const campout = view.mappings.find((m) => m.name === "Fall Campout (Oct)");
    assert.equal(campout?.kind, "EVENT");
    assert.equal(view.mappings.find((m) => m.name === "Dues")?.kind, "FUND");
    assert.ok(view.parse.summaryChecks.every((c) => c.matches !== false));
  });

  it("offers the existing category with the same name (the first test's import made them)", async () => {
    const view = await preview(keeper);
    for (const mapping of view.mappings) {
      const existing = await db.prisma.ledgerCategory.findUniqueOrThrow({ where: { nameKey: mapping.key } });
      assert.equal(mapping.target, existing.id, mapping.name);
    }
  });

  it("names the row with a future date, with a likely fix", async () => {
    const future = new Date(todayDateOnly().getTime() + 3 * 365 * 86_400_000);
    const typo = `${future.getUTCMonth() + 1}/${future.getUTCDate()}/${String(future.getUTCFullYear()).slice(2)}`;
    const view = await preview(keeper, ledgerCsv(`,${typo},Spring trip deposits,Spring Trip,$375.00,,`));
    assert.equal(view.parse.errors.length, 1);
    assert.equal(view.parse.errors[0].sheetRow, 18);
    assert.match(view.parse.errors[0].message, /^Row 18: .* is in the future\./);
    assert.match(view.parse.errors[0].message, /Fix it in the Sheet, then preview again\.$/);
  });

  it("refuses a missing or oversized file", async () => {
    const empty = new FormData();
    empty.set("source", "csv");
    assert.match((await runAs(keeper, () => actions.previewLedgerImportAction(empty))).error ?? "", /Choose the CSV file/);
    const big = new FormData();
    big.set("source", "csv");
    big.set("file", csvFile("x".repeat(600 * 1024)));
    assert.match((await runAs(keeper, () => actions.previewLedgerImportAction(big))).error ?? "", /too large/);
  });

  it("says the Sheet connection isn't set up when asked to read the Sheet", async () => {
    const result = await runAs(keeper, () => actions.previewLedgerImportAction(form({ source: "sheet", tab: "2026-2027" })));
    assert.match(result.error ?? "", /isn't set up/);
  });
});

describe("confirm and undo", () => {
  it("imports the lines, categories, linked move and cutover in one go, with its audit entry while auditing is on", async () => {
    const view = await preview(keeper);
    const result = await runAs(treasurer, () => actions.confirmLedgerImportAction(confirmForm(view, { pairs: ["16-17"] })));
    assert.deepEqual(result, {});
    assert.ok(testState.revalidated.includes("/portal/admin/ledger"));

    const batch = await db.prisma.ledgerImportBatch.findFirstOrThrow({ where: { undoneAt: null } });
    assert.equal(batch.rowCount, 9);
    assert.equal(batch.fingerprint, view.parse.fingerprint);
    assert.equal(batch.inflowCents, 578108);
    assert.equal(batch.outflowCents, 439021);
    assert.equal(batch.importedByName, treasurer.displayName);
    assert.match(batch.sourceLabel, /ledger\.csv/);

    const entries = await db.prisma.ledgerEntry.findMany({
      where: { importBatchId: batch.id },
      include: { category: true },
      orderBy: { importRowNumber: "asc" },
    });
    assert.equal(entries.length, 9);
    assert.ok(entries.every((e) => e.origin === "IMPORTED" && e.deletedAt === null));
    assert.deepEqual(
      entries.map((e) => e.importRowNumber),
      [10, 11, 12, 13, 14, 15, 16, 17, 18],
    );
    const sale = entries.find((e) => e.importRowNumber === 12)!;
    assert.equal(sale.amountCents, 123456);
    assert.equal(sale.direction, "IN");
    assert.equal(sale.category.name, "Fundraising");
    assert.equal(sale.entryDate.toISOString().slice(0, 10), isoDaysAgo(50));

    // The linked move shares a transferId; nothing else has one.
    const moved = entries.filter((e) => e.transferId);
    assert.deepEqual(
      moved.map((e) => e.importRowNumber),
      [16, 17],
    );
    assert.equal(moved[0].transferId, moved[1].transferId);

    const campout = await db.prisma.ledgerCategory.findUniqueOrThrow({ where: { nameKey: "fall campout (oct)" } });
    assert.equal(campout.kind, "EVENT");

    const settings = await db.prisma.ledgerSettings.findUniqueOrThrow({ where: { id: "main" } });
    assert.equal(settings.cutoverDate?.toISOString().slice(0, 10), isoDaysAgo(9));
    assert.equal(await db.prisma.auditLog.count({ where: { action: "ledger.import", entityId: batch.id } }), AUDITED());

    // The ledger's balances match the Sheet's boxes.
    const ledger = await ledgerData.getLedger();
    assert.equal(ledger.summary.bankBalanceCents, 139087);
    const net = (name: string) => ledger.summary.categories.find((c) => c.name === name)?.netCents;
    assert.equal(net("Fundraising"), 86587);
    assert.equal(net("Fall Campout (Oct)"), 0);
  });

  it("refuses a second import while one is in the ledger", async () => {
    const before = await importState();
    const result = await runAs(keeper, () => actions.previewLedgerImportAction(previewForm()));
    assert.match(result.error ?? "", /Undo the earlier import first/);
    const fake = { parse: { fingerprint: "0".repeat(64) }, mappings: [], defaultCutover: isoDaysAgo(9) } as unknown as LedgerImportPreview;
    const confirm = await runAs(keeper, () => actions.confirmLedgerImportAction(confirmForm(fake)));
    assert.match(confirm.error ?? "", /Undo the earlier import first/);
    assert.equal(await importState(), before);
  });

  it("undo takes the lines back out and clears the cutover; a second undo does nothing", async () => {
    const batch = await db.prisma.ledgerImportBatch.findFirstOrThrow({ where: { undoneAt: null } });
    await runAs(keeper, () => actions.undoLedgerImportAction(form({ id: batch.id })));

    const after = await db.prisma.ledgerImportBatch.findUniqueOrThrow({ where: { id: batch.id } });
    assert.ok(after.undoneAt);
    assert.equal(after.undoneByName, keeper.displayName);
    assert.equal(await db.prisma.ledgerEntry.count({ where: { importBatchId: batch.id, deletedAt: null } }), 0);
    assert.equal((await db.prisma.ledgerSettings.findUniqueOrThrow({ where: { id: "main" } })).cutoverDate, null);
    assert.equal(await db.prisma.auditLog.count({ where: { action: "ledger.import.undo", entityId: batch.id } }), AUDITED());

    // The undone lines aren't offered for restore, and restoring one by id does nothing.
    const ledger = await ledgerData.getLedger();
    assert.equal(ledger.summary.bankBalanceCents, 0);
    assert.ok(!ledger.deletedEntries.some((e) => e.importBatchId === batch.id));
    const one = await db.prisma.ledgerEntry.findFirstOrThrow({ where: { importBatchId: batch.id } });
    await runAs(keeper, () => ledgerActions.restoreLedgerEntryAction(form({ id: one.id })));
    assert.ok((await db.prisma.ledgerEntry.findUniqueOrThrow({ where: { id: one.id } })).deletedAt);

    const before = await importState();
    await runAs(keeper, () => actions.undoLedgerImportAction(form({ id: batch.id })));
    assert.equal(await importState(), before);
  });

  it("can import again after an undo, into the categories the first import made", async () => {
    const view = await preview(keeper);
    assert.ok(view.mappings.every((m) => m.target !== "new"), "the earlier categories are offered");
    assert.deepEqual(await runAs(keeper, () => actions.confirmLedgerImportAction(confirmForm(view))), {});
    assert.equal(await db.prisma.ledgerImportBatch.count({ where: { undoneAt: null } }), 1);
    assert.equal((await ledgerData.getLedger()).summary.bankBalanceCents, 139087);
    await undoActive(keeper);
  });

  it("refuses a file that changed since the preview, rows with errors, a clashing new category and a bad cutover", async () => {
    const view = await preview(keeper);
    const before = await importState();
    const refusal = async (data: FormData) => (await runAs(keeper, () => actions.confirmLedgerImportAction(data))).error ?? "";

    const changed = ledgerCsv(`,${daysAgo(10)},Spring trip deposits,Spring Trip,$376.00,,`);
    assert.match(await refusal(confirmForm(view, { text: changed })), /isn't the one that was previewed/);

    const broken = ledgerCsv(`,${daysAgo(10)},Spring trip deposits,,$375.00,,`);
    const brokenView = await preview(keeper, broken);
    assert.equal(brokenView.parse.errors.length, 1);
    assert.match(await refusal(confirmForm(brokenView, { text: broken })), /need fixing/);

    // "New" for a name that's now a category: pick that one instead.
    const dues = view.mappings.find((m) => m.key === "dues")!;
    assert.match(await refusal(confirmForm(view, { targets: { [dues.key]: "new" } })), /already exists/);

    assert.match(await refusal(confirmForm(view, { cutoverDate: isoDaysAgo(10) })), /after the last imported line/);
    const farAhead = new Date(todayDateOnly().getTime() + 45 * 86_400_000).toISOString().slice(0, 10);
    assert.match(await refusal(confirmForm(view, { cutoverDate: farAhead })), /at most 30 days/);
    assert.match(await refusal(confirmForm(view, { pairs: ["10-11"] })), /don't match the preview/);

    assert.equal(await importState(), before, "nothing was saved");
  });
});

describe("the audit log while Ledger auditing is off", () => {
  it("gets nothing from a preview, an import or an undo", async (t) => {
    if (auditEnabled) {
      t.skip("LEDGER_AUDIT_ENABLED is on: the confirm and undo tests check each entry");
      return;
    }
    const ledgerAudits = () =>
      db.prisma.auditLog.count({ where: { OR: [{ category: "ledger" }, { action: { startsWith: "ledger." } }] } });
    const view = await preview(keeper);
    assert.deepEqual(await runAs(treasurer, () => actions.confirmLedgerImportAction(confirmForm(view))), {});
    const batch = await db.prisma.ledgerImportBatch.findFirstOrThrow({ where: { undoneAt: null } });
    assert.equal(await db.prisma.ledgerEntry.count({ where: { importBatchId: batch.id } }), 9);
    await runAs(keeper, () => actions.undoLedgerImportAction(form({ id: batch.id })));
    assert.ok((await db.prisma.ledgerImportBatch.findUniqueOrThrow({ where: { id: batch.id } })).undoneAt);
    // Nothing from these, nor from any import or undo earlier in this file.
    assert.equal(await ledgerAudits(), 0);
  });
});

describe("the Import & Settings page", () => {
  it("renders for a ledger account with and without an import in the ledger", async () => {
    const { default: Page } = await import("@/app/portal/(authed)/admin/ledger/import/page");
    assert.ok((await settle(runAs(keeper, async () => Page()))).ok);
    const view = await preview(keeper);
    assert.deepEqual(await runAs(keeper, () => actions.confirmLedgerImportAction(confirmForm(view))), {});
    assert.ok((await settle(runAs(treasurer, async () => Page()))).ok);
    await undoActive(keeper);
  });
});
