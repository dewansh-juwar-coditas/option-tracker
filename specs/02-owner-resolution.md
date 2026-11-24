# 02 Owner resolution

Turns the owner text of an action line into one or more resolved owners. Decisions: D5, D6, D21.

## Extracting the owner text
- **OWN-01** Two line shapes give an owner (D31, D23):
  - *to form*: `<head> to <task>` or `<head> will <task>`. The head is the text before the first standalone `to`/`will`.
  - *colon form*: the line **starts with an `@handle`** immediately followed by `:`, then the task (`@anita: <task>`). The colon form applies only to `@handle:`; `Anita: do X` is not a recognised shape.

  If neither shape matches, or the head in the to form is longer than 6 words, the item is **owner kind `unowned`** and the whole line is the task (D25).
- **OWN-02** In a table row the owner comes from the Owner cell; the Action cell is the task.
- **OWN-03** `@anita` means Anita (D23). The `@` is stripped and the rest is resolved like a first name (OWN-09 onward). Both forms below are required and are tested:
  - **OWN-03a** colon form: `- [ ] @anita: Review the API documentation` gives owner Anita and task `Review the API documentation` (original wording and capitalisation kept).
  - **OWN-03b** to form: `- [ ] @anita to review the API documentation` gives owner Anita and task `review the API documentation` (original wording kept).
  - **OWN-03c** In both forms the due phrase is still extracted (`@anita: audit colour contrast on the dashboard by Mon` has due phrase `by Mon`, spec 03). An `@handle:` with no text after the colon is an empty checkbox (ING-18).
  - **OWN-03d** The two forms produce the same owner and the same normalized task key (spec 04), so if both appear in one note they are two mentions of **one** item.
  - **OWN-03e** An `@` in the middle of a line (`email @anita for the report`) is not an owner marker.
- **OWN-04** Words in parentheses in the head, e.g. `Lena (with Priya)`, are removed from the owner and appended to the task as `(with Priya)`. The parenthetical person gets **no** item of their own (D21).
- **OWN-05** A head joined by `&`, `and`, `,` or `/` (`Anita & Rahul`) is split into several owners, each producing its **own item** with the same task and due date (D21).

## Non-person owners (D6)
- **OWN-05a** The complete set of owner kinds is `person`, `ambiguous`, `unowned`, `group`. Everything stored or printed uses exactly these values.
- **OWN-06** `Everyone` and `Team` (case-insensitive) give **`owner_kind = group`**, never `unowned` (D6). The group tag is `everyone` for `Everyone` and `team` for `Team`. The owner name is empty. `group_tag` is set only for kind `group`.
- **OWN-07** `Someone`, `TBD`, `Anyone`, `Unassigned`, `?` give **`owner_kind = unowned`** with no group tag and no owner name. A line with no recognisable owner (OWN-01, D25) is also `unowned`.
- **OWN-07a** `group` and `unowned` are different kinds everywhere they are observable: in the database, in `list --json` (`owner.kind` is `"group"` with `owner.group` `"everyone"` or `"team"`; or `"unowned"` with `owner.group` null), in the `list` table (`(everyone)` / `(team)` versus `(unowned)`), and in dedup matching (DUP-02: an `everyone` item and an `unowned` item never merge; an `everyone` item and a `team` item never merge).
- **OWN-08** Group and unowned items appear in `list` but never match `--owner` and never appear in a follow-up draft.

## Resolving a person name
Input is a name token(s) such as `Priya`, `Priya N.`, `Priya Nair`, `anita`.
Candidates are looked up in this order and the first non-empty source wins:
1. **OWN-09** The meeting's attendee list. Match by: full name equal (case-insensitive); or first name equal; and, if the text has a last-name initial (`Priya N.`), the last name must start with that initial.
2. **OWN-10** (D22) If the attendee list is empty or gave no match, the **roster** (every full name seen in any ingested note's attendee list, persisted in `people`) using the same matching.
3. **OWN-11** If still no match, the name is kept exactly as typed as owner kind `person` with a warning `owner not in attendees or roster`.

Outcome of a lookup:
- **OWN-12** Exactly one candidate: owner kind `person`, name = that candidate's full name.
- **OWN-13** Two or more candidates (e.g. bare `Priya` in a meeting with Priya Nair and Priya Shah): owner kind `ambiguous`, `owner_candidates` = the full names, owner name empty. It is reported at ingest (ING-26), displayed in `list` as `ambiguous: Priya Nair | Priya Shah`, and never included in follow-up drafts (D5).
- **OWN-14** Resolution happens per mention. Two mentions of the same task merge only if their resolved owners are equal: the same person, or ambiguous with the same candidate set (spec 04).
- **OWN-15** Roster building is a first pass over all notes in the folder, before items are parsed, so the result does not depend on file order.

## Expected results on the provided notes
- **OWN-20** `2026-09-25-qa-sync.md` (attendees Priya Shah, Rahul Verma): bare `Priya` is Priya Shah, `Rahul` is Rahul Verma.
- **OWN-21** `2026-09-08-quote-portal-weekly.md`: `Priya N.` is Priya Nair, bare `Rahul` is Rahul Mehta (the only Rahul present).
- **OWN-22** `2026-09-17-billing-migration-sync.md` (both Priyas present): bare `Priya to sign off the cutover checklist` is **ambiguous** (Priya Nair | Priya Shah); `Rahul` is Rahul Verma (only Rahul present).
- **OWN-23** `2026-09-29-billing-cutover-planning.md`: `Priya S.` is Priya Shah, `Priya N.` is Priya Nair.
- **OWN-24** `2026-09-30-q4-offsite.md` (everyone present): `Priya to own the hiring plan` and `Rahul to prepare the architecture overview` are **ambiguous**.
- **OWN-25** `2026-10-07-standup.md` (Rahul Mehta and Rahul Verma): `Rahul to review Anita's PR` is **ambiguous**.
- **OWN-29** Crafted fixture (attendees Anita Desai, Rahul Mehta) with `- [ ] @anita: Review the API documentation` and `- [ ] @anita to review the API documentation`: both mentions have owner Anita Desai (kind `person`); tasks are `Review the API documentation` and `review the API documentation`; after ingest they are one item with two mentions (OWN-03d).
- **OWN-30** Crafted fixture with `- [ ] Everyone to read the handbook`, `- [ ] Team to pick a launch date` and `- [ ] Someone to book the room`: owner kinds are `group` (tag `everyone`), `group` (tag `team`) and `unowned`, in that order; none is `unowned` except the third.
- **OWN-26** `2026-09-18-design-review.md`: `@anita` (colon form, `@anita: audit colour contrast on the dashboard by Mon`) is Anita Desai; `Anita & Rahul to agree on the component API` gives two items (Anita Desai, Rahul Mehta); `Lena (with Priya)` gives one item for Lena Fischer whose task text ends `(with Priya)`; `Everyone to review the prototype` is `owner_kind = group`, tag `everyone`; `TBD to write the design-system changelog` is `owner_kind = unowned`.
- **OWN-27** `2026-09-10-acme-renewal-prep.md`: `Someone to update the CRM notes` is `unowned`. `2026-10-01-quote-portal-weekly.md`: `Team to decide on the launch date` is `owner_kind = group`, tag `team`. `2026-09-30-q4-offsite.md`: `Everyone to submit their Q4 goals by 7 Oct` is `group`, tag `everyone`.
- **OWN-28** `2026-09-23-standup.md` has no attendees: `Sam` resolves through the roster to Sam Okafor (D22); `Rahul` is **ambiguous** (Rahul Mehta | Rahul Verma).
