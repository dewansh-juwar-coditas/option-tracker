/**
 * SQLite storage and the ingest pipeline (specs 00, 01, 04; decisions D14, D15, D16, D33, D34).
 *
 * Item state is derived: on every ingest all stored mentions are regrouped (DUP-04), ids are reassigned by
 * the lowest-surviving-id rule (DUP-25 to DUP-29), and each item is re-derived from its mentions.
 * A note is identified by its file name. IDs come from AUTOINCREMENT, so they are never reused (DUP-24).
 */
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { assignIds, comparePos, deriveItem, groupMentions, ownerKey, posOf, type Derived } from "./dedup.js";
import type { HistoryEntry, Item, Mention, OwnerSpec, ParseResult, Pos } from "./models.js";
import { buildMentions, parseNote } from "./parser.js";
import { ownerLabel } from "./report.js";
import type { IngestReport } from "./schemas.js";

export type Db = Database.Database;

const SCHEMA = `
create table if not exists notes (
  path text primary key, sha256 text not null, meeting_date text not null, title text,
  attendees text not null default '[]', ingested_at text not null);
create table if not exists skipped_notes (
  path text primary key, reason text not null, ingested_at text not null);
create table if not exists people (name text primary key);
create table if not exists items (
  id integer primary key autoincrement,
  owner_kind text not null, owner_name text, owner_candidates text, group_tag text,
  task text not null, due_raw text, due_date text, status text not null, manual_done_after text,
  source_file text not null, meeting_date text not null, source_title text);
create table if not exists mentions (
  id integer primary key,
  item_id integer not null references items(id),
  source_file text not null, line_no integer not null, meeting_date text not null, source_title text,
  checked integer not null, task_text text not null, due_raw text, due_date text,
  owner_kind text not null, owner_name text, owner_candidates text, group_tag text);
`;

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

// ---------------------------------------------------------------- row mapping

interface MentionRow {
  id: number;
  item_id: number;
  source_file: string;
  line_no: number;
  meeting_date: string;
  source_title: string | null;
  checked: number;
  task_text: string;
  due_raw: string | null;
  due_date: string | null;
  owner_kind: OwnerSpec["kind"];
  owner_name: string | null;
  owner_candidates: string | null;
  group_tag: OwnerSpec["group"];
}

interface ItemRow {
  id: number;
  owner_kind: OwnerSpec["kind"];
  owner_name: string | null;
  owner_candidates: string | null;
  group_tag: OwnerSpec["group"];
  task: string;
  due_raw: string | null;
  due_date: string | null;
  status: "open" | "done";
  manual_done_after: string | null;
  source_file: string;
  meeting_date: string;
  source_title: string | null;
}

const ownerFromRow = (r: Pick<MentionRow, "owner_kind" | "owner_name" | "owner_candidates" | "group_tag">): OwnerSpec => ({
  kind: r.owner_kind,
  name: r.owner_name,
  candidates: r.owner_candidates ? (JSON.parse(r.owner_candidates) as string[]) : [],
  group: r.group_tag,
});

const mentionFromRow = (r: MentionRow): Mention => ({
  sourceFile: r.source_file,
  lineNo: r.line_no,
  meetingDate: r.meeting_date,
  sourceTitle: r.source_title,
  checked: r.checked === 1,
  task: r.task_text,
  dueRaw: r.due_raw,
  dueDate: r.due_date,
  dueUnparsed: r.due_raw !== null && r.due_date === null,
  owner: ownerFromRow(r),
});

const parsePos = (s: string | null): Pos | null => (s ? (JSON.parse(s) as Pos) : null);
const candidatesJson = (o: OwnerSpec) => (o.kind === "ambiguous" ? JSON.stringify(o.candidates) : null);
const groupTag = (o: OwnerSpec) => (o.kind === "group" ? o.group : null);

const ORDER_MENTIONS = "order by meeting_date, source_file, line_no, id";

// ---------------------------------------------------------------- reads

