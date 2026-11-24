/** Exactly these four owner kinds exist everywhere (OWN-05a, D6). */
export type OwnerKind = "person" | "ambiguous" | "unowned" | "group";
export type GroupTag = "everyone" | "team";

export interface OwnerSpec {
  kind: OwnerKind;
  /** Full name; set for `person` only. */
  name: string | null;
  /** Candidate full names; set for `ambiguous` only. */
  candidates: string[];
  /** Set for `group` only. */
  group: GroupTag | null;
}

export interface RawItem {
  /** 1-based line number in the note. */
  lineNo: number;
  kind: "checkbox" | "table" | "action";
  checked: boolean;
  text: string;
  /** Table rows only. */
  ownerCell: string | null;
  /** Table rows only; null when the table has no Due column. */
  dueCell: string | null;
}

export interface ParsedNote {
  title: string | null;
  /** ISO meeting date. */
  date: string;
  dateFromFileName: boolean;
  attendees: string[];
  warnings: string[];
  items: RawItem[];
}

export type ParseResult = { ok: true; note: ParsedNote } | { ok: false; reason: string };

/** One action line from one note, fully resolved (spec 01 to 03). */
export interface Mention {
  sourceFile: string;
  lineNo: number;
  meetingDate: string;
  sourceTitle: string | null;
  checked: boolean;
  task: string;
  dueRaw: string | null;
  dueDate: string | null;
  dueUnparsed: boolean;
  owner: OwnerSpec;
}

/** Position of a mention in processing order (DUP-04): meeting date, file name, line number. */
export interface Pos {
  date: string;
  file: string;
  line: number;
}

/** One mention as shown in `list --json` under `history` (LST-10). */
export interface HistoryEntry {
  file: string;
  line: number;
  meetingDate: string;
  checked: boolean;
}

/** A tracked item with its derived state (spec 04). */
export interface Item {
  id: number;
  owner: OwnerSpec;
  task: string;
  dueRaw: string | null;
  dueDate: string | null;
  /** Stored status; overdue is computed against an as-of date (LST-01). */
  status: "open" | "done";
  manualDoneAfter: Pos | null;
  sourceFile: string;
  meetingDate: string;
  sourceTitle: string | null;
  history: HistoryEntry[];
}
