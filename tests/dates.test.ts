import { describe, it, expect } from "vitest";
import { addDays, extractDue, parseMeetingDate, resolveDuePhrase } from "../src/dates.js";

describe("ING-06 meeting date forms", () => {
  it.each([
    ["2026-09-01", "2026-09-01"],
    ["9 September 2026", "2026-09-09"],
    ["Monday, 14 September 2026", "2026-09-14"],
    ["September 9, 2026", "2026-09-09"],
    ["9 Sep 2026", "2026-09-09"],
    ["  2026-10-14  ", "2026-10-14"],
  ])("parses %s", (input, expected) => {
    expect(parseMeetingDate(input)).toBe(expected);
  });

  it.each(["sometime last week", "", "2026-02-30", "14 September", "31 September 2026", "next Friday"])(
    "rejects %j",
    (input) => {
      expect(parseMeetingDate(input)).toBeNull();
    },
  );

  it("addDays works across month ends in UTC", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

type Row = [text: string, meeting: string, task: string, dueRaw: string, dueDate: string];

describe("DAT-10..19 / spec 03 expected results", () => {
  const rows: Row[] = [
    ["send the revised quote to Acme by Friday", "2026-09-01", "send the revised quote to Acme", "by Friday", "2026-09-04"],
    ["share first wireframes by Thursday", "2026-09-01", "share first wireframes", "by Thursday", "2026-09-03"],
    ["draft the test plan for invoice rounding by end of next week", "2026-09-03", "draft the test plan for invoice rounding", "by end of next week", "2026-09-11"],
    ["export last quarter invoices by 10 Sep", "2026-09-03", "export last quarter invoices", "by 10 Sep", "2026-09-10"],
    ["collect 5 customer quotes for the landing page by end of month", "2026-09-14", "collect 5 customer quotes for the landing page", "by end of month", "2026-09-30"],
    ["finalise the welcome-email copy by Wed 16 Sep", "2026-09-14", "finalise the welcome-email copy", "by Wed 16 Sep", "2026-09-16"],
    ["write the postmortem by EOD tomorrow", "2026-09-21", "write the postmortem", "by EOD tomorrow", "2026-09-22"],
    ["finalise the Q4 sales targets by Oct 3rd", "2026-09-30", "finalise the Q4 sales targets", "by Oct 3rd", "2026-10-03"],
    ["run the customer survey, results due 15 October", "2026-09-30", "run the customer survey, results", "due 15 October", "2026-10-15"],
    ["propose the on-call rotation by mid-October", "2026-09-30", "propose the on-call rotation", "by mid-October", "2026-10-15"],
    ["circulate the offsite summary tomorrow", "2026-09-30", "circulate the offsite summary", "tomorrow", "2026-10-01"],
    ["schedule cutover for Saturday 10 Oct", "2026-09-29", "schedule cutover", "for Saturday 10 Oct", "2026-10-10"],
    ["start SSO spike by next Tuesday", "2026-10-05", "start SSO spike", "by next Tuesday", "2026-10-13"],
    ["demo the portal to Acme on 2026-10-14", "2026-10-06", "demo the portal to Acme", "on 2026-10-14", "2026-10-14"],
    ["send the proposal to Orbit Labs by Tuesday", "2026-10-10", "send the proposal to Orbit Labs", "by Tuesday", "2026-10-13"],
    ["log the three new leads in CRM by EOD", "2026-10-10", "log the three new leads in CRM", "by EOD", "2026-10-10"],
    ["audit colour contrast on the dashboard by Mon", "2026-09-18", "audit colour contrast on the dashboard", "by Mon", "2026-09-21"],
    ["freeze invoice edits from 9 Oct", "2026-09-29", "freeze invoice edits", "from 9 Oct", "2026-10-09"],
    ["cut cloud costs by 10% — proposal by 2026-10-09", "2026-10-02", "cut cloud costs by 10% — proposal", "by 2026-10-09", "2026-10-09"],
    ["set up the staging environment by 2026-09-08", "2026-09-01", "set up the staging environment", "by 2026-09-08", "2026-09-08"],
  ];
  it.each(rows)("%s (meeting %s)", (text, meeting, task, dueRaw, dueDate) => {
    const r = extractDue(text, meeting);
    expect(r.dueDate).toBe(dueDate);
    expect(r.dueRaw).toBe(dueRaw);
    expect(r.task).toBe(task);
    expect(r.unparsed).toBe(false);
  });
});

describe("DAT-11 bare weekday is strictly after the meeting date (D9)", () => {
  it("a Friday meeting saying 'by Friday' means the next Friday", () => {
    expect(extractDue("ship it by Friday", "2026-09-04").dueDate).toBe("2026-09-11");
  });
  it("Friday meeting, 'by Monday' is 3 days later", () => {
    expect(extractDue("ship it by Monday", "2026-09-04").dueDate).toBe("2026-09-07");
  });
  it("Tuesday meeting, 'by Wed' is the next day", () => {
    expect(extractDue("ship it by Wed", "2026-09-01").dueDate).toBe("2026-09-02");
  });
});

describe("DAT-13 next <weekday> is in the following Mon-Sun week", () => {
  it("Monday meeting, next Tuesday is 8 days later", () => {
    expect(extractDue("x by next Tuesday", "2026-10-05").dueDate).toBe("2026-10-13");
  });
  it("Friday meeting, next Monday is the Monday of the following week", () => {
    expect(extractDue("x by next Monday", "2026-09-04").dueDate).toBe("2026-09-07");
  });
  it("Wednesday meeting, next Friday is Friday of the following week", () => {
    expect(extractDue("x by next Friday", "2026-09-02").dueDate).toBe("2026-09-11");
  });
});

describe("DAT-14..19 vague phrases (D10)", () => {
  it("DAT-14 tomorrow and EOD tomorrow", () => {
    expect(extractDue("x by tomorrow", "2026-09-30").dueDate).toBe("2026-10-01");
    expect(extractDue("x EOD tomorrow", "2026-09-30").dueDate).toBe("2026-10-01");
  });
  it("DAT-15 today / EOD / end of day / COB are the meeting date", () => {
    for (const p of ["by today", "by EOD", "by end of day", "by COB"]) {
      expect(extractDue(`x ${p}`, "2026-09-10").dueDate).toBe("2026-09-10");
    }
  });
  it("DAT-16 end of week: Friday of the meeting week; weekend meeting rolls to next week", () => {
    expect(extractDue("x by end of week", "2026-09-02").dueDate).toBe("2026-09-04");
    expect(extractDue("x by end of this week", "2026-09-02").dueDate).toBe("2026-09-04");
    expect(extractDue("x by end of week", "2026-09-05").dueDate).toBe("2026-09-11");
  });
  it("DAT-17 end of next week", () => {
    expect(extractDue("x by end of next week", "2026-09-03").dueDate).toBe("2026-09-11");
  });
  it("DAT-18 end of month, including February", () => {
    expect(extractDue("x by end of the month", "2026-09-14").dueDate).toBe("2026-09-30");
    expect(extractDue("x by end of month", "2026-02-10").dueDate).toBe("2026-02-28");
  });
  it("DAT-19 mid-<month>", () => {
    expect(extractDue("x by mid October", "2026-09-30").dueDate).toBe("2026-10-15");
    expect(extractDue("x by mid-October", "2026-09-30").dueDate).toBe("2026-10-15");
  });
});

describe("DAT-10 year inference when no year is given", () => {
  it("uses the meeting year", () => {
    expect(extractDue("x by 5 Oct", "2026-09-30").dueDate).toBe("2026-10-05");
  });
  it("rolls to next year when the date would be more than 180 days in the past", () => {
    expect(extractDue("x by 5 Jan", "2026-12-20").dueDate).toBe("2027-01-05");
  });
  it("does not roll for a date a few days back", () => {
    expect(extractDue("x by 5 Sep", "2026-09-10").dueDate).toBe("2026-09-05");
  });
  it("an explicit year is kept", () => {
    expect(extractDue("x by 9 September 2027", "2026-09-10").dueDate).toBe("2027-09-09");
  });
});

describe("DAT-02 on/from/for need an explicit date", () => {
  it("'for the landing page' is not a due phrase", () => {
    const r = extractDue("collect customer quotes for the landing page", "2026-09-14");
    expect(r).toMatchObject({ dueDate: null, dueRaw: null, unparsed: false, task: "collect customer quotes for the landing page" });
  });
  it("'on Friday' is not a due phrase (needs an explicit date)", () => {
    expect(extractDue("meet on Friday", "2026-09-01").dueDate).toBeNull();
  });
  it("'on 9 Oct' is", () => {
    expect(extractDue("meet on 9 Oct", "2026-09-01").dueDate).toBe("2026-10-09");
  });
});

describe("DAT-21 / DAT-22 / DAT-23 unparsed and absent phrases", () => {
  it.each([
    ["review the prototype before the next review", "review the prototype", "before the next review"],
    ["snapshot the production DB before cutover", "snapshot the production DB", "before cutover"],
  ])("DAT-21 %s", (text, task, raw) => {
    const r = extractDue(text, "2026-09-18");
    expect(r).toMatchObject({ dueDate: null, dueRaw: raw, unparsed: true, task });
  });

  it("DAT-22 no phrase at all", () => {
    expect(extractDue("update the CRM notes", "2026-09-10")).toMatchObject({
      dueDate: null,
      dueRaw: null,
      unparsed: false,
      task: "update the CRM notes",
    });
  });

  it("'by 10%' is part of the task, not an unparsed due phrase", () => {
    expect(extractDue("cut cloud costs by 10%", "2026-10-02")).toMatchObject({
      dueDate: null,
      dueRaw: null,
      unparsed: false,
      task: "cut cloud costs by 10%",
    });
  });

  it("DAT-23 impossible date is unparsed", () => {
    const r = extractDue("x by 31 Sep", "2026-09-10");
    expect(r).toMatchObject({ dueDate: null, dueRaw: "by 31 Sep", unparsed: true });
  });
});

describe("DAT-04 task cleanup", () => {
  it("strips trailing punctuation and a dangling separator", () => {
    expect(extractDue("send the slides by Friday.", "2026-09-01").task).toBe("send the slides");
    expect(extractDue("send the slides - by Friday", "2026-09-01").task).toBe("send the slides");
    expect(extractDue("send the slides, by Friday", "2026-09-01").task).toBe("send the slides");
  });
  it("is case-insensitive for weekday and month words", () => {
    expect(extractDue("x BY FRIDAY", "2026-09-01").dueDate).toBe("2026-09-04");
    expect(extractDue("x by 10 SEP", "2026-09-03").dueDate).toBe("2026-09-10");
  });
});

describe("DAT-03 table Due cell", () => {
  it("resolves a cell with no introducer", () => {
    expect(resolveDuePhrase("2026-10-09", "2026-09-30")).toEqual({ dueDate: "2026-10-09", unparsed: false });
    expect(resolveDuePhrase("Friday", "2026-09-30")).toEqual({ dueDate: "2026-10-02", unparsed: false });
  });
  it("an unresolvable cell is unparsed; an empty cell is neither", () => {
    expect(resolveDuePhrase("when ready", "2026-09-30")).toEqual({ dueDate: null, unparsed: true });
    expect(resolveDuePhrase("  ", "2026-09-30")).toEqual({ dueDate: null, unparsed: false });
  });
});
