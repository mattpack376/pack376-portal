import type { ReactNode } from "react";
import CollapsibleGroup from "@/components/CollapsibleGroup";
import { formatCents } from "@/lib/duesData";
import { formatAuditTooltip } from "@/lib/auditTooltip";
import type { getTripExpenses } from "@/lib/tripPageData";

type TripExpense = Awaited<ReturnType<typeof getTripExpenses>>[number];

/**
 * The trip's expenses — a table on wider screens, and on phones a list of
 * collapsed rows ("Firewood — $45.00") that open to the date, who paid, and
 * any row actions. Both renderings are in the page and CSS shows one
 * (.phone-only / .phone-hidden), so `actions` is called twice per expense;
 * pass `idPrefix` into any form ids so the two copies don't collide.
 *
 * Holds no forms of its own: the admin page passes Edit/Delete as `actions`,
 * and the read-only trip view passes nothing.
 */
export default function TripExpenseList({
  expenses,
  actions,
}: {
  expenses: TripExpense[];
  actions?: (expense: TripExpense, idPrefix: string) => ReactNode;
}) {
  const spentOn = (e: TripExpense) => e.spentOn.toLocaleDateString("en-US", { timeZone: "UTC" });

  return (
    <>
      {/* No .table-scroll wrapper and a has-popovers table when there are
          actions: both would otherwise clip the Edit popover to the table. */}
      <div className="phone-hidden">
        <table className={actions ? "data-table has-popovers" : "data-table"} style={{ marginBottom: 0 }}>
          <thead>
            <tr>
              <th>Expense</th>
              <th>Date</th>
              <th>Paid By</th>
              <th>Amount</th>
              {actions && <th></th>}
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id}>
                <td
                  className="audit-hover"
                  data-audit={formatAuditTooltip("Recorded", e.createdAt, e.recordedByUser?.username ?? null)}
                >
                  {e.description}
                </td>
                <td data-label="Date">{spentOn(e)}</td>
                <td data-label="Paid By">{e.paidBy || "—"}</td>
                <td data-label="Amount">{formatCents(e.amountCents)}</td>
                {actions && <td className="actions">{actions(e, "")}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="phone-only">
        {expenses.map((e) => (
          <CollapsibleGroup key={e.id} defaultOpen={false} label={`${e.description} — ${formatCents(e.amountCents)}`}>
            <div className="expense-item">
              <p>
                <strong>Date:</strong> {spentOn(e)}
              </p>
              <p>
                <strong>Paid By:</strong> {e.paidBy || "—"}
              </p>
              {actions && <div className="expense-item-actions">{actions(e, "m-")}</div>}
            </div>
          </CollapsibleGroup>
        ))}
      </div>
    </>
  );
}
