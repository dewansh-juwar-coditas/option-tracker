/** Traceability tests for spec 03 criteria that earlier tests only covered inside table rows. */
import { describe, expect, it } from "vitest";
import { extractDue } from "../src/dates.js";

describe("DAT-01 the last resolving phrase wins", () => {
  it("DAT-01 'by 10%' is not a date, so the later 'by <date>' is the due phrase", () => {
    const r = extractDue("cut cloud costs by 10% — proposal by 2026-10-09", "2026-10-02");
    expect(r.dueDate).toBe("2026-10-09");
    expect(r.dueRaw).toBe("by 2026-10-09");
  });
  it("DAT-01 with two resolving phrases the last one wins", () => {
    const r = extractDue("send the deck by Friday and the notes by 2026-09-20", "2026-09-01");
    expect(r.dueDate).toBe("2026-09-20");
  });
  it.each(["by", "before", "until", "till", "due", "due on", "on", "from", "for"])(
    "DAT-01 introducer '%s' is accepted with an explicit date",
    (word) => {
      expect(extractDue(`ship it ${word} 2026-09-20`, "2026-09-01").dueDate).toBe("2026-09-20");
    },
  );
});

describe("DAT-12 weekday plus explicit date uses the explicit date", () => {
  it("DAT-12 the weekday word is ignored even when it disagrees with the date", () => {
    // 16 Sep 2026 is a Wednesday; "Fri 16 Sep" still means 16 Sep.
    expect(extractDue("x by Fri 16 Sep", "2026-09-01").dueDate).toBe("2026-09-16");
    expect(extractDue("x by Wed 16 Sep", "2026-09-01").dueDate).toBe("2026-09-16");
  });
});

describe("DAT-20 abbreviations only count next to an introducer or a day number", () => {
  it.each([
    "plan the may release",
    "fix the wed widget",
    "write up the sat nav spec",
    "review the mar report",
  ])("DAT-20 '%s' has no due phrase", (text) => {
    const r = extractDue(text, "2026-09-01");
    expect(r.dueDate).toBeNull();
    expect(r.dueRaw).toBeNull();
    expect(r.task).toBe(text);
  });
  it("DAT-20 the same abbreviation after an introducer is a date word", () => {
    expect(extractDue("x by Wed", "2026-09-01").dueDate).toBe("2026-09-02");
    expect(extractDue("x by 10 Sep", "2026-09-03").dueDate).toBe("2026-09-10");
  });
});

describe("G-03 / G-04 'today' is computed in UTC (CLAUDE.md convention)", () => {
  it("G-04 the default as-of date does not depend on the machine's time zone", async () => {
    const { vi } = await import("vitest");
    const { todayIso } = await import("../src/dates.js");
    const oldTz = process.env["TZ"];
    process.env["TZ"] = "Asia/Kolkata"; // UTC+05:30: 22:00 UTC on the 10th is already the 11th locally
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-03-10T22:00:00Z"));
      expect(todayIso()).toBe("2026-03-10");
    } finally {
      vi.useRealTimers();
      if (oldTz === undefined) delete process.env["TZ"];
      else process.env["TZ"] = oldTz;
    }
  });
});
