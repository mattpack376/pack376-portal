import type { ReactNode } from "react";
import CollapsibleGroup from "@/components/CollapsibleGroup";
import { formatCents } from "@/lib/duesData";
import { formatAuditTooltip } from "@/lib/auditTooltip";
import { tripExpenseTotals, type getTripExpenses } from "@/lib/tripPageData";

type TripExpense = Awaited<ReturnType<typeof getTripExpenses>>[number];

/** A credit/refund is stored as a positive amount; it reads as money back. */
function signedAmount(e: TripExpense) {
  return formatCents(e.isCredit ? -e.amountCents : e.amountCents);
}

/**
 * Summary line for the collapsible Expenses group. Once any credit/refund is
 * recorded the figure is the net, and says so.
 */
export function tripExpenseGroupLabel(expenses: TripExpense[]) {
  const { creditCents, netCents } = tripExpenseTotals(expenses);
  const items = `${expenses.length} item${expenses.length === 1 ? "" : "s"}`;
  return creditCents > 0
    ? `Expenses — ${formatCents(netCents)} after credits (${items})`
    : `Expenses — ${formatCents(netCents)} (${items})`;
}

/**
 * The trip's expenses — a table on wider screens, and on phones a list of
 * collapsed rows ("Firewood — $45.00") that open to the date, who paid, and
 * any row actions. Both renderings are in the page and CSS shows one
 * (.phone-only / .phone-hidden), so `actions` is called twice per expense;
 * pass `idPrefix` into any form ids so the two copies don't collide.
 *
 * Vendor credits/refunds sit in the same list, in green with a minus sign
 * and a Credit badge, and their "Paid By" is who received the money.
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
              <th>Paid / Received By</th>
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
                  {e.isCredit && (
                    <>
                      {" "}
                      <span className="badge-pill badge-paid">Credit</span>
                    </>
                  )}
                </td>
                <td data-label="Date">{spentOn(e)}</td>
                <td data-label={e.isCredit ? "Received By" : "Paid By"}>{e.paidBy || "—"}</td>
                <td data-label="Amount" className={e.isCredit ? "balance-positive" : undefined}>
                  {signedAmount(e)}
                </td>
                {actions && <td className="actions">{actions(e, "")}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="phone-only">
        {expenses.map((e) => (
          <CollapsibleGroup
            key={e.id}
            defaultOpen={false}
            label={`${e.description} — ${signedAmount(e)}${e.isCredit ? " (credit)" : ""}`}
            labelClassName={e.isCredit ? "status-paid" : undefined}
          >
            <div className="expense-item">
              <p>
                <strong>Date:</strong> {spentOn(e)}
              </p>
              <p>
                <strong>{e.isCredit ? "Received By:" : "Paid By:"}</strong> {e.paidBy || "—"}
              </p>
              {actions && <div className="expense-item-actions">{actions(e, "m-")}</div>}
            </div>
          </CollapsibleGroup>
        ))}
      </div>
    </>
  );
}
