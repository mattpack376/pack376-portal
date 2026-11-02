/*
 * The Ledger's Server Actions against a real database. Only the ledger
 * accounts (LEDGER_USERNAMES) may run them: every exported action is called
 * as a plain Admin, a Junior Admin and an anonymous visitor (and as dianaliz
 * while she isn't listed) and must change nothing — the list is read from the
 * module itself, so a new action that forgets assertLedgerAccess fails here.
 * Then the actions themselves: adding, editing (with the version check),
 * deleting and restoring lines, moves between categories, categories,
 * settings, the input checks, and the audit entry written with each change
 * while LEDGER_AUDIT_ENABLED is on (none while it's off).
 *
 * The ledger logins come from LEDGER_USERNAMES, so these tests follow that
 * list: `keeper` is the first ledger account and `treasurer` the last — the
 * same login while only one is listed (the beta from 2026-11-02).
 *
 * All names and amounts are invented.
 */
import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { withTestDatabase } from "../support/db";
import { asAnonymous, form, resetTestState, runAs, settle, testState, type SessionUser } from "../support/context";
import { todayDateOnly, todayDateOnlyString, toDateOnlyString } from "@/lib/dateOnly";
import { LEDGER_USERNAMES } from "@/lib/masterAdmins";

const db = withTestDatabase("ledger");
let ledger: typeof import("@/lib/actions/ledger");
let ledgerData: typeof import("@/lib/ledgerData");
/** LEDGER_AUDIT_ENABLED, read after db.ready (ledgerAudit.ts loads the Prisma client). */
let auditEnabled = false;
/** How many audit entries one ledger change writes. */
const AUDITED = () => (auditEnabled ? 1 : 0);

/** One login per ledger account, in LEDGER_USERNAMES order. */
const keepers: SessionUser[] = [];
let keeper: SessionUser;
let treasurer: SessionUser;
let plainAdmin: SessionUser;
let juniorAdmin: SessionUser;
/** Admins the ledger must refuse: plainAdmin, and dianaliz while she isn't in LEDGER_USERNAMES. */
let refusedAdmins: [string, SessionUser][] = [];

let generalId = "";
let fundraisingId = "";
let campoutId = "";

before(async () => {
  await db.ready;
  ledger = await import("@/lib/actions/ledger");
  ledgerData = await import("@/lib/ledgerData");
  ({ LEDGER_AUDIT_ENABLED: auditEnabled } = await import("@/lib/ledgerAudit"));

  async function make(username: string, role: SessionUser["role"], displayName: string): Promise<SessionUser> {
    const user = await db.prisma.user.create({ data: { username, passwordHash: "x", role, displayName } });
    return { id: user.id, role, sessionVersion: 0, displayName };
  }
  for (const username of LEDGER_USERNAMES) keepers.push(await make(username, "ADMIN", `Ledger ${username}`));
  keeper = keepers[0];
  treasurer = keepers[keepers.length - 1];
  plainAdmin = await make("ledger-plain-admin", "ADMIN", "Plain Admin");
  juniorAdmin = await make("ledger-junior", "JUNIOR_ADMIN", "Junior Admin");
  refusedAdmins = [["plain Admin", plainAdmin]];
  if (!LEDGER_USERNAMES.includes("dianaliz")) {
    refusedAdmins.push(["dianaliz (not a ledger account)", await make("dianaliz", "ADMIN", "Unlisted Treasurer")]);
  }

  await ledgerData.ensureGeneralFund();
  generalId = (await db.prisma.ledgerCategory.findUniqueOrThrow({ where: { nameKey: "general fund" } })).id;
  fundraisingId = (await db.prisma.ledgerCategory.create({ data: { name: "Fundraising", nameKey: "fundraising", sortOrder: 10 } })).id;
  campoutId = (
    await db.prisma.ledgerCategory.create({ data: { name: "Fall Campout", nameKey: "fall campout", kind: "EVENT", sortOrder: 20 } })
  ).id;
});

beforeEach(() => resetTestState());

const TODAY = () => todayDateOnlyString();
/** Tomorrow in the pack's time zone, as YYYY-MM-DD. */
const TOMORROW = () => toDateOnlyString(new Date(todayDateOnly().getTime() + 86_400_000));

