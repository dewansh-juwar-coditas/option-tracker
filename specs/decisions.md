# Decisions log

Source of truth for choices made while turning the (truncated) assessment brief into specs.
Each was agreed with the user one question at a time. Changing one means: edit this file, then the
affected spec, then tests, then code.

## Change log
- Stack switched from Python to TypeScript/Node (D13). No functional change; specs 01 to 06 untouched. Spec 00 gained an "Implementation notes (stack)" section only.
- Four clarifications requested before implementation (no other decision changed):
  1. D6 clarified: Everyone and Team are `owner_kind = group`, never `unowned`.
  2. D23 clarified: both `@anita: ...` and `@anita to ...` documented and tested.
  3. D33 added: ID preservation when existing items merge on re-ingest (lowest id survives, ids never reused).
  4. D34 added: a previously ingested note that becomes malformed has its mentions removed and affected items re-derived.

## Confirmed

| # | Topic | Decision |
|---|---|---|
| D1 | Overdue reference | An item is overdue when it is open and its due date is **before** the as-of date. As-of defaults to today; `--as-of <date>` overrides it. |
| D2 | Recipient email | A name-to-email config file (`people.json`). An owner with no mapping still gets a draft, with no To address and a warning. |
| D3 | Gmail integration | The CLI never talks to Gmail. `followup` outputs structured JSON; the Claude skill tells Claude Code to create the draft with the Gmail MCP connector. Nothing is ever sent. |
| D4 | followup argument | `followup <owner>` or `followup --all`. An ambiguous name is rejected with the candidates listed. |
| D5 | Same first name | A bare first name matching two attendees of the same meeting leaves the owner **ambiguous** (candidates stored). It is reported at ingest, shown in `list`, and excluded from drafts. |
| D6 | Group / unassigned owners | `Everyone` and `Team` have `owner_kind = group` (**not** `unowned`), with group tag `everyone` / `team` respectively. `Someone`, `TBD` (and `Anyone`, `Unassigned`, per D31) have `owner_kind = unowned` with no group tag. None of them appear in follow-up drafts. *Clarified: group is its own owner kind.* |
| D7 | Duplicates | Same resolved owner plus a normalized, fuzzy task match merges mentions into one item. Merges are reported. |
| D8 | Merge rule | The latest mention wins for status and due date. A later mention with no due date keeps the last known date. Earlier sources are kept as history. |
| D9 | Bare weekday | "by Friday" is the first such weekday **strictly after** the meeting date. "next Tuesday" is that weekday in the following week. |
| D10 | Vague due phrases | Fixed mapping table (see spec 03). The raw phrase is always kept. A phrase with no rule gives no due date and is reported as unparsed. |
| D11 | Malformed notes | Skip and report when the file is empty, unreadable or binary, or has no usable date. The filename `YYYY-MM-DD` prefix is the date fallback (with a warning). A missing attendees line only warns. Non-`.md` files are ignored. |
| D12 | Item formats | `-`, `*`, `+` checkboxes (nested too, `[x]` or `[X]` = done), table rows under an Owner/Action/Due header, and `ACTION:` lines. Code fences, blockquotes and HTML comments are ignored. |
| D13 | Language and stack | **TypeScript on Node.js** (Node 22 or newer). Commander.js for the CLI, better-sqlite3 for SQLite, Zod for validation, Vitest for tests. *Changed from Python at the user's request; every functional decision and spec is unchanged.* |
| D14 | Storage | SQLite file with tables for items, mentions (source history) and skipped notes. |
| D15 | Re-ingest | Idempotent, stable IDs. A manual `done` sticks unless a newer note overrides it. |
| D16 | IDs | Sequential integers, never reused. |
| D17 | Email layout | Subject `Action items follow-up: <Owner> (N overdue, M open)`. Body has Overdue (days overdue) then Open. Each line has ID, task, due date and source meeting. Neutral tone. |
| D18 | list defaults | Default shows open and overdue items; done is hidden unless `--status done`. `--due-before` is strictly before the date and excludes undated items. Table output plus `--json`. |
| D19 | Skills files | Both a root `skills.md` and a real `.claude/skills/actiontrack-followup/SKILL.md`, kept in sync. |
| D20 | Location | Project root `ai-practioner-ev`, own git repo. Nothing is committed until the user asks. |
| D21 | Multiple owners | One item per owner (`Anita & Rahul to agree` gives two items). `Lena (with Priya) to ...` gives one item for Lena, with Priya noted in the task text. |


## Confirmed after review (formerly proposed defaults P1 to P11)

All eleven were accepted as written, one at a time. The specs refer to them by their D number.

| # | Was | Topic | Decision |
|---|---|---|---|
| D22 | P1 | Notes with no attendees | If the attendee list is empty or has no match, resolve first names against a **roster** built from every note's attendee list. One match resolves, two or more is ambiguous, none keeps the raw name as typed (with a warning). |
| D23 | P2 | Owner syntax | `@anita` means Anita. Both forms are supported and tested: `@anita: Review the API documentation` (colon form) and `@anita to review the API documentation` (to form). `Priya N.` / `Priya S.` resolve by last-name initial. *Clarified: both `@` forms are explicit.* |
| D24 | P3 | Owner name matching (`--owner`, `followup <owner>`) | Case-insensitive. Full name exact, or a first name that matches exactly one person. An ambiguous first name is an error that lists the candidates. |
| D25 | P4 | Line with no `<owner> to <task>` shape | Stored unowned with the whole line as the task. |
| D26 | P5 | Default paths | Database `actiontrack.db` and people file `people.json`, both in the current directory. Overrides: `--db`, `--people`. |
| D27 | P6 | `--status open` meaning | `open` = not done and not overdue, so `open`, `overdue` and `done` are disjoint. The unfiltered default still shows open and overdue together (D18). |
| D28 | P7 | Exit codes | 0 success (even if notes were skipped). 1 not found or ambiguous (unknown id, unknown or ambiguous owner, no database yet). 2 usage or config error (bad option value, missing folder, invalid people file). |
| D29 | P8 | Folder scan depth | `ingest` reads only `.md` files directly in the folder, not sub-folders. |
| D30 | P9 | `--owner` and ambiguous items | Ambiguous-owner items never match `--owner`; a footer says how many were left out. |
| D31 | P10 | Owner-text parsing limits | Owner head = text before the first standalone `to`/`will`, at most 6 words. Group words: Everyone, Team. Unowned words: Someone, TBD, Anyone, Unassigned. |
| D32 | P11 | Meeting title | Shown in emails: from `# Meeting:`, front-matter `title:` or first heading, else the file name without extension. |
| D33 | - | ID preservation on merge | Item IDs are stable across re-ingest. When a re-ingest causes several existing items to merge into one, the **lowest** existing id survives and the other ids are deleted. A deleted id is **never reused**; new items always get an id higher than any id ever issued. See DUP-25 to DUP-29. |
| D34 | - | Previously ingested note becomes malformed | If a note that was ingested earlier is changed so that it is now malformed (empty, binary or no usable date), its previous mentions are **removed** and every affected item is **re-derived**; items left with no mentions are deleted. Stale actions never remain. The note is reported as skipped. See ING-36 to ING-41. |
