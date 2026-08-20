import SegmentedNav from "@/components/SegmentedNav";

const ITEMS = [
  { key: "staff", href: "/portal/admin/users", label: "Staff Accounts" },
  { key: "parents", href: "/portal/admin/users/parents", label: "Parent Accounts" },
  { key: "scouts", href: "/portal/admin/users/scouts", label: "Scouts" },
  { key: "households", href: "/portal/admin/users/households", label: "Households" },
];

export default function UsersSubNav({
  active,
}: {
  active: "staff" | "parents" | "scouts" | "households";
}) {
  return <SegmentedNav items={ITEMS} active={active} noPrint />;
}
