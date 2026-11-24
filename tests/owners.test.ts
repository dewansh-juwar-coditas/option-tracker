import { describe, it, expect } from "vitest";
import { analyzeHead, analyzeOwner, resolveName } from "../src/owners.js";

const quotePortal = [
  "Priya Nair",
  "Rahul Mehta",
  "Anita Desai",
  "Sam Okafor",
  "Meera Iyer",
];
const billing = ["Karan Joshi", "Sam Okafor", "Rahul Verma", "Priya Shah", "Priya Nair"];
const qa = ["Priya Shah", "Rahul Verma"];
const roster = [
  "Priya Nair",
  "Priya Shah",
  "Rahul Mehta",
  "Rahul Verma",
  "Anita Desai",
  "Sam Okafor",
  "Meera Iyer",
  "Karan Joshi",
  "Lena Fischer",
];

describe("OWN-09 / OWN-12 resolve against the meeting's attendees", () => {
  it("OWN-20 a bare first name with one match is that person", () => {
    expect(resolveName("Priya", qa, roster)).toMatchObject({ kind: "person", name: "Priya Shah" });
    expect(resolveName("Rahul", qa, roster)).toMatchObject({ kind: "person", name: "Rahul Verma" });
  });
  it("OWN-21 initials pick the right Priya, bare Rahul is the only Rahul present", () => {
    expect(resolveName("Priya N.", quotePortal, roster)).toMatchObject({ kind: "person", name: "Priya Nair" });
    expect(resolveName("Rahul", quotePortal, roster)).toMatchObject({ kind: "person", name: "Rahul Mehta" });
  });
  it("OWN-23 Priya S. and Priya N. in a meeting with both", () => {
    expect(resolveName("Priya S.", billing, roster)).toMatchObject({ kind: "person", name: "Priya Shah" });
    expect(resolveName("Priya N.", billing, roster)).toMatchObject({ kind: "person", name: "Priya Nair" });
  });
  it("is case-insensitive and accepts a full name", () => {
    expect(resolveName("karan", billing, roster)).toMatchObject({ kind: "person", name: "Karan Joshi" });
    expect(resolveName("Priya Shah", billing, roster)).toMatchObject({ kind: "person", name: "Priya Shah" });
  });
});

describe("OWN-13 / D5 ambiguous when a first name matches two attendees", () => {
  it("OWN-22 bare Priya with both Priyas present", () => {
    const r = resolveName("Priya", billing, roster);
    expect(r).toMatchObject({ kind: "ambiguous", name: null, candidates: ["Priya Nair", "Priya Shah"] });
  });
  it("OWN-25 bare Rahul with both Rahuls present", () => {
    const r = resolveName("Rahul", ["Rahul Mehta", "Rahul Verma", "Anita Desai"], roster);
    expect(r).toMatchObject({ kind: "ambiguous", candidates: ["Rahul Mehta", "Rahul Verma"] });
  });
});

describe("OWN-10 / OWN-11 roster fallback and unknown names (D22)", () => {
  it("OWN-28 no attendees: a unique first name resolves through the roster", () => {
    expect(resolveName("Sam", [], roster)).toMatchObject({ kind: "person", name: "Sam Okafor" });
  });
  it("OWN-28 no attendees: Rahul is ambiguous across the roster", () => {
    expect(resolveName("Rahul", [], roster)).toMatchObject({
      kind: "ambiguous",
      candidates: ["Rahul Mehta", "Rahul Verma"],
    });
  });
  it("falls back to the roster when the attendees list has no match", () => {
    expect(resolveName("Karan", quotePortal, roster)).toMatchObject({ kind: "person", name: "Karan Joshi" });
  });
  it("OWN-11 unknown name is kept as typed, with a warning", () => {
    const r = resolveName("Zed", quotePortal, roster);
    expect(r).toMatchObject({ kind: "person", name: "Zed" });
    expect(r.warning).toMatch(/owner not in attendees or roster/);
  });
});

