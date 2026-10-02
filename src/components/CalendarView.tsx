"use client";

import { useMemo, useState } from "react";
import {
  CALENDAR_MONTHS,
  badgeParts,
  daysBetween,
  lastDay,
  longDateLabel,
  monthShort,
  monthTitle,
  type CalendarCategory,
  type CalendarEvent,
} from "@/lib/calendarData";

type FilterKey = "all" | "camping" | "pack-night" | "one-day" | "fundraiser" | "volunteer" | "no-meeting";

const FILTERS: { key: FilterKey; label: string; icon: string; cat?: CalendarCategory }[] = [
  { key: "all", label: "Everything", icon: "🗓️" },
  { key: "camping", label: "Camping Trips", icon: "⛺", cat: "camping" },
  { key: "pack-night", label: "Pack Nights", icon: "🎟️", cat: "pack-night" },
  { key: "one-day", label: "One-Day Events", icon: "☀️", cat: "one-day" },
  { key: "fundraiser", label: "Fundraisers", icon: "💵", cat: "fundraiser" },
  { key: "volunteer", label: "Leader & Volunteer", icon: "🛠️" },
  { key: "no-meeting", label: "No Meeting", icon: "🚫" },
];

const CATEGORY_PILL: Record<CalendarCategory, { icon: string; label: string } | null> = {
  camping: { icon: "⛺", label: "Camping" },
  "pack-night": { icon: "🎟️", label: "Pack Night" },
  "one-day": { icon: "☀️", label: "One-Day Event" },
  fundraiser: { icon: "💵", label: "Fundraiser" },
  general: null,
};

const VOLUNTEER_TAG = { leaders: "Leaders & Volunteers", "all-hands": "All Hands on Deck" } as const;

function matches(e: CalendarEvent, filter: FilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "volunteer") return !!e.volunteer;
  if (filter === "no-meeting") return !!e.noMeeting;
  return e.category === filter;
}

/** "Happening now", "Today", "Tomorrow", "in 8 days". */
function countdown(e: CalendarEvent, today: string): string {
  if (e.date <= today && today <= lastDay(e)) return "Happening now";
  const n = daysBetween(today, e.date);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  return `in ${n} days`;
}

/**
 * `today` comes from the server (the pack's Eastern date) rather than from
 * `new Date()` here, so the dimmed past events and the Next Up card render
 * identically on the server and in the browser — no hydration mismatch, and
 * no layout jump when an effect would otherwise fill them in.
 */
export default function CalendarView({ events, today }: { events: CalendarEvent[]; today: string }) {
  const [filter, setFilter] = useState<FilterKey>("all");

  // Stable sort: two events on one day keep the order they're listed in the data file.
  const sorted = useMemo(() => [...events].sort((a, b) => a.date.localeCompare(b.date)), [events]);

  const nextUp = useMemo(
    () =>
      sorted.find((e) => lastDay(e) >= today && e.category !== "general" && !e.volunteer && !e.noMeeting),
    [sorted, today],
  );

  const months = useMemo(() => {
    const byMonth = new Map<string, CalendarEvent[]>(CALENDAR_MONTHS.map((m) => [m, []]));
    for (const e of sorted) {
      if (!matches(e, filter)) continue;
      byMonth.get(e.date.slice(0, 7))?.push(e);
    }
    const all = filter === "all";
    return CALENDAR_MONTHS.filter((m) => all || byMonth.get(m)!.length > 0).map((m) => ({
      key: m,
      events: byMonth.get(m)!,
    }));
  }, [sorted, filter]);

  return (
    <>
      {nextUp && (
        <div className="cal-next">
          <div>
            <div className="eyebrow">Next up · {countdown(nextUp, today)}</div>
            <h3>{nextUp.title}</h3>
            <p>
              {longDateLabel(nextUp)}
              {nextUp.detail ? ` · ${nextUp.detail}` : ""}
            </p>
          </div>
          {nextUp.link && (
            <a
              className="btn btn-primary"
              href={nextUp.link.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {nextUp.link.label} →
            </a>
          )}
        </div>
      )}

      <div className="cal-filters" role="group" aria-label="Filter the calendar by type of event">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`cal-chip${f.cat ? ` cal-cat--${f.cat}` : ""}`}
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            <span aria-hidden="true">{f.icon}</span> {f.label}
          </button>
        ))}
      </div>

      {months.length > 1 && (
        <nav className="cal-monthnav" aria-label="Jump to a month">
          {months.map((m) => {
            const cats = new Set(m.events.map((e) => e.category));
            return (
              <a key={m.key} href={`#month-${m.key}`}>
                {monthShort(m.key)}
                <span className="cal-dots" aria-hidden="true">
                  {(["camping", "pack-night", "one-day", "fundraiser"] as const).map(
                    (c) => cats.has(c) && <i key={c} className={`cal-cat--${c}`} />,
                  )}
                </span>
              </a>
            );
          })}
        </nav>
      )}

      {months.length === 0 && <p className="cal-empty">Nothing scheduled in this category.</p>}

      {months.map((m) => (
        <div className="cal-month" id={`month-${m.key}`} key={m.key}>
          <h2 className="cal-month-title">
            {monthTitle(m.key)}
            <span>
              {m.events.length} {m.events.length === 1 ? "event" : "events"}
            </span>
          </h2>
          {m.events.length === 0 ? (
            <p className="cal-empty">No special pack events scheduled this month.</p>
          ) : (
            <ol className="cal-events">
              {m.events.map((e, i) => {
                const badge = badgeParts(e);
                const pill = CATEGORY_PILL[e.category];
                const past = lastDay(e) < today;
                const cls = [
                  "cal-ev",
                  `cal-cat--${e.category}`,
                  past && "cal-ev--past",
                  e.volunteer && "cal-ev--volunteer",
                  e.noMeeting && "cal-ev--nomeet",
                  e.important && "cal-ev--important",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <li className={cls} key={`${e.date}-${e.title}-${i}`}>
                    <div className="cal-date" aria-hidden="true">
                      <span className="cal-date-dow">{badge.top}</span>
                      <span className={`cal-date-day${e.endDate ? " cal-date-day--range" : ""}`}>{badge.bottom}</span>
                    </div>
                    <div className="cal-ev-body">
                      <span className="cal-sr">{longDateLabel(e)}: </span>
                      <h3 className="cal-ev-title">{e.title}</h3>
                      {e.detail && <p className="cal-ev-detail">{e.detail}</p>}
                    </div>
                    <div className="cal-ev-side">
                      {pill && (
                        <span className="cal-pill">
                          <span aria-hidden="true">{pill.icon}</span> {pill.label}
                        </span>
                      )}
                      {e.volunteer && <span className="cal-tag">{VOLUNTEER_TAG[e.volunteer]}</span>}
                      {e.noMeeting && <span className="cal-tag">No Meeting</span>}
                      {e.tbd && <span className="cal-tag">TBD</span>}
                      {e.link && (
                        <a className="cal-link" href={e.link.href} target="_blank" rel="noopener noreferrer">
                          {e.link.label} →
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      ))}
    </>
  );
}
