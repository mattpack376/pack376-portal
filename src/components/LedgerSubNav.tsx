import SegmentedNav from "@/components/SegmentedNav";

const ITEMS = [
  { key: "ledger", href: "/portal/admin/ledger", label: "Ledger" },
  { key: "categories", href: "/portal/admin/ledger/categories", label: "Categories" },
  { key: "import", href: "/portal/admin/ledger/import", label: "Import & Settings" },
];

/** Switches between the Ledger's pages. */
export default function LedgerSubNav({ active }: { active: "ledger" | "categories" | "import" }) {
  return <SegmentedNav items={ITEMS} active={active} noPrint />;
}
