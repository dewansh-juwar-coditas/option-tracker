/** Ingest pipeline on crafted fixtures: specs 01 (re-ingest, D34), 02, 03 (DAT-30/31), 04 (D33) and G-rules. */
import Database from "better-sqlite3";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ingestFolder, openDb } from "../src/db.js";
import { parseNote } from "../src/parser.js";
import { IngestReportSchema } from "../src/schemas.js";
import { Workspace, cleanupAll, cli, noteText, type ListedItem } from "./helpers.js";

afterEach(cleanupAll);

const ATT = ["Priya Nair", "Anita Desai", "Sam Okafor", "Rahul Mehta", "Karan Joshi"];
const note = (date: string, body: string[], o: { attendees?: string[]; title?: string } = {}) =>
  noteText({ date, attendees: o.attendees ?? ATT, body, ...(o.title ? { title: o.title } : {}) });

function peek<T = Record<string, any>>(ws: Workspace, sql: string, ...params: unknown[]): T[] {
  const db = new Database(ws.db, { readonly: true });
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

const tasks = (items: ListedItem[]) => items.map((i) => i.task).sort();
const QUOTE = "- [ ] Priya Nair to send the quote by Friday";

// ------------------------------------------------------------------ spec 01: scan and report

describe("ING-01 / ING-02 / ING-03 folder scan", () => {
  it("ING-01 only .md files directly in the folder are read; other files are ignored, sub-folders are not entered", async () => {
    const ws = new Workspace();
    ws.write("a.md", note("2026-01-05", ["- [ ] Anita to do alpha work"]));
    ws.write("B.MD", note("2026-01-06", ["- [ ] Sam to do beta work"]));
    ws.write("c.txt", note("2026-01-07", ["- [ ] Karan to do gamma work"]));
    mkdirSync(join(ws.notesDir, "sub"));
    writeFileSync(join(ws.notesDir, "sub", "d.md"), note("2026-01-08", ["- [ ] Rahul to do delta work"]));
    const rep = await ws.ingest();
    expect(rep.notes).toMatchObject({ ingested: 2, skipped: 0, ignored: 1 });
    expect(tasks(await ws.items())).toEqual(["do alpha work", "do beta work"]);
  });

  it("ING-02 a missing folder is a usage error: exit 2, message on stderr, no database created", async () => {
    const ws = new Workspace();
    const r = await cli(["ingest", join(ws.root, "nope"), "--db", ws.db]);
    expect(r.code).toBe(2);
    expect(r.err.length).toBeGreaterThan(0);
    expect(r.out).toBe("");
    expect(existsSync(ws.db)).toBe(false);
  });

  it("ING-02 a path that is a file, not a folder, is a usage error too", async () => {
    const ws = new Workspace();
    ws.write("a.md", note("2026-01-05", ["- [ ] Anita to do alpha work"]));
    const r = await cli(["ingest", join(ws.notesDir, "a.md"), "--db", ws.db]);
    expect(r.code).toBe(2);
    expect(existsSync(ws.db)).toBe(false);
  });

  it("ING-03 the result follows meeting dates, not file-name order", async () => {
    const ws = new Workspace();
    ws.write("a-late.md", note("2026-01-12", ["- [x] Anita to prepare the board pack"]));
    ws.write("z-early.md", note("2026-01-05", ["- [ ] Anita to prepare the board pack"]));
    await ws.ingest();
    const items = await ws.items();
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe("done");
    expect(items[0]!.history.map((h) => h.file)).toEqual(["z-early.md", "a-late.md"]);
    expect(items[0]!.source_file).toBe("a-late.md");
  });
});

describe("ING-12 an unexpected parse exception skips only that file", () => {
  it("ING-12 the report says `parse error: <message>` and the next file is still processed", async () => {
    const ws = new Workspace();
    ws.write("boom.md", note("2026-01-05", ["- [ ] Anita to do alpha work"]));
    ws.write("fine.md", note("2026-01-06", ["- [ ] Sam to do beta work"]));
    const db = openDb(ws.db);
    try {
      const rep = ingestFolder(db, ws.notesDir, {
        parse: (buf: Buffer, name: string) => {
          if (name === "boom.md") throw new Error("kaboom");
          return parseNote(buf, name);
        },
      });
      expect(rep.skipped).toContainEqual({ file: "boom.md", reason: "parse error: kaboom" });
      expect(rep.notes.ingested).toBe(1);
    } finally {
      db.close();
    }
    expect(tasks(await ws.items())).toEqual(["do beta work"]);
  });
});

describe("ING-13 / ING-19 / ING-25 basics", () => {
  it("ING-13 a valid note with no action lines is ingested with 0 items and a warning", async () => {
    const ws = new Workspace();
    ws.write("quiet.md", note("2026-01-05", ["Just a chat today."]));
    const rep = await ws.ingest();
    expect(rep.notes.ingested).toBe(1);
    expect(rep.warnings).toContainEqual({ file: "quiet.md", message: "no action items found" });
    expect(await ws.items()).toEqual([]);
  });

  it("ING-19 an action line is split into owner, task and due_raw", async () => {
    const ws = new Workspace();
    ws.write("a.md", note("2026-09-01", ["- [ ] Priya Nair to send the quote to Acme by Friday."]));
    await ws.ingest();
    const [item] = await ws.items();
    expect(item).toMatchObject({
      owner: { kind: "person", name: "Priya Nair" },
      task: "send the quote to Acme",
      due_raw: "by Friday",
      due_date: "2026-09-04",
    });
  });
});

describe("ING-23 to ING-28 ingest report", () => {
  async function scenario() {
    const ws = new Workspace();
    const att = ["Priya Nair", "Priya Shah", "Anita Desai"];
    ws.write(
      "good.md",
      note(
        "2026-02-02",
        [
          "- [ ] Priya to sign off the checklist",
          "- [ ] Anita to ship it before cutover",
          "- [ ] Anita to ship the alpha build by Friday",
        ],
        { attendees: att },
      ),
    );
    ws.write("repeat.md", note("2026-02-09", ["- [ ] Anita to ship the alpha build by Friday"], { attendees: att }));
    ws.write("empty.md", "");
    ws.write("noatt.md", "# Meeting: No list\nDate: 2026-02-10\n\n- [ ] Anita to polish the logo\n");
    ws.write("notes.txt", "ignored");
    return ws;
  }

  it("ING-23 counts of notes and items", async () => {
    const ws = await scenario();
    const rep = await ws.ingest();
    expect(IngestReportSchema.safeParse(rep).success).toBe(true);
    expect(rep.notes).toEqual({ ingested: 3, unchanged: 0, skipped: 1, ignored: 1 });
    expect(rep.items).toEqual({ created: 4, updated: 0, unchanged: 0, absorbed: 0, deleted: 0 });
    const text = (await cli(["ingest", ws.notesDir, "--db", join(ws.root, "second.db")])).out;
    expect(text).toContain("Notes: 3 ingested, 0 unchanged, 1 skipped, 1 ignored");
    expect(text).toContain("Items: 4 created, 0 updated, 0 unchanged, 0 absorbed, 0 deleted");
  });

  it("ING-24 skipped notes are listed with reasons", async () => {
    const ws = await scenario();
    const rep = await ws.ingest();
    expect(rep.skipped).toEqual([{ file: "empty.md", reason: "empty file" }]);
    const text = (await cli(["ingest", ws.notesDir, "--db", join(ws.root, "second.db")])).out;
    expect(text).toContain("empty.md: empty file");
  });

  it("ING-25 warnings are listed", async () => {
    const ws = await scenario();
    const rep = await ws.ingest();
    expect(rep.warnings).toContainEqual({ file: "noatt.md", message: "no attendees listed" });
    const text = (await cli(["ingest", ws.notesDir, "--db", join(ws.root, "second.db")])).out;
    expect(text).toContain("noatt.md: no attendees listed");
  });

  it("ING-26 ambiguous-owner items and unresolved due phrases are listed", async () => {
    const ws = await scenario();
    const rep = await ws.ingest();
    expect(rep.ambiguous).toContainEqual(
      expect.objectContaining({ file: "good.md", line: 5, candidates: ["Priya Nair", "Priya Shah"] }),
    );
    expect(rep.unparsed_due).toContainEqual({ file: "good.md", line: 6, phrase: "before cutover" });
    const text = (await cli(["ingest", ws.notesDir, "--db", join(ws.root, "second.db")])).out;
    expect(text).toContain("good.md:5");
    expect(text).toContain("Priya Nair | Priya Shah");
    expect(text).toContain("before cutover");
  });

  it("ING-27 / DUP-30 every item with several mentions is listed with file:line of each mention", async () => {
    const ws = await scenario();
    const rep = await ws.ingest();
    expect(rep.merges).toHaveLength(1);
    expect(rep.merges[0]).toMatchObject({
      owner: "Anita Desai",
      task: "ship the alpha build",
      mentions: [
        { file: "good.md", line: 7 },
        { file: "repeat.md", line: 5 },
      ],
    });
    const text = (await cli(["ingest", ws.notesDir, "--db", join(ws.root, "second.db")])).out;
    expect(text).toContain("good.md:7");
    expect(text).toContain("repeat.md:5");
  });

  it("ING-28 / G-02 the exit code is 0 even though a note was skipped", async () => {
    const ws = await scenario();
    const r = await ws.ingestText();
    expect(r.code).toBe(0);
  });
});

// ------------------------------------------------------------------ spec 01: re-ingest

describe("ING-20 / DUP-22 re-ingesting unchanged notes changes nothing", () => {
  it("ING-20 notes are reported unchanged and every item, id, state and manual_done_after is identical", async () => {
    const ws = new Workspace();
    ws.write("n1.md", note("2026-01-05", [QUOTE, "- [ ] Sam to rotate the keys"]));
    ws.write("n2.md", note("2026-01-12", [QUOTE]));
    await ws.ingest();
    expect((await cli(["done", "2", "--db", ws.db])).code).toBe(0);
    const before = { items: await ws.items(), raw: peek(ws, "select * from items order by id"), men: peek(ws, "select * from mentions order by id") };
    const rep = await ws.ingest();
    expect(rep.notes).toMatchObject({ ingested: 0, unchanged: 2 });
    expect(rep.items).toEqual({ created: 0, updated: 0, unchanged: 2, absorbed: 0, deleted: 0 });
    const after = { items: await ws.items(), raw: peek(ws, "select * from items order by id"), men: peek(ws, "select * from mentions order by id") };
    expect(after.items).toEqual(before.items);
    expect(after.raw).toEqual(before.raw);
    expect(after.men.map(({ id: _i, ...m }) => m)).toEqual(before.men.map(({ id: _i, ...m }) => m));
  });
});

describe("ING-21 / ING-22 / ING-22a changed files", () => {
  it("ING-21 an edited mention keeps the item id while another mention still matches", async () => {
    const ws = new Workspace();
    ws.write("n1.md", note("2026-01-05", [QUOTE]));
    ws.write("n2.md", note("2026-01-12", [QUOTE]));
    await ws.ingest();
    ws.write("n2.md", note("2026-01-12", ["- [ ] Priya Nair to send the quote to Acme by Friday"]));
    const rep = await ws.ingest();
    expect(rep.notes.ingested).toBe(1);
    expect(rep.notes.unchanged).toBe(1);
    const items = await ws.items();
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe(1);
    expect(items[0]!.task).toBe("send the quote to Acme");
    expect(items[0]!.history).toHaveLength(2);
  });

  it("DUP-25 an edited mention that is a group's only mention has no previous id, so the item gets a new id", async () => {
    const ws = new Workspace();
    ws.write("n1.md", note("2026-01-05", [QUOTE]));
    await ws.ingest();
    ws.write("n1.md", note("2026-01-05", ["- [ ] Priya Nair to send the quote to Acme by Friday"]));
    const rep = await ws.ingest();
    const items = await ws.items();
    expect(items.map((i) => i.id)).toEqual([2]);
    expect(rep.deleted_ids).toEqual([1]);
  });

  it("ING-22 an item left with no mentions after a replace is deleted and its id is never reused", async () => {
    const ws = new Workspace();
    ws.write("n3.md", note("2026-01-05", ["- [ ] Sam to rotate the keys"]));
    await ws.ingest();
    ws.write("n3.md", note("2026-01-05", ["- [ ] Sam to patch the servers"]));
    const rep = await ws.ingest();
    expect(rep.items.deleted).toBe(1);
    const items = await ws.items();
    expect(items.map((i) => [i.id, i.task])).toEqual([[2, "patch the servers"]]);
  });

  it("ING-22a a file is in exactly one of notes and skipped_notes at a time", async () => {
    const ws = new Workspace();
    ws.write("n1.md", note("2026-01-05", [QUOTE]));
    await ws.ingest();
    const states = () => ({
      notes: peek<{ path: string }>(ws, "select path from notes").map((r) => r.path.split(/[\\/]/).pop()),
      skipped: peek<{ path: string }>(ws, "select path from skipped_notes").map((r) => r.path.split(/[\\/]/).pop()),
    });
    expect(states()).toEqual({ notes: ["n1.md"], skipped: [] });
    ws.write("n1.md", "");
    await ws.ingest();
    expect(states()).toEqual({ notes: [], skipped: ["n1.md"] });
    ws.write("n1.md", note("2026-01-05", [QUOTE]));
    await ws.ingest();
    expect(states()).toEqual({ notes: ["n1.md"], skipped: [] });
  });
});

describe("D34 a previously ingested note becomes malformed (ING-36 to ING-46)", () => {
  async function twoNotes() {
    const ws = new Workspace();
    ws.write("n1.md", note("2026-01-05", [QUOTE], { attendees: [...ATT, "Zed Unique"] }));
    ws.write("n2.md", note("2026-01-12", [QUOTE]));
    await ws.ingest();
    return ws;
  }

  it("ING-42 / ING-36 / ING-37 / ING-40 emptying N1 removes its mention; the item re-derives from N2 and keeps its id", async () => {
    const ws = await twoNotes();
    expect((await ws.items())[0]!.history).toHaveLength(2);
    ws.write("n1.md", "");
    const rep = await ws.ingest();
    expect(rep.skipped).toContainEqual({ file: "n1.md", reason: "empty file" });
    expect(rep.previously_ingested).toEqual([
      { file: "n1.md", removed_mentions: 1, deleted_items: [], rederived_items: [1] },
    ]);
    const items = await ws.items();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 1, source_file: "n2.md", meeting_date: "2026-01-12" });
    expect(items[0]!.history.map((h) => h.file)).toEqual(["n2.md"]);
    expect(peek(ws, "select count(*) as c from mentions where source_file like '%n1.md'")[0]!.c).toBe(0);
  });

  it("ING-40 the text report names the file under skipped plus the previously-ingested line; exit code stays 0", async () => {
    const ws = await twoNotes();
    ws.write("n1.md", "");
    const r = await ws.ingestText();
    expect(r.code).toBe(0);
    expect(r.out).toContain("n1.md: empty file");
    expect(r.out).toContain("previously ingested: removed 1 mention(s), deleted items none, re-derived items #1");
  });

  it("ING-38 the roster is rebuilt from the remaining ingested notes only", async () => {
    const ws = await twoNotes();
    const names = () => peek<{ name: string }>(ws, "select name from people").map((r) => r.name);
    expect(names()).toContain("Zed Unique");
    ws.write("n1.md", "");
    await ws.ingest();
    expect(names()).not.toContain("Zed Unique");
    expect(names()).toContain("Priya Nair");
  });

  it("ING-43 / DUP-61 binary content deletes the only-source item; its id is not reused by the next new item", async () => {
    const ws = new Workspace();
    ws.write("n1.md", note("2026-01-05", [QUOTE]));
    ws.write("n3.md", note("2026-01-06", ["- [ ] Sam to rotate the keys"]));
    await ws.ingest();
    expect((await ws.items()).map((i) => i.id)).toEqual([1, 2]);
    ws.write("n3.md", Buffer.from([0, 1, 2, 255, 254]));
    const rep = await ws.ingest();
    expect(rep.skipped).toContainEqual({ file: "n3.md", reason: "binary or not valid UTF-8 text" });
    expect(rep.previously_ingested[0]).toMatchObject({ file: "n3.md", removed_mentions: 1, deleted_items: [2] });
    expect((await ws.list()).map((i) => i.task)).toEqual(["send the quote"]);
    ws.write("n4.md", note("2026-01-07", ["- [ ] Karan to book the venue"]));
    await ws.ingest();
    const ids = (await ws.items()).map((i) => i.id);
    expect(ids).toEqual([1, 3]);
  });

  it("ING-44 no usable date and no file-name date: skipped, mentions removed", async () => {
    const ws = new Workspace();
    ws.write("n3.md", note("2026-01-06", ["- [ ] Sam to rotate the keys"]));
    await ws.ingest();
    ws.write("n3.md", "# Meeting: Sync\nDate: sometime last week\nAttendees: Sam Okafor\n\n- [ ] Sam to rotate the keys\n");
    const rep = await ws.ingest();
    expect(rep.skipped).toContainEqual({ file: "n3.md", reason: "no usable meeting date" });
    expect(await ws.items()).toEqual([]);
  });

  it("ING-44 with a YYYY-MM-DD file-name prefix the note is not malformed (ING-07 fallback)", async () => {
    const ws = new Workspace();
    ws.write("2026-01-06-n3.md", note("2026-01-06", ["- [ ] Sam to rotate the keys"]));
    await ws.ingest();
    ws.write("2026-01-06-n3.md", "# Meeting: Sync\nDate: sometime last week\nAttendees: Sam Okafor\n\n- [ ] Sam to rotate the keys\n");
    const rep = await ws.ingest();
    expect(rep.skipped).toEqual([]);
    expect(rep.warnings).toContainEqual({ file: "2026-01-06-n3.md", message: "date taken from file name" });
    expect((await ws.items()).map((i) => i.task)).toEqual(["rotate the keys"]);
  });

  it("ING-45 / ING-39 a manually done item with no other mention is deleted; one with other mentions stays done", async () => {
    const ws = new Workspace();
    ws.write("n1.md", note("2026-01-05", [QUOTE]));
    ws.write("n2.md", note("2026-01-12", [QUOTE]));
    ws.write("n3.md", note("2026-01-06", ["- [ ] Sam to rotate the keys"]));
    await ws.ingest();
    const before = await ws.items();
    const quote = before.find((i) => i.task === "send the quote")!;
    const keys = before.find((i) => i.task === "rotate the keys")!;
    expect((await cli(["done", String(quote.id), "--db", ws.db])).code).toBe(0);
    expect((await cli(["done", String(keys.id), "--db", ws.db])).code).toBe(0);
    ws.write("n3.md", "");
    ws.write("n1.md", "");
    await ws.ingest();
    const after = await ws.items();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: quote.id, status: "done" });
  });

  it("ING-41 / ING-46 a restored note ingests normally, leaves skipped_notes and its mention rejoins the item", async () => {
    const ws = await twoNotes();
    ws.write("n1.md", "");
    await ws.ingest();
    ws.write("n1.md", note("2026-01-05", [QUOTE], { attendees: [...ATT, "Zed Unique"] }));
    const rep = await ws.ingest();
    expect(rep.skipped).toEqual([]);
    expect(peek(ws, "select count(*) as c from skipped_notes")[0]!.c).toBe(0);
    const items = await ws.items();
    expect(items).toHaveLength(1);
    expect(items[0]!.history).toHaveLength(2);
    expect(items[0]!.id).toBe(1);
  });

  it("ING-46 when the item itself was deleted, the restored note's item gets a fresh id (DUP-24)", async () => {
    const ws = new Workspace();
    ws.write("n3.md", note("2026-01-06", ["- [ ] Sam to rotate the keys"]));
    await ws.ingest();
    ws.write("n3.md", "");
    await ws.ingest();
    expect(await ws.items()).toEqual([]);
    ws.write("n3.md", note("2026-01-06", ["- [ ] Sam to rotate the keys"]));
    await ws.ingest();
    expect((await ws.items()).map((i) => i.id)).toEqual([2]);
  });
});

