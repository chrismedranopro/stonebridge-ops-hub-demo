import { describe, expect, it } from "vitest";
import type { EstimateLineItem } from "@/components/estimator/estimate-cost-editor";
import {
  SYSTEM_FEE_NOTE,
  buildQuotationScopes,
  contractPackageProblem,
  isReleasedEstimate,
  type ContractPackage,
} from "@/lib/contract-package";

const ESTIMATE = "00000000-0000-4000-8000-000000000001";
const DOC = "00000000-0000-4000-8000-0000000000d0";

function line(partial: Partial<EstimateLineItem> & Pick<EstimateLineItem, "id" | "item_type">): EstimateLineItem {
  return {
    estimate_id: ESTIMATE,
    parent_line_item_id: null,
    scope_name: "",
    description: null,
    internal_notes: null,
    quantity: null,
    calculated_quantity: null,
    unit_cost: null,
    waste_factor_percent: null,
    measured_area: null,
    subcontractor_quote_amount: null,
    labor_pricing_method: null,
    labor_rate: null,
    labor_days: null,
    labor_hours: null,
    labor_hours_per_day: null,
    crew_size: null,
    permit_amount: null,
    tax_amount: null,
    markup_amount: null,
    ...partial,
  } as EstimateLineItem;
}

const lines: EstimateLineItem[] = [
  line({ id: "scope-1", item_type: "scope", scope_name: "Attic insulation", description: "Blown-in insulation", sero_scope_document_id: DOC, sero_scope_reference: "p. 4" }),
  line({ id: "mat-1", item_type: "material", parent_line_item_id: "scope-1", material_name: "Cellulose", quantity: 10, unit_cost: 50 }),
  line({ id: "lab-1", item_type: "labor", parent_line_item_id: "scope-1", subcontractor_quote_amount: 300 }),
  // Generated soft cost: counted in the scope total, never listed on its own.
  line({ id: "fee-1", item_type: "fee", parent_line_item_id: "scope-1", markup_amount: 200, internal_notes: SYSTEM_FEE_NOTE }),
  // Unverified AI candidate: excluded from the quotation entirely.
  line({ id: "ai-1", item_type: "scope", scope_name: "Maybe solar", internal_notes: "AI candidate only; verify" }),
];

function pkg(overrides: Partial<ContractPackage> = {}): ContractPackage {
  const scopes = buildQuotationScopes(lines, ESTIMATE, 40);
  return {
    estimateNumber: "EST-ESRP-0100",
    estimateDate: "1/1/2026",
    programTrack: "HOMES",
    homeowner: "Jamie Sample",
    address: "10 Test Way",
    total: 1000,
    rebate: 400,
    outOfPocket: 600,
    scopes,
    draft: true,
    ...overrides,
  };
}

describe("buildQuotationScopes", () => {
  it("folds generated fees into the scope subtotal and splits it into Materials / Labor", () => {
    const [scope, ...rest] = buildQuotationScopes(lines, ESTIMATE, 40);
    expect(rest).toHaveLength(0); // AI candidate scope excluded
    expect(scope.subtotal).toBe(1000); // 500 materials + 300 labor + 200 generated fee
    expect(scope.children.map((child) => [child.name, child.amount])).toEqual([["Materials", 600], ["Labor", 400]]);
    expect(scope.children.reduce((sum, child) => sum + child.amount, 0)).toBe(scope.subtotal);
  });

  it("ignores lines that belong to a different estimate", () => {
    const other = line({ id: "x", item_type: "scope", estimate_id: "someone-else" });
    expect(buildQuotationScopes([...lines, other], ESTIMATE, 40)).toHaveLength(1);
  });
});

describe("contractPackageProblem", () => {
  it("accepts a consistent package", () => {
    expect(contractPackageProblem(pkg())).toBeNull();
  });

  it("rejects totals that do not reconcile with the scope lines", () => {
    expect(contractPackageProblem(pkg({ total: 1200, outOfPocket: 800 }))).toMatch(/must reconcile/);
    expect(contractPackageProblem(pkg({ outOfPocket: 1 }))).toMatch(/must reconcile/);
  });

  it("requires source evidence on every HEAR scope", () => {
    const bare = buildQuotationScopes(lines, ESTIMATE, 40).map((scope) => ({ ...scope, seroDocumentId: null }));
    expect(contractPackageProblem(pkg({ programTrack: "HEAR", scopes: bare }))).toMatch(/Each HEAR scope/);
    expect(contractPackageProblem(pkg({ programTrack: "HEAR" }))).toBeNull();
  });

  it("rejects an empty quotation, bad numbers and unsafe estimate numbers", () => {
    expect(contractPackageProblem(pkg({ scopes: [], total: 0, rebate: 0, outOfPocket: 0 }))).toMatch(/no verified quotation scopes/);
    expect(contractPackageProblem(pkg({ rebate: Number.NaN }))).toMatch(/Invalid quotation cost lines/);
    expect(contractPackageProblem(pkg({ estimateNumber: "../../etc/passwd" }))).toMatch(/Invalid estimate number/);
  });
});

describe("isReleasedEstimate", () => {
  it("treats only internally approved statuses as final", () => {
    expect(["approved", "sent_for_signature", "signed"].every(isReleasedEstimate)).toBe(true);
    expect(["ai_draft", "pending_review", "rejected"].some(isReleasedEstimate)).toBe(false);
  });
});
