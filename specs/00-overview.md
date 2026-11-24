# 00 Overview

## Purpose
`actiontrack` turns a folder of markdown meeting notes into a tracked list of action items and prepares
follow-up emails as Gmail **drafts** for review. It never sends email.

## Commands
| Command | Summary | Spec |
|---|---|---|
| `actiontrack ingest <folder>` | Parse every `.md` note, store items | 01, 02, 03, 04 |
| `actiontrack list [filters]` | Show items | 05 |
| `actiontrack done <id>` | Mark an item done | 05 |
| `actiontrack followup <owner>` or `--all` | Build follow-up draft payload(s) | 06 |

Global options: `--db PATH` (default `actiontrack.db`), `--as-of YYYY-MM-DD` (list, followup; default today).

## Glossary
- **Note**: one `.md` file. Has a meeting date, optional attendees, free text and action lines.
- **Mention**: one action line found in one note. Immutable record of what the note said.
- **Item**: the tracked action. One item groups all mentions judged to be the same action (spec 04).
- **Owner kinds** (`owner_kind`, exactly these four values): `person` (resolved), `ambiguous` (candidates known), `unowned` (Someone, TBD, no recognisable owner), `group` (Everyone with tag `everyone`, Team with tag `team`). `group` is **not** a form of `unowned` (D6).
- **As-of date**: the reference date for overdue checks.

## Data model (SQLite)
- `notes(path PK, sha256, meeting_date, title, ingested_at)`: one row per ingested note.
- `mentions(id PK, item_id FK, source_file, line_no, meeting_date, source_title, checked, task_text, due_raw, due_date, owner_kind, owner_name, owner_candidates, group_tag)`.
- `items(id INTEGER PRIMARY KEY AUTOINCREMENT, owner_kind, owner_name, owner_candidates, group_tag, task, due_raw, due_date, status, manual_done_after, source_file, meeting_date, source_title)`.
- `skipped_notes(path PK, reason, ingested_at)`.
- `people(name PK)`: the roster of full names seen in attendee lists.

`items` state is **derived**: recomputed from the item's mentions ordered by (meeting_date, file name, line_no),
then the manual override (spec 05) is applied. IDs come from AUTOINCREMENT so they are never reused (D16, D33).
Each ingest regroups all stored mentions and reassigns item ids by the lowest-surviving-id rule (DUP-25 to DUP-29),
and a note that becomes malformed has its mentions removed first (D34, ING-36 to ING-41).

## Implementation notes (stack, D13)
The specs describe behaviour only and are stack-neutral. The implementation maps onto the stack like this:
- **Commander.js** defines the four commands and their options. `cli.ts` exports `run(argv, io)` so tests call the CLI in-process; the `bin` entry only forwards `process.argv`. Usage errors exit 2 (D28).
- **better-sqlite3** is the database driver (spec 00 data model). It is synchronous and native; enable foreign keys and run each ingest in one transaction.
- **Zod** validates data crossing a boundary: the parsed note header, the `people.json` file (FUP-10 to FUP-12), CLI option values (status, dates), and the JSON emitted by `list --json` and `followup --json` (LST-10, FUP-30), so the documented shapes are enforced in code.
- **Vitest** runs the tests. Test names cite the AC ids from the specs.
- Dates are handled as ISO `YYYY-MM-DD` strings and computed in UTC, so results do not depend on the machine's time zone (G-03, G-04).

## Global rules
- **G-01** No code path in the CLI sends email or holds Gmail credentials.
- **G-02** A bad input file never crashes the run. It is skipped and reported.
- **G-03** All dates are stored as ISO `YYYY-MM-DD`. Times of day are ignored.
- **G-04** Output is deterministic for the same database and `--as-of`.
- **G-05** Errors go to stderr; normal output to stdout.
