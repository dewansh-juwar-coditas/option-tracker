# 04 Duplicates and merging

The same action is often restated across meetings, reworded and re-dated, and eventually ticked off.
This spec groups such mentions into one **item** and derives its state. Decisions: D7, D8, D15, D16.

## Matching
- **DUP-01** Normalized task key: lowercase; drop a possessive `'s`; replace every non-alphanumeric with a space; drop stop words (`the a an to of for with by on in at and our their up`); drop **version qualifiers** (`first updated revised final new latest`), because a restated action is often just the next version of the same deliverable ("share first wireframes", later "share updated wireframes"); keep the remaining words as a **set**. (Checked against the sample notes: without the qualifier rule the wireframes mentions score only 0.50 and would not merge.)
- **DUP-02** Two mentions may share an item only if their **owner keys are equal**: the same resolved person; or `ambiguous` with the same candidate set; or both `unowned`; or both `group` with the same tag. A person never merges with an ambiguous or unowned mention.
- **DUP-03** Similarity is Jaccard: |A ∩ B| / |A ∪ B| over the word sets. Mentions match when similarity is **at least 0.6**. When either set has fewer than 2 words, only an exact set match counts.
- **DUP-04** Mentions are processed in order of (meeting date, file name, line number). Each mention joins the existing item with the highest similarity at or above the threshold (ties go to the lowest id); otherwise it starts a new item. Similarity to an item is the best score over that item's mentions.
- **DUP-05** The matching ignores the due phrase and the checkbox state: `[x]` and `[ ]` mentions of the same task belong together.
- **DUP-06** The threshold is a named constant covered by tests with both must-merge and must-not-merge pairs (below).

## Derived item state
Computed from the item's mentions, ordered as in DUP-04. The **latest mention wins** (D8).
- **DUP-10** `status` is done when the latest mention is `[x]`/`[X]`, otherwise open.
- **DUP-11** `due_date` and `due_raw` come from the latest mention that has a resolved `due_date`. A later mention with no due phrase **keeps the earlier date**. If no mention has a resolved date, `due_raw` comes from the latest mention that has an unparsed phrase.
- **DUP-12** `task` text, `source_file`, `meeting_date` and `source_title` come from the latest mention. All earlier mentions stay in `mentions` as history and are shown by `list --json` under `history`.
- **DUP-13** A later `[ ]` mention after a `[x]` **re-opens** the item (latest wins).

## Manual done and re-ingest (D15)
- **DUP-20** `actiontrack done <id>` sets `manual_done_after` to the position of the item's latest mention (meeting date, file name, line number) and the item is done.
- **DUP-21** On every re-derivation, if `manual_done_after` is set and the item's latest mention is at or before that position, the item stays **done**. If a **newer** mention exists, the note decides (done or re-opened) and `manual_done_after` is cleared.
- **DUP-22** Re-ingesting unchanged notes changes nothing: same items, same IDs, same states, same `manual_done_after` (ING-20).
- **DUP-23** A new note that matches an existing item adds a mention and updates the derived fields; the item keeps its ID.
- **DUP-24** IDs are sequential integers allocated at first creation and never reused, even after an item is deleted (ING-22, D16). A new item always gets an id higher than **any id ever issued** (not merely higher than the current maximum), so the id sequence is tracked by the database (SQLite AUTOINCREMENT or an equivalent counter) and survives deletion of the highest-numbered item.

## ID preservation on re-ingest (D33)
On every ingest, grouping (DUP-04) is recomputed over **all** stored mentions, not just the new ones, so the outcome never depends on the order in which notes were ingested. Each resulting group is then given an id as follows. Groups are handled in order of their earliest mention (meeting date, file name, line number).
- **DUP-25** Every mention remembers the id of the item it belonged to before this ingest (its *previous id*). A mention is recognised across ingests by **note path + resolved owner + task text** (repeated identical lines in one note pair up one-to-one in line order); line numbers are not used, so inserting a line above does not lose ids. A mention that was edited (different text) or is new has no previous id. For a group, the **candidate ids** are the distinct previous ids of its mentions that have not already been taken (or absorbed, DUP-26) by an earlier group.
- **DUP-26** If the candidate set is non-empty, the group takes the **lowest** candidate id. When several existing items merge into one group, the **lowest existing id survives**; this is the required behaviour for a merge. Every other id in the candidate set is deleted and **never reused**.
- **DUP-27** If the candidate set is empty (all mentions are new), the group gets a new id (DUP-24).
- **DUP-28** A previous id that no group takes is deleted. The history of the surviving item contains all mentions of the merged items.
- **DUP-29** The surviving item's `manual_done_after` is the **latest** (greatest position) value among the merged items that had one; if none had one, it is empty. DUP-21 is then applied as usual to the merged mentions.
- **DUP-29a** If one previous item's mentions end up in different groups (for example because a changed note no longer matches), the id goes to the earliest group by the order above (DUP-25); the other groups take their own remaining candidates, or new ids.
- **DUP-29b** The ingest report lists each merge of existing items as `merged items #7, #3 into #3` (ING-27, DUP-30) and each deleted id.

