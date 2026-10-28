import Link from "next/link";
import SaveButton from "@/components/SaveButton";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { denDisplayName, RANK_ORDER } from "@/lib/rankConfig";
import { toDateOnlyString } from "@/lib/dateOnly";
import { requireAdminSession } from "@/lib/authorize";
import { updateScoutAction, setScoutActiveAction } from "@/lib/actions/scouts";
import type { Rank } from "@/generated/prisma/enums";
import DeleteScoutButton from "@/components/DeleteScoutButton";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import { paymentDeletionWarning, summarizePayments } from "@/lib/paymentRecords";

export default async function ManageScoutPage({
  params,
}: {
  params: Promise<{ scoutId: string }>;
}) {
  await requireAdminSession();

  const { scoutId } = await params;
  const scout = await prisma.scout.findUnique({ where: { id: scoutId }, include: { den: true, household: true } });
  if (!scout) notFound();

  const allDens = await prisma.den.findMany();
  allDens.sort((a, b) => {
    if (a.scoutingYear !== b.scoutingYear) return b.scoutingYear.localeCompare(a.scoutingYear);
    return RANK_ORDER.indexOf(a.rank as Rank) - RANK_ORDER.indexOf(b.rank as Rank);
  });
  const denYears = Array.from(new Set(allDens.map((d) => d.scoutingYear)));
  // Delete warns when dues or event payments are attached (they're kept in
  // Payment Records, but the admin should know before confirming).
  const paymentWarning = paymentDeletionWarning(await summarizePayments({ scoutIds: [scout.id] }));

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">
          <Link href="/portal/admin/users/scouts">← All Scouts</Link>
        </div>
        <h2>{scout.firstName} {scout.lastName}</h2>
        <p>
          {denDisplayName(scout.den.rank, scout.den.scoutingYear, scout.den.label)}
          {!scout.active && <span className="badge-pill badge-pending" style={{ marginLeft: 10 }}>Inactive</span>}
        </p>
      </div>

      <div className="info-card" style={{ marginBottom: 24, maxWidth: 420 }}>
        <h3>{scout.active ? "Active Scout" : "Inactive Scout"}</h3>
        <p>
          {scout.active
            ? "Marking a scout inactive hides them from their den's roster, advancement, attendance, parent contacts, photo consent and sign-up lists. Nothing is deleted — mark them active again and they're back in their den exactly as they were."
            : "Hidden from their den's roster, advancement, attendance, parent contacts, photo consent and sign-up lists. Their advancement, attendance, dues and parent contacts are all still on file. Mark them active to put them back in their den."}
        </p>
        <form action={setScoutActiveAction}>
          <input type="hidden" name="scoutId" value={scout.id} />
          <input type="hidden" name="active" value={String(!scout.active)} />
          {scout.active ? (
            <ConfirmSubmitButton
              className="btn btn-quiet"
              pendingLabel="Saving…"
              message={`Mark ${scout.firstName} ${scout.lastName} inactive? They'll be hidden from rosters, advancement and attendance until you mark them active again. Nothing is deleted.`}
            >
              Mark Inactive
            </ConfirmSubmitButton>
          ) : (
            <button type="submit" className="btn btn-primary">
              Mark Active
            </button>
          )}
        </form>
      </div>

      <div className="info-card" style={{ marginBottom: 24, maxWidth: 420 }}>
        <h3>Scout Info</h3>
        <form action={updateScoutAction}>
          <input type="hidden" name="scoutId" value={scout.id} />
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="firstName">First Name</label>
              <input id="firstName" name="firstName" type="text" defaultValue={scout.firstName} required />
            </div>
            <div className="form-field">
              <label htmlFor="lastName">Last Name</label>
              <input id="lastName" name="lastName" type="text" defaultValue={scout.lastName} required />
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="denId">Den</label>
            <select id="denId" name="denId" defaultValue={scout.denId} required>
              {denYears.map((year) => (
                <optgroup key={year} label={year}>
                  {allDens
                    .filter((den) => den.scoutingYear === year)
                    .map((den) => (
                      <option key={den.id} value={den.id}>
                        {denDisplayName(den.rank, den.scoutingYear, den.label)}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="form-row">
            <div className="form-field">
              <label htmlFor="registrationExpiresOn">Registration Expires</label>
              <input
                id="registrationExpiresOn"
                name="registrationExpiresOn"
                type="date"
                defaultValue={toDateOnlyString(scout.registrationExpiresOn) ?? ""}
              />
            </div>
            <div className="form-field">
              <label htmlFor="scouterId">Scouter ID#</label>
              <input id="scouterId" name="scouterId" type="text" defaultValue={scout.scouterId ?? ""} />
            </div>
          </div>
          <SaveButton className="btn btn-primary">Save Changes</SaveButton>
        </form>
      </div>

      <div className="info-card" style={{ marginBottom: 24, maxWidth: 420 }}>
        <h3>Household</h3>
        {scout.household ? (
          <p style={{ marginBottom: 0 }}>
            In <Link href={`/portal/admin/users/households/${scout.household.id}`}>{scout.household.name || "an unnamed household"}</Link>.
          </p>
        ) : (
          <p style={{ marginBottom: 0 }}>
            Not grouped with any household yet. Add it from the <Link href="/portal/admin/users/households">Households</Link> tab.
          </p>
        )}
      </div>

      <div className="info-card" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <DeleteScoutButton
          scoutId={scout.id}
          scoutName={`${scout.firstName} ${scout.lastName}`}
          paymentWarning={paymentWarning}
        />
      </div>
    </>
  );
}