function entryForm(overrides: Record<string, string> = {}) {
  return form({
    entryDate: TODAY(),
    description: "Popcorn sale deposit",
    categoryId: fundraisingId,
    direction: "IN",
    amount: "125.50",
    note: "",
    ...overrides,
  });
}

/** Adds a line as `user` and returns its row. */
async function addLine(user: SessionUser, overrides: Record<string, string> = {}) {
  const description = overrides.description ?? `Line ${Math.random().toString(36).slice(2, 8)}`;
  const result = await runAs(user, () => ledger.addLedgerEntryAction(entryForm({ ...overrides, description })));
  assert.deepEqual(result, {});
  return db.prisma.ledgerEntry.findFirstOrThrow({ where: { description }, orderBy: { createdAt: "desc" } });
}

/** Everything the ledger actions can change, to compare before and after a refused call. */
async function ledgerState() {
  const [entries, categories, settings, batches, audit] = await Promise.all([
    db.prisma.ledgerEntry.findMany({ orderBy: { id: "asc" } }),
    db.prisma.ledgerCategory.findMany({ orderBy: { id: "asc" } }),
    db.prisma.ledgerSettings.findMany(),
    db.prisma.ledgerImportBatch.findMany(),
    db.prisma.auditLog.count({ where: { category: "ledger" } }),
  ]);
  return JSON.stringify({ entries, categories, settings, batches, audit });
}

const auditCount = (action: string, entityId?: string) =>
  db.prisma.auditLog.count({ where: { action, ...(entityId ? { entityId } : {}) } });

describe("only the ledger accounts can run any ledger action", () => {
  it("refuses a plain Admin, a Junior Admin and an anonymous visitor, changing nothing", async () => {
    assert.ok(keepers.length > 0, "LEDGER_USERNAMES is empty");
    const line = await addLine(keeper, { description: "Guarded line" });
    const transfer = await runAs(keeper, () =>
      ledger.addLedgerTransferAction(
        form({ entryDate: TODAY(), fromCategoryId: fundraisingId, toCategoryId: generalId, amount: "5", description: "Guarded move" }),
      ),
    );
    assert.deepEqual(transfer, {});
    const deletedLine = await addLine(keeper, { description: "Guarded deleted line" });
    await runAs(keeper, () => ledger.deleteLedgerEntryAction(form({ id: deletedLine.id })));
    const unused = await db.prisma.ledgerCategory.create({ data: { name: "Unused Guarded", nameKey: "unused guarded" } });

    // A form for each action that would change something if the guard let it through.
    const forms: Record<string, () => FormData> = {
      addLedgerEntryAction: () => entryForm({ description: "Sneaky add" }),
      updateLedgerEntryAction: () =>
        entryForm({ id: line.id, version: line.updatedAt.toISOString(), description: "Sneaky edit", amount: "999" }),
      deleteLedgerEntryAction: () => form({ id: line.id }),
      restoreLedgerEntryAction: () => form({ id: deletedLine.id }),
      addLedgerTransferAction: () =>
        form({ entryDate: TODAY(), fromCategoryId: generalId, toCategoryId: fundraisingId, amount: "10" }),
      createLedgerCategoryAction: () => form({ name: "Sneaky Category", kind: "FUND" }),
      updateLedgerCategoryAction: () => form({ id: fundraisingId, name: "Renamed", kind: "EVENT", sortOrder: "1", archived: "true" }),
      deleteLedgerCategoryAction: () => form({ id: unused.id }),
      updateLedgerSettingsAction: () => form({ syncEnabled: "false" }),
    };

    const actions = Object.entries(ledger).filter(([, value]) => typeof value === "function") as [
      string,
      (formData: FormData) => Promise<unknown>,
    ][];
    assert.ok(actions.length >= 9, `only ${actions.length} actions found`);
    assert.deepEqual(
      actions.map(([name]) => name).sort(),
      Object.keys(forms).sort(),
      "every exported action needs a form here (and a guard in the action)",
    );

    resetTestState();
    const before = await ledgerState();
    const callers: [string, (fn: () => Promise<unknown>) => Promise<unknown>][] = [
      ...refusedAdmins.map(([who, user]): [string, (fn: () => Promise<unknown>) => Promise<unknown>] => [who, (fn) => runAs(user, fn)]),
      ["Junior Admin", (fn) => runAs(juniorAdmin, fn)],
      ["anonymous", async (fn) => (await asAnonymous(fn)).result],
    ];
    for (const [name, action] of actions) {
      for (const [who, call] of callers) {
        const outcome = await settle(call(() => action(forms[name]())));
        assert.ok(!outcome.ok, `${name} let the ${who} through`);
        assert.match(outcome.error.message, /Not authorized/, `${name} as ${who}`);
        assert.equal(await ledgerState(), before, `${name} as ${who} changed the database`);
      }
    }
    assert.equal(testState.revalidated.length, 0, "nothing was revalidated");
  });
});

