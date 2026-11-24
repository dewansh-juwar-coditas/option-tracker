# 01 Ingest and parsing

Covers `actiontrack ingest <folder>`: which files are read, how a note's header and action lines are
parsed, what counts as malformed, and what the report says. Owner resolution is spec 02, due dates
spec 03, duplicate merging spec 04.

## Scope of a folder scan
- **ING-01** Only files directly inside `<folder>` whose extension is `.md` (case-insensitive) are read. Sub-folders are not entered (D29). Other files (e.g. `.txt`) are ignored and counted as "ignored", not "skipped".
- **ING-02** A missing or non-directory `<folder>` is a usage error: message on stderr, exit code 2, no database change.
- **ING-03** Files are processed in a stable order (sorted by file name). Because state is derived from mentions ordered by meeting date, the result does not depend on processing order.

## Note header
Two header styles are supported; keys are case-insensitive.
- **ING-04** *Heading style*: a first `#` heading (optionally `# Meeting: <title>`), then `Date: <date>` and `Attendees: A, B, C` lines.
- **ING-05** *Front-matter style*: a leading `---` block with `title:`, `date:` and `attendees: [A, B, C]` (an inline list; a plain comma list is also accepted). Front-matter lines are never scanned for action items.
- **ING-06** Accepted date forms: `2026-09-01`, `9 September 2026`, `Monday, 14 September 2026` (also `September 9, 2026`). Month names may be abbreviated.
- **ING-07** If `Date:` is missing or unparseable and the file name starts with `YYYY-MM-DD`, that date is used and a warning `date taken from file name` is reported. (D11)
- **ING-08** A missing attendees line does not skip the note; it is ingested with an empty attendee list and a warning `no attendees listed`.

## Malformed notes
A note is **skipped and reported** (never a crash, G-02) with a reason when:
- **ING-09** the file is empty or whitespace only (`empty file`);
- **ING-10** the bytes contain a NUL or are not valid UTF-8 (`binary or not valid UTF-8 text`);
- **ING-11** no usable meeting date exists after ING-06 and ING-07 (`no usable meeting date`);
- **ING-12** any unexpected exception occurs while parsing that file (`parse error: <message>`). The next file is still processed.

A skipped note stores a row in `skipped_notes` and contributes no items.
- **ING-13** A valid note that contains no action lines is ingested with 0 items and a warning `no action items found`.

