/**
 * Date handling (spec 03). All dates are ISO "YYYY-MM-DD" strings, computed in UTC so results never
 * depend on the machine's time zone (G-03, G-04). Weeks run Monday (0) to Sunday (6).
 */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const WEEKDAYS: Record<string, number> = {
  mon: 0, monday: 0, tue: 1, tues: 1, tuesday: 1, wed: 2, wednesday: 2,
  thu: 3, thur: 3, thurs: 3, thursday: 3, fri: 4, friday: 4, sat: 5, saturday: 5, sun: 6, sunday: 6,
};

const WD = "(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";
const MON = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_DM = new RegExp(`^(?:${WD},?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MON})\\.?(?:\\s*,?\\s*(\\d{4}))?$`, "i");
const RE_MD = new RegExp(`^(?:${WD},?\\s+)?(${MON})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?$`, "i");
const RE_NEXT_WD = new RegExp(`^next\\s+(${WD})$`, "i");
const RE_WD = new RegExp(`^(${WD})$`, "i");
const RE_MID = new RegExp(`^mid[\\s-]+(${MON})$`, "i");

// ---------------------------------------------------------------- calendar helpers

function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

function toIso(y: number, m: number, d: number): string {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

function parts(iso: string): [number, number, number] {
  const m = RE_ISO.exec(iso);
  if (!m) throw new Error(`not an ISO date: ${iso}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = parts(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return toIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function daysBetween(fromIso: string, toIso_: string): number {
  const [y1, m1, d1] = parts(fromIso);
  const [y2, m2, d2] = parts(toIso_);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** Monday = 0 ... Sunday = 6. */
export function weekdayOf(iso: string): number {
  const [y, m, d] = parts(iso);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function isIsoDate(text: string): boolean {
  const m = RE_ISO.exec(text.trim());
  return !!m && isValidYmd(Number(m[1]), Number(m[2]), Number(m[3]));
}

export function todayIso(): string {
  const t = new Date();
  return toIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// ---------------------------------------------------------------- explicit dates

interface ExplicitMatch {
  /** The text has the shape of an explicit date. */
  matched: boolean;
  /** Null when the shape matched but the date cannot exist (DAT-23). */
  date: string | null;
  /** Explicit year was present. */
  hasYear: boolean;
}

/** DAT-10: with no year, use the meeting's year unless that lands more than 180 days back. */
function inferYear(m: number, d: number, meeting: string): string | null {
  const [my] = parts(meeting);
  if (!isValidYmd(my, m, d)) {
    // 29 Feb in a non-leap year: try next year only if that is valid, otherwise impossible.
    return null;
  }
  const candidate = toIso(my, m, d);
  if (daysBetween(candidate, meeting) > 180) {
    return isValidYmd(my + 1, m, d) ? toIso(my + 1, m, d) : null;
  }
  return candidate;
}

function matchExplicit(body: string, meeting: string | null): ExplicitMatch {
  let m = RE_ISO.exec(body);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return { matched: true, date: isValidYmd(y, mo, d) ? toIso(y, mo, d) : null, hasYear: true };
  }
  let day: number | undefined;
  let month: number | undefined;
  let year: number | undefined;
  m = RE_DM.exec(body);
  if (m) {
    day = Number(m[1]);
    month = MONTHS[m[2]!.toLowerCase()];
    year = m[3] ? Number(m[3]) : undefined;
  } else {
    m = RE_MD.exec(body);
    if (m) {
      month = MONTHS[m[1]!.toLowerCase()];
      day = Number(m[2]);
      year = m[3] ? Number(m[3]) : undefined;
    }
  }
  if (month === undefined || day === undefined) return { matched: false, date: null, hasYear: false };
  if (year !== undefined) {
    return { matched: true, date: isValidYmd(year, month, day) ? toIso(year, month, day) : null, hasYear: true };
  }
  if (meeting === null) return { matched: true, date: null, hasYear: false };
  return { matched: true, date: inferYear(month, day, meeting), hasYear: false };
}

/**
 * Parses a meeting date from a note header or a CLI option (ING-06). A year is required, so
 * "14 September" alone is rejected. Returns ISO or null.
 */
export function parseMeetingDate(text: string): string | null {
  const body = text.trim();
  if (!body) return null;
  const e = matchExplicit(body, null);
  return e.matched && e.hasYear ? e.date : null;
}

// ---------------------------------------------------------------- phrase grammar

interface Body {
  matched: boolean;
  /** Null with matched=true means a phrase of known shape that does not resolve (DAT-23). */
  date: string | null;
}

const NO: Body = { matched: false, date: null };

function fridayOfWeek(iso: string): string {
  return addDays(iso, 4 - weekdayOf(iso));
}

/** Resolves the text after an introducer. `explicitOnly` is for on/from/for (DAT-02). */
function resolveBody(raw: string, meeting: string, explicitOnly: boolean): Body {
  const b = raw.trim().replace(/[\s.,;:!]+$/, "");
  if (!b) return NO;

  const e = matchExplicit(b, meeting);
  if (e.matched) return { matched: true, date: e.date };
  if (explicitOnly) return NO;

  const lower = b.toLowerCase().replace(/\s+/g, " ");
  const [my, mm] = parts(meeting);

  if (lower === "tomorrow" || lower === "eod tomorrow") return { matched: true, date: addDays(meeting, 1) };
  if (["today", "eod", "eod today", "end of day", "cob"].includes(lower)) return { matched: true, date: meeting };

  if (lower === "end of week" || lower === "end of the week" || lower === "end of this week") {
    const fri = fridayOfWeek(meeting);
    return { matched: true, date: weekdayOf(meeting) >= 5 ? addDays(fri, 7) : fri };
  }
  if (lower === "end of next week" || lower === "end of the next week") {
    return { matched: true, date: addDays(fridayOfWeek(meeting), 7) };
  }
  if (lower === "end of month" || lower === "end of the month") {
    return { matched: true, date: toIso(my, mm, daysInMonth(my, mm)) };
  }

  let m = RE_MID.exec(b);
  if (m) return { matched: true, date: inferYear(MONTHS[m[1]!.toLowerCase()]!, 15, meeting) };

  m = RE_NEXT_WD.exec(b);
  if (m) {
    const target = WEEKDAYS[m[1]!.toLowerCase()]!;
    const mondayNextWeek = addDays(meeting, 7 - weekdayOf(meeting));
    return { matched: true, date: addDays(mondayNextWeek, target) };
  }

  m = RE_WD.exec(b);
  if (m) {
    const target = WEEKDAYS[m[1]!.toLowerCase()]!;
    let delta = (target - weekdayOf(meeting) + 7) % 7;
    if (delta === 0) delta = 7; // D9: strictly after the meeting date
    return { matched: true, date: addDays(meeting, delta) };
  }

  return NO;
}

export interface DueResult {
  /** Task text with the due phrase and a dangling separator removed (DAT-04). */
  task: string;
  /** The original phrase, e.g. "by Friday" (D10). Null when there was none. */
  dueRaw: string | null;
  dueDate: string | null;
  /** A trailing phrase was recognised as a due phrase but could not be resolved (DAT-21, DAT-23). */
  unparsed: boolean;
}

const INTRODUCER = /\b(due on|due|before|until|till|by|on|from|for)\b/gi;
const EXPLICIT_ONLY = new Set(["on", "from", "for"]);
const BARE_TRAILING = /(?:^|\s)(eod tomorrow|eod today|eod|end of day|tomorrow|today)[\s.,;:!]*$/i;
// "by <something>" is only treated as an unparseable due phrase when it reads like a time reference.
const BY_TIMEISH = /^(?:the\s+(?:end|start|beginning|close)\b|end\b|next\b|this\b|early\b|late\b|mid\b|soon\b|sometime\b|later\b|then\b)/i;

function cleanTask(s: string): string {
  return s.replace(/[\s,;:\-–—.]+$/, "").trim();
}

/** Finds and resolves the due phrase at the end of an action's text (DAT-01 to DAT-04, DAT-21 to DAT-23). */
export function extractDue(text: string, meetingDate: string): DueResult {
  const trimmed = text.trim();
  const cands: { index: number; word: string; end: number }[] = [];
  for (const m of trimmed.matchAll(INTRODUCER)) {
    cands.push({ index: m.index!, word: m[1]!.toLowerCase(), end: m.index! + m[0].length });
  }

  // The last candidate that resolves wins (DAT-01).
  for (let i = cands.length - 1; i >= 0; i--) {
    const c = cands[i]!;
    const body = resolveBody(trimmed.slice(c.end), meetingDate, EXPLICIT_ONLY.has(c.word));
    if (body.matched) {
      return {
        task: cleanTask(trimmed.slice(0, c.index)),
        dueRaw: trimmed.slice(c.index).replace(/[\s.,;:!]+$/, ""),
        dueDate: body.date,
        unparsed: body.date === null,
      };
    }
  }

  const bare = BARE_TRAILING.exec(trimmed);
  if (bare) {
    const phrase = bare[1]!;
    const body = resolveBody(phrase, meetingDate, false);
    if (body.matched) {
      return {
        task: cleanTask(trimmed.slice(0, bare.index)),
        dueRaw: phrase,
        dueDate: body.date,
        unparsed: body.date === null,
      };
    }
  }

  // DAT-21: a trailing before/until/till (or a time-like "by ...") phrase that matches no rule.
  for (let i = cands.length - 1; i >= 0; i--) {
    const c = cands[i]!;
    if (!["before", "until", "till", "by"].includes(c.word)) continue;
    const body = trimmed.slice(c.end).trim().replace(/[\s.,;:!]+$/, "");
    if (!body || /^\d/.test(body)) continue;
    if (body.split(/\s+/).length > 5) continue;
    if (c.word === "by" && !BY_TIMEISH.test(body)) continue;
    return {
      task: cleanTask(trimmed.slice(0, c.index)),
      dueRaw: trimmed.slice(c.index).replace(/[\s.,;:!]+$/, ""),
      dueDate: null,
      unparsed: true,
    };
  }

  return { task: trimmed, dueRaw: null, dueDate: null, unparsed: false };
}

/** DAT-03: resolves a table Due cell. An empty cell is neither resolved nor unparsed. */
export function resolveDuePhrase(cell: string, meetingDate: string): { dueDate: string | null; unparsed: boolean } {
  const c = cell.trim();
  if (!c) return { dueDate: null, unparsed: false };
  const withoutIntroducer = c.replace(/^(?:due on|due|before|until|till|by|on|from|for)\s+/i, "");
  const body = resolveBody(withoutIntroducer, meetingDate, false);
  if (body.matched && body.date) return { dueDate: body.date, unparsed: false };
  return { dueDate: null, unparsed: true };
}
