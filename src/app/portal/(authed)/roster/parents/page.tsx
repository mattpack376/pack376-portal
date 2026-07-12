import Link from "next/link";
import { requireParentContactsSession } from "@/lib/authorize";
import { prisma } from "@/lib/prisma";
import { RANK_ORDER, denDisplayName } from "@/lib/rankConfig";
import type { Rank } from "@/generated/prisma/enums";
import { addParentAction, updateParentAction, removeParentAction } from "@/lib/actions/parents";

const inputStyle = {
  padding: "7px 10px",
  borderRadius: 8,
  border: "2px solid var(--cream-dark)",
  background: "var(--white)",
  fontSize: 14,
  width: 140,
};

export default async function ParentContactsPage() {
  const session = await requireParentContactsSession();
  const canEdit = session.role === "ADMIN";

  if (session.role === "DEN" && session.denIds.length === 0) {
    return <div className="info-card">You don&apos;t have a den assigned yet. Contact an admin.</div>;
  }

  const dens = await prisma.den.findMany({
    where: session.role === "DEN" ? { id: { in: session.denIds } } : undefined,
    include: {
      scouts: {
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        include: { parents: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
  dens.sort((a, b) => {
    if (a.scoutingYear !== b.scoutingYear) return b.scoutingYear.localeCompare(a.scoutingYear);
    return RANK_ORDER.indexOf(a.rank as Rank) - RANK_ORDER.indexOf(b.rank as Rank);
  });
  const years = Array.from(new Set(dens.map((d) => d.scoutingYear)));

  return (
    <>
      <div className="section-head">
        <div className="eyebrow">
          <Link href="/portal/roster">← Roster</Link>
        </div>
        <h2>Cub&apos;s Parents&apos; Contact Information</h2>
        <p>Parent/guardian name, email, and phone for each scout.</p>
      </div>

      {dens.length === 0 && <div className="info-card">No dens yet.</div>}

      {years.map((year) => (
        <div key={year} style={{ marginBottom: 32 }}>
          <h3 style={{ fontSize: 17, marginBottom: 14 }}>{year}</h3>
          {dens
            .filter((d) => d.scoutingYear === year)
            .map((den) => (
              <div className="info-card" key={den.id} style={{ marginBottom: 20 }}>
                <h3 style={{ marginTop: 0 }}>{denDisplayName(den.rank, den.scoutingYear, den.label)}</h3>
                {den.scouts.length === 0 ? (
                  <p style={{ marginBottom: 0 }}>No scouts yet.</p>
                ) : (
                  den.scouts.map((scout) => (
                    <div
                      key={scout.id}
                      style={{ marginBottom: 18, paddingBottom: 18, borderBottom: "1px solid var(--cream-dark)" }}
                    >
                      <h4 style={{ marginBottom: 8 }}>{scout.firstName} {scout.lastName}</h4>

                      {scout.parents.length === 0 && (
                        <p style={{ fontSize: 14, marginBottom: 8 }}>No parent contacts on file.</p>
                      )}

                      {scout.parents.map((parent) => (
                        <div
                          key={parent.id}
                          style={{
                            display: "flex",
                            gap: 8,
                            flexWrap: "wrap",
                            alignItems: "center",
                            background: "var(--cream)",
                            padding: "8px 12px",
                            borderRadius: 8,
                            marginBottom: 8,
                          }}
                        >
                          {canEdit ? (
                            <>
                              <form
                                action={updateParentAction}
                                style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", flex: 1 }}
                              >
                                <input type="hidden" name="parentId" value={parent.id} />
                                <input name="name" defaultValue={parent.name} required style={inputStyle} placeholder="Name" />
                                <input
                                  name="email"
                                  type="email"
                                  defaultValue={parent.email ?? ""}
                                  style={inputStyle}
                                  placeholder="Email"
                                />
                                <input
                                  name="phone"
                                  type="tel"
                                  defaultValue={parent.phone ?? ""}
                                  style={inputStyle}
                                  placeholder="Phone"
                                />
                                <button
                                  type="submit"
                                  className="btn btn-outline btn-small"
                                  style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
                                >
                                  Save
                                </button>
                              </form>
                              <form action={removeParentAction}>
                                <input type="hidden" name="parentId" value={parent.id} />
                                <button
                                  type="submit"
                                  className="btn btn-outline btn-small"
                                  style={{ borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}
                                >
                                  Remove
                                </button>
                              </form>
                            </>
                          ) : (
                            <span style={{ fontSize: 14 }}>
                              <strong>{parent.name}</strong>
                              {parent.email && ` · ${parent.email}`}
                              {parent.phone && ` · ${parent.phone}`}
                            </span>
                          )}
                        </div>
                      ))}

                      {canEdit && (
                        <form
                          action={addParentAction}
                          style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}
                        >
                          <input type="hidden" name="scoutId" value={scout.id} />
                          <input name="name" required placeholder="Parent name" style={inputStyle} />
                          <input name="email" type="email" placeholder="Email" style={inputStyle} />
                          <input name="phone" type="tel" placeholder="Phone" style={inputStyle} />
                          <button type="submit" className="btn btn-primary btn-small">Add Parent</button>
                        </form>
                      )}
                    </div>
                  ))
                )}
              </div>
            ))}
        </div>
      ))}
    </>
  );
}
