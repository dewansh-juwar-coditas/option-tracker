/**
 * Commander wiring for the four commands (spec 00). `run(argv, io)` is in-process so tests can call it.
 * Exit codes (D28): 0 ok, 1 not found or ambiguous, 2 usage or config error. stdout for results, stderr for errors (G-05).
 * Nothing here sends email or talks to Gmail (G-01).
 */
import { Command, CommanderError } from "commander";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { todayIso } from "./dates.js";
import { loadItems, markDone, openDb, ingestFolder } from "./db.js";
import { buildFollowup } from "./followup.js";
import { findPerson } from "./owners.js";
import { classify, compareByDue, formatIngestReport, formatListTable, itemToJson, ownerLabel } from "./report.js";
import {
  DateOptionSchema,
  FollowupOutputSchema,
  IngestReportSchema,
  ListOutputSchema,
  StatusSchema,
  parsePeople,
  type FollowupOutput,
  type People,
} from "./schemas.js";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Base for relative paths; defaults to the process working directory. */
  cwd?: string;
}

/** An error that ends the command with a message on stderr and a specific exit code. */
class CliError extends Error {
  constructor(
    message: string,
    readonly code: 1 | 2,
  ) {
    super(message);
  }
}
const usage = (m: string) => new CliError(m, 2);
const notFound = (m: string) => new CliError(m, 1);

const NO_DATA = "No data yet. Run: actiontrack ingest <folder>";

function parseDateOption(name: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const r = DateOptionSchema.safeParse(value);
  if (!r.success) throw usage(`Invalid value for ${name}: '${value}' is not a date (try 2026-09-09 or "9 September 2026")`);
  return r.data;
}

