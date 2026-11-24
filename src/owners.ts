/** Owner extraction and resolution (spec 02: D5, D6, D21, D22, D23, D25, D31). */
import type { OwnerSpec } from "./models.js";

export interface OwnerContext {
  /** Full names listed for the meeting. */
  attendees: string[];
  /** Every full name seen in any note's attendee list (D22). */
  roster: string[];
}

const GROUP_WORDS: Record<string, "everyone" | "team"> = { everyone: "everyone", team: "team" };
const UNOWNED_WORDS = new Set(["someone", "tbd", "anyone", "unassigned", "?"]);

const UNOWNED: OwnerSpec = { kind: "unowned", name: null, candidates: [], group: null };
const unowned = (): OwnerSpec => ({ ...UNOWNED, candidates: [] });

// ---------------------------------------------------------------- name resolution

export type ResolvedName = OwnerSpec & { warning?: string };

function matches(full: string, query: string): boolean {
  const toks = full.trim().split(/\s+/);
  const first = toks[0]!.toLowerCase();
  const last = toks[toks.length - 1]!.toLowerCase();
  const q = query.trim();
  const initial = /^([A-Za-z'’-]+)\s+([A-Za-z])\.?$/.exec(q);
  if (initial) {
    return first === initial[1]!.toLowerCase() && last.startsWith(initial[2]!.toLowerCase());
  }
  if (/\s/.test(q)) return full.trim().toLowerCase() === q.replace(/\s+/g, " ").toLowerCase();
  return first === q.toLowerCase();
}

function distinct(names: string[]): string[] {
  return [...new Set(names.map((n) => n.trim()))];
}

/** OWN-09 to OWN-13: attendees first, then the roster, then keep the text as typed. */
export function resolveName(text: string, attendees: string[], roster: string[]): ResolvedName {
  const q = text.trim().replace(/^@/, "");
  for (const pool of [attendees, roster]) {
    const found = distinct(pool.filter((n) => matches(n, q))).sort((a, b) => a.localeCompare(b));
    if (found.length === 1) return { kind: "person", name: found[0]!, candidates: [], group: null };
    if (found.length > 1) return { kind: "ambiguous", name: null, candidates: found, group: null };
  }
  return {
    kind: "person",
    name: q,
    candidates: [],
    group: null,
    warning: `owner not in attendees or roster: ${q}`,
  };
}

// ---------------------------------------------------------------- head analysis

const NAME_PART = /^@?[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*\.?){0,2}$/;

function splitParts(head: string): string[] {
  return head
    .split(/\s*(?:&|,|\/|\band\b)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
}

function stripParens(head: string): { head: string; suffix: string[] } {
  const suffix: string[] = [];
  const rest = head.replace(/\([^)]*\)/g, (m) => {
    suffix.push(m.trim());
    return " ";
  });
  return { head: rest.replace(/\s+/g, " ").trim(), suffix };
}

export interface HeadAnalysis {
  owners: OwnerSpec[];
  /** Parenthetical text such as "(with Priya)", to be appended to the task (OWN-04). */
  suffix: string;
  warnings: string[];
}

/** Classifies and resolves an owner head or a table Owner cell (OWN-02, OWN-04 to OWN-07). */
export function analyzeHead(head: string, ctx: OwnerContext): HeadAnalysis {
  const { head: bare, suffix } = stripParens(head);
  const parts = splitParts(bare);
  if (parts.length === 0) return { owners: [unowned()], suffix: suffix.join(" "), warnings: [] };

  const owners: OwnerSpec[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const lower = part.toLowerCase();
    let owner: OwnerSpec;
    if (GROUP_WORDS[lower]) {
      owner = { kind: "group", name: null, candidates: [], group: GROUP_WORDS[lower]! };
    } else if (UNOWNED_WORDS.has(lower)) {
      owner = unowned();
    } else {
      const r = resolveName(part, ctx.attendees, ctx.roster);
      const { warning, ...spec } = r;
      if (warning) warnings.push(warning);
      owner = spec;
    }
    const id = JSON.stringify(owner);
    if (!seen.has(id)) {
      seen.add(id);
      owners.push(owner);
    }
  }
  return { owners, suffix: suffix.join(" "), warnings };
}

/** True when the text before "to"/"will" reads like owner names (OWN-01, D31). */
function looksLikeHead(head: string): boolean {
  const { head: bare } = stripParens(head);
  if (!bare) return false;
  if (bare.split(/\s+/).length > 6) return false;
  const parts = splitParts(bare);
  if (parts.length === 0) return false;
  return parts.every((p) => UNOWNED_WORDS.has(p.toLowerCase()) || NAME_PART.test(p));
}

export type Shape = "to" | "colon" | "none";

/** OWN-01: split an action line into owner head and task. */
export function splitLine(text: string): { shape: Shape; head: string | null; task: string } {
  const t = text.trim();
  const colon = /^(@[A-Za-z][\w'’.-]*)\s*:\s*([\s\S]*)$/.exec(t);
  if (colon) return { shape: "colon", head: colon[1]!, task: colon[2]!.trim() };

  const m = /\s(?:to|will)\s/i.exec(t);
  if (m && m.index > 0) {
    const head = t.slice(0, m.index);
    if (looksLikeHead(head)) {
      return { shape: "to", head, task: t.slice(m.index + m[0].length).trim() };
    }
  }
  return { shape: "none", head: null, task: t };
}

export interface OwnerAnalysis {
  owners: OwnerSpec[];
  task: string;
  warnings: string[];
}

/** Splits a line and resolves its owner(s). A line with no recognisable owner is unowned (D25). */
export function analyzeOwner(text: string, ctx: OwnerContext): OwnerAnalysis {
  const s = splitLine(text);
  if (s.shape === "none" || s.head === null) {
    return { owners: [unowned()], task: s.task, warnings: [] };
  }
  const h = analyzeHead(s.head, ctx);
  const task = h.suffix ? `${s.task} ${h.suffix}`.trim() : s.task;
  return { owners: h.owners, task, warnings: h.warnings };
}

export type PersonMatch =
  | { ok: true; name: string }
  | { ok: false; reason: "unknown" | "ambiguous"; candidates: string[] };

/**
 * D24 (`--owner`, `followup <owner>`): case-insensitive full name, or a first name that belongs to
 * exactly one known person. A full name wins even when its first name is shared.
 */
export function findPerson(query: string, known: string[]): PersonMatch {
  const q = query.trim().replace(/\s+/g, " ").toLowerCase();
  if (!q) return { ok: false, reason: "unknown", candidates: [] };
  const names = [...new Set(known)].sort((a, b) => a.localeCompare(b));
  const full = names.filter((n) => n.toLowerCase() === q);
  if (full.length === 1) return { ok: true, name: full[0]! };
  const byFirst = names.filter((n) => n.split(/\s+/)[0]!.toLowerCase() === q);
  if (byFirst.length === 1) return { ok: true, name: byFirst[0]! };
  if (byFirst.length > 1) return { ok: false, reason: "ambiguous", candidates: byFirst };
  return { ok: false, reason: "unknown", candidates: [] };
}
