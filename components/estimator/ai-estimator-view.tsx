"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";

const CONTROLLED_TEST_EMAILS = new Set(["chrismedrano.pro@gmail.com"]);
const ARCHIVED_STATUSES = new Set(["approved", "sent_for_signature", "signed"]);
import { supabase } from "@/lib/supabase";
import { type EstimateLineItem } from "@/components/estimator/estimate-cost-editor";
import { EstimatePackageView } from "@/components/estimator/estimate-package-view";

type DocType = "audit_report" | "site_visit" | "manual_j" | "manual_s";

interface SourceDocument {
  id: string;
  document_type: DocType | "pricing_support" | "other";
  file_name: string;
  box_path: string;
  box_file_id: string | null;
  extraction_status: string;
  received_at: string;
}

interface ApprovalStep {
  id: string;
  sequence_number: number;
  reviewer_key: "christina" | "devon" | "renee" | "marcus" | "jordan";
  reviewer_label: string;
  reviewer_staff_id: string | null;
  status: string;
  decided_at: string | null;
  note: string | null;
}

interface ProgramReturn {
  id: string;
  estimate_id: string | null;
  returned_reason: string | null;
  affected_items: unknown;
  status: string;
  returned_at: string;
  resubmission_due_at: string | null;
}

interface WorkItem {
  id: string;
  project_id: string | null;
  project_application_id: string | null;
  program_track: "HOMES" | "HEAR" | null;
  box_project_folder_name: string;
  readiness_status: string;
  hvac_in_scope: boolean | null;
  manual_j_required: boolean;
  manual_s_required: boolean;
  missing_inputs: string[];
  readiness_notes: string | null;
  latest_estimate_id: string | null;
  updated_at: string;
  projects: { homeowner_name: string; phone:string|null; email:string|null; address_line1: string | null; address_line2: string | null } | null;
  estimate_source_documents: SourceDocument[];
  project_applications: { estimate_program_returns: ProgramReturn[] } | null;
  estimates: {
    id: string;
    estimate_number: string;
    program_track: "HOMES" | "HEAR";
    version: number;
    status: string;
    delivery_status: string;
    box_sign_request_id: string | null;
    box_sign_status: string | null;
    is_test: boolean;
    test_operator_staff_id: string | null;
    test_recipient_email: string | null;
    total_project_cost: number | null;
    rebate_amount: number | null;
    homeowner_out_of_pocket: number | null;
    ai_confidence: number | null;
    ai_gap_flags: unknown;
    validation_checks: unknown;
    ai_gap_resolution: string | null;
    estimate_line_items: EstimateLineItem[];
    estimate_approval_steps: ApprovalStep[];
  } | null;
}

const DOC_LABELS: Record<DocType, string> = {
  audit_report: "Energy audit report",
  site_visit: "Submitted site visit",
  manual_j: "Manual J load calculation",
  manual_s: "Manual S equipment selection",
};

const STATUS_LABELS: Record<string, string> = {
  collecting_inputs: "Collecting inputs",
  awaiting_site_visit: "Awaiting site visit",
  awaiting_manual_js: "Awaiting Manual J/S",
  ready_for_draft: "Ready for AI draft",
  drafting: "AI drafting",
  draft_ready: "Draft ready",
  in_review: "In review",
  approved: "Final approved",
  sent_for_signature: "Sent for signature",
  signed: "Signed",
  blocked: "Needs attention",
};

const REVIEW_PERSPECTIVES: Record<ApprovalStep["reviewer_key"], string> = {
  christina: "Scope, source documents, quantities, and missing facts",
  devon: "Customer details, scheduling, and file completeness",
  renee: "Program eligibility, audit alignment, and rebate evidence",
  marcus: "Pricing, labor, margin, and constructability",
  jordan: "Final compliance and authorization to release",
};

