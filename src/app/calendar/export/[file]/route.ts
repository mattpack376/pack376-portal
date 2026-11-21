import { getCalendarExport } from "@/lib/calendarEventsData";
import { EXPORT_FILE_PATTERN, parseExportFileName } from "@/lib/calendarExport";
import { buildCalendarPdf } from "@/lib/calendarExportPdf";
import { buildCalendarPng } from "@/lib/calendarExportPng";
import { todayDateOnlyString } from "@/lib/dateOnly";

/*
 * The shareable Calendar of Events: /calendar/export/pack376-calendar-2026-11.pdf,
 * …-2026-11.png, and the whole year as …-2026-2027.pdf / .png. Linked from the
 * Download or Share card on /calendar and from the admin calendar page.
 *
 * Public, like the page itself, and built from exactly what the page shows
 * (getCalendarExport: visible events and the Friday meetings, nothing from
 * the portal). Only this year's file names are answered — a month that has a
 * section on the page, or the full year — so the set of addresses, and of
 * cached files, is small and fixed; anything else is a 404. The request
 * itself (query string, headers) is never read, so no visitor input reaches
 * the file.
 *
 * Cached like the page: built on first request, kept for five minutes, and
 * thrown away at once when an admin edits the calendar — the calendar and
 * attendance actions revalidate everything under /calendar.
 */
export const revalidate = 300;
export const dynamicParams = true;

/** None are built ahead of time; each file is built the first time someone asks for it. */
export function generateStaticParams(): { file: string }[] {
  return [];
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  // A name that can't be an export is turned away before the database is asked anything.
  if (!EXPORT_FILE_PATTERN.test(file)) return notFound();
  const calendar = await getCalendarExport(todayDateOnlyString());
  const wanted = parseExportFileName(file, calendar.months, calendar.yearLabel);
  if (!wanted) return notFound();

  let bytes: Uint8Array;
  try {
    bytes =
      wanted.format === "pdf"
        ? await buildCalendarPdf(calendar, wanted.scope)
        : await buildCalendarPng(calendar, wanted.scope);
  } catch (error) {
    console.error(`[calendar export] couldn't build ${file}`, error);
    return new Response("The calendar file couldn't be made. Please try again in a minute.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": wanted.format === "pdf" ? "application/pdf" : "image/png",
      // inline: tapping the link shows the file (and a phone's own Share
      // button); the card's Download link adds the download attribute.
      "Content-Disposition": `inline; filename="${file}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function notFound() {
  return new Response("Not found.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
