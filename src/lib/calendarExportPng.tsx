import "server-only";
import fontkit from "@pdf-lib/fontkit";
import type { ReactNode } from "react";
import { ImageResponse } from "next/og";
import {
  CHIP_STYLE,
  EXPORT_COLORS as C,
  EXPORT_DISCLAIMER,
  EXPORT_SITE,
  LEGEND,
  WEEKDAYS,
  exportLongDate,
  fitText,
  layoutMonth,
  miniMonth,
  wrapNarrow,
  wrapText,
  yearOverview,
  type ChipKind,
  type DetailItem,
  type ExportCalendar,
  type ExportScope,
  type Measure,
  type MonthLayout,
} from "@/lib/calendarExport";
import { loadExportFonts, type ExportFontFiles, type ExportFontName } from "@/lib/calendarExportFonts";
import { RECEIPT_EMBLEM_PNG_BASE64 } from "@/lib/receiptEmblem";

/*
 * The calendar as a PNG, for a group chat or a phone's photos: 1080 pixels
 * wide, portrait. A month is its grid with every event listed under it; the
 * full calendar is ONE "Year at a Glance" poster — every month as a small
 * grid with each event day filled in its color, then the year's events.
 *
 * Drawn with next/og (Satori + Resvg, part of Next — flexbox only, no CSS
 * grid). Every height is computed here from measured text, never left to the
 * layout engine, so the image is exactly as tall as its content and nothing
 * is cut off at the bottom. The text is measured with the same font files
 * Satori draws with.
 */

const W = 1080;
const P = 40;
const IW = W - 2 * P;

const DISPLAY = "Baloo 2";
const BODY = "Poppins";

const EMBLEM = `data:image/png;base64,${RECEIPT_EMBLEM_PNG_BASE64}`;

type Measures = Record<ExportFontName, Measure>;

function measures(files: ExportFontFiles): Measures {
  return Object.fromEntries(
    (Object.keys(files) as ExportFontName[]).map((name) => {
      const font = fontkit.create(files[name]);
      // A hair wider than the real advance, so a line measured to fit always does.
      return [name, (text: string, size: number) => (font.layout(text).advanceWidth / font.unitsPerEm) * size * 1.02];
    }),
  ) as Measures;
}

function fontsFor(files: ExportFontFiles) {
  const ab = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return [
    { name: DISPLAY, data: ab(files.display), weight: 800 as const, style: "normal" as const },
    { name: DISPLAY, data: ab(files.displayBold), weight: 700 as const, style: "normal" as const },
    { name: BODY, data: ab(files.body), weight: 400 as const, style: "normal" as const },
    { name: BODY, data: ab(files.bodySemi), weight: 600 as const, style: "normal" as const },
    { name: BODY, data: ab(files.bodyBold), weight: 700 as const, style: "normal" as const },
  ];
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const HEADER_H = 200 + 22 + 8;

function Header({ eyebrow, title, sub }: { eyebrow: string; title: string; sub: string }) {
  const stripes = Math.ceil(W / 40);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: W, height: HEADER_H }}>
      <div style={{ display: "flex", alignItems: "center", width: W, height: 200, background: C.blue, padding: `0 ${P}px` }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws plain <img>, not next/image */}
        <img src={EMBLEM} width={124} height={124} alt="" />
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 28 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 30, color: C.gold, letterSpacing: 2, lineHeight: 1.1 }}>{eyebrow}</div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 76, color: C.white, lineHeight: 1.05, marginTop: 6 }}>{title}</div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 30, color: "#cfe0f5", lineHeight: 1.1, marginTop: 4 }}>{sub}</div>
        </div>
      </div>
      <div style={{ display: "flex", width: W, height: 22 }}>
        {Array.from({ length: stripes }, (_, i) => (
          <div key={i} style={{ width: 40, height: 22, background: i % 2 ? C.white : C.red }} />
        ))}
      </div>
      <div style={{ width: W, height: 8, background: C.gold }} />
    </div>
  );
}

function Swatch({ kind, w, h }: { kind: ChipKind; w: number; h: number }) {
  const s = CHIP_STYLE[kind];
  return <div style={{ width: w, height: h, borderRadius: 5, background: s.bg, border: `2px solid ${s.border ?? s.bg}` }} />;
}

const LEGEND_COLS = 3;
const LEGEND_H = Math.ceil(LEGEND.length / LEGEND_COLS) * 50 + 24;

