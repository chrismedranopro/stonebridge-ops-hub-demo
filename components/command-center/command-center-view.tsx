"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { ComplianceDocStatus, ComplianceDocType, PipelineStage } from "@/lib/types";
import { deriveGroupOrder, formatGroupLabel, formatStageOption, stagePillClass } from "@/lib/pipeline-labels";
import { applicableDocTypes, computeComplianceSummary } from "@/lib/compliance-summary";
import { docStatusPillClass, formatDocStatus, formatLifecycleStage, progressClass } from "@/lib/compliance-labels";
import { clientDateInputToIso, clientDateInputValue } from "@/lib/timezone";

interface ApplicationRow {
  id: string;
  projectId: string;
  homeownerName: string;
  addressLine1: string;
  addressLine2: string | null;
  address: string;
  phone: string | null;
  email: string | null;
  leadSource: string;
  amiTier: string;
  county: string | null;
  distanceMilesFromOffice: number | null;
  serviceAreaCheck: string;
  intakeFormData: Record<string, unknown> | null;
  auditReportUrl: string | null;
  ownerId: string | null;
  programTrack: "HOMES" | "HEAR";
  internalStatusCode: string;
  portalStatusStale: boolean;
  portalApplicationId: string | null;
  portalStatusCode: string | null;
  portalStatusLabel: string | null;
  portalPresenceStatus: "yes" | "no" | "unknown";
  createdAt: string;
  contractValue: number | null;
  trackerId: string | null;
  fieldwireLabelCode: string | null;
  fieldwireLabelText: string | null;
  assessmentScheduledFor: string | null;
  assessmentCompletedAt: string | null;
  siteVisitScheduledFor: string | null;
  siteVisitCompletedAt: string | null;
}