## Reporting
- **DUP-30** The ingest report lists every item with more than one mention: item id, owner, task, and the `file:line` of each mention.

## Required tests for ID preservation (crafted fixtures, D33)
- **DUP-60** Merge keeps the lowest id. Three notes, all with owner Anita Desai, dated 2026-01-05 (A), 2026-01-12 (B) and 2026-01-19 (C):
  - A: `Anita to update the style guide colours` (words: update, style, guide, colours)
  - B: `Anita to update the style guide colours and typography` (adds typography)
  - C: `Anita to update the style guide typography fonts` (update, style, guide, typography, fonts)

  Similarities: A to B = 0.80, B to C = 0.67 (both at or above 0.6), A to C = 0.50 (below). Ingest A and C first: two items, ids 1 and 2. Then ingest B: grouping over all mentions in date order puts A, B and C in one group (B bridges A and C), so **one item remains, id 1**, with three mentions in its history; **id 2 no longer exists**. The report lists `merged items #1, #2 into #1`.
- **DUP-61** Deleted ids are not reused: after DUP-60, ingest a note with a brand-new task. It gets an id greater than 2 (3 or higher), never 2. Also: delete the highest-numbered item (by re-ingesting a malformed version of its only note, ING-36) and then ingest a new task; the new id is greater than the deleted one.
- **DUP-62** Re-ingest of unchanged notes keeps every id (DUP-22).
- **DUP-63** A manually done item that survives a merge is still done (DUP-29, DUP-21), and a merge does not change the ids of unrelated items.
- **DUP-64** Split (DUP-29a): use the three notes of DUP-60 so that A, B and C are one item, id 1. Make note B malformed (ING-36). A and C no longer bridge, so they split: A (the earliest group) **keeps id 1**; C gets a **new** id greater than any id ever issued, here 3 because id 2 was issued earlier in the scenario where A and C were first ingested separately, or 2 if B was never preceded by a separate C item.
- **DUP-65** An absorbed id cannot be claimed again in the same ingest: in groups `[1,2]` then `[2]`, the first group takes 1, id 2 is absorbed and deleted, and the second group gets a new id (DUP-26).
- **DUP-66** A line inserted above an unchanged action in a changed note does not change that item's id (DUP-25).

## Expected results on the provided notes
Must merge (one item each):
- **DUP-40** Acme revised quote: 09-01 (`by Friday`), 09-08 (`Priya N. ... by Friday`), 09-15 (`[x]`). One item for Priya Nair, **done**, due 2026-09-11 (kept from 09-08), 3 mentions.
- **DUP-41** Quote-portal wireframes (Anita Desai): 09-01, 09-15, 09-22. One **open** item, due 2026-09-24, 3 mentions.
- **DUP-42** Cloud budget (Sam Okafor): 09-01, 09-15, 09-22 (`[x]`). One **done** item, due 2026-09-18.
- **DUP-43** Staging environment (Rahul Mehta): 09-01 and 09-08 (`[x]`). One **done** item, due 2026-09-08.
- **DUP-44** Freeze invoice edits (Karan Joshi): 09-29 and 10-08, both open. One **open** item, due 2026-10-09, 2 mentions.
- **DUP-45** Notify customers about the maintenance window (Priya Nair, written `Priya N.`): 09-29 and 10-08 (`[x]`). One **done** item.
- **DUP-46** Book the renewal call with Acme's CTO (Meera Iyer): 09-10, 09-28, 10-14 (`[x]`). One **done** item, due 2026-09-30.
- **DUP-47** Deploy the beta to staging (Rahul Mehta): 10-01, 10-06, 10-13 (`[x]`). One **done** item, due 2026-10-07.
- **DUP-48** Welcome-email copy (Anita Desai): 09-14, 09-24, 10-05 (`[x]`). One **done** item.

Must NOT merge:
- **DUP-50** `Rahul to fix the pagination bug` (Rahul Mehta) and `Rahul to fix the top three critical bugs` (Rahul Verma): different owners.
- **DUP-51** `Meera to ask Acme for their procurement contact` and `Meera to send Acme the procurement form`: similarity 0.33.
- **DUP-52** `Rahul to review the schema mapping doc` (Verma) and `Rahul to review Anita's PR`: different owners and similarity 0.17.
- **DUP-53** `Priya to draft the test plan for invoice rounding` (Priya Shah) and `Priya S. to run the invoice rounding tests`: similarity 0.29.
- **DUP-55** `Karan to send Acme the revised pricing sheet` (Karan Joshi) and `Priya to send the revised quote to Acme` (Priya Nair): different owners, never merge. Same owner and similarity exactly 0.50 (below 0.6) does not merge either, e.g. `Sam to share the VPN guide` and a hypothetical `Sam to write the VPN guide`.
- **DUP-54** `Karan to refund affected customers` stays one item with one mention; the quoted duplicate in 09-21 is ignored at parse time (ING-17), so it never reaches matching.