/** Every item with its history, ordered by id. */
export function loadItems(db: Db): Item[] {
  const rows = db.prepare("select * from items order by id").all() as ItemRow[];
  const mentions = db.prepare(`select * from mentions ${ORDER_MENTIONS}`).all() as MentionRow[];
  const byItem = new Map<number, HistoryEntry[]>();
  for (const m of mentions) {
    const list = byItem.get(m.item_id) ?? [];
    list.push({ file: m.source_file, line: m.line_no, meetingDate: m.meeting_date, checked: m.checked === 1 });
    byItem.set(m.item_id, list);
  }
  return rows.map((r) => ({
    id: r.id,
    owner: ownerFromRow(r),
    task: r.task,
    dueRaw: r.due_raw,
    dueDate: r.due_date,
    status: r.status,
    manualDoneAfter: parsePos(r.manual_done_after),
    sourceFile: r.source_file,
    meetingDate: r.meeting_date,
    sourceTitle: r.source_title,
    history: byItem.get(r.id) ?? [],
  }));
}

export type DoneResult = { kind: "done" | "already"; item: Item } | { kind: "unknown" };

/** DNE-01, DNE-02, DUP-20: marks an item done and remembers the position of its latest mention. */
export function markDone(db: Db, id: number): DoneResult {
  const item = loadItems(db).find((i) => i.id === id);
  if (!item) return { kind: "unknown" };
  if (item.status === "done") return { kind: "already", item };
  const latest = db
    .prepare("select * from mentions where item_id = ? order by meeting_date desc, source_file desc, line_no desc, id desc limit 1")
    .get(id) as MentionRow | undefined;
  const pos = latest ? posOf(mentionFromRow(latest)) : null;
  db.prepare("update items set status = 'done', manual_done_after = ? where id = ?").run(pos ? JSON.stringify(pos) : null, id);
  return { kind: "done", item: { ...item, status: "done", manualDoneAfter: pos } };
}

// ---------------------------------------------------------------- ingest

