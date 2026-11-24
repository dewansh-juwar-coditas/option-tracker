/** Status model and list rendering (LST-01, LST-08, LST-10). Pure functions in report.ts. */
import { describe, expect, it } from "vitest";
import { mkItem, person } from "./factories.js";
import { classify, formatListTable, itemToJson, ownerLabel } from "../src/report.js";

describe("LST-01 status model", () => {
  const asOf = "2026-03-10";
  it("LST-01 open with a due date before the as-of date is overdue, with the day count", () => {
    expect(classify({ status: "open", dueDate: "2026-03-05" }, asOf)).toEqual({ status: "overdue", daysOverdue: 5 });
    expect(classify({ status: "open", dueDate: "2026-03-09" }, asOf)).toEqual({ status: "overdue", daysOverdue: 1 });
  });
  it("LST-01 due exactly on the as-of date is not overdue", () => {
    expect(classify({ status: "open", dueDate: "2026-03-10" }, asOf)).toEqual({ status: "open", daysOverdue: null });
  });
  it("LST-01 no due date, or a future date, is open", () => {
    expect(classify({ status: "open", dueDate: null }, asOf).status).toBe("open");
    expect(classify({ status: "open", dueDate: "2026-04-01" }, asOf).status).toBe("open");
  });
  it("LST-01 done is never overdue", () => {
    expect(classify({ status: "done", dueDate: "2026-01-01" }, asOf)).toEqual({ status: "done", daysOverdue: null });
  });
});

describe("LST-08 owner and due labels", () => {
  it("LST-08 owner column forms", () => {
    expect(ownerLabel(person("Anita Desai"))).toBe("Anita Desai");
    expect(ownerLabel({ kind: "ambiguous", name: null, candidates: ["Priya Nair", "Priya Shah"], group: null })).toBe(
      "ambiguous: Priya Nair | Priya Shah",
    );
    expect(ownerLabel({ kind: "unowned", name: null, candidates: [], group: null })).toBe("(unowned)");
    expect(ownerLabel({ kind: "group", name: null, candidates: [], group: "everyone" })).toBe("(everyone)");
    expect(ownerLabel({ kind: "group", name: null, candidates: [], group: "team" })).toBe("(team)");
  });
});

describe("LST-08 table", () => {
  const items = [
    mkItem({ id: 1, dueDate: "2026-03-05", dueRaw: "by 2026-03-05" }),
    mkItem({ id: 2, task: "plan the demo", dueDate: "2026-03-20", dueRaw: "by 2026-03-20" }),
    mkItem({ id: 3, task: "rotate the keys", dueRaw: "before cutover" }),
    mkItem({ id: 4, task: "tidy the wiki" }),
    mkItem({ id: 5, task: "publish", status: "done", dueDate: "2026-03-04", dueRaw: "by 2026-03-04" }),
  ];
  const table = formatListTable(items, "2026-03-10");
  const rows = table.split("\n");

  it("LST-08 header has the six columns in order", () => {
    expect(rows[0]!.split(/\s{2,}/)).toEqual(["ID", "STATUS", "OWNER", "DUE", "TASK", "SOURCE"]);
  });
  it("LST-08 STATUS shows OPEN, DONE or OVERDUE (Nd)", () => {
    expect(table).toContain("OVERDUE (5d)");
    expect(table).toContain("OPEN");
    expect(table).toContain("DONE");
  });
  it("LST-08 DUE shows the date, the raw phrase in brackets when unparsed, or a dash", () => {
    const byId = (id: number) => rows.find((r) => r.trimStart().startsWith(`${id} `))!;
    expect(byId(1)).toContain("2026-03-05");
    expect(byId(3)).toContain("[before cutover]");
    expect(byId(4).split(/\s{2,}/)[3]).toBe("-");
  });
  it("LST-08 SOURCE is the latest note's file name and the footer gives the count", () => {
    expect(rows[1]).toContain("2026-03-02-planning.md");
    expect(rows[rows.length - 1]).toBe("5 item(s)");
  });
  it("LST-08 extra footer lines go between the table and nothing else is added", () => {
    const t = formatListTable(items.slice(0, 1), "2026-03-10", ["2 ambiguous-owner item(s) not shown; run without --owner to see them"]);
    const r = t.split("\n");
    expect(r[r.length - 2]).toBe("1 item(s)");
    expect(r[r.length - 1]).toBe("2 ambiguous-owner item(s) not shown; run without --owner to see them");
  });
});

describe("LST-10 item JSON", () => {
  it("LST-10 maps an item to the documented snake_case shape", () => {
    const j = itemToJson(
      mkItem({
        id: 7,
        dueDate: "2026-03-05",
        dueRaw: "by 2026-03-05",
        history: [
          { file: "a.md", line: 1, meetingDate: "2026-02-01", checked: false },
          { file: "b.md", line: 4, meetingDate: "2026-03-02", checked: false },
        ],
      }),
      "2026-03-10",
    );
    expect(j).toEqual({
      id: 7,
      status: "overdue",
      days_overdue: 5,
      owner: { kind: "person", name: "Anita Desai", candidates: [], group: null },
      task: "ship the report",
      due_date: "2026-03-05",
      due_raw: "by 2026-03-05",
      source_file: "2026-03-02-planning.md",
      meeting_date: "2026-03-02",
      source_title: "Planning sync",
      history: [
        { file: "a.md", line: 1, meeting_date: "2026-02-01", checked: false },
        { file: "b.md", line: 4, meeting_date: "2026-03-02", checked: false },
      ],
    });
  });
  it("OWN-07a group owners carry the tag, unowned owners carry null", () => {
    const g = itemToJson(mkItem({ id: 1, owner: { kind: "group", name: null, candidates: [], group: "team" } }), "2026-03-10");
    expect(g.owner).toEqual({ kind: "group", name: null, candidates: [], group: "team" });
    const u = itemToJson(mkItem({ id: 2, owner: { kind: "unowned", name: null, candidates: [], group: null } }), "2026-03-10");
    expect(u.owner.group).toBeNull();
  });
});
