// Homeowner quotation content, shared by the on-screen preview and the
// server-generated PDF so the two can never disagree. Pure functions only:
// no React, no Supabase, safe to import from a route handler or a test.
import type { EstimateLineItem } from "@/components/estimator/estimate-cost-editor";
import { estimateLineTotal } from "./estimate-costs";
import { estimateMaterialDescription } from "./estimate-material-description";

/** Statuses at which the internal review chain has signed off. Anything else is a draft. */
export const RELEASED_ESTIMATE_STATUSES = ["approved", "sent_for_signature", "signed"] as const;
export const SYSTEM_FEE_NOTE = "SYSTEM: calculated from workbook pricing assumptions";
const QUOTED_ITEM_TYPES = ["scope", "material", "labor", "fee", "adjustment"];
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const ESTIMATE_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ./_-]{0,79}$/;

export type ProgramTrack = "HOMES" | "HEAR";
export interface QuoteLine { number: string; name: string; description: string; amount: number }
export interface QuoteScope {
  number: string;
  name: string;
  description: string;
  seroDocumentId?: string | null;
  seroScopeReference?: string | null;
  subtotal: number;
  children: QuoteLine[];
}
export interface ContractPackage {
  estimateNumber: string;
  estimateDate: string;
  programTrack: ProgramTrack;
  homeowner: string;
  address: string;
  phone?: string | null;
  email?: string | null;
  total: number;
  rebate: number;
  outOfPocket: number;
  scopes: QuoteScope[];
  /** Derived from the estimate's status, never from the caller. */
  draft: boolean;
}

export function isReleasedEstimate(status: string): boolean {
  return (RELEASED_ESTIMATE_STATUSES as readonly string[]).includes(status);
}

/** Lines that belong on the quotation: priced lines plus scopes, minus unverified AI candidates. */
export function quotationLines(lines: EstimateLineItem[], estimateId: string) {
  const estimateLines = lines.filter((line) =>
    line.estimate_id === estimateId
    && QUOTED_ITEM_TYPES.includes(line.item_type)
    && !line.internal_notes?.startsWith("AI candidate only"));
  // Generated soft-cost lines are folded into each scope's total rather than listed.
  const customerLines = estimateLines.filter((line) => line.internal_notes !== SYSTEM_FEE_NOTE);
  const scopes = customerLines.filter((line) => line.item_type === "scope");
  return { estimateLines, customerLines, scopes };
}

/** A scope's homeowner-facing Materials / Labor rows, split by the estimate's labor percentage. */
export function scopeQuoteChildren(
  scope: EstimateLineItem,
  index: number,
  { estimateLines, customerLines }: ReturnType<typeof quotationLines>,
  laborSplitPercent: number,
): QuoteLine[] {
  const scoped = customerLines.filter((line) => line.parent_line_item_id === scope.id);
  const scopeTotal = estimateLines
    .filter((line) => line.parent_line_item_id === scope.id)
    .reduce((sum, line) => sum + estimateLineTotal(line), 0);
  const labor = Math.round(scopeTotal * laborSplitPercent) / 100;
  const material = Math.round((scopeTotal - labor) * 100) / 100;
  const describe = (type: "material" | "labor", fallback: string) =>
    scoped.filter((line) => line.item_type === type).map(estimateMaterialDescription).filter(Boolean).join("\n\n") || fallback;
  return [
    { number: `${index + 1}.1`, name: "Materials", description: describe("material", "Materials and equipment required for the described scope."), amount: material },
    { number: `${index + 1}.2`, name: "Labor", description: describe("labor", "Labor required to complete, test, inspect, and clean up the described scope."), amount: labor },
  ];
}

export function buildQuotationScopes(lines: EstimateLineItem[], estimateId: string, laborSplitPercent: number): QuoteScope[] {
  const quote = quotationLines(lines, estimateId);
  return quote.scopes.map((scope, index) => ({
    number: String(index + 1),
    name: scope.scope_name || `Scope ${index + 1}`,
    description: scope.description || "",
    seroDocumentId: scope.sero_scope_document_id,
    seroScopeReference: scope.sero_scope_reference,
    subtotal: quote.estimateLines
      .filter((line) => line.parent_line_item_id === scope.id)
      .reduce((sum, line) => sum + estimateLineTotal(line), 0),
    children: scopeQuoteChildren(scope, index, quote, laborSplitPercent),
  }));
}

/**
 * Deterministic checks a package must pass before a PDF is produced.
 * Returns a human-readable reason, or null when the package is consistent.
 */
export function contractPackageProblem(pkg: ContractPackage): string | null {
  if (!ESTIMATE_NUMBER_PATTERN.test(pkg.estimateNumber)) return "Invalid estimate number.";
  if (pkg.programTrack !== "HOMES" && pkg.programTrack !== "HEAR") return "Invalid program track.";
  if (!pkg.scopes.length) return "The estimate has no verified quotation scopes yet.";
  if (pkg.programTrack === "HEAR" && pkg.scopes.some((scope) =>
    !scope.seroScopeReference?.trim() || !scope.seroDocumentId || !UUID.test(scope.seroDocumentId))) {
    return "Each HEAR scope needs a supporting audit, site-visit, work-order/specification, or HVAC-design document and an applicable reference.";
  }
  const amounts = [pkg.total, pkg.rebate, pkg.outOfPocket, ...pkg.scopes.flatMap((scope) => [scope.subtotal, ...scope.children.map((line) => line.amount)])];
  if (amounts.some((amount) => !Number.isFinite(amount))) return "Invalid quotation cost lines.";
  const lineTotal = pkg.scopes.reduce((sum, scope) => sum + scope.subtotal, 0);
  if (Math.abs(lineTotal - pkg.total) > 0.01 || Math.abs(Math.max(pkg.total - pkg.rebate, 0) - pkg.outOfPocket) > 0.01) {
    return "Quotation line costs, total, rebate and homeowner amount must reconcile. Resolve unassigned costs or a total mismatch first.";
  }
  return null;
}