// ------------------------------------------------------------------ spec 02

describe("OWN crafted fixtures", () => {
  it("OWN-29 / OWN-03d both @ forms give owner Anita Desai and merge into one item with two mentions", async () => {
    const ws = new Workspace();
    ws.write(
      "at.md",
      note("2026-01-05", ["- [ ] @anita: Review the API documentation", "- [ ] @anita to review the API documentation"], {
        attendees: ["Anita Desai", "Rahul Mehta"],
      }),
    );
    await ws.ingest();
    const items = await ws.items();
    expect(items).toHaveLength(1);
    expect(items[0]!.owner).toMatchObject({ kind: "person", name: "Anita Desai" });
    expect(items[0]!.history).toHaveLength(2);
    const tasksStored = peek<{ task_text: string }>(ws, "select task_text from mentions order by line_no").map((r) => r.task_text);
    expect(tasksStored).toEqual(["Review the API documentation", "review the API documentation"]);
  });

  it("OWN-30 Everyone and Team are group, Someone is unowned (D6)", async () => {
    const ws = new Workspace();
    ws.write(
      "grp.md",
      note("2026-01-05", [
        "- [ ] Everyone to read the handbook",
        "- [ ] Team to pick a launch date",
        "- [ ] Someone to book the room",
      ]),
    );
    await ws.ingest();
    const items = await ws.items();
    expect(items.map((i) => [i.owner.kind, i.owner.group])).toEqual([
      ["group", "everyone"],
      ["group", "team"],
      ["unowned", null],
    ]);
    const rows = peek<{ owner_kind: string; group_tag: string | null; owner_name: string | null }>(
      ws,
      "select owner_kind, group_tag, owner_name from items order by id",
    );
    expect(rows.map((r) => r.owner_kind)).toEqual(["group", "group", "unowned"]);
    expect(rows.map((r) => r.group_tag)).toEqual(["everyone", "team", null]);
  });

  it("OWN-15 the roster is a first pass over all notes, so file order does not matter", async () => {
    const ws = new Workspace();
    ws.write("a-no-attendees.md", "# Meeting: Short\nDate: 2026-01-05\n\n- [ ] Sam to rotate the keys\n");
    ws.write("z-with-attendees.md", note("2026-01-06", ["- [ ] Anita to plan the demo"], { attendees: ["Sam Okafor", "Anita Desai"] }));
    await ws.ingest();
    const keys = (await ws.items()).find((i) => i.task === "rotate the keys")!;
    expect(keys.owner).toMatchObject({ kind: "person", name: "Sam Okafor" });
  });

  it("OWN-14 / DUP-02 a person and an ambiguous owner never merge, even for identical task text", async () => {
    const ws = new Workspace();
    ws.write("amb.md", note("2026-01-05", ["- [ ] Priya to send the quote"], { attendees: ["Priya Nair", "Priya Shah"] }));
    ws.write("one.md", note("2026-01-12", ["- [ ] Priya to send the quote"], { attendees: ["Priya Nair"] }));
    await ws.ingest();
    const items = await ws.items();
    expect(items.map((i) => i.owner.kind).sort()).toEqual(["ambiguous", "person"]);
    expect(items.every((i) => i.history.length === 1)).toBe(true);
  });
});

