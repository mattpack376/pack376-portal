import SegmentedNav from "@/components/SegmentedNav";

/**
 * Scouts ⇄ Leaders & Committee on the pack-wide attendance screens. Both
 * trackers run on one shared meeting calendar, so from a meeting page this
 * switches to the same date on the other side, and from the calendar it
 * keeps the selected scouting year.
 */
export default function AttendanceSubNav({
  active,
  meetingDateId,
  year,
}: {
  active: "scouts" | "leaders";
  meetingDateId?: string;
  year?: string;
}) {
  const suffix = meetingDateId ? `/${meetingDateId}` : year ? `?year=${encodeURIComponent(year)}` : "";
  return (
    <SegmentedNav
      active={active}
      noPrint
      items={[
        { key: "scouts", href: `/portal/admin/attendance${suffix}`, label: "Scouts" },
        { key: "leaders", href: `/portal/admin/attendance/leaders${suffix}`, label: "Leaders & Committee" },
      ]}
    />
  );
}
