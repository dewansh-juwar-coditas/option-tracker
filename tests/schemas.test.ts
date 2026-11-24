/** Zod boundaries: people file (FUP-10..12), CLI option values (LST-11), JSON outputs (LST-10, FUP-30). */
import { describe, expect, it } from "vitest";
import { findPerson } from "../src/owners.js";
import {
  DateOptionSchema,
  FollowupOutputSchema,
  ListOutputSchema,
  StatusSchema,
  parsePeople,
} from "../src/schemas.js";

describe("FUP-10 / FUP-12 people file", () => {
  it("FUP-10 accepts a JSON object of name to email", () => {
    const r = parsePeople('{"Karan Joshi": "karan@example.com"}');
    expect(r).toEqual({ ok: true, value: { "Karan Joshi": "karan@example.com" } });
  });
  it.each([
    ["not json", "{oops"],
    ["an array", '["a@b.c"]'],
    ["a non-string value", '{"Karan Joshi": 5}'],
    ["null", "null"],
  ])("FUP-12 %s is invalid", (_label, text) => {
    const r = parsePeople(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message.length).toBeGreaterThan(0);
  });
});

describe("LST-11 option values", () => {
  it.each(["open", "done", "overdue"])("LST-11 status %s is valid", (s) => {
    expect(StatusSchema.safeParse(s).success).toBe(true);
  });
  it.each(["OPEN", "closed", "", "all"])("LST-11 status '%s' is invalid", (s) => {
    expect(StatusSchema.safeParse(s).success).toBe(false);
  });
  it("LST-05 / LST-11 dates accept the note date forms and become ISO", () => {
    expect(DateOptionSchema.parse("2026-09-09")).toBe("2026-09-09");
    expect(DateOptionSchema.parse("9 September 2026")).toBe("2026-09-09");
    expect(DateOptionSchema.parse("September 9, 2026")).toBe("2026-09-09");
  });
  it.each(["tomorrow", "2026-02-30", "yesterday-ish", ""])("LST-11 date '%s' is invalid", (s) => {
    expect(DateOptionSchema.safeParse(s).success).toBe(false);
  });
});

const listItem = (owner: object) => ({
  id: 1,
  status: "open",
  days_overdue: null,
  owner,
  task: "t",
  due_date: null,
  due_raw: null,
  source_file: "a.md",
  meeting_date: "2026-01-01",
  source_title: null,
  history: [{ file: "a.md", line: 1, meeting_date: "2026-01-01", checked: false }],
});

describe("LST-10 list --json schema", () => {
  it("LST-10 accepts each of the four owner kinds", () => {
    const owners = [
      { kind: "person", name: "A B", candidates: [], group: null },
      { kind: "ambiguous", name: null, candidates: ["A B", "A C"], group: null },
      { kind: "unowned", name: null, candidates: [], group: null },
      { kind: "group", name: null, candidates: [], group: "everyone" },
    ];
    for (const o of owners) expect(ListOutputSchema.safeParse([listItem(o)]).success).toBe(true);
  });
  it("OWN-05a an owner kind outside the four is rejected", () => {
    expect(ListOutputSchema.safeParse([listItem({ kind: "nobody", name: null, candidates: [], group: null })]).success).toBe(false);
  });
  it("OWN-07a `group` is set only when kind is group", () => {
    expect(ListOutputSchema.safeParse([listItem({ kind: "unowned", name: null, candidates: [], group: "team" })]).success).toBe(false);
    expect(ListOutputSchema.safeParse([listItem({ kind: "group", name: null, candidates: [], group: null })]).success).toBe(false);
    expect(ListOutputSchema.safeParse([listItem({ kind: "group", name: null, candidates: [], group: "everyone-ish" })]).success).toBe(false);
  });
  it("LST-10 status is open, overdue or done", () => {
    const bad = { ...listItem({ kind: "unowned", name: null, candidates: [], group: null }), status: "late" };
    expect(ListOutputSchema.safeParse([bad]).success).toBe(false);
  });
});

describe("FUP-30 followup --json schema", () => {
  const draft = {
    owner: "A B",
    to: null,
    subject: "s",
    body: "b",
    item_ids: [1],
    counts: { overdue: 0, open: 1 },
    warnings: [],
    send: false,
  };
  const out = (d: object) => ({ as_of: "2026-03-10", drafts: [d], excluded: { ambiguous: 0, unowned: 0, group: 0 }, warnings: [] });
  it("FUP-30 accepts the documented shape", () => {
    expect(FollowupOutputSchema.safeParse(out(draft)).success).toBe(true);
    expect(FollowupOutputSchema.safeParse(out({ ...draft, to: "a@b.c" })).success).toBe(true);
  });
  it("FUP-32 `send` must be exactly false", () => {
    expect(FollowupOutputSchema.safeParse(out({ ...draft, send: true })).success).toBe(false);
  });
});

describe("D24 owner name matching (findPerson)", () => {
  const known = ["Anita Desai", "Priya Nair", "Priya Shah", "Sam Okafor"];
  it("D24 full name, case-insensitive", () => {
    expect(findPerson("anita desai", known)).toEqual({ ok: true, name: "Anita Desai" });
  });
  it("D24 a first name that belongs to exactly one person", () => {
    expect(findPerson("SAM", known)).toEqual({ ok: true, name: "Sam Okafor" });
  });
  it("D24 a first name shared by two people is ambiguous and lists them", () => {
    expect(findPerson("Priya", known)).toEqual({ ok: false, reason: "ambiguous", candidates: ["Priya Nair", "Priya Shah"] });
  });
  it("D24 an unknown name is unknown", () => {
    expect(findPerson("Zed", known)).toEqual({ ok: false, reason: "unknown", candidates: [] });
    expect(findPerson("  ", known).ok).toBe(false);
  });
  it("D24 a full name still wins when the first name is shared", () => {
    expect(findPerson("Priya Shah", known)).toEqual({ ok: true, name: "Priya Shah" });
  });
});
