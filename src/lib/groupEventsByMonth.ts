export function groupEventsByMonth<T extends { sortDate: Date }>(events: T[]) {
  const groups: { key: string; label: string; events: T[] }[] = [];
  for (const event of events) {
    const key = `${event.sortDate.getUTCFullYear()}-${event.sortDate.getUTCMonth()}`;
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = {
        key,
        label: event.sortDate.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
        events: [],
      };
      groups.push(group);
    }
    group.events.push(event);
  }
  return groups;
}
