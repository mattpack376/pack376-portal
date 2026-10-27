import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { withTestDatabase } from "../support/db";
import { runAs } from "../support/context";

const db = withTestDatabase("audit");
let audit: typeof import("@/lib/audit");

before(async () => {
  await db.ready;
  audit = await import("@/lib/audit");
});

describe("recordAuditInTransaction", () => {
  it("commits the entry with the change, attributed to the actor and request", async () => {
    const admin = await db.prisma.user.create({
      data: { username: "audit-admin", passwordHash: "x", role: "ADMIN", displayName: "Audit Admin" },
    });
    const session = { userId: admin.id, role: admin.role, denIds: [], scoutIds: [], displayName: "Audit Admin", sv: 0 };
    await runAs(admin, () =>
      db.prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: admin.id }, data: { displayName: "Renamed" } });
        await audit.recordAuditInTransaction(tx, session, { action: "test.rename", summary: "Renamed" });
      }),
    );
    const entry = await db.prisma.auditLog.findFirstOrThrow({ where: { action: "test.rename" } });
    assert.equal(entry.actorUsername, "audit-admin");
    assert.equal(entry.category, "test");
    assert.equal(entry.ipAddress, "127.0.0.1");
  });

  it("rolls back with the change, and a failed entry fails the change", async () => {
    const admin = await db.prisma.user.create({
      data: { username: "audit-rollback", passwordHash: "x", role: "ADMIN", displayName: "Before" },
    });
    const session = { userId: admin.id, role: admin.role, denIds: [], scoutIds: [], displayName: "Before", sv: 0 };

    await assert.rejects(
      runAs(admin, () =>
        db.prisma.$transaction(async (tx) => {
          await tx.user.update({ where: { id: admin.id }, data: { displayName: "Changed" } });
          await audit.recordAuditInTransaction(tx, session, { action: "test.rolledback", summary: "x" });
          throw new Error("business rule failed after the entry");
        }),
      ),
    );
    assert.equal(await db.prisma.auditLog.count({ where: { action: "test.rolledback" } }), 0);

    await assert.rejects(
      runAs(admin, () =>
        db.prisma.$transaction(async (tx) => {
          await tx.user.update({ where: { id: admin.id }, data: { displayName: "Changed" } });
          // Postgres text can't hold a NUL byte, so this entry fails to write.
          await audit.recordAuditInTransaction(tx, session, { action: "test.bad", summary: "bad\u0000value" });
        }),
      ),
    );
    const after = await db.prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    assert.equal(after.displayName, "Before", "the change rolled back with the failed entry");
  });
});
