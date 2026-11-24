/** `list` and `done` (spec 05) against the crafted dataset in helpers.ts, as of 2026-03-10. */
import Database from "better-sqlite3";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ListOutputSchema } from "../src/schemas.js";
import { Workspace, cleanupAll, cli, craftedWorkspace, type ListedItem } from "./helpers.js";

const AS_OF = "2026-03-10";
let ws: Workspace;
beforeAll(async () => {
  ws = await craftedWorkspace();
});
afterAll(cleanupAll);

const ids = (items: ListedItem[]) => items.map((i) => i.id);
const list = (args: string[] = []) => ws.list(args, AS_OF);

describe("LST-01 status model on real data", () => {
  it("LST-01 overdue, open and done are classified against the as-of date", async () => {
    const all = await ws.items(AS_OF);
    const by = (id: number) => all.find((i) => i.id === id)!;
    expect(by(1)).toMatchObject({ status: "overdue", days_overdue: 5 });
    expect(by(7)).toMatchObject({ status: "overdue", days_overdue: 1 });
    expect(by(2)).toMatchObject({ status: "open", days_overdue: null }); // due exactly on the as-of date
    expect(by(5)).toMatchObject({ status: "done", days_overdue: null }); // done is never overdue
    expect(by(4).status).toBe("open");
  });
  it("LST-01 --as-of moves the line: a later date makes #2 overdue", async () => {
    const items = await ws.list(["--status", "overdue"], "2026-03-11");
    expect(ids(items)).toContain(2);
  });
});

describe("LST-02 status filter", () => {
  it("LST-02 no --status shows open and overdue, hides done", async () => {
    expect(ids(await list()).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13]);
  });
  it("LST-02 --status done shows only done items", async () => {
    expect(ids(await list(["--status", "done"]))).toEqual([5, 14]);
  });
  it("LST-02 / D27 --status open is open-not-overdue; --status overdue is overdue only", async () => {
    expect((await list(["--status", "open"])).map((i) => i.id).sort((a, b) => a - b)).toEqual([2, 3, 4, 6, 8, 9, 10, 11, 12, 13]);
    expect(ids(await list(["--status", "overdue"]))).toEqual([1, 7]);
  });
});