// ------------------------------------------------------------------ spec 03 (across mentions)

describe("DAT-30 / DAT-31 dates across mentions (D8)", () => {
  it("DAT-30 each mention resolves 'by Thursday' against its own meeting date", async () => {
    const ws = new Workspace();
    for (const d of ["2026-09-01", "2026-09-15", "2026-09-22"]) {
      ws.write(`${d}-wf.md`, note(d, ["- [ ] Anita to share the wireframes by Thursday"]));
    }
    await ws.ingest();
    const rows = peek<{ meeting_date: string; due_date: string }>(ws, "select meeting_date, due_date from mentions order by meeting_date");
    expect(rows.map((r) => r.due_date)).toEqual(["2026-09-03", "2026-09-17", "2026-09-24"]);
    const [item] = await ws.items();
    expect(item!.due_date).toBe("2026-09-24");
  });

  it("DAT-31 a later mention without a due date keeps the earlier one", async () => {
    const ws = new Workspace();
    ws.write("d1.md", note("2026-01-05", ["- [ ] Anita to prepare the board pack by 2026-01-09"]));
    ws.write("d2.md", note("2026-01-12", ["- [ ] Anita to prepare the board pack"]));
    await ws.ingest();
    const [item] = await ws.items();
    expect(item).toMatchObject({ due_date: "2026-01-09", due_raw: "by 2026-01-09", source_file: "d2.md" });
  });
});

