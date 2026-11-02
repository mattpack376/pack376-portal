import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCsv } from "@/lib/csvParse";

function rows(text: string) {
  const result = parseCsv(text);
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.rows;
}

describe("parseCsv", () => {
  it("splits plain cells and rows", () => {
    assert.deepEqual(rows("a,b,c\n1,2,3\n"), [
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("keeps commas, line breaks and doubled quotes inside quoted cells", () => {
    assert.deepEqual(rows('"$1,234.56","two\nlines","say ""hi"""\n'), [["$1,234.56", "two\nlines", 'say "hi"']]);
  });

  it("handles CRLF line ends and a byte-order mark", () => {
    assert.deepEqual(rows("﻿Date,Amount\r\n9/1/26,5\r\n"), [
      ["Date", "Amount"],
      ["9/1/26", "5"],
    ]);
  });

  it("keeps empty cells and empty lines, and a last line with no line break", () => {
    assert.deepEqual(rows(",a,\n\nb,,"), [["", "a", ""], [""], ["b", "", ""]]);
  });

  it("keeps an empty quoted cell", () => {
    assert.deepEqual(rows('"",x'), [["", "x"]]);
  });

  it("is empty for empty text", () => {
    assert.deepEqual(rows(""), []);
  });

  it("refuses an unclosed quote and stray quotes", () => {
    assert.equal(parseCsv('a,"b\n').ok, false);
    const stray = parseCsv('a,b"c"\n');
    assert.equal(stray.ok, false);
    assert.match(stray.ok ? "" : stray.error, /Line 1/);
    const after = parseCsv('x\n"a"b,c\n');
    assert.equal(after.ok, false);
    assert.match(after.ok ? "" : after.error, /Line 2/);
  });
});
