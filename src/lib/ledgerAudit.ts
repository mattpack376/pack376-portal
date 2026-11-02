import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { recordAuditInTransaction, type AuditEntry } from "@/lib/audit";
import type { SessionPayload } from "@/lib/session";

/**
 * Whether Ledger changes go in the audit log. Off for the beta (from
 * 2026-11-02, at the treasurer's request): nothing done on the Ledger pages
 * is logged. Set back to true when the beta ends.
 */
export const LEDGER_AUDIT_ENABLED = false;

/** recordAuditInTransaction for the Ledger's actions, skipped while LEDGER_AUDIT_ENABLED is off. */
export async function recordLedgerAudit(tx: Prisma.TransactionClient, session: SessionPayload, entry: AuditEntry) {
  if (!LEDGER_AUDIT_ENABLED) return;
  await recordAuditInTransaction(tx, session, entry);
}
