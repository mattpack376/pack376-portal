import { requireLedgerSession } from "@/lib/authorize";
import { getLedger } from "@/lib/ledgerData";
import { formatCents } from "@/lib/duesData";
import { balanceClass } from "@/lib/paymentStatus";
import {
  createLedgerCategoryAction,
  deleteLedgerCategoryAction,
  updateLedgerCategoryAction,
} from "@/lib/actions/ledger";
import LedgerSubNav from "@/components/LedgerSubNav";
import ActionForm from "@/components/ActionForm";
import TripAdminForm from "@/components/TripAdminForm";
import EditPopover from "@/components/EditPopover";
import SubmitButton from "@/components/SubmitButton";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";

// Server Actions on this page take their time limit from here (the Sheet sync runs after a save).
export const maxDuration = 60;

/**
 * The Ledger's categories: add, rename, Fund or Event, order, archive, and
 * delete one nothing has used. An Event category's positive balance is held
 * for that event, so it comes off Available to Spend.
 */
export default async function LedgerCategoriesPage() {
  await requireLedgerSession();
  const ledger = await getLedger();
  const totals = new Map(ledger.summary.categories.map((c) => [c.id, c]));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Money</div>
          <h2>Ledger Categories</h2>
          <p>
            Each line in the ledger goes in one category. <strong>Fund</strong> categories are the pack&apos;s own
            money; an <strong>Event</strong> category holds money collected for one event or trip, which is set aside
            from Available to Spend until it&apos;s spent or moved out. Archiving takes a category out of the pickers
            but keeps its lines and balance.
          </p>
        </div>
      </div>

      <LedgerSubNav active="categories" />

      <div style={{ marginBottom: 24 }}>
        <table className="data-table has-popovers" style={{ marginBottom: 0 }}>
          <thead>
            <tr>
              <th>Category</th>
              <th>Kind</th>
              <th>Order</th>
              <th>Lines</th>
              <th>Balance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ledger.categories.map((category) => {
              const net = totals.get(category.id)?.netCents ?? 0;
              return (
                <tr key={category.id}>
                  <td>
                    {category.name}
                    {category.archived && (
                      <>
                        {" "}
                        <span className="badge-pill badge-pending">Archived</span>
                      </>
                    )}
                  </td>
                  <td data-label="Kind">{category.kind === "EVENT" ? "Event" : "Fund"}</td>
                  <td data-label="Order">{category.sortOrder}</td>
                  <td data-label="Lines">{category.entryCount}</td>
                  <td data-label="Balance" className={balanceClass(net)}>
                    {formatCents(net)}
                  </td>
                  <td className="actions">
                    <EditPopover action={updateLedgerCategoryAction}>
                      <input type="hidden" name="id" value={category.id} />
                      <div className="form-field">
                        <label htmlFor={`category-name-${category.id}`}>Name</label>
                        <input id={`category-name-${category.id}`} name="name" required maxLength={60} defaultValue={category.name} />
                      </div>
                      <div className="form-field">
                        <label htmlFor={`category-kind-${category.id}`}>Kind</label>
                        <select
                          key={`kind-${category.id}-${category.updatedAt.toISOString()}`}
                          id={`category-kind-${category.id}`}
                          name="kind"
                          defaultValue={category.kind}
                        >
                          <option value="FUND">Fund</option>
                          <option value="EVENT">Event</option>
                        </select>
                      </div>
                      <div className="form-field">
                        <label htmlFor={`category-order-${category.id}`}>Order (lower comes first)</label>
                        <input
                          id={`category-order-${category.id}`}
                          name="sortOrder"
                          type="number"
                          step="1"
                          min="-10000"
                          max="10000"
                          defaultValue={category.sortOrder}
                        />
                      </div>
                      <div className="form-field">
                        <label className="adventure-check-item">
                          <input type="checkbox" name="archived" value="true" defaultChecked={category.archived} />
                          <span>Archived (hidden from the pickers)</span>
                        </label>
                      </div>
                      {/* SubmitButton, not SaveButton: this save can be turned down (see EditPopover). */}
                      <SubmitButton className="btn btn-primary btn-small" pendingLabel="Saving…">
                        Save Changes
                      </SubmitButton>
                    </EditPopover>
                    {category.entryCount === 0 && (
                      <ActionForm action={deleteLedgerCategoryAction}>
                        <input type="hidden" name="id" value={category.id} />
                        <ConfirmSubmitButton
                          className="btn btn-danger btn-small"
                          pendingLabel="Deleting…"
                          message={`Delete the category “${category.name}”? Nothing in the ledger uses it.`}
                        >
                          Delete
                        </ConfirmSubmitButton>
                      </ActionForm>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="info-card" style={{ maxWidth: 560 }}>
        <h3>Add a Category</h3>
        <TripAdminForm action={createLedgerCategoryAction}>
          <div className="form-row" style={{ alignItems: "flex-end" }}>
            <div className="form-field">
              <label htmlFor="new-category-name">Name</label>
              <input id="new-category-name" name="name" required maxLength={60} placeholder="Fundraising, Pinewood Derby…" />
            </div>
            <div className="form-field">
              <label htmlFor="new-category-kind">Kind</label>
              <select id="new-category-kind" name="kind" defaultValue="FUND">
                <option value="FUND">Fund</option>
                <option value="EVENT">Event</option>
              </select>
            </div>
          </div>
          <SubmitButton className="btn btn-primary" pendingLabel="Adding…">
            Add Category
          </SubmitButton>
        </TripAdminForm>
      </div>
    </>
  );
}
