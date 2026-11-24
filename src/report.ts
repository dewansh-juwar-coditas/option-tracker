/** Status model and text rendering for `list` and `ingest` (specs 05 and 01). Pure functions. */
import { daysBetween } from "./dates.js";
import type { Item, OwnerSpec } from "./models.js";
import type { IngestReport, ListItemJson } from "./schemas.js";

export type DisplayStatus = "open" | "overdue" | "done";

/** LST-01: done, overdue (open and due before the as-of date) or open. */
export function classify(
  item: { status: "open" | "done"; dueDate: string | null },
  asOf: string,
): { status: DisplayStatus; daysOverdue: number | null } {
  if (item.status === "done") return { status: "done", daysOverdue: null };
  if (item.dueDate !== null && item.dueDate < asOf) {
    return { status: "overdue", daysOverdue: daysBetween(item.dueDate, asOf) };
  }
  return { status: "open", daysOverdue: null };
}

/** LST-08: the OWNER column. */
export function ownerLabel(o: OwnerSpec): string {
  switch (o.kind) {
    case "person":
      return o.name ?? "";
    case "ambiguous":
      return `ambiguous: ${o.candidates.join(" | ")}`;
    case "group":
      return `(${o.group})`;
    case "unowned":
      return "(unowned)";
  }
}

/** LST-10. */
export function itemToJson(item: Item, asOf: string): ListItemJson {
  const c = classify(item, asOf);
  return {
    id: item.id,
    status: c.status,
    days_overdue: c.daysOverdue,
    owner: {
      kind: item.owner.kind,
      name: item.owner.name,
      candidates: item.owner.candidates,
      group: item.owner.kind === "group" ? item.owner.group : null,
    },
    task: item.task,
    due_date: item.dueDate,
    due_raw: item.dueRaw,
    source_file: item.sourceFile,
    meeting_date: item.meetingDate,
    source_title: item.sourceTitle,
    history: item.history.map((h) => ({ file: h.file, line: h.line, meeting_date: h.meetingDate, checked: h.checked })),
  };
}

/** LST-07: due date ascending with undated last, then id. */
export function compareByDue(a: { dueDate: string | null; id: number }, b: { dueDate: string | null; id: number }): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return a.id - b.id;
}

function statusLabel(item: Item, asOf: string): string {
  const c = classify(item, asOf);
  if (c.status === "overdue") return `OVERDUE (${c.daysOverdue}d)`;
  return c.status === "done" ? "DONE" : "OPEN";
}

function dueLabel(item: Item): string {
  if (item.dueDate) return item.dueDate;
  if (item.dueRaw) return `[${item.dueRaw}]`;
  return "-";
}

/** LST-08: table, then a count footer, then any extra footer lines (LST-04). */
export function formatListTable(items: Item[], asOf: string, extraFooter: string[] = []): string {
  const header = ["ID", "STATUS", "OWNER", "DUE", "TASK", "SOURCE"];
  const rows = items.map((i) => [
    String(i.id),
    statusLabel(i, asOf),
    ownerLabel(i.owner),
    dueLabel(i),
    i.task,
    i.sourceFile,
  ]);
  const widths = header.map((h, c) => Math.max(h.length, ...rows.map((r) => r[c]!.length)));
  const line = (cells: string[]) =>
    cells
      .map((cell, c) => (c === cells.length - 1 ? cell : cell.padEnd(widths[c]! + 2)))
      .join("")
      .trimEnd();
  return [line(header), ...rows.map(line), `${items.length} item(s)`, ...extraFooter].join("\n");
}

const ids = (list: number[]) => (list.length ? list.map((i) => `#${i}`).join(", ") : "none");

/** ING-23 to ING-27, DUP-29b, ING-40: the readable ingest report. */
export function formatIngestReport(r: IngestReport): string {
  const out: string[] = [];
  out.push(`Notes: ${r.notes.ingested} ingested, ${r.notes.unchanged} unchanged, ${r.notes.skipped} skipped, ${r.notes.ignored} ignored`);
  out.push(
    `Items: ${r.items.created} created, ${r.items.updated} updated, ${r.items.unchanged} unchanged, ${r.items.absorbed} absorbed, ${r.items.deleted} deleted`,
  );
  const section = (title: string, lines: string[]) => {
    if (lines.length) out.push("", `${title}:`, ...lines.map((l) => `  ${l}`));
  };
  section("Skipped notes", r.skipped.map((s) => `${s.file}: ${s.reason}`));
  section(
    "Previously ingested notes that became malformed",
    r.previously_ingested.map(
      (p) =>
        `${p.file}: previously ingested: removed ${p.removed_mentions} mention(s), deleted items ${ids(p.deleted_items)}, re-derived items ${ids(p.rederived_items)}`,
    ),
  );
  section("Warnings", r.warnings.map((w) => `${w.file}: ${w.message}`));
  section("Ambiguous owners", r.ambiguous.map((a) => `${a.file}:${a.line}: ${a.candidates.join(" | ")}: ${a.task}`));
  section("Unparsed due phrases", r.unparsed_due.map((u) => `${u.file}:${u.line}: "${u.phrase}"`));
  section(
    "Merged items",
    r.merged_items.map((m) => `merged items ${ids(m.ids)} into #${m.into}`),
  );
  section("Deleted ids", r.deleted_ids.length ? [ids(r.deleted_ids)] : []);
  section(
    "Items with several mentions",
    r.merges.map((m) => `#${m.id} ${m.owner}: ${m.task} (${m.mentions.map((x) => `${x.file}:${x.line}`).join(", ")})`),
  );
  return out.join("\n");
}
