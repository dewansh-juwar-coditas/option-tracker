/** Note parsing (spec 01): header, malformed detection, and raw action lines. */
import { extractDue, parseMeetingDate, resolveDuePhrase } from "./dates.js";
import type { Mention, OwnerSpec, ParseResult, ParsedNote, RawItem } from "./models.js";
import { analyzeHead, splitLine } from "./owners.js";

const BINARY = "binary or not valid UTF-8 text";

/** Blank out HTML comments but keep their newlines so line numbers stay right (ING-17). */
function stripHtmlComments(text: string): string {
  const keepNewlines = (m: string) => m.replace(/[^\n]/g, "");
  return text.replace(/<!--[\s\S]*?-->/g, keepNewlines).replace(/<!--[\s\S]*$/, keepNewlines);
}

function splitCells(line: string): string[] {
  const t = line.trim();
  const cells = t.split("|").map((c) => c.trim());
  if (t.startsWith("|")) cells.shift();
  if (t.endsWith("|")) cells.pop();
  return cells;
}

function parseAttendees(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  const names = inner
    .split(",")
    .map((n) => n.trim().replace(/^["']|["']$/g, "").trim())
    .filter(Boolean);
  return [...new Set(names)];
}

const RE_FENCE = /^\s*(```|~~~)/;
const RE_CHECKBOX = /^\s*[-*+]\s*\[([ xX])\]\s*(.*)$/;
const RE_ACTION = /^\s*(?:[-*+]\s+)?action\s*:\s*(.*)$/i;
const RE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

export function parseNote(input: Buffer | string, fileName: string): ParseResult {
  let text: string;
  if (typeof input === "string") {
    text = input;
  } else {
    if (input.length === 0) return { ok: false, reason: "empty file" };
    if (input.includes(0)) return { ok: false, reason: BINARY };
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(input);
    } catch {
      return { ok: false, reason: BINARY };
    }
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.includes("\u0000")) return { ok: false, reason: BINARY };
  if (text.trim() === "") return { ok: false, reason: "empty file" };

  const lines = stripHtmlComments(text).split(/\r?\n/);

  // Front matter (ING-05): only when the very first line is ---.
  let start = 0;
  const fm: Record<string, string> = {};
  if (lines[0]!.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end > 0) {
      for (let i = 1; i < end; i++) {
        const m = /^(\w+)\s*:\s*(.*)$/.exec(lines[i]!);
        if (m) fm[m[1]!.toLowerCase()] = m[2]!;
      }
      start = end + 1;
    }
  }

  let title: string | null = fm["title"]?.trim() || null;
  let rawDate: string | null = fm["date"] ?? null;
  let rawAttendees: string | null = fm["attendees"] ?? null;
  const warnings: string[] = [];
  const items: RawItem[] = [];

  let inFence = false;
  let table: { owner: number; action: number; due: number; expectSeparator: boolean } | null = null;

  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;

    if (RE_FENCE.test(line)) {
      inFence = !inFence;
      table = null;
      continue;
    }
    if (inFence) continue;
    if (/^\s*>/.test(line)) continue; // blockquote (ING-17)

    // ---- table handling (ING-15)
    if (table) {
      if (table.expectSeparator) {
        table.expectSeparator = false;
        if (RE_SEPARATOR.test(line) && line.includes("-")) continue;
        table = null; // header not followed by a separator: not a real table
      } else if (line.trim().startsWith("|")) {
        const cells = splitCells(line);
        const action = (cells[table.action] ?? "").trim();
        if (action) {
          items.push({
            lineNo,
            kind: "table",
            checked: false,
            text: action,
            ownerCell: (cells[table.owner] ?? "").trim(),
            dueCell: table.due >= 0 ? (cells[table.due] ?? "").trim() : null,
          });
        }
        continue;
      } else {
        table = null;
      }
    }
    if (!table && line.includes("|") && line.trim().startsWith("|")) {
      const cells = splitCells(line).map((c) => c.toLowerCase());
      const owner = cells.indexOf("owner");
      const action = cells.indexOf("action");
      if (owner >= 0 && action >= 0) {
        table = { owner, action, due: cells.indexOf("due"), expectSeparator: true };
        continue;
      }
    }

    // ---- header fields (first occurrence wins)
    if (title === null) {
      const h = /^#\s+(.*\S)\s*$/.exec(line);
      if (h) {
        title = h[1]!.replace(/^meeting\s*:\s*/i, "").trim() || null;
        continue;
      }
    }
    if (rawDate === null) {
      const d = /^\s*date\s*:\s*(.+?)\s*$/i.exec(line);
      if (d) {
        rawDate = d[1]!;
        continue;
      }
    }
    if (rawAttendees === null) {
      const a = /^\s*attendees\s*:\s*(.*?)\s*$/i.exec(line);
      if (a) {
        rawAttendees = a[1]!;
        continue;
      }
    }

    // ---- action lines (ING-14, ING-16, ING-18)
    const cb = RE_CHECKBOX.exec(line);
    if (cb) {
      const body = cb[2]!.trim();
      if (!body) {
        warnings.push(`empty checkbox at line ${lineNo}`);
        continue;
      }
      items.push({ lineNo, kind: "checkbox", checked: cb[1] !== " ", text: body, ownerCell: null, dueCell: null });
      continue;
    }
    const act = RE_ACTION.exec(line);
    if (act) {
      const body = act[1]!.trim();
      if (!body) {
        warnings.push(`empty checkbox at line ${lineNo}`);
        continue;
      }
      items.push({ lineNo, kind: "action", checked: false, text: body, ownerCell: null, dueCell: null });
    }
  }

  // Date (ING-06, ING-07, ING-11).
  let date = rawDate === null ? null : parseMeetingDate(rawDate);
  let dateFromFileName = false;
  if (date === null) {
    const fromName = /^(\d{4}-\d{2}-\d{2})/.exec(fileName);
    const iso = fromName ? parseMeetingDate(fromName[1]!) : null;
    if (iso === null) return { ok: false, reason: "no usable meeting date" };
    date = iso;
    dateFromFileName = true;
    warnings.unshift("date taken from file name");
  }

  const attendees = rawAttendees === null ? [] : parseAttendees(rawAttendees);
  if (attendees.length === 0) warnings.push("no attendees listed");
  if (items.length === 0) warnings.push("no action items found");

  return { ok: true, note: { title, date, dateFromFileName, attendees, warnings, items } };
}

// ---------------------------------------------------------------- raw lines to resolved mentions (ING-19)


/**
 * Splits each raw item into owner(s), task and due phrase (specs 02 and 03). One mention per owner
 * (D21). `roster` is every full name from the ingested notes' attendee lists (D22, OWN-15).
 */
export function buildMentions(
  note: ParsedNote,
  fileName: string,
  roster: string[],
): { mentions: Mention[]; warnings: string[] } {
  const ctx = { attendees: note.attendees, roster };
  const mentions: Mention[] = [];
  const warnings: string[] = [];
  const unowned: OwnerSpec = { kind: "unowned", name: null, candidates: [], group: null };

  for (const raw of note.items) {
    let owners: OwnerSpec[];
    let task: string;
    let dueRaw: string | null = null;
    let dueDate: string | null = null;

    if (raw.kind === "table") {
      const h = analyzeHead(raw.ownerCell ?? "", ctx);
      owners = h.owners;
      warnings.push(...h.warnings);
      task = h.suffix ? `${raw.text} ${h.suffix}` : raw.text;
      const cell = (raw.dueCell ?? "").trim();
      if (cell) {
        dueRaw = cell;
        dueDate = resolveDuePhrase(cell, note.date).dueDate;
      }
    } else {
      const s = splitLine(raw.text);
      let suffix = "";
      if (s.shape === "none" || s.head === null) {
        owners = [{ ...unowned }];
      } else {
        const h = analyzeHead(s.head, ctx);
        owners = h.owners;
        suffix = h.suffix;
        warnings.push(...h.warnings);
      }
      const due = extractDue(s.task, note.date);
      dueRaw = due.dueRaw;
      dueDate = due.dueDate;
      const base = due.task || s.task;
      task = suffix ? `${base} ${suffix}` : base;
    }

    for (const owner of owners) {
      mentions.push({
        sourceFile: fileName,
        lineNo: raw.lineNo,
        meetingDate: note.date,
        sourceTitle: note.title,
        checked: raw.checked,
        task,
        dueRaw,
        dueDate,
        dueUnparsed: dueRaw !== null && dueDate === null,
        owner,
      });
    }
  }
  return { mentions, warnings: [...new Set(warnings)] };
}
