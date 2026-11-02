import { toDateOnlyString, todayDateOnlyString } from "@/lib/dateOnly";
import { centsFieldText } from "@/lib/savedFormValues";

type CategoryOption = { id: string; name: string; archived: boolean };

/** What the Edit popover fills the fields with. */
export type LedgerEntryFieldValues = {
  id: string;
  version: string;
  entryDate: Date;
  description: string;
  categoryId: string;
  direction: "IN" | "OUT";
  amountCents: number;
  note: string | null;
};

/**
 * The fields of one ledger line — date, description, category, in/out,
 * amount, note — shared by the Add form and each line's Edit popover.
 * `idPrefix` keeps the ids apart when several copies are on the page.
 *
 * The two selects are keyed on what they show (the line's version, or the
 * category list): React 19 resets an action form after every submit, and an
 * uncontrolled select that isn't remounted can keep showing a stale choice.
 */
export default function LedgerEntryFields({
  idPrefix,
  categories,
  entry,
  defaultCategoryId,
}: {
  idPrefix: string;
  /** The categories a line can go into: the unarchived ones. */
  categories: CategoryOption[];
  entry?: LedgerEntryFieldValues & { categoryName?: string };
  defaultCategoryId?: string;
}) {
  const options =
    entry && !categories.some((c) => c.id === entry.categoryId)
      ? [...categories, { id: entry.categoryId, name: `${entry.categoryName ?? "Current category"} (archived)`, archived: true }]
      : categories;
  const selectKey = entry ? entry.version : categories.map((c) => c.id).join(",");

  return (
    <>
      {entry && (
        <>
          <input type="hidden" name="id" value={entry.id} />
          <input type="hidden" name="version" value={entry.version} />
        </>
      )}
      <div className="form-field">
        <label htmlFor={`${idPrefix}entryDate`}>Date</label>
        <input
          id={`${idPrefix}entryDate`}
          name="entryDate"
          type="date"
          required
          max={todayDateOnlyString()}
          defaultValue={entry ? toDateOnlyString(entry.entryDate) : todayDateOnlyString()}
        />
      </div>
      <div className="form-field">
        <label htmlFor={`${idPrefix}description`}>Description</label>
        <input
          id={`${idPrefix}description`}
          name="description"
          required
          maxLength={200}
          defaultValue={entry?.description ?? ""}
          placeholder={entry ? undefined : "Dues deposit, campsite fee, Zelle to…"}
        />
      </div>
      <div className="form-field">
        <label htmlFor={`${idPrefix}categoryId`}>Category</label>
        <select
          key={`category-${selectKey}`}
          id={`${idPrefix}categoryId`}
          name="categoryId"
          required
          defaultValue={entry?.categoryId ?? defaultCategoryId ?? options[0]?.id}
        >
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="form-field">
        <label htmlFor={`${idPrefix}direction`}>In or Out</label>
        <select key={`direction-${selectKey}`} id={`${idPrefix}direction`} name="direction" defaultValue={entry?.direction ?? "IN"}>
          <option value="IN">Money in (+)</option>
          <option value="OUT">Money out (−)</option>
        </select>
      </div>
      <div className="form-field">
        <label htmlFor={`${idPrefix}amount`}>Amount ($)</label>
        <input
          id={`${idPrefix}amount`}
          name="amount"
          type="number"
          min="0.01"
          max="1000000"
          step="0.01"
          required
          defaultValue={entry ? centsFieldText(entry.amountCents) : ""}
        />
      </div>
      <div className="form-field">
        <label htmlFor={`${idPrefix}note`}>Note (optional)</label>
        <textarea id={`${idPrefix}note`} name="note" rows={2} maxLength={2000} defaultValue={entry?.note ?? ""} />
      </div>
    </>
  );
}
