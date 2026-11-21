# Fonts for the shareable calendar files

The site's two typefaces, read at run time by `src/lib/calendarExportFonts.ts`
for the PDF and PNG calendar exports (`/api/calendar/export/…`, staff only). Both are under the
SIL Open Font License 1.1 (texts beside them), and neither declares a Reserved
Font Name.

- **Poppins** Regular / SemiBold / Bold: the static TTFs Google Fonts serves,
  unchanged.
- **Baloo 2** Bold / ExtraBold: Google Fonts' static TTFs cut down to Latin
  (the characters `exportText` in `src/lib/calendarExport.ts` keeps) with only
  the `kern` layout feature. The full files are mostly Devanagari, and
  pdf-lib couldn't use them: embedded whole, fontkit failed to parse a layout
  table; subset, most letters vanished ("PACK 37 CA ENDA"). Made with
  fontTools 4.60.1:

  ```
  pyftsubset Baloo2-ExtraBold.ttf --unicodes="U+0020-007E,U+00A0-017F,U+2010-2027,U+2030-203A,U+20AC,U+2122" \
    --layout-features='kern' --no-hinting --output-file=Baloo2-ExtraBold.ttf
  ```

  (the same for Bold). If `exportText` ever keeps more characters, rebuild
  these from the originals with the wider range.
