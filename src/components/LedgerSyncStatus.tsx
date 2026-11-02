"use client";

import Link from "next/link";
import { useActionState } from "react";
import { syncLedgerNowAction, type LedgerSyncNowState } from "@/lib/actions/ledgerSync";
import type { LedgerSyncView } from "@/lib/ledgerSync";

const initialState: LedgerSyncNowState = {};

/**
 * The Google Sheet copy's status line on the ledger pages: when the "Portal
 * Ledger" tab was last brought up to date, the last error if the copy is
 * failing, a note when the Sheet is behind the portal, and a Sync now button.
 */
export default function LedgerSyncStatus({ view }: { view: LedgerSyncView }) {
  const [state, formAction, pending] = useActionState(syncLedgerNowAction, initialState);

  if (!view.configured) {
    return (
      <p className="form-note no-print" style={{ marginTop: 0, marginBottom: 20 }}>
        The Google Sheet copy isn&apos;t set up yet. The ledger here works without it.
      </p>
    );
  }

  if (!view.enabled) {
    return (
      <p className="form-note no-print" style={{ marginTop: 0, marginBottom: 20 }}>
        The Google Sheet copy is off, so the Portal Ledger tab isn&apos;t being updated.{" "}
        <Link href="/portal/admin/ledger/import">Turn it on under Import &amp; Settings</Link>.
      </p>
    );
  }

  return (
    <div className="info-card no-print" style={{ marginBottom: 20, padding: 16 }}>
      <form action={formAction} className="form-row" style={{ marginBottom: 0, alignItems: "center" }}>
        <div className="form-field" style={{ marginBottom: 0 }}>
          <p style={{ marginBottom: 4 }}>
            <strong>Google Sheet copy:</strong>{" "}
            {view.lastSyncedLabel
              ? `the Portal Ledger tab was last updated ${view.lastSyncedLabel}${
                  view.lastSyncRowCount !== null
                    ? ` (${view.lastSyncRowCount === 1 ? "1 line" : `${view.lastSyncRowCount} lines`})`
                    : ""
                }.`
              : "not copied to the Sheet yet."}
          </p>
          {view.behind && (
            <p className="form-note" style={{ margin: 0 }}>
              {view.running ? "Updating the Sheet now…" : "The Sheet is behind the portal; it will catch up shortly."}
            </p>
          )}
          {view.lastSyncError && !state.message && (
            <p className="form-error" style={{ margin: "4px 0 0" }}>
              Last try failed: {view.lastSyncError}
            </p>
          )}
          {state.message && (
            <p
              className={state.status === "synced" ? "form-success" : state.status === "busy" ? "form-note" : "form-error"}
              style={{ margin: "4px 0 0" }}
              role="status"
            >
              {state.message}
            </p>
          )}
        </div>
        <div className="form-field" style={{ flexGrow: 0, minWidth: 0, marginBottom: 0 }}>
          <button type="submit" className="btn btn-quiet btn-small" disabled={pending}>
            {pending ? "Syncing…" : "Sync Now"}
          </button>
        </div>
      </form>
    </div>
  );
}
