import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { denDisplayName, RANK_ORDER } from "@/lib/rankConfig";
import { requireAdminSession } from "@/lib/authorize";
import { registrationStatus } from "@/lib/scoutRegistration";
import type { Rank } from "@/generated/prisma/enums";
import UsersSubNav from "@/components/UsersSubNav";

export default async function AdminScoutsPage() {
  await requireAdminSession();

  const scouts = await prisma.scout.findMany({
    include: { den: true },
  });
  scouts.sort((a, b) => {
    if (a.den.scoutingYear !== b.den.scoutingYear) return b.den.scoutingYear.localeCompare(a.den.scoutingYear);
    const rankDiff = RANK_ORDER.indexOf(a.den.rank as Rank) - RANK_ORDER.indexOf(b.den.rank as Rank);
    if (rankDiff !== 0) return rankDiff;
    return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
  });
  const now = new Date();

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">Admin</div>
        <h2>Accounts</h2>
        <p>Every scout on the roster. Add or remove scouts from a den&apos;s page — edit their details here.</p>
      </div>

      <UsersSubNav active="scouts" />

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Den</th>
              <th>Registration Expires</th>
              <th>Scouter ID#</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {scouts.length === 0 && (
              <tr>
                <td colSpan={6}>No scouts yet — add one from a den&apos;s page.</td>
              </tr>
            )}
            {scouts.map((scout) => {
              const status = registrationStatus(scout.registrationExpiresOn, now);
              return (
                <tr key={scout.id}>
                  <td>{scout.firstName} {scout.lastName}</td>
                  <td>{denDisplayName(scout.den.rank, scout.den.scoutingYear, scout.den.label)}</td>
                  <td>
                    {scout.registrationExpiresOn
                      ? scout.registrationExpiresOn.toLocaleDateString("en-US", { timeZone: "UTC" })
                      : "—"}
                  </td>
                  <td>{scout.scouterId || "—"}</td>
                  <td><span className={`badge-pill ${status.cls}`}>{status.label}</span></td>
                  <td className="actions">
                    <Link
                      className="btn btn-outline btn-small"
                      style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
                      href={`/portal/admin/users/scouts/${scout.id}`}
                    >
                      Manage
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