describe("the ledger pages and export", () => {
  type PageModule = { default: (props: never) => unknown };
  const PAGES: [string, () => Promise<PageModule>][] = [
    ["ledger", () => import("@/app/portal/(authed)/admin/ledger/page")],
    ["categories", () => import("@/app/portal/(authed)/admin/ledger/categories/page")],
    ["import", () => import("@/app/portal/(authed)/admin/ledger/import/page")],
  ];
  const props = { params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never;
  const redirectOf = (outcome: Awaited<ReturnType<typeof settle>>) =>
    outcome.ok ? null : ((outcome.error as Error & { redirect?: string }).redirect ?? `threw ${outcome.error.message}`);

  it("send a plain Admin, a Junior Admin and an anonymous visitor away", async () => {
    for (const [name, load] of PAGES) {
      const { default: Page } = await load();
      for (const [who, user] of refusedAdmins) {
        assert.equal(redirectOf(await settle(runAs(user, async () => Page(props)))), "/portal/admin", `${name} as ${who}`);
      }
      assert.equal(redirectOf(await settle(runAs(juniorAdmin, async () => Page(props)))), "/portal/admin", name);
      const anonymous = await settle(asAnonymous(async () => Page(props)).then((r) => r.result));
      assert.equal(redirectOf(anonymous), "/portal/login", name);
    }
  });

  it("render for every ledger account", async () => {
    for (const [name, load] of PAGES) {
      const { default: Page } = await load();
      for (const user of keepers) {
        const outcome = await settle(runAs(user, async () => Page(props)));
        assert.ok(outcome.ok, `${name}: ${outcome.ok ? "" : outcome.error.message}`);
      }
    }
  });

  it("export a private CSV only to the ledger accounts", async () => {
    const { GET } = await import("@/app/portal/(authed)/admin/ledger/export/route");
    const request = () => new Request("https://portal.pack376nyc.org/portal/admin/ledger/export?year=all");
    for (const [who, user] of refusedAdmins) {
      assert.equal(redirectOf(await settle(runAs(user, () => GET(request())))), "/portal/admin", who);
    }

    await addLine(keeper, { description: "=HYPERLINK(\"x\")", amount: "3" });
    const response = await runAs(treasurer, () => GET(request()));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const csv = await response.text();
    assert.match(csv, /^Date,Description,Category,Inflow,Outflow,Running Balance,Type\r\n/);
    assert.match(csv, /'=HYPERLINK/, "a formula is neutralized");
  });
});

describe("lines", () => {
  it("every ledger account can add a line, with its audit entry while auditing is on", async () => {
    for (const user of keepers) {
      const row = await addLine(user, { description: `Added by ${user.displayName}`, note: "Check #101\r\nsecond line" });
      assert.equal(row.amountCents, 12550);
      assert.equal(row.direction, "IN");
      assert.equal(row.origin, "MANUAL");
      assert.equal(row.categoryId, fundraisingId);
      assert.equal(row.createdByUserId, user.id);
      assert.equal(row.createdByName, user.displayName);
      assert.equal(row.note, "Check #101\nsecond line");
      assert.equal(toDateOnlyString(row.entryDate), TODAY());
      assert.equal(await auditCount("ledger.entry.add", row.id), AUDITED());
    }
    assert.ok(testState.revalidated.includes("/portal/admin/ledger"));
  });

  it("edits a line when the version matches, and refuses a stale one", async () => {
    const row = await addLine(treasurer, { description: "To be edited" });
    const version = row.updatedAt.toISOString();

    const saved = await runAs(treasurer, () =>
      ledger.updateLedgerEntryAction(
        entryForm({ id: row.id, version, description: "Edited", direction: "OUT", amount: "20", categoryId: generalId }),
      ),
    );
    assert.deepEqual(saved, {});
    const after = await db.prisma.ledgerEntry.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(after.description, "Edited");
    assert.equal(after.direction, "OUT");
    assert.equal(after.amountCents, 2000);
    assert.equal(after.categoryId, generalId);
    assert.notEqual(after.updatedAt.toISOString(), version);
    assert.equal(await auditCount("ledger.entry.update", row.id), AUDITED());

    // The same form again, from the page as it was before the first save.
    const stale = await runAs(keeper, () =>
      ledger.updateLedgerEntryAction(entryForm({ id: row.id, version, description: "Second edit", amount: "1" })),
    );
    assert.equal(stale.stale, true);
    assert.match(stale.error ?? "", /changed since the page loaded/);
    const unchanged = await db.prisma.ledgerEntry.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(unchanged.description, "Edited");
    assert.equal(await auditCount("ledger.entry.update", row.id), AUDITED());
  });

  it("deletes a line without removing it, and restores it", async () => {
    const row = await addLine(keeper, { description: "Delete and restore" });
    await runAs(keeper, () => ledger.deleteLedgerEntryAction(form({ id: row.id })));
    const deleted = await db.prisma.ledgerEntry.findUniqueOrThrow({ where: { id: row.id } });
    assert.ok(deleted.deletedAt);
    assert.equal(deleted.deletedByName, keeper.displayName);
    assert.equal(await auditCount("ledger.entry.delete", row.id), AUDITED());

    // A second click does nothing more.
    await runAs(keeper, () => ledger.deleteLedgerEntryAction(form({ id: row.id })));
    assert.equal(await auditCount("ledger.entry.delete", row.id), AUDITED());

    // A deleted line can't be edited.
    const edit = await runAs(keeper, () =>
      ledger.updateLedgerEntryAction(entryForm({ id: row.id, version: deleted.updatedAt.toISOString() })),
    );
    assert.equal(edit.stale, true);

    await runAs(treasurer, () => ledger.restoreLedgerEntryAction(form({ id: row.id })));
    const restored = await db.prisma.ledgerEntry.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(restored.deletedAt, null);
    assert.equal(restored.deletedByName, null);
    assert.equal(await auditCount("ledger.entry.restore", row.id), AUDITED());
  });

  it("refuses bad input and saves nothing", async () => {
    const archived = await db.prisma.ledgerCategory.create({
      data: { name: "Old Archived", nameKey: "old archived", archived: true },
    });
    const cases: [Record<string, string>, RegExp][] = [
      [{ entryDate: TOMORROW() }, /future/],
      [{ entryDate: "1999-12-31" }, /before 2000/],
      [{ entryDate: "2026-02-30" }, /isn't a real date/],
      [{ entryDate: "" }, /Enter the date/],
      [{ amount: "0" }, /greater than \$0/],
      [{ amount: "-5" }, /greater than \$0/],
      [{ amount: "12.345" }, /greater than \$0/],
      [{ amount: "1000000.01" }, /greater than \$0/],
      [{ amount: "abc" }, /greater than \$0/],
      [{ description: "" }, /Describe/],
      [{ description: "x".repeat(201) }, /at most 200/],
      [{ description: "Tab\there" }, /can't be saved/],
      [{ direction: "SIDEWAYS" }, /came in or went out/],
      [{ categoryId: "no-such-category" }, /no longer exists/],
      [{ categoryId: archived.id }, /archived/],
      [{ note: "n".repeat(2001) }, /at most 2000/],
    ];
    const before = await ledgerState();
    for (const [overrides, message] of cases) {
      const result = await runAs(keeper, () => ledger.addLedgerEntryAction(entryForm({ description: "Refused", ...overrides })));
      assert.match(result.error ?? "", message, JSON.stringify(overrides).slice(0, 80));
    }
    assert.equal(await ledgerState(), before);
  });

  it("keeps a line in its archived category when an edit leaves the category alone", async () => {
    const category = await db.prisma.ledgerCategory.create({ data: { name: "Soon Archived", nameKey: "soon archived" } });
    const row = await addLine(keeper, { description: "In a soon-archived category", categoryId: category.id });
    await db.prisma.ledgerCategory.update({ where: { id: category.id }, data: { archived: true } });

    const result = await runAs(keeper, () =>
      ledger.updateLedgerEntryAction(
        entryForm({ id: row.id, version: row.updatedAt.toISOString(), categoryId: category.id, description: "Still here" }),
      ),
    );
    assert.deepEqual(result, {});
  });
});

describe("moves between categories", () => {
  it("adds two lines that leave the bank balance alone, and deletes and restores them together", async () => {
    const before = await ledgerData.getLedger();
    const result = await runAs(treasurer, () =>
      ledger.addLedgerTransferAction(
        form({ entryDate: TODAY(), fromCategoryId: campoutId, toCategoryId: fundraisingId, amount: "61.50", description: "" }),
      ),
    );
    assert.deepEqual(result, {});

    const halves = await db.prisma.ledgerEntry.findMany({ where: { description: "Move from Fall Campout to Fundraising" } });
    assert.equal(halves.length, 2);
    assert.equal(halves[0].transferId, halves[1].transferId);
    assert.ok(halves[0].transferId);
    assert.deepEqual(halves.map((h) => h.direction).sort(), ["IN", "OUT"]);
    assert.equal(halves.find((h) => h.direction === "OUT")?.categoryId, campoutId);
    assert.equal(halves.find((h) => h.direction === "IN")?.categoryId, fundraisingId);
    assert.equal(await auditCount("ledger.transfer.add", halves[0].transferId ?? ""), AUDITED());

    const after = await ledgerData.getLedger();
    assert.equal(after.summary.bankBalanceCents, before.summary.bankBalanceCents);
    const net = (data: typeof after, id: string) => data.summary.categories.find((c) => c.id === id)?.netCents ?? 0;
    assert.equal(net(after, campoutId), net(before, campoutId) - 6150);
    assert.equal(net(after, fundraisingId), net(before, fundraisingId) + 6150);

    // Can't be edited, only deleted (both halves) and added again.
    const half = halves[0];
    const edit = await runAs(treasurer, () =>
      ledger.updateLedgerEntryAction(entryForm({ id: half.id, version: half.updatedAt.toISOString() })),
    );
    assert.match(edit.error ?? "", /can't be edited/);

    await runAs(treasurer, () => ledger.deleteLedgerEntryAction(form({ id: half.id })));
    const deleted = await db.prisma.ledgerEntry.findMany({ where: { transferId: half.transferId } });
    assert.ok(deleted.every((h) => h.deletedAt), "both halves are deleted");
    assert.equal(await auditCount("ledger.transfer.delete", half.transferId ?? ""), AUDITED());

    const other = halves[1];
    await runAs(keeper, () => ledger.restoreLedgerEntryAction(form({ id: other.id })));
    const restored = await db.prisma.ledgerEntry.findMany({ where: { transferId: half.transferId } });
    assert.ok(restored.every((h) => h.deletedAt === null), "both halves are back");
  });

  it("refuses moving money into the same category", async () => {
    const before = await ledgerState();
    const result = await runAs(keeper, () =>
      ledger.addLedgerTransferAction(form({ entryDate: TODAY(), fromCategoryId: generalId, toCategoryId: generalId, amount: "5" })),
    );
    assert.match(result.error ?? "", /two different categories/);
    assert.equal(await ledgerState(), before);
  });
});

describe("categories", () => {
  it("adds one, refuses a duplicate name in any case, edits and archives it", async () => {
    assert.deepEqual(await runAs(keeper, () => ledger.createLedgerCategoryAction(form({ name: "  Pinewood   Derby ", kind: "EVENT" }))), {});
    const created = await db.prisma.ledgerCategory.findUniqueOrThrow({ where: { nameKey: "pinewood derby" } });
    assert.equal(created.name, "Pinewood Derby");
    assert.equal(created.kind, "EVENT");
    assert.equal(await auditCount("ledger.category.create", created.id), AUDITED());

    const duplicate = await runAs(treasurer, () => ledger.createLedgerCategoryAction(form({ name: "PINEWOOD DERBY", kind: "FUND" })));
    assert.match(duplicate.error ?? "", /already exists/);

    const renameOntoAnother = await runAs(treasurer, () =>
      ledger.updateLedgerCategoryAction(form({ id: created.id, name: "fundraising", kind: "EVENT" })),
    );
    assert.match(renameOntoAnother.error ?? "", /already exists/);

    assert.deepEqual(
      await runAs(treasurer, () =>
        ledger.updateLedgerCategoryAction(form({ id: created.id, name: "Derby 2027", kind: "FUND", sortOrder: "5", archived: "true" })),
      ),
      {},
    );
    const updated = await db.prisma.ledgerCategory.findUniqueOrThrow({ where: { id: created.id } });
    assert.deepEqual([updated.name, updated.nameKey, updated.kind, updated.sortOrder, updated.archived], [
      "Derby 2027",
      "derby 2027",
      "FUND",
      5,
      true,
    ]);
    assert.equal(await auditCount("ledger.category.update", created.id), AUDITED());
  });

  it("doesn't bring General Fund back after it is renamed", async () => {
    assert.deepEqual(
      await runAs(keeper, () => ledger.updateLedgerCategoryAction(form({ id: generalId, name: "Operating", kind: "FUND", sortOrder: "0" }))),
      {},
    );
    await ledgerData.getLedger();
    assert.equal(await db.prisma.ledgerCategory.findUnique({ where: { nameKey: "general fund" } }), null);
    assert.deepEqual(
      await runAs(keeper, () => ledger.updateLedgerCategoryAction(form({ id: generalId, name: "General Fund", kind: "FUND", sortOrder: "0" }))),
      {},
    );
  });

  it("deletes an unused category outright", async () => {
    const unused = await db.prisma.ledgerCategory.create({ data: { name: "Never Used", nameKey: "never used" } });
    assert.deepEqual(await runAs(treasurer, () => ledger.deleteLedgerCategoryAction(form({ id: unused.id }))), {});
    assert.equal(await db.prisma.ledgerCategory.findUnique({ where: { id: unused.id } }), null);
    assert.equal(await auditCount("ledger.category.delete", unused.id), AUDITED());
  });

  it("deletes a category with lines by moving every line (deleted ones too) to another, balance unchanged", async () => {
    const event = await db.prisma.ledgerCategory.create({ data: { name: "Old Event", nameKey: "old event", kind: "EVENT" } });
    const live = await addLine(keeper, { description: "Old event payment", categoryId: event.id, amount: "40.00" });
    const gone = await addLine(keeper, { description: "Old event mistake", categoryId: event.id, amount: "5.00" });
    await runAs(keeper, () => ledger.deleteLedgerEntryAction(form({ id: gone.id })));
    const before = (await ledgerData.getLedger()).summary.bankBalanceCents;

    // A category with lines needs somewhere to put them.
    const noTarget = await runAs(keeper, () => ledger.deleteLedgerCategoryAction(form({ id: event.id })));
    assert.match(noTarget.error ?? "", /Pick a category to move them to/);
    const self = await runAs(keeper, () => ledger.deleteLedgerCategoryAction(form({ id: event.id, moveToCategoryId: event.id })));
    assert.match(self.error ?? "", /different category/);
    const archived = await db.prisma.ledgerCategory.create({ data: { name: "Archived Fund", nameKey: "archived fund", archived: true } });
    const toArchived = await runAs(keeper, () =>
      ledger.deleteLedgerCategoryAction(form({ id: event.id, moveToCategoryId: archived.id })),
    );
    assert.match(toArchived.error ?? "", /archived/);
    assert.ok(await db.prisma.ledgerCategory.findUnique({ where: { id: event.id } }));

    assert.deepEqual(
      await runAs(keeper, () => ledger.deleteLedgerCategoryAction(form({ id: event.id, moveToCategoryId: fundraisingId }))),
      {},
    );
    assert.equal(await db.prisma.ledgerCategory.findUnique({ where: { id: event.id } }), null);
    for (const id of [live.id, gone.id]) {
      assert.equal((await db.prisma.ledgerEntry.findUniqueOrThrow({ where: { id } })).categoryId, fundraisingId);
    }
    assert.equal((await ledgerData.getLedger()).summary.bankBalanceCents, before);
    assert.equal(await auditCount("ledger.category.delete", event.id), AUDITED());
  });
});

describe("settings", () => {
  it("turns the Sheet copy off and on, auditing only real changes", async () => {
    const audits = () => auditCount("ledger.settings.update");
    const start = await audits();
    assert.deepEqual(await runAs(keeper, () => ledger.updateLedgerSettingsAction(form({ syncEnabled: "false" }))), {});
    assert.equal((await db.prisma.ledgerSettings.findUniqueOrThrow({ where: { id: "main" } })).syncEnabled, false);
    assert.equal(await audits(), start + AUDITED());

    assert.deepEqual(await runAs(keeper, () => ledger.updateLedgerSettingsAction(form({ syncEnabled: "false" }))), {});
    assert.equal(await audits(), start + AUDITED(), "no change, no entry");

    assert.deepEqual(await runAs(treasurer, () => ledger.updateLedgerSettingsAction(form({ syncEnabled: "true" }))), {});
    assert.equal((await db.prisma.ledgerSettings.findUniqueOrThrow({ where: { id: "main" } })).syncEnabled, true);

    const junk = await runAs(treasurer, () => ledger.updateLedgerSettingsAction(form({ syncEnabled: "maybe" })));
    assert.ok(junk.error);
  });
});

describe("getLedger", () => {
  it("works out the running balance over every line before filtering", async () => {
    await addLine(treasurer, { description: "Popcorn sale deposit", categoryId: fundraisingId });
    const data = await ledgerData.getLedger();
    let balance = 0;
    for (const row of data.allRows) {
      balance += row.direction === "IN" ? row.amountCents : -row.amountCents;
      assert.equal(row.balanceCents, balance);
    }
    assert.equal(data.summary.bankBalanceCents, balance);
    assert.ok(data.allRows.every((row) => row.version === row.updatedAt.toISOString()));

    const filtered = await ledgerData.getLedger({ categoryId: generalId });
    assert.ok(filtered.rows.every((row) => row.categoryId === generalId));
    for (const row of filtered.rows) {
      assert.equal(row.balanceCents, data.allRows.find((r) => r.id === row.id)?.balanceCents, "the real bank balance");
    }

    const searched = await ledgerData.getLedger({ q: "POPCORN" });
    assert.ok(searched.rows.length > 0);
    assert.ok(searched.rows.every((row) => /popcorn/i.test(`${row.description} ${row.note ?? ""} ${row.categoryName}`)));
  });

  it("lists deleted lines separately and leaves them out of every balance", async () => {
    const row = await addLine(keeper, { description: "Deleted from the balance", amount: "1000" });
    const before = await ledgerData.getLedger();
    await runAs(keeper, () => ledger.deleteLedgerEntryAction(form({ id: row.id })));
    const after = await ledgerData.getLedger();
    assert.equal(after.summary.bankBalanceCents, before.summary.bankBalanceCents - 100000);
    assert.ok(!after.allRows.some((r) => r.id === row.id));
    assert.ok(after.deletedEntries.some((r) => r.id === row.id));
  });
});

describe("the audit log while Ledger auditing is off", () => {
  it("gets nothing from adding, editing, deleting or restoring a line", async (t) => {
    if (auditEnabled) {
      t.skip("LEDGER_AUDIT_ENABLED is on: the tests above check each change's entry");
      return;
    }
    const ledgerAudits = () =>
      db.prisma.auditLog.count({ where: { OR: [{ category: "ledger" }, { action: { startsWith: "ledger." } }] } });
    const row = await addLine(keeper, { description: "Not audited" });
    const saved = await runAs(treasurer, () =>
      ledger.updateLedgerEntryAction(entryForm({ id: row.id, version: row.updatedAt.toISOString(), description: "Not audited, edited" })),
    );
    assert.deepEqual(saved, {});
    await runAs(keeper, () => ledger.deleteLedgerEntryAction(form({ id: row.id })));
    assert.ok((await db.prisma.ledgerEntry.findUniqueOrThrow({ where: { id: row.id } })).deletedAt);
    await runAs(treasurer, () => ledger.restoreLedgerEntryAction(form({ id: row.id })));
    assert.equal((await db.prisma.ledgerEntry.findUniqueOrThrow({ where: { id: row.id } })).deletedAt, null);
    // Nothing from these, nor from any change earlier in this file.
    assert.equal(await ledgerAudits(), 0);
  });
});
