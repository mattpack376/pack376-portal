import { createHash } from "node:crypto";
import { dollarsToCents, hasControlCharacters, MAX_CENTS } from "@/lib/formValues";
import { isDateOnlyString, toDateOnlyString } from "@/lib/dateOnly";
import { ledgerCategoryNameKey, type LedgerDirection } from "@/lib/ledgerMath";

/*
 * Reads the treasurer's Google Sheet tab for the Ledger's one-time import —
 * from the Sheets API (numbers and serial-number dates) or from a CSV the
 * Sheet was saved as (display text like "$1,234.56" and "9/15/26"). No
 * database or network here, so it's unit tested with invented rows; the
 * actions in src/lib/actions/ledgerImport.ts read the source and save.
 *
 * The tab looks like: a title and summary boxes at the top (labels with
 * their amounts in the row below), then a header row — Date | Description |
 * Category | Inflow | Outflow | Running Balance, found by name wherever it is
 * — and one line per row under it.
 *
 * Nothing is guessed or fixed up: a row that can't be read exactly is an
 * error naming its Sheet row, and the import waits until it's fixed in the
 * Sheet. Things that don't stop the import (a blank or different running
 * balance, a summary box that doesn't match) are warnings.
 */

export type LedgerImportCell = string | number | boolean | null | undefined;

export type ImportedLedgerRow = {
  /** The row number in the Sheet (1 = the top row). */
  sheetRow: number;
  /** YYYY-MM-DD. */
  date: string;
  description: string;
  category: string;
  /** ledgerCategoryNameKey(category): Sheet categories that differ only in case or spacing are one. */
  categoryKey: string;
  direction: LedgerDirection;
  cents: number;
};

export type LedgerImportIssue = { sheetRow: number | null; message: string };

export type LedgerImportCategory = {
  /** As first written in the Sheet. */
  name: string;
  key: string;
  count: number;
  inCents: number;
  outCents: number;
  netCents: number;
};

/** A labeled amount from the boxes above the header (e.g. "Total Bank Balance" over $1,234.56). */
export type LedgerSummaryBox = { label: string; key: string; cents: number; sheetRow: number };

/** A summary box checked against the imported rows; computedCents is null when nothing to compare it with. */
export type LedgerSummaryCheck = { label: string; sheetCents: number; computedCents: number | null; matches: boolean | null };

/** Two lines that look like money moved between categories: same date and amount, one out, one in. */
export type LedgerTransferPair = {
  /** "<out row>-<in row>": what the confirm form sends back. */
  id: string;
  date: string;
  cents: number;
  outRow: number;
  inRow: number;
  fromCategory: string;
  toCategory: string;
};

export type LedgerImportTotals = {
  rowCount: number;
  inflowCents: number;
  outflowCents: number;
  /** In minus out over every row: the bank balance the import leaves. */
  endingBalanceCents: number;
  firstDate: string | null;
  lastDate: string | null;
};

export type LedgerImportParse = {
  headerRow: number | null;
  rows: ImportedLedgerRow[];
  errors: LedgerImportIssue[];
  warnings: LedgerImportIssue[];
  totals: LedgerImportTotals;
  categories: LedgerImportCategory[];
  summaryBoxes: LedgerSummaryBox[];
  summaryChecks: LedgerSummaryCheck[];
  transferPairs: LedgerTransferPair[];
  /** sha256 of the rows as read; the confirm re-reads the source and must get the same. */
  fingerprint: string;
};

/** No ledger line before this: anything earlier is a mistyped year. */
export const EARLIEST_IMPORT_DATE = "2020-01-01";
/** The Sheets read covers A1:J1000; a CSV gets the same limit. */
export const MAX_IMPORT_GRID_ROWS = 1000;
const MAX_DESCRIPTION_LENGTH = 200;
const MAX_CATEGORY_NAME_LENGTH = 60;
/** Google Sheets' day 0. */
const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
const BANK_BALANCE_KEY = "total bank balance";

// ---------- Cells ----------

function isBlank(cell: LedgerImportCell): boolean {
  return cell === null || cell === undefined || (typeof cell === "string" && cell.trim() === "");
}

function cellText(cell: LedgerImportCell): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE";
  return String(cell).trim();
}

/** One line of text: runs of spaces and line breaks become one space. */
function oneLine(cell: LedgerImportCell): string {
  return cellText(cell).replace(/\s+/g, " ");
}

