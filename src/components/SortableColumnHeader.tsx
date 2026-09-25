import Link from "next/link";

/**
 * A <th> whose label is a link that sets/toggles a sort query param — used for the Family/Guest-Of guest-table columns.
 * The "sortable" class is what keeps these visible on a phone, where the table becomes cards and the rest of its
 * header row is hidden — see "Tables as cards on phones" in globals.css.
 */
export default function SortableColumnHeader({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <th className="sortable">
      <Link href={href} scroll={false} className={active ? "active" : undefined}>
        {label}
        {active ? " ▲" : ""}
      </Link>
    </th>
  );
}