describe("LST-03 / LST-04 --owner (D24, D30)", () => {
  it("LST-03 full name and first name, case-insensitive", async () => {
    expect(ids(await list(["--owner", "anita desai"]))).toEqual([1, 2, 3]);
    expect(ids(await list(["--owner", "SAM"]))).toEqual([7, 4, 6]);
  });
  it("LST-03 a first name shared by two people is an error (exit 1) listing the candidates on stderr", async () => {
    const r = await cli(["list", "--db", ws.db, "--as-of", AS_OF, "--owner", "Priya"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Priya Nair");
    expect(r.err).toContain("Priya Shah");
    expect(r.out).toBe("");
  });
  it("LST-03 an unknown name is an error (exit 1) listing the known owners", async () => {
    const r = await cli(["list", "--db", ws.db, "--as-of", AS_OF, "--owner", "Zed"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Anita Desai");
    expect(r.err).toContain("Sam Okafor");
  });
  it("LST-04 ambiguous items never match --owner and a footer counts them", async () => {
    const r = await cli(["list", "--db", ws.db, "--as-of", AS_OF, "--owner", "Anita"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("2 ambiguous-owner item(s) not shown; run without --owner to see them");
  });
  it("LST-04 no footer when no ambiguous item was left out, and group and unowned items never match", async () => {
    const r = await cli(["list", "--db", ws.db, "--as-of", AS_OF, "--owner", "Anita", "--status", "done"]);
    expect(r.out).not.toContain("ambiguous-owner");
    const json = await list(["--owner", "Sam"]);
    expect(json.every((i) => i.owner.kind === "person")).toBe(true);
  });
});

describe("LST-05 / LST-06 / LST-07 filters and order", () => {
  it("LST-05 --due-before is strictly before and excludes undated items", async () => {
    expect(ids(await list(["--due-before", "2026-03-10"]))).toEqual([1, 7]);
  });
  it("LST-05 --due-before accepts the note date forms", async () => {
    expect(ids(await list(["--due-before", "10 March 2026"]))).toEqual([1, 7]);
    expect(ids(await list(["--due-before", "March 10, 2026"]))).toEqual([1, 7]);
  });
  it("LST-06 filters combine with AND", async () => {
    expect(ids(await list(["--owner", "Anita", "--due-before", "2026-03-15", "--status", "open"]))).toEqual([2]);
  });
  it("LST-07 sorted by due date ascending with undated last, then id", async () => {
    expect(ids(await list())).toEqual([1, 7, 2, 12, 13, 3, 4, 6, 8, 9, 10, 11]);
  });
});

describe("LST-08 / LST-09 table output", () => {
  it("LST-08 columns, status labels, owner labels and due labels", async () => {
    const r = await cli(["list", "--db", ws.db, "--as-of", AS_OF]);
    expect(r.code).toBe(0);
    const lines = r.out.trimEnd().split("\n");
    expect(lines[0]!.split(/\s{2,}/)).toEqual(["ID", "STATUS", "OWNER", "DUE", "TASK", "SOURCE"]);
    expect(r.out).toContain("OVERDUE (5d)");
    expect(r.out).toContain("ambiguous: Priya Nair | Priya Shah");
    expect(r.out).toContain("ambiguous: Rahul Mehta | Rahul Verma");
    expect(r.out).toContain("(unowned)");
    expect(r.out).toContain("(everyone)");
    expect(r.out).toContain("[before cutover]");
    expect(r.out).toContain("2026-03-02-planning.md");
    expect(lines[lines.length - 1]).toBe("12 item(s)");
  });
  it("LST-08 done items show DONE", async () => {
    const r = await cli(["list", "--db", ws.db, "--as-of", AS_OF, "--status", "done"]);
    expect(r.out).toContain("DONE");
    expect(r.out).not.toContain("OVERDUE");
  });
  it("LST-09 no matches prints `No items match.` and exits 0", async () => {
    const r = await cli(["list", "--db", ws.db, "--as-of", AS_OF, "--due-before", "2000-01-01"]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("No items match.");
  });
});

describe("LST-10 --json", () => {
  it("LST-10 prints a JSON array that satisfies the schema, with history and owner kinds", async () => {
    const all = await ws.items(AS_OF);
    expect(ListOutputSchema.safeParse(all).success).toBe(true);
    expect(all.find((i) => i.id === 8)!.owner).toEqual({
      kind: "ambiguous",
      name: null,
      candidates: ["Rahul Mehta", "Rahul Verma"],
      group: null,
    });
    expect(all.find((i) => i.id === 10)!.owner).toEqual({ kind: "group", name: null, candidates: [], group: "everyone" });
    expect(all.find((i) => i.id === 11)!.owner).toEqual({ kind: "unowned", name: null, candidates: [], group: null });
    expect(all.find((i) => i.id === 1)!.history).toEqual([{ file: "2026-03-02-planning.md", line: 5, meeting_date: "2026-03-02", checked: false }]);
    expect(all.find((i) => i.id === 6)).toMatchObject({ due_date: null, due_raw: "before cutover" });
  });
  it("OWN-05a every owner kind in the data is one of the four", async () => {
    const kinds = new Set((await ws.items(AS_OF)).map((i) => i.owner.kind));
    for (const k of kinds) expect(["person", "ambiguous", "unowned", "group"]).toContain(k);
  });
  it("OWN-08 group and unowned items appear in list but never match --owner", async () => {
    const all = await list();
    expect(all.some((i) => i.owner.kind === "group")).toBe(true);
    expect(all.some((i) => i.owner.kind === "unowned")).toBe(true);
    for (const name of ["Anita", "Sam", "Lena", "Priya Nair"]) {
      const some = await list(["--owner", name, "--status", "open"]);
      expect(some.every((i) => i.owner.kind === "person")).toBe(true);
    }
  });
});

describe("LST-11 / LST-12 / G-05 errors", () => {
  it.each([
    [["--status", "bogus"]],
    [["--due-before", "not a date"]],
    [["--as-of", "2026-13-45"]],
  ])("LST-11 invalid option %j is a usage error (exit 2), message on stderr", async (extra) => {
    const r = await cli(["list", "--db", ws.db, ...(extra as string[])]);
    expect(r.code).toBe(2);
    expect(r.err.length).toBeGreaterThan(0);
    expect(r.out).toBe("");
  });
  it("LST-12 a missing database gives the 'No data yet' message and exit 1", async () => {
    const tmp = new Workspace();
    const r = await cli(["list", "--db", tmp.db]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("No data yet. Run: actiontrack ingest <folder>");
  });
});

// ---------------------------------------------------------------------- done

describe("done (DNE-01 to DNE-06)", () => {
  afterEach(cleanupAll);
  const fresh = () => craftedWorkspace();

  it("DNE-01 marks the item done and prints the message; mentions are not modified", async () => {
    const w = await fresh();
    const db = new Database(w.db, { readonly: true });
    const before = db.prepare("select * from mentions order by id").all();
    db.close();
    const r = await cli(["done", "1", "--db", w.db]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("Item 1 marked done: Anita Desai - ship the report");
    const db2 = new Database(w.db, { readonly: true });
    const after = db2.prepare("select * from mentions order by id").all();
    db2.close();
    expect(after).toEqual(before);
  });

  it("DNE-02 marking an already-done item is a no-op that exits 0", async () => {
    const w = await fresh();
    const r = await cli(["done", "5", "--db", w.db]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("Item 5 is already done");
    const again = await cli(["done", "1", "--db", w.db]);
    const twice = await cli(["done", "1", "--db", w.db]);
    expect(again.code).toBe(0);
    expect(twice.out.trim()).toBe("Item 1 is already done");
  });

  it("DNE-03 an unknown id prints `No item with id <id>` to stderr and exits 1", async () => {
    const w = await fresh();
    const r = await cli(["done", "99", "--db", w.db]);
    expect(r.code).toBe(1);
    expect(r.err.trim()).toBe("No item with id 99");
    expect(r.out).toBe("");
  });

  it.each(["abc", "1.5", "-", ""])("DNE-04 a non-integer id '%s' is a usage error (exit 2)", async (bad) => {
    const w = await fresh();
    const r = await cli(["done", bad, "--db", w.db]);
    expect(r.code).toBe(2);
  });

  it("DNE-05 the change is saved at once, survives later commands and a re-ingest", async () => {
    const w = await fresh();
    await cli(["done", "1", "--db", w.db]);
    expect((await w.list(["--status", "done"], AS_OF)).map((i) => i.id)).toContain(1);
    await w.ingest();
    expect((await w.list(["--status", "done"], AS_OF)).map((i) => i.id)).toContain(1);
    expect((await w.items(AS_OF)).find((i) => i.id === 1)!.status).toBe("done");
  });

  it("DNE-06 a manually done item leaves the default list and follow-ups", async () => {
    const w = await fresh();
    await cli(["done", "4", "--db", w.db]);
    expect((await w.list([], AS_OF)).map((i) => i.id)).not.toContain(4);
    const people = join(w.root, "none.json");
    const f = await cli(["followup", "Sam", "--json", "--db", w.db, "--people", people, "--as-of", AS_OF]);
    expect(f.code).toBe(0);
    expect(JSON.parse(f.out).drafts[0].item_ids).not.toContain(4);
  });

  it("LST-12 done on a missing database also reports `No data yet` (exit 1)", async () => {
    const w = new Workspace();
    const r = await cli(["done", "1", "--db", w.db]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("No data yet");
  });
});
