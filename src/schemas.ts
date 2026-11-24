/** Zod schemas for data crossing a boundary: CLI option values, people.json and the JSON outputs. */
import { z } from "zod";
import { parseMeetingDate } from "./dates.js";

// ---------------------------------------------------------------- CLI option values (LST-11)

export const StatusSchema = z.enum(["open", "done", "overdue"]);
export type StatusOption = z.infer<typeof StatusSchema>;

/** Accepts the same date forms as note headers (ING-06) and yields an ISO date (LST-05, LST-11). */
export const DateOptionSchema = z.string().transform((s, ctx) => {
  const iso = parseMeetingDate(s);
  if (iso === null) {
    ctx.addIssue({ code: "custom", message: `invalid date '${s}'` });
    return z.NEVER;
  }
  return iso;
});

// ---------------------------------------------------------------- people.json (FUP-10 to FUP-12)

export const PeopleSchema = z.record(z.string(), z.string());
export type People = z.infer<typeof PeopleSchema>;

export type PeopleResult = { ok: true; value: People } | { ok: false; message: string };

export function parsePeople(text: string): PeopleResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, message: `not valid JSON (${(e as Error).message})` };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "expected a JSON object mapping full names to email addresses" };
  }
  const r = PeopleSchema.safeParse(raw);
  if (!r.success) {
    return { ok: false, message: "every value must be an email address string" };
  }
  return { ok: true, value: r.data };
}

// ---------------------------------------------------------------- list --json (LST-10)

const OwnerJsonSchema = z
  .object({
    kind: z.enum(["person", "ambiguous", "unowned", "group"]),
    name: z.string().nullable(),
    candidates: z.array(z.string()),
    group: z.enum(["everyone", "team"]).nullable(),
  })
  .refine((o) => (o.kind === "group") === (o.group !== null), {
    message: "`group` is set only when kind is group (OWN-07a)",
  });

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ListItemSchema = z.object({
  id: z.number().int(),
  status: z.enum(["open", "overdue", "done"]),
  days_overdue: z.number().int().nullable(),
  owner: OwnerJsonSchema,
  task: z.string(),
  due_date: IsoDate.nullable(),
  due_raw: z.string().nullable(),
  source_file: z.string(),
  meeting_date: IsoDate,
  source_title: z.string().nullable(),
  history: z.array(
    z.object({ file: z.string(), line: z.number().int(), meeting_date: IsoDate, checked: z.boolean() }),
  ),
});
export type ListItemJson = z.infer<typeof ListItemSchema>;
export const ListOutputSchema = z.array(ListItemSchema);

// ---------------------------------------------------------------- followup --json (FUP-30)

export const DraftSchema = z.object({
  owner: z.string(),
  to: z.string().nullable(),
  subject: z.string(),
  body: z.string(),
  item_ids: z.array(z.number().int()),
  counts: z.object({ overdue: z.number().int(), open: z.number().int() }),
  warnings: z.array(z.string()),
  /** FUP-32: always false. */
  send: z.literal(false),
});
export type Draft = z.infer<typeof DraftSchema>;

export const FollowupOutputSchema = z.object({
  as_of: IsoDate,
  drafts: z.array(DraftSchema),
  excluded: z.object({ ambiguous: z.number().int(), unowned: z.number().int(), group: z.number().int() }),
  warnings: z.array(z.string()),
});
export type FollowupOutput = z.infer<typeof FollowupOutputSchema>;

// ---------------------------------------------------------------- ingest --json (ING-23 to ING-27, DUP-29b, ING-40)

export const IngestReportSchema = z.object({
  notes: z.object({
    ingested: z.number().int(),
    unchanged: z.number().int(),
    skipped: z.number().int(),
    ignored: z.number().int(),
  }),
  items: z.object({
    created: z.number().int(),
    updated: z.number().int(),
    unchanged: z.number().int(),
    absorbed: z.number().int(),
    deleted: z.number().int(),
  }),
  skipped: z.array(z.object({ file: z.string(), reason: z.string() })),
  warnings: z.array(z.object({ file: z.string(), message: z.string() })),
  ambiguous: z.array(
    z.object({ file: z.string(), line: z.number().int(), task: z.string(), candidates: z.array(z.string()) }),
  ),
  unparsed_due: z.array(z.object({ file: z.string(), line: z.number().int(), phrase: z.string() })),
  merges: z.array(
    z.object({
      id: z.number().int(),
      owner: z.string(),
      task: z.string(),
      mentions: z.array(z.object({ file: z.string(), line: z.number().int() })),
    }),
  ),
  merged_items: z.array(z.object({ ids: z.array(z.number().int()), into: z.number().int() })),
  deleted_ids: z.array(z.number().int()),
  previously_ingested: z.array(
    z.object({
      file: z.string(),
      removed_mentions: z.number().int(),
      deleted_items: z.array(z.number().int()),
      rederived_items: z.array(z.number().int()),
    }),
  ),
});
export type IngestReport = z.infer<typeof IngestReportSchema>;
