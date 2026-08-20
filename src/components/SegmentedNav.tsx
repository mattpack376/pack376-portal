import Link from "next/link";

export type SegmentedItem = {
  /** Compared against `active` to decide which segment is selected. */
  key: string;
  href: string;
  label: string;
};

/**
 * A row of links where exactly one is selected — sub-navigation, filters,
 * sort modes. Not for the attendance page's jump links, which scroll to an
 * anchor on the same page and have no selected state.
 */
export default function SegmentedNav({
  items,
  active,
  noPrint = false,
}: {
  items: SegmentedItem[];
  active: string;
  noPrint?: boolean;
}) {
  return (
    <div className={noPrint ? "segmented no-print" : "segmented"}>
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.key === active ? "page" : undefined}
          className={`btn btn-small ${item.key === active ? "btn-primary" : "btn-quiet"}`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
