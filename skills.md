# skills.md

Skills used in this project. Each entry mirrors a real Claude Code skill under `.claude/skills/`.
Keep this file and the `SKILL.md` files in sync (decision D19).

## actiontrack-followup
File: `.claude/skills/actiontrack-followup/SKILL.md` · Spec: `specs/06-followup.md`

**Purpose.** Turn the output of `actiontrack followup` into Gmail drafts for review, using the Gmail MCP
connector. The CLI only prepares data; this skill is the only thing that touches Gmail, and it never sends.

**Use it when** the user asks to draft, prepare or create follow-up emails for meeting action items,
for one owner (`followup "Karan Joshi"`) or everyone (`followup --all`).

**Inputs.** An owner name or `--all`; optional `--as-of YYYY-MM-DD`; a populated `actiontrack.db`
and, optionally, `people.json` mapping full names to email addresses.

**Procedure.**
1. Run `actiontrack followup <owner|--all> --json` and parse the result.
2. Show a summary: owner, recipient or "no email address", overdue and open counts, plus the excluded
   (ambiguous, unowned, group) item counts and any warnings.
3. Ask for confirmation when more than one draft will be created.
4. For each draft, call the Gmail create-draft tool with `to` (omitted if null), `subject` and `body`
   exactly as produced. No rewriting.
5. Report what was created and remind the user that the drafts are unsent.

**Guardrails.**
- Never call send, reply or forward. If only a send action exists, stop and say so.
- If Gmail is unavailable or unauthenticated, stop and say what is missing.
- Never invent a signature name or an email address.
- Read-only for the tracker: do not change items.

**Failure handling.** Non-zero CLI exit (ambiguous or unknown owner, bad config): show the stderr message
and stop. Do not guess the intended person.

## Candidate future skills (not built)
- `actiontrack-triage`: weekly sweep of overdue items grouped by owner, for a manager review.