interface RefRow {
  code: string;
  label: string;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// Mirrors add-lead-form.tsx's constraints (db/schema.sql check constraints).
const LEAD_SOURCES: { value: string; label: string }[] = [
  { value: "unknown", label: "Unknown / not specified" },
  { value: "portal", label: "ESRP Portal" },
  { value: "direct_call", label: "Direct Call" },
  { value: "direct_email", label: "Direct Email" },
  { value: "referral", label: "Referral" },
  { value: "website_form", label: "Website Intake Form" },
  { value: "other", label: "Other" },
];
const AMI_TIERS: { value: string; label: string }[] = [
  { value: "unknown", label: "Unknown — not yet determined" },
  { value: "tier_1", label: "Tier 1 (<80% AMI — 100% covered)" },
  { value: "tier_2", label: "Tier 2 (80–150% AMI — ~50% covered)" },
];

const INTAKE_FIELD_LABELS: Record<string, string> = {
  co_applicant: "Co-applicant",
  own_or_rent: "Own or rent",
  landlord_info: "Landlord information",
  program_status: "Program status",
  audit_status: "Energy audit status",
  audit_report_url: "Audit report",
  hvac_issue: "Heating / cooling concerns",
  improvements: "Requested improvements",
  improvements_other: "Other improvement",
  uncomfortable_rooms: "Uncomfortable rooms / areas",
  prior_issues: "Prior issues or repairs",
  other_funding: "Other federal funding",
  other_funding_which: "Other funding details",
  limit_scope_zero_oop: "Keep scope within rebate",
  cost_share: "Willing to cost-share",
  max_budget: "Maximum out-of-pocket budget",
  financing: "Interested in financing",
  financing_detail: "Financing details",
  scheduling_restrictions: "Scheduling / access restrictions",
  scheduling_details: "Scheduling details",
  anything_else: "Anything else",
  preferred_date: "Preferred visit date",
  preferred_window: "Preferred time window",
};

const INTAKE_FIELD_ORDER = Object.keys(INTAKE_FIELD_LABELS);

const INTAKE_FIELD_PATHS: Record<string, string[]> = {
  hvac_issue: ["homeowner_interview", "hvac_issue"],
  improvements: ["homeowner_interview", "improvements"],
  improvements_other: ["homeowner_interview", "improvements_other"],
  uncomfortable_rooms: ["homeowner_interview", "uncomfortable_rooms"],
  prior_issues: ["homeowner_interview", "prior_issues"],
  other_funding: ["budget_cost_share", "other_funding"],
  other_funding_which: ["budget_cost_share", "other_funding_which"],
  limit_scope_zero_oop: ["budget_cost_share", "limit_scope_zero_oop"],
  cost_share: ["budget_cost_share", "cost_share"],
  max_budget: ["budget_cost_share", "max_budget"],
  financing: ["budget_cost_share", "financing"],
  financing_detail: ["budget_cost_share", "financing_detail"],
  scheduling_restrictions: ["scheduling", "restrictions"],
  scheduling_details: ["scheduling", "details"],
  anything_else: ["scheduling", "anything_else"],
  preferred_date: ["requested_site_visit", "preferred_date"],
  preferred_window: ["requested_site_visit", "preferred_window"],
};

function intakeFieldValue(data: Record<string, unknown>, key: string): unknown {
  const path = INTAKE_FIELD_PATHS[key];
  if (!path) return data[key];
  let value: unknown = data;
  for (const segment of path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function normalizeIntakeData(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function displayIntakeValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.filter(Boolean).join(", ") || "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function serviceAreaLabel(value: string): string {
  switch (value) {
    case "in_area": return "In service area";
    case "out_of_area": return "Outside automatic service area";
    case "gray_zone": return "Gray zone — review needed";
    default: return "Not checked";
  }
}

function serviceAreaPill(value: string): string {
  if (value === "in_area") return "ok";
  if (value === "out_of_area" || value === "gray_zone") return "warning";
  return "info";
}

function ScheduleControl({
  label,
  scheduledFor,
  completedAt,
  onSave,
  onDone,
}: {
  label: string;
  scheduledFor: string | null;
  completedAt: string | null;
  onSave: (date: string) => Promise<string | null>;
  onDone: () => Promise<string | null>;
}) {
  const [draft, setDraft] = useState(scheduledFor ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);

  async function save() {
    if (!draft) return;
    setBusy(true); setMessage(null); setControlError(null);
    const result = await onSave(draft);
    setBusy(false);
    if (result) setControlError(result); else setMessage(scheduledFor ? "Rescheduled." : "Scheduled.");
  }

  async function done() {
    setBusy(true); setMessage(null); setControlError(null);
    const result = await onDone();
    setBusy(false);
    if (result) setControlError(result); else setMessage("Marked done.");
  }

  return (
    <div style={{ opacity: completedAt ? 0.5 : 1, transition: "opacity .2s" }}>
      <label style={{ display: "block", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted2)", marginBottom: 6 }}>
        {label} {completedAt && <span className="pill ok" style={{ marginLeft: 6 }}>Done</span>}
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <input type="date" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy || Boolean(completedAt)}
          style={{ flex: 1, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", color: "var(--text)", fontSize: 12, fontFamily: "var(--mono)" }} />
        <button className="ghost" onClick={save} disabled={busy || !draft || draft === (scheduledFor ?? "") || Boolean(completedAt)}>
          {scheduledFor ? "Reschedule" : "Schedule"}
        </button>
        <button className="ghost" onClick={done} disabled={busy || !scheduledFor || Boolean(completedAt)}>Done</button>
      </div>
      {message && <p style={{ color: "var(--green-text)", fontSize: 11, marginTop: 6 }}>{message}</p>}
      {controlError && <p style={{ color: "var(--red-text)", fontSize: 11, marginTop: 6 }}>{controlError}</p>}
    </div>
  );
}

// Local calendar date (not UTC) for the <input type="date"> value -- avoids
// the classic off-by-one where a UTC-midnight ISO string reads back as the
// previous day in a western timezone.
// Real-data Command Center — Component 2's project-detail deliverable
// (phase1-scope.md / ops-hub-demo-map.md). One card = one project_applications
// row (one program track), matching the Lead Pipeline board. Status changes
// aren't role-gated: no confirmed rule exists for who's allowed to move a lead's
// stage (knowledge/lead-pipeline-status.md notes it's informally Marcus or Devon
// today, no single enforced owner), so any signed-in staff member can change it.
//
// Two delete actions, deliberately different blast radius (db/schema.sql: a
// homeowner's HOMES and HEAR applications share one projects row, and
// qualification_screenings/project_compliance_documents/estimates all cascade
// from THAT row, not from project_applications):
// - "Remove this application" deletes only the selected project_applications
//   row -- safe, leaves the homeowner record and any sibling track intact.
// - "Delete entire lead" deletes the projects row, cascading through every
//   application and every piece of history tied to it. For cleaning up a
//   fully mistaken entry, not for normal pipeline hygiene.
export function CommandCenterView() {
  const searchParams = useSearchParams();
  const projectParam = searchParams.get("project");

  const [loading, setLoading] = useState(true);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const [fieldwireLabels, setFieldwireLabels] = useState<RefRow[]>([]);
  const [portalStatuses, setPortalStatuses] = useState<RefRow[]>([]);
  const [docTypes, setDocTypes] = useState<ComplianceDocType[]>([]);
  // key: `${projectId}::${docTypeCode}` -> status (a doc type with no row reads "missing")
  const [complianceStatusMap, setComplianceStatusMap] = useState<Map<string, ComplianceDocStatus>>(new Map());
  // `${projectId}::${docTypeCode}` for rows the Box bridge filled, still awaiting a human confirm
  const [autoDetectedPending, setAutoDetectedPending] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string>("");
  const [statusDraft, setStatusDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [appIdDraft, setAppIdDraft] = useState<string>("");
  const [appIdSaving, setAppIdSaving] = useState(false);
  const [appIdMessage, setAppIdMessage] = useState<string | null>(null);
  const [appIdError, setAppIdError] = useState<string | null>(null);

  // Portal application status: manual override until email ingestion is the
  // sole source of truth. Also touches portal_status_updated_at/stale so a
  // manual entry behaves like a real automated update, not a silent backdoor.
  const [portalStatusDraft, setPortalStatusDraft] = useState<string>("");
  const [portalStatusSaving, setPortalStatusSaving] = useState(false);
  const [portalStatusMessage, setPortalStatusMessage] = useState<string | null>(null);
  const [portalStatusError, setPortalStatusError] = useState<string | null>(null);
  const [portalPresenceDraft, setPortalPresenceDraft] = useState<"yes" | "no" | "unknown">("unknown");
  const [portalPresenceSaving, setPortalPresenceSaving] = useState(false);
  const [portalPresenceMessage, setPortalPresenceMessage] = useState<string | null>(null);
  const [portalPresenceError, setPortalPresenceError] = useState<string | null>(null);

  // Date added: mirrors project_applications.created_at (same field the read
  // view already shows), editable so existing pipeline entries can be
  // backdated to match what's already in the team's real tracker.
  const [dateAddedDraft, setDateAddedDraft] = useState<string>("");
  const [dateAddedSaving, setDateAddedSaving] = useState(false);
  const [dateAddedMessage, setDateAddedMessage] = useState<string | null>(null);
  const [dateAddedError, setDateAddedError] = useState<string | null>(null);

  // Tracker ID: per-application (HOMES and HEAR get different tracker IDs even
  // for the same homeowner, confirmed 2026-08-24) -- not part of the project-level
  // edit form below.
  const [trackerIdDraft, setTrackerIdDraft] = useState<string>("");
  const [trackerIdSaving, setTrackerIdSaving] = useState(false);
  const [trackerIdMessage, setTrackerIdMessage] = useState<string | null>(null);
  const [trackerIdError, setTrackerIdError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState({
    homeownerName: "",
    phone: "",
    email: "",
    addressLine1: "",
    addressLine2: "",
    leadSource: "unknown",
    amiTier: "unknown",
    fieldwireLabelCode: "",
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [confirmRemoveApp, setConfirmRemoveApp] = useState(false);
  const [confirmDeleteLead, setConfirmDeleteLead] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [stagesRes, appsRes, staffRes, estimatesRes, fieldwireLabelsRes, portalStatusesRes, docTypesRes, pcdRes] =
        await Promise.all([
          supabase
            .from("pipeline_stages")
            .select("code, label, stage_group, sort_order, is_critical_alert")
            .order("sort_order"),
          supabase
            .from("project_applications")
            .select(
              "id, project_id, program_track, internal_status_code, portal_status_stale, portal_application_id, portal_status_code, tracker_id, created_at, assessment_scheduled_for, assessment_completed_at, portal_statuses(label), projects!inner(homeowner_name, phone, email, address_line1, address_line2, county, distance_miles_from_office, service_area_check, intake_form_data, audit_report_url, lead_source, ami_tier, assigned_owner_id, fieldwire_label_code, site_visit_scheduled_for, site_visit_completed_at, fieldwire_labels(label))"
            )
            .order("created_at", { ascending: false }),
          supabase.from("staff").select("id, full_name"),
          // Signed only -- an ai_draft/pending_review total can still change before it's final,
          // so it shouldn't be shown as "contract value" (ops-hub-demo-map.md header spec).
          supabase
            .from("estimates")
            .select("project_id, program_track, total_project_cost")
            .eq("status", "signed")
            .order("created_at", { ascending: false }),
          supabase.from("fieldwire_labels").select("code, label").order("label"),
          supabase.from("portal_statuses").select("code, label").order("label"),
          supabase
            .from("compliance_doc_types")
            .select("code, label, lifecycle_stage, applies_to_track, required, condition_note, source_citation"),
          supabase.from("project_compliance_documents").select("project_id, doc_type_code, status, auto_detected"),
        ]);

      if (cancelled) return;

      if (
        stagesRes.error ||
        appsRes.error ||
        staffRes.error ||
        estimatesRes.error ||
        fieldwireLabelsRes.error ||
        portalStatusesRes.error ||
        docTypesRes.error ||
        pcdRes.error
      ) {
        console.error(
          "Command Center load failed",
          stagesRes.error ??
            appsRes.error ??
            staffRes.error ??
            estimatesRes.error ??
            fieldwireLabelsRes.error ??
            portalStatusesRes.error ??
            docTypesRes.error ??
            pcdRes.error
        );
        setError("Could not load project data.");
        setLoading(false);
        return;
      }

      setStages((stagesRes.data ?? []) as PipelineStage[]);
      setStaffNames(Object.fromEntries((staffRes.data ?? []).map((s) => [s.id, s.full_name])));
      setFieldwireLabels((fieldwireLabelsRes.data ?? []) as RefRow[]);
      setPortalStatuses((portalStatusesRes.data ?? []) as RefRow[]);
      setDocTypes(
        (docTypesRes.data ?? []).map((d) => ({
          code: d.code,
          label: d.label,
          lifecycleStage: d.lifecycle_stage,
          appliesToTrack: d.applies_to_track as ComplianceDocType["appliesToTrack"],
          required: d.required,
          conditionNote: d.condition_note,
          sourceCitation: d.source_citation,
        }))
      );
      // Optional during local review before the migration is deployed. The
      // page remains usable against the current schema and derives presence
      // from reliable portal evidence when this column is not available yet.
      const portalPresenceRes = await supabase
        .from("project_applications")
        .select("id, portal_presence_status");
      const portalPresenceById = new Map<string, "yes" | "no" | "unknown">(
        (portalPresenceRes.data ?? []).map((row) => [row.id, row.portal_presence_status as "yes" | "no" | "unknown"])
      );
      {
        const cmap = new Map<string, ComplianceDocStatus>();
        const autoPending = new Set<string>();
        for (const row of pcdRes.data ?? []) {
          const k = `${row.project_id}::${row.doc_type_code}`;
          cmap.set(k, row.status as ComplianceDocStatus);
          if (row.auto_detected && row.status === "pending_review") autoPending.add(k);
        }
        setComplianceStatusMap(cmap);
        setAutoDetectedPending(autoPending);
      }

      // First (most recent, per the order above) signed estimate wins per project+track.
      const valueByKey = new Map<string, number>();
      for (const est of estimatesRes.data ?? []) {
        const key = `${est.project_id}_${est.program_track}`;
        if (!valueByKey.has(key) && est.total_project_cost != null) {
          valueByKey.set(key, Number(est.total_project_cost));
        }
      }

      const mapped: ApplicationRow[] = (appsRes.data ?? []).flatMap((row) => {
        const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
        if (!project) return [];
        const fwLabel = Array.isArray(project.fieldwire_labels) ? project.fieldwire_labels[0] : project.fieldwire_labels;
        const portalStatus = Array.isArray(row.portal_statuses) ? row.portal_statuses[0] : row.portal_statuses;
        return [
          {
            id: row.id,
            projectId: row.project_id,
            homeownerName: project.homeowner_name,
            addressLine1: project.address_line1 ?? "",
            addressLine2: project.address_line2,
            address: [project.address_line1, project.address_line2].filter(Boolean).join(", "),
            phone: project.phone,
            email: project.email,
            leadSource: project.lead_source,
            amiTier: project.ami_tier,
            county: project.county,
            distanceMilesFromOffice: project.distance_miles_from_office == null ? null : Number(project.distance_miles_from_office),
            serviceAreaCheck: project.service_area_check ?? "not_checked",
            intakeFormData: normalizeIntakeData(project.intake_form_data),
            auditReportUrl: project.audit_report_url,
            ownerId: project.assigned_owner_id,
            programTrack: row.program_track,
            internalStatusCode: row.internal_status_code,
            portalStatusStale: row.portal_status_stale,
            portalApplicationId: row.portal_application_id,
            portalStatusCode: row.portal_status_code,
            portalStatusLabel: portalStatus?.label ?? null,
            portalPresenceStatus: portalPresenceById.get(row.id) ??
              (row.portal_application_id || row.portal_status_code || project.lead_source === "portal" ? "yes" : "unknown"),
            createdAt: row.created_at,
            contractValue: valueByKey.get(`${row.project_id}_${row.program_track}`) ?? null,
            trackerId: row.tracker_id,
            fieldwireLabelCode: project.fieldwire_label_code,
            fieldwireLabelText: fwLabel?.label ?? null,
            assessmentScheduledFor: row.assessment_scheduled_for,
            assessmentCompletedAt: row.assessment_completed_at,
            siteVisitScheduledFor: project.site_visit_scheduled_for,
            siteVisitCompletedAt: project.site_visit_completed_at,
          },
        ];
      });
      setApplications(mapped);

      const preselect = projectParam ? mapped.find((a) => a.projectId === projectParam) : mapped[0];
      if (preselect) {
        setSelectedId(preselect.id);
        setStatusDraft(preselect.internalStatusCode);
        setAppIdDraft(preselect.portalApplicationId ?? "");
        setPortalStatusDraft(preselect.portalStatusCode ?? "");
        setDateAddedDraft(clientDateInputValue(preselect.createdAt));
        setTrackerIdDraft(preselect.trackerId ?? "");
        setPortalPresenceDraft(preselect.portalPresenceStatus);
      }

      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [projectParam]);

  const selected = applications.find((a) => a.id === selectedId) ?? null;
  const selectedProjectId = selected?.projectId ?? null;
  const selectedIntakeEntries = selected?.intakeFormData
    ? INTAKE_FIELD_ORDER
        .map((key) => ({
          key,
          label: INTAKE_FIELD_LABELS[key],
          value: key === "audit_report_url" ? selected.auditReportUrl : intakeFieldValue(selected.intakeFormData!, key),
        }))
        .filter((entry) => entry.value !== undefined && entry.value !== null && entry.value !== "")
    : [];

  function selectApplication(id: string) {
    const app = applications.find((a) => a.id === id);
    setSelectedId(id);
    setStatusDraft(app?.internalStatusCode ?? "");
    setSaveMessage(null);
    setError(null);
    setEditing(false);
    setEditError(null);
    setConfirmRemoveApp(false);
    setConfirmDeleteLead(false);
    setDeleteError(null);
    setAppIdDraft(app?.portalApplicationId ?? "");
    setAppIdMessage(null);
    setAppIdError(null);
    setPortalStatusDraft(app?.portalStatusCode ?? "");
    setPortalStatusMessage(null);
    setPortalStatusError(null);
    setPortalPresenceDraft(app?.portalPresenceStatus ?? "unknown");
    setPortalPresenceMessage(null);
    setPortalPresenceError(null);
    setDateAddedDraft(app ? clientDateInputValue(app.createdAt) : "");
    setDateAddedMessage(null);
    setDateAddedError(null);
    setTrackerIdDraft(app?.trackerId ?? "");
    setTrackerIdMessage(null);
    setTrackerIdError(null);
  }

  const stageByCode = useMemo(() => new Map(stages.map((s) => [s.code, s])), [stages]);
  const groupOrder = useMemo(() => deriveGroupOrder(stages), [stages]);
  const currentStage = selected ? stageByCode.get(selected.internalStatusCode) : undefined;
  const currentGroupIdx = currentStage ? groupOrder.indexOf(currentStage.stage_group) : -1;

  // Compliance snapshot for the selected homeowner. Applicability is derived
  // from ALL of that project's program tracks (a HOMES+HEAR homeowner has two
  // application rows), and the math is the shared lib/compliance-summary.ts so
  // this never disagrees with the Compliance page or the Portfolio table.
  const selectedProjectTracks = selectedProjectId
    ? Array.from(new Set(applications.filter((a) => a.projectId === selectedProjectId).map((a) => a.programTrack)))
    : [];
  const complianceStatusFor = (code: string): ComplianceDocStatus =>
    (selectedProjectId && complianceStatusMap.get(`${selectedProjectId}::${code}`)) || "missing";
  const complianceSummary = selectedProjectId
    ? computeComplianceSummary(docTypes, selectedProjectTracks, complianceStatusFor)
    : null;
  const complianceGaps = selectedProjectId
    ? applicableDocTypes(docTypes, selectedProjectTracks)
        .filter((d) => d.required)
        .map((d) => ({ doc: d, status: complianceStatusFor(d.code) }))
        .filter((x) => x.status === "missing" || x.status === "rejected")
    : [];
  const autoDetectedToConfirm = selectedProjectId
    ? applicableDocTypes(docTypes, selectedProjectTracks).filter((d) =>
        autoDetectedPending.has(`${selectedProjectId}::${d.code}`)
      )
    : [];

  async function handleSave() {
    if (!selected || statusDraft === selected.internalStatusCode) return;
    setSaving(true);
    setError(null);
    setSaveMessage(null);

    const { error: updateError } = await supabase
      .from("project_applications")
      .update({ internal_status_code: statusDraft, updated_at: new Date().toISOString() })
      .eq("id", selected.id);

    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setApplications((prev) =>
      prev.map((a) => (a.id === selected.id ? { ...a, internalStatusCode: statusDraft } : a))
    );
    setSaveMessage("Status updated.");
  }

  async function handleSaveAppId() {
    if (!selected) return;
    const trimmed = appIdDraft.trim();
    if (trimmed === (selected.portalApplicationId ?? "")) return;

    setAppIdSaving(true);
    setAppIdError(null);
    setAppIdMessage(null);

    const { error: updateError } = await supabase
      .from("project_applications")
      .update({ portal_application_id: trimmed || null, ...(trimmed ? { portal_presence_status: "yes" } : {}) })
      .eq("id", selected.id);

    setAppIdSaving(false);

    if (updateError) {
      setAppIdError(updateError.message);
      return;
    }

    setApplications((prev) =>
      prev.map((a) => (a.id === selected.id ? { ...a, portalApplicationId: trimmed || null } : a))
    );
    setAppIdMessage("Saved.");
    if (trimmed) setPortalPresenceDraft("yes");
  }

  async function handleSavePortalStatus() {
    if (!selected) return;
    const trimmed = portalStatusDraft.trim();
    if (trimmed === (selected.portalStatusCode ?? "")) return;

    setPortalStatusSaving(true);
    setPortalStatusError(null);
    setPortalStatusMessage(null);

    const { error: updateError } = await supabase
      .from("project_applications")
      .update({
        portal_status_code: trimmed || null,
        ...(trimmed ? { portal_presence_status: "yes" } : {}),
        portal_status_updated_at: new Date().toISOString(),
        portal_status_stale: false,
      })
      .eq("id", selected.id);

    setPortalStatusSaving(false);

    if (updateError) {
      setPortalStatusError(updateError.message);
      return;
    }

    const label = portalStatuses.find((p) => p.code === trimmed)?.label ?? null;
    setApplications((prev) =>
      prev.map((a) =>
        a.id === selected.id
          ? { ...a, portalStatusCode: trimmed || null, portalStatusLabel: label, portalStatusStale: false }
          : a
      )
    );
    setPortalStatusMessage("Saved.");
    if (trimmed) setPortalPresenceDraft("yes");
  }

  async function handleSavePortalPresence() {
    if (!selected) return;
    setPortalPresenceSaving(true);
    setPortalPresenceMessage(null);
    setPortalPresenceError(null);
    const { data: updatedPresence, error: updateError } = await supabase
      .from("project_applications")
      .update({ portal_presence_status: portalPresenceDraft, updated_at: new Date().toISOString() })
      .eq("id", selected.id)
      .select("portal_presence_status")
      .single();
    setPortalPresenceSaving(false);
    if (updateError) {
      setPortalPresenceError(updateError.message);
      return;
    }
    const savedPresence = updatedPresence.portal_presence_status as "yes" | "no" | "unknown";
    setPortalPresenceDraft(savedPresence);
    setApplications((prev) => prev.map((a) => a.id === selected.id ? { ...a, portalPresenceStatus: savedPresence } : a));
    setPortalPresenceMessage("Saved.");
  }

  async function handleSaveDateAdded() {
    if (!selected || !dateAddedDraft) return;
    const iso = clientDateInputToIso(dateAddedDraft);
    if (iso === selected.createdAt) return;

    setDateAddedSaving(true);
    setDateAddedError(null);
    setDateAddedMessage(null);

    const { error: updateError } = await supabase
      .from("project_applications")
      .update({ created_at: iso })
      .eq("id", selected.id);

    setDateAddedSaving(false);

    if (updateError) {
      setDateAddedError(updateError.message);
      return;
    }

    setApplications((prev) => prev.map((a) => (a.id === selected.id ? { ...a, createdAt: iso } : a)));
    setDateAddedMessage("Saved.");
  }

  async function saveAssessmentSchedule(date: string): Promise<string | null> {
    if (!selected) return "No application selected.";
    const { error: updateError } = await supabase.from("project_applications").update({
      assessment_scheduled_for: date,
      assessment_completed_at: null,
      internal_status_code: "assessment_scheduled",
      updated_at: new Date().toISOString(),
    }).eq("id", selected.id);
    if (updateError) return updateError.message;
    setApplications((prev) => prev.map((a) => a.id === selected.id ? {
      ...a, assessmentScheduledFor: date, assessmentCompletedAt: null, internalStatusCode: "assessment_scheduled",
    } : a));
    setStatusDraft("assessment_scheduled");
    return null;
  }

  async function completeAssessment(): Promise<string | null> {
    if (!selected) return "No application selected.";
    const completedAt = new Date().toISOString();
    const { error: updateError } = await supabase.from("project_applications").update({
      assessment_completed_at: completedAt,
      internal_status_code: "pending_site_visit_sched",
      updated_at: completedAt,
    }).eq("id", selected.id);
    if (updateError) return updateError.message;
    setApplications((prev) => prev.map((a) => a.id === selected.id ? {
      ...a, assessmentCompletedAt: completedAt, internalStatusCode: "pending_site_visit_sched",
    } : a));
    setStatusDraft("pending_site_visit_sched");
    return null;
  }

  async function saveSiteVisitSchedule(date: string): Promise<string | null> {
    if (!selected) return "No application selected.";
    const now = new Date().toISOString();
    const { error: projectError } = await supabase.from("projects").update({
      site_visit_scheduled_for: date, site_visit_completed_at: null, updated_at: now,
    }).eq("id", selected.projectId);
    if (projectError) return projectError.message;
    const { error: appsError } = await supabase.from("project_applications").update({
      internal_status_code: "site_visit_scheduled", updated_at: now,
    }).eq("project_id", selected.projectId);
    if (appsError) return appsError.message;
    setApplications((prev) => prev.map((a) => a.projectId === selected.projectId ? {
      ...a, siteVisitScheduledFor: date, siteVisitCompletedAt: null, internalStatusCode: "site_visit_scheduled",
    } : a));
    setStatusDraft("site_visit_scheduled");
    return null;
  }

  async function completeSiteVisit(): Promise<string | null> {
    if (!selected) return "No application selected.";
    const completedAt = new Date().toISOString();
    const { error: projectError } = await supabase.from("projects").update({
      site_visit_completed_at: completedAt, updated_at: completedAt,
    }).eq("id", selected.projectId);
    if (projectError) return projectError.message;
    const { error: appsError } = await supabase.from("project_applications").update({
      internal_status_code: "site_visit_go", updated_at: completedAt,
    }).eq("project_id", selected.projectId);
    if (appsError) return appsError.message;
    setApplications((prev) => prev.map((a) => a.projectId === selected.projectId ? {
      ...a, siteVisitCompletedAt: completedAt, internalStatusCode: "site_visit_go",
    } : a));
    setStatusDraft("site_visit_go");
    return null;
  }

  async function handleSaveTrackerId() {
    if (!selected) return;
    const trimmed = trackerIdDraft.trim();
    if (trimmed === (selected.trackerId ?? "")) return;

    setTrackerIdSaving(true);
    setTrackerIdError(null);
    setTrackerIdMessage(null);

    const { error: updateError } = await supabase
      .from("project_applications")
      .update({ tracker_id: trimmed || null })
      .eq("id", selected.id);

    setTrackerIdSaving(false);

    if (updateError) {
      setTrackerIdError(updateError.message);
      return;
    }

    setApplications((prev) => prev.map((a) => (a.id === selected.id ? { ...a, trackerId: trimmed || null } : a)));
    setTrackerIdMessage("Saved.");
  }

  function startEdit() {
    if (!selected) return;
    setEditDraft({
      homeownerName: selected.homeownerName,
      phone: selected.phone ?? "",
      email: selected.email ?? "",
      addressLine1: selected.addressLine1,
      addressLine2: selected.addressLine2 ?? "",
      leadSource: selected.leadSource,
      amiTier: selected.amiTier,
      fieldwireLabelCode: selected.fieldwireLabelCode ?? "",
    });
    setEditError(null);
    setEditing(true);
  }

  async function handleEditSave(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;

    if (!editDraft.homeownerName.trim() || !editDraft.addressLine1.trim()) {
      setEditError("Homeowner name and address are required.");
      return;
    }

    setEditSaving(true);
    setEditError(null);
    const addressChanged = editDraft.addressLine1.trim() !== selected.addressLine1 ||
      (editDraft.addressLine2.trim() || null) !== selected.addressLine2;

    const { error: updateError } = await supabase
      .from("projects")
      .update({
        homeowner_name: editDraft.homeownerName.trim(),
        phone: editDraft.phone.trim() || null,
        email: editDraft.email.trim() || null,
        address_line1: editDraft.addressLine1.trim(),
        address_line2: editDraft.addressLine2.trim() || null,
        lead_source: editDraft.leadSource,
        ami_tier: editDraft.amiTier,
        fieldwire_label_code: editDraft.fieldwireLabelCode || null,
        ...(addressChanged ? { county: null, distance_miles_from_office: null, service_area_check: "not_checked" } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", selected.projectId);

    setEditSaving(false);

    if (updateError) {
      setEditError(updateError.message);
      return;
    }

    setApplications((prev) =>
      prev.map((a) =>
        a.projectId === selected.projectId
          ? {
              ...a,
              homeownerName: editDraft.homeownerName.trim(),
              phone: editDraft.phone.trim() || null,
              email: editDraft.email.trim() || null,
              addressLine1: editDraft.addressLine1.trim(),
              addressLine2: editDraft.addressLine2.trim() || null,
              address: [editDraft.addressLine1.trim(), editDraft.addressLine2.trim()].filter(Boolean).join(", "),
              leadSource: editDraft.leadSource,
              amiTier: editDraft.amiTier,
              fieldwireLabelCode: editDraft.fieldwireLabelCode || null,
              fieldwireLabelText: fieldwireLabels.find((f) => f.code === editDraft.fieldwireLabelCode)?.label ?? null,
              ...(addressChanged ? { county: null, distanceMilesFromOffice: null, serviceAreaCheck: "not_checked" } : {}),
            }
          : a
      )
    );
    setEditing(false);
  }

  async function handleRemoveApplication() {
    if (!selected) return;
    if (!confirmRemoveApp) {
      setConfirmRemoveApp(true);
      return;
    }

    setDeleting(true);
    setDeleteError(null);

    const { error: deleteErr } = await supabase.from("project_applications").delete().eq("id", selected.id);

    setDeleting(false);
    setConfirmRemoveApp(false);

    if (deleteErr) {
      setDeleteError(deleteErr.message);
      return;
    }

    const remaining = applications.filter((a) => a.id !== selected.id);
    setApplications(remaining);
    const next = remaining.find((a) => a.projectId === selected.projectId) ?? remaining[0];
    if (next) selectApplication(next.id);
    else setSelectedId("");
  }

  async function handleDeleteLead() {
    if (!selected) return;
    if (!confirmDeleteLead) {
      setConfirmDeleteLead(true);
      return;
    }

    setDeleting(true);
    setDeleteError(null);

    const { error: deleteErr } = await supabase.from("projects").delete().eq("id", selected.projectId);

    setDeleting(false);
    setConfirmDeleteLead(false);

    if (deleteErr) {
      setDeleteError(deleteErr.message);
      return;
    }

    const remaining = applications.filter((a) => a.projectId !== selected.projectId);
    setApplications(remaining);
    if (remaining[0]) selectApplication(remaining[0].id);
    else setSelectedId("");
  }

  if (loading) {
    return (
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted2)", marginBottom: 6 }}>
          Select project
        </label>
        <select
          value={selectedId}
          onChange={(e) => selectApplication(e.target.value)}
          style={{ width: "100%", maxWidth: 420, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", color: "var(--text)", fontSize: 12 }}
        >
          {applications.length === 0 && <option value="">No leads yet</option>}
          {applications.map((a) => (
            <option key={a.id} value={a.id}>
              {a.homeownerName} — {a.programTrack} ({a.address || "no address"})
            </option>
          ))}
        </select>
      </div>

      {!selected ? (
        <p className="muted">
          No leads yet — add one from Lead Pipeline, or select a project above.
        </p>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
              <div>
                <div className="muted" style={{ fontSize: 11 }}>{selected.programTrack}</div>
                <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{selected.homeownerName}</div>
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{selected.address || "No address on file"}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                {currentStage && (
                  <span className={`pill ${stagePillClass(currentStage)}`}>{currentStage.label}</span>
                )}
                <div style={{ textAlign: "right" }}>
                  <div className="muted" style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>
                    Contract Value
                  </div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 16, fontWeight: 700, marginTop: 2 }}>
                    {selected.contractValue != null ? formatCurrency(selected.contractValue) : "Pending"}
                  </div>
                </div>
              </div>
            </div>
            {groupOrder.length > 0 && (
              <div className="cc-stage-row">
                {groupOrder.map((g, idx) => (
                  <div key={g} className={`seg ${idx < currentGroupIdx ? "done" : idx === currentGroupIdx ? "active" : ""}`}>
                    {formatGroupLabel(g)}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="cc-grid" style={{ marginBottom: 14 }}>
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div>
                  <h2 style={{ margin: 0 }}>Service Area</h2>
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: 11 }}>
                    Straight-line distance from 4820 Meridian Park Dr, Suite 210, Richmond. This is not driving time or road mileage.
                  </p>
                </div>
                <span className={`pill ${serviceAreaPill(selected.serviceAreaCheck)}`}>
                  {serviceAreaLabel(selected.serviceAreaCheck)}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 14 }}>
                <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 7, padding: "12px 13px" }}>
                  <div className="muted" style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>
                    Straight-line distance
                  </div>
                  <div style={{ fontFamily: "var(--mono)", fontSize: 22, fontWeight: 700, marginTop: 4 }}>
                    {selected.distanceMilesFromOffice == null ? "Pending" : `${selected.distanceMilesFromOffice.toFixed(1)} miles`}
                  </div>
                </div>
                <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 7, padding: "12px 13px" }}>
                  <div className="muted" style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>
                    County
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 7 }}>
                    {selected.county || "Pending"}
                  </div>
                </div>
              </div>
              <div className="snap-row" style={{ marginTop: 10 }}>
                <span className="k">Homeowner address</span>
                <span style={{ textAlign: "right" }}>{selected.address || "No address on file"}</span>
              </div>
            </div>

            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div>
                  <h2 style={{ margin: 0 }}>Homeowner Intake</h2>
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: 11 }}>
                    Full questionnaire stored in Supabase for staff review.
                  </p>
                </div>
                <span className={`pill ${selectedIntakeEntries.length ? "ok" : "info"}`}>
                  {selectedIntakeEntries.length ? "On file" : "Not received"}
                </span>
              </div>
              {selectedIntakeEntries.length === 0 ? (
                <p className="muted" style={{ margin: "14px 0 0" }}>
                  No submitted intake questionnaire is attached to this lead yet.
                </p>
              ) : (
                <div style={{ marginTop: 12, maxHeight: 330, overflowY: "auto", paddingRight: 4 }}>
                  {selectedIntakeEntries.map((entry) => (
                    <div className="snap-row" key={entry.key}>
                      <span className="k">{entry.label}</span>
                      {entry.key === "audit_report_url" && typeof entry.value === "string" && entry.value ? (
                        <a href={entry.value} target="_blank" rel="noopener noreferrer" className="tb-pill">
                          Open report →
                        </a>
                      ) : (
                        <span style={{ textAlign: "right", whiteSpace: "pre-wrap", maxWidth: "58%" }}>
                          {displayIntakeValue(entry.value)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="cc-grid">
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2 style={{ marginTop: 0, marginBottom: editing ? 10 : 0 }}>Project Details</h2>
                {!editing && (
                  <button className="ghost" onClick={startEdit} style={{ padding: "5px 11px", fontSize: 11 }}>
                    Edit
                  </button>
                )}
              </div>

              {editing ? (
                <form onSubmit={handleEditSave}>
                  <div className="form-grid" style={{ maxWidth: "none" }}>
                    <div className="full">
                      <label>Homeowner Name</label>
                      <input
                        type="text"
                        value={editDraft.homeownerName}
                        onChange={(e) => setEditDraft((d) => ({ ...d, homeownerName: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label>Phone</label>
                      <input
                        type="text"
                        value={editDraft.phone}
                        onChange={(e) => setEditDraft((d) => ({ ...d, phone: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label>Email</label>
                      <input
                        type="email"
                        value={editDraft.email}
                        onChange={(e) => setEditDraft((d) => ({ ...d, email: e.target.value }))}
                      />
                    </div>
                    <div className="full">
                      <label>Address</label>
                      <input
                        type="text"
                        value={editDraft.addressLine1}
                        onChange={(e) => setEditDraft((d) => ({ ...d, addressLine1: e.target.value }))}
                      />
                    </div>
                    <div className="full">
                      <label>City / State / ZIP</label>
                      <input
                        type="text"
                        value={editDraft.addressLine2}
                        onChange={(e) => setEditDraft((d) => ({ ...d, addressLine2: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label>Source</label>
                      <select
                        value={editDraft.leadSource}
                        onChange={(e) => setEditDraft((d) => ({ ...d, leadSource: e.target.value }))}
                      >
                        {LEAD_SOURCES.map((s) => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label>AMI Tier</label>
                      <select
                        value={editDraft.amiTier}
                        onChange={(e) => setEditDraft((d) => ({ ...d, amiTier: e.target.value }))}
                      >
                        {AMI_TIERS.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label>Fieldwire Label</label>
                      <select
                        value={editDraft.fieldwireLabelCode}
                        onChange={(e) => setEditDraft((d) => ({ ...d, fieldwireLabelCode: e.target.value }))}
                      >
                        <option value="">Not synced yet</option>
                        {fieldwireLabels.map((f) => (
                          <option key={f.code} value={f.code}>{f.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {editError && <p style={{ color: "var(--red-text)", fontSize: 12, marginTop: 10 }}>{editError}</p>}
                  <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
                    <button type="submit" className="primary" disabled={editSaving}>
                      {editSaving ? "Saving…" : "Save Changes"}
                    </button>
                    <button type="button" className="ghost" onClick={() => setEditing(false)} disabled={editSaving}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="snap-row"><span className="k">Homeowner</span><span>{selected.homeownerName}</span></div>
                  <div className="snap-row"><span className="k">Phone</span><span>{selected.phone || "—"}</span></div>
                  <div className="snap-row"><span className="k">Email</span><span>{selected.email || "—"}</span></div>
                  <div className="snap-row"><span className="k">Program</span><span>{selected.programTrack}</span></div>
                  <div className="snap-row"><span className="k">AMI tier</span><span>{AMI_TIERS.find((t) => t.value === selected.amiTier)?.label ?? selected.amiTier}</span></div>
                  <div className="snap-row"><span className="k">Lead source</span><span>{selected.leadSource}</span></div>
                  <div className="snap-row"><span className="k">Owner</span><span>{selected.ownerId ? staffNames[selected.ownerId] ?? "Unknown" : "Unassigned"}</span></div>
                  <div className="snap-row">
                    <span className="k">Fieldwire label</span>
                    <span>
                      {selected.fieldwireLabelText ? (
                        <span className="pill info">{selected.fieldwireLabelText}</span>
                      ) : (
                        "Not synced yet"
                      )}
                    </span>
                  </div>
                  <div className="snap-row">
                    <span className="k">In portal?</span>
                    <span className={`pill ${selected.portalPresenceStatus === "yes" ? "ok" : selected.portalPresenceStatus === "no" ? "warning" : "info"}`}>
                      {selected.portalPresenceStatus === "yes" ? "Yes" : selected.portalPresenceStatus === "no" ? "No" : "Not confirmed"}
                    </span>
                  </div>
                  <div className="snap-row">
                    <span className="k">Portal check</span>
                    <span className={`pill ${selected.portalStatusStale ? "warning" : "ok"}`}>
                      {selected.portalStatusStale ? "Stale — no email update in 48h" : "Up to date"}
                    </span>
                  </div>

                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                    <label style={{ display: "block", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted2)", marginBottom: 6 }}>
                      In Portal?
                    </label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <select value={portalPresenceDraft} onChange={(e) => setPortalPresenceDraft(e.target.value as "yes" | "no" | "unknown")} style={{ flex: 1, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", color: "var(--text)", fontSize: 12 }}>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                        <option value="unknown">Not confirmed</option>
                      </select>
                      <button className="ghost" onClick={handleSavePortalPresence} disabled={portalPresenceSaving} style={{ flexShrink: 0 }}>
                        {portalPresenceSaving ? "Saving…" : "Save"}
                      </button>
                    </div>
                    <p className="muted" style={{ fontSize: 10, margin: "6px 0 0" }}>Automatically Yes when a portal email, Application ID, or portal status is captured. Staff may correct it.</p>
                    {portalPresenceMessage && <p style={{ color: "var(--green-text)", fontSize: 11, marginTop: 6 }}>{portalPresenceMessage}</p>}
                    {portalPresenceError && <p style={{ color: "var(--red-text)", fontSize: 11, marginTop: 6 }}>{portalPresenceError}</p>}
                  </div>

                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                    <label style={{ display: "block", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted2)", marginBottom: 6 }}>
                      Tracker ID
                    </label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        type="text"
                        value={trackerIdDraft}
                        onChange={(e) => setTrackerIdDraft(e.target.value)}
                        placeholder="e.g. ESRP-2026-0001"
                        style={{ flex: 1, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", color: "var(--text)", fontSize: 12, fontFamily: "var(--mono)" }}
                      />
                      <button
                        className="ghost"
                        onClick={handleSaveTrackerId}
                        disabled={trackerIdSaving || trackerIdDraft.trim() === (selected.trackerId ?? "")}
                        style={{ flexShrink: 0 }}
                      >
                        {trackerIdSaving ? "Saving…" : "Save"}
                      </button>
                    </div>
                    {trackerIdMessage && <p style={{ color: "var(--green-text)", fontSize: 11, marginTop: 6 }}>{trackerIdMessage}</p>}
                    {trackerIdError && <p style={{ color: "var(--red-text)", fontSize: 11, marginTop: 6 }}>{trackerIdError}</p>}
                  </div>

                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                    <label style={{ display: "block", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted2)", marginBottom: 6 }}>
                      Date Added
                    </label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        type="date"
                        value={dateAddedDraft}
                        onChange={(e) => setDateAddedDraft(e.target.value)}
                        style={{ flex: 1, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", color: "var(--text)", fontSize: 12, fontFamily: "var(--mono)" }}
                      />
                      <button
                        className="ghost"
                        onClick={handleSaveDateAdded}
                        disabled={dateAddedSaving || !dateAddedDraft || dateAddedDraft === clientDateInputValue(selected.createdAt)}
                        style={{ flexShrink: 0 }}
                      >
                        {dateAddedSaving ? "Saving…" : "Save"}
                      </button>
                    </div>
                    {dateAddedMessage && <p style={{ color: "var(--green-text)", fontSize: 11, marginTop: 6 }}>{dateAddedMessage}</p>}
                    {dateAddedError && <p style={{ color: "var(--red-text)", fontSize: 11, marginTop: 6 }}>{dateAddedError}</p>}
                  </div>

                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", display: "grid", gap: 14 }}>
                    {selected.programTrack === "HOMES" ? (
                      <ScheduleControl
                        key={`assessment-${selected.id}-${selected.assessmentScheduledFor}-${selected.assessmentCompletedAt}`}
                        label="HOMES Assessment Schedule"
                        scheduledFor={selected.assessmentScheduledFor}
                        completedAt={selected.assessmentCompletedAt}
                        onSave={saveAssessmentSchedule}
                        onDone={completeAssessment}
                      />
                    ) : (
                      <div>
                        <label style={{ display: "block", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted2)", marginBottom: 4 }}>
                          HOMES Assessment Schedule
                        </label>
                        <span className="muted" style={{ fontSize: 11 }}>Not applicable to HEAR.</span>
                      </div>
                    )}
                    <ScheduleControl
                      key={`site-visit-${selected.projectId}-${selected.siteVisitScheduledFor}-${selected.siteVisitCompletedAt}`}
                      label="Stonebridge Site Visit Schedule"
                      scheduledFor={selected.siteVisitScheduledFor}
                      completedAt={selected.siteVisitCompletedAt}
                      onSave={saveSiteVisitSchedule}
                      onDone={completeSiteVisit}
                    />
                  </div>

                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                    <label style={{ display: "block", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted2)", marginBottom: 6 }}>
                      Portal Application Status
                    </label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <select
                        value={portalStatusDraft}
                        onChange={(e) => setPortalStatusDraft(e.target.value)}
                        style={{ flex: 1, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", color: "var(--text)", fontSize: 12 }}
                      >
                        <option value="">Not submitted yet</option>
                        {portalStatuses.map((p) => (
                          <option key={p.code} value={p.code}>{p.label}</option>
                        ))}
                      </select>
                      <button
                        className="ghost"
                        onClick={handleSavePortalStatus}
                        disabled={portalStatusSaving || portalStatusDraft === (selected.portalStatusCode ?? "")}
                        style={{ flexShrink: 0 }}
                      >
                        {portalStatusSaving ? "Saving…" : "Save"}
                      </button>
                    </div>
                    {portalStatusMessage && <p style={{ color: "var(--green-text)", fontSize: 11, marginTop: 6 }}>{portalStatusMessage}</p>}
                    {portalStatusError && <p style={{ color: "var(--red-text)", fontSize: 11, marginTop: 6 }}>{portalStatusError}</p>}
                  </div>

                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                    <label style={{ display: "block", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted2)", marginBottom: 6 }}>
                      Portal Application ID
                    </label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        type="text"
                        value={appIdDraft}
                        onChange={(e) => setAppIdDraft(e.target.value)}
                        placeholder="e.g. 903c1256-19a8-4f37-8fc6-93f7fb7d429d"
                        style={{ flex: 1, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", color: "var(--text)", fontSize: 12, fontFamily: "var(--mono)" }}
                      />
                      <button
                        className="ghost"
                        onClick={handleSaveAppId}
                        disabled={appIdSaving || appIdDraft.trim() === (selected.portalApplicationId ?? "")}
                        style={{ flexShrink: 0 }}
                      >
                        {appIdSaving ? "Saving…" : "Save"}
                      </button>
                    </div>
                    {appIdMessage && <p style={{ color: "var(--green-text)", fontSize: 11, marginTop: 6 }}>{appIdMessage}</p>}
                    {appIdError && <p style={{ color: "var(--red-text)", fontSize: 11, marginTop: 6 }}>{appIdError}</p>}
                  </div>
                </>
              )}
            </div>

            <div className="card">
              <h2 style={{ marginTop: 0 }}>Change Status</h2>
              <label style={{ display: "block", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted2)", marginBottom: 6 }}>
                Pipeline stage
              </label>
              <select
                value={statusDraft}
                onChange={(e) => setStatusDraft(e.target.value)}
                style={{ width: "100%", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", color: "var(--text)", fontSize: 12, marginBottom: 12 }}
              >
                {stages.map((s) => (
                  <option key={s.code} value={s.code}>
                    {formatStageOption(s.stage_group, s.label)}
                  </option>
                ))}
              </select>
              <button
                className="primary"
                onClick={handleSave}
                disabled={saving || statusDraft === selected.internalStatusCode}
              >
                {saving ? "Saving…" : "Save Status"}
              </button>
              {saveMessage && <p style={{ color: "var(--green-text)", fontSize: 12, marginTop: 10 }}>{saveMessage}</p>}
              {error && <p style={{ color: "var(--red-text)", fontSize: 12, marginTop: 10 }}>{error}</p>}
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <h2 style={{ margin: 0 }}>Compliance</h2>
              <Link href={`/compliance?project=${selected.projectId}`} className="tb-pill">
                Open Compliance Tracker →
              </Link>
            </div>

            {!complianceSummary || complianceSummary.requiredCount === 0 ? (
              <p className="muted" style={{ marginBottom: 0, marginTop: 10 }}>
                No compliance documents apply yet — assign a HOMES or HEAR program track first.
              </p>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 12 }}>
                  <span style={{ fontFamily: "var(--mono)", fontSize: 20, fontWeight: 700 }}>{complianceSummary.percent}%</span>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {complianceSummary.missing} missing · {complianceSummary.rejected} rejected · {complianceSummary.requiredCount} required
                  </span>
                </div>
                <div className={`progress ${progressClass(complianceSummary.percent)}`} style={{ margin: "8px 0 14px" }}>
                  <div style={{ width: `${complianceSummary.percent}%` }} />
                </div>
                {autoDetectedToConfirm.length > 0 && (
                  <p style={{ margin: "0 0 12px", fontSize: 11 }}>
                    ⚡ <b>{autoDetectedToConfirm.length}</b> document{autoDetectedToConfirm.length === 1 ? "" : "s"} auto-pulled
                    from Box ({autoDetectedToConfirm.map((d) => d.label).join(", ")}) — open the Compliance Tracker to confirm.
                  </p>
                )}
                {complianceGaps.length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>All required documents are on file.</p>
                ) : (
                  <>
                    {complianceGaps.slice(0, 6).map(({ doc, status }) => (
                      <div key={doc.code} className="snap-row">
                        <span className="k">
                          {doc.label}
                          <span className="muted" style={{ fontWeight: 400, marginLeft: 6 }}>
                            {formatLifecycleStage(doc.lifecycleStage)}
                          </span>
                        </span>
                        <span className={`pill ${docStatusPillClass(status)}`}>{formatDocStatus(status)}</span>
                      </div>
                    ))}
                    {complianceGaps.length > 6 && (
                      <p className="muted" style={{ margin: "8px 0 0", fontSize: 11 }}>
                        + {complianceGaps.length - 6} more — open the Compliance Tracker to work through them.
                      </p>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          <div className="card danger-zone" style={{ marginTop: 14 }}>
            <h2 style={{ marginTop: 0 }}>Danger Zone</h2>
            <div className="danger-row">
              <div>
                <div className="label">Remove this application</div>
                <div className="sub">
                  Deletes only the {selected.programTrack} application for {selected.homeownerName}. Their contact
                  record and any other program track are unaffected.
                </div>
              </div>
              {confirmRemoveApp ? (
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button className="danger" onClick={handleRemoveApplication} disabled={deleting}>
                    {deleting ? "Removing…" : "Confirm remove"}
                  </button>
                  <button className="ghost" onClick={() => setConfirmRemoveApp(false)} disabled={deleting}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button className="danger-outline" onClick={handleRemoveApplication} style={{ flexShrink: 0 }}>
                  Remove application
                </button>
              )}
            </div>
            <div className="danger-row">
              <div>
                <div className="label">Delete entire lead</div>
                <div className="sub">
                  Deletes {selected.homeownerName}&apos;s full record — every program application, qualification
                  screening, compliance document, and estimate tied to it. Cannot be undone.
                </div>
              </div>
              {confirmDeleteLead ? (
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button className="danger" onClick={handleDeleteLead} disabled={deleting}>
                    {deleting ? "Deleting…" : "Confirm delete everything"}
                  </button>
                  <button className="ghost" onClick={() => setConfirmDeleteLead(false)} disabled={deleting}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button className="danger-outline" onClick={handleDeleteLead} style={{ flexShrink: 0 }}>
                  Delete entire lead
                </button>
              )}
            </div>
            {deleteError && <p style={{ color: "var(--red-text)", fontSize: 12, marginTop: 10 }}>{deleteError}</p>}
          </div>
        </>
      )}
    </div>
  );
}