function Legend() {
  const rows: (typeof LEGEND)[number][][] = [];
  for (let i = 0; i < LEGEND.length; i += LEGEND_COLS) rows.push(LEGEND.slice(i, i + LEGEND_COLS));
  return (
    <div style={{ display: "flex", flexDirection: "column", width: IW, height: LEGEND_H, paddingTop: 24 }}>
      {rows.map((row, r) => (
        <div key={r} style={{ display: "flex", height: 50, alignItems: "center" }}>
          {row.map((item) => (
            <div key={item.kind} style={{ display: "flex", alignItems: "center", width: IW / LEGEND_COLS }}>
              <Swatch kind={item.kind} w={36} h={26} />
              <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 26, color: C.inkSoft, marginLeft: 10 }}>{item.label}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

const FOOTER_H = 136;

function Footer({ cal }: { cal: ExportCalendar }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        width: W,
        height: FOOTER_H,
        marginTop: 24,
        padding: `0 ${P}px`,
        background: C.blueDark,
      }}
    >
      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 32, color: C.gold, lineHeight: 1.2 }}>
        {`${EXPORT_SITE} · Updated ${exportLongDate(cal.generatedOn)}`}
      </div>
      <div style={{ fontFamily: BODY, fontWeight: 400, fontSize: 26, color: "#cfe0f5", marginTop: 4 }}>{EXPORT_DISCLAIMER}</div>
    </div>
  );
}

function Page({ height, children }: { height: number; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: W, height, background: C.cream, fontFamily: BODY, color: C.ink }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A month
// ---------------------------------------------------------------------------

const DOW_H = 58;
const CHIP_TOP = 50;
// 23 px: big enough to read when the picture is shown phone-wide (the first
// version's 18 px wasn't). A chip takes up to three lines, so most titles read
// in full in a cell a seventh of the image wide; the slots are spaced for three.
const CHIP_FONT = 23;
const CHIP_LINE = 27;
const CHIP_LINES = 3;
const CHIP_MIN_FONT = 19;
const chipHeight = (lines: number) => Math.max(2, lines) * CHIP_LINE + 8;

/**
 * A chip's text size: 23 px, or down to 19 px when that lets a long opening
 * word ("Anniversary", "Christmas") sit on a line whole instead of being
 * split. Only the first two words count: later ones are the ones a long
 * title loses to the "…" anyway.
 */
function chipFont(text: string, m: Measures, width: number) {
  const longest = text.split(/\s+|(?<=-)/).filter(Boolean).slice(0, 2);
  for (let size = CHIP_FONT; size > CHIP_MIN_FONT; size--) {
    if (longest.every((word) => m.bodySemi(word, size) <= width)) return size;
  }
  return CHIP_MIN_FONT;
}
const CHIP_PITCH = chipHeight(CHIP_LINES) + 5;

function rowHeight(weeks: number) {
  return weeks >= 6 ? 240 : 254;
}

function maxSlots(weeks: number) {
  return Math.max(1, Math.floor((rowHeight(weeks) - CHIP_TOP - 2) / CHIP_PITCH));
}

function Grid({ layout, m }: { layout: MonthLayout; m: Measures }) {
  const rowH = rowHeight(layout.weeks.length);
  const slots = maxSlots(layout.weeks.length);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: IW, borderRadius: 14, border: `2px solid ${C.line}`, overflow: "hidden" }}>
      <div style={{ display: "flex", width: IW - 4, height: DOW_H, background: C.blue }}>
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: (IW - 4) / 7,
              fontFamily: DISPLAY,
              fontWeight: 800,
              fontSize: 28,
              color: C.white,
              letterSpacing: 1,
            }}
          >
            {d.toUpperCase()}
          </div>
        ))}
      </div>
      {layout.weeks.map((week, r) => (
        <div key={r} style={{ display: "flex", position: "relative", width: IW - 4, height: rowH }}>
          {week.days.map((day, c) => (
            <div
              key={day.date}
              style={{
                position: "absolute",
                left: c * ((IW - 4) / 7),
                top: 0,
                width: (IW - 4) / 7,
                height: rowH,
                background: !day.inMonth ? C.outside : day.noMeeting ? "#f1eee6" : C.white,
                borderTop: `1px solid ${C.line}`,
                borderLeft: c ? `1px solid ${C.line}` : "none",
                display: "flex",
                padding: "4px 0 0 10px",
                fontFamily: DISPLAY,
                fontWeight: 800,
                fontSize: 34,
                color: day.inMonth ? C.blueDark : "#c4b998",
              }}
            >
              {String(day.day)}
            </div>
          ))}
          {week.chips.map((chip, i) => {
            const s = CHIP_STYLE[chip.kind];
            const unit = (IW - 4) / 7;
            const left = chip.startCol * unit + (chip.continuesBefore ? 0 : 3);
            const right = (chip.endCol + 1) * unit - (chip.continuesAfter ? 0 : 3);
            const fontSize = chipFont(chip.text, m, right - left - 14);
            const lines = wrapNarrow(chip.text, m.bodySemi, fontSize, right - left - 14, CHIP_LINES);
            const border = chip.important
              ? `3px solid ${chip.kind === "pack-night" ? C.redDark : C.goldDark}`
              : chip.either
                ? `2px dashed ${s.fg}`
                : `2px solid ${s.border ?? s.bg}`;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left,
                  top: CHIP_TOP + chip.slot * CHIP_PITCH,
                  width: right - left,
                  height: chipHeight(lines.length),
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  padding: "0 5px",
                  background: s.bg,
                  border,
                  borderTopLeftRadius: chip.continuesBefore ? 0 : 7,
                  borderBottomLeftRadius: chip.continuesBefore ? 0 : 7,
                  borderTopRightRadius: chip.continuesAfter ? 0 : 7,
                  borderBottomRightRadius: chip.continuesAfter ? 0 : 7,
                  fontFamily: BODY,
                  fontWeight: 600,
                  fontSize,
                  lineHeight: `${CHIP_LINE}px`,
                  color: s.fg,
                  overflow: "hidden",
                }}
              >
                {lines.map((line, li) => (
                  <div key={li} style={{ height: CHIP_LINE, whiteSpace: "nowrap" }}>
                    {line}
                  </div>
                ))}
              </div>
            );
          })}
          {week.more.map((n, c) =>
            n ? (
              <div
                key={`more-${c}`}
                style={{
                  position: "absolute",
                  left: c * ((IW - 4) / 7) + 10,
                  top: CHIP_TOP + (slots - 1) * CHIP_PITCH + 14,
                  fontFamily: BODY,
                  fontWeight: 700,
                  fontSize: 24,
                  color: C.inkSoft,
                }}
              >
                {`+${n} more`}
              </div>
            ) : null,
          )}
        </div>
      ))}
    </div>
  );
}

