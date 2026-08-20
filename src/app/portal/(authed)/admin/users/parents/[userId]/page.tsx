import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { denDisplayName, RANK_ORDER } from "@/lib/rankConfig";
import { requireAdminSession } from "@/lib/authorize";
import { updateUserEmailAction, updateUserDisplayNameAction, updateUserPhoneAction } from "@/lib/actions/users";
import { attachParentToScoutAction } from "@/lib/actions/parents";
import type { Rank } from "@/generated/prisma/enums";
import ResetPasswordButton from "@/components/ResetPasswordButton";
import DeleteUserButton from "@/components/DeleteUserButton";
import UnlinkParentScoutButton from "@/components/UnlinkParentScoutButton";

export default async function ManageParentAccountPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  await requireAdminSession();

  const { userId } = await params;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      parentContacts: {
        include: { scout: { include: { den: true } } },
        orderBy: { createdAt: "asc" },
      },
      household: true,
    },
  });
  if (!user || user.role !== "PARENT") notFound();

  const attachedScoutIds = new Set(user.parentContacts.map((c) => c.scoutId));
  const availableScouts = await prisma.scout.findMany({
    where: { id: { notIn: Array.from(attachedScoutIds) } },
    include: { den: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  availableScouts.sort((a, b) => {
    if (a.den.scoutingYear !== b.den.scoutingYear) return b.den.scoutingYear.localeCompare(a.den.scoutingYear);
    return RANK_ORDER.indexOf(a.den.rank as Rank) - RANK_ORDER.indexOf(b.den.rank as Rank);
  });

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">
          <Link href="/portal/admin/users/parents">← Parent Accounts</Link>
        </div>
        <h2>{user.displayName}</h2>
        <p>{user.username}</p>
      </div>

      <div className="info-card" style={{ marginBottom: 24, maxWidth: 420 }}>
        <h3>Display Name</h3>
        <form action={updateUserDisplayNameAction} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <input type="hidden" name="userId" value={user.id} />
          <div className="form-field" style={{ marginBottom: 0, flex: 1 }}>
            <label htmlFor="displayName">Display Name</label>
            <input id="displayName" name="displayName" type="text" defaultValue={user.displayName} required />
          </div>
          <button type="submit" className="btn btn-primary">Save</button>
        </form>
      </div>

      <div className="info-card" style={{ marginBottom: 24, maxWidth: 420 }}>
        <h3>Contact Email</h3>
        <p>This is also their portal login username — changing it here updates contact use only, not how they sign in.</p>
        <form action={updateUserEmailAction} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <input type="hidden" name="userId" value={user.id} />
          <div className="form-field" style={{ marginBottom: 0, flex: 1 }}>
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" defaultValue={user.email ?? ""} />
          </div>
          <button type="submit" className="btn btn-primary">Save</button>
        </form>
      </div>

      <div className="info-card" style={{ marginBottom: 24, maxWidth: 420 }}>
        <h3>Phone Number</h3>
        <p>Kept in sync with this contact&apos;s phone on Roster → Parents for every scout attached below.</p>
        <form action={updateUserPhoneAction} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <input type="hidden" name="userId" value={user.id} />
          <div className="form-field" style={{ marginBottom: 0, flex: 1 }}>
            <label htmlFor="phone">Phone</label>
            <input id="phone" name="phone" type="tel" defaultValue={user.phone ?? ""} placeholder="(212)555-1234" />
          </div>
          <button type="submit" className="btn btn-primary">Save</button>
        </form>
      </div>

      <div className="info-card" style={{ marginBottom: 24 }}>
        <h3>Kids Attached</h3>
        <p>
          Scouts this login can see on the Parent Dashboard. Unlinking keeps the roster contact info on the scout —
          it only revokes this account&apos;s portal access to that scout.
        </p>
        {user.parentContacts.length === 0 ? (
          <p style={{ marginBottom: 0 }}>Not attached to any scout yet.</p>
        ) : (
          user.parentContacts.map((c) => (
            <div
              key={c.id}
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
                <strong>{c.scout.firstName} {c.scout.lastName}</strong> ·{" "}
                {denDisplayName(c.scout.den.rank, c.scout.den.scoutingYear, c.scout.den.label)}
              </span>
              <UnlinkParentScoutButton parentId={c.id} scoutName={`${c.scout.firstName} ${c.scout.lastName}`} />
            </div>
          ))
        )}

        {availableScouts.length > 0 && (
          <form
            action={attachParentToScoutAction}
            style={{ display: "flex", gap: 10, alignItems: "flex-end", marginTop: 16, flexWrap: "wrap" }}
          >
            <input type="hidden" name="userId" value={user.id} />
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="scoutId">Attach to another scout</label>
              <select id="scoutId" name="scoutId" required style={{ minWidth: 220 }}>
                {availableScouts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.firstName} {s.lastName} — {denDisplayName(s.den.rank, s.den.scoutingYear, s.den.label)}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-primary">Attach</button>
          </form>
        )}
      </div>

      <div className="info-card" style={{ marginBottom: 24, maxWidth: 420 }}>
        <h3>Household</h3>
        {user.household ? (
          <p style={{ marginBottom: 0 }}>
            In <Link href={`/portal/admin/users/households/${user.household.id}`}>{user.household.name || "an unnamed household"}</Link>.
          </p>
        ) : (
          <p style={{ marginBottom: 0 }}>
            Not grouped with any household yet. Add it from the <Link href="/portal/admin/users/households">Households</Link> tab.
          </p>
        )}
      </div>

      <div className="info-card" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <ResetPasswordButton userId={user.id} />
        <DeleteUserButton userId={user.id} username={user.username} redirectTo="/portal/admin/users/parents" />
      </div>
    </>
  );
}
