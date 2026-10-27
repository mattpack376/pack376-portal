import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { csvResponse, escapeCsvField, safeDownloadFilename, toCsv } from "@/lib/csv";
import { parentsPdfResponse } from "@/lib/parentsPdf";

describe("csvResponse", () => {
  it("is private and never stored, saved as a CSV file", async () => {
    const response = csvResponse(toCsv([["Name", "Owes"], ["Pat", "10.00"]]), "pack376-all-attendees.csv");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(response.headers.get("Content-Type"), "text/csv; charset=utf-8");
    assert.equal(response.headers.get("Content-Disposition"), 'attachment; filename="pack376-all-attendees.csv"');
    assert.equal(await response.text(), "Name,Owes\r\nPat,10.00");
  });

  it("keeps the quoted filename well-formed whatever it is given", () => {
    const response = csvResponse("x", 'evil"; filename*=UTF-8\'\'x.html\r\nSet-Cookie: a=b.csv');
    const disposition = response.headers.get("Content-Disposition") ?? "";
    assert.match(disposition, /^attachment; filename="[A-Za-z0-9._-]+"$/);
    assert.equal(safeDownloadFilename("Camp Conron — 2026.csv"), "Camp-Conron-2026.csv");
    assert.equal(safeDownloadFilename("../../etc/passwd"), "etc-passwd");
    assert.equal(safeDownloadFilename(""), "pack376-download");
  });

  it("still neutralizes spreadsheet formulas", async () => {
    const response = csvResponse(toCsv([["=HYPERLINK(\"http://x\")", "+1", "-12.50", "@SUM(A1)"]]), "x.csv");
    assert.equal(await response.text(), `"'=HYPERLINK(""http://x"")",'+1,-12.50,'@SUM(A1)`);
    assert.equal(escapeCsvField("\tcmd"), "'\tcmd");
  });
});

describe("parentsPdfResponse", () => {
  it("is private and never stored too (parent, leader, consent and expense PDFs)", () => {
    const response = parentsPdfResponse(new Uint8Array([0x25, 0x50, 0x44, 0x46]), "pack376-parent-contacts-all.pdf");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(response.headers.get("Content-Type"), "application/pdf");
  });
});
