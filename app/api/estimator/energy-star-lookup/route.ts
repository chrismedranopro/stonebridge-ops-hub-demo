import { NextRequest, NextResponse } from "next/server";

type EnergyStarRow = Record<string, string | undefined>;
const normalize = (value: string | undefined) => (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function GET(request: NextRequest) {
  const model = request.nextUrl.searchParams.get("model")?.trim() ?? "";
  const ahri = request.nextUrl.searchParams.get("ahri")?.trim() ?? "";
  if ((!model && !ahri) || model.length > 160 || ahri.length > 40) return NextResponse.json({ error: "Enter a model number or AHRI reference." }, { status: 400 });
  const tokens = model.split(/[\/,;]+/).map(normalize).filter(Boolean);
  const datasets = (ahri ? [
    { id: "w7cv-9xjt", kind: "Air-source heat pump" },
  ] : [
    { id: "w7cv-9xjt", kind: "Air-source heat pump" },
    { id: "v7jr-74b4", kind: "Heat-pump water heater" },
  ]);
  try {
    const rows = await Promise.all(datasets.map(async dataset => {
      const url = new URL(`https://data.energystar.gov/resource/${dataset.id}.json`);
      url.searchParams.set("$limit", "50");
      if (ahri) url.searchParams.set("$where", `ahri_reference_number=${Number(ahri.replace(/\D/g, ""))}`);
      else if (dataset.id === "w7cv-9xjt") url.searchParams.set("$where", `upper(model_number) like '${tokens[0]}%' or upper(indoor_unit_model_number) like '${tokens[0]}%'`);
      else url.searchParams.set("$where", `upper(model_number)='${tokens[0]}'`);
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`ENERGY STAR returned ${response.status}`);
      return ((await response.json()) as EnergyStarRow[]).map(row => ({ ...row, datasetId: dataset.id, kind: dataset.kind } as EnergyStarRow & { datasetId: string; kind: string }));
    }));
    const matches = rows.flat().filter(row => {
      if (ahri && normalize(row.ahri_reference_number) === normalize(ahri)) return true;
      const certifiedModels = [normalize(row.model_number), normalize(row.indoor_unit_model_number)];
      return tokens.length > 0 && tokens.every(token => certifiedModels.includes(token));
    }).slice(0, 5).map(row => {
      const fields = row.kind === "Air-source heat pump"
        ? [`SEER2 ${row.seer2_btu_wh}`, `EER2 ${row.eer2_btu_wh}`, `HSPF2 ${row.hspf2_btu_wh}`, `Cooling capacity ${row.cooling_capacity_btu_h} Btu/h`, `Heating capacity at 47°F ${row.heating_capacity_at_47_f_btu_h} Btu/h`, row.refrigerant_with_gwp]
        : [`Storage volume ${row.storage_volume_gallons} gal`, `First-hour rating ${row.first_hour_rating_gallons} gal`, `UEF ${row.uniform_energy_factor_uef}`, `${row.input_volts_for_hpwh} V`, row.refrigerant_with_gwp];
      return {
        kind: row.kind,
        uniqueId: row.pd_id,
        manufacturer: row.outdoor_unit_brand_name || row.brand_name || row.energy_star_partner,
        outdoorModel: row.model_number,
        indoorModel: row.indoor_unit_model_number,
        ahriReference: row.ahri_reference_number,
        dateCertified: row.date_certified,
        specifications: fields.filter(value => value && !value.includes("undefined")).join("; "),
        sourceUrl: `https://data.energystar.gov/resource/${row.datasetId}.json?pd_id=${encodeURIComponent(row.pd_id ?? "")}`,
      };
    });
    return NextResponse.json({ matches, checkedAt: new Date().toISOString(), source: "U.S. EPA ENERGY STAR certified-products data" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "ENERGY STAR lookup failed." }, { status: 502 });
  }
}
