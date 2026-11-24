/**
 * Follow-up draft preparation (spec 06). Pure: items in, structured draft data out.
 * Nothing here sends mail or talks to Gmail; the skill creates drafts from this output (D3, G-01).
 */
import { findPerson } from "./owners.js";
import type { Item } from "./models.js";
import { classify, compareByDue } from "./report.js";
import type { Draft, FollowupOutput, People } from "./schemas.js";

export type FollowupTarget = { owner: string } | { all: true };

export type FollowupResult =
  | { ok: true; output: FollowupOutput; notes: string[] }
  | { ok: false; message: string };

const capitalise = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** FUP-24: the note's title, else the file name without its extension. */
function meetingTitle(item: Item): string {
  return item.sourceTitle ?? item.sourceFile.replace(/\.[^./\\]+$/, "");
}

function lookupEmail(people: People, name: string): string | null {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(people)) {
    if (k.trim().toLowerCase() === want) return v;
  }
  return null;
}

function itemLine(item: Item, detail: string): string {
  return `- [#${item.id}] ${capitalise(item.task)} (${detail}). From: ${meetingTitle(item)}, ${item.meetingDate}`;
}

function buildDraft(name: string, items: Item[], asOf: string, people: People): Draft | null {
  const live = items.filter((i) => i.status !== "done");
  const overdue = live
    .map((i) => ({ i, c: classify(i, asOf) }))
    .filter((x) => x.c.status === "overdue")
    .sort((a, b) => b.c.daysOverdue! - a.c.daysOverdue! || a.i.id - b.i.id);
  const overdueIds = new Set(overdue.map((x) => x.i.id));
  const open = live.filter((i) => !overdueIds.has(i.id)).sort(compareByDue);
  if (overdue.length === 0 && open.length === 0) return null;

  const sections: string[] = [];
  if (overdue.length) {
    sections.push(
      [
        `Overdue (${overdue.length})`,
        ...overdue.map(({ i, c }) =>
          itemLine(i, `due ${i.dueDate}, ${c.daysOverdue} ${c.daysOverdue === 1 ? "day" : "days"} overdue`),
        ),
      ].join("\n"),
    );
  }
  if (open.length) {
    sections.push(
      [
        `Open (${open.length})`,
        ...open.map((i) =>
          itemLine(i, i.dueDate ? `due ${i.dueDate}` : i.dueRaw ? `due: "${i.dueRaw}"` : "no due date"),
        ),
      ].join("\n"),
    );
  }

  const body = [
    `Hi ${name.split(/\s+/)[0]},`,
    `Here is where your action items stand as of ${asOf}.`,
    ...sections,
    "Please reply when any of these are done, or let me know if a due date needs to change.",
    "Thanks,",
  ].join("\n\n");

  const to = lookupEmail(people, name);
  return {
    owner: name,
    to,
    subject: `Action items follow-up: ${name} (${overdue.length} overdue, ${open.length} open)`,
    body,
    item_ids: [...overdue.map((x) => x.i.id), ...open.map((i) => i.id)],
    counts: { overdue: overdue.length, open: open.length },
    warnings: to === null ? [`no email address for ${name}`] : [],
    send: false,
  };
}

/** FUP-02 to FUP-06, FUP-20 to FUP-24, FUP-30. */
export function buildFollowup(items: Item[], target: FollowupTarget, asOf: string, people: People): FollowupResult {
  const persons = [...new Set(items.filter((i) => i.owner.kind === "person").map((i) => i.owner.name!))].sort((a, b) =>
    a.localeCompare(b),
  );

  // FUP-04: say how many were left out, so nothing is silently dropped.
  const excluded = { ambiguous: 0, unowned: 0, group: 0 };
  for (const i of items) {
    if (i.status === "done") continue;
    if (i.owner.kind === "ambiguous") excluded.ambiguous++;
    else if (i.owner.kind === "unowned") excluded.unowned++;
    else if (i.owner.kind === "group") excluded.group++;
  }

  let names: string[];
  if ("all" in target) {
    names = persons;
  } else {
    const m = findPerson(target.owner, persons);
    if (!m.ok) {
      const message =
        m.reason === "ambiguous"
          ? `Ambiguous owner '${target.owner}': ${m.candidates.join(", ")}`
          : `Unknown owner '${target.owner}'. Known owners: ${persons.length ? persons.join(", ") : "(none)"}`;
      return { ok: false, message };
    }
    names = [m.name];
  }

  const drafts: Draft[] = [];
  const notes: string[] = [];
  for (const name of names) {
    const draft = buildDraft(
      name,
      items.filter((i) => i.owner.kind === "person" && i.owner.name === name),
      asOf,
      people,
    );
    if (draft) drafts.push(draft);
    else if (!("all" in target)) notes.push(`No open or overdue items for ${name}`);
  }
  return { ok: true, output: { as_of: asOf, drafts, excluded, warnings: [] }, notes };
}