export interface IngestOptions {
  /** Replaceable so ING-12 (an unexpected exception while parsing) can be tested. */
  parse?: (buf: Buffer, name: string) => ParseResult;
  now?: Date;
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface Scanned {
  name: string;
  sha: string;
  result: ParseResult;
}

interface Working {
  mention: Mention;
  prevId: number | null;
}

/** A fingerprint of an item and its mentions, to tell "updated" from "unchanged". */
const signature = (d: Derived, mentions: Mention[]) =>
  JSON.stringify([d, mentions.map((m) => [m.sourceFile, m.lineNo, m.checked, m.task, m.dueRaw, m.dueDate])]);

export function ingestFolder(db: Db, folder: string, opts: IngestOptions = {}): IngestReport {
  const parse = opts.parse ?? parseNote;
  const nowIso = (opts.now ?? new Date()).toISOString();

  // ---- scan (ING-01, ING-03)
  const entries = readdirSync(folder, { withFileTypes: true }).filter((e) => e.isFile());
  const names = entries.map((e) => e.name).sort(cmpStr);
  const mdNames = names.filter((n) => /\.md$/i.test(n));
  const ignored = names.length - mdNames.length;

  const scanned: Scanned[] = mdNames.map((name) => {
    let buf: Buffer;
    try {
      buf = readFileSync(join(folder, name));
    } catch (e) {
      return { name, sha: "", result: { ok: false, reason: `parse error: ${(e as Error).message}` } };
    }
    const sha = createHash("sha256").update(buf).digest("hex");
    try {
      return { name, sha, result: parse(buf, name) };
    } catch (e) {
      return { name, sha, result: { ok: false, reason: `parse error: ${(e as Error).message}` } };
    }
  });
  const scannedNames = new Set(mdNames);

  // ---- stored state before this ingest
  const storedNotes = new Map(
    (db.prepare("select path, sha256, attendees from notes").all() as { path: string; sha256: string; attendees: string }[]).map(
      (r) => [r.path, r],
    ),
  );
  const storedMentions = db.prepare(`select * from mentions ${ORDER_MENTIONS}`).all() as MentionRow[];
  const storedItems = db.prepare("select * from items order by id").all() as ItemRow[];
  const manualById = new Map(storedItems.map((r) => [r.id, parsePos(r.manual_done_after)]));
  const previousIds = storedItems.map((r) => r.id);
  const beforeSig = new Map<number, string>();
  {
    const byItem = new Map<number, Mention[]>();
    for (const m of storedMentions) (byItem.get(m.item_id) ?? byItem.set(m.item_id, []).get(m.item_id)!).push(mentionFromRow(m));
    for (const r of storedItems) {
      const ms = byItem.get(r.id) ?? [];
      if (ms.length) beforeSig.set(r.id, signature(deriveItem(ms, parsePos(r.manual_done_after)), ms));
    }
  }

  // ---- roster (OWN-15, D22, ING-38): first pass over all valid notes, plus stored notes not in this scan
  const roster = new Set<string>();
  for (const s of scanned) if (s.result.ok) for (const a of s.result.note.attendees) roster.add(a);
  for (const [path, n] of storedNotes) {
    if (!scannedNames.has(path)) for (const a of JSON.parse(n.attendees) as string[]) roster.add(a);
  }
  const rosterList = [...roster].sort(cmpStr);

  // ---- mentions of every valid scanned note, with the previous id each one carried (DUP-25)
  const working: Working[] = [];
  const warnings: IngestReport["warnings"] = [];
  const skipped: IngestReport["skipped"] = [];
  const previouslyIngested: { file: string; removed: MentionRow[] }[] = [];
  const counts = { ingested: 0, unchanged: 0 };

  for (const s of scanned) {
    if (!s.result.ok) {
      skipped.push({ file: s.name, reason: s.result.reason });
      if (storedNotes.has(s.name)) {
        // D34: the mentions of a note that became malformed are removed, so they are not carried over.
        previouslyIngested.push({ file: s.name, removed: storedMentions.filter((m) => m.source_file === s.name) });
      }
      continue;
    }
    const prior = storedNotes.get(s.name);
    if (prior && prior.sha256 === s.sha) counts.unchanged++;
    else counts.ingested++;

    for (const w of s.result.note.warnings) warnings.push({ file: s.name, message: w });
    const built = buildMentions(s.result.note, s.name, rosterList);
    for (const w of built.warnings) warnings.push({ file: s.name, message: w });

    const stored = storedMentions.filter((m) => m.source_file === s.name).sort((a, b) => a.line_no - b.line_no || a.id - b.id);
    const used = new Set<number>();
    for (const mention of built.mentions) {
      const key = ownerKey(mention.owner);
      const match = stored.find((m) => !used.has(m.id) && m.task_text === mention.task && ownerKey(ownerFromRow(m)) === key);
      if (match) used.add(match.id);
      working.push({ mention, prevId: match ? match.item_id : null });
    }
  }
  for (const m of storedMentions) {
    if (!scannedNames.has(m.source_file)) working.push({ mention: mentionFromRow(m), prevId: m.item_id });
  }

  // ---- regroup everything in DUP-04 order and assign ids (DUP-25 to DUP-29)
  working.sort((a, b) => comparePos(posOf(a.mention), posOf(b.mention)));
  const groupIndex = groupMentions(working.map((w) => ({ ownerKey: ownerKey(w.mention.owner), task: w.mention.task })));
  const groupCount = groupIndex.length ? Math.max(...groupIndex) + 1 : 0;
  const groups: Working[][] = Array.from({ length: groupCount }, () => []);
  working.forEach((w, i) => groups[groupIndex[i]!]!.push(w));

  const plan = assignIds(
    groups.map((g) => g.map((w) => w.prevId)),
    previousIds,
  );

  // ---- write
  const created: number[] = [];
  const finalIds: number[] = [];
  let updated = 0;
  let unchangedItems = 0;
  const merges: IngestReport["merges"] = [];

  db.transaction(() => {
    db.prepare("delete from mentions").run();
    const gone = [...plan.deleted, ...plan.absorbed];
    const del = db.prepare("delete from items where id = ?");
    for (const id of gone) del.run(id);

    const insertItem = db.prepare(
      `insert into items (owner_kind, owner_name, owner_candidates, group_tag, task, due_raw, due_date, status,
        manual_done_after, source_file, meeting_date, source_title) values (?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const updateItem = db.prepare(
      `update items set owner_kind=?, owner_name=?, owner_candidates=?, group_tag=?, task=?, due_raw=?, due_date=?,
        status=?, manual_done_after=?, source_file=?, meeting_date=?, source_title=? where id=?`,
    );
    const insertMention = db.prepare(
      `insert into mentions (item_id, source_file, line_no, meeting_date, source_title, checked, task_text, due_raw,
        due_date, owner_kind, owner_name, owner_candidates, group_tag) values (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );

    groups.forEach((g, gi) => {
      const mentions = g.map((w) => w.mention);
      const assignment = plan.assignments[gi]!;
      // DUP-29: the survivor keeps the latest manual position among the items merged into it.
      let manual: Pos | null = null;
      for (const c of assignment.merged) {
        const p = manualById.get(c) ?? null;
        if (p && (manual === null || comparePos(p, manual) > 0)) manual = p;
      }
      const d = deriveItem(mentions, manual);
      const values = [
        d.owner.kind, d.owner.name, candidatesJson(d.owner), groupTag(d.owner), d.task, d.dueRaw, d.dueDate, d.status,
        d.manualDoneAfter ? JSON.stringify(d.manualDoneAfter) : null, d.sourceFile, d.meetingDate, d.sourceTitle,
      ];
      let id: number;
      if (assignment.id === null) {
        id = Number(insertItem.run(...values).lastInsertRowid);
        created.push(id);
      } else {
        id = assignment.id;
        updateItem.run(...values, id);
        if (beforeSig.get(id) === signature(d, mentions)) unchangedItems++;
        else updated++;
      }
      finalIds.push(id);
      for (const m of mentions) {
        insertMention.run(
          id, m.sourceFile, m.lineNo, m.meetingDate, m.sourceTitle, m.checked ? 1 : 0, m.task, m.dueRaw, m.dueDate,
          m.owner.kind, m.owner.name, candidatesJson(m.owner), groupTag(m.owner),
        );
      }
      if (mentions.length > 1) {
        merges.push({
          id,
          owner: ownerLabel(d.owner),
          task: d.task,
          mentions: mentions.map((m) => ({ file: m.sourceFile, line: m.lineNo })),
        });
      }
    });

    // Notes: one state at a time (ING-22a). An unchanged note's row is left alone (ING-20).
    const upsertNote = db.prepare(
      `insert into notes (path, sha256, meeting_date, title, attendees, ingested_at) values (?,?,?,?,?,?)
       on conflict(path) do update set sha256=excluded.sha256, meeting_date=excluded.meeting_date,
         title=excluded.title, attendees=excluded.attendees, ingested_at=excluded.ingested_at
       where notes.sha256 != excluded.sha256`,
    );
    const upsertSkipped = db.prepare(
      `insert into skipped_notes (path, reason, ingested_at) values (?,?,?)
       on conflict(path) do update set reason=excluded.reason, ingested_at=excluded.ingested_at
       where skipped_notes.reason != excluded.reason`,
    );
    for (const s of scanned) {
      if (s.result.ok) {
        const n = s.result.note;
        upsertNote.run(s.name, s.sha, n.date, n.title, JSON.stringify(n.attendees), nowIso);
        db.prepare("delete from skipped_notes where path = ?").run(s.name);
      } else {
        upsertSkipped.run(s.name, s.result.reason, nowIso);
        db.prepare("delete from notes where path = ?").run(s.name);
      }
    }
    // ING-38: the roster is rebuilt from the ingested notes that remain.
    db.prepare("delete from people").run();
    const addPerson = db.prepare("insert or ignore into people (name) values (?)");
    for (const r of db.prepare("select attendees from notes").all() as { attendees: string }[]) {
      for (const a of JSON.parse(r.attendees) as string[]) addPerson.run(a);
    }
  })();

  // ---- report
  const survivors = new Set(finalIds);
  const report: IngestReport = {
    notes: { ingested: counts.ingested, unchanged: counts.unchanged, skipped: skipped.length, ignored },
    items: {
      created: created.length,
      updated,
      unchanged: unchangedItems,
      absorbed: plan.absorbed.length,
      deleted: plan.deleted.length,
    },
    skipped,
    warnings,
    ambiguous: working
      .filter((w) => w.mention.owner.kind === "ambiguous" && scannedNames.has(w.mention.sourceFile))
      .map((w) => ({
        file: w.mention.sourceFile,
        line: w.mention.lineNo,
        task: w.mention.task,
        candidates: w.mention.owner.candidates,
      })),
    unparsed_due: working
      .filter((w) => w.mention.dueUnparsed && scannedNames.has(w.mention.sourceFile))
      .map((w) => ({ file: w.mention.sourceFile, line: w.mention.lineNo, phrase: w.mention.dueRaw! })),
    merges,
    merged_items: plan.assignments
      .map((a) => ({ ids: a.merged, into: a.id }))
      .filter((m): m is { ids: number[]; into: number } => m.into !== null && m.ids.length > 1),
    deleted_ids: plan.deleted,
    previously_ingested: previouslyIngested.map((p) => {
      const ids = [...new Set(p.removed.map((m) => m.item_id))].sort((a, b) => a - b);
      return {
        file: p.file,
        removed_mentions: p.removed.length,
        deleted_items: ids.filter((i) => !survivors.has(i)),
        rederived_items: ids.filter((i) => survivors.has(i)),
      };
    }),
  };
  return report;
}