// ------------------------------------------------------------------ spec 04

describe("DUP-10 to DUP-13 derived state: the latest mention wins (D8)", () => {
  const TASK = "Anita to prepare the board pack";
  it("DUP-10 / DUP-13 status follows the latest mention; a later [ ] re-opens the item", async () => {
    const ws = new Workspace();
    ws.write("d1.md", note("2026-01-05", [`- [ ] ${TASK}`]));
    await ws.ingest();
    expect((await ws.items())[0]!.status).toBe("open");
    ws.write("d2.md", note("2026-01-12", [`- [x] ${TASK}`]));
    await ws.ingest();
    expect((await ws.items())[0]!.status).toBe("done");
    ws.write("d3.md", note("2026-01-19", [`- [ ] ${TASK}`]));
    await ws.ingest();
    const items = await ws.items();
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe("open");
    expect(items[0]!.history.map((h) => h.checked)).toEqual([false, true, false]);
  });

  it("DUP-05 the checkbox state does not affect matching", async () => {
    const ws = new Workspace();
    ws.write("d1.md", note("2026-01-05", [`- [x] ${TASK}`]));
    ws.write("d2.md", note("2026-01-12", [`- [ ] ${TASK}`]));
    await ws.ingest();
    expect(await ws.items()).toHaveLength(1);
  });

  it("DUP-11 an unparsed phrase supplies due_raw only when no mention has a resolved date", async () => {
    const ws = new Workspace();
    ws.write("d1.md", note("2026-01-05", [`- [ ] ${TASK} before cutover`]));
    ws.write("d2.md", note("2026-01-12", [`- [ ] ${TASK}`]));
    await ws.ingest();
    expect((await ws.items())[0]).toMatchObject({ due_date: null, due_raw: "before cutover" });
  });

  it("DUP-12 task text, source and title come from the latest mention; earlier ones stay as history", async () => {
    const ws = new Workspace();
    ws.write("d1.md", note("2026-01-05", [`- [ ] ${TASK}`], { title: "First" }));
    ws.write("d2.md", note("2026-01-12", [`- [ ] ${TASK} slides`], { title: "Second" }));
    await ws.ingest();
    const [item] = await ws.items();
    expect(item).toMatchObject({ task: "prepare the board pack slides", source_file: "d2.md", source_title: "Second", meeting_date: "2026-01-12" });
    expect(item!.history.map((h) => h.file)).toEqual(["d1.md", "d2.md"]);
  });
});

