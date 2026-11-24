# 05 `list` and `done`

Decisions: D1, D18, D24, D27, D28, D30.

## Status model
- **LST-01** For an as-of date `A` (default today, `--as-of` overrides): **done** = status done; **overdue** = status open and `due_date < A`; **open** = status open and not overdue (no due date, or `due_date >= A`) (D27). An item due exactly on `A` is not overdue. Done items are never overdue.

## `actiontrack list`
Options: `--owner NAME`, `--status open|done|overdue`, `--due-before DATE`, `--as-of DATE`, `--json`, `--db PATH`.
- **LST-02** With no `--status`, `list` shows open **and** overdue items and hides done ones. `--status done` shows done items. `--status open` shows open-not-overdue (D27). `--status overdue` shows overdue only.
- **LST-03** `--owner` matches case-insensitively: a full name exactly, or a first name that belongs to exactly one known person. A first name shared by two or more people is an error (exit 1, candidates listed on stderr) (D24). An unknown name is an error (exit 1, known owners listed).
- **LST-04** Items with owner kind `unowned`, `group` or `ambiguous` never match `--owner`. When some ambiguous items were excluded this way, a footer says `N ambiguous-owner item(s) not shown; run without --owner to see them` (D30).
- **LST-05** `--due-before DATE` keeps items whose `due_date` is **strictly before** DATE. Items with no due date are excluded (D18). DATE accepts the same forms as note dates (ING-06).
- **LST-06** Filters combine with AND.
- **LST-07** Sort order: due date ascending with undated last, then id.
- **LST-08** Table columns: `ID`, `STATUS`, `OWNER`, `DUE`, `TASK`, `SOURCE`. `STATUS` shows `OPEN`, `DONE`, or `OVERDUE (Nd)`. `OWNER` shows the full name; `ambiguous: A | B`; `(unowned)`; or `(everyone)` / `(team)`. `DUE` shows the resolved date, or the raw phrase in brackets if unparsed, or `-`. `SOURCE` is the latest note's file name. A footer line gives the count.
- **LST-09** With no matches the output is `No items match.` and the exit code is 0.
- **LST-10** `--json` prints a JSON array. Each object has: `id`, `status` (`open|overdue|done`), `days_overdue` (integer or null), `owner` (`kind` is exactly one of `person`, `ambiguous`, `unowned`, `group`; `name`, `candidates`, and `group` which is `"everyone"`, `"team"` or null, set only when kind is `group`), `task`, `due_date`, `due_raw`, `source_file`, `meeting_date`, `source_title`, `history` (every mention as `file`, `line`, `meeting_date`, `checked`).
- **LST-11** An invalid `--status`, `--due-before` or `--as-of` value is a usage error (exit 2).
- **LST-12** If the database file does not exist, the message is `No data yet. Run: actiontrack ingest <folder>` and the exit code is 1.

## `actiontrack done <id>`
- **DNE-01** Marks item `<id>` done and prints `Item <id> marked done: <owner> - <task>`. Sets `manual_done_after` (DUP-20). Mentions are not modified.
- **DNE-02** Marking an already-done item is a no-op that prints `Item <id> is already done` and exits 0.
- **DNE-03** An unknown id prints `No item with id <id>` to stderr and exits 1.
- **DNE-04** A non-integer id is a usage error (exit 2).
- **DNE-05** The change is saved immediately, survives later commands, and survives re-ingest (DUP-21).
- **DNE-06** A manually done item no longer appears in the default `list` and is excluded from follow-ups.
