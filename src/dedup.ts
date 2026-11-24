/** Duplicate matching (spec 04, D7). Pure functions: plain values in, plain values out. */
import type { Mention, OwnerSpec, Pos } from "./models.js";

/** DUP-03 / DUP-06: mentions match when similarity is at least this. */
export const THRESHOLD = 0.6;

const STOP_WORDS = new Set("the a an to of for with by on in at and our their up".split(" "));
/** DUP-01: version qualifiers are ignored ("share first wireframes" vs "share updated wireframes"). */
const QUALIFIERS = new Set("first updated revised final new latest".split(" "));

/** DUP-01: normalized word set of a task. */
export function taskKey(task: string): Set<string> {
  const words = task
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOP_WORDS.has(w) && !QUALIFIERS.has(w));
  return new Set(words);
}

/** DUP-03: Jaccard similarity. With fewer than 2 words on either side, only identical sets match. */
export function similarity(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  if (a.size < 2 || b.size < 2) {
    return a.size === b.size && inter === a.size ? 1 : 0;
  }
  return union === 0 ? 0 : inter / union;
}

/** DUP-02: two mentions may share an item only if their owner keys are equal. */
export function ownerKey(o: OwnerSpec): string {
  switch (o.kind) {
    case "person":
      return `p:${(o.name ?? "").toLowerCase()}`;
    case "ambiguous":
      return `a:${o.candidates.map((c) => c.toLowerCase()).sort().join("|")}`;
    case "group":
      return `g:${o.group ?? ""}`;
    case "unowned":
      return "u";
  }
}

export interface Groupable {
  ownerKey: string;
  task: string;
}

/**
 * DUP-04: items must be passed in processing order (meeting date, file name, line number).
 * Returns, for each input, the index of its group (first-seen order). A mention joins the group with
 * the highest similarity at or above THRESHOLD (best score over the group's mentions); ties go to the
 * lowest group index; otherwise it starts a new group.
 */
export function groupMentions(items: Groupable[]): number[] {
  const groups: { ownerKey: string; keys: Set<string>[] }[] = [];
  const result: number[] = [];
  for (const item of items) {
    const key = taskKey(item.task);
    let best = -1;
    let bestScore = 0;
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g]!;
      if (group.ownerKey !== item.ownerKey) continue;
      let score = 0;
      for (const k of group.keys) score = Math.max(score, similarity(key, k));
      if (score >= THRESHOLD && score > bestScore) {
        best = g;
        bestScore = score;
      }
    }
    if (best === -1) {
      groups.push({ ownerKey: item.ownerKey, keys: [key] });
      result.push(groups.length - 1);
    } else {
      groups[best]!.keys.push(key);
      result.push(best);
    }
  }
  return result;
}

export interface IdAssignment {
  /** The surviving previous id, or null when the database must allocate a new one (DUP-27, DUP-24). */
  id: number | null;
  /** Candidate ids in order of first appearance among the group's mentions (DUP-29b). */
  merged: number[];
}

export interface IdPlan {
  assignments: IdAssignment[];
  /** Candidate ids that lost a merge: the item is gone, its mentions live on in the survivor (DUP-26). */
  absorbed: number[];
  /** Previous ids that appear in no group at all: nothing is left of them (DUP-28). */
  deleted: number[];
}

/**
 * D33, DUP-25 to DUP-29a, DUP-65. `groups` are in order of their earliest mention; each lists the
 * previous id of every mention in it (null for a new or edited mention). The lowest candidate id
 * survives; ids taken or absorbed by an earlier group are never candidates again.
 */
export function assignIds(groups: Array<Array<number | null>>, previousIds: number[]): IdPlan {
  const used = new Set<number>();
  const seen = new Set<number>();
  const absorbed: number[] = [];
  const assignments: IdAssignment[] = groups.map((prev) => {
    const candidates: number[] = [];
    for (const p of prev) {
      if (p === null) continue;
      seen.add(p);
      if (!used.has(p) && !candidates.includes(p)) candidates.push(p);
    }
    if (candidates.length === 0) return { id: null, merged: [] };
    const id = Math.min(...candidates);
    for (const c of candidates) {
      used.add(c);
      if (c !== id) absorbed.push(c);
    }
    return { id, merged: candidates };
  });
  const deleted = [...new Set(previousIds)].filter((p) => !seen.has(p)).sort((a, b) => a - b);
  return { assignments, absorbed, deleted };
}

// ---------------------------------------------------------------- derived item state (DUP-10 to DUP-13, DUP-21)


/** Plain code-unit order, so results never depend on locale (G-04). */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function posOf(m: Pick<Mention, "meetingDate" | "sourceFile" | "lineNo">): Pos {
  return { date: m.meetingDate, file: m.sourceFile, line: m.lineNo };
}

/** DUP-04 order: meeting date, then file name, then line number. */
export function comparePos(a: Pos, b: Pos): number {
  return cmp(a.date, b.date) || cmp(a.file, b.file) || a.line - b.line;
}

export interface Derived {
  owner: OwnerSpec;
  task: string;
  dueRaw: string | null;
  dueDate: string | null;
  status: "open" | "done";
  manualDoneAfter: Pos | null;
  sourceFile: string;
  meetingDate: string;
  sourceTitle: string | null;
}

/**
 * Derives an item's state from its mentions, which must be in DUP-04 order (non-empty).
 * The latest mention wins (D8). A manual done holds while the latest mention is at or before the
 * manual position; a newer mention decides and clears it (DUP-21).
 */
export function deriveItem(mentions: Mention[], manualDoneAfter: Pos | null): Derived {
  const latest = mentions[mentions.length - 1]!;
  let dueRaw: string | null = null;
  let dueDate: string | null = null;
  const resolved = [...mentions].reverse().find((m) => m.dueDate !== null);
  if (resolved) {
    dueRaw = resolved.dueRaw;
    dueDate = resolved.dueDate;
  } else {
    const unparsed = [...mentions].reverse().find((m) => m.dueRaw !== null);
    if (unparsed) dueRaw = unparsed.dueRaw;
  }
  let status: "open" | "done" = latest.checked ? "done" : "open";
  let manual = manualDoneAfter;
  if (manual) {
    if (comparePos(posOf(latest), manual) <= 0) status = "done";
    else manual = null;
  }
  return {
    owner: latest.owner,
    task: latest.task,
    dueRaw,
    dueDate,
    status,
    manualDoneAfter: manual,
    sourceFile: latest.sourceFile,
    meetingDate: latest.meetingDate,
    sourceTitle: latest.sourceTitle,
  };
}
