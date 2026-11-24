import { describe, it, expect } from "vitest";
import { parseNote } from "../src/parser.js";

function ok(content: string | Buffer, fileName = "2026-09-01-test.md") {
  const r = parseNote(content, fileName);
  if (!r.ok) throw new Error(`expected ok, got skip: ${r.reason}`);
  return r.note;
}
function skip(content: string | Buffer, fileName = "2026-09-01-test.md") {
  const r = parseNote(content, fileName);
  if (r.ok) throw new Error("expected skip");
  return r.reason;
}

const heading = `# Meeting: Quote portal weekly
Date: 2026-09-08
Attendees: Priya Nair, Rahul Mehta, Anita Desai

## Discussion
Some text.

## Action items
- [ ] Priya N. to send revised quote to Acme — by Friday
- [x] Rahul to set up the staging environment
`;

describe("ING-04 heading-style header", () => {
  it("reads title, date, attendees and items", () => {
    const n = ok(heading);
    expect(n.title).toBe("Quote portal weekly");
    expect(n.date).toBe("2026-09-08");
    expect(n.dateFromFileName).toBe(false);
    expect(n.attendees).toEqual(["Priya Nair", "Rahul Mehta", "Anita Desai"]);
    expect(n.items).toHaveLength(2);
    expect(n.items[0]).toMatchObject({ kind: "checkbox", checked: false, text: "Priya N. to send revised quote to Acme — by Friday" });
    expect(n.items[1]).toMatchObject({ checked: true, text: "Rahul to set up the staging environment" });
  });
  it("keys are case-insensitive and a plain title heading works", () => {
    const n = ok("# Weekly sync\nDATE: 2026-09-08\nattendees: A B, C D\n- [ ] A to x\n");
    expect(n.title).toBe("Weekly sync");
    expect(n.attendees).toEqual(["A B", "C D"]);
  });
  it("records 1-based line numbers", () => {
    const n = ok(heading);
    expect(n.items.map((i) => i.lineNo)).toEqual([9, 10]);
  });
});

describe("ING-05 front-matter header", () => {
  const fm = `---
title: Team standup
date: 2026-09-16
attendees: [Anita Desai, Lena Fischer, Meera Iyer]
---

## Action items
- [ ] Lena to draft the case study outline by 2026-09-21
`;
  it("reads title, date, inline attendees list", () => {
    const n = ok(fm, "2026-09-16-standup.md");
    expect(n.title).toBe("Team standup");
    expect(n.date).toBe("2026-09-16");
    expect(n.attendees).toEqual(["Anita Desai", "Lena Fischer", "Meera Iyer"]);
    expect(n.items).toHaveLength(1);
    expect(n.items[0]!.lineNo).toBe(8);
  });
  it("accepts a plain comma list and quoted names", () => {
    const n = ok("---\ndate: 2026-09-16\nattendees: \"A B\", 'C D'\n---\n- [ ] A to x\n");
    expect(n.attendees).toEqual(["A B", "C D"]);
  });
  it("front-matter lines are never scanned for items", () => {
    const n = ok("---\ndate: 2026-09-16\nnote: - [ ] not an item\n---\n- [ ] A to x\n");
    expect(n.items).toHaveLength(1);
  });
});

describe("ING-06 / ING-07 dates", () => {
  it.each([
    ["Date: 9 September 2026", "2026-09-09"],
    ["Date: Monday, 14 September 2026", "2026-09-14"],
    ["Date: 2026-09-01", "2026-09-01"],
  ])("accepts %s", (line, iso) => {
    expect(ok(`# Meeting: x\n${line}\n- [ ] A to b\n`, "notes.md").date).toBe(iso);
  });
  it("ING-07 falls back to the file-name date with a warning", () => {
    const n = ok("# Meeting: Sales pipeline\nDate: sometime last week\nAttendees: A B\n- [ ] A to b\n", "2026-10-03-sales-pipeline.md");
    expect(n.date).toBe("2026-10-03");
    expect(n.dateFromFileName).toBe(true);
    expect(n.warnings).toContain("date taken from file name");
  });
  it("ING-07 falls back when there is no Date line at all", () => {
    const n = ok("# Meeting: x\n- [ ] A to b\n", "2026-10-03-x.md");
    expect(n.date).toBe("2026-10-03");
  });
});

