import Link from "next/link";

export default function UsersSubNav({ active }: { active: "staff" | "parents" | "scouts" | "households" }) {
  return (
    <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
      <Link
        href="/portal/admin/users"
        className={`btn btn-small ${active === "staff" ? "btn-primary" : "btn-quiet"}`}
      >
        Staff Accounts
      </Link>
      <Link
        href="/portal/admin/users/parents"
        className={`btn btn-small ${active === "parents" ? "btn-primary" : "btn-quiet"}`}
      >
        Parent Accounts
      </Link>
      <Link
        href="/portal/admin/users/scouts"
        className={`btn btn-small ${active === "scouts" ? "btn-primary" : "btn-quiet"}`}
      >
        Scouts
      </Link>
      <Link
        href="/portal/admin/users/households"
        className={`btn btn-small ${active === "households" ? "btn-primary" : "btn-quiet"}`}
      >
        Households
      </Link>
    </div>
  );
}
