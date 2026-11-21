/*
 * Who may download or share the calendar PDF/PNG (canExportCalendar, used by
 * the portal Calendar page's card and /api/calendar/export): Admin, Junior
 * Admin and Den Leaders only. It isn't offered to the public.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canExportCalendar } from "@/lib/authorize";

describe("calendar export access", () => {
  it("lets Admin, Junior Admin and Den Leaders download", () => {
    for (const role of ["ADMIN", "JUNIOR_ADMIN", "DEN"] as const) assert.equal(canExportCalendar({ role }), true, role);
  });

  it("turns away every other role", () => {
    for (const role of ["COMMITTEE", "ATTENDANCE_ADMIN", "PHOTOGRAPHER", "PARENT", "TRIP_VIEWER"] as const) {
      assert.equal(canExportCalendar({ role }), false, role);
    }
  });
});
