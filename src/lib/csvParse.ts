/*
 * Reads CSV text (RFC 4180) into rows of cells — for the Ledger import's
 * upload, a tab saved from Google Sheets with File → Download →
 * Comma-separated values. Handles quoted cells (with commas, line breaks and
 * doubled quotes inside), CRLF or LF line ends and a leading byte-order mark.
 * Every cell comes back as text, exactly as written.
 */

export type CsvParseResult = { ok: true; rows: string[][] } | { ok: false; error: string };

export function parseCsv(text: string): CsvParseResult {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  // Whether the current cell started with a quote (so `"a"b` can be refused).
  let wasQuoted = false;
  let line = 1;

  const endCell = () => {
    row.push(cell);
    cell = "";
    wasQuoted = false;
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (cell !== "" || wasQuoted) return { ok: false, error: `Line ${line} has a stray quote mark.` };
      quoted = true;
      wasQuoted = true;
    } else if (ch === ",") {
      endCell();
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      endRow();
      line++;
    } else {
      if (wasQuoted) return { ok: false, error: `Line ${line} has text after a closing quote mark.` };
      cell += ch;
    }
  }
  if (quoted) return { ok: false, error: "The file ends inside a quoted cell — it may be cut short." };
  // A last line without a line break still counts; a trailing line break doesn't add an empty row.
  if (cell !== "" || wasQuoted || row.length > 0) endRow();
  return { ok: true, rows };
}
