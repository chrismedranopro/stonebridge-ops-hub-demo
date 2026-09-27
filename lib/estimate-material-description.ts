import type { EstimateLineItem } from "@/components/estimator/estimate-cost-editor";

/** Use the same complete material description in the preview and both PDF exports. */
export function estimateMaterialDescription(line: EstimateLineItem): string {
  if (line.item_type === "labor" && line.labor_pricing_method === "area") {
    return [line.description, `Measured area: ${line.measured_area ?? 0} ${line.area_unit || "sq ft"}`, `Labor basis: ${line.measured_area ?? 0} x $${line.labor_rate ?? 0} per ${line.area_unit || "sq ft"}`].filter(Boolean).join("\n");
  }
  if (line.item_type !== "material") return line.description || "";
  const homeownerComplianceReference = line.compliance_reference?.replace(/https?:\/\/\S+/gi, "").trim();
  const isModeledEquipment = Boolean(line.model_number || line.ahri_reference || line.energy_star_certified != null);
  if (isModeledEquipment) {
    const specifications = line.technical_specifications
      ?.split(/;\s*|\r?\n/)
      .map(value => value.trim())
      .filter(Boolean)
      .join("\n");
    return [
      line.ahri_reference && `AHRI # ${line.ahri_reference}`,
      line.material_name,
      line.model_number && `MODEL # ${line.model_number}`,
      line.energy_star_certified === true ? "ENERGY STAR Certified" : line.energy_star_certified === false ? "Not ENERGY STAR Certified" : "ENERGY STAR verification pending",
      specifications,
      homeownerComplianceReference && `Program requirement: ${homeownerComplianceReference}`,
    ].filter((value): value is string => typeof value === "string" && !!value.trim()).join("\n");
  }
  const details = [line.description, line.material_name,
    line.manufacturer && `Manufacturer: ${line.manufacturer}`,
    line.model_number && `Model: ${line.model_number}`,
    line.measured_area != null && `Measured area: ${line.measured_area} ${line.area_unit || "sq ft"}`,
    (line.calculated_quantity ?? line.quantity) != null && `Quantity: ${line.calculated_quantity ?? line.quantity} ${line.unit_of_measure || "(unit required)"}${line.calculated_quantity != null ? " (calculated from area, coverage and allowance)" : ""}`,
    line.technical_specifications && `Specifications: ${line.technical_specifications}`,
    line.ahri_reference ? `AHRI reference: ${line.ahri_reference}${line.ahri_certificate_url ? " (certificate recorded; confirm exact matched equipment)" : " (certificate verification pending)"}` : null,
    line.energy_star_certified === false ? "ENERGY STAR: not certified" :
      line.energy_star_certified === true ? "ENERGY STAR: certification recorded" : "ENERGY STAR: verification pending or applicability to be reviewed",
    homeownerComplianceReference && `Program requirement: ${homeownerComplianceReference}`,
  ].filter((value): value is string => typeof value === "string" && !!value.trim());
  return [...new Set(details.map(value => value.trim()))].join("\n");
}