interface LaidDetail {
  item: DetailItem;
  titleLines: string[];
  detailLines: string[];
  height: number;
}

const DETAIL_TEXT_W = IW - 24 - 48;

function layDetail(item: DetailItem, m: Measures): LaidDetail {
  const titleLines = wrapText(item.title, item.important ? m.bodyBold : m.bodySemi, 36, DETAIL_TEXT_W, 2);
  const detailLines = item.detail ? wrapText(item.detail, m.body, 30, DETAIL_TEXT_W, 3) : [];
  return { item, titleLines, detailLines, height: 20 + 42 + titleLines.length * 48 + detailLines.length * 41 + 18 };
}

function Detail({ d, m }: { d: LaidDetail; m: Measures }) {
  const s = CHIP_STYLE[d.item.kind];
  const tags = d.item.tags.length ? `· ${d.item.tags.join(" · ")}` : "";
  const whenW = m.display(d.item.when, 32);
  return (
    <div
      style={{
        display: "flex",
        width: IW,
        height: d.height - 14,
        marginBottom: 14,
        background: C.white,
        borderRadius: 14,
        border: d.item.important ? `3px solid ${C.gold}` : `2px solid ${C.line}`,
        overflow: "hidden",
      }}
    >
      <div style={{ width: 24, height: "100%", background: s.border ?? s.bg }} />
      <div style={{ display: "flex", flexDirection: "column", padding: "18px 24px 0 22px", width: IW - 24 }}>
        <div style={{ display: "flex", alignItems: "center", height: 42 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 32, color: C.blue }}>{d.item.when}</div>
          {tags ? (
            <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 26, color: C.redDark, whiteSpace: "nowrap", marginLeft: 10 }}>
              {fitText(tags, m.bodySemi, 26, DETAIL_TEXT_W - whenW - 10)}
            </div>
          ) : null}
        </div>
        {d.titleLines.map((line, i) => (
          <div
            key={`t${i}`}
            style={{
              fontFamily: BODY,
              fontWeight: d.item.important ? 700 : 600,
              fontSize: 36,
              lineHeight: "48px",
              height: 48,
              color: d.item.kind === "fundraiser" ? C.redDark : C.ink,
              whiteSpace: "nowrap",
            }}
          >
            {line}
          </div>
        ))}
        {d.detailLines.map((line, i) => (
          <div key={`d${i}`} style={{ fontFamily: BODY, fontWeight: 400, fontSize: 30, lineHeight: "41px", height: 41, color: C.inkSoft, whiteSpace: "nowrap" }}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div style={{ display: "flex", fontFamily: DISPLAY, fontWeight: 800, fontSize: 46, color: C.blue, height: 70, alignItems: "center" }}>
      {children}
    </div>
  );
}

function monthImage(cal: ExportCalendar, month: string, m: Measures) {
  const weeks = layoutMonth(cal, month, 99).weeks.length;
  const layout = layoutMonth(cal, month, maxSlots(weeks));
  const laid = layout.details.map((d) => layDetail(d, m));

  const meetingText = layout.meetings ? [layout.meetings.when, layout.meetings.detail].filter(Boolean).join(" · ") : "";
  const meetingLines = meetingText ? wrapText(meetingText, m.bodySemi, 30, IW - 56, 2) : [];
  const meetingH = layout.meetings ? 24 + 42 + meetingLines.length * 41 + 20 + 14 : 0;

  const gridH = 4 + DOW_H + weeks * rowHeight(weeks);
  const detailsH = laid.length ? laid.reduce((s, d) => s + d.height, 0) : 60;
  const height = HEADER_H + 32 + gridH + 20 + 70 + meetingH + detailsH + LEGEND_H + FOOTER_H + 24;

  const element = (
    <Page height={height}>
      <Header eyebrow="PACK 376 · CALENDAR OF EVENTS" title={layout.title} sub={`${cal.yearLabel} Scouting Year · ${EXPORT_SITE}`} />
      <div style={{ display: "flex", flexDirection: "column", padding: `32px ${P}px 0` }}>
        <Grid layout={layout} m={m} />
        <div style={{ height: 20 }} />
        <SectionTitle>This Month</SectionTitle>
        {layout.meetings ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: IW,
              height: meetingH - 14,
              marginBottom: 14,
              padding: "24px 28px 0",
              borderRadius: 14,
              background: CHIP_STYLE.meeting.bg,
            }}
          >
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 34, color: C.blueDark, height: 42 }}>{layout.meetings.title}</div>
            {meetingLines.map((line, i) => (
              <div key={i} style={{ fontFamily: BODY, fontWeight: 600, fontSize: 30, lineHeight: "41px", height: 41, color: C.blueDark }}>
                {line}
              </div>
            ))}
          </div>
        ) : null}
        {laid.length ? (
          laid.map((d, i) => <Detail key={i} d={d} m={m} />)
        ) : (
          <div style={{ display: "flex", height: 60, fontSize: 30, color: C.inkSoft }}>No special pack events scheduled this month.</div>
        )}
        <Legend />
      </div>
      <Footer cal={cal} />
    </Page>
  );
  return { element, height };
}

