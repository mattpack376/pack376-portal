import Link from "next/link";
import SaveButton from "@/components/SaveButton";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import { notFound } from "next/navigation";
import { requireEventsViewSession } from "@/lib/authorize";
import { prisma } from "@/lib/prisma";
import { getEventDetail, getGuestOfOptions } from "@/lib/eventsData";
import { formatCents } from "@/lib/duesData";
import { toDateOnlyString } from "@/lib/dateOnly";
import { RANK_ORDER, denDisplayName } from "@/lib/rankConfig";
import { DEADLINE_CATEGORY_LABELS, formatDueDate } from "@/lib/deadlineCategories";
import {
  registerScoutForEventAction,
  removeRegistrationAction,
  updateEventAction,
  toggleEventVisibilityAction,
  addGuestGroupAction,
  removeGuestGroupAction,
} from "@/lib/actions/events";
import type { Rank } from "@/generated/prisma/enums";
import DeleteEventButton from "@/components/DeleteEventButton";
import { paymentDeletionWarning } from "@/lib/paymentRecords";
import CollapsibleGroup from "@/components/CollapsibleGroup";
import GuestOfSelect from "@/components/GuestOfSelect";
import GuestGroupCountFields from "@/components/GuestGroupCountFields";
import SortableColumnHeader from "@/components/SortableColumnHeader";
import { sortGuestGroups } from "@/lib/guestSort";
import { paymentStatus, paymentRowClass } from "@/lib/paymentStatus";
import FileExportButton from "@/components/FileExportButton";
import ActionForm from "@/components/ActionForm";
import TripAdminForm from "@/components/TripAdminForm";
import SubmitButton from "@/components/SubmitButton";
import { MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from "@/lib/formValues";
import { ADMIN_GUEST_GROUP_MAX_PEOPLE, newSubmissionKey } from "@/lib/guestGroupLimits";
import { centsFieldText, textLengthAsTyped } from "@/lib/savedFormValues";

export default async function AdminEventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ guestSort?: string }>;
}) {
  // Junior Admin sees the roster and every balance; the forms are Admin-only.
  const session = await requireEventsViewSession();
  const canEdit = session.role === "ADMIN";
  const { eventId } = await params;
  const { guestSort } = await searchParams;

  const event = await getEventDetail(eventId);
  if (!event) notFound();

  const sortedGuestGroups = sortGuestGroups(event.guestGroups, guestSort);

  // The Delete/Remove prompts warn about the payments that go with them,
  // counted from what's already loaded (the same rule as summarizePayments).
  const eventPayments = [...event.registrations, ...event.guestGroups].reduce(
    (sum, row) => ({ count: sum.count + row.payments.length, totalCents: sum.totalCents + row.paidCents }),
    { count: 0, totalCents: 0 },
  );

  // Saved before the edit form's limits existed: the form says so, and the
  // action accepts the value as long as it comes back unchanged.
  const titleOverLimit = event.title.length > MAX_NAME_LENGTH;
  const descriptionOverLimit = textLengthAsTyped(event.description ?? "") > MAX_NOTE_LENGTH;

  const registeredScoutIds = new Set(event.registrations.map((r) => r.scout.id));

  type ScoutReg = (typeof event.registrations)[number];
  const scoutDenGroups = Array.from(
    event.registrations
      .reduce((map, reg) => {
        const key = reg.scout.den.id;
        if (!map.has(key)) map.set(key, { den: reg.scout.den, regs: [] as ScoutReg[] });
        map.get(key)!.regs.push(reg);
        return map;
      }, new Map<string, { den: ScoutReg["scout"]["den"]; regs: ScoutReg[] }>())
      .values(),
  ).sort((a, b) => {
    if (a.den.scoutingYear !== b.den.scoutingYear) return b.den.scoutingYear.localeCompare(a.den.scoutingYear);
    return RANK_ORDER.indexOf(a.den.rank as Rank) - RANK_ORDER.indexOf(b.den.rank as Rank);
  });
  for (const group of scoutDenGroups) {
    group.regs.sort((a, b) => {
      const lastCmp = a.scout.lastName.localeCompare(b.scout.lastName);
      return lastCmp !== 0 ? lastCmp : a.scout.firstName.localeCompare(b.scout.firstName);
    });
  }

  // Inactive scouts aren't offered for new sign-ups; ones already registered stay listed above.
  const dens = await prisma.den.findMany({
    include: { scouts: { where: { active: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] } },
  });
  dens.sort((a, b) => {
    if (a.scoutingYear !== b.scoutingYear) return b.scoutingYear.localeCompare(a.scoutingYear);
    return RANK_ORDER.indexOf(a.rank as Rank) - RANK_ORDER.indexOf(b.rank as Rank);
  });
  const availableDens = dens
    .map((den) => ({ den, scouts: den.scouts.filter((s) => !registeredScoutIds.has(s.id)) }))
    .filter((d) => d.scouts.length > 0);

  const guestOfOptions = await getGuestOfOptions();

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link href="/portal/admin/events">← Events</Link>
          </div>
          <h2>{event.title}</h2>
          <p style={{ fontSize: 17 }}>
            {DEADLINE_CATEGORY_LABELS[event.category]} · {formatDueDate(event.eventDate)}
            {event.feeCents !== null && ` · Default fee ${formatCents(event.feeCents)}`}
          </p>
          {event.description && <p style={{ fontSize: 16 }}>{event.description}</p>}
          <span className={`badge-pill ${event.visible ? "badge-attendance" : "badge-pending"}`}>
            {event.visible ? "Visible to families" : "Hidden from families"}
          </span>
        </div>
        {canEdit && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {(event.registrations.length > 0 || event.guestGroups.length > 0) && (
            <FileExportButton
              className="btn btn-quiet btn-small"
              href={`/portal/admin/events/${event.id}/guests/export`}
              label="Export CSV (Scouts & Guests)"
            />
          )}
          <form action={toggleEventVisibilityAction}>
            <input type="hidden" name="id" value={event.id} />
            <input type="hidden" name="visible" value={String(event.visible)} />
            <button
              type="submit"
              className="btn btn-quiet btn-small"
            >
              {event.visible ? "Hide from Families" : "Show to Families"}
            </button>
          </form>
          <DeleteEventButton
            eventId={event.id}
            title={event.title}
            paymentWarning={paymentDeletionWarning(eventPayments)}
          />
        </div>
        )}
      </div>

      {canEdit && (
      <div className="info-card" style={{ maxWidth: 460, marginBottom: 24 }}>
        <h3>Edit Event Details</h3>
        {/* TripAdminForm, not a bare form: a refused flyer or a mistake in a field
            is shown here, with what was typed put back, instead of on the
            generic error page with every edit lost. */}
        <TripAdminForm action={updateEventAction}>
          <input type="hidden" name="id" value={event.id} />
          <div className="form-field">
            <label htmlFor="edit-title">Title</label>
            <input id="edit-title" name="title" required maxLength={MAX_NAME_LENGTH} defaultValue={event.title} />
            {titleOverLimit && (
              <p className="form-note">
                Saved before titles were limited to {MAX_NAME_LENGTH} characters. It can stay as it is; a changed
                title has to fit.
              </p>
            )}
          </div>
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="edit-category">Category</label>
              <select id="edit-category" name="category" defaultValue={event.category}>
                {Object.entries(DEADLINE_CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="edit-eventDate">Date</label>
              <input id="edit-eventDate" name="eventDate" type="date" required defaultValue={toDateOnlyString(event.eventDate)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="edit-fee">Default Fee Per Scout ($, optional)</label>
              <input
                id="edit-fee"
                name="fee"
                type="number"
                min="0"
                step="0.01"
                defaultValue={event.feeCents !== null ? centsFieldText(event.feeCents) : undefined}
                placeholder="Also required for parent self-signup"
              />
            </div>
            <div className="form-field">
              <label htmlFor="edit-adultFee">Default Fee Per Adult Guest ($, optional)</label>
              <input
                id="edit-adultFee"
                name="adultFee"
                type="number"
                min="0"
                step="0.01"
                defaultValue={event.adultFeeCents !== null ? centsFieldText(event.adultFeeCents) : undefined}
                placeholder="Also required for guest self-signup"
              />
            </div>
            <div className="form-field">
              <label htmlFor="edit-guestChildFee">Default Fee Per Guest Child ($, optional)</label>
              <input
                id="edit-guestChildFee"
                name="guestChildFee"
                type="number"
                min="0"
                step="0.01"
                defaultValue={event.guestChildFeeCents !== null ? centsFieldText(event.guestChildFeeCents) : undefined}
                placeholder="Also required for guest self-signup"
              />
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="edit-description">Description (optional)</label>
            <textarea id="edit-description" name="description" rows={2} maxLength={MAX_NOTE_LENGTH} defaultValue={event.description ?? ""} />
            {descriptionOverLimit && (
              <p className="form-note">
                Saved before descriptions were limited to {MAX_NOTE_LENGTH.toLocaleString("en-US")} characters. It can
                stay as it is; a changed description has to fit.
              </p>
            )}
          </div>
          <div className="form-field">
            <label htmlFor="edit-flyer">Flyer (optional)</label>
            {event.flyerUrl && (
              <p style={{ marginBottom: 8 }}>
                <a href={event.flyerUrl} target="_blank" rel="noopener noreferrer" className="link">
                  View current flyer →
                </a>
              </p>
            )}
            <input id="edit-flyer" name="flyer" type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" />
            <p className="form-note">Image or PDF, up to 8MB. Uploading a new file replaces the current flyer.</p>
            {event.flyerUrl && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, marginTop: 8 }}>
                <input type="checkbox" name="removeFlyer" value="true" style={{ width: "auto" }} />
                Remove current flyer
              </label>
            )}
          </div>
          <SaveButton className="btn btn-primary">Save Changes</SaveButton>
        </TripAdminForm>
      </div>
      )}

      <div className="section-head">
        <div className="eyebrow">Roster</div>
        <h2>Scouts Registered</h2>
      </div>

      {event.registrations.length === 0 ? (
        <div className="info-card" style={{ marginBottom: 24 }}>
          <p>No scouts registered yet.</p>
        </div>
      ) : (
        <div className="info-card" style={{ marginBottom: 24 }}>
          {scoutDenGroups.map(({ den, regs }) => (
            <CollapsibleGroup key={den.id} label={`${denDisplayName(den.rank, den.scoutingYear, den.label)} (${regs.length})`}>
              <div className="table-scroll">
              <table className="data-table" style={{ marginBottom: 0 }}>
                <thead>
                  <tr>
                    <th>Scout</th>
                    <th>Paid</th>
                    <th>Remaining</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {regs.map((reg) => {
                    const status = paymentStatus(reg.remainingCents, reg.paidCents);
                    return (
                      <tr key={reg.id} className={paymentRowClass(reg.remainingCents, reg.paidCents)}>
                        <td>{reg.scout.firstName} {reg.scout.lastName}</td>
                        <td data-label="Paid">{formatCents(reg.paidCents)}</td>
                        <td data-label="Remaining">{formatCents(reg.remainingCents)}</td>
                        <td data-label="Status"><span className={`badge-pill ${status.cls}`}>{status.label}</span></td>
                        <td className="actions">
                          <Link
                            className="btn btn-quiet btn-small"
                            href={`/portal/admin/events/${event.id}/${reg.id}`}
                          >
                            {canEdit ? "Manage Payments" : "View Payments"}
                          </Link>
                          {canEdit && (
                            <form action={removeRegistrationAction}>
                              <input type="hidden" name="registrationId" value={reg.id} />
                              <input type="hidden" name="eventId" value={event.id} />
                              <ConfirmSubmitButton
                                className="btn btn-danger btn-small"
                                pendingLabel="Removing…"
                                message={`Remove ${reg.scout.firstName} ${reg.scout.lastName} from “${event.title}”?${paymentDeletionWarning({ count: reg.payments.length, totalCents: reg.paidCents })} This can't be undone.`}
                              >
                                Remove
                              </ConfirmSubmitButton>
                            </form>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </CollapsibleGroup>
          ))}
        </div>
      )}

      {canEdit && (
      <div className="info-card" style={{ maxWidth: 460, marginBottom: 32 }}>
        <h3>Register Scouts</h3>
        {availableDens.length === 0 ? (
          <p style={{ marginBottom: 0 }}>Every scout is already registered for this event.</p>
        ) : (
          <ActionForm action={registerScoutForEventAction}>
            <input type="hidden" name="eventId" value={event.id} />
            <p className="form-note" style={{ marginTop: 0, marginBottom: 8 }}>
              Check every scout signing up — they&apos;ll all get the same amount owed below.
            </p>
            <div style={{ maxHeight: 260, overflowY: "auto", marginBottom: 16, paddingRight: 4 }}>
              {availableDens.map(({ den, scouts }) => (
                <CollapsibleGroup key={den.id} label={`${denDisplayName(den.rank, den.scoutingYear, den.label)} (${scouts.length})`}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                    {scouts.map((scout) => (
                      <label key={scout.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15 }}>
                        <input type="checkbox" name="scoutId" value={scout.id} />
                        {scout.firstName} {scout.lastName}
                      </label>
                    ))}
                  </div>
                </CollapsibleGroup>
              ))}
            </div>
            <div className="form-field">
              <label htmlFor="amountOwed">Amount Owed ($)</label>
              <input
                id="amountOwed"
                name="amountOwed"
                type="number"
                min="0"
                step="0.01"
                required
                defaultValue={event.feeCents !== null ? (event.feeCents / 100).toFixed(2) : undefined}
              />
            </div>
            <SubmitButton className="btn btn-primary" pendingLabel="Registering…">Register Selected Scouts</SubmitButton>
          </ActionForm>
        )}
      </div>
      )}

      <div className="section-head">
        <div className="eyebrow">Chaperones &amp; Guests</div>
        <h2>Guest Groups</h2>
        <p>
          Families or leaders bringing guests — tracked as a name plus an adult and kid headcount, with one combined
          balance per group. Works for guests with no scout on the roster too.
        </p>
      </div>

      {event.guestGroups.length === 0 ? (
        <div className="info-card" style={{ marginBottom: 24 }}>
          <p>No guest groups registered yet.</p>
        </div>
      ) : (
        <div className="table-scroll" style={{ marginBottom: 32 }}>
        <table className="data-table cards-md">
          <thead>
            <tr>
              <SortableColumnHeader href={`/portal/admin/events/${event.id}?guestSort=family`} label="Family Name / Guest Name" active={guestSort === "family"} />
              <SortableColumnHeader href={`/portal/admin/events/${event.id}?guestSort=guestof`} label="Guest Of" active={guestSort === "guestof"} />
              <th>Adults</th>
              <th>Kids</th>
              <th>Paid</th>
              <th>Remaining</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedGuestGroups.map((group) => {
              const status = paymentStatus(group.remainingCents, group.paidCents);
              return (
                <tr key={group.id}>
                  <td>{group.familyName}</td>
                  <td data-label="Guest Of">{group.guestOfLabel ?? "—"}</td>
                  <td data-label="Adults">{group.adultCount}</td>
                  <td data-label="Kids">{group.childCount}</td>
                  <td data-label="Paid">{formatCents(group.paidCents)}</td>
                  <td data-label="Remaining">{formatCents(group.remainingCents)}</td>
                  <td data-label="Status"><span className={`badge-pill ${status.cls}`}>{status.label}</span></td>
                  <td className="actions">
                    <Link
                      className="btn btn-quiet btn-small"
                      href={`/portal/admin/events/${event.id}/guests/${group.id}`}
                    >
                      {canEdit ? "Manage Payments" : "View Payments"}
                    </Link>
                    {canEdit && (
                      <form action={removeGuestGroupAction}>
                        <input type="hidden" name="guestGroupId" value={group.id} />
                        <input type="hidden" name="eventId" value={event.id} />
                        <ConfirmSubmitButton
                          className="btn btn-danger btn-small"
                          pendingLabel="Removing…"
                          message={`Remove the guest group “${group.familyName}” from “${event.title}”?${paymentDeletionWarning({ count: group.payments.length, totalCents: group.paidCents })} This can't be undone.`}
                        >
                          Remove
                        </ConfirmSubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}

      {canEdit && (
      <div className="info-card" style={{ maxWidth: 460 }}>
        <h3>Register a Guest Group</h3>
        <ActionForm action={addGuestGroupAction}>
          <input type="hidden" name="eventId" value={event.id} />
          {/* A new key each time the page renders: pressing Add twice adds one group. */}
          <input type="hidden" name="submissionKey" value={newSubmissionKey()} />
          <div className="form-field">
            <label htmlFor="familyName">Family Name / Guest Name</label>
            <input id="familyName" name="familyName" required maxLength={MAX_NAME_LENGTH} placeholder="e.g. The Smith Family" />
          </div>
          <div className="form-field">
            <label htmlFor="guestOf">Guest Of</label>
            <GuestOfSelect id="guestOf" densWithScouts={guestOfOptions.densWithScouts} staff={guestOfOptions.staff} />
          </div>
          <GuestGroupCountFields
            idPrefix="add-guest"
            adultFeeCents={event.adultFeeCents}
            guestChildFeeCents={event.guestChildFeeCents}
            maxPeople={ADMIN_GUEST_GROUP_MAX_PEOPLE}
          />
          <SubmitButton className="btn btn-primary" pendingLabel="Adding…">Add</SubmitButton>
        </ActionForm>
      </div>
      )}
    </>
  );
}
