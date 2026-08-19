import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { denDisplayName, RANK_ORDER } from "@/lib/rankConfig";
import { requireAdminSession } from "@/lib/authorize";
import {
  renameHouseholdAction,
  addScoutToHouseholdAction,
  removeScoutFromHouseholdAction,
  addUserToHouseholdAction,
  removeUserFromHouseholdAction,
} from "@/lib/actions/households";
import type { Rank } from "@/generated/prisma/enums";
import { ROLE_LABELS, ROLE_BADGE_CLASSES } from "@/lib/roleLabels";
import DeleteHouseholdButton from "@/components/DeleteHouseholdButton";

export default async function ManageHouseholdPage({
  params,
}: {
  params: Promise<{ householdId: string }>;
}) {
  await requireAdminSession();

  const { householdId } = await params;
  const household = await prisma.household.findUnique({
    where: { id: householdId },
    include: { scouts: { include: { den: true } }, users: true },
  });
  if (!household) notFound();

  household.scouts.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  household.users.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const memberScoutIds = new Set(household.scouts.map((s) => s.id));
  const memberUserIds = new Set(household.users.map((u) => u.id));

  const [availableScouts, availableUsers] = await Promise.all([
    prisma.scout.findMany({
      where: { id: { notIn: Array.from(memberScoutIds) } },
      include: { den: true, household: true },
    }),
    prisma.user.findMany({
      where: { id: { notIn: Array.from(memberUserIds) } },
      include: { household: true },
      orderBy: { displayName: "asc" },
    }),
  ]);
  availableScouts.sort((a, b) => {
    if (a.den.scoutingYear !== b.den.scoutingYear) return b.den.scoutingYear.localeCompare(a.den.scoutingYear);
    const rankDiff = RANK_ORDER.indexOf(a.den.rank as Rank) - RANK_ORDER.indexOf(b.den.rank as Rank);
    if (rankDiff !== 0) return rankDiff;
    return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
  });

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">
          <Link href="/portal/admin/users/households">← Households</Link>
        </div>
        <h2>{household.name || "Unnamed Household"}</h2>
      </div>

      <div className="info-card" style={{ marginBottom: 24, maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>Name</h3>
        <form action={renameHouseholdAction} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <input type="hidden" name="householdId" value={household.id} />
          <div className="form-field" style={{ marginBottom: 0, flex: 1 }}>
            <label htmlFor="name">Household Name</label>
            <input id="name" name="name" type="text" defaultValue={household.name ?? ""} placeholder="e.g. The Smith Family" />
          </div>
          <button type="submit" className="btn btn-primary">Save</button>
        </form>
      </div>

      <div className="info-card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Scouts</h3>
        {household.scouts.length === 0 ? (
          <p style={{ marginBottom: 12 }}>No scouts in this household yet.</p>
        ) : (
          household.scouts.map((s) => (
            <div
              key={s.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                background: "var(--cream)",
                borderRadius: 8,
                padding: "8px 12px",
                marginBottom: 8,
              }}
            >
              <span>
                <strong>{s.firstName} {s.lastName}</strong> · {denDisplayName(s.den.rank, s.den.scoutingYear, s.den.label)}
              </span>
              <form action={removeScoutFromHouseholdAction}>
                <input type="hidden" name="scoutId" value={s.id} />
                <input type="hidden" name="householdId" value={household.id} />
                <button
                  type="submit"
                  className="btn btn-outline btn-small"
                  style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}
                >
                  Remove
                </button>
              </form>
            </div>
          ))
        )}

        {availableScouts.length > 0 && (
          <form
            action={addScoutToHouseholdAction}
            style={{ display: "flex", gap: 10, alignItems: "flex-end", marginTop: 16, flexWrap: "wrap" }}
          >
            <input type="hidden" name="householdId" value={household.id} />
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="scoutId">Add a scout</label>
              <select id="scoutId" name="scoutId" required style={{ minWidth: 260 }}>
                {availableScouts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.firstName} {s.lastName} — {denDisplayName(s.den.rank, s.den.scoutingYear, s.den.label)}
                    {s.household ? ` (currently in ${s.household.name || "another household"})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-primary">Add</button>
          </form>
        )}
      </div>

      <div className="info-card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>Logins</h3>
        <p>Any portal account — parent or staff who&apos;s also this family&apos;s parent/guardian.</p>
        {household.users.length === 0 ? (
          <p style={{ marginBottom: 12 }}>No logins in this household yet.</p>
        ) : (
          household.users.map((u) => (
            <div
              key={u.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                background: "var(--cream)",
                borderRadius: 8,
                padding: "8px 12px",
                marginBottom: 8,
              }}
            >
              <span>
                <strong>{u.displayName}</strong> · {u.username} ·{" "}
                <span className={`badge-pill ${ROLE_BADGE_CLASSES[u.role]}`}>{ROLE_LABELS[u.role]}</span>
              </span>
              <form action={removeUserFromHouseholdAction}>
                <input type="hidden" name="userId" value={u.id} />
                <input type="hidden" name="householdId" value={household.id} />
                <button
                  type="submit"
                  className="btn btn-outline btn-small"
                  style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}
                >
                  Remove
                </button>
              </form>
            </div>
          ))
        )}

        {availableUsers.length > 0 && (
          <form
            action={addUserToHouseholdAction}
            style={{ display: "flex", gap: 10, alignItems: "flex-end", marginTop: 16, flexWrap: "wrap" }}
          >
            <input type="hidden" name="householdId" value={household.id} />
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="userId">Add a login</label>
              <select id="userId" name="userId" required style={{ minWidth: 260 }}>
                {availableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName} ({u.username}) — {ROLE_LABELS[u.role]}
                    {u.household ? ` (currently in ${u.household.name || "another household"})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-primary">Add</button>
          </form>
        )}
      </div>

      <div className="info-card" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <DeleteHouseholdButton householdId={household.id} householdName={household.name || "this household"} />
      </div>
    </>
  );
}
