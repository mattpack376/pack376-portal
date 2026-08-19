import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { denDisplayName, RANK_ORDER } from "@/lib/rankConfig";
import { requireAdminSession } from "@/lib/authorize";
import { updateScoutAction } from "@/lib/actions/scouts";
import type { Rank } from "@/generated/prisma/enums";
import DeleteScoutButton from "@/components/DeleteScoutButton";

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

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

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">
          <Link href="/portal/admin/users/scouts">← All Scouts</Link>
        </div>
        <h2>{scout.firstName} {scout.lastName}</h2>
        <p>{denDisplayName(scout.den.rank, scout.den.scoutingYear, scout.den.label)}</p>
      </div>

      <div className="info-card" style={{ marginBottom: 24, maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>Scout Info</h3>
        <form action={updateScoutAction}>
          <input type="hidden" name="scoutId" value={scout.id} />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="form-field" style={{ flex: "1 1 160px" }}>
              <label htmlFor="firstName">First Name</label>
              <input id="firstName" name="firstName" type="text" defaultValue={scout.firstName} required />
            </div>
            <div className="form-field" style={{ flex: "1 1 160px" }}>
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
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="form-field" style={{ flex: "1 1 160px" }}>
              <label htmlFor="registrationExpiresOn">Registration Expires</label>
              <input
                id="registrationExpiresOn"
                name="registrationExpiresOn"
                type="date"
                defaultValue={scout.registrationExpiresOn ? toDateInputValue(scout.registrationExpiresOn) : ""}
              />
            </div>
            <div className="form-field" style={{ flex: "1 1 160px" }}>
              <label htmlFor="scouterId">Scouter ID#</label>
              <input id="scouterId" name="scouterId" type="text" defaultValue={scout.scouterId ?? ""} />
            </div>
          </div>
          <button type="submit" className="btn btn-primary">Save Changes</button>
        </form>
      </div>

      <div className="info-card" style={{ marginBottom: 24, maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>Household</h3>
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
        <DeleteScoutButton scoutId={scout.id} scoutName={`${scout.firstName} ${scout.lastName}`} />
      </div>
    </>
  );
}
