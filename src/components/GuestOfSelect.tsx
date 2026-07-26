type DenGroup = { id: string; label: string; scouts: { id: string; firstName: string; lastName: string }[] };
type Staff = { id: string; label: string };

/** "Guest Of" picker — links a guest group to the scout or leader/admin they're attending with. Encodes the choice as "scout:<id>" | "user:<id>" | "", parsed server-side. */
export default function GuestOfSelect({
  id,
  densWithScouts,
  staff,
  defaultValue,
}: {
  id: string;
  densWithScouts: DenGroup[];
  staff: Staff[];
  defaultValue?: string;
}) {
  return (
    <select id={id} name="guestOf" defaultValue={defaultValue ?? ""}>
      <option value="">— None / Outside Family —</option>
      <optgroup label="Staff (Leaders &amp; Admins)">
        {staff.map((u) => (
          <option key={u.id} value={`user:${u.id}`}>{u.label}</option>
        ))}
      </optgroup>
      {densWithScouts.map((den) => (
        <optgroup key={den.id} label={den.label}>
          {den.scouts.map((s) => (
            <option key={s.id} value={`scout:${s.id}`}>{s.firstName} {s.lastName}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
