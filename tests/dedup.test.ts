import { describe, it, expect } from "vitest";
import { THRESHOLD, groupMentions, ownerKey, similarity, taskKey } from "../src/dedup.js";
import type { OwnerSpec } from "../src/models.js";

const person = (name: string): OwnerSpec => ({ kind: "person", name, candidates: [], group: null });

describe("DUP-01 task key", () => {
  it("lowercases, drops stop words, possessives and punctuation", () => {
    expect([...taskKey("Book the renewal call with Acme's CTO")].sort()).toEqual(["acme", "book", "call", "cto", "renewal"]);
  });
  it("drops version qualifiers", () => {
    expect([...taskKey("share updated wireframes")].sort()).toEqual(["share", "wireframes"]);
    expect([...taskKey("share first wireframes")].sort()).toEqual(["share", "wireframes"]);
  });
  it("is a set (order and repeats do not matter)", () => {
    expect(similarity(taskKey("fix pagination bug"), taskKey("bug pagination fix fix"))).toBe(1);
  });
});

describe("DUP-03 similarity", () => {
  it("threshold constant is 0.6 (DUP-06)", () => {
    expect(THRESHOLD).toBe(0.6);
  });
  it("Jaccard over word sets", () => {
    expect(similarity(new Set(["a", "b", "c"]), new Set(["a", "b", "d"]))).toBeCloseTo(0.5);
  });
  it("short sets only match when identical", () => {
    const g = (tasks: string[]) =>
      groupMentions(tasks.map((task) => ({ ownerKey: "x", task })));
    expect(g(["refund", "refund"])).toEqual([0, 0]);
    expect(g(["refund", "refund customers"])).toEqual([0, 1]);
  });
});

describe("DUP-02 owner keys", () => {
  it("person keys are case-insensitive names", () => {
    expect(ownerKey(person("Priya Nair"))).toBe(ownerKey(person("priya nair")));
  });
  it("a person never equals an ambiguous or unowned key", () => {
    const amb: OwnerSpec = { kind: "ambiguous", name: null, candidates: ["Priya Nair", "Priya Shah"], group: null };
    const un: OwnerSpec = { kind: "unowned", name: null, candidates: [], group: null };
    const keys = [person("Priya Nair"), amb, un].map(ownerKey);
    expect(new Set(keys).size).toBe(3);
  });
  it("ambiguous keys depend on the candidate set, not its order", () => {
    const a: OwnerSpec = { kind: "ambiguous", name: null, candidates: ["Priya Nair", "Priya Shah"], group: null };
    const b: OwnerSpec = { kind: "ambiguous", name: null, candidates: ["Priya Shah", "Priya Nair"], group: null };
    const c: OwnerSpec = { kind: "ambiguous", name: null, candidates: ["Rahul Mehta", "Rahul Verma"], group: null };
    expect(ownerKey(a)).toBe(ownerKey(b));
    expect(ownerKey(a)).not.toBe(ownerKey(c));
  });
  it("OWN-07a group tags and unowned are all different keys", () => {
    const g = (tag: "everyone" | "team"): OwnerSpec => ({ kind: "group", name: null, candidates: [], group: tag });
    const un: OwnerSpec = { kind: "unowned", name: null, candidates: [], group: null };
    expect(new Set([ownerKey(g("everyone")), ownerKey(g("team")), ownerKey(un)]).size).toBe(3);
  });
});

describe("DUP-04 grouping", () => {
  const m = (owner: string, task: string) => ({ ownerKey: owner, task });

  it("merges rewordings for the same owner", () => {
    const groups = groupMentions([
      m("priya nair", "send the revised quote to Acme"),
      m("priya nair", "send revised quote to Acme"),
      m("priya nair", "send the revised quote to Acme"),
    ]);
    expect(groups).toEqual([0, 0, 0]);
  });
  it("DUP-41 first vs updated wireframes merge", () => {
    expect(groupMentions([m("anita", "share first wireframes"), m("anita", "share updated wireframes")])).toEqual([0, 0]);
  });
  it("different owners never merge", () => {
    expect(groupMentions([m("rahul mehta", "fix the pagination bug"), m("rahul verma", "fix the pagination bug")])).toEqual([0, 1]);
  });
  it("DUP-05 checkbox state is not an input, only the task text", () => {
    expect(groupMentions([m("a", "deploy the beta to staging"), m("a", "deploy the beta to staging")])).toEqual([0, 0]);
  });

  describe("DUP-50..55 must NOT merge", () => {
    const pairs: [string, string][] = [
      ["ask Acme for their procurement contact", "send Acme the procurement form"],
      ["review the schema mapping doc", "review Anita's PR"],
      ["draft the test plan for invoice rounding", "run the invoice rounding tests"],
      ["fix the pagination bug", "fix the top three critical bugs"],
      ["share the VPN guide", "write the VPN guide"],
      ["book the renewal call with Acme's CTO", "prepare the renewal one-pager"],
    ];
    it.each(pairs)("%s / %s", (a, b) => {
      expect(groupMentions([m("same", a), m("same", b)])).toEqual([0, 1]);
    });
  });

  it("a mention joins the best group; ties go to the lowest group index", () => {
    // The first two score 3/7 (separate groups); the third scores 3/5 = 0.6 against both.
    const groups = groupMentions([
      m("a", "alpha beta gamma delta epsilon"),
      m("a", "alpha beta gamma zeta eta"),
      m("a", "alpha beta gamma"),
    ]);
    expect(groups).toEqual([0, 1, 0]);
  });

  it("DUP-60 a bridging mention merges two groups that do not match each other", () => {
    const A = m("anita desai", "update the style guide colours");
    const B = m("anita desai", "update the style guide colours and typography");
    const C = m("anita desai", "update the style guide typography fonts");
    expect(similarity(taskKey(A.task), taskKey(B.task))).toBeCloseTo(0.8);
    expect(similarity(taskKey(B.task), taskKey(C.task))).toBeCloseTo(2 / 3);
    expect(similarity(taskKey(A.task), taskKey(C.task))).toBeCloseTo(0.5);
    expect(groupMentions([A, C])).toEqual([0, 1]);
    expect(groupMentions([A, B, C])).toEqual([0, 0, 0]);
  });
});
