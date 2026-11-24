/** Hand-built values for unit tests. Not a test file. */
import type { Item, OwnerSpec } from "../src/models.js";

export const person = (name: string): OwnerSpec => ({ kind: "person", name, candidates: [], group: null });

export const mkItem = (o: Partial<Item> & { id: number }): Item => ({
  owner: person("Anita Desai"),
  task: "ship the report",
  dueRaw: null,
  dueDate: null,
  status: "open",
  manualDoneAfter: null,
  sourceFile: "2026-03-02-planning.md",
  meetingDate: "2026-03-02",
  sourceTitle: "Planning sync",
  history: [{ file: "2026-03-02-planning.md", line: 3, meetingDate: "2026-03-02", checked: false }],
  ...o,
});