describe("ING-08 / ING-13 warnings that do not skip the note", () => {
  it("ING-08 no attendees line", () => {
    const n = ok("# Meeting: Team standup\nDate: 2026-09-23\n- [ ] Rahul to rebase\n");
    expect(n.attendees).toEqual([]);
    expect(n.warnings).toContain("no attendees listed");
  });
  it("ING-13 valid note with no action lines", () => {
    const n = ok("# Meeting: Chat\nDate: 2026-09-23\nAttendees: A B\n\nJust talk.\n");
    expect(n.items).toEqual([]);
    expect(n.warnings).toContain("no action items found");
  });
});

describe("ING-09..12 malformed notes are skipped with a reason", () => {
  it("ING-09 empty file", () => {
    expect(skip("")).toBe("empty file");
    expect(skip(Buffer.alloc(0))).toBe("empty file");
  });
  it("ING-09 whitespace only", () => {
    expect(skip("  \n\t \n")).toBe("empty file");
  });
  it("ING-10 NUL byte means binary", () => {
    expect(skip(Buffer.from([0x23, 0x20, 0x4d, 0x00, 0x00, 0x01]))).toBe("binary or not valid UTF-8 text");
  });
  it("ING-10 invalid UTF-8 (PNG header)", () => {
    expect(skip(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("binary or not valid UTF-8 text");
  });
  it("ING-11 no usable date and no file-name date", () => {
    expect(skip("- [ ] Sam to chase the vendor\n- [ ] Priya to send the slides by Friday\n", "untitled.md")).toBe(
      "no usable meeting date",
    );
  });
  it("ING-11 an unparseable date and a non-date file name", () => {
    expect(skip("# Meeting: x\nDate: soon\n- [ ] A to b\n", "notes.md")).toBe("no usable meeting date");
  });
  it("a UTF-8 BOM is tolerated", () => {
    const n = ok("﻿# Meeting: x\nDate: 2026-09-01\n- [ ] A to b\n");
    expect(n.date).toBe("2026-09-01");
  });
});

describe("ING-14 checkbox lines", () => {
  const body = (lines: string) => `# Meeting: x\nDate: 2026-09-30\nAttendees: A B\n${lines}\n`;

  it("accepts -, * and + bullets", () => {
    const n = ok(body("- [ ] A to one\n* [ ] A to two\n+ [ ] A to three"));
    expect(n.items.map((i) => i.text)).toEqual(["A to one", "A to two", "A to three"]);
  });
  it("[x] and [X] are done, [ ] is open", () => {
    const n = ok(body("- [x] A to one\n- [X] A to two\n- [ ] A to three"));
    expect(n.items.map((i) => i.checked)).toEqual([true, true, false]);
  });
  it("space after ] is optional", () => {
    expect(ok(body("- [ ]Priya to send the quote")).items[0]!.text).toBe("Priya to send the quote");
  });
  it("nested checkboxes are their own items", () => {
    const n = ok(body("- [ ] Meera to finalise targets\n  - [ ] Karan to validate targets"));
    expect(n.items.map((i) => i.text)).toEqual(["Meera to finalise targets", "Karan to validate targets"]);
  });
  it("ING-18 an empty checkbox is dropped with a warning", () => {
    const n = ok(body("- [ ]   \n- [ ] A to real"));
    expect(n.items).toHaveLength(1);
    expect(n.warnings.some((w) => w.startsWith("empty checkbox"))).toBe(true);
  });
  it("an ordinary bullet or a heading is not an item", () => {
    expect(ok(body("- just a bullet\n## Action items\n1. [ ] numbered")).items).toHaveLength(0);
  });
});

describe("ING-17 ignored regions", () => {
  const body = (lines: string) => `# Meeting: x\nDate: 2026-10-09\nAttendees: A B\n${lines}\n- [ ] A to real item\n`;

  it("fenced code blocks (``` and ~~~)", () => {
    const n = ok(body("```\n# example\n- [ ] Owner to remediate finding by <date>\n```\n~~~\n- [ ] B to in tilde fence\n~~~"));
    expect(n.items.map((i) => i.text)).toEqual(["A to real item"]);
  });
  it("blockquote lines", () => {
    const n = ok(body("> Please make sure someone owns refunds.\n> - [ ] Karan to refund affected customers by Friday"));
    expect(n.items.map((i) => i.text)).toEqual(["A to real item"]);
  });
  it("single-line HTML comment", () => {
    const n = ok(body("<!-- - [ ] Sam to buy hardware tokens for everyone by Friday (cut) -->"));
    expect(n.items.map((i) => i.text)).toEqual(["A to real item"]);
  });
  it("multi-line HTML comment keeps later line numbers correct", () => {
    const n = ok(body("<!--\n- [ ] hidden one\n- [ ] hidden two\n-->"));
    expect(n.items).toHaveLength(1);
    expect(n.items[0]!.lineNo).toBe(8);
  });
  it("an unclosed HTML comment hides the rest of the note", () => {
    const n = ok("# Meeting: x\nDate: 2026-10-09\n- [ ] A to first\n<!-- never closed\n- [ ] A to hidden\n");
    expect(n.items.map((i) => i.text)).toEqual(["A to first"]);
  });
});

describe("ING-15 tables", () => {
  const table = `# Meeting: offsite
Date: 2026-09-30
Attendees: Anita Desai

| Owner | Action | Due |
|-------|--------|-----|
| Anita | Refresh the brand kit | 2026-10-09 |
| Karan | Send the deck |  |

After the table.
`;
  it("one open item per data row, with owner, action and due cells", () => {
    const n = ok(table);
    expect(n.items).toHaveLength(2);
    expect(n.items[0]).toMatchObject({
      kind: "table",
      checked: false,
      ownerCell: "Anita",
      text: "Refresh the brand kit",
      dueCell: "2026-10-09",
      lineNo: 7,
    });
    expect(n.items[1]).toMatchObject({ ownerCell: "Karan", text: "Send the deck", dueCell: "" });
  });
  it("a table without a Due column still works", () => {
    const n = ok("# Meeting: x\nDate: 2026-09-30\n| Owner | Action |\n|---|---|\n| Anita | Do it |\n");
    expect(n.items[0]).toMatchObject({ ownerCell: "Anita", text: "Do it", dueCell: null });
  });
  it("a pipe table without Owner and Action headers is ignored", () => {
    const n = ok("# Meeting: x\nDate: 2026-09-30\n| Name | Role |\n|---|---|\n| Anita | Dev |\n");
    expect(n.items).toEqual([]);
  });
  it("the header and separator rows are not items", () => {
    expect(ok(table).items.some((i) => /owner|action|---/i.test(i.text))).toBe(false);
  });
});

describe("ING-16 ACTION: lines", () => {
  it("with and without a bullet, case-insensitive", () => {
    const n = ok("# Meeting: x\nDate: 2026-09-30\nACTION: Karan to circulate the offsite summary tomorrow\n- action: B to two\n");
    expect(n.items.map((i) => [i.kind, i.checked, i.text])).toEqual([
      ["action", false, "Karan to circulate the offsite summary tomorrow"],
      ["action", false, "B to two"],
    ]);
  });
  it("a heading such as 'Action items' is not an ACTION: line", () => {
    expect(ok("# Meeting: x\nDate: 2026-09-30\n## Action items\n").items).toEqual([]);
  });
});
