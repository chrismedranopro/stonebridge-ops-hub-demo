"use client";

import { useEffect, useMemo, useState } from "react";
import { estimateLineTotal } from "@/lib/estimate-costs";
import { COST_CATEGORIES, type CostCategory } from "@/lib/estimate-breakdowns";
import type { PackageDocument } from "./estimate-package-view";
import { supabase } from "@/lib/supabase";

export interface EstimateLineItem {
  id: string;
  estimate_id: string;
  parent_line_item_id: string | null;
  item_type: "scope" | "material" | "labor" | "fee" | "adjustment";
  scope_name: string;
  description: string | null;
  area_location: string | null;
  measured_area?: number | null;
  area_unit?: string | null;
  coverage_per_unit?: number | null;
  calculated_quantity?: number | null;
  area_allowance_percent?: number | null;
  material_name: string | null;
  manufacturer: string | null;
  model_number: string | null;
  technical_specifications?: string | null;
  energy_star_source_url?: string | null;
  specification_source?: string | null;
  compliance_reference?: string | null;
  energy_star_certified: boolean | null;
  ahri_reference: string | null;
  ahri_certificate_url: string | null;
  source_vendor: string | null;
  source_url: string | null;
  source_checked_at: string | null;
  quantity: number | null;
  unit_of_measure: string | null;
  unit_cost: number | null;
  waste_factor_percent: number | null;
  subcontractor_name: string | null;
  labor_pricing_method: "daily" | "hourly" | "fixed" | "area" | null;
  labor_rate: number | null;
  labor_days: number | null;
  labor_hours: number | null;
  labor_hours_per_day: number | null;
  crew_size: number | null;
  subcontractor_quote_amount: number | null;
  program_hourly_rate: number | null;
  subcontractor_quote_url: string | null;
  labor_rate_override_reason: string | null;
  permit_amount: number | null;
  tax_amount: number | null;
  markup_amount: number | null;
  rebate_eligible: boolean | null;
  internal_notes: string | null;
  ai_generated: boolean;
  ai_confidence: number | null;
  sort_order: number;
  cost_category?: CostCategory | null;
  sero_scope_document_id?: string | null;
  sero_scope_reference?: string | null;
}

type Draft = Omit<EstimateLineItem, "id" | "estimate_id" | "sort_order">;
type PricingAssumptions = { county:string|null; tax_rate:number|null; tax_source_url?:string|null; tax_checked_at?:string|null; overhead_percent:number; profit_percent:number; contingency_percent:number; bonding_percent:number; mobilization_percent:number; travel_percent:number; material_split_percent:number; labor_split_percent:number };
const defaultAssumptions:PricingAssumptions={county:null,tax_rate:null,overhead_percent:7,profit_percent:7,contingency_percent:1,bonding_percent:3,mobilization_percent:2,travel_percent:1,material_split_percent:55,labor_split_percent:45};

