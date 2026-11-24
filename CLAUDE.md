# CLAUDE.md: actiontrack

CLI that ingests markdown meeting notes, tracks action items, and prepares follow-up emails as Gmail
**drafts** (never sent). **TypeScript on Node.js (22+)**: Commander.js (CLI), better-sqlite3 (storage),
Zod (validation), Vitest (tests). Stack decision D13 (switched from Python; functional specs unchanged).

## Spec-driven workflow (mandatory)
1. **Spec first.** Behaviour lives in `specs/*.md` as numbered acceptance criteria (ING-, OWN-, DAT-, DUP-, LST-, DNE-, FUP-, SKL-, G-).
2. **Tests from specs.** Every AC has at least one Vitest test whose name cites the AC id, e.g. `it("DAT-11 bare weekday is strictly after meeting date", ...)`.
3. **Then code.** Implement until the tests pass. Do not add behaviour that no spec describes.
4. **Change = spec, test, code**, in that order. If code and spec disagree, the spec is right until the user says otherwise.
5. Choices made with the user are in `specs/decisions.md` (D1 to D34, all confirmed). Anything not covered there is a question for the user, not a guess; propose it as a "P" item first and only promote it to a D once the user agrees.

## Layout
- `specs/`: 00-overview, 01-ingest-parsing, 02-owner-resolution, 03-due-dates, 04-dedup-merge, 05-list-done, 06-followup, decisions
- `src/`: `cli.ts` (Commander wiring, exports `run(argv, io)`), `bin.ts` (entry), `parser.ts`, `owners.ts`, `dates.ts`, `dedup.ts`, `db.ts`, `followup.ts`, `report.ts`, `schemas.ts` (Zod), `models.ts`
- `tests/`: `*.test.ts` per module, integration tests against `notes/notes`, crafted `fixtures/`
- `notes/notes/`: provided sample data (36 files, some deliberately malformed). **Read-only. Never edit or delete.**
- `skills.md` and `.claude/skills/actiontrack-followup/SKILL.md`: the Gmail-draft skill. Keep both in sync (D19).

## Commands
- Install: `npm install` (better-sqlite3 is a native module; needs a prebuilt binary or a C++ toolchain)
- Test: `npm test` (Vitest, run once); watch mode: `npm run test:watch`
- Type-check: `npm run typecheck`
- Build: `npm run build` (emits `dist/`)
- Run: `node dist/bin.js ingest notes/notes`, then `list`, `done <id>`, `followup <owner> --json` (or `npm link` to get `actiontrack`)
- Pin the date in tests and demos with `--as-of YYYY-MM-DD`.

## Hard rules
- **Never send email.** The CLI has no send path, no Gmail library and no credentials (G-01, FUP-32). Drafts are created only by the skill through the Gmail MCP connector, and only after the user confirms.
- A bad note is skipped and reported, never a crash (G-02).
- `actiontrack.db` and `people.json` are local data: not committed (see `.gitignore`).
- Do not commit unless the user asks.
- Report outcomes faithfully: if a test fails or a step was skipped, say so.

## Conventions
- Strict TypeScript, ESM (`"type": "module"`, NodeNext resolution, relative imports end in `.js`).
- ISO dates (`YYYY-MM-DD`) everywhere internally, computed in UTC so results do not depend on the machine's time zone. Weeks run Monday to Sunday.
- Validate at boundaries with Zod: note header, `people.json`, CLI option values, and the `--json` outputs.
- Item state is derived from mentions (spec 04); never edit derived fields without re-deriving.
- stdout for results, stderr for errors; exit codes per decision D28 (0 ok, 1 not found or ambiguous, 2 usage or config error).
- Keep `dates.ts`, `owners.ts` and `dedup.ts` pure (plain values in, plain values out) so they are easy to test.

## Status
Specs 00 to 06 written and all decisions confirmed (D1 to D34). Stack is TypeScript. Implementation is under way with tests first; see the checklist below.
