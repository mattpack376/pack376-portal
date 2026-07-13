import Link from "next/link";
import { requireParentContactsSession } from "@/lib/authorize";
import { prisma } from "@/lib/prisma";
import { RANK_ORDER, denDisplayName } from "@/lib/rankConfig";
import type { Rank } from "@/generated/prisma/enums";
import { addParentAction, updateParentAction, removeParentAction } from "@/lib/actions/parents";
import EmailAllButton from "@/components/EmailAllButton";
import PrintButton from "@/components/PrintButton";

const inputStyle = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "2px solid var(--cream-dark)",
  background: "var(--white)",
  fontSize: 16,
  width: 160,
};

const buttonStyle = { fontSize: 15 };

export default async function ParentContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await requireParentContactsSession();
  const { view } = await searchParams;
  const isMasterAdmin = session.role === "ADMIN";
  const printView = isMasterAdmin && view === "print";
  const canEdit = isMasterAdmin && !printView;

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
        <div className="eyebrow no-print">
          {printView ? (
            <Link href="/portal/roster/parents">← Exit Printable View</Link>
          ) : (
            <Link href="/portal/roster">← Roster</Link>
          )}
        </div>
        <h2>Cub&apos;s Parents&apos; Contact Information</h2>
        {printView ? (
          <p style={{ fontSize: 17 }}>
            Printable roster · generated {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          </p>
        ) : (
          <p style={{ fontSize: 17 }}>Parent/guardian name, email, and phone for each scout.</p>
        )}
        <p style={{ fontSize: 15, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {printView && <PrintButton />}
          {isMasterAdmin && !printView && (
            <Link
              href="/portal/roster/parents?view=print"
              className="btn btn-outline btn-small no-print"
              style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
            >
              Printable View
            </Link>
          )}
          {(session.role === "ADMIN" || session.role === "JUNIOR_ADMIN") && !printView && (
            <a
              href="/api/parents/export"
              className="btn btn-outline btn-small no-print"
              style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
            >
              Export All Parent Contacts (CSV)
            </a>
          )}
        </p>
      </div>

      {dens.length === 0 && <div className="info-card" style={{ fontSize: 16 }}>No dens yet.</div>}

      {printView ? (
        years.map((year) => {
          const yearDens = dens.filter((d) => d.scoutingYear === year && d.scouts.length > 0);
          if (yearDens.length === 0) return null;
          return (
            <div key={year} style={{ marginBottom: 22 }}>
              <h3 style={{ fontSize: 17, marginBottom: 10, color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {year}
              </h3>
              {yearDens.map((den) => (
                <div key={den.id} style={{ marginBottom: 18 }}>
                  <h4 style={{ fontSize: 19, marginBottom: 8, color: "var(--scout-blue)" }}>
                    {denDisplayName(den.rank, den.scoutingYear, den.label)}
                  </h4>
                  <table className="print-roster-table">
                    <thead>
                      <tr>
                        <th>Scout</th>
                        <th>Parent / Guardian</th>
                        <th>Email</th>
                        <th>Phone</th>
                      </tr>
                    </thead>
                    <tbody>
                      {den.scouts.flatMap((scout) =>
                        scout.parents.length === 0 ? (
                          <tr key={scout.id}>
                            <td>{scout.firstName} {scout.lastName}</td>
                            <td colSpan={3} style={{ color: "var(--ink-soft)" }}>No contacts on file</td>
                          </tr>
                        ) : (
                          scout.parents.map((parent, i) => (
                            <tr key={parent.id}>
                              <td>{i === 0 ? `${scout.firstName} ${scout.lastName}` : ""}</td>
                              <td>{parent.name}</td>
                              <td>{parent.email || "—"}</td>
                              <td>{parent.phone || "—"}</td>
                            </tr>
                          ))
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          );
        })
      ) : (
        years.map((year) => (
        <div key={year} style={{ marginBottom: 32 }}>
          <h3 style={{ fontSize: 19, marginBottom: 14 }}>{year}</h3>
          {dens
            .filter((d) => d.scoutingYear === year)
            .map((den) => (
              <div className="info-card" key={den.id} style={{ marginBottom: 20 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                    gap: 12,
                    marginBottom: 8,
                  }}
                >
                  <h3 style={{ marginTop: 0, fontSize: 19 }}>{denDisplayName(den.rank, den.scoutingYear, den.label)}</h3>
                  {!printView && (
                    <div className="no-print" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <a
                        href={`/api/parents/export/den/${den.id}`}
                        className="btn btn-outline btn-small"
                        style={{ borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
                      >
                        Export CSV
                      </a>
                      <EmailAllButton
                        label="Email This Den's Parents"
                        emails={den.scouts.flatMap((scout) => scout.parents.map((parent) => parent.email))}
                      />
                    </div>
                  )}
                </div>
                {den.scouts.length === 0 ? (
                  <p style={{ marginBottom: 0, fontSize: 16 }}>No scouts yet.</p>
                ) : (
                  den.scouts.map((scout) => (
                    <div
                      key={scout.id}
                      style={{ marginBottom: 18, paddingBottom: 18, borderBottom: "1px solid var(--cream-dark)" }}
                    >
                      <h4 style={{ marginBottom: 8, fontSize: 18 }}>{scout.firstName} {scout.lastName}</h4>

                      {scout.parents.length === 0 && (
                        <p style={{ fontSize: 16, marginBottom: 8 }}>No parent contacts on file.</p>
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
                                  style={{ ...buttonStyle, borderColor: "var(--scout-blue)", color: "var(--scout-blue)" }}
                                >
                                  Save
                                </button>
                              </form>
                              <form action={removeParentAction}>
                                <input type="hidden" name="parentId" value={parent.id} />
                                <button
                                  type="submit"
                                  className="btn btn-outline btn-small"
                                  style={{ ...buttonStyle, borderColor: "var(--carnival-red)", color: "var(--carnival-red)" }}
                                >
                                  Remove
                                </button>
                              </form>
                            </>
                          ) : (
                            <span style={{ fontSize: 16 }}>
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
                          <button type="submit" className="btn btn-primary btn-small" style={buttonStyle}>Add Parent</button>
                        </form>
                      )}
                    </div>
                  ))
                )}
              </div>
            ))}
        </div>
        ))
      )}
    </>
  );
}