## Action lines
Everything below is scanned only in the note body, after front matter.
- **ING-14** A checkbox line is `-`, `*` or `+`, then `[ ]`, `[x]` or `[X]`, then text. Space after `]` is optional (`- [ ]Priya to ...`). `[ ]` is open; `[x]`/`[X]` is done. Indentation (nesting) does not matter; a nested checkbox is its own item.
- **ING-15** A table whose header row has `Owner` and `Action` columns (and optionally `Due`) yields one open item per data row: owner cell, task cell, due cell. The separator row and the header are not items.
- **ING-16** A line starting with `ACTION:` (case-insensitive, optional bullet) yields one open item from the text after the colon.
- **ING-17** These are **ignored**, even when they contain checkbox syntax: fenced code blocks (``` or ~~~), blockquote lines (starting with `>`), and HTML comments (`<!-- ... -->`, including multi-line).
- **ING-18** A checkbox with empty text is ignored with a warning.
- **ING-19** Each item line is split into `owner`, `task`, `due_raw` per specs 02 and 03. `task` keeps the original wording minus the due phrase and trailing punctuation.

## Re-ingest and storage
- **ING-20** Re-running ingest on unchanged files changes nothing (compared by sha256) and reports them as `unchanged`.
- **ING-21** A changed file replaces its own mentions; items are re-derived (spec 04) and keep their IDs when still matched, with the id rules of DUP-25 to DUP-29 (D33).
- **ING-22** Items left with no mentions after a replace are deleted; their IDs are never reused (D16, DUP-24).
- **ING-22a** A file is in exactly one state at a time: ingested (a row in `notes`) or skipped (a row in `skipped_notes`). Moving between states removes the row from the other table.

## A previously ingested note that becomes malformed (D34)
"Becomes malformed" means the file was ingested earlier and, on a later ingest, is changed (different sha256) so that it now meets ING-09, ING-10, ING-11 or ING-12. A file whose content did not change is never re-judged.
- **ING-36** All **mentions** that came from that file are removed. Nothing from the old content survives.
- **ING-37** Every item that had a mention from that file is **re-derived** from its remaining mentions (spec 04, including the re-grouping of DUP-25 to DUP-29a). Its status, due date, task text, source and history now reflect only the remaining mentions. An item with no remaining mention is **deleted** and its id is never reused.
- **ING-38** The file's row moves from `notes` to `skipped_notes` with the new reason (ING-22a). The roster used for owner resolution (D22) is rebuilt from the remaining ingested notes only, so names that came solely from the removed file no longer count.
- **ING-39** The stale-action cleanup applies even if the item was marked done manually: if the item still has other mentions it stays done by DUP-21 (its latest remaining mention is at or before the manual position); if it has none it is deleted.
- **ING-40** The ingest report says so explicitly: the file under *skipped* with its reason, plus a line `previously ingested: removed N mention(s), deleted items #a, #b, re-derived items #c, #d`. The exit code stays 0 (D28).
- **ING-41** The reverse also holds: a file that was skipped and later becomes valid is ingested normally and its `skipped_notes` row is removed (ING-22a).

### Required tests (crafted fixtures)
- **ING-42** Note N1 has `- [ ] Priya Nair to send the quote by Friday` and N2 (later date) repeats it. Ingest: one item with two mentions. Empty out N1 and re-ingest: N1 is reported skipped (`empty file`), the item now has one mention (from N2), its source and history point to N2, and the item keeps its id.
- **ING-43** Note N3 is the only source of `Sam to rotate the keys`. Replace N3 with binary content and re-ingest: N3 skipped (`binary or not valid UTF-8 text`), the item is gone from `list`, its id is not reused by the next new item.
- **ING-44** Replace N3's date line with `Date: sometime last week` and rename nothing: with no filename date either, N3 is skipped (`no usable meeting date`) and its mentions are removed. With a `YYYY-MM-DD` filename prefix the note is **not** malformed (ING-07 fallback) and is ingested with a warning instead.
- **ING-45** The stale item that was manually done and has no other mention is deleted (ING-39); one that has other mentions stays done.
- **ING-46** Restoring N1's original content later re-ingests it normally: its mentions come back, the item re-merges (new ids follow DUP-24, because deleted ids are never reused), and N1 leaves `skipped_notes`.

## Ingest report
Printed to stdout at the end; `--json` prints the same data as JSON.
- **ING-23** Counts: notes ingested (new or changed) / unchanged / skipped / ignored; items created / updated / unchanged / absorbed (existing items merged into another, id deleted) / deleted (no mentions left).
- **ING-24** A list of skipped notes with reasons.
- **ING-25** A list of warnings (missing attendees, date from file name, no action items, empty checkbox).
- **ING-26** A list of ambiguous-owner items (note, line, candidates), and of due phrases that could not be resolved.
- **ING-27** A list of merges (which mentions were grouped into which item ID).
- **ING-28** Exit code 0 even when some notes were skipped.

## Expected results on the provided `notes/notes` folder
These become integration tests.
- **ING-30** 35 `.md` files and 1 `.txt`. Result: **32 ingested, 3 skipped, 1 ignored**.
- **ING-31** Skipped: `2026-09-09-notes-final-v2.md` (empty), `scratch.md` (binary), `untitled.md` (no usable date).
- **ING-32** Warnings include: `2026-10-03-sales-pipeline.md` date from file name (header says "sometime last week"); `2026-09-23-standup.md` no attendees.
- **ING-33** These produce no item: the quoted `> - [ ] Karan to refund affected customers by Friday` (09-21), the fenced template line in 10-09, the HTML-commented `Sam to buy hardware tokens` (10-09), and `Book the venue` (.txt).
- **ING-34** These do produce items: the `*` and `+` bullets, the nested `Karan to validate targets against the budget`, the table row (Anita, `Refresh the brand kit`, 2026-10-09) and `ACTION: Karan to circulate the offsite summary tomorrow` (all in 09-30 offsite).
- **ING-35** Both 09-16 and 09-30 standups use front matter and are parsed (attendees from the inline list).
