import type { EstimateLineItem } from "@/components/estimator/estimate-cost-editor";

export function estimateLineTotal(line: Pick<EstimateLineItem, "item_type" | "quantity" | "calculated_quantity" | "unit_cost" | "waste_factor_percent" | "measured_area" | "subcontractor_quote_amount" | "labor_pricing_method" | "labor_rate" | "labor_days" | "labor_hours" | "labor_hours_per_day" | "crew_size" | "permit_amount" | "tax_amount" | "markup_amount">): number {
  let amount = 0;
  if (line.item_type === "material") amount = line.calculated_quantity != null ? line.calculated_quantity * (line.unit_cost ?? 0) : (line.quantity ?? 0) * (line.unit_cost ?? 0) * (1 + (line.waste_factor_percent ?? 0) / 100);
  else if (line.item_type === "labor") {
    const hours = (line.labor_hours ?? 0) > 0 ? line.labor_hours! : (line.labor_days ?? 0) * (line.labor_hours_per_day ?? 0) * (line.crew_size ?? 0);
    amount = line.subcontractor_quote_amount ?? (line.labor_rate ?? 0) * (line.labor_pricing_method === "daily" ? line.labor_days ?? 0 : line.labor_pricing_method === "hourly" ? hours : line.labor_pricing_method === "area" ? line.measured_area ?? 0 : 1);
  } else if (line.item_type !== "scope") amount = (line.permit_amount ?? 0) + (line.tax_amount ?? 0) + (line.markup_amount ?? 0);
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}
