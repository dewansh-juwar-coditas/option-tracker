---
name: actiontrack-followup
description: Create Gmail drafts (never send) from actiontrack follow-up output. Use when the user asks to draft, prepare or create follow-up emails for meeting action items from actiontrack, for one owner or all owners.
---

# actiontrack-followup

Turns `actiontrack followup` output into Gmail **drafts** using the Gmail MCP connector.
Spec: `specs/06-followup.md` (SKL-01 to SKL-06). **Never send anything.**

## Steps
1. Make sure notes are ingested (`actiontrack list` works). If not, tell the user to run `actiontrack ingest <folder>` first.
2. Run `actiontrack followup <owner> --json` for one person, or `actiontrack followup --all --json`. Add `--as-of YYYY-MM-DD` only if the user gave a date. Parse the JSON.
   - A non-zero exit means a problem such as an ambiguous or unknown owner. Show the stderr message and stop. Do not guess which person was meant.
3. Show the user a short summary: each owner, the recipient (or "no email address"), and the overdue and open counts. Report `excluded` (ambiguous, unowned and group items) and any warnings, so nothing is silently dropped.
4. If there is more than one draft, ask the user to confirm before creating any. For a single draft, creating it is what the user asked for.
5. For each draft, find the Gmail MCP **create-draft** tool among the available tools and call it with:
   - `to`: the draft's `to` (omit the field when it is `null`)
   - `subject`: exactly as given
   - `body`: exactly as given, as plain text. Do not rewrite, shorten or add to it.
6. Report per owner that a draft was created, with the draft id or link if the tool returns one. Remind the user the drafts are unsent and waiting in Gmail for review.

## Rules
- **Never** call a send, reply or forward tool, and never schedule a send. If the only available action would send the email, stop and say so.
- If the Gmail connector is missing or not authenticated, stop, say what is missing and ask the user to authenticate it. Do not pretend a draft exists.
- Do not invent a signature name or an email address. A missing address stays missing.
- Do not mark items done or change item data. Drafting is read-only for the tracker.
