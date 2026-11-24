# 03 Due dates

Resolves a due phrase to a real calendar date, relative to the **meeting date** of the note it came from.
Decisions: D8 (carry-over), D9 (weekday), D10 (vague phrases). Weeks run Monday to Sunday.

## Finding the phrase
- **DAT-01** The due phrase is found in the action text after one of these introducers: `by`, `before`, `until`, `till`, `due`, `due on`, `on`, `from`, `for`, or at the start of the trailing text. If several phrases resolve, the **last** one wins (`cut cloud costs by 10% - proposal by 2026-10-09` is due 2026-10-09; `by 10%` is part of the task).
- **DAT-02** `on`, `from` and `for` introduce a due date only when the following text is an explicit date (ISO, day-month or month-day, optionally with a weekday). `for the landing page` is not a due phrase.
- **DAT-03** In a table row, the Due cell is the phrase and needs no introducer.
- **DAT-04** The phrase and its introducer are removed from the task text, along with a dangling separator (`-`, an em dash, `,`) and trailing punctuation. The original phrase is stored as `due_raw` (e.g. `by Friday`) so the resolved date can always be checked against the source (D10).

## Resolution rules
| Phrase | Resolves to |
|---|---|
| **DAT-10** ISO `2026-09-08`; `10 Sep`, `10 September 2026`; `Oct 3rd`; `15 October` | That date. If no year is given, the meeting's year, unless that date would be more than 180 days before the meeting date, then the next year. |
| **DAT-11** Weekday alone: `Friday`, `Fri`, `Wed` | The first such weekday **strictly after** the meeting date (D9). A Friday meeting saying "by Friday" gives the following Friday. |
| **DAT-12** Weekday plus explicit date: `Wed 16 Sep`, `Saturday 10 Oct` | The explicit date. The weekday word is ignored. |
| **DAT-13** `next <weekday>` | That weekday in the **following** week (Mon-Sun), regardless of how close the weekday is. |
| **DAT-14** `tomorrow`, `EOD tomorrow` | Meeting date + 1 day. |
| **DAT-15** `today`, `EOD`, `end of day`, `COB` | The meeting date. |
| **DAT-16** `end of week`, `end of this week` | The Friday of the meeting's week. If the meeting is on Saturday or Sunday, the Friday of the following week. |
| **DAT-17** `end of next week` | The Friday of the following week. |
| **DAT-18** `end of month`, `end of the month` | The last day of the meeting's month. |
| **DAT-19** `mid-October`, `mid October` | The 15th of that month (year rule as DAT-10). |

- **DAT-20** Weekday and month words are matched case-insensitively. Three-letter weekday and month abbreviations count only next to an introducer or a day number, so ordinary words are not misread as dates.
- **DAT-21** A trailing phrase that matches no rule (`before the next review`, `before cutover`) leaves `due_date` empty, keeps the phrase as `due_raw`, removes it from the task, and is listed in the ingest report as **unparsed** (ING-26). It is not an error. To avoid mistaking ordinary wording for a due date, only these introducers can produce an unparsed phrase: `before`, `until`, `till` (body of 1 to 5 words, not starting with a digit), and `by` when the body reads like a time reference (starts with `the end/start/beginning/close`, `end`, `next`, `this`, `early`, `late`, `mid`, `soon`, `sometime`, `later` or `then`). So `by 10%` and `by phone` stay in the task and are not due phrases; `due`, `on`, `from` and `for` never produce an unparsed phrase.
- **DAT-22** No phrase at all means no due date and no `due_raw`. This is a normal state (see spec 04 for carry-over).
- **DAT-23** A date that cannot exist (`31 Sep`) is treated as unparsed (DAT-21).

## Dates across merged mentions (D8)
- **DAT-30** Each mention resolves its phrase against **its own** meeting date. "by Thursday" in the 09-01, 09-15 and 09-22 notes gives 09-03, 09-17 and 09-24.
- **DAT-31** The item takes the due date of the latest mention that has one; a later mention without a due date keeps the earlier one (spec 04).

## Expected results (integration tests)
| Note and line | `due_date` |
|---|---|
| 09-01 `Priya to send the revised quote to Acme by Friday` (Tue) | 2026-09-04 |
| 09-01 `Anita to share first wireframes by Thursday` | 2026-09-03 |
| 09-03 `Priya to draft the test plan ... by end of next week` (Thu) | 2026-09-11 |
| 09-03 `Karan to export last quarter invoices by 10 Sep` | 2026-09-10 |
| 09-14 `Lena to collect 5 customer quotes ... by end of month` | 2026-09-30 |
| 09-14 `Anita ... by Wed 16 Sep` | 2026-09-16 |
| 09-21 `Sam to write the postmortem by EOD tomorrow` (Mon) | 2026-09-22 |
| 09-21 `Rahul ... by Friday` | 2026-09-25 |
| 09-30 `Meera ... by Oct 3rd` (Wed) | 2026-10-03 |
| 09-30 `Lena to run the customer survey, results due 15 October` | 2026-10-15 |
| 09-30 `Sam to propose the on-call rotation by mid-October` | 2026-10-15 |
| 09-30 `ACTION: Karan to circulate the offsite summary tomorrow` | 2026-10-01 |
| 09-30 table row Anita, Due `2026-10-09` | 2026-10-09 |
| 09-29 `Sam to schedule cutover for Saturday 10 Oct` | 2026-10-10 |
| 10-05 `Rahul to start SSO spike by next Tuesday` (Mon) | 2026-10-13 |
| 10-06 `Meera to demo the portal to Acme on 2026-10-14` | 2026-10-14 |
| 10-10 `Meera ... by Tuesday` (Sat) | 2026-10-13 |
| 10-10 `Lena to log the three new leads in CRM by EOD` | 2026-10-10 |
| 09-18 `Everyone to review the prototype before the next review` | none, unparsed (`before the next review`) |
| 09-03 `Sam to snapshot the production DB before cutover` | none, unparsed (`before cutover`) |
| 09-18 `Anita to audit colour contrast ... by Mon` (Fri) | 2026-09-21 |
