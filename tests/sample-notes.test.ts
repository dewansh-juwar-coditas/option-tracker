/** Integration tests on the provided notes/notes folder (read-only; ingested into a temp database). */
import Database from "better-sqlite3";
import { readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { groupMentions, ownerKey } from "../src/dedup.js";
import { SAMPLE_NOTES, Workspace, cleanupAll, cli, type ListedItem } from "./helpers.js";

let ws: Workspace;
let report: any;
let items: ListedItem[];
const fileCountBefore = readdirSync(SAMPLE_NOTES).length;

beforeAll(async () => {
  ws = new Workspace();
  const r = await cli(["ingest", SAMPLE_NOTES, "--db", ws.db, "--json"]);
  expect(r.code).toBe(0);
  report = JSON.parse(r.out);
  // As of a date before every due date, so DUP-10 "open" (not done) is not displayed as overdue (LST-01).
  items = await ws.items("2026-08-31");
});
afterAll(cleanupAll);

interface MentionRow {
  source_file: string;
  line_no: number;
  task_text: string;
  due_raw: string | null;
  due_date: string | null;
  owner_kind: string;
  owner_name: string | null;
  owner_candidates: string | null;
  group_tag: string | null;
}
function mentionsOf(file: string, like = "%"): MentionRow[] {
  const db = new Database(ws.db, { readonly: true });
  try {
    return db
      .prepare("select * from mentions where source_file like ? and task_text like ? order by line_no")
      .all(`%${file}`, like) as MentionRow[];
  } finally {
    db.close();
  }
}
const candidates = (m: MentionRow): string[] => (m.owner_candidates ? JSON.parse(m.owner_candidates) : []);

function find(owner: string, task: RegExp, minMentions = 1): ListedItem {
  const hits = items.filter((i) => i.owner.name === owner && task.test(i.task) && i.history.length >= minMentions);
  expect(hits, `${owner} / ${task}`).toHaveLength(1);
  return hits[0]!;
}

describe("ING-30 to ING-35 the provided folder", () => {
  it("ING-30 32 ingested, 3 skipped, 1 ignored (35 .md files and 1 .txt)", () => {
    const names = readdirSync(SAMPLE_NOTES);
    expect(names.filter((n) => n.toLowerCase().endsWith(".md"))).toHaveLength(35);
    expect(names.filter((n) => n.toLowerCase().endsWith(".txt"))).toHaveLength(1);
    expect(report.notes).toEqual({ ingested: 32, unchanged: 0, skipped: 3, ignored: 1 });
  });

  it("ING-31 the skipped notes and their reasons", () => {
    const by = Object.fromEntries(report.skipped.map((s: any) => [s.file, s.reason]));
    expect(by).toEqual({
      "2026-09-09-notes-final-v2.md": "empty file",
      "scratch.md": "binary or not valid UTF-8 text",
      "untitled.md": "no usable meeting date",
    });
  });

  it("ING-32 warnings include the file-name date and the missing attendees", () => {
    expect(report.warnings).toContainEqual({ file: "2026-10-03-sales-pipeline.md", message: "date taken from file name" });
    expect(report.warnings).toContainEqual({ file: "2026-09-23-standup.md", message: "no attendees listed" });
  });

  it("ING-33 quoted, fenced, commented and .txt lines produce no item", () => {
    const text = items.map((i) => i.task).join("\n");
    expect(text).not.toMatch(/hardware tokens/i);
    expect(text).not.toMatch(/remediate finding/i);
    expect(text).not.toMatch(/venue/i);
    const refund = find("Karan Joshi", /refund affected customers/);
    expect(refund.history).toHaveLength(1); // DUP-54: the quoted duplicate never reached matching
    expect(refund.history[0]!.file).toBe("2026-09-21-incident-review.md");
  });

  it("ING-34 the * and + bullets, the nested item, the table row and the ACTION: line produce items", () => {
    expect(find("Lena Fischer", /customer survey/)).toMatchObject({ due_date: "2026-10-15" });
    expect(find("Sam Okafor", /on-call rotation/)).toMatchObject({ due_date: "2026-10-15" });
    expect(find("Karan Joshi", /validate targets against the budget/)).toMatchObject({ due_date: "2026-10-05" });
    expect(find("Anita Desai", /refresh the brand kit/i)).toMatchObject({ due_date: "2026-10-09" });
    expect(find("Karan Joshi", /circulate the offsite summary/)).toMatchObject({ due_date: "2026-10-01" });
  });

  it("ING-35 both standups with front matter are parsed, attendees from the inline list", () => {
    const db = new Database(ws.db, { readonly: true });
    const notes = db.prepare("select path from notes").all() as { path: string }[];
    db.close();
    const names = notes.map((n) => n.path.split(/[\\/]/).pop());
    expect(names).toContain("2026-09-16-standup.md");
    expect(names).toContain("2026-09-30-standup.md");
    const priya = mentionsOf("2026-09-30-standup.md", "%Q4 roadmap%")[0]!;
    expect(priya).toMatchObject({ owner_kind: "person", owner_name: "Priya Nair" }); // the only Priya in the inline list
  });

  it("the provided folder is never modified (read-only)", () => {
    expect(readdirSync(SAMPLE_NOTES)).toHaveLength(fileCountBefore);
  });

  it("ING-20 re-ingesting the provided folder changes nothing", async () => {
    const before = await ws.items("2026-12-31");
    const r = await cli(["ingest", SAMPLE_NOTES, "--db", ws.db, "--json"]);
    const rep = JSON.parse(r.out);
    expect(rep.notes).toMatchObject({ ingested: 0, unchanged: 32, skipped: 3 });
    expect(rep.items).toMatchObject({ created: 0, updated: 0, absorbed: 0, deleted: 0 });
    expect(await ws.items("2026-12-31")).toEqual(before);
  });
});

describe("OWN-20 to OWN-28 owner resolution on the provided notes", () => {
  it("OWN-20 qa-sync: bare Priya is Priya Shah, Rahul is Rahul Verma", () => {
    const ms = mentionsOf("2026-09-25-qa-sync.md");
    const names = ms.filter((m) => m.owner_kind === "person").map((m) => m.owner_name);
    expect(names).toContain("Priya Shah");
    expect(names).toContain("Rahul Verma");
    expect(ms.some((m) => m.owner_kind === "ambiguous")).toBe(false);
  });

  it("OWN-21 quote-portal-weekly 09-08: Priya N. is Priya Nair, bare Rahul is Rahul Mehta", () => {
    const ms = mentionsOf("2026-09-08-quote-portal-weekly.md");
    const names = ms.filter((m) => m.owner_kind === "person").map((m) => m.owner_name);
    expect(names).toContain("Priya Nair");
    expect(names).toContain("Rahul Mehta");
  });

  it("OWN-22 billing sync 09-17: bare Priya is ambiguous, Rahul is Rahul Verma", () => {
    const ms = mentionsOf("2026-09-17-billing-migration-sync.md");
    const priya = ms.find((m) => /sign off the cutover checklist/.test(m.task_text))!;
    expect(priya.owner_kind).toBe("ambiguous");
    expect(candidates(priya)).toEqual(["Priya Nair", "Priya Shah"]);
    expect(ms.filter((m) => m.owner_kind === "person").map((m) => m.owner_name)).toContain("Rahul Verma");
  });

  it("OWN-23 cutover planning: Priya S. is Priya Shah, Priya N. is Priya Nair", () => {
    const names = mentionsOf("2026-09-29-billing-cutover-planning.md")
      .filter((m) => m.owner_kind === "person")
      .map((m) => m.owner_name);
    expect(names).toContain("Priya Shah");
    expect(names).toContain("Priya Nair");
  });

  it("OWN-24 offsite: bare Priya and bare Rahul are ambiguous", () => {
    const ms = mentionsOf("2026-09-30-q4-offsite.md");
    expect(ms.find((m) => /own the hiring plan/.test(m.task_text))!.owner_kind).toBe("ambiguous");
    expect(ms.find((m) => /prepare the architecture overview/.test(m.task_text))!.owner_kind).toBe("ambiguous");
  });

  it("OWN-25 standup 10-07: `Rahul to review Anita's PR` is ambiguous", () => {
    const m = mentionsOf("2026-10-07-standup.md", "%review Anita%")[0]!;
    expect(m.owner_kind).toBe("ambiguous");
    expect(candidates(m)).toEqual(["Rahul Mehta", "Rahul Verma"]);
  });

  it("OWN-26 design review: @anita colon form, two owners, (with Priya), group and unowned", () => {
    const ms = mentionsOf("2026-09-18-design-review.md");
    const colour = ms.find((m) => /colour contrast/.test(m.task_text))!;
    expect(colour).toMatchObject({ owner_kind: "person", owner_name: "Anita Desai", due_date: "2026-09-21" });
    const api = ms.filter((m) => /component API/.test(m.task_text));
    expect(api.map((m) => m.owner_name).sort()).toEqual(["Anita Desai", "Rahul Mehta"]);
    const lena = ms.filter((m) => m.owner_name === "Lena Fischer");
    expect(lena).toHaveLength(1);
    expect(lena[0]!.task_text.endsWith("(with Priya)")).toBe(true);
    expect(ms.find((m) => /review the prototype/.test(m.task_text))).toMatchObject({ owner_kind: "group", group_tag: "everyone" });
    expect(ms.find((m) => /design-system changelog/.test(m.task_text))).toMatchObject({ owner_kind: "unowned", group_tag: null });
  });

  it("OWN-27 Someone is unowned; Team and Everyone are group with their tags", () => {
    expect(mentionsOf("2026-09-10-acme-renewal-prep.md", "%update the CRM notes%")[0]).toMatchObject({ owner_kind: "unowned" });
    expect(mentionsOf("2026-10-01-quote-portal-weekly.md", "%decide on the launch date%")[0]).toMatchObject({
      owner_kind: "group",
      group_tag: "team",
    });
    expect(mentionsOf("2026-09-30-q4-offsite.md", "%submit their Q4 goals%")[0]).toMatchObject({
      owner_kind: "group",
      group_tag: "everyone",
    });
  });

  it("OWN-28 standup 09-23 has no attendees: Sam resolves through the roster, Rahul is ambiguous (D22)", () => {
    const ms = mentionsOf("2026-09-23-standup.md");
    expect(ms.find((m) => /rotate the staging credentials/.test(m.task_text))).toMatchObject({ owner_kind: "person", owner_name: "Sam Okafor" });
    const rahul = ms.find((m) => /rebase the feature branch/.test(m.task_text))!;
    expect(rahul.owner_kind).toBe("ambiguous");
    expect(candidates(rahul)).toEqual(["Rahul Mehta", "Rahul Verma"]);
  });
});

describe("DUP-40 to DUP-48 must merge", () => {
  it("DUP-40 Acme revised quote: Priya Nair, done, due 2026-09-11, 3 mentions", () => {
    expect(find("Priya Nair", /revised quote/, 3)).toMatchObject({ status: "done", due_date: "2026-09-11" });
    expect(find("Priya Nair", /revised quote/, 3).history).toHaveLength(3);
  });
  it("DUP-41 quote-portal wireframes: open, due 2026-09-24, 3 mentions", () => {
    const i = find("Anita Desai", /wireframes/, 3);
    expect(i).toMatchObject({ status: "open", due_date: "2026-09-24" });
    expect(i.history).toHaveLength(3);
  });
  it("DUP-42 cloud budget: Sam Okafor, done, due 2026-09-18", () => {
    const i = find("Sam Okafor", /cloud budget/, 3);
    expect(i).toMatchObject({ status: "done", due_date: "2026-09-18" });
    expect(i.history).toHaveLength(3);
  });
  it("DUP-43 staging environment: Rahul Mehta, done, due 2026-09-08, 2 mentions", () => {
    const i = find("Rahul Mehta", /staging environment/, 2);
    expect(i).toMatchObject({ status: "done", due_date: "2026-09-08" });
    expect(i.history).toHaveLength(2);
  });
  it("DUP-44 freeze invoice edits: Karan Joshi, open, due 2026-10-09, 2 mentions", () => {
    const i = find("Karan Joshi", /freeze invoice edits/, 2);
    expect(i).toMatchObject({ status: "open", due_date: "2026-10-09" });
    expect(i.history).toHaveLength(2);
  });
  it("DUP-45 notify customers about the maintenance window: Priya Nair, done, 2 mentions", () => {
    const i = find("Priya Nair", /notify customers/, 2);
    expect(i.status).toBe("done");
    expect(i.history).toHaveLength(2);
  });
  it("DUP-46 renewal call with Acme's CTO: Meera Iyer, done, due 2026-09-30, 3 mentions", () => {
    const i = find("Meera Iyer", /renewal call/, 3);
    expect(i).toMatchObject({ status: "done", due_date: "2026-09-30" });
    expect(i.history).toHaveLength(3);
  });
  it("DUP-47 deploy the beta to staging: Rahul Mehta, done, due 2026-10-07, 3 mentions", () => {
    const i = find("Rahul Mehta", /deploy the beta/, 3);
    expect(i).toMatchObject({ status: "done", due_date: "2026-10-07" });
    expect(i.history).toHaveLength(3);
  });
  it("DUP-48 welcome-email copy: Anita Desai, done, 3 mentions", () => {
    const i = find("Anita Desai", /welcome-email copy/, 3);
    expect(i.status).toBe("done");
    expect(i.history).toHaveLength(3);
  });
});

describe("DUP-50 to DUP-55 must NOT merge", () => {
  const one = (owner: (o: ListedItem["owner"]) => boolean, task: RegExp) => {
    const hits = items.filter((i) => owner(i.owner) && task.test(i.task));
    expect(hits, String(task)).toHaveLength(1);
    return hits[0]!;
  };
  const named = (n: string) => (o: ListedItem["owner"]) => o.name === n;

  it("DUP-50 same words, different Rahuls", () => {
    const a = one(named("Rahul Mehta"), /fix the pagination bug/);
    const b = one(named("Rahul Verma"), /fix the top three critical bugs/);
    expect(a.id).not.toBe(b.id);
  });
  it("DUP-51 Meera's procurement contact and procurement form stay separate", () => {
    const a = one(named("Meera Iyer"), /procurement contact/);
    const b = one(named("Meera Iyer"), /procurement form/);
    expect(a.id).not.toBe(b.id);
  });
  it("DUP-52 Rahul Verma's schema-mapping review and the ambiguous 'review Anita's PR' stay separate", () => {
    const a = one(named("Rahul Verma"), /schema mapping doc/);
    const b = one((o) => o.kind === "ambiguous", /review Anita/);
    expect(a.id).not.toBe(b.id);
  });
  it("DUP-53 Priya Shah's test plan and her invoice-rounding tests stay separate", () => {
    const a = one(named("Priya Shah"), /draft the test plan for invoice rounding/);
    const b = one(named("Priya Shah"), /run the invoice rounding tests/);
    expect(a.id).not.toBe(b.id);
  });
  it("DUP-55 Karan's pricing sheet and Priya Nair's quote never merge (different owners)", () => {
    const a = one(named("Karan Joshi"), /revised pricing sheet/);
    const b = items.find((i) => i.owner.name === "Priya Nair" && /revised quote/.test(i.task))!;
    expect(a.id).not.toBe(b.id);
  });
  it("DUP-55 same owner at similarity exactly 0.50 does not merge either", () => {
    const sam = ownerKey({ kind: "person", name: "Sam Okafor", candidates: [], group: null });
    const g = groupMentions([
      { ownerKey: sam, task: "share the VPN guide" },
      { ownerKey: sam, task: "write the VPN guide" },
    ]);
    expect(g).toEqual([0, 1]);
  });
});

describe("DAT expected results on the provided notes (spec 03 table)", () => {
  type Row = [file: string, like: string, dueDate: string | null, dueRaw?: string];
  const rows: Row[] = [
    ["2026-09-01-quote-portal-kickoff.md", "%revised quote%", "2026-09-04"],
    ["2026-09-01-quote-portal-kickoff.md", "%first wireframes%", "2026-09-03"],
    ["2026-09-03-billing-migration-sync.md", "%test plan%", "2026-09-11"],
    ["2026-09-03-billing-migration-sync.md", "%export last quarter invoices%", "2026-09-10"],
    ["2026-09-14-onboarding-flow-design.md", "%customer quotes%", "2026-09-30"],
    ["2026-09-14-onboarding-flow-design.md", "%welcome%", "2026-09-16"],
    ["2026-09-21-incident-review.md", "%postmortem%", "2026-09-22"],
    ["2026-09-21-incident-review.md", "%idempotency%", "2026-09-25"],
    ["2026-09-30-q4-offsite.md", "%Q4 sales targets%", "2026-10-03"],
    ["2026-09-30-q4-offsite.md", "%customer survey%", "2026-10-15"],
    ["2026-09-30-q4-offsite.md", "%on-call rotation%", "2026-10-15"],
    ["2026-09-30-q4-offsite.md", "%circulate the offsite summary%", "2026-10-01"],
    ["2026-09-30-q4-offsite.md", "%brand kit%", "2026-10-09"],
    ["2026-09-29-billing-cutover-planning.md", "%schedule cutover%", "2026-10-10"],
    ["2026-10-05-onboarding-retro.md", "%SSO spike%", "2026-10-13"],
    ["2026-10-06-quote-portal-weekly.md", "%demo the portal%", "2026-10-14"],
    ["2026-10-10-sales-weekly.md", "%three new leads%", "2026-10-10"],
    ["2026-09-18-design-review.md", "%colour contrast%", "2026-09-21"],
    ["2026-09-18-design-review.md", "%review the prototype%", null, "before the next review"],
    ["2026-09-03-billing-migration-sync.md", "%snapshot%", null, "before cutover"],
  ];
  it.each(rows)("DAT %s %s", (file, like, dueDate, dueRaw) => {
    const ms = mentionsOf(file, like);
    expect(ms.length, `${file} ${like}`).toBeGreaterThan(0);
    for (const m of ms) {
      expect(m.due_date).toBe(dueDate);
      if (dueRaw) expect(m.due_raw).toBe(dueRaw);
    }
  });

  it("DAT-21 the unresolved phrases are listed in the ingest report as unparsed", () => {
    const phrases = report.unparsed_due.map((u: any) => u.phrase);
    expect(phrases).toContain("before the next review");
    expect(phrases).toContain("before cutover");
  });

  it("DAT-11 Meera's 'by Tuesday' in the Saturday 10-10 meeting is 2026-10-13", () => {
    const ms = mentionsOf("2026-10-10-sales-weekly.md").filter((m) => m.due_raw === "by Tuesday");
    expect(ms.length).toBeGreaterThan(0);
    for (const m of ms) expect(m.due_date).toBe("2026-10-13");
  });
});
