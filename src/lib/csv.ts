import "server-only";

/**
 * Escapes a single CSV field: neutralizes spreadsheet formula injection (a
 * cell beginning with =, +, -, @, tab, or CR can execute as a formula when
 * opened in Excel or Google Sheets — prefix with an apostrophe so it's
 * treated as literal text), then wraps in quotes (doubling any internal
 * quotes) whenever it contains a comma, quote, or newline. Shared by every
 * CSV builder in this app (parentsCsv.ts, attendanceCsv.ts) so this guard
 * can't drift/get missed in a new one again.
 */
export function escapeCsvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map((cell) => escapeCsvField(String(cell))).join(",")).join("\r\n");
}

export function centsToDollarsString(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
