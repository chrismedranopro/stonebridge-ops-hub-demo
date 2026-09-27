import type { EstimateLineItem } from "@/components/estimator/estimate-cost-editor";
import { estimateLineTotal } from "./estimate-costs";

export const COST_CATEGORIES = [
  ["materials", "Materials"], ["equipment", "Equipment"], ["labor", "Labor"],
  ["permit_fees", "Permit and Fees"], ["overhead", "Overhead - Insurance Included"],
  ["profit", "Profit"], ["contingency", "Contingency"], ["bonding", "Bonding"],
  ["mobilization", "Mobilization"], ["travel", "Travel / Lodging"],
  ["tax_delivery", "Tax / Delivery"], ["unclassified", "Unclassified adjustments"],
] as const;
export type CostCategory = typeof COST_CATEGORIES[number][0];
export type CostBuckets = Record<CostCategory, number>;
const emptyBuckets = (): CostBuckets => Object.fromEntries(COST_CATEGORIES.map(([key]) => [key, 0])) as CostBuckets;
const cents = (value: number) => Math.round(value * 100);

export function buildEstimateBreakdowns(lines: EstimateLineItem[]) {
  const scoped = lines.filter(line => line.item_type === "scope" && !line.internal_notes?.startsWith("AI candidate only"));
  const rows = scoped.map(scope => ({ id: scope.id, name: scope.scope_name, costs: emptyBuckets(), total: 0 }));
  const unassigned = { id: "unassigned", name: "Unassigned costs - assign to a scope", costs: emptyBuckets(), total: 0 };
  let candidateTotal = 0;
  for (const line of lines) {
    if (line.item_type === "scope") continue;
    const value = cents(estimateLineTotal(line));
    if (line.internal_notes?.startsWith("AI candidate only")) { candidateTotal += value; continue; }
    const row = rows.find(scope => scope.id === line.parent_line_item_id) ?? unassigned;
    if (line.item_type === "material") row.costs[line.cost_category === "equipment" ? "equipment" : "materials"] += value;
    else if (line.item_type === "labor") row.costs.labor += value;
    else {
      row.costs.permit_fees += cents(line.permit_amount ?? 0);
      row.costs.tax_delivery += cents(line.tax_amount ?? 0);
      const category = COST_CATEGORIES.some(([key]) => key === line.cost_category) ? line.cost_category! : "unclassified";
      row.costs[category] += value - cents(line.permit_amount ?? 0) - cents(line.tax_amount ?? 0);
    }
    row.total += value;
  }
  if (lines.some(line => line.item_type !== "scope" && !line.internal_notes?.startsWith("AI candidate only") && !scoped.some(scope => scope.id === line.parent_line_item_id))) rows.push(unassigned);
  const totals = emptyBuckets();
  for (const row of rows) {
    for (const [key] of COST_CATEGORIES) { totals[key] += row.costs[key]; row.costs[key] /= 100; }
    row.total /= 100;
  }
  const total = Object.values(totals).reduce((sum, amount) => sum + amount, 0) / 100;
  for (const [key] of COST_CATEGORIES) totals[key] /= 100;
  return { rows, totals, total, candidateTotal: candidateTotal / 100, hasUnassigned: rows.includes(unassigned) };
}
