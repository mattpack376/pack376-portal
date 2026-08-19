import Link from "next/link";

export default function UsersSubNav({ active }: { active: "staff" | "parents" | "scouts" | "households" }) {
  const linkStyle = (isActive: boolean) =>
    isActive ? undefined : { borderColor: "var(--scout-blue)", color: "var(--scout-blue)" };

  return (
    <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
      <Link
        href="/portal/admin/users"
        className={`btn btn-small ${active === "staff" ? "btn-primary" : "btn-outline"}`}
        style={linkStyle(active === "staff")}
      >
        Staff Accounts
      </Link>
      <Link
        href="/portal/admin/users/parents"
        className={`btn btn-small ${active === "parents" ? "btn-primary" : "btn-outline"}`}
        style={linkStyle(active === "parents")}
      >
        Parent Accounts
      </Link>
      <Link
        href="/portal/admin/users/scouts"
        className={`btn btn-small ${active === "scouts" ? "btn-primary" : "btn-outline"}`}
        style={linkStyle(active === "scouts")}
      >
        Scouts
      </Link>
      <Link
        href="/portal/admin/users/households"
        className={`btn btn-small ${active === "households" ? "btn-primary" : "btn-outline"}`}
        style={linkStyle(active === "households")}
      >
        Households
      </Link>
    </div>
  );
}