export async function run(argv: string[], io: CliIo): Promise<number> {
  const cwd = io.cwd ?? process.cwd();
  const path = (p: string) => resolve(cwd, p);
  const out = (s: string) => io.stdout(s.endsWith("\n") ? s : `${s}\n`);
  const err = (s: string) => io.stderr(s.endsWith("\n") ? s : `${s}\n`);

  const program = new Command();
  program
    .name("actiontrack")
    .description("Track action items from markdown meeting notes and prepare follow-up email drafts (never sent).")
    .option("--db <path>", "SQLite database file", "actiontrack.db")
    .exitOverride()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr });

  const dbPath = (cmd: Command): string => path(cmd.optsWithGlobals<{ db: string }>().db);
  const openExisting = (cmd: Command) => {
    const p = dbPath(cmd);
    if (!existsSync(p)) throw notFound(NO_DATA);
    return openDb(p);
  };

  // ------------------------------------------------------------------ ingest
  program
    .command("ingest")
    .description("Parse every .md note in a folder and store the action items")
    .argument("<folder>", "folder of markdown notes")
    .option("--json", "print the report as JSON")
    .action((folder: string, o: { json?: boolean }, cmd: Command) => {
      const dir = path(folder);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) throw usage(`Not a folder: ${folder}`);
      const db = openDb(dbPath(cmd));
      try {
        const report = IngestReportSchema.parse(ingestFolder(db, dir));
        out(o.json ? JSON.stringify(report, null, 2) : formatIngestReport(report));
      } finally {
        db.close();
      }
    });

  // ------------------------------------------------------------------ list
  program
    .command("list")
    .description("Show action items")
    .option("--owner <name>", "only this person's items")
    .option("--status <status>", "open | done | overdue")
    .option("--due-before <date>", "only items due strictly before this date")
    .option("--as-of <date>", "reference date for overdue checks (default today)")
    .option("--json", "print JSON")
    .action((o: { owner?: string; status?: string; dueBefore?: string; asOf?: string; json?: boolean }, cmd: Command) => {
      let status: "open" | "done" | "overdue" | undefined;
      if (o.status !== undefined) {
        const s = StatusSchema.safeParse(o.status);
        if (!s.success) throw usage(`Invalid --status '${o.status}': use open, done or overdue`);
        status = s.data;
      }
      const dueBefore = parseDateOption("--due-before", o.dueBefore);
      const asOf = parseDateOption("--as-of", o.asOf) ?? todayIso();

      const db = openExisting(cmd);
      let all;
      try {
        all = loadItems(db);
      } finally {
        db.close();
      }

      let owner: string | undefined;
      if (o.owner !== undefined) {
        const persons = [...new Set(all.filter((i) => i.owner.kind === "person").map((i) => i.owner.name!))];
        const m = findPerson(o.owner, persons);
        if (!m.ok) {
          throw notFound(
            m.reason === "ambiguous"
              ? `Ambiguous owner '${o.owner}': ${m.candidates.join(", ")}`
              : `Unknown owner '${o.owner}'. Known owners: ${persons.sort((a, b) => a.localeCompare(b)).join(", ") || "(none)"}`,
          );
        }
        owner = m.name;
      }

      // LST-02, LST-05: status and due-date filters, before the owner filter so LST-04 can count what it hides.
      const passes = all.filter((i) => {
        const c = classify(i, asOf).status;
        if (status === undefined ? c === "done" : c !== status) return false;
        if (dueBefore !== undefined && !(i.dueDate !== null && i.dueDate < dueBefore)) return false;
        return true;
      });
      const shown = (owner === undefined ? passes : passes.filter((i) => i.owner.kind === "person" && i.owner.name === owner)).sort(
        compareByDue,
      );
      const hidden = owner === undefined ? 0 : passes.filter((i) => i.owner.kind === "ambiguous").length;
      const footer = hidden > 0 ? [`${hidden} ambiguous-owner item(s) not shown; run without --owner to see them`] : [];

      if (o.json) {
        out(JSON.stringify(ListOutputSchema.parse(shown.map((i) => itemToJson(i, asOf))), null, 2));
      } else if (shown.length === 0) {
        out(["No items match.", ...footer].join("\n"));
      } else {
        out(formatListTable(shown, asOf, footer));
      }
    });

  // ------------------------------------------------------------------ done
  program
    .command("done")
    .description("Mark an item done")
    .argument("<id>", "item id")
    .action((idText: string, _o: unknown, cmd: Command) => {
      if (!/^\d+$/.test(idText) || !Number.isSafeInteger(Number(idText))) throw usage(`Invalid item id '${idText}': expected a whole number`);
      const id = Number(idText);
      const db = openExisting(cmd);
      try {
        const r = markDone(db, id);
        if (r.kind === "unknown") throw notFound(`No item with id ${id}`);
        out(r.kind === "already" ? `Item ${id} is already done` : `Item ${id} marked done: ${ownerLabel(r.item.owner)} - ${r.item.task}`);
      } finally {
        db.close();
      }
    });

  // ------------------------------------------------------------------ followup
  program
    .command("followup")
    .description("Prepare follow-up email drafts as structured data (nothing is sent)")
    .argument("[owner]", "person to prepare a draft for")
    .option("--all", "one draft per person with open or overdue items")
    .option("--json", "print JSON")
    .option("--as-of <date>", "reference date (default today)")
    .option("--people <path>", "name-to-email JSON file", "people.json")
    .action((owner: string | undefined, o: { all?: boolean; json?: boolean; asOf?: string; people: string }, cmd: Command) => {
      if ((owner === undefined) === (o.all !== true)) throw usage("Give exactly one of <owner> or --all");
      const asOf = parseDateOption("--as-of", o.asOf) ?? todayIso();

      // FUP-12: a missing people file is empty with a warning; an unreadable or invalid one is a config error.
      const warnings: string[] = [];
      let people: People = {};
      const peoplePath = path(o.people);
      if (existsSync(peoplePath)) {
        let text: string;
        try {
          text = readFileSync(peoplePath, "utf8");
        } catch (e) {
          throw usage(`Cannot read people file ${o.people}: ${(e as Error).message}`);
        }
        const parsed = parsePeople(text);
        if (!parsed.ok) throw usage(`Invalid people file ${o.people}: ${parsed.message}`);
        people = parsed.value;
      } else {
        warnings.push(`people file not found: ${o.people}; no email addresses are available`);
      }

      const db = openExisting(cmd);
      let items;
      try {
        items = loadItems(db);
      } finally {
        db.close();
      }

      const result = buildFollowup(items, owner !== undefined ? { owner } : { all: true }, asOf, people);
      if (!result.ok) throw notFound(result.message);
      const output = FollowupOutputSchema.parse({ ...result.output, warnings });
      if (o.json) {
        out(JSON.stringify(output, null, 2));
      } else {
        out(formatPreview(output, result.notes));
      }
    });

  // ------------------------------------------------------------------ run
  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (e) {
    if (e instanceof CliError) {
      err(e.message);
      return e.code;
    }
    if (e instanceof CommanderError) {
      // Commander already wrote its message through configureOutput.
      return ["commander.helpDisplayed", "commander.help", "commander.version"].includes(e.code) ? 0 : 2;
    }
    err(`Unexpected error: ${(e as Error).message}`);
    return 2;
  }
}

/** FUP-31: the readable preview of a followup result. */
function formatPreview(o: FollowupOutput, notes: string[]): string {
  const lines: string[] = [];
  for (const n of notes) lines.push(n);
  for (const d of o.drafts) {
    if (lines.length) lines.push("");
    lines.push(`Draft for ${d.owner}`, `To: ${d.to ?? "(no address)"}`, `Subject: ${d.subject}`, "Body:", "", d.body);
    for (const w of d.warnings) lines.push("", `Warning: ${w}`);
  }
  if (o.drafts.length) {
    lines.push(
      "",
      `Excluded (never drafted): ambiguous ${o.excluded.ambiguous}, unowned ${o.excluded.unowned}, group ${o.excluded.group}`,
    );
  }
  for (const w of o.warnings) lines.push(`Warning: ${w}`);
  return lines.join("\n");
}