function money(value: number | null | undefined) {
  if (value == null) return "-";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function pill(status: string) {
  if (["approved", "signed"].includes(status)) return "border-emerald-400/25 bg-emerald-400/10 text-emerald-300";
  if (["ready_for_draft", "draft_ready"].includes(status)) return "border-cyan-400/25 bg-cyan-400/10 text-cyan-300";
  if (["blocked", "rejected"].includes(status)) return "border-red-400/25 bg-red-400/10 text-red-300";
  return "border-amber-400/25 bg-amber-400/10 text-amber-200";
}

export function AiEstimatorView() {
  const { user } = useAuth();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [queueView, setQueueView] = useState<"active" | "archive">("active");
  const [queueSearch, setQueueSearch] = useState("");
  const [revisionReason, setRevisionReason] = useState("");

  async function load() {
    setError(null);
    const { data, error: loadError } = await supabase
      .from("estimate_work_items")
      .select("id, project_id, project_application_id, program_track, box_project_folder_name, readiness_status, hvac_in_scope, manual_j_required, manual_s_required, missing_inputs, readiness_notes, latest_estimate_id, updated_at, projects(homeowner_name,phone,email,address_line1,address_line2), project_applications!estimate_work_items_project_application_id_fkey(estimate_program_returns(id,estimate_id,returned_reason,affected_items,status,returned_at,resubmission_due_at)), estimate_source_documents(id,document_type,file_name,box_path,box_file_id,extraction_status,received_at), estimates!estimate_work_items_latest_estimate_id_fkey(id,estimate_number,version,program_track,status,delivery_status,box_sign_request_id,box_sign_status,is_test,test_operator_staff_id,test_recipient_email,total_project_cost,rebate_amount,homeowner_out_of_pocket,ai_confidence,ai_gap_flags,validation_checks,ai_gap_resolution,estimate_line_items(id,estimate_id,parent_line_item_id,cost_category,sero_scope_document_id,sero_scope_reference,item_type,scope_name,description,area_location,measured_area,area_unit,coverage_per_unit,calculated_quantity,area_allowance_percent,material_name,manufacturer,model_number,technical_specifications,energy_star_source_url,specification_source,compliance_reference,energy_star_certified,ahri_reference,ahri_certificate_url,source_vendor,source_url,source_checked_at,quantity,unit_of_measure,unit_cost,waste_factor_percent,subcontractor_name,labor_pricing_method,labor_rate,labor_days,labor_hours,labor_hours_per_day,crew_size,subcontractor_quote_amount,program_hourly_rate,subcontractor_quote_url,labor_rate_override_reason,permit_amount,tax_amount,markup_amount,rebate_eligible,internal_notes,ai_generated,ai_confidence,sort_order),estimate_approval_steps(id,sequence_number,reviewer_key,reviewer_label,reviewer_staff_id,status,decided_at,note))")
      .order("updated_at", { ascending: false });

    if (loadError) setError(loadError.message);
    else {
      const rows = (data ?? []) as unknown as WorkItem[];
      setItems(rows);
      setSelectedId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? "");
    }
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const archivedItems = useMemo(() => items.filter((item) => ARCHIVED_STATUSES.has(item.readiness_status) || Boolean(item.estimates && ARCHIVED_STATUSES.has(item.estimates.status))), [items]);
  const activeItems = useMemo(() => items.filter((item) => !archivedItems.some((archived) => archived.id === item.id)), [items, archivedItems]);
  const visibleItems = useMemo(() => {
    const query = queueSearch.trim().toLowerCase();
    const source = queueView === "archive" ? archivedItems : activeItems;
    if (!query) return source;
    return source.filter((item) => [item.projects?.homeowner_name, item.projects?.address_line1, item.projects?.address_line2, item.box_project_folder_name, item.program_track, item.estimates?.estimate_number]
      .filter(Boolean).join(" ").toLowerCase().includes(query));
  }, [activeItems, archivedItems, queueSearch, queueView]);
  const selected = visibleItems.find((item) => item.id === selectedId) ?? visibleItems[0] ?? null;
  const matchingEstimate = selected?.estimates && selected.estimates.program_track === selected.program_track ? selected.estimates : null;
  const selectedDocuments = useMemo(() => {
    if (!selected) return [];
    const sharedTypes = new Set<SourceDocument["document_type"]>(["site_visit", "manual_j", "manual_s"]);
    const own = selected.estimate_source_documents;
    const shared = items
      .filter((item) => item.project_id && item.project_id === selected.project_id)
      .flatMap((item) => item.estimate_source_documents)
      .filter((document) => sharedTypes.has(document.document_type));
    return [...own, ...shared].filter((document, index, documents) =>
      documents.findIndex((candidate) => candidate.id === document.id) === index
    );
  }, [items, selected]);
  const stats = useMemo(() => ({
    waiting: items.filter((i) => ["collecting_inputs", "awaiting_site_visit", "awaiting_manual_js"].includes(i.readiness_status)).length,
    ready: items.filter((i) => ["ready_for_draft", "draft_ready"].includes(i.readiness_status)).length,
    review: items.filter((i) => i.readiness_status === "in_review").length,
    complete: items.filter((i) => ["approved", "sent_for_signature", "signed"].includes(i.readiness_status)).length,
  }), [items]);

  const approvals = [...(selected?.estimates?.estimate_approval_steps ?? [])].sort((a, b) => a.sequence_number - b.sequence_number);
  const estimateLines = [...(selected?.estimates?.estimate_line_items ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .filter((line) => line.scope_name !== "Source-package note (not priced)");
  const pendingApprovals = approvals.filter((step) => step.status === "pending" && ["christina", "jordan"].includes(step.reviewer_key));
  const assignedApproval = pendingApprovals.find((step) => step.reviewer_staff_id === user?.id) ?? null;
  const actionableApproval = assignedApproval;
  const openReturns = (selected?.project_applications?.estimate_program_returns ?? []).filter((item) => item.status !== "resolved");

  async function approveReview(step: ApprovalStep | null = actionableApproval) {
    if (!selected?.estimates || !step || !user || !["christina", "jordan"].includes(step.reviewer_key)) return;
    const canActAsAssigned = step.reviewer_staff_id === user.id;
    const canActAsTestOperator = selected.estimates.is_test && selected.estimates.test_operator_staff_id === user.id;
    if (!canActAsAssigned && !canActAsTestOperator) return;
    setSaving(true);
    setError(null);
    const now = new Date().toISOString();
    const { error: approvalError } = await supabase
      .from("estimate_approval_steps")
      .update({ status: "approved", decided_by_staff_id: user.id, decided_at: now })
      .eq("id", step.id)
      .eq("status", "pending");

    if (approvalError) {
      setError(approvalError.message);
      setSaving(false);
      return;
    }

    // Database triggers open the shared review after Christina, then apply Jordan's
    // final approval (or Marcus's fallback approval) atomically.
    await load();
    setSaving(false);
  }

  const [fallbackReason, setFallbackReason] = useState("");
  const fallbackStep = approvals.find(step => step.reviewer_key === "marcus");
  const canFallback = selected?.estimates?.status === "pending_review" && approvals.some(step => step.reviewer_key === "christina" && step.status === "approved") && (fallbackStep?.reviewer_staff_id === user?.id || (selected.estimates.is_test && selected.estimates.test_operator_staff_id === user?.id));
  async function approveFallback() {
    if (!selected?.estimates || !canFallback || !fallbackReason.trim()) return;
    setSaving(true); setError(null);
    const { error: fallbackError } = await supabase.rpc("activate_marcus_final_fallback", { p_estimate_id: selected.estimates.id, p_reason: fallbackReason.trim() });
    if (fallbackError) setError(fallbackError.message);
    else { setFallbackReason(""); await load(); }
    setSaving(false);
  }

  // Jordan's approval means Cascadia is internally ready; it does not mean the
  // homeowner has agreed to the numbers. A review email (PDF attached) drafts
  // automatically on approval -- staff sends it, the homeowner replies, and only
  // once staff has actually seen that "yes, proceed" does this button exist to
  // move the estimate to sent_for_signature, which is what queues Box Sign.
  async function markReadyForESign() {
    if (!selected?.estimates || selected.estimates.status !== "approved") return;
    setSaving(true);
    setError(null);
    const { error: readyError } = await supabase
      .from("estimates")
      .update({ status: "sent_for_signature" })
      .eq("id", selected.estimates.id)
      .eq("status", "approved");
    if (readyError) setError(readyError.message);
    await load();
    setSaving(false);
  }

  async function submitForReview() {
    if (!selected?.estimates) return;
    setSaving(true);
    setError(null);
    const { error: reviewError } = await supabase.rpc("promote_estimate_to_review", {
      p_estimate_id: selected.estimates.id,
    });
    if (reviewError) setError(reviewError.message);
    await load();
    setSaving(false);
  }

  async function enableReviewSimulation() {
    if (!selected?.estimates || !user?.email) return;
    setSaving(true);
    setError(null);
    const { error: simulationError } = await supabase.rpc("enable_estimate_review_simulation", {
      p_estimate_id: selected.estimates.id,
      p_test_recipient_email: user.email,
    });
    if (simulationError) setError(simulationError.message);
    else {
      const { error: reviewError } = await supabase.rpc("promote_estimate_to_review", {
        p_estimate_id: selected.estimates.id,
      });
      if (reviewError) setError(reviewError.message);
    }
    await load();
    setSaving(false);
  }

  async function startCorrectionRevision(programReturn: ProgramReturn) {
    setSaving(true);
    setError(null);
    const { error: revisionError } = await supabase.rpc("start_estimate_return_revision", {
      p_return_id: programReturn.id,
    });
    if (revisionError) setError(revisionError.message);
    await load();
    setSaving(false);
  }

  async function createRevision() {
    if (!selected?.estimates || !ARCHIVED_STATUSES.has(selected.estimates.status) || !revisionReason.trim()) return;
    setSaving(true);
    setError(null);
    const { error: revisionError } = await supabase.rpc("create_estimate_revision", {
      p_estimate_id: selected.estimates.id,
      p_reason: revisionReason.trim(),
    });
    if (revisionError) setError(revisionError.message);
    else {
      setRevisionReason("");
      setQueueSearch("");
      setQueueView("active");
    }
    await load();
    setSaving(false);
  }

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading estimating workspace...</div>;

  return (
    <div className="space-y-5 p-5 lg:p-7">
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,.13),transparent_38%),linear-gradient(135deg,rgba(15,23,42,.96),rgba(6,14,28,.98))] p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-[.2em] text-cyan-300">GHEP operations</div>
            <h1 className="text-2xl font-semibold text-white">AI Estimating Control Center</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Review the energy audit report in Tech Specs to identify potential HOMES and HEAR scopes. Confirm the work against the completed site visit, then use Manual J load calculations and Manual S equipment selection when HVAC applies. Record supported capacities, models, quantities, and units in each program estimate before review.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-emerald-300">Box source documents available</span>
            <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-amber-200">Upload approved estimates to Box</span>
            <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-amber-200">Upload Manual J and S after the site visit</span>
            <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-amber-200">Staff review required before sending</span>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-card p-4 text-sm text-slate-300">
        <h2 className="font-semibold text-white">How to use AI Estimator</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Select the homeowner and HOMES or HEAR case in the estimating queue.</li>
          <li>Check Input readiness and open Source evidence to review the audit, site visit, and Manual J/S.</li>
          <li>Use Internal costing to add or edit scopes, materials, quantities, units, and costs.</li>
          <li>Christina opens the draft directly, checks the scope and costing, and resolves Validation items. When the package is ready, select Start approval review.</li>
        </ol>
        <p className="mt-3 text-xs text-amber-200">HEAR PDFs use the HEAR estimate’s scopes and costs. A HOMES quotation is not a source for HEAR scope.</p>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Awaiting inputs", stats.waiting], ["Ready / drafted", stats.ready], ["In review", stats.review], ["Approved / sent", stats.complete]].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-white/10 bg-card p-4"><div className="text-2xl font-semibold text-white">{value}</div><div className="mt-1 text-xs text-muted-foreground">{label}</div></div>
        ))}
      </section>

      {error && <div className="rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</div>}

      {items.length === 0 ? (
        <section className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
          <div className="rounded-2xl border border-dashed border-white/15 bg-card/60 p-8">
            <div className="text-lg font-medium text-white">Waiting for the first estimating case</div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">A relevant PDF arriving in a Fieldwire project&apos;s Box folders will create the case. Audit reports may arrive first. The submitted site visit starts the readiness check, and HVAC scopes wait normally for Manual J and Manual S.</p>
            <div className="mt-6 text-xs font-semibold uppercase tracking-wider text-cyan-300">Editor blueprint</div>
            <div className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-2 lg:grid-cols-3">
              {[
                "Scope and work area", "Material, manufacturer and model", "Quantity, unit and unit price",
                "ENERGY STAR and AHRI evidence", "Supplier and clickable source link", "Subcontractor daily/hourly/project basis",
                "Editable days, workers and hours", "Reconciled program hourly labor", "Permit, tax, markup and rebate eligibility",
              ].map((field) => <div key={field} className="rounded-lg border border-white/10 bg-black/10 px-3 py-2">{field}</div>)}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-card p-5">
            <div className="text-sm font-semibold text-white">Files the workflow watches</div>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <div>Ready: Project Forms / submitted site visit PDF</div><div>Ready: Files / audit report</div><div>Ready: Files/Estimating Inputs / Manual J/S</div><div className="text-slate-500">Ignored: Photos, Plans and As-builts</div>
            </div>
          </div>
        </section>
      ) : (
        <section className="grid min-h-[560px] min-w-0 gap-4 xl:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
          <div className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-card">
            <div className="space-y-3 border-b border-white/10 p-4">
              <div className="flex items-center justify-between gap-2"><div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Estimates</div><div className="flex rounded-lg border border-white/10 p-1 text-xs"><button onClick={() => { setQueueView("active"); setSelectedId(""); }} className={`rounded px-2.5 py-1.5 ${queueView === "active" ? "bg-cyan-400 text-slate-950" : "text-slate-300"}`}>Active {activeItems.length}</button><button onClick={() => { setQueueView("archive"); setSelectedId(""); }} className={`rounded px-2.5 py-1.5 ${queueView === "archive" ? "bg-cyan-400 text-slate-950" : "text-slate-300"}`}>Archive {archivedItems.length}</button></div></div>
              <input value={queueSearch} onChange={(event) => { setQueueSearch(event.target.value); setSelectedId(""); }} placeholder={queueView === "archive" ? "Search archived estimates…" : "Search active estimates…"} aria-label="Search estimates" className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-slate-500"/>
            </div>
            <div className="divide-y divide-white/10">
              {visibleItems.map((item) => (
                <button key={item.id} onClick={() => setSelectedId(item.id)} className={`w-full px-4 py-4 text-left transition ${selected?.id === item.id ? "bg-cyan-400/8" : "hover:bg-white/[.03]"}`}>
                  <div className="flex items-start justify-between gap-3"><div className="font-medium text-white">{item.projects?.homeowner_name ?? item.box_project_folder_name}</div><span className="text-[10px] font-semibold text-cyan-300">{item.program_track ?? "UNMATCHED"}</span></div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{item.projects ? [item.projects.address_line1, item.projects.address_line2].filter(Boolean).join(", ") : "Needs project match"}</div>
                  <span className={`mt-3 inline-flex rounded-full border px-2 py-1 text-[10px] font-medium ${pill(item.readiness_status)}`}>{STATUS_LABELS[item.readiness_status] ?? item.readiness_status}</span>
                </button>
              ))}
              {visibleItems.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted-foreground">{queueSearch.trim() ? "No estimates match this search." : queueView === "archive" ? "No approved or sent estimates yet." : "No active estimates."}</div>}
            </div>
          </div>

          {selected && <div className="min-w-0 space-y-4">
            {openReturns.map((programReturn) => <div key={programReturn.id} className="rounded-2xl border border-red-400/30 bg-red-400/10 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-xs font-semibold uppercase tracking-wider text-red-300">Application Submission / Returned</div><div className="mt-1 text-sm text-white">{programReturn.returned_reason || "Program correction details need review."}</div></div><div className="flex items-center gap-2"><span className="rounded-full border border-red-400/30 px-3 py-1 text-xs text-red-200">{programReturn.status.replaceAll("_", " ")}</span>{programReturn.status === "open" && <button disabled={saving || !programReturn.estimate_id} onClick={() => startCorrectionRevision(programReturn)} className="rounded-lg bg-red-300 px-3 py-1.5 text-xs font-semibold text-red-950 disabled:bg-slate-700 disabled:text-slate-400">Start correction revision</button>}</div></div><div className="mt-2 text-xs text-red-200/70">Original signed version stays locked. Corrections create a new estimate version and repeat approvals.</div></div>)}
            <div className="rounded-2xl border border-white/10 bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold text-white">{selected.projects?.homeowner_name ?? selected.box_project_folder_name}</h2><p className="mt-1 text-sm text-muted-foreground">{selected.box_project_folder_name} / {selected.program_track ?? "Project match required"}</p></div><span className={`rounded-full border px-3 py-1.5 text-xs ${pill(selected.readiness_status)}`}>{STATUS_LABELS[selected.readiness_status] ?? selected.readiness_status}</span></div>
              {queueView === "archive" && selected.estimates && <div className="mt-4 rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4"><div className="text-sm font-semibold text-white">Archived estimate</div><p className="mt-1 text-xs leading-5 text-slate-400">This approved or sent version is locked. Enter a reason to create a new editable version in the Active queue; the archived version remains unchanged.</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input value={revisionReason} onChange={(event) => setRevisionReason(event.target.value)} placeholder="Reason for revision" aria-label="Reason for estimate revision" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"/><button onClick={() => void createRevision()} disabled={saving || !revisionReason.trim()} className="rounded-lg border border-cyan-400/30 px-3 py-2 text-sm font-semibold text-cyan-200 disabled:opacity-40">Create editable revision</button></div></div>}
            </div>

            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              <div className="min-w-0 rounded-2xl border border-white/10 bg-card p-5">
                <h3 className="text-sm font-semibold text-white">Input readiness</h3>
                <div className="mt-4 space-y-3">
                  {(Object.keys(DOC_LABELS) as DocType[]).map((type) => {
                    const doc = selectedDocuments.find((d) => d.document_type === type);
                    const required = type === "audit_report" || type === "site_visit" || (type === "manual_j" && selected.manual_j_required) || (type === "manual_s" && selected.manual_s_required);
                    const ready = Boolean(doc);
                    return <div key={type} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/10 px-3 py-3"><div className="min-w-0"><div className="text-sm text-slate-200">{DOC_LABELS[type]}</div><div className="mt-0.5 break-words text-[11px] text-muted-foreground">{doc?.file_name ?? (required ? "Required" : "Not required for current scope")}</div></div><div className={`shrink-0 ${ready ? "text-emerald-300" : required ? "text-amber-300" : "text-slate-600"}`}>{ready ? "Ready" : required ? "Waiting" : "-"}</div></div>;
                  })}
                </div>
                {selected.readiness_notes && <p className="mt-4 text-xs leading-5 text-muted-foreground">{selected.readiness_notes}</p>}
              </div>

              <div className="min-w-0 rounded-2xl border border-white/10 bg-card p-5">
                <h3 className="text-sm font-semibold text-white">Latest AI draft</h3>
                {selected.estimates ? <><div className="mt-4 grid grid-cols-3 gap-2"><div><div className="text-xs text-muted-foreground">Project cost</div><div className="mt-1 font-semibold text-white">{money(selected.estimates.total_project_cost)}</div></div><div><div className="text-xs text-muted-foreground">Rebate</div><div className="mt-1 font-semibold text-white">{money(selected.estimates.rebate_amount)}</div></div><div><div className="text-xs text-muted-foreground">Homeowner</div><div className="mt-1 font-semibold text-white">{money(selected.estimates.homeowner_out_of_pocket)}</div></div></div><div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4 text-sm"><span className="text-muted-foreground">{selected.estimates.estimate_number} / v{selected.estimates.version}</span><span className="text-cyan-300">AI confidence {selected.estimates.ai_confidence ?? "-"}%</span></div></> : <p className="mt-4 text-sm leading-6 text-muted-foreground">The draft will appear only after all required inputs are extracted. Missing documents are a waiting state, not an error.</p>}
              </div>
            </div>

            {selected.estimates && !matchingEstimate && <div role="alert" className="rounded-xl border border-red-400/25 p-4 text-sm text-red-200">This estimate does not match the selected program. Correct the case association before previewing or downloading a quotation.</div>}
            {matchingEstimate && <EstimatePackageView key={matchingEstimate.id} estimate={matchingEstimate} lines={estimateLines} documents={selectedDocuments} homeowner={selected.projects?.homeowner_name??selected.box_project_folder_name} address={[selected.projects?.address_line1,selected.projects?.address_line2].filter(Boolean).join(', ')} phone={selected.projects?.phone} email={selected.projects?.email} onSaved={load} />}

            <div className="rounded-2xl border border-white/10 bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-white">Human review and final release gate</h3><p className="mt-1 text-xs text-muted-foreground">Christina can view and edit the draft as soon as it appears here; no submission is needed for access. Start approval review when the package is ready. Christina completes the first approval. Renee and Devon retain visibility without approval duties. Jordan gives final approval; Marcus may act as final fallback when she is unavailable.</p></div><span className="text-xs text-muted-foreground">No automatic homeowner send</span></div>
              {selected.estimates?.is_test && <div className="mt-4 rounded-xl border border-violet-400/30 bg-violet-400/10 px-4 py-3 text-sm text-violet-100"><strong>Controlled test mode:</strong> {user?.full_name} may simulate each named reviewer. Every decision records the actual operator. Delivery is restricted to <strong>{selected.estimates.test_recipient_email}</strong>.</div>}
              {approvals.length ? <div className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-5">{approvals.map((step) => { const canSimulateStep = ["christina", "jordan"].includes(step.reviewer_key) && step.status === "pending" && Boolean(selected.estimates?.is_test && selected.estimates.test_operator_staff_id === user?.id); return <div key={step.id} className={`min-w-0 rounded-xl border p-4 ${step.status === "pending" ? "border-cyan-400/35 bg-cyan-400/8" : "border-white/10 bg-black/10"}`}><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{step.sequence_number === 1 ? "Initial review" : "Concurrent review"}</div><div className="mt-2 break-words font-medium text-white">{step.reviewer_label}</div><div className="mt-2 text-[11px] leading-4 text-slate-400">{REVIEW_PERSPECTIVES[step.reviewer_key]}</div><div className={`mt-3 text-xs ${step.status === "approved" ? "text-emerald-300" : step.status === "pending" ? "text-cyan-300" : "text-slate-500"}`}>{["devon", "renee"].includes(step.reviewer_key) ? "View access - no approval required" : step.reviewer_key === "marcus" ? "Final fallback only" : step.status.replace("_", " ")}</div>{step.note && <div className="mt-2 break-words text-[10px] leading-4 text-violet-200/80">{step.note}</div>}{canSimulateStep && <button onClick={() => void approveReview(step)} disabled={saving} className="mt-3 rounded-lg border border-violet-400/30 px-2.5 py-1.5 text-[11px] font-semibold text-violet-200 disabled:text-slate-600">View and simulate {step.reviewer_key}</button>}</div>; })}</div> : <p className="mt-4 text-sm text-muted-foreground">The draft is already available to Christina. Formal approval assignments are created when approval review starts.</p>}
              {selected.estimates?.status === "approved" && <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/10 p-4"><div className="text-sm font-semibold text-white">Homeowner review, then e-sign</div><p className="mt-1 text-xs leading-5 text-amber-100/80">Cascadia approved this internally -- the homeowner has not agreed to it yet. A review email with the estimate PDF attached has been drafted automatically in the office@ Outlook Drafts folder; open it, send it, and wait for the homeowner to say yes before continuing. Box Sign is not queued until you select Ready for e-sign below.</p><button onClick={() => void markReadyForESign()} disabled={saving} className="mt-3 rounded-lg bg-amber-300 px-4 py-2 text-sm font-semibold text-amber-950 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">{saving ? "Saving..." : "Ready for e-sign"}</button></div>}
              {selected.estimates && ["box_sign_queued", "box_sign_sent", "sent", "viewed", "signed", "ready_for_portal_upload", "uploaded_to_portal"].includes(selected.estimates.delivery_status) && <div className="mt-4 grid gap-2 md:grid-cols-3"><div className={`rounded-lg border p-3 text-xs ${selected.estimates.box_sign_request_id ? "border-emerald-400/25 text-emerald-200" : "border-amber-400/20 text-amber-200"}`}>1. Box Sign request: {selected.estimates.box_sign_request_id ? "created" : selected.estimates.delivery_status === "box_sign_queued" ? "queued automatically" : "waiting"}</div><div className="rounded-lg border border-white/10 p-3 text-xs text-slate-300">2. Signer status: {selected.estimates.box_sign_status ?? "waiting"}</div><div className="rounded-lg border border-white/10 p-3 text-xs text-slate-300">3. Signed PDF returns to Box for portal upload</div></div>}
              {canFallback && <div className="mt-4 flex flex-wrap gap-3"><input aria-label="Reason Jordan is unavailable" placeholder="Reason Jordan is unavailable" value={fallbackReason} onChange={e => setFallbackReason(e.target.value)} className="min-w-64 rounded-lg border border-white/10 p-2 text-sm"/><button disabled={saving || !fallbackReason.trim()} onClick={approveFallback} className="rounded-lg border border-amber-400/30 px-3 py-2 text-sm text-amber-200 disabled:opacity-40">Give final approval as Marcus fallback</button></div>}
              <div className="mt-5 flex flex-wrap justify-end gap-2">{selected.readiness_status === "ready_for_draft" && !selected.estimates && <span className="text-sm text-cyan-200">Preparing estimate package automatically…</span>}{selected.estimates?.status === "ai_draft" && !selected.estimates.is_test && CONTROLLED_TEST_EMAILS.has(user?.email?.toLowerCase() ?? "") && <button onClick={enableReviewSimulation} disabled={saving || !user?.email} className="rounded-lg border border-violet-400/30 px-4 py-2 text-sm font-semibold text-violet-200 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-slate-600">Start controlled reviewer simulation</button>}{selected.estimates?.status === "ai_draft" && selected.estimates.is_test && <button onClick={submitForReview} disabled={saving || (selected.estimates.ai_confidence??0)<95} title={(selected.estimates.ai_confidence??0)<95?'Resolve validation items before review':''} className="rounded-lg border border-violet-400/30 px-4 py-2 text-sm font-semibold text-violet-200 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-slate-600">Start reviewer simulation</button>}{selected.estimates?.status === "ai_draft" && !selected.estimates.is_test && <button onClick={submitForReview} disabled={saving || (selected.estimates.ai_confidence??0)<95} title={(selected.estimates.ai_confidence??0)<95?'Resolve validation items before review':''} className="rounded-lg border border-cyan-400/30 px-4 py-2 text-sm font-semibold text-cyan-200 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-slate-600">Start approval review</button>}{assignedApproval && <button onClick={() => void approveReview(assignedApproval)} disabled={saving} className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:bg-slate-700">{saving ? "Saving..." : assignedApproval.reviewer_label.includes("final") ? "Give final approval" : `Complete ${user?.first_name}'s review`}</button>}{!assignedApproval && !selected.estimates?.is_test && <button disabled className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-400">{pendingApprovals.length ? "Review in progress" : "No review pending"}</button>}</div>
            </div>
          </div>}
        </section>
      )}
    </div>
  );
}
