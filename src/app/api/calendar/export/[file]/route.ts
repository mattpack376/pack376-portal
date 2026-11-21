import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canExportCalendar } from "@/lib/authorize";
import { getCalendarExport } from "@/lib/calendarEventsData";
import { EXPORT_FILE_PATTERN, parseExportFileName } from "@/lib/calendarExport";
import { buildCalendarPdf } from "@/lib/calendarExportPdf";
import { buildCalendarPng } from "@/lib/calendarExportPng";
import { todayDateOnlyString } from "@/lib/dateOnly";

/*
 * The Calendar of Events as a file to print or share:
 * /api/calendar/export/pack376-calendar-2026-11.pdf, …-2026-11.png, and the
 * whole year as …-2026-2027.pdf / .png. Linked from the Download or Share card
 * on the portal Calendar page.
 *
 * Staff only — Admin, Junior Admin and Den Leaders (canExportCalendar); the
 * public site doesn't offer it. Under /api so the address is the same on the
 * portal host, where the session cookie lives. The file holds exactly what
 * the public /calendar page shows (getCalendarExport: visible events and the
 * Friday meetings), and only this year's file names are answered.
 *
 * Built on each request (a PDF in well under a second, a picture in a couple)
 * and never cached anywhere, like the portal's other downloads.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const session = await getSession();
  if (!session) return new NextResponse("Not authorized.", { status: 401, headers: NO_STORE });
  if (!canExportCalendar(session)) return new NextResponse("Not authorized.", { status: 403, headers: NO_STORE });

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
    return new NextResponse("The calendar file couldn't be made. Please try again in a minute.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8", ...NO_STORE },
    });
  }

  return new NextResponse(bytes as BodyInit, {
    headers: {
      "Content-Type": wanted.format === "pdf" ? "application/pdf" : "image/png",
      // inline: tapping the link shows the file (and a phone's own Share
      // button); the card's Download link adds the download attribute.
      "Content-Disposition": `inline; filename="${file}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const NO_STORE = { "Cache-Control": "private, no-store" };

function notFound() {
  return new NextResponse("Not found.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", ...NO_STORE } });
}