/** "9/15/2026" for messages. */
function usDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${month}/${day}/${year}`;
}

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Sorted row numbers as "12, 15–18, 30". */
function rowList(rows: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1] === rows[j] + 1) j++;
    parts.push(j === i ? String(rows[i]) : `${rows[i]}–${rows[j]}`);
    i = j;
  }
  return parts.join(", ");
}

// ---------- Dates ----------

type DateRead = { iso: string } | { error: "unreadable" | "unreal"; shown: string };

function readDate(cell: LedgerImportCell): DateRead {
  if (typeof cell === "number") {
    if (!Number.isFinite(cell) || cell < 1) return { error: "unreadable", shown: String(cell) };
    // A whole number is a date; a fraction is the time of day, which a line doesn't have.
    return { iso: new Date(SERIAL_EPOCH_MS + Math.floor(cell) * DAY_MS).toISOString().slice(0, 10) };
  }
  const text = cellText(cell);
  let iso: string | null = null;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (us) {
    const year = us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
    iso = `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    iso = text;
  }
  if (!iso) return { error: "unreadable", shown: text };
  if (!isDateOnlyString(iso)) return { error: "unreal", shown: text };
  return { iso };
}

/** The same month and day in a likely year, for "Probably 11/1/2026?". */
function likelyDate(iso: string, years: number[], today: string): string | null {
  const monthDay = iso.slice(4);
  for (const year of years) {
    const candidate = `${year}${monthDay}`;
    if (isDateOnlyString(candidate) && candidate >= EARLIEST_IMPORT_DATE && candidate <= today) return candidate;
  }
  return null;
}

// ---------- Amounts ----------

type AmountRead = { cents: number } | { error: string } | null;

/** An Inflow/Outflow cell: blank is null; otherwise whole cents above $0, or why not. */
function readAmount(cell: LedgerImportCell, column: string): AmountRead {
  if (isBlank(cell)) return null;
  let cents: number | null;
  if (typeof cell === "number") {
    if (!Number.isFinite(cell)) return { error: `the ${column} amount isn't a number` };
    if (cell < 0) return { error: `the ${column} amount is negative — put money out in the Outflow column instead` };
    const raw = cell * 100;
    cents = Math.round(raw);
    // Sheets hands back doubles like 3405.9; anything finer than a cent was typed that way.
    if (Math.abs(raw - cents) > 1e-6) return { error: `the ${column} amount has more than two decimal places` };
    if (cents > MAX_CENTS) cents = null;
  } else {
    const text = cellText(cell).replace(/[$,\s]/g, "");
    if (/^[-(]/.test(text)) return { error: `the ${column} amount is negative — put money out in the Outflow column instead` };
    if (/^\d*\.\d{3,}$/.test(text)) return { error: `the ${column} amount has more than two decimal places` };
    if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(text)) return { error: `the ${column} amount “${cellText(cell)}” isn't an amount` };
    cents = dollarsToCents(text);
  }
  if (cents === null) return { error: `the ${column} amount is over $1,000,000` };
  if (cents === 0) return { error: `the ${column} amount is $0 — leave it blank instead` };
  return { cents };
}

/** A balance or summary amount: may be negative, may carry float noise; null when it isn't an amount. */
function readSignedAmount(cell: LedgerImportCell): number | null {
  if (typeof cell === "number") return Number.isFinite(cell) ? Math.round(cell * 100) : null;
  let text = cellText(cell).replace(/[$,\s]/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  } else if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  }
  if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  if (whole.length > 9) return null;
  const cents = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0"));
  return negative ? -cents : cents;
}

// ---------- The header ----------

type Columns = { date: number; description: number; category: number; inflow: number; outflow: number; balance: number | null };

function findHeader(grid: readonly (readonly LedgerImportCell[])[]): { row: number; columns: Columns } | null {
  for (let r = 0; r < grid.length; r++) {
    const names = (grid[r] ?? []).map((cell) => cellText(cell).toLowerCase());
    const find = (test: (name: string) => boolean) => names.findIndex(test);
    const date = find((n) => n === "date");
    const description = find((n) => n === "description");
    const category = find((n) => n === "category");
    const inflow = find((n) => n.startsWith("inflow"));
    const outflow = find((n) => n.startsWith("outflow"));
    if ([date, description, category, inflow, outflow].every((i) => i >= 0)) {
      const balance = find((n) => n.startsWith("running balance") || n === "balance");
      return { row: r, columns: { date, description, category, inflow, outflow, balance: balance >= 0 ? balance : null } };
    }
  }
  return null;
}

