/** `followup` through the CLI (spec 06) on the crafted dataset, as of 2026-03-10. */
import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FollowupOutputSchema } from "../src/schemas.js";
import { PEOPLE_JSON, Workspace, cleanupAll, cli, craftedWorkspace } from "./helpers.js";

const AS_OF = "2026-03-10";
let ws: Workspace;
beforeAll(async () => {
  ws = await craftedWorkspace();
  writeFileSync(ws.people, PEOPLE_JSON);
});
afterAll(cleanupAll);

const json = async (args: string[]) => {
  const r = await ws.followup([...args, "--json"], AS_OF);
  return { ...r, data: r.code === 0 ? JSON.parse(r.out) : null };
};

describe("FUP-01 exactly one of <owner> or --all", () => {
  it("FUP-01 neither is a usage error (exit 2)", async () => {
    const r = await ws.followup([]);
    expect(r.code).toBe(2);
    expect(r.err.length).toBeGreaterThan(0);
  });
  it("FUP-01 both is a usage error (exit 2)", async () => {
    const r = await ws.followup(["Anita", "--all"]);
    expect(r.code).toBe(2);
  });
});

describe("FUP-02 owner selection", () => {
  it("FUP-02 a unique first name or full name works, case-insensitively", async () => {
    expect((await json(["anita"])).data.drafts[0].owner).toBe("Anita Desai");
    expect((await json(["SAM OKAFOR"])).data.drafts[0].owner).toBe("Sam Okafor");
  });
  it("FUP-02 a shared first name exits 1 with the exact message", async () => {
    const r = await ws.followup(["Priya"]);
    expect(r.code).toBe(1);
    expect(r.err.trim()).toBe("Ambiguous owner 'Priya': Priya Nair, Priya Shah");
    expect(r.out).toBe("");
  });
  it("FUP-02 an unknown name exits 1 and lists the known owners", async () => {
    const r = await ws.followup(["Zed"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Anita Desai");
    expect(r.err).toContain("Sam Okafor");
  });
  it("FUP-02 a name that exists only as an ambiguous owner is unknown (Rahul)", async () => {
    const r = await ws.followup(["Rahul"]);
    expect(r.code).toBe(1);
  });
});

describe("FUP-03 to FUP-06 content of the drafts", () => {
  it("FUP-03 Sam's draft has the open and overdue items and not the done one (#5)", async () => {
    const { data } = await json(["Sam"]);
    expect(data.drafts).toHaveLength(1);
    expect([...data.drafts[0].item_ids].sort((a: number, b: number) => a - b)).toEqual([4, 6, 7]);
    expect(data.drafts[0].counts).toEqual({ overdue: 1, open: 2 });
  });
  it("FUP-04 excluded ambiguous, unowned and group items are counted, not silently dropped", async () => {
    const { data } = await json(["Sam"]);
    expect(data.excluded).toEqual({ ambiguous: 2, unowned: 1, group: 1 });
    for (const d of data.drafts) {
      for (const excludedId of [8, 9, 10, 11]) expect(d.item_ids).not.toContain(excludedId);
    }
  });
  it("FUP-05 a person with only done items gets no draft: message, exit 0", async () => {
    const r = await ws.followup(["Lena"]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toContain("No open or overdue items for Lena Fischer");
    const { data } = await json(["Lena"]);
    expect(data.drafts).toEqual([]);
  });
  it("FUP-06 --all gives one draft per person with open items, sorted by owner name", async () => {
    const { data } = await json(["--all"]);
    expect(data.drafts.map((d: any) => d.owner)).toEqual(["Anita Desai", "Priya Nair", "Priya Shah", "Sam Okafor"]);
  });
});

describe("FUP-10 to FUP-12 recipient", () => {
  it("FUP-10 people-file keys match case-insensitively ('anita desai' maps Anita Desai)", async () => {
    expect((await json(["Anita"])).data.drafts[0].to).toBe("anita@example.com");
  });
  it("FUP-11 an owner with no entry gets to=null and a warning, and the draft is still produced", async () => {
    const d = (await json(["Sam"])).data.drafts[0];
    expect(d.to).toBeNull();
    expect(d.warnings).toEqual(["no email address for Sam Okafor"]);
    expect(d.subject).toContain("Sam Okafor");
  });
  it("FUP-12 a missing people file is treated as empty, with a warning", async () => {
    const r = await cli(["followup", "Anita", "--json", "--db", ws.db, "--people", join(ws.root, "absent.json"), "--as-of", AS_OF]);
    expect(r.code).toBe(0);
    const data = JSON.parse(r.out);
    expect(data.drafts[0].to).toBeNull();
    expect(data.warnings.length).toBeGreaterThan(0);
  });
  it.each([
    ["invalid JSON", "{oops"],
    ["a JSON array", '["a@example.com"]'],
    ["a non-string value", '{"Anita Desai": 5}'],
  ])("FUP-12 %s is a config error: exit 2 with a message", async (_l, content) => {
    const bad = join(ws.root, "bad.json");
    writeFileSync(bad, content);
    const r = await cli(["followup", "Anita", "--db", ws.db, "--people", bad, "--as-of", AS_OF]);
    expect(r.code).toBe(2);
    expect(r.err.length).toBeGreaterThan(0);
    expect(r.out).toBe("");
  });
});

describe("FUP-20 / FUP-21 draft text for real items", () => {
  it("FUP-20 subject with both counts", async () => {
    expect((await json(["Anita"])).data.drafts[0].subject).toBe("Action items follow-up: Anita Desai (1 overdue, 2 open)");
    expect((await json(["Priya Nair"])).data.drafts[0].subject).toBe("Action items follow-up: Priya Nair (0 overdue, 1 open)");
  });
  it("FUP-21 / FUP-22 / FUP-23 Sam's body: singular day, undated and unparsed items, sorted", async () => {
    const d = (await json(["Sam"])).data.drafts[0];
    expect(d.body).toBe(
      [
        "Hi Sam,",
        "",
        "Here is where your action items stand as of 2026-03-10.",
        "",
        "Overdue (1)",
        "- [#7] Send the invoice (due 2026-03-09, 1 day overdue). From: Planning sync, 2026-03-02",
        "",
        "Open (2)",
        "- [#4] Tidy the wiki (no due date). From: Planning sync, 2026-03-02",
        '- [#6] Rotate the keys (due: "before cutover"). From: Planning sync, 2026-03-02',
        "",
        "Please reply when any of these are done, or let me know if a due date needs to change.",
        "",
        "Thanks,",
      ].join("\n"),
    );
    expect(d.item_ids).toEqual([7, 4, 6]);
  });
});

describe("FUP-30 / FUP-31 output", () => {
  it("FUP-30 --json prints one object that satisfies the schema; send is always false", async () => {
    const { data } = await json(["--all"]);
    expect(FollowupOutputSchema.safeParse(data).success).toBe(true);
    expect(data.as_of).toBe(AS_OF);
    expect(data.drafts.every((d: any) => d.send === false)).toBe(true);
    expect(Object.keys(data).sort()).toEqual(["as_of", "drafts", "excluded", "warnings"]);
  });
  it("FUP-31 without --json the same information is a readable preview", async () => {
    const r = await ws.followup(["Sam"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("To:");
    expect(r.out).toContain("Subject: Action items follow-up: Sam Okafor (1 overdue, 2 open)");
    expect(r.out).toContain("Hi Sam,");
    expect(r.out).toContain("no email address for Sam Okafor");
    expect(r.out).toMatch(/ambiguous\D*2/);
    expect(r.out).toMatch(/unowned\D*1/);
    expect(r.out).toMatch(/group\D*1/);
  });
});

describe("FUP-33 followup never changes item data", () => {
  it("FUP-33 the database content is identical before and after", async () => {
    const dump = () => {
      const db = new Database(ws.db, { readonly: true });
      try {
        return {
          items: db.prepare("select * from items order by id").all(),
          mentions: db.prepare("select * from mentions order by id").all(),
          notes: db.prepare("select * from notes order by path").all(),
        };
      } finally {
        db.close();
      }
    };
    const before = dump();
    await ws.followup(["--all"]);
    await ws.followup(["Sam", "--json"]);
    expect(dump()).toEqual(before);
  });
});
