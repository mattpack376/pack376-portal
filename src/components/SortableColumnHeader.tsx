import Link from "next/link";

/** A <th> whose label is a link that sets/toggles a sort query param — used for the Family/Guest-Of guest-table columns. */
export default function SortableColumnHeader({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <th>
      <Link href={href} scroll={false} style={{ color: "inherit", fontWeight: active ? 700 : undefined }}>
        {label}
        {active ? " ▲" : ""}
      </Link>
    </th>
  );
}