function n(value: unknown): number | null {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const lineTotal = estimateLineTotal;

function totalLaborHours(line: EstimateLineItem | Draft): number {
  if ((line.labor_hours ?? 0) > 0) return line.labor_hours ?? 0;
  return (line.labor_days ?? 0) * (line.labor_hours_per_day ?? 0) * (line.crew_size ?? 0);
}

function laborQuoteTotal(line: EstimateLineItem | Draft): number {
  if (line.labor_pricing_method === "area") return (line.measured_area ?? 0) * (line.labor_rate ?? 0);
  if (line.subcontractor_quote_amount != null) return line.subcontractor_quote_amount;
  if (line.labor_pricing_method === "daily") return (line.labor_rate ?? 0) * (line.labor_days ?? 0);
  if (line.labor_pricing_method === "hourly") return (line.labor_rate ?? 0) * totalLaborHours(line);
  return line.labor_rate ?? 0;
}

function programLaborTotal(line: EstimateLineItem | Draft): number {
  return (line.program_hourly_rate ?? 0) * totalLaborHours(line);
}

function laborDifference(line: EstimateLineItem | Draft): number {
  return programLaborTotal(line) - laborQuoteTotal(line);
}

function currency(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const inputClass = "mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-sm text-white outline-none focus:border-cyan-400/50 disabled:cursor-not-allowed disabled:text-slate-500";

export function EstimateCostEditor({
  estimateId,
  estimateStatus,
  lines,
  onSaved,
  documents = [],
  programTrack,
}: {
  estimateId: string;
  estimateStatus: string;
  lines: EstimateLineItem[];
  onSaved: () => Promise<void>;
  documents?: PackageDocument[];
  programTrack?: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assumptions,setAssumptions]=useState<PricingAssumptions>(defaultAssumptions);
  const [assumptionStatus,setAssumptionStatus]=useState("");
  const [countyRates, setCountyRates] = useState<{county:string;rate:number}[]>([]);
  const [taxReference, setTaxReference] = useState<{sourceUrl:string;checkedAt:string}|null>(null);
  const [taxError, setTaxError] = useState("");
  const [energyStarStatus, setEnergyStarStatus] = useState("");
  async function refreshTaxRates() {
    try {
      const response = await fetch("/api/estimator/county-tax-rates");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setTaxError(""); setCountyRates(data.rates); setTaxReference({sourceUrl:data.sourceUrl,checkedAt:data.checkedAt});
    } catch (error) { setCountyRates([]); setTaxReference(null); setTaxError(error instanceof Error ? error.message : "Unable to verify rates"); }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => void refreshTaxRates(), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const countyRule = countyRates.find(rule => rule.county.toLowerCase() === assumptions.county?.trim().toLowerCase());
  const locked = ["approved", "sent_for_signature", "signed"].includes(estimateStatus);

  const total = useMemo(() => lines.reduce((sum, line) => sum + lineTotal(line), 0), [lines]);
  const editableLines = useMemo(() => lines.filter((line) => line.internal_notes !== "SYSTEM: calculated from workbook pricing assumptions"), [lines]);
  const scopeLines = useMemo(() => lines.filter((line) => line.item_type === "scope" && !line.internal_notes?.startsWith("AI candidate only")), [lines]);
  const permitLineFor = (scopeId: string) => lines.find((line) => line.parent_line_item_id === scopeId && line.cost_category === "permit_fees");

  useEffect(()=>{let active=true;void supabase.from("estimate_pricing_assumptions").select("county,tax_rate,tax_source_url,tax_checked_at,overhead_percent,profit_percent,contingency_percent,bonding_percent,mobilization_percent,travel_percent,material_split_percent,labor_split_percent").eq("estimate_id",estimateId).maybeSingle().then(({data,error:loadError})=>{if(active&&loadError)setAssumptionStatus(loadError.message);if(active&&data)setAssumptions(data as PricingAssumptions);});return()=>{active=false};},[estimateId]);

  async function saveAssumptions(){
    if (!countyRule || !taxReference) { setAssumptionStatus("Select a county with a currently verified NCDOR rate before saving."); return; }
    if(Math.abs(assumptions.material_split_percent+assumptions.labor_split_percent-100)>.001){setAssumptionStatus("Material and labor splits must total 100%.");return;}
    setAssumptionStatus("Saving...");
    const {error:saveError}=await supabase.from("estimate_pricing_assumptions").upsert({estimate_id:estimateId,...assumptions,county:countyRule.county,tax_rate:countyRule.rate,tax_source_url:taxReference.sourceUrl,tax_checked_at:taxReference.checkedAt,updated_at:new Date().toISOString()});
    if (saveError) { setAssumptionStatus(saveError.message); return; }
    setAssumptions(a => ({...a,tax_rate:countyRule.rate,tax_source_url:taxReference.sourceUrl,tax_checked_at:taxReference.checkedAt}));
    const { error: calculationError } = await supabase.rpc("apply_estimate_pricing_assumptions", { p_estimate_id: estimateId });
    if (calculationError) { setAssumptionStatus(calculationError.message); return; }
    setAssumptionStatus("Saved and applied to the estimate");
    await supabase.rpc("recalculate_esrp_rebate",{p_estimate_id:estimateId});await supabase.rpc("recompute_estimate_validation",{p_estimate_id:estimateId});await onSaved();
  }

  function startEdit(line: EstimateLineItem) {
    const { id: _id, estimate_id: _estimateId, sort_order: _sort, ...rest } = line;
    void _id; void _estimateId; void _sort;
    setEditingId(line.id);
    setDraft(rest);
    setError(null);
  }

  function startAdd(type: Draft["item_type"], category?: CostCategory, parentLineItemId?: string) {
    const firstScope = lines.find((line) => line.item_type === "scope" && !line.internal_notes?.startsWith("AI candidate only"));
    setEditingId("new");
    setDraft({
      cost_category: category ?? (type === "material" ? "materials" : type === "labor" ? "labor" : null),
      parent_line_item_id: type === "scope" ? null : parentLineItemId ?? firstScope?.id ?? null, item_type: type, scope_name: category === "equipment" ? "Equipment" : category === "permit_fees" ? "Permit / Fees" : "", description: null,
      area_location: null, material_name: null, manufacturer: null, model_number: null,
      measured_area: null, area_unit: "sq ft", coverage_per_unit: null, calculated_quantity: null, area_allowance_percent: null,
      energy_star_certified: null, ahri_reference: null, ahri_certificate_url: null,
      source_vendor: null, source_url: null, source_checked_at: null, quantity: null, unit_of_measure: null,
      unit_cost: null, waste_factor_percent: null, subcontractor_name: null,
      labor_pricing_method: type === "labor" ? "daily" : null, labor_rate: null,
      labor_days: null, labor_hours: null, labor_hours_per_day: type === "labor" ? 8 : null,
      crew_size: null, subcontractor_quote_amount: null, program_hourly_rate: null,
      subcontractor_quote_url: null, labor_rate_override_reason: null, permit_amount: category === "permit_fees" ? 0 : null,
      tax_amount: null, markup_amount: null, rebate_eligible: null, internal_notes: null,
      ai_generated: false, ai_confidence: null,
    });
    setError(null);
  }

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  async function lookupEnergyStar() {
    if (!draft?.model_number && !draft?.ahri_reference) { setEnergyStarStatus("Enter a model number or AHRI reference first."); return; }
    setEnergyStarStatus("Checking the official ENERGY STAR dataset...");
    try {
      const params = new URLSearchParams({ model: draft.model_number ?? "", ahri: draft.ahri_reference ?? "" });
      const response = await fetch(`/api/estimator/energy-star-lookup?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (data.matches.length !== 1) { setEnergyStarStatus(data.matches.length ? `${data.matches.length} possible matches found. Refine the model or AHRI number.` : "No exact official match found. Check the model/AHRI entry or document the non-certified result manually."); return; }
      const match = data.matches[0];
      setDraft(current => current ? { ...current, manufacturer: current.manufacturer || match.manufacturer || null, ahri_reference: current.ahri_reference || match.ahriReference || null, technical_specifications: match.specifications || current.technical_specifications, specification_source: match.sourceUrl, energy_star_source_url: match.sourceUrl, energy_star_certified: null } : current);
      setEnergyStarStatus(`Official exact match found (${match.uniqueId}). Open the source, then Christina selects the certification decision.`);
    } catch (error) { setEnergyStarStatus(error instanceof Error ? error.message : "ENERGY STAR lookup failed."); }
  }

  async function save() {
    if (!draft || !draft.scope_name.trim()) {
      setError("Scope or line-item name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    let normalizedDraft = draft.item_type === "material" ? { ...draft, cost_category: "materials" as CostCategory } : draft;
    if (draft.item_type === "material" && (draft.measured_area ?? 0) > 0 && (draft.coverage_per_unit ?? 0) > 0) {
      normalizedDraft = { ...normalizedDraft, calculated_quantity: Math.ceil((draft.measured_area! / draft.coverage_per_unit!) * (1 + (draft.area_allowance_percent ?? 0) / 100)) };
    }
    if (draft.item_type === "labor") {
      const areaQuote = draft.labor_pricing_method === "area" ? (draft.measured_area ?? 0) * (draft.labor_rate ?? 0) : null;
      const laborDraft = areaQuote != null ? { ...draft, subcontractor_quote_amount: areaQuote } : draft;
      const hours = totalLaborHours(laborDraft);
      const quote = laborQuoteTotal(laborDraft);
      const hourlyRate = draft.program_hourly_rate ?? (hours > 0 ? quote / hours : null);
      normalizedDraft = {
        ...laborDraft,
        labor_hours: hours > 0 ? hours : null,
        subcontractor_quote_amount: quote > 0 ? quote : null,
        program_hourly_rate: hourlyRate,
      };
      if (hours <= 0 || quote <= 0 || hourlyRate == null || hourlyRate <= 0) {
        setError("Labor needs positive total crew-hours, an agreed subcontractor total, and a program hourly rate.");
        setSaving(false);
        return;
      }
      if (Math.abs(laborDifference(normalizedDraft)) > 0.01) {
        setError("Program hourly labor must reconcile to the subcontractor agreement within $0.01. Use the reconciled hourly rate before saving.");
        setSaving(false);
        return;
      }
    }
    const payload = {
      ...normalizedDraft,
      scope_name: normalizedDraft.scope_name.trim(),
      materials_amount: normalizedDraft.item_type === "material" ? lineTotal(normalizedDraft) : null,
      labor_amount: normalizedDraft.item_type === "labor" ? laborQuoteTotal(normalizedDraft) : null,
      updated_at: new Date().toISOString(),
    };
    const result = editingId === "new"
      ? await supabase.from("estimate_line_items").insert({ ...payload, estimate_id: estimateId, sort_order: lines.length })
      : await supabase.from("estimate_line_items").update(payload).eq("id", editingId!);
    setSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setEditingId(null);
    setDraft(null);
    if (normalizedDraft.item_type === "labor") {
      const { error: calculationError } = await supabase.rpc("apply_estimate_pricing_assumptions", { p_estimate_id: estimateId });
      if (calculationError) setAssumptionStatus("Labor saved. Select the county and save workbook assumptions once to enable automatic equipment and soft costs.");
      else setAssumptionStatus("Labor saved; Equipment / Minor Tools and soft costs refreshed automatically.");
    }
    await supabase.rpc("recalculate_esrp_rebate", { p_estimate_id: estimateId });
    await supabase.rpc("recompute_estimate_validation", { p_estimate_id: estimateId });
    await onSaved();
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-card p-5">
      <div className="mb-5 rounded-xl border border-white/10 bg-black/10 p-4">
        <div className="mb-5 rounded-xl border border-white/10 p-4 text-xs text-slate-300">
        <a href={taxReference?.sourceUrl ?? "https://www.ncdor.gov/taxes-forms/sales-and-use-tax/sales-and-use-tax-rates/current-sales-and-use-tax-rates"} target="_blank" rel="noreferrer" className="text-cyan-300 underline">NCDOR current county sales-tax reference</a>
        <button onClick={refreshTaxRates} className="ml-4 text-cyan-300 underline">Refresh rates</button>
        <p className="mt-2">{taxReference ? "Checked " + taxReference.checkedAt.slice(0,10) : taxError || "Checking current county rates..."}</p>
        <p className="mt-2">Saved rate: {assumptions.tax_rate == null ? "Not verified" : assumptions.tax_rate + "%"}. Save assumptions to record the current county rate. Apply tax only to the appropriate taxable costs.</p>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-medium text-white">Workbook pricing assumptions</h4><p className="mt-1 text-xs text-slate-400">Editable per estimate for a traceable county and markup basis.</p></div><button disabled={locked} onClick={saveAssumptions} className="rounded-lg border border-cyan-400/30 px-3 py-2 text-xs text-cyan-200 disabled:text-slate-600">Save assumptions</button></div>
        <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,170px),1fr))] items-stretch gap-x-4 gap-y-5">
          <label className="flex min-w-0 flex-col justify-between gap-1 text-xs leading-5 text-muted-foreground">NC county<select disabled={locked} className={`${inputClass} h-11 min-w-0`} value={assumptions.county??""} onChange={e=>setAssumptions(a=>({...a,county:e.target.value||null,tax_rate:null}))}><option value="">Select county</option>{assumptions.county&&!countyRates.some(r=>r.county===assumptions.county)&&<option value={assumptions.county}>{assumptions.county}</option>}{countyRates.map(r=><option key={r.county} value={r.county}>{r.county}</option>)}</select></label>
          <label className="flex min-w-0 flex-col justify-between gap-1 text-xs leading-5 text-muted-foreground">County sales tax %<input readOnly className={`${inputClass} h-11 min-w-0`} value={(locked ? assumptions.tax_rate : countyRule?.rate)??""} placeholder="Awaiting current rate"/></label>
          {([['overhead_percent','Overhead %'],['profit_percent','Profit %'],['contingency_percent','Contingency %'],['bonding_percent','Bonding %'],['mobilization_percent','Mobilization %'],['travel_percent','Travel %'],['material_split_percent','Material split %'],['labor_split_percent','Labor split %']] as const).map(([key,label])=><label key={key} className="flex min-w-0 flex-col justify-between gap-1 text-xs leading-5 text-muted-foreground">{label}<input disabled={locked} className={`${inputClass} h-11 min-w-0`} type="number" step="0.01" value={assumptions[key]??""} onChange={e=>setAssumptions(a=>({...a,[key]:n(e.target.value)??0}))}/></label>)}
        </div><div className="mt-3 text-xs text-slate-400">{assumptionStatus||"Saving calculates Equipment / Minor Tools at 10% of direct labor for each scope, then applies the saved soft-cost percentages. County tax uses the material/equipment subtotal. Permit fees remain manual."}</div>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Internal scope and costing editor</h3>
          <p className="mt-1 text-xs text-muted-foreground">Area-based attic, wall, and crawl-space lines calculate automatically from measured area, coverage or the labor rate per square foot. Fixed quantities and trade quotes remain available. AI labels indicate draft origin, not verified pricing.</p>
        </div>
        <div className="text-right"><div className="text-xs text-muted-foreground">Calculated internal total</div><div className="mt-1 text-lg font-semibold text-white">{currency(total)}</div></div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(["scope", "material", "labor", "fee"] as const).map((type) => (
          <button key={type} disabled={locked || editingId !== null} onClick={() => startAdd(type)} className="rounded-lg border border-white/10 px-3 py-2 text-xs capitalize text-slate-300 hover:border-cyan-400/30 hover:text-white disabled:cursor-not-allowed disabled:text-slate-600">+ {type}</button>
        ))}
        {locked && <span className="self-center text-xs text-amber-200">Create a revision to edit this approved version.</span>}
      </div>

      <div className="mt-4 rounded-xl border border-white/10 bg-black/10 p-4">
        <div><h4 className="text-sm font-semibold text-white">Permit and fees</h4><p className="mt-1 text-xs text-slate-400">Each scope starts at $0.00. The estimator enters the applicable county permit, inspection, or program fee after checking the current source.</p></div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {scopeLines.map((scope) => { const permitLine = permitLineFor(scope.id); return <div key={scope.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-2"><div className="min-w-0"><div className="truncate text-xs text-slate-300">{scope.scope_name}</div><div className="mt-1 font-semibold text-white">{currency(permitLine?.permit_amount ?? 0)}</div></div><button disabled={locked || editingId !== null} onClick={() => permitLine ? startEdit(permitLine) : startAdd("fee", "permit_fees", scope.id)} className="shrink-0 text-xs text-cyan-300 hover:underline disabled:text-slate-600">{permitLine ? "Edit permit" : "Add permit"}</button></div>; })}
          {!scopeLines.length && <p className="text-xs text-muted-foreground">Add and verify the estimate scopes before entering permits.</p>}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[1180px] text-left text-xs">
          <thead className="border-b border-white/10 text-muted-foreground"><tr><th className="px-2 py-3">Type / scope</th><th className="px-2 py-3">Area</th><th className="px-2 py-3">Material / model</th><th className="px-2 py-3">AHRI & source</th><th className="px-2 py-3">Qty / unit</th><th className="px-2 py-3">Subcontractor agreement</th><th className="px-2 py-3">Program hourly breakdown</th><th className="px-2 py-3 text-right">Total</th><th /></tr></thead>
          <tbody className="divide-y divide-white/8">
            {editableLines.map((line) => <tr key={line.id} className="align-top">
              <td className="px-2 py-3"><div className="font-medium text-white">{line.scope_name}</div><div className="mt-1 uppercase tracking-wide text-cyan-300">{line.item_type}{line.ai_generated ? " / AI" : ""}</div><div className="mt-2 max-w-64 text-[11px] text-slate-400">{line.internal_notes}</div>{line.item_type === "scope" && line.sero_scope_reference && <div className="mt-2 max-w-64 text-[11px] text-cyan-200">SERO: {line.sero_scope_reference}<div>{documents.find(d=>d.id===line.sero_scope_document_id)?.file_name}</div></div>}</td>
              <td className="px-2 py-3 text-slate-300">{line.area_location || "-"}{line.measured_area != null && <div className="mt-1 text-white">{line.measured_area} {line.area_unit || "sq ft"}</div>}</td>
              <td className="px-2 py-3"><div className="text-slate-200">{line.material_name || line.description || "-"}</div><div className="mt-1 text-muted-foreground">{[line.manufacturer, line.model_number].filter(Boolean).join(" / ")}</div></td>
              <td className="px-2 py-3"><div className="text-slate-300">{line.ahri_reference || "-"}</div><div className="mt-1 text-[11px] text-muted-foreground">{line.source_vendor || (line.item_type === "material" ? "Supplier not recorded" : "")}{line.source_checked_at ? ` - Checked ${line.source_checked_at.slice(0,10)}` : line.item_type === "material" ? " - Check date missing" : ""}</div><div className="mt-1 flex gap-2">{line.ahri_certificate_url && <a href={line.ahri_certificate_url} target="_blank" rel="noreferrer" className="text-cyan-300 hover:underline">AHRI</a>}{line.source_url && <a href={line.source_url} target="_blank" rel="noreferrer" className="text-cyan-300 hover:underline">Material source</a>}</div></td>
              <td className="px-2 py-3 text-slate-300">{line.calculated_quantity ?? line.quantity ?? "-"} {line.unit_of_measure ?? ""}<div className="mt-1 text-muted-foreground">{line.unit_cost != null ? currency(line.unit_cost) : ""}</div>{line.calculated_quantity != null && <div className="mt-1 text-cyan-200">Calculated from area</div>}</td>
              <td className="px-2 py-3 text-slate-300"><div>{line.subcontractor_name || "-"}</div>{line.labor_pricing_method && <div className="mt-1 text-muted-foreground">{line.labor_pricing_method}: {currency(line.labor_rate ?? 0)}{line.labor_pricing_method === "daily" ? ` x ${line.labor_days ?? 0} days` : line.labor_pricing_method === "hourly" ? ` x ${totalLaborHours(line)} crew-hrs` : ""}</div>}{line.item_type === "labor" && <div className="mt-1 font-medium text-white">Agreed {currency(laborQuoteTotal(line))}</div>}{line.subcontractor_quote_url && <a href={line.subcontractor_quote_url} target="_blank" rel="noreferrer" className="mt-1 block text-cyan-300 hover:underline">Quote source</a>}</td>
              <td className="px-2 py-3 text-slate-300">{line.item_type === "labor" ? <><div>{totalLaborHours(line)} crew-hrs x {currency(line.program_hourly_rate ?? 0)}</div><div className={`mt-1 ${Math.abs(laborDifference(line)) <= 0.01 ? "text-emerald-300" : "text-red-300"}`}>{Math.abs(laborDifference(line)) <= 0.01 ? "Reconciled" : `Difference ${currency(laborDifference(line))}`}</div></> : "-"}</td>
              <td className="px-2 py-3 text-right font-medium text-white">{currency(lineTotal(line))}</td>
              <td className="px-2 py-3 text-right"><button disabled={locked || editingId !== null} onClick={() => startEdit(line)} className="text-cyan-300 hover:underline disabled:text-slate-600">Edit</button></td>
            </tr>)}
            {!editableLines.length && <tr><td colSpan={9} className="px-2 py-8 text-center text-muted-foreground">No scope lines yet. AI-extracted candidates or human-entered lines will appear here.</td></tr>}
          </tbody>
        </table>
      </div>

      {draft && <div className="mt-5 rounded-xl border border-cyan-400/20 bg-cyan-400/[.04] p-4">
        <div className="flex items-center justify-between"><div className="font-medium capitalize text-white">{editingId === "new" ? "Add" : "Edit"} {draft.item_type}</div><button onClick={() => { setEditingId(null); setDraft(null); }} className="text-xs text-muted-foreground hover:text-white">Cancel</button></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {draft.item_type === "material" && <div className="rounded-lg border border-white/10 bg-black/15 p-3 text-xs text-slate-300 md:col-span-2 xl:col-span-4">Material entries stay under Materials. Equipment / Minor Tools is calculated automatically as 10% of direct labor when workbook assumptions are saved.</div>}
          {["fee","adjustment"].includes(draft.item_type) && <label className="text-xs text-muted-foreground">Markup / adjustment category<select className={inputClass} value={draft.cost_category ?? "unclassified"} onChange={e=>set("cost_category", e.target.value as CostCategory)}>{COST_CATEGORIES.filter(([key])=>!["materials","labor"].includes(key)).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>}
          {draft.item_type === "scope" && programTrack === "HEAR" && <>
            <label className="text-xs text-muted-foreground md:col-span-2">Primary HEAR scope source<select className={inputClass} value={draft.sero_scope_document_id ?? ""} onChange={e=>set("sero_scope_document_id",e.target.value || null)}><option value="">Select the audit, site visit, work-order/specification, or HVAC design source</option>{documents.filter(d=>["audit_report","site_visit","manual_j","manual_s","pricing_support","other"].includes(d.document_type)).map(d=><option key={d.id} value={d.id} disabled={d.extraction_status!=="extracted"}>{d.file_name}{d.extraction_status!=="extracted" ? " (awaiting extraction)" : ""}</option>)}</select></label>
            <label className="text-xs text-muted-foreground md:col-span-2">Source page / measure reference<input className={inputClass} value={draft.sero_scope_reference ?? ""} onChange={e=>set("sero_scope_reference",e.target.value || null)} placeholder="Audit measure, page, site-visit finding, work order, or technical-spec section"/></label>
            <p className="text-xs text-amber-200 md:col-span-2 xl:col-span-4">Use the audit recommendation as the program-scope basis, the completed site visit to confirm field conditions, and the work order, technical specifications, Manual J/Manual S, and product records for the exact materials, equipment, and pricing. Keep the supporting links in the internal evidence fields.</p>
          </>}
          {draft.item_type !== "scope" && <label className="text-xs text-muted-foreground">Quotation scope<select className={inputClass} value={draft.parent_line_item_id ?? ""} onChange={(e) => set("parent_line_item_id", e.target.value || null)}><option value="">Select scope</option>{lines.filter((line) => line.item_type === "scope" && !line.internal_notes?.startsWith("AI candidate only")).map((scope) => <option key={scope.id} value={scope.id}>{scope.scope_name}</option>)}</select></label>}
          <label className="text-xs text-muted-foreground">Scope / item name<input className={inputClass} value={draft.scope_name} onChange={(e) => set("scope_name", e.target.value)} /></label>
          <label className="text-xs text-muted-foreground">Area / location<input className={inputClass} value={draft.area_location ?? ""} onChange={(e) => set("area_location", e.target.value || null)} /></label>
          <label className="text-xs text-muted-foreground">Measured area<input className={inputClass} type="number" step="0.01" min="0" value={draft.measured_area ?? ""} onChange={(e) => set("measured_area", n(e.target.value))} /></label>
          <label className="text-xs text-muted-foreground">Area unit<input className={inputClass} value={draft.area_unit ?? "sq ft"} onChange={(e) => set("area_unit", e.target.value || null)} placeholder="sq ft" /></label>
          <label className="text-xs text-muted-foreground">Description<input className={inputClass} value={draft.description ?? ""} onChange={(e) => set("description", e.target.value || null)} /></label>
          <label className="text-xs text-muted-foreground">Rebate eligibility<select className={inputClass} value={draft.rebate_eligible == null ? "" : String(draft.rebate_eligible)} onChange={(e) => set("rebate_eligible", e.target.value === "" ? null : e.target.value === "true")}><option value="">Not determined</option><option value="true">Eligible</option><option value="false">Not eligible</option></select></label>
          {draft.item_type === "material" && <>
            <label className="text-xs text-muted-foreground">Material name<input className={inputClass} value={draft.material_name ?? ""} onChange={(e) => set("material_name", e.target.value || null)} /></label>
            <label className="text-xs text-muted-foreground">Manufacturer<input className={inputClass} value={draft.manufacturer ?? ""} onChange={(e) => set("manufacturer", e.target.value || null)} /></label>
            <label className="text-xs text-muted-foreground">Model number<input className={inputClass} value={draft.model_number ?? ""} onChange={(e) => set("model_number", e.target.value || null)} /></label>
            <label className="text-xs text-muted-foreground">ENERGY STAR<select className={inputClass} value={draft.energy_star_certified == null ? "" : String(draft.energy_star_certified)} onChange={(e) => set("energy_star_certified", e.target.value === "" ? null : e.target.value === "true")}><option value="">Christina review pending</option><option value="true">Christina confirmed certified</option><option value="false">Christina confirmed not certified</option></select></label>
            <div className="md:col-span-2 xl:col-span-4 flex flex-wrap items-center gap-3 rounded-lg border border-white/10 p-3"><button type="button" onClick={lookupEnergyStar} className="rounded-lg border border-cyan-400/30 px-3 py-2 text-xs text-cyan-200">Find official ENERGY STAR record</button><span className="text-xs text-slate-400">{energyStarStatus || "The system prefills official evidence; Christina makes the final confirmation."}</span>{draft.energy_star_source_url && <a href={draft.energy_star_source_url} target="_blank" rel="noreferrer" className="text-xs text-cyan-300 underline">Open official record</a>}</div>
            <label className="text-xs text-muted-foreground md:col-span-2">Capacity, units, SEER2 / HSPF2 / UEF, airflow, refrigerant, warranty<textarea className={inputClass} value={draft.technical_specifications ?? ""} onChange={(e) => set("technical_specifications", e.target.value || null)} /></label>
            <label className="text-xs text-muted-foreground md:col-span-2">Specification source file/page or manufacturer URL<textarea className={inputClass} value={draft.specification_source ?? ""} onChange={(e) => set("specification_source", e.target.value || null)} /></label>
            <label className="text-xs text-muted-foreground md:col-span-2">ENERGY STAR exact-model listing URL<textarea className={inputClass} value={draft.energy_star_source_url ?? ""} onChange={(e) => set("energy_star_source_url", e.target.value || null)} /></label>
            <label className="text-xs text-muted-foreground md:col-span-2">Program requirement, version and page / applicability<textarea className={inputClass} value={draft.compliance_reference ?? ""} onChange={(e) => set("compliance_reference", e.target.value || null)} /></label>
            <label className="text-xs text-muted-foreground">AHRI reference<input className={inputClass} value={draft.ahri_reference ?? ""} onChange={(e) => set("ahri_reference", e.target.value || null)} /></label>
            <label className="text-xs text-muted-foreground">AHRI certificate URL<input className={inputClass} type="url" value={draft.ahri_certificate_url ?? ""} onChange={(e) => set("ahri_certificate_url", e.target.value || null)} /></label>
            <label className="text-xs text-muted-foreground">Supplier / vendor<input className={inputClass} value={draft.source_vendor ?? ""} onChange={(e) => set("source_vendor", e.target.value || null)} /></label>
            <label className="text-xs text-muted-foreground">Material source URL<input className={inputClass} type="url" value={draft.source_url ?? ""} onChange={(e) => set("source_url", e.target.value || null)} /></label>
            <label className="text-xs text-muted-foreground">Price checked on<input className={inputClass} type="date" value={draft.source_checked_at ?? ""} onChange={(e) => set("source_checked_at", e.target.value || null)} /></label>
            <label className="text-xs text-muted-foreground">Quantity<input className={inputClass} type="number" step="0.001" value={draft.quantity ?? ""} onChange={(e) => set("quantity", n(e.target.value))} /></label>
            <label className="text-xs text-muted-foreground">Coverage per package<input className={inputClass} type="number" step="0.001" min="0" value={draft.coverage_per_unit ?? ""} onChange={(e) => set("coverage_per_unit", n(e.target.value))} placeholder="sq ft per bag/carton" /></label>
            <label className="text-xs text-muted-foreground">Area takeoff allowance %<input className={inputClass} type="number" step="0.01" min="0" value={draft.area_allowance_percent ?? ""} onChange={(e) => set("area_allowance_percent", n(e.target.value))} placeholder="10" /></label>
            <label className="text-xs text-muted-foreground">Unit<input className={inputClass} placeholder="each, sq ft, linear ft" value={draft.unit_of_measure ?? ""} onChange={(e) => set("unit_of_measure", e.target.value || null)} /></label>
            <label className="text-xs text-muted-foreground">Unit price<input className={inputClass} type="number" step="0.01" value={draft.unit_cost ?? ""} onChange={(e) => set("unit_cost", n(e.target.value))} /></label>
            <label className="text-xs text-muted-foreground">Fixed-quantity waste %<input disabled={(draft.measured_area ?? 0) > 0 && (draft.coverage_per_unit ?? 0) > 0} className={inputClass} type="number" step="0.01" value={draft.waste_factor_percent ?? ""} onChange={(e) => set("waste_factor_percent", n(e.target.value))} /></label>
          </>}
          {draft.item_type === "labor" && <>
            <label className="text-xs text-muted-foreground">Subcontractor<input className={inputClass} value={draft.subcontractor_name ?? ""} onChange={(e) => set("subcontractor_name", e.target.value || null)} /></label>
            <label className="text-xs text-muted-foreground">Subcontractor pricing basis<select className={inputClass} value={draft.labor_pricing_method ?? "daily"} onChange={(e) => set("labor_pricing_method", e.target.value as Draft["labor_pricing_method"])}><option value="area">Area x unit rate</option><option value="daily">Daily / crew</option><option value="hourly">Hourly</option><option value="fixed">Project-based fixed quote</option></select></label>
            <label className="text-xs text-muted-foreground">{draft.labor_pricing_method === "area" ? `Rate per ${draft.area_unit || "sq ft"}` : "Basis rate / fixed quote"}<input className={inputClass} type="number" step="0.0001" value={draft.labor_rate ?? ""} onChange={(e) => set("labor_rate", n(e.target.value))} /></label>
            <label className="text-xs text-muted-foreground">Agreed subcontractor total<input className={inputClass} type="number" step="0.01" value={draft.subcontractor_quote_amount ?? ""} onChange={(e) => set("subcontractor_quote_amount", n(e.target.value))} /></label>
            <label className="text-xs text-muted-foreground">Number of days<input className={inputClass} type="number" step="0.25" value={draft.labor_days ?? ""} onChange={(e) => set("labor_days", n(e.target.value))} /></label>
            <label className="text-xs text-muted-foreground">Hours per worker per day<input className={inputClass} type="number" step="0.25" value={draft.labor_hours_per_day ?? ""} onChange={(e) => set("labor_hours_per_day", n(e.target.value))} /></label>
            <label className="text-xs text-muted-foreground">Workers / crew size<input className={inputClass} type="number" step="1" value={draft.crew_size ?? ""} onChange={(e) => set("crew_size", n(e.target.value))} /></label>
            <label className="text-xs text-muted-foreground">Total compliance crew-hours<input className={inputClass} type="number" step="0.25" value={draft.labor_hours ?? ""} onChange={(e) => set("labor_hours", n(e.target.value))} /></label>
            <label className="text-xs text-muted-foreground">Program hourly rate<input className={inputClass} type="number" step="0.0001" value={draft.program_hourly_rate ?? ""} onChange={(e) => set("program_hourly_rate", n(e.target.value))} /></label>
            <label className="text-xs text-muted-foreground">Subcontractor quote / source URL<input className={inputClass} type="url" value={draft.subcontractor_quote_url ?? ""} onChange={(e) => set("subcontractor_quote_url", e.target.value || null)} /></label>
            <label className="text-xs text-muted-foreground md:col-span-2">Rate adjustment note<input className={inputClass} placeholder="Explain any manual allocation or adjustment" value={draft.labor_rate_override_reason ?? ""} onChange={(e) => set("labor_rate_override_reason", e.target.value || null)} /></label>
            <div className="rounded-lg border border-white/10 bg-black/15 p-3 text-xs text-slate-300 md:col-span-2 xl:col-span-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><span>Program total: <strong className="text-white">{currency(programLaborTotal(draft))}</strong> / agreed total: <strong className="text-white">{currency(laborQuoteTotal(draft))}</strong></span><button type="button" disabled={totalLaborHours(draft) <= 0 || laborQuoteTotal(draft) <= 0} onClick={() => set("program_hourly_rate", laborQuoteTotal(draft) / totalLaborHours(draft))} className="rounded-md border border-cyan-400/30 px-2.5 py-1.5 text-cyan-200 disabled:border-white/10 disabled:text-slate-600">Use reconciled hourly rate</button></div>
              <div className={`mt-2 ${Math.abs(laborDifference(draft)) <= 0.01 && laborQuoteTotal(draft) > 0 ? "text-emerald-300" : "text-amber-200"}`}>{Math.abs(laborDifference(draft)) <= 0.01 && laborQuoteTotal(draft) > 0 ? "Reconciled — the hourly compliance view represents the same labor cost and will not be added twice." : `Difference: ${currency(laborDifference(draft))}. Reconcile before saving.`}</div>
            </div>
          </>}
          {draft.item_type === "fee" && <>
            <label className="text-xs text-muted-foreground">Permit amount<input className={inputClass} type="number" step="0.01" value={draft.permit_amount ?? ""} onChange={(e) => set("permit_amount", n(e.target.value))} /></label>
            <label className="text-xs text-muted-foreground">Tax amount<input className={inputClass} type="number" step="0.01" value={draft.tax_amount ?? ""} onChange={(e) => set("tax_amount", n(e.target.value))} /></label>
            <label className="text-xs text-muted-foreground">Markup amount<input className={inputClass} type="number" step="0.01" value={draft.markup_amount ?? ""} onChange={(e) => set("markup_amount", n(e.target.value))} /></label>
          </>}
          <label className="text-xs text-muted-foreground md:col-span-2">Internal notes<textarea className={inputClass} rows={2} value={draft.internal_notes ?? ""} onChange={(e) => set("internal_notes", e.target.value || null)} /></label>
        </div>
        {error && <div className="mt-3 text-xs text-red-300">{error}</div>}
        <div className="mt-4 flex items-center justify-between"><div className="text-sm text-slate-300">Calculated line total: <strong className="text-white">{currency(lineTotal(draft))}</strong></div><button disabled={saving} onClick={save} className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:bg-slate-700">{saving ? "Saving..." : "Save line"}</button></div>
      </div>}
    </section>
  );
}
