import EditPopover from "@/components/EditPopover";
import SubmitButton from "@/components/SubmitButton";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import LedgerEntryFields from "@/components/LedgerEntryFields";
import { formatCents } from "@/lib/duesData";
import { balanceClass } from "@/lib/paymentStatus";
import { formatDateOnly, toDateOnlyString } from "@/lib/dateOnly";
import { formatAuditTooltip } from "@/lib/auditTooltip";
import { deleteLedgerEntryAction, updateLedgerEntryAction } from "@/lib/actions/ledger";
import type { LedgerRow } from "@/lib/ledgerData";

const dateText = (date: Date) => formatDateOnly(toDateOnlyString(date));

function LineBadges({ row }: { row: LedgerRow }) {
  return (
    <>
      {row.origin === "IMPORTED" && (
        <>
          {" "}
          <span className="badge-pill badge-pending" title={row.importRowNumber ? `Sheet row ${row.importRowNumber}` : undefined}>
            Imported
          </span>
        </>
      )}
      {row.transferId && (
        <>
          {" "}
          <span className="badge-pill badge-den">
            {row.direction === "OUT" ? "Transfer to" : "Transfer from"} {row.transferWith || "another category"}
          </span>
        </>
      )}
    </>
  );
}

/**
 * The ledger's lines, newest first, with the bank balance after each. On a
 * phone each row becomes a card (the shared .data-table rules), with Edit and
 * Delete along the bottom. A move between categories can't be edited — only
 * deleted (both halves go) and added again.
 *
 * No .table-scroll wrapper, and has-popovers, so the Edit box isn't clipped
 * by the table (as on the trip expense list).
 */
export default function LedgerTable({
  rows,
  categories,
}: {
  /** Oldest first, as getLedger returns them; shown newest first. */
  rows: LedgerRow[];
  categories: { id: string; name: string; archived: boolean }[];
}) {
  const newestFirst = [...rows].reverse();

  return (
    <table className="data-table has-popovers" style={{ marginBottom: 0 }}>
      <thead>
        <tr>
          <th>Date</th>
          <th>Description</th>
          <th>Category</th>
          <th>Inflow</th>
          <th>Outflow</th>
          <th>Balance</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {newestFirst.length === 0 && (
          <tr>
            <td colSpan={7}>No lines match.</td>
          </tr>
        )}
        {newestFirst.map((row) => (
          <tr key={row.id}>
            <td>{dateText(row.entryDate)}</td>
            <td
              data-label="Description"
              className="audit-hover"
              data-audit={formatAuditTooltip("Added", row.createdAt, row.createdByName)}
            >
              <span>
                {row.description}
                <LineBadges row={row} />
                {row.note && (
                  <span className="form-note" style={{ display: "block", marginTop: 2, whiteSpace: "pre-line" }}>
                    {row.note}
                  </span>
                )}
              </span>
            </td>
            <td data-label="Category">{row.categoryName}</td>
            <td data-label="Inflow" className={row.direction === "IN" ? "balance-positive" : undefined}>
              {row.direction === "IN" ? formatCents(row.amountCents) : ""}
            </td>
            <td data-label="Outflow" className={row.direction === "OUT" ? "balance-negative" : undefined}>
              {row.direction === "OUT" ? formatCents(row.amountCents) : ""}
            </td>
            <td data-label="Balance" className={balanceClass(row.balanceCents)}>
              {formatCents(row.balanceCents)}
            </td>
            <td className="actions">
              {!row.transferId && (
                <EditPopover action={updateLedgerEntryAction}>
                  <LedgerEntryFields idPrefix={`edit-${row.id}-`} categories={categories} entry={row} />
                  {/* SubmitButton, not SaveButton: this save can be turned down (see EditPopover). */}
                  <SubmitButton className="btn btn-primary btn-small" pendingLabel="Saving…">
                    Save Changes
                  </SubmitButton>
                </EditPopover>
              )}
              <form action={deleteLedgerEntryAction}>
                <input type="hidden" name="id" value={row.id} />
                <ConfirmSubmitButton
                  className="btn btn-danger btn-small"
                  pendingLabel="Deleting…"
                  message={
                    row.transferId
                      ? `Delete the ${formatCents(row.amountCents)} move “${row.description}”? Both of its lines come off the ledger. They're kept under Deleted entries and can be restored.`
                      : `Delete “${row.description}” (${formatCents(row.amountCents)} ${row.direction === "IN" ? "in" : "out"}, ${dateText(row.entryDate)})? It comes off the ledger and its balances. It's kept under Deleted entries and can be restored.`
                  }
                >
                  Delete
                </ConfirmSubmitButton>
              </form>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