// ---------------------------------------------------------------------------
// The year poster
// ---------------------------------------------------------------------------

const MINI_GAP = 20;
const MINI_W = (IW - 2 * MINI_GAP) / 3;
const MINI_CELL = (MINI_W - 24) / 7;
const MINI_ROW = 46;
const MINI_H = 14 + 48 + 32 + 6 * MINI_ROW + 14;

function MiniMonth({ month, cal }: { month: string; cal: ExportCalendar }) {
  const mini = miniMonth(cal, month);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: MINI_W,
        height: MINI_H,
        padding: "14px 12px",
        background: C.white,
        borderRadius: 16,
        border: `2px solid ${C.line}`,
      }}
    >
      <div style={{ display: "flex", height: 48, fontFamily: DISPLAY, fontWeight: 800, fontSize: 36, color: C.blue, paddingLeft: 4 }}>
        {mini.title}
      </div>
      <div style={{ display: "flex", height: 32 }}>
        {WEEKDAYS.map((d) => (
          <div key={d} style={{ display: "flex", justifyContent: "center", width: MINI_CELL, fontFamily: BODY, fontWeight: 600, fontSize: 22, color: C.inkSoft }}>
            {d[0]}
          </div>
        ))}
      </div>
      {mini.weeks.map((week, r) => (
        <div key={r} style={{ display: "flex", height: MINI_ROW }}>
          {week.map((day, c) => {
            const kind: ChipKind | null = day.kind ?? (day.meeting ? "meeting" : null);
            const s = kind ? CHIP_STYLE[kind] : null;
            return (
              <div key={c} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: MINI_CELL, height: MINI_ROW }}>
                {day.day === null ? null : (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: MINI_CELL - 3,
                      height: MINI_ROW - 4,
                      borderRadius: 8,
                      background: s ? s.bg : "transparent",
                      border: day.important
                        ? `3px solid ${kind === "pack-night" ? C.redDark : C.goldDark}`
                        : s?.border
                          ? `2px solid ${s.border}`
                          : "2px solid transparent",
                      fontFamily: DISPLAY,
                      fontWeight: 700,
                      fontSize: 26,
                      color: s ? s.fg : C.ink,
                    }}
                  >
                    {String(day.day)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

interface LaidGroup {
  title: string;
  kind: ChipKind;
  rows: { lines: string[]; when: string; h: number }[];
  height: number;
}

const GLANCE_W = (IW - 20) / 2;

function layGlance(cal: ExportCalendar, m: Measures): LaidGroup[] {
  return yearOverview(cal).glance.map((g) => {
    const rows = g.items.map((item) => {
      const when = fitText(item.when, m.display, 28, GLANCE_W * 0.4);
      const lines = wrapText(item.label, m.bodySemi, 28, GLANCE_W - 44 - m.display(when, 28) - 14, 2);
      return { lines, when, h: lines.length * 37 + 12 };
    });
    return { title: g.title, kind: g.category, rows, height: 64 + 14 + rows.reduce((s, r) => s + r.h, 0) + 12 + 20 };
  });
}

function GlanceCard({ g }: { g: LaidGroup }) {
  const s = CHIP_STYLE[g.kind];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: GLANCE_W,
        height: g.height - 20,
        marginBottom: 20,
        background: C.white,
        borderRadius: 16,
        border: `2px solid ${s.border ?? s.bg}`,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", height: 64, padding: "0 20px", background: s.bg, fontFamily: DISPLAY, fontWeight: 800, fontSize: 36, color: s.fg }}>
        {g.title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", padding: "14px 20px 0" }}>
        {g.rows.map((row, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", height: row.h }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {row.lines.map((line, li) => (
                <div key={li} style={{ fontFamily: BODY, fontWeight: 600, fontSize: 28, lineHeight: "37px", height: 37, color: C.ink, whiteSpace: "nowrap" }}>
                  {line}
                </div>
              ))}
            </div>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 28, lineHeight: "37px", color: C.blueDark, whiteSpace: "nowrap" }}>{row.when}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Pills wrapped into rows of the given width. */
function pillRows(labels: string[], m: Measures, width: number) {
  const rows: string[][] = [];
  let x = 0;
  for (const label of labels) {
    const w = m.bodySemi(label, 27) + 36 + 10;
    if (!rows.length || (x + w > width && x > 0)) {
      rows.push([]);
      x = 0;
    }
    rows[rows.length - 1].push(label);
    x += w;
  }
  return rows;
}

function Ribbon({ kind, title, note, rows, tint, ink, height }: { kind: ChipKind; title: string; note: string; rows: string[][]; tint: string; ink: string; height: number }) {
  const s = CHIP_STYLE[kind];
  return (
    <div style={{ display: "flex", flexDirection: "column", width: IW, height: height - 20, marginBottom: 20, background: C.white, borderRadius: 16, border: `2px solid ${C.line}`, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", height: 64, padding: "0 20px", background: s.bg }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 36, color: s.fg }}>{title}</div>
        <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 26, color: s.fg, marginLeft: 16 }}>{note}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", padding: "16px 20px 0" }}>
        {rows.map((row, r) => (
          <div key={r} style={{ display: "flex", height: 56 }}>
            {row.map((label) => (
              <div
                key={label}
                style={{ display: "flex", alignItems: "center", height: 46, padding: "0 18px", marginRight: 10, borderRadius: 23, background: tint, fontFamily: BODY, fontWeight: 600, fontSize: 27, color: ink }}
              >
                {label}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function yearImage(cal: ExportCalendar, m: Measures) {
  const overview = yearOverview(cal);
  const monthRows: string[][] = [];
  for (let i = 0; i < cal.months.length; i += 3) monthRows.push(cal.months.slice(i, i + 3));
  const monthsH = monthRows.length * (MINI_H + MINI_GAP);

  // Year at a Glance cards in two columns, each card to the shorter column.
  const groups = layGlance(cal, m);
  const cols: LaidGroup[][] = [[], []];
  const colH = [0, 0];
  for (const g of groups) {
    const c = colH[0] <= colH[1] ? 0 : 1;
    cols[c].push(g);
    colH[c] += g.height;
  }
  const glanceH = groups.length ? Math.max(...colH) : 0;

  const ribbons = [
    overview.scoutSundays.length
      ? { kind: "scout-sunday" as const, title: "Scout Sundays", note: "10 AM Mass", labels: overview.scoutSundays, tint: "#ede4f8", ink: "#4a2a7a" }
      : null,
    overview.noMeetings.length
      ? { kind: "no-meeting" as const, title: "No Meetings", note: "No scout meeting these days", labels: overview.noMeetings, tint: "#efece3", ink: "#4a463c" }
      : null,
  ]
    .filter((r) => r !== null)
    .map((r) => {
      const rows = pillRows(r.labels, m, IW - 40);
      return { ...r, rows, height: 64 + 16 + rows.length * 56 + 8 + 20 };
    });
  const ribbonsH = ribbons.reduce((s, r) => s + r.height, 0);

  const meetingText = overview.meetings
    ? [overview.meetings.when, overview.meetings.detail, "Not held on camping weekends or No Meeting nights"].filter(Boolean).join(" · ")
    : "";
  const meetingLines = meetingText ? wrapText(meetingText, m.bodySemi, 30, IW - 56, 3) : [];
  const meetingH = overview.meetings ? 24 + 42 + meetingLines.length * 41 + 20 + 20 : 0;

  const height = HEADER_H + 32 + monthsH + LEGEND_H - 24 + 20 + 70 + glanceH + ribbonsH + meetingH + FOOTER_H + 24;

  const element = (
    <Page height={height}>
      <Header eyebrow="PACK 376 · YEAR AT A GLANCE" title={`${cal.yearLabel} Calendar`} sub={`Cub Scout Pack 376 · Brooklyn · ${EXPORT_SITE}`} />
      <div style={{ display: "flex", flexDirection: "column", padding: `32px ${P}px 0` }}>
        {monthRows.map((row, r) => (
          <div key={r} style={{ display: "flex", height: MINI_H + MINI_GAP }}>
            {row.map((month, i) => (
              <div key={month} style={{ display: "flex", marginLeft: i ? MINI_GAP : 0 }}>
                <MiniMonth month={month} cal={cal} />
              </div>
            ))}
          </div>
        ))}
        <div style={{ display: "flex", marginTop: -24 }}>
          <Legend />
        </div>
        <div style={{ height: 20 }} />
        <SectionTitle>The Year&apos;s Events</SectionTitle>
        {groups.length ? (
          <div style={{ display: "flex", height: glanceH }}>
            {cols.map((col, c) => (
              <div key={c} style={{ display: "flex", flexDirection: "column", marginLeft: c ? 20 : 0 }}>
                {col.map((g) => (
                  <GlanceCard key={g.title} g={g} />
                ))}
              </div>
            ))}
          </div>
        ) : null}
        {ribbons.map((r) => (
          <Ribbon key={r.title} {...r} />
        ))}
        {overview.meetings ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: IW,
              height: meetingH - 20,
              marginBottom: 20,
              padding: "24px 28px 0",
              borderRadius: 16,
              background: CHIP_STYLE.meeting.bg,
            }}
          >
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 34, color: C.blueDark, height: 42 }}>{overview.meetings.title}</div>
            {meetingLines.map((line, i) => (
              <div key={i} style={{ fontFamily: BODY, fontWeight: 600, fontSize: 30, lineHeight: "41px", height: 41, color: C.blueDark }}>
                {line}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <Footer cal={cal} />
    </Page>
  );
  return { element, height };
}

// ---------------------------------------------------------------------------

export async function buildCalendarPng(cal: ExportCalendar, scope: ExportScope): Promise<Uint8Array> {
  const files = await loadExportFonts();
  const m = measures(files);
  const { element, height } = scope === "full" ? yearImage(cal, m) : monthImage(cal, scope, m);
  const image = new ImageResponse(element, { width: W, height: Math.ceil(height), fonts: fontsFor(files) });
  return new Uint8Array(await image.arrayBuffer());
}
