/** Follow-up draft preparation (spec 06), unit level. Pure functions in followup.ts. */
import { describe, expect, it } from "vitest";
import { buildFollowup } from "../src/followup.js";
import { FollowupOutputSchema } from "../src/schemas.js";
import type { Item } from "../src/models.js";
import { mkItem, person } from "./factories.js";

const AS_OF = "2026-03-10";
const anita = (o: Partial<Item> & { id: number }) => mkItem({ owner: person("Anita Desai"), ...o });
const only = (items: Item[], owner = "Anita Desai", people: Record<string, string> = {}) => {
  const r = buildFollowup(items, { owner }, AS_OF, people);
  if (!r.ok) throw new Error(r.message);
  return r;
};

describe("FUP-02 owner selection", () => {
  const items = [anita({ id: 1 }), mkItem({ id: 2, owner: person("Priya Nair") }), mkItem({ id: 3, owner: person("Priya Shah") })];
  it("FUP-02 full name or unique first name, case-insensitive", () => {
    expect(only(items, "anita").output.drafts[0]!.owner).toBe("Anita Desai");
    expect(only(items, "PRIYA SHAH").output.drafts[0]!.owner).toBe("Priya Shah");
  });
  it("FUP-02 a shared first name is rejected with the exact message", () => {
    const r = buildFollowup(items, { owner: "Priya" }, AS_OF, {});
    expect(r).toEqual({ ok: false, message: "Ambiguous owner 'Priya': Priya Nair, Priya Shah" });
  });
  it("FUP-02 an unknown name is rejected and lists the known owners", () => {
    const r = buildFollowup(items, { owner: "Zed" }, AS_OF, {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("Zed");
      expect(r.message).toContain("Anita Desai");
      expect(r.message).toContain("Priya Nair");
    }
  });
  it("FUP-02 only person owners are candidates: an ambiguous item never makes a person known", () => {
    const amb = mkItem({ id: 9, owner: { kind: "ambiguous", name: null, candidates: ["Rahul Mehta", "Rahul Verma"], group: null } });
    const r = buildFollowup([amb], { owner: "Rahul" }, AS_OF, {});
    expect(r.ok).toBe(false);
  });
});

describe("FUP-03 / FUP-04 / FUP-05 what a draft covers", () => {
  it("FUP-03 open and overdue items are included; done items are not", () => {
    const r = only([
      anita({ id: 1, dueDate: "2026-03-01" }),
      anita({ id: 2 }),
      anita({ id: 3, status: "done" }),
    ]);
    expect(r.output.drafts[0]!.item_ids.sort()).toEqual([1, 2]);
    expect(r.output.drafts[0]!.counts).toEqual({ overdue: 1, open: 1 });
  });
  it("FUP-04 ambiguous, unowned and group items are never drafted, and are counted as excluded", () => {
    const r = only([
      anita({ id: 1 }),
      mkItem({ id: 2, owner: { kind: "ambiguous", name: null, candidates: ["A B", "A C"], group: null } }),
      mkItem({ id: 3, owner: { kind: "ambiguous", name: null, candidates: ["A B", "A C"], group: null } }),
      mkItem({ id: 4, owner: { kind: "unowned", name: null, candidates: [], group: null } }),
      mkItem({ id: 5, owner: { kind: "group", name: null, candidates: [], group: "team" } }),
    ]);
    expect(r.output.drafts).toHaveLength(1);
    expect(r.output.drafts[0]!.item_ids).toEqual([1]);
    expect(r.output.excluded).toEqual({ ambiguous: 2, unowned: 1, group: 1 });
  });
  it("FUP-05 a person with nothing open gets no draft and a message", () => {
    const r = only([anita({ id: 1, status: "done" })]);
    expect(r.output.drafts).toEqual([]);
    expect(r.notes).toEqual(["No open or overdue items for Anita Desai"]);
  });
});

describe("FUP-06 --all", () => {
  it("FUP-06 one draft per person with open items, sorted by owner name", () => {
    const items = [
      mkItem({ id: 1, owner: person("Sam Okafor") }),
      anita({ id: 2 }),
      mkItem({ id: 3, owner: person("Lena Fischer"), status: "done" }),
      mkItem({ id: 4, owner: person("Priya Nair") }),
    ];
    const r = buildFollowup(items, { all: true }, AS_OF, {});
    if (!r.ok) throw new Error(r.message);
    expect(r.output.drafts.map((d) => d.owner)).toEqual(["Anita Desai", "Priya Nair", "Sam Okafor"]);
  });
});

describe("FUP-10 / FUP-11 recipient", () => {
  it("FUP-10 people-file keys match case-insensitively", () => {
    const r = only([anita({ id: 1 })], "Anita Desai", { "ANITA DESAI": "anita@example.com" });
    expect(r.output.drafts[0]!.to).toBe("anita@example.com");
    expect(r.output.drafts[0]!.warnings).toEqual([]);
  });
  it("FUP-11 no entry: `to` is null, a warning is included, the draft is still produced", () => {
    const r = only([anita({ id: 1 })], "Anita Desai", { "Someone Else": "x@example.com" });
    const d = r.output.drafts[0]!;
    expect(d.to).toBeNull();
    expect(d.warnings).toEqual(["no email address for Anita Desai"]);
    expect(d.subject).toContain("Anita Desai");
  });
});

describe("FUP-20 subject", () => {
  it("FUP-20 shows both counts, including a zero", () => {
    const r = only([anita({ id: 1 }), anita({ id: 2, task: "plan the demo" })]);
    expect(r.output.drafts[0]!.subject).toBe("Action items follow-up: Anita Desai (0 overdue, 2 open)");
    const r2 = only([anita({ id: 1, dueDate: "2026-03-05", dueRaw: "by 2026-03-05" })]);
    expect(r2.output.drafts[0]!.subject).toBe("Action items follow-up: Anita Desai (1 overdue, 0 open)");
  });
});

describe("FUP-21 body", () => {
  it("FUP-21 exact layout with both sections", () => {
    const r = only([
      anita({ id: 1, task: "ship the report", dueDate: "2026-03-05", dueRaw: "by 2026-03-05" }),
      anita({ id: 2, task: "plan the demo", dueDate: "2026-03-10", dueRaw: "by 2026-03-10" }),
      anita({ id: 3, task: "tidy the wiki" }),
    ]);
    expect(r.output.drafts[0]!.body).toBe(
      [
        "Hi Anita,",
        "",
        "Here is where your action items stand as of 2026-03-10.",
        "",
        "Overdue (1)",
        "- [#1] Ship the report (due 2026-03-05, 5 days overdue). From: Planning sync, 2026-03-02",
        "",
        "Open (2)",
        "- [#2] Plan the demo (due 2026-03-10). From: Planning sync, 2026-03-02",
        "- [#3] Tidy the wiki (no due date). From: Planning sync, 2026-03-02",
        "",
        "Please reply when any of these are done, or let me know if a due date needs to change.",
        "",
        "Thanks,",
      ].join("\n"),
    );
  });
  it("FUP-21 a section with no items is omitted; 1 day overdue is singular", () => {
    const only1 = only([anita({ id: 1, dueDate: "2026-03-09", dueRaw: "by 2026-03-09" })]).output.drafts[0]!.body;
    expect(only1).toContain("(due 2026-03-09, 1 day overdue)");
    expect(only1).not.toContain("1 days");
    expect(only1).not.toContain("Open (");
    const noOverdue = only([anita({ id: 1 })]).output.drafts[0]!.body;
    expect(noOverdue).not.toContain("Overdue");
  });
  it("FUP-21 the sign-off carries no invented name", () => {
    const body = only([anita({ id: 1 })]).output.drafts[0]!.body;
    expect(body.endsWith("\nThanks,")).toBe(true);
  });
});

describe("FUP-22 ordering", () => {
  it("FUP-22 overdue: most days overdue first, then id", () => {
    const d = only([
      anita({ id: 9, dueDate: "2026-03-05" }),
      anita({ id: 5, dueDate: "2026-03-01" }),
      anita({ id: 2, dueDate: "2026-03-01" }),
    ]).output.drafts[0]!;
    expect(d.item_ids).toEqual([2, 5, 9]);
  });
  it("FUP-22 open: due date ascending, undated last, then id", () => {
    const d = only([
      anita({ id: 4, dueDate: "2026-03-12" }),
      anita({ id: 1 }),
      anita({ id: 8, dueDate: "2026-03-11" }),
      anita({ id: 3 }),
    ]).output.drafts[0]!;
    expect(d.item_ids).toEqual([8, 4, 1, 3]);
  });
  it("FUP-22 overdue items come before open ones in item_ids", () => {
    const d = only([anita({ id: 1 }), anita({ id: 2, dueDate: "2026-03-01" })]).output.drafts[0]!;
    expect(d.item_ids).toEqual([2, 1]);
  });
});

describe("FUP-23 unparsed due phrase", () => {
  it("FUP-23 shows the raw phrase in quotes and counts as open", () => {
    const d = only([anita({ id: 1, task: "rotate the keys", dueRaw: "before cutover" })]).output.drafts[0]!;
    expect(d.body).toContain('- [#1] Rotate the keys (due: "before cutover"). From: Planning sync, 2026-03-02');
    expect(d.counts).toEqual({ overdue: 0, open: 1 });
  });
});

describe("FUP-24 meeting title", () => {
  it("FUP-24 falls back to the file name without its extension", () => {
    const d = only([anita({ id: 1, sourceTitle: null })]).output.drafts[0]!;
    expect(d.body).toContain("From: 2026-03-02-planning, 2026-03-02");
  });
});

describe("FUP-30 / FUP-32 output object", () => {
  it("FUP-30 the output validates against the schema and `send` is false", () => {
    const r = only([anita({ id: 1 })], "Anita Desai", { "Anita Desai": "a@example.com" });
    expect(FollowupOutputSchema.safeParse(r.output).success).toBe(true);
    expect(r.output.as_of).toBe(AS_OF);
    expect(r.output.drafts.every((d) => d.send === false)).toBe(true);
  });
});
