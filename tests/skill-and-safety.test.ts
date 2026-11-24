/** Gmail skill contract (SKL-01..06, D19) and the no-send guarantee (G-01, FUP-32, D3). */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const SKILL = readFileSync(join(ROOT, ".claude", "skills", "actiontrack-followup", "SKILL.md"), "utf8");
const SKILLS_MD = readFileSync(join(ROOT, "skills.md"), "utf8");
const both = [
  ["SKILL.md", SKILL],
  ["skills.md", SKILLS_MD],
] as const;

describe("SKL skill behaviour", () => {
  it("D19 both the real skill and the mirror in skills.md exist; SKILL.md has front matter naming the skill", () => {
    expect(existsSync(join(ROOT, "skills.md"))).toBe(true);
    expect(SKILL.startsWith("---\n")).toBe(true);
    expect(SKILL).toMatch(/^name:\s*actiontrack-followup\s*$/m);
    expect(SKILL).toMatch(/^description:\s*\S/m);
    expect(SKILLS_MD).toMatch(/^## actiontrack-followup/m);
  });

  it.each(both)("SKL-01 %s runs `actiontrack followup <owner|--all> --json` and parses the result", (_n, text) => {
    expect(text).toMatch(/actiontrack followup[^\n]*--json/);
    expect(text).toMatch(/--all/);
    expect(text).toMatch(/parse/i);
  });

  it.each(both)("SKL-02 %s creates the draft with the Gmail create-draft tool, to omitted when null, body exactly as given", (_n, text) => {
    expect(text).toMatch(/create-draft/i);
    expect(text).toMatch(/omit/i);
    expect(text).toMatch(/exactly as/i);
    expect(text).toMatch(/subject/);
    expect(text).toMatch(/\bbody\b/);
  });

  it("SKL-02 SKILL.md says the tool is found among the available tools and the body is not rewritten", () => {
    expect(SKILL).toMatch(/among the available tools/i);
    expect(SKILL).toMatch(/do not rewrite/i);
  });

  it.each(both)("SKL-03 %s never sends, replies or forwards, and stops if only a send action exists", (_n, text) => {
    expect(text).toMatch(/never[^\n]*(send|call send)/i);
    expect(text).toMatch(/reply/i);
    expect(text).toMatch(/forward/i);
    expect(text).toMatch(/only[^\n]*(send|would send)[^\n]*stop|stop[^\n]*(only|send)/i);
  });

  it.each(both)("SKL-04 %s stops when Gmail is unavailable or unauthenticated and says what is missing", (_n, text) => {
    expect(text).toMatch(/unauthenticated|not authenticated/i);
    expect(text).toMatch(/stop/i);
  });

  it("SKL-04 SKILL.md does not fall back to a 'sent' confirmation", () => {
    expect(SKILL).toMatch(/do not pretend a draft exists/i);
  });

  it("SKL-05 SKILL.md reports a draft per owner with the id or link, the warnings and the excluded counts", () => {
    expect(SKILL).toMatch(/draft id or link/i);
    expect(SKILL).toMatch(/excluded/i);
    expect(SKILL).toMatch(/warnings/i);
    expect(SKILL).toMatch(/unsent/i);
  });

  it.each(both)("SKL-06 %s asks for confirmation before creating more than one draft", (_n, text) => {
    expect(text).toMatch(/more than one draft/i);
    expect(text).toMatch(/confirm/i);
  });

  it("D19 the guardrails that matter appear in both files (kept in sync)", () => {
    for (const phrase of [/never[^\n]*send/i, /confirm/i, /exactly as/i, /signature name/i, /read-only|do not (mark|change)/i]) {
      expect(SKILL, String(phrase)).toMatch(phrase);
      expect(SKILLS_MD, String(phrase)).toMatch(phrase);
    }
  });
});

// ---------------------------------------------------------------- source scan

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith(".ts") ? [p] : [];
  });
}
const SRC = sourceFiles(join(ROOT, "src")).map((p) => [p.slice(ROOT.length + 1), readFileSync(p, "utf8")] as const);

describe("G-01 / FUP-32 the CLI has no way to send email", () => {
  it("there are source files to scan", () => {
    expect(SRC.length).toBeGreaterThanOrEqual(8);
  });

  it("G-01 every import is a relative module, an allowed node: built-in, or one of commander, better-sqlite3, zod", () => {
    const allowedNode = new Set(["node:fs", "node:path", "node:crypto", "node:url"]);
    const allowedPkg = new Set(["commander", "better-sqlite3", "zod"]);
    for (const [file, text] of SRC) {
      for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g)) {
        const spec = (m[1] ?? m[2] ?? m[3])!;
        const ok = spec.startsWith("./") || spec.startsWith("../") || allowedNode.has(spec) || allowedPkg.has(spec);
        expect(ok, `${file} imports ${spec}`).toBe(true);
      }
    }
  });

  it("G-01 no networking or mail primitives appear in the source", () => {
    const banned = [/\bfetch\s*\(/, /XMLHttpRequest/, /node:(http|https|net|tls|dgram|child_process)/, /nodemailer|googleapis|smtp|imap|sendmail|sendMail/i];
    for (const [file, text] of SRC) {
      for (const re of banned) expect(re.test(text), `${file} matches ${re}`).toBe(false);
    }
  });

  it("G-01 no credentials: no token, secret, password or API-key handling in the source", () => {
    for (const [file, text] of SRC) {
      expect(/\b(password|api[_-]?key|client[_-]?secret|oauth|access[_-]?token|refresh[_-]?token)\b/i.test(text), file).toBe(false);
      expect(/process\.env/.test(text), `${file} reads environment variables`).toBe(false);
    }
  });

  it("FUP-32 package.json has no mail or Google dependency", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => /mail|gmail|google|smtp|imap|oauth/i.test(d))).toEqual([]);
  });

  it("FUP-32 the only `send` in the source is the constant `send: false`", () => {
    for (const [file, text] of SRC) {
      for (const m of text.matchAll(/\bsend\w*/gi)) {
        const line = text.slice(text.lastIndexOf("\n", m.index) + 1, text.indexOf("\n", m.index));
        const isComment = /^\s*(\/\/|\*|\/\*)/.test(line);
        const isSendFalse = /\bsend\b\s*:\s*(false|z\.literal\(false\))/.test(line);
        expect(isComment || isSendFalse, `${file}: ${line.trim()}`).toBe(true);
      }
    }
  });
});