describe("OWN-01 line shapes", () => {
  const ctx = { attendees: quotePortal, roster };

  it("to form", () => {
    const r = analyzeOwner("Priya to send the revised quote", ctx);
    expect(r.owners).toHaveLength(1);
    expect(r.owners[0]).toMatchObject({ kind: "person", name: "Priya Nair" });
    expect(r.task).toBe("send the revised quote");
  });
  it("'will' works like 'to'", () => {
    const r = analyzeOwner("Sam will rotate the staging credentials", ctx);
    expect(r.owners[0]).toMatchObject({ name: "Sam Okafor" });
    expect(r.task).toBe("rotate the staging credentials");
  });
  it("only the first standalone 'to' splits the line", () => {
    const r = analyzeOwner("Priya N. to send revised quote to Acme", ctx);
    expect(r.owners[0]).toMatchObject({ name: "Priya Nair" });
    expect(r.task).toBe("send revised quote to Acme");
  });
  it("no recognisable shape: unowned with the whole line as the task (D25)", () => {
    const r = analyzeOwner("Update the CRM notes", ctx);
    expect(r.owners).toEqual([{ kind: "unowned", name: null, candidates: [], group: null }]);
    expect(r.task).toBe("Update the CRM notes");
  });
  it("a head longer than 6 words is not an owner (D31)", () => {
    const r = analyzeOwner("one two three four five six seven to do it", ctx);
    expect(r.owners[0]).toMatchObject({ kind: "unowned" });
    expect(r.task).toBe("one two three four five six seven to do it");
  });
  it("a plain 'Name: task' (no @) is not a recognised shape", () => {
    const r = analyzeOwner("Anita: do the thing", ctx);
    expect(r.owners[0]).toMatchObject({ kind: "unowned" });
    expect(r.task).toBe("Anita: do the thing");
  });
});

describe("OWN-03 @handle forms (D23)", () => {
  const ctx = { attendees: ["Anita Desai", "Rahul Mehta"], roster };

  it("OWN-03a colon form", () => {
    const r = analyzeOwner("@anita: Review the API documentation", ctx);
    expect(r.owners).toHaveLength(1);
    expect(r.owners[0]).toMatchObject({ kind: "person", name: "Anita Desai" });
    expect(r.task).toBe("Review the API documentation");
  });
  it("OWN-03b to form", () => {
    const r = analyzeOwner("@anita to review the API documentation", ctx);
    expect(r.owners).toHaveLength(1);
    expect(r.owners[0]).toMatchObject({ kind: "person", name: "Anita Desai" });
    expect(r.task).toBe("review the API documentation");
  });
  it("OWN-03a colon form with no space after the colon", () => {
    const r = analyzeOwner("@anita:Review the API documentation", ctx);
    expect(r.owners[0]).toMatchObject({ name: "Anita Desai" });
    expect(r.task).toBe("Review the API documentation");
  });
  it("OWN-03c empty text after the colon gives an empty task", () => {
    expect(analyzeOwner("@anita:", ctx).task).toBe("");
  });
  it("OWN-03e an @ in the middle of a line is not an owner marker", () => {
    const r = analyzeOwner("email @anita for the report", ctx);
    expect(r.owners[0]).toMatchObject({ kind: "unowned" });
    expect(r.task).toBe("email @anita for the report");
  });
  it("@handle resolves through the same rules (ambiguous handle)", () => {
    const r = analyzeOwner("@priya: send it", { attendees: billing, roster });
    expect(r.owners[0]).toMatchObject({ kind: "ambiguous", candidates: ["Priya Nair", "Priya Shah"] });
  });
});