/** Labels above the header with an amount right under them (or, failing that, just to the right). */
function readSummaryBoxes(grid: readonly (readonly LedgerImportCell[])[], headerRow: number): LedgerSummaryBox[] {
  const boxes: LedgerSummaryBox[] = [];
  const seen = new Set<string>();
  for (let r = 0; r < headerRow; r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (typeof cell !== "string" || isBlank(cell) || readSignedAmount(cell) !== null) continue;
      const label = oneLine(cell).replace(/:$/, "").trim();
      if (!label) continue;
      const below = r + 1 < headerRow ? (grid[r + 1] ?? [])[c] : undefined;
      let cents = isBlank(below) ? null : readSignedAmount(below);
      if (cents === null && !isBlank(row[c + 1])) cents = readSignedAmount(row[c + 1]);
      if (cents === null) continue;
      const key = ledgerCategoryNameKey(label);
      if (seen.has(key)) continue;
      seen.add(key);
      boxes.push({ label, key, cents, sheetRow: r + 1 });
    }
  }
  return boxes;
}

// ---------- The whole tab ----------

export function ledgerImportFingerprint(rows: readonly ImportedLedgerRow[]): string {
  const normalized = rows.map((r) => [r.sheetRow, r.date, r.description, r.category, r.direction, r.cents]);
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

/**
 * Reads the tab. `today` is the pack's today as a UTC-midnight Date
 * (todayDateOnly()); a line dated after it is an error.
 */
export function parseLedgerGrid(grid: readonly (readonly LedgerImportCell[])[], { today }: { today: Date }): LedgerImportParse {
  const todayIso = toDateOnlyString(today);
  const errors: LedgerImportIssue[] = [];
  const warnings: LedgerImportIssue[] = [];
  const rows: ImportedLedgerRow[] = [];

  const header = findHeader(grid);
  if (!header) {
    errors.push({
      sheetRow: null,
      message:
        "Couldn't find the header row — a row with Date, Description, Category, Inflow and Outflow. Check that this is the ledger tab.",
    });
  }
  // The Sheets read stops at row 1000 (a CSV gets the same limit), so a line
  // there or past it means the import could be cut short. Only the five
  // ledger columns count: a checkbox column or a balance formula filled down
  // a default 1000-row tab isn't a line.
  if (header) {
    const { columns } = header;
    const fields = [columns.date, columns.description, columns.category, columns.inflow, columns.outflow];
    for (let r = Math.max(MAX_IMPORT_GRID_ROWS - 1, header.row + 1); r < grid.length; r++) {
      const cells = grid[r] ?? [];
      if (fields.every((i) => isBlank(cells[i]))) continue;
      errors.push({
        sheetRow: r + 1,
        message: `Row ${r + 1} has a line; only the first ${MAX_IMPORT_GRID_ROWS.toLocaleString("en-US")} rows can be read, so the import would be cut short.`,
      });
      break;
    }
  }

  const blankBalanceRows: number[] = [];
  if (header) {
    const { columns } = header;
    let balanceCents = 0;
    // Sheet balance minus computed balance on the last row that had one: a warning only when it changes.
    let offset = 0;
    let latest: { iso: string; sheetRow: number } | null = null;

    for (let r = header.row + 1; r < Math.min(grid.length, MAX_IMPORT_GRID_ROWS); r++) {
      // Rows come back ragged (the API drops trailing blank cells); a missing cell is blank.
      const cells = grid[r] ?? [];
      const at = (i: number): LedgerImportCell => cells[i];
      const sheetRow = r + 1;
      const fields = [columns.date, columns.description, columns.category, columns.inflow, columns.outflow];
      if (fields.every((i) => isBlank(at(i)))) continue;

      const rowErrors: string[] = [];

      // Date
      let iso: string | null = null;
      if (isBlank(at(columns.date))) {
        rowErrors.push("the date is missing");
      } else {
        const read = readDate(at(columns.date));
        if ("error" in read) {
          rowErrors.push(
            read.error === "unreal"
              ? `“${read.shown}” isn't a real date`
              : `“${read.shown}” isn't a date the import can read (use a date like 9/15/26)`,
          );
        } else if (read.iso < EARLIEST_IMPORT_DATE) {
          rowErrors.push(`${usDate(read.iso)} is before 2020 — check the year`);
        } else if (read.iso > todayIso) {
          const todayYear = Number(todayIso.slice(0, 4));
          const years = [...new Set([...(latest ? [Number(latest.iso.slice(0, 4))] : []), todayYear, todayYear - 1])];
          const guess = likelyDate(read.iso, years, todayIso);
          rowErrors.push(`${usDate(read.iso)} is in the future.${guess ? ` Probably ${usDate(guess)}?` : ""} Fix it in the Sheet, then preview again`);
        } else {
          iso = read.iso;
        }
      }

      // Description and category
      const description = oneLine(at(columns.description));
      if (!description) rowErrors.push("the description is missing");
      else if (description.length > MAX_DESCRIPTION_LENGTH) rowErrors.push(`the description is over ${MAX_DESCRIPTION_LENGTH} characters`);
      else if (hasControlCharacters(description)) rowErrors.push("the description has a character that can't be saved");

      const category = oneLine(at(columns.category));
      if (!category) rowErrors.push("the category is missing");
      else if (category.length > MAX_CATEGORY_NAME_LENGTH) rowErrors.push(`the category name is over ${MAX_CATEGORY_NAME_LENGTH} characters`);
      else if (hasControlCharacters(category)) rowErrors.push("the category has a character that can't be saved");

      // Amount: exactly one of Inflow and Outflow
      const inflow = readAmount(at(columns.inflow), "Inflow");
      const outflow = readAmount(at(columns.outflow), "Outflow");
      let direction: LedgerDirection | null = null;
      let cents = 0;
      if (inflow && "error" in inflow) rowErrors.push(inflow.error);
      if (outflow && "error" in outflow) rowErrors.push(outflow.error);
      if (!inflow && !outflow) rowErrors.push("neither Inflow nor Outflow has an amount");
      else if (inflow && outflow) rowErrors.push("both Inflow and Outflow have an amount — a line is one or the other");
      else if (inflow && "cents" in inflow) {
        direction = "IN";
        cents = inflow.cents;
      } else if (outflow && "cents" in outflow) {
        direction = "OUT";
        cents = outflow.cents;
      }

      if (rowErrors.length > 0 || !iso || !direction) {
        const [first = "this row can't be read", ...rest] = rowErrors;
        const text = [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join("; ");
        errors.push({ sheetRow, message: `Row ${sheetRow}: ${text}.` });
        continue;
      }

      if (latest && iso < latest.iso) {
        warnings.push({
          sheetRow,
          message: `Row ${sheetRow}: ${usDate(iso)} comes after a later date (${usDate(latest.iso)} on row ${latest.sheetRow}). The portal lists lines by date, so its running balances will follow date order.`,
        });
      }
      if (!latest || iso >= latest.iso) latest = { iso, sheetRow };

      rows.push({ sheetRow, date: iso, description, category, categoryKey: ledgerCategoryNameKey(category), direction, cents });
      balanceCents += direction === "IN" ? cents : -cents;

      // The Sheet's running balance, compared in whole cents (formulas come back as 1524.9499999999998).
      if (columns.balance !== null) {
        const cell = at(columns.balance);
        if (isBlank(cell)) {
          blankBalanceRows.push(sheetRow);
        } else {
          const sheetBalance = readSignedAmount(cell);
          if (sheetBalance === null) {
            warnings.push({ sheetRow, message: `Row ${sheetRow}: the Running Balance “${cellText(cell)}” isn't an amount.` });
          } else if (sheetBalance - balanceCents !== offset) {
            offset = sheetBalance - balanceCents;
            warnings.push({
              sheetRow,
              message:
                offset === 0
                  ? `Row ${sheetRow}: the Sheet's running balance (${money(sheetBalance)}) agrees with the rows again from here.`
                  : `Row ${sheetRow}: the Sheet's running balance is ${money(sheetBalance)}, but the rows add up to ${money(balanceCents)} (a difference of ${money(offset)}).`,
            });
          }
        }
      }
    }
  }

  if (blankBalanceRows.length > 0) {
    const many = blankBalanceRows.length > 1;
    warnings.push({
      sheetRow: blankBalanceRows[0],
      message: `${many ? "Rows" : "Row"} ${rowList(blankBalanceRows)}: the Running Balance ${many ? "cells are" : "cell is"} blank. The portal works out its own balances, so this is only a heads-up.`,
    });
  }

  // Totals and categories
  const inflowCents = rows.reduce((sum, r) => sum + (r.direction === "IN" ? r.cents : 0), 0);
  const outflowCents = rows.reduce((sum, r) => sum + (r.direction === "OUT" ? r.cents : 0), 0);
  const dates = rows.map((r) => r.date).sort();
  const totals: LedgerImportTotals = {
    rowCount: rows.length,
    inflowCents,
    outflowCents,
    endingBalanceCents: inflowCents - outflowCents,
    firstDate: dates[0] ?? null,
    lastDate: dates.at(-1) ?? null,
  };

  const byKey = new Map<string, LedgerImportCategory>();
  for (const row of rows) {
    const category = byKey.get(row.categoryKey) ?? { name: row.category, key: row.categoryKey, count: 0, inCents: 0, outCents: 0, netCents: 0 };
    category.count += 1;
    if (row.direction === "IN") category.inCents += row.cents;
    else category.outCents += row.cents;
    category.netCents = category.inCents - category.outCents;
    byKey.set(row.categoryKey, category);
  }
  const categories = [...byKey.values()];

  // The Sheet's own summary boxes against what the rows add up to.
  const summaryBoxes = header ? readSummaryBoxes(grid, header.row) : [];
  const summaryChecks: LedgerSummaryCheck[] = summaryBoxes.map((box) => {
    const computed = box.key === BANK_BALANCE_KEY ? totals.endingBalanceCents : (byKey.get(box.key)?.netCents ?? null);
    return { label: box.label, sheetCents: box.cents, computedCents: computed, matches: computed === null ? null : computed === box.cents };
  });
  for (const check of summaryChecks) {
    if (check.matches === false && check.computedCents !== null) {
      warnings.push({
        sheetRow: null,
        message: `The Sheet's “${check.label}” box shows ${money(check.sheetCents)}, but the rows add up to ${money(check.computedCents)}.`,
      });
    }
  }

  return {
    headerRow: header ? header.row + 1 : null,
    rows,
    errors,
    warnings,
    totals,
    categories,
    summaryBoxes,
    summaryChecks,
    transferPairs: findTransferPairs(rows),
    fingerprint: ledgerImportFingerprint(rows),
  };
}

/**
 * Likely moves between categories (an event's close-out into Fundraising,
 * say): an Outflow and an Inflow on the same date, for the same amount, in
 * different categories. Each line pairs at most once, with the nearest
 * match. Only suggestions — the treasurer ticks the ones that are.
 */
export function findTransferPairs(rows: readonly ImportedLedgerRow[]): LedgerTransferPair[] {
  const used = new Set<number>();
  const pairs: LedgerTransferPair[] = [];
  for (const out of rows) {
    if (out.direction !== "OUT" || used.has(out.sheetRow)) continue;
    let best: ImportedLedgerRow | null = null;
    for (const candidate of rows) {
      if (
        candidate.direction !== "IN" ||
        used.has(candidate.sheetRow) ||
        candidate.date !== out.date ||
        candidate.cents !== out.cents ||
        candidate.categoryKey === out.categoryKey
      ) {
        continue;
      }
      if (!best || Math.abs(candidate.sheetRow - out.sheetRow) < Math.abs(best.sheetRow - out.sheetRow)) best = candidate;
    }
    if (!best) continue;
    used.add(out.sheetRow);
    used.add(best.sheetRow);
    pairs.push({
      id: `${out.sheetRow}-${best.sheetRow}`,
      date: out.date,
      cents: out.cents,
      outRow: out.sheetRow,
      inRow: best.sheetRow,
      fromCategory: out.category,
      toCategory: best.category,
    });
  }
  return pairs;
}

/** A scouting-year tab name like "2026-2027". */
const YEAR_TAB = /^\s*(\d{4})\s*-\s*(\d{4})\s*$/;

/** The tab the import offers first: the newest scouting-year tab, or null when there's none. */
export function defaultImportTab(titles: readonly string[]): string | null {
  let best: { title: string; year: number } | null = null;
  for (const title of titles) {
    const match = YEAR_TAB.exec(title);
    if (!match) continue;
    const year = Number(match[1]);
    if (!best || year > best.year) best = { title, year };
  }
  return best?.title ?? null;
}

/**
 * A Sheet category's likely kind: Event when its name has a "(" (as in
 * "Camp Conron (October 2026)") or contains a portal event or trip title,
 * otherwise Fund. Only the starting choice — the treasurer can change it.
 */
export function guessLedgerCategoryKind(name: string, eventTitles: readonly string[]): "FUND" | "EVENT" {
  if (name.includes("(")) return "EVENT";
  const key = ledgerCategoryNameKey(name);
  for (const title of eventTitles) {
    const titleKey = ledgerCategoryNameKey(title);
    if (titleKey.length >= 4 && key.includes(titleKey)) return "EVENT";
  }
  return "FUND";
}

/** The day after the last imported line, as YYYY-MM-DD: where the portal takes over by default. */
export function defaultCutoverDate(lastDate: string | null): string | null {
  if (!lastDate) return null;
  return new Date(Date.parse(`${lastDate}T00:00:00.000Z`) + DAY_MS).toISOString().slice(0, 10);
}