describe("DUP-20 / DUP-21 / DUP-23 manual done and re-ingest (D15)", () => {
  const TASK = "Anita to prepare the board pack";
  const mdone = (ws: Workspace) => peek<{ manual_done_after: string | null }>(ws, "select manual_done_after from items where id = 1")[0]!.manual_done_after;

  it("DUP-20 done sets manual_done_after and leaves mentions untouched", async () => {
    const ws = new Workspace();
    ws.write("d1.md", note("2026-01-05", [`- [ ] ${TASK}`]));
    await ws.ingest();
    const mBefore = peek(ws, "select checked from mentions");
    expect(mdone(ws)).toBeNull();
    expect((await cli(["done", "1", "--db", ws.db])).code).toBe(0);
    expect(mdone(ws)).not.toBeNull();
    expect(peek(ws, "select checked from mentions")).toEqual(mBefore);
  });

  it("DUP-21 a manual done sticks on re-ingest; a newer mention decides and clears it", async () => {
    const ws = new Workspace();
    ws.write("d1.md", note("2026-01-05", [`- [ ] ${TASK}`]));
    await ws.ingest();
    await cli(["done", "1", "--db", ws.db]);
    await ws.ingest();
    expect((await ws.items())[0]!.status).toBe("done");
    ws.write("d2.md", note("2026-01-12", [`- [ ] ${TASK}`]));
    await ws.ingest();
    expect((await ws.items())[0]!.status).toBe("open");
    expect(mdone(ws)).toBeNull();
    await ws.ingest();
    expect((await ws.items())[0]!.status).toBe("open");
  });

  it("DUP-23 a new note matching an existing item adds a mention and keeps the id", async () => {
    const ws = new Workspace();
    ws.write("d1.md", note("2026-01-05", [`- [ ] ${TASK}`]));
    await ws.ingest();
    ws.write("d2.md", note("2026-01-12", [`- [ ] ${TASK} slides`]));
    const rep = await ws.ingest();
    expect(rep.items).toMatchObject({ created: 0, updated: 1 });
    const items = await ws.items();
    expect(items.map((i) => [i.id, i.history.length])).toEqual([[1, 2]]);
  });
});

