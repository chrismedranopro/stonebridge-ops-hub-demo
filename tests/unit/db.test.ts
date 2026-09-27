import { describe, expect, it, vi } from "vitest";
import { DbError, PartialLoad, expectRowsChanged, unwrap, unwrapList } from "@/lib/db";
import { programPortalUrl } from "@/lib/program-portal";

const failure = { data: null, error: { message: "permission denied for table projects", code: "42501" } };

describe("unwrap / unwrapList", () => {
  it("throws a DbError naming what was being loaded", () => {
    expect(() => unwrapList(failure, "Projects")).toThrow(DbError);
    try {
      unwrap(failure, "Projects");
    } catch (error) {
      expect(error).toBeInstanceOf(DbError);
      expect((error as DbError).source).toBe("Projects");
      expect((error as DbError).code).toBe("42501");
      expect((error as DbError).message).toBe("Projects: permission denied for table projects");
    }
  });

  it("returns data on success", () => {
    expect(unwrapList({ data: [1, 2], error: null }, "x")).toEqual([1, 2]);
    expect(unwrapList({ data: null, error: null }, "x")).toEqual([]);
    expect(unwrap({ data: { id: 1 }, error: null }, "x")).toEqual({ id: 1 });
  });
});

describe("expectRowsChanged", () => {
  it("treats an update that silently matched zero rows (RLS-filtered) as a failure", () => {
    expect(() => expectRowsChanged({ data: [], error: null }, 1, "Resolve inbox message")).toThrow(/expected to update 1 row\(s\) but updated 0/);
  });

  it("passes when every requested row changed", () => {
    expect(() => expectRowsChanged({ data: [{ id: "a" }, { id: "b" }], error: null }, 2, "x")).not.toThrow();
  });
});

describe("PartialLoad", () => {
  it("records failed sections instead of reporting an empty, complete result", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const load = new PartialLoad();
    expect(load.rows({ data: [1], error: null }, "Leads")).toEqual([1]);
    expect(load.rows(failure, "Compliance documents")).toEqual([]);
    expect(load.complete).toBe(false);
    expect(load.failedSources).toEqual(["Compliance documents"]);
    spy.mockRestore();
  });
});

describe("programPortalUrl", () => {
  it("builds links on the reserved, fictional portal domain and encodes the id", () => {
    expect(programPortalUrl("abc 123")).toBe("https://portal.esrp.example/applications/abc%20123");
  });
});