describe("OWN-06 / OWN-07 group versus unowned (D6)", () => {
  const ctx = { attendees: quotePortal, roster };

  it("OWN-06 Everyone is owner_kind group with tag everyone", () => {
    const r = analyzeOwner("Everyone to review the prototype", ctx);
    expect(r.owners).toEqual([{ kind: "group", name: null, candidates: [], group: "everyone" }]);
    expect(r.task).toBe("review the prototype");
  });
  it("OWN-06 Team is owner_kind group with tag team", () => {
    const r = analyzeOwner("Team to decide on the launch date", ctx);
    expect(r.owners).toEqual([{ kind: "group", name: null, candidates: [], group: "team" }]);
  });
  it("OWN-06 is case-insensitive", () => {
    expect(analyzeOwner("EVERYONE to read it", ctx).owners[0]).toMatchObject({ kind: "group", group: "everyone" });
    expect(analyzeOwner("team to read it", ctx).owners[0]).toMatchObject({ kind: "group", group: "team" });
  });
  it.each(["Someone", "TBD", "Anyone", "Unassigned", "?"])("OWN-07 %s is owner_kind unowned with no group tag", (w) => {
    const r = analyzeOwner(`${w} to write the changelog`, ctx);
    expect(r.owners).toEqual([{ kind: "unowned", name: null, candidates: [], group: null }]);
    expect(r.task).toBe("write the changelog");
  });
  it("OWN-07a group never equals unowned in the data", () => {
    const g = analyzeOwner("Everyone to x", ctx).owners[0]!;
    const u = analyzeOwner("Someone to x", ctx).owners[0]!;
    expect(g.kind).not.toBe(u.kind);
    expect(g.kind).toBe("group");
    expect(u.kind).toBe("unowned");
    expect(u.group).toBeNull();
  });
  it("OWN-30 the three kinds in one fixture, in order", () => {
    const kinds = ["Everyone to read the handbook", "Team to pick a launch date", "Someone to book the room"].map(
      (l) => analyzeOwner(l, ctx).owners[0],
    );
    expect(kinds.map((k) => [k!.kind, k!.group])).toEqual([
      ["group", "everyone"],
      ["group", "team"],
      ["unowned", null],
    ]);
  });
});

describe("OWN-04 / OWN-05 several people (D21)", () => {
  const ctx = { attendees: ["Anita Desai", "Rahul Mehta", "Priya Nair", "Lena Fischer"], roster };

  it("OWN-05 'Anita & Rahul' gives two owners, same task", () => {
    const r = analyzeOwner("Anita & Rahul to agree on the component API", ctx);
    expect(r.owners.map((o) => o.name)).toEqual(["Anita Desai", "Rahul Mehta"]);
    expect(r.task).toBe("agree on the component API");
  });
  it("OWN-05 'and' and commas also split", () => {
    expect(analyzeOwner("Anita and Rahul to x", ctx).owners.map((o) => o.name)).toEqual(["Anita Desai", "Rahul Mehta"]);
    expect(analyzeOwner("Anita, Rahul to x", ctx).owners.map((o) => o.name)).toEqual(["Anita Desai", "Rahul Mehta"]);
  });
  it("OWN-26 'Lena (with Priya)' is one owner; the helper is noted in the task", () => {
    const r = analyzeOwner("Lena (with Priya) to collect user feedback on the prototype", ctx);
    expect(r.owners).toHaveLength(1);
    expect(r.owners[0]).toMatchObject({ kind: "person", name: "Lena Fischer" });
    expect(r.task).toBe("collect user feedback on the prototype (with Priya)");
  });
});

describe("analyzeHead for table owner cells (OWN-02)", () => {
  it("resolves a plain owner cell", () => {
    const r = analyzeHead("Anita", { attendees: quotePortal, roster });
    expect(r.owners[0]).toMatchObject({ kind: "person", name: "Anita Desai" });
  });
  it("an empty cell is unowned", () => {
    expect(analyzeHead("  ", { attendees: quotePortal, roster }).owners[0]).toMatchObject({ kind: "unowned" });
  });
  it("a group word in the cell is a group", () => {
    expect(analyzeHead("Everyone", { attendees: quotePortal, roster }).owners[0]).toMatchObject({
      kind: "group",
      group: "everyone",
    });
  });
});
