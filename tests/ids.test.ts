/** ID assignment on re-ingest (D33, DUP-25 to DUP-29b, DUP-65). Pure function in dedup.ts. */
import { describe, expect, it } from "vitest";
import { assignIds } from "../src/dedup.js";

describe("DUP-25 candidate ids", () => {
  it("DUP-25 candidates are the distinct previous ids of the group's mentions; null and repeats are ignored", () => {
    const r = assignIds([[4, null, 4]], [4]);
    expect(r.assignments).toEqual([{ id: 4, merged: [4] }]);
  });
  it("DUP-25 an id already taken by an earlier group is not a candidate for a later one", () => {
    const r = assignIds([[1], [1, 5]], [1, 5]);
    expect(r.assignments.map((a) => a.id)).toEqual([1, 5]);
  });
});

describe("DUP-26 the lowest existing id survives a merge", () => {
  it("DUP-26 two existing items in one group: the lowest id survives, the other is absorbed", () => {
    const r = assignIds([[1, 2]], [1, 2]);
    expect(r.assignments).toEqual([{ id: 1, merged: [1, 2] }]);
    expect(r.absorbed).toEqual([2]);
    expect(r.deleted).toEqual([]);
  });
  it("DUP-26 the lowest is chosen by value, not by appearance (DUP-29b example '#7, #3 into #3')", () => {
    const r = assignIds([[7, 3]], [3, 7]);
    expect(r.assignments).toEqual([{ id: 3, merged: [7, 3] }]);
    expect(r.absorbed).toEqual([7]);
  });
});

describe("DUP-27 a group of only new mentions gets a new id", () => {
  it("DUP-27 no candidates means id null (the database allocates one, DUP-24)", () => {
    const r = assignIds([[null, null]], []);
    expect(r.assignments).toEqual([{ id: null, merged: [] }]);
  });
});

describe("DUP-28 a previous id that no group takes is deleted", () => {
  it("DUP-28 ids whose mentions all vanished are deleted, not absorbed", () => {
    const r = assignIds([[1]], [1, 2, 3]);
    expect(r.deleted).toEqual([2, 3]);
    expect(r.absorbed).toEqual([]);
  });
});

describe("DUP-29a a previous item split across groups", () => {
  it("DUP-29a the earliest group keeps the id; the other group gets a new id", () => {
    const r = assignIds([[1], [1]], [1]);
    expect(r.assignments.map((a) => a.id)).toEqual([1, null]);
    expect(r.deleted).toEqual([]);
  });
  it("DUP-29a the other group takes its own remaining candidate when it has one", () => {
    const r = assignIds([[1], [1, 5]], [1, 5]);
    expect(r.assignments.map((a) => a.id)).toEqual([1, 5]);
  });
});

describe("DUP-65 an absorbed id cannot be claimed again in the same ingest", () => {
  it("DUP-65 groups [1,2] then [2]: the first takes 1, id 2 is absorbed, the second gets a new id", () => {
    const r = assignIds([[1, 2], [2]], [1, 2]);
    expect(r.assignments.map((a) => a.id)).toEqual([1, null]);
    expect(r.absorbed).toEqual([2]);
    expect(r.deleted).toEqual([]);
  });
  it("DUP-65 a later group may still take an unclaimed candidate next to an absorbed one", () => {
    const r = assignIds([[1, 2], [2, 3]], [1, 2, 3]);
    expect(r.assignments.map((a) => a.id)).toEqual([1, 3]);
    expect(r.absorbed).toEqual([2]);
  });
});
