/** Shared test helpers: temp workspaces, in-process CLI calls, crafted notes. Not a test file. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "../src/cli.js";

export const SAMPLE_NOTES = resolve(import.meta.dirname, "..", "notes", "notes");

export interface CliResult {
  code: number;
  out: string;
  err: string;
}

/** Runs the CLI in-process (cli.ts exports run(argv, io)). */
export async function cli(args: string[], cwd?: string): Promise<CliResult> {
  let out = "";
  let err = "";
  const code = await run(args, {
    stdout: (s: string) => {
      out += s;
    },
    stderr: (s: string) => {
      err += s;
    },
    ...(cwd ? { cwd } : {}),
  });
  return { code, out, err };
}

const created: string[] = [];
export function cleanupAll(): void {
  for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true });
}

/** One note, built from a header and body lines. */
export function noteText(o: { date: string; title?: string; attendees?: string[]; body: string[] }): string {
  const head = [`# Meeting: ${o.title ?? "Sync"}`, `Date: ${o.date}`];
  if (o.attendees) head.push(`Attendees: ${o.attendees.join(", ")}`);
  return [...head, "", ...o.body].join("\n") + "\n";
}

export interface ListedItem {
  id: number;
  status: "open" | "overdue" | "done";
  days_overdue: number | null;
  owner: { kind: string; name: string | null; candidates: string[]; group: string | null };
  task: string;
  due_date: string | null;
  due_raw: string | null;
  source_file: string;
  meeting_date: string;
  source_title: string | null;
  history: { file: string; line: number; meeting_date: string; checked: boolean }[];
}

/** A temp folder with a notes directory and a database path. */
export class Workspace {
  readonly root = mkdtempSync(join(tmpdir(), "actiontrack-"));
  readonly notesDir = join(this.root, "notes");
  readonly db = join(this.root, "t.db");
  readonly people = join(this.root, "people.json");

  constructor() {
    created.push(this.root);
    mkdirSync(this.notesDir);
  }

  write(name: string, content: string | Buffer): void {
    writeFileSync(join(this.notesDir, name), content);
  }

  remove(name: string): void {
    rmSync(join(this.notesDir, name), { force: true });
  }

  /** Ingest the notes directory; asserts exit code 0 and returns the JSON report. */
  async ingest(): Promise<any> {
    const r = await cli(["ingest", this.notesDir, "--db", this.db, "--json"]);
    if (r.code !== 0) throw new Error(`ingest exit ${r.code}: ${r.err}`);
    return JSON.parse(r.out);
  }

  async ingestText(): Promise<CliResult> {
    return cli(["ingest", this.notesDir, "--db", this.db]);
  }

  /** `list --json` with the given extra args, parsed. */
  async list(args: string[] = [], asOf = "2026-12-31"): Promise<ListedItem[]> {
    const r = await cli(["list", "--db", this.db, "--json", "--as-of", asOf, ...args]);
    if (r.code !== 0) throw new Error(`list exit ${r.code}: ${r.err}`);
    return JSON.parse(r.out) as ListedItem[];
  }

  /** Every item whatever its status, ordered by id. */
  async items(asOf = "2026-12-31"): Promise<ListedItem[]> {
    const all = [
      ...(await this.list(["--status", "open"], asOf)),
      ...(await this.list(["--status", "overdue"], asOf)),
      ...(await this.list(["--status", "done"], asOf)),
    ];
    return all.sort((a, b) => a.id - b.id);
  }

  async followup(args: string[], asOf = "2026-03-10"): Promise<CliResult> {
    return cli(["followup", ...args, "--db", this.db, "--people", this.people, "--as-of", asOf]);
  }
}

export const PEOPLE = [
  "Anita Desai",
  "Rahul Mehta",
  "Rahul Verma",
  "Priya Nair",
  "Priya Shah",
  "Sam Okafor",
  "Lena Fischer",
];

/**
 * The crafted dataset used by the list, done and followup tests. As of 2026-03-10 (ids follow line order):
 * #1 overdue 5d, #2 open (due on the as-of date), #3 open, #4 open undated, #5 done, #6 open (unparsed due),
 * #7 overdue 1d, #8 and #9 ambiguous, #10 group, #11 unowned, #12 and #13 open, #14 done.
 */
export const CRAFTED_NOTE = noteText({
  date: "2026-03-02",
  title: "Planning sync",
  attendees: PEOPLE,
  body: [
    "- [ ] Anita to ship the report by 2026-03-05",
    "- [ ] Anita to plan the demo by 2026-03-10",
    "- [ ] Anita to book travel by 2026-03-20",
    "- [ ] Sam to tidy the wiki",
    "- [x] Sam to publish the notes by 2026-03-04",
    "- [ ] Sam to rotate the keys before cutover",
    "- [ ] Sam to send the invoice by 2026-03-09",
    "- [ ] Rahul to review the code",
    "- [ ] Priya to sign off the checklist",
    "- [ ] Everyone to read the handbook",
    "- [ ] TBD to pick a vendor",
    "- [ ] Priya N. to draft the budget by 2026-03-12",
    "- [ ] Priya S. to run the audit by 2026-03-13",
    "- [x] Lena to file the report",
  ],
});

export async function craftedWorkspace(): Promise<Workspace> {
  const ws = new Workspace();
  ws.write("2026-03-02-planning.md", CRAFTED_NOTE);
  await ws.ingest();
  return ws;
}

export const PEOPLE_JSON = JSON.stringify({
  "anita desai": "anita@example.com",
  "Priya Nair": "priya.nair@example.com",
  "Priya Shah": "priya.shah@example.com",
});