describe("DUP-24 ids are sequential and never reused", () => {
  it("DUP-24 new items get 1, 2, 3 in order of first mention", async () => {
    const ws = new Workspace();
    ws.write("a.md", note("2026-01-05", ["- [ ] Anita to do alpha work", "- [ ] Sam to do beta work"]));
    ws.write("b.md", note("2026-01-06", ["- [ ] Karan to do gamma work"]));
    await ws.ingest();
    expect((await ws.items()).map((i) => [i.id, i.task])).toEqual([
      [1, "do alpha work"],
      [2, "do beta work"],
      [3, "do gamma work"],
    ]);
  });
});

describe("DUP-60 to DUP-66 ID preservation (D33)", () => {
  const A = "- [ ] Anita to update the style guide colours";
  const B = "- [ ] Anita to update the style guide colours and typography";
  const C = "- [ ] Anita to update the style guide typography fonts";
  const att = { attendees: ["Anita Desai", "Rahul Mehta"] };
  const nA = () => note("2026-01-05", [A], att);
  const nB = () => note("2026-01-12", [B], att);
  const nC = () => note("2026-01-19", [C], att);

  it("DUP-60 the middle note bridges A and C: the lowest id survives and the other is gone", async () => {
    const ws = new Workspace();
    ws.write("a.md", nA());
    ws.write("c.md", nC());
    await ws.ingest();
    expect((await ws.items()).map((i) => i.id)).toEqual([1, 2]);
    ws.write("b.md", nB());
    const rep = await ws.ingest();
    const items = await ws.items();
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe(1);
    expect(items[0]!.history).toHaveLength(3);
    expect(rep.merged_items).toEqual([{ ids: [1, 2], into: 1 }]);
    expect(rep.items.absorbed).toBe(1);
    // Nothing is left to merge on the next, unchanged run.
    expect((await ws.ingestText()).out).not.toContain("merged items");
  });

  it("DUP-29b the text report lists the merge as `merged items #1, #2 into #1`", async () => {
    const ws = new Workspace();
    ws.write("a.md", nA());
    ws.write("c.md", nC());
    await ws.ingest();
    ws.write("b.md", nB());
    const text = (await ws.ingestText()).out;
    expect(text).toContain("merged items #1, #2 into #1");
  });

  it("DUP-61 a brand-new task after a merge never reuses the absorbed id", async () => {
    const ws = new Workspace();
    ws.write("a.md", nA());
    ws.write("c.md", nC());
    await ws.ingest();
    ws.write("b.md", nB());
    await ws.ingest();
    ws.write("d.md", note("2026-01-26", ["- [ ] Rahul to fix the pagination bug"], att));
    await ws.ingest();
    expect((await ws.items()).map((i) => i.id)).toEqual([1, 3]);
  });

  it("DUP-62 re-ingest of unchanged notes keeps every id", async () => {
    const ws = new Workspace();
    ws.write("a.md", nA());
    ws.write("b.md", nB());
    ws.write("c.md", nC());
    await ws.ingest();
    const before = (await ws.items()).map((i) => i.id);
    await ws.ingest();
    expect((await ws.items()).map((i) => i.id)).toEqual(before);
  });

  it("DUP-63 a manually done item that survives a merge is still done; unrelated ids do not change", async () => {
    const ws = new Workspace();
    ws.write("a.md", nA());
    ws.write("u.md", note("2026-01-06", ["- [ ] Rahul to fix the pagination bug"], att));
    ws.write("c.md", nC());
    await ws.ingest();
    const before = await ws.items();
    expect(before.map((i) => i.id)).toEqual([1, 2, 3]); // A=1, unrelated=2, C=3
    expect((await cli(["done", "3", "--db", ws.db])).code).toBe(0);
    ws.write("b.md", nB());
    await ws.ingest();
    const after = await ws.items();
    expect(after.map((i) => [i.id, i.status])).toEqual([
      [1, "done"],
      [2, "open"],
    ]);
    expect(after[1]!.task).toBe("fix the pagination bug");
  });

  it("DUP-29 the survivor keeps the LATEST manual_done_after among the merged items, not the lowest id's", async () => {
    const ws = new Workspace();
    ws.write("a.md", nA());
    ws.write("c.md", nC());
    await ws.ingest(); // A = id 1, C = id 2
    expect((await cli(["done", "1", "--db", ws.db])).code).toBe(0); // manual position: A
    expect((await cli(["done", "2", "--db", ws.db])).code).toBe(0); // manual position: C (later)
    ws.write("b.md", nB());
    await ws.ingest(); // ids 1 and 2 merge into 1
    const items = await ws.items();
    expect(items.map((i) => i.id)).toEqual([1]);
    // Had the survivor kept only id 1's position (A), the newer mention C would re-open it (DUP-21).
    expect(items[0]!.status).toBe("done");
    const stored = peek<{ manual_done_after: string }>(ws, "select manual_done_after from items where id = 1")[0]!.manual_done_after;
    expect(JSON.parse(stored)).toMatchObject({ date: "2026-01-19", file: "c.md" });
  });

  it("DUP-64 splitting: A keeps id 1 and C gets a new id (2 when 2 was never issued)", async () => {
    const ws = new Workspace();
    ws.write("a.md", nA());
    ws.write("b.md", nB());
    ws.write("c.md", nC());
    await ws.ingest();
    expect((await ws.items()).map((i) => i.id)).toEqual([1]);
    ws.write("b.md", "");
    await ws.ingest();
    const items = await ws.items();
    expect(items.map((i) => [i.id, i.history[0]!.file])).toEqual([
      [1, "a.md"],
      [2, "c.md"],
    ]);
  });

  it("DUP-64 splitting: C gets 3 when id 2 was issued earlier (A and C first ingested separately)", async () => {
    const ws = new Workspace();
    ws.write("a.md", nA());
    ws.write("c.md", nC());
    await ws.ingest();
    ws.write("b.md", nB());
    await ws.ingest();
    expect((await ws.items()).map((i) => i.id)).toEqual([1]);
    ws.write("b.md", "");
    await ws.ingest();
    expect((await ws.items()).map((i) => [i.id, i.history[0]!.file])).toEqual([
      [1, "a.md"],
      [3, "c.md"],
    ]);
  });

  it("DUP-66 a line inserted above an unchanged action does not change its id", async () => {
    const ws = new Workspace();
    ws.write("n.md", note("2026-01-05", ["- [ ] Anita to do alpha work", "- [ ] Sam to do beta work"]));
    await ws.ingest();
    const before = Object.fromEntries((await ws.items()).map((i) => [i.task, i.id]));
    ws.write("n.md", note("2026-01-05", ["- [ ] Karan to do gamma work", "- [ ] Anita to do alpha work", "- [ ] Sam to do beta work"]));
    await ws.ingest();
    const after = Object.fromEntries((await ws.items()).map((i) => [i.task, i.id]));
    expect(after["do alpha work"]).toBe(before["do alpha work"]);
    expect(after["do beta work"]).toBe(before["do beta work"]);
    expect(after["do gamma work"]).toBe(3);
  });
});

