import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/*
 * The site's two typefaces, for the shareable calendar files: Baloo 2 for
 * headings and day numbers, Poppins for event text — the same pair layout.tsx
 * loads for the website. They're static TTFs from Google Fonts (SIL Open Font
 * License), Baloo 2 cut down to Latin so pdf-lib can embed it — see the
 * README beside them in src/assets/fonts.
 *
 * next.config.ts lists the folder under outputFileTracingIncludes for the
 * export route, because nothing imports these files: without that line
 * Vercel would deploy the route without them.
 */

const FONT_DIR = join(process.cwd(), "src", "assets", "fonts");

const FILES = {
  display: "Baloo2-ExtraBold.ttf",
  displayBold: "Baloo2-Bold.ttf",
  body: "Poppins-Regular.ttf",
  bodySemi: "Poppins-SemiBold.ttf",
  bodyBold: "Poppins-Bold.ttf",
} as const;

export type ExportFontName = keyof typeof FILES;
export type ExportFontFiles = Record<ExportFontName, Uint8Array>;

let loading: Promise<ExportFontFiles> | null = null;

/** The font files, read once per server instance. */
export function loadExportFonts(): Promise<ExportFontFiles> {
  loading ??= (async () => {
    const entries = await Promise.all(
      Object.entries(FILES).map(async ([name, file]) => [name, new Uint8Array(await readFile(join(FONT_DIR, file)))] as const),
    );
    return Object.fromEntries(entries) as ExportFontFiles;
  })().catch((error) => {
    loading = null; // let the next request try again
    throw error;
  });
  return loading;
}
