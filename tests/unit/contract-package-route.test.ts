// Route-level checks for the contract-package PDF endpoint. The auth guard and
// the database are replaced with fakes so the test runs offline; the database
// rules themselves are covered by tests/db.
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ requireOpsHubUser: vi.fn() }));
import { requireOpsHubUser } from "@/lib/supabase-server";
import { POST } from "@/app/api/estimator/contract-package/route";

const ESTIMATE_ID = "00000000-0000-4000-8000-000000000001";
const guard = vi.mocked(requireOpsHubUser);

type Rows = { single?: unknown; list?: unknown[] };
function fakeDb(tables: Record<string, Rows>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? {};
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: rows.single ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve({ data: rows.list ?? [], error: null }).then(resolve, reject),
      };
      return builder;
    },
  };
}

function request(body: unknown) {
  return new NextRequest("http://localhost/api/estimator/contract-package", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test" },
    body: JSON.stringify(body),
  });
}

const estimate = (overrides: Record<string, unknown> = {}) => ({
  id: ESTIMATE_ID,
  estimate_number: "EST-ESRP-0100",
  program_track: "HOMES",
  status: "ai_draft",
  total_project_cost: 800,
  rebate_amount: 0,
  homeowner_out_of_pocket: 800,
  projects: { homeowner_name: "Jamie Sample", address_line1: "10 Test Way", address_line2: null, phone: null, email: null },
  ...overrides,
});
const lines = [
  { id: "s1", estimate_id: ESTIMATE_ID, item_type: "scope", scope_name: "Insulation", parent_line_item_id: null, internal_notes: null },
  { id: "m1", estimate_id: ESTIMATE_ID, item_type: "material", parent_line_item_id: "s1", quantity: 10, unit_cost: 50, internal_notes: null },
  { id: "l1", estimate_id: ESTIMATE_ID, item_type: "labor", parent_line_item_id: "s1", subcontractor_quote_amount: 300, internal_notes: null },
];

function allowWith(tables: Record<string, Rows>) {
  guard.mockResolvedValue({ ok: true, db: fakeDb(tables) as never });
}

beforeEach(() => {
  guard.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /api/estimator/contract-package", () => {
  it("returns the guard's response when the caller is not authorized", async () => {
    guard.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Sign in to continue." }, { status: 401 }) });
    const response = await POST(request({ estimateId: ESTIMATE_ID }));
    expect(response.status).toBe(401);
  });

  it("accepts only an estimate id -- not client-supplied amounts or draft flags", async () => {
    allowWith({});
    expect((await POST(request({ estimateNumber: "EST-1", total: 1, draft: false }))).status).toBe(400);
    expect((await POST(request({ estimateId: "not-a-uuid" }))).status).toBe(400);
    expect((await POST(request({ estimateId: ESTIMATE_ID, includeTerms: "yes" }))).status).toBe(400);
  });

  it("returns 404 when the estimate is not visible to the caller", async () => {
    allowWith({ estimates: { single: null } });
    expect((await POST(request({ estimateId: ESTIMATE_ID }))).status).toBe(404);
  });

  it("refuses to print a package whose saved totals do not reconcile", async () => {
    allowWith({ estimates: { single: estimate({ total_project_cost: 5000, homeowner_out_of_pocket: 5000 }) }, estimate_line_items: { list: lines } });
    const response = await POST(request({ estimateId: ESTIMATE_ID }));
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/must reconcile/);
  });

  it("renders a PDF from the saved estimate", async () => {
    allowWith({ estimates: { single: estimate() }, estimate_line_items: { list: lines }, estimate_pricing_assumptions: { single: { labor_split_percent: 40 } } });
    const response = await POST(request({ estimateId: ESTIMATE_ID, includeTerms: false }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("EST-ESRP-0100-HOMES-Quotation.pdf");
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("hides internal error details from the caller", async () => {
    guard.mockResolvedValue({ ok: true, db: { from: () => { throw new Error("connection string leaked"); } } as never });
    const response = await POST(request({ estimateId: ESTIMATE_ID }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("leaked");
  });
});