// ------------------------------------------------------------------ global rules

describe("G-03 / G-04 dates and determinism", () => {
  it("G-03 every stored and printed date is ISO YYYY-MM-DD", async () => {
    const ws = new Workspace();
    ws.write("n.md", "# Meeting: Sync\nDate: Monday, 14 September 2026\nAttendees: Anita Desai\n\n- [ ] Anita to plan the demo by Wed 16 Sep\n");
    await ws.ingest();
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    for (const i of await ws.items()) {
      expect(i.meeting_date).toMatch(iso);
      expect(i.due_date).toMatch(iso);
    }
    for (const r of peek<{ meeting_date: string }>(ws, "select meeting_date from notes")) expect(r.meeting_date).toMatch(iso);
  });

  it("G-04 the same notes and --as-of give the same output, in a fresh database or a repeated run", async () => {
    const ws1 = new Workspace();
    const ws2 = new Workspace();
    for (const ws of [ws1, ws2]) {
      ws.write("n1.md", note("2026-01-05", [QUOTE, "- [ ] Sam to rotate the keys"]));
      ws.write("n2.md", note("2026-01-12", [QUOTE]));
      await ws.ingest();
    }
    expect(await ws1.items("2026-02-01")).toEqual(await ws2.items("2026-02-01"));
    const a = await cli(["list", "--db", ws1.db, "--as-of", "2026-02-01"]);
    const b = await cli(["list", "--db", ws1.db, "--as-of", "2026-02-01"]);
    expect(a.out).toBe(b.out);
  });
});
