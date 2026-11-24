# 06 `followup` and the Gmail draft skill

Decisions: D2, D3, D4, D5, D6, D17. The CLI **prepares** drafts as structured data. The Claude skill
(`.claude/skills/actiontrack-followup/SKILL.md`, mirrored in `skills.md`) creates the actual Gmail draft
through the Gmail MCP connector. **Nothing is ever sent.**

## Command
`actiontrack followup <owner>` or `actiontrack followup --all`, with `--json`, `--as-of DATE`, `--people PATH`, `--db PATH`.
- **FUP-01** Exactly one of `<owner>` or `--all` is required; neither or both is a usage error (exit 2).
- **FUP-02** `<owner>` is matched among the **person** owners present in the database, case-insensitively: full name exactly, or a first name that belongs to exactly one person (D24). A first name shared by two or more people (e.g. `Priya`) exits 1 with `Ambiguous owner 'Priya': Priya Nair, Priya Shah`. An unknown name exits 1 and lists the known owners (D4).
- **FUP-03** A draft covers that person's items that are **open or overdue** at the as-of date. Done items are excluded.
- **FUP-04** Items with owner kind `ambiguous`, `unowned` or `group` are never included (D5, D6, OWN-08). The output reports how many of each were excluded so nothing is silently dropped.
- **FUP-05** If the person has no open or overdue items, print `No open or overdue items for <name>`, create no draft, exit 0.
- **FUP-06** `--all` produces one draft per person owner that has at least one open or overdue item, sorted by owner name.

## Recipient (D2)
- **FUP-10** The people file is JSON: `{"Karan Joshi": "karan@example.com", ...}`. Name keys match case-insensitively. Default path `people.json` in the current directory (D26). A repository example is provided as `people.example.json`.
- **FUP-11** If the owner has no entry, `to` is `null` and a warning `no email address for <name>` is included. The draft is still produced (D2).
- **FUP-12** A missing people file is treated as empty, with a warning. An unreadable or invalid JSON file is a config error: exit 2 with a message.

## Draft content (D17)
- **FUP-20** Subject: `Action items follow-up: <Full Name> (<N> overdue, <M> open)`. Counts are of the items in the body; a zero count is still shown.
- **FUP-21** Body is plain text:
  ```
  Hi <First name>,

  Here is where your action items stand as of <as-of date>.

  Overdue (<N>)
  - [#<id>] <Task> (due <date>, <D> days overdue). From: <meeting title>, <meeting date>

  Open (<M>)
  - [#<id>] <Task> (due <date>). From: <meeting title>, <meeting date>
  - [#<id>] <Task> (no due date). From: <meeting title>, <meeting date>

  Please reply when any of these are done, or let me know if a due date needs to change.

  Thanks,
  ```
  A section with no items is omitted. `1 day overdue` uses the singular. The task's first letter is capitalised. The sign-off carries **no invented name**.
- **FUP-22** Overdue items are sorted by days overdue (largest first), then id. Open items by due date ascending with undated last, then id.
- **FUP-23** An item whose due phrase was unparsed shows `(due: "<raw phrase>")` instead of a date and counts as open.
- **FUP-24** Meeting title is the note's title (`# Meeting: ...`, front-matter `title:`, or the first heading), falling back to the file name without extension.

## Output
- **FUP-30** `--json` prints one JSON object:
  `{"as_of": "...", "drafts": [{"owner": "...", "to": "..." | null, "subject": "...", "body": "...", "item_ids": [..], "counts": {"overdue": N, "open": M}, "warnings": [..], "send": false}], "excluded": {"ambiguous": n, "unowned": n, "group": n}, "warnings": [..]}`
- **FUP-31** Without `--json`, the same information is printed as a readable preview: To, Subject, Body for each draft, then the excluded counts and warnings.
- **FUP-32** `send` is always `false`. The CLI has no code path that sends mail, imports an email or Gmail library, or stores credentials (G-01); a test scans the source to enforce this.
- **FUP-33** Running `followup` never changes item data.

## Skill behaviour (`SKILL.md` and `skills.md`)
- **SKL-01** The skill runs `actiontrack followup <owner|--all> --json` and parses the result.
- **SKL-02** For each draft it calls the **Gmail MCP create-draft tool** (discovered at run time by searching the available tools) with `to` (omitted when null), `subject` and `body` exactly as given. It must not rewrite the body.
- **SKL-03** It **never** calls any send, reply or forward tool, and never schedules sending. If the only available action would send, it stops and says so.
- **SKL-04** If the Gmail connector is not available or not authenticated, it stops, says what is missing, and tells the user to authenticate. It does not fall back to printing a "sent" confirmation.
- **SKL-05** It reports, per owner, that a draft was created (with the draft id or link if returned), plus any warnings and the excluded-item counts from the CLI output.
- **SKL-06** Because creating a draft writes to the user's mailbox, the skill shows the owner list and asks for confirmation before creating more than one draft.
