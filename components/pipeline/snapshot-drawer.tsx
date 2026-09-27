"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatClientDate } from "@/lib/timezone";
import type { PipelineCard } from "@/lib/types";

// AMI tier caps per the ESRP program requirements; the intake SOP requires
// this at intake.
const AMI_TIER_LABELS: Record<string, string> = {
  tier_1: "Tier 1 (<80% AMI — 100% covered)",
  tier_2: "Tier 2 (80–150% AMI — ~50% covered)",
  unknown: "Unknown",
};

function formatDateAdded(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  const formatted = formatClientDate(iso, { month: "short", day: "numeric", year: "numeric" });
  return `${formatted} (${days}d ago)`;
}

interface SnapshotDetail {
  address: string;
  createdAt: string;
  amiTier: string;
  fieldAppLabelCode: string | null;
  fieldAppLabel: string | null;
  portalStatusCode: string | null;
  portalStatusLabel: string | null;
  portalStatusStale: boolean;
  portalPresenceStatus: "yes" | "no" | "unknown";
  docsUploaded: number;
  docsApplicable: number;
  /** True when the compliance counts could not be loaded (shown as unavailable, not as 0%). */
  docsUnavailable: boolean;
  trackerId: string | null;
}

interface FieldAppLabelOption {
  code: string;
  label: string;
  mapped_pipeline_stage_code: string | null;
}

interface PortalStatusOption {
  code: string;
  label: string;
  category: string;
}

function statusTone(code: string | null | undefined): "critical" | "warning" | "ok" | "info" {
  if (!code) return "info";
  if (/returned|rejected|declined|cancelled|stopped|on_hold/.test(code)) return "critical";
  if (/pending|wait|assessment|review|standby/.test(code)) return "warning";
  if (/approved|awarded|completed|paid|ongoing|active_installation/.test(code)) return "ok";
  return "info";
}

export function SnapshotDrawer({
  card,
  onClose,
}: {
  card: PipelineCard | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<SnapshotDetail | null>(null);
  const [fieldAppLabels, setFieldAppLabels] = useState<FieldAppLabelOption[]>([]);
  const [fieldAppLabelCode, setFieldAppLabelCode] = useState("");
  const [savingFieldAppLabel, setSavingFieldAppLabel] = useState(false);
  const [fieldAppError, setFieldAppError] = useState<string | null>(null);
  const [portalStatuses, setPortalStatuses] = useState<PortalStatusOption[]>([]);
  const [portalStatusCode, setPortalStatusCode] = useState("");
  const [savingPortalStatus, setSavingPortalStatus] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!card) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setDetail(null);

      const [projectRes, appRes, docTypesRes, fieldAppLabelsRes, portalStatusesRes] = await Promise.all([
        supabase
          .from("projects")
          .select("ami_tier, created_at, field_app_label_code, field_app_labels(label)")
          .eq("id", card!.projectId)
          .single(),
        supabase
          .from("project_applications")
          .select("portal_presence_status, portal_status_code, portal_status_stale, tracker_id, portal_statuses(label)")
          .eq("id", card!.applicationId)
          .single(),
        // Applicable checklist = required doc types for this program track
        // or 'both'. 'conditional' types (Manual J, combustion safety test)
        // are excluded -- their applicability depends on scope data
        // (heat pump/furnace/boiler in scope, etc.) that isn't modeled yet,
        // so counting them here would misrepresent every project as behind
        // on docs that may not even apply to it.
        supabase
          .from("compliance_doc_types")
          .select("code")
          .eq("required", true)
          .in("applies_to_track", [card!.programTrack, "both"]),
        supabase
          .from("field_app_labels")
          .select("code, label, mapped_pipeline_stage_code")
          .order("label"),
        supabase
          .from("portal_statuses")
          .select("code, label, category")
          .order("category")
          .order("label"),
      ]);

      if (cancelled) return;

      const project = projectRes.data;
      const app = appRes.data;
      const applicableCodes = (docTypesRes.data ?? []).map((d) => d.code);

      let docsUploaded = 0;
      let docsUnavailable = Boolean(docTypesRes.error);
      if (applicableCodes.length > 0) {
        const { count, error: countError } = await supabase
          .from("project_compliance_documents")
          .select("id", { count: "exact", head: true })
          .eq("project_id", card!.projectId)
          .eq("status", "uploaded")
          .in("doc_type_code", applicableCodes);
        if (cancelled) return;
        docsUploaded = count ?? 0;
        if (countError) docsUnavailable = true;
      }

      const fwLabel = Array.isArray(project?.field_app_labels)
        ? project?.field_app_labels[0]
        : project?.field_app_labels;
      const portalStatus = Array.isArray(app?.portal_statuses)
        ? app?.portal_statuses[0]
        : app?.portal_statuses;

      const nextFieldAppLabelCode = project?.field_app_label_code ?? "";
      const nextPortalStatusCode = app?.portal_status_code ?? "";
      setFieldAppLabels(fieldAppLabelsRes.data ?? []);
      setFieldAppLabelCode(nextFieldAppLabelCode);
      setFieldAppError(fieldAppLabelsRes.error?.message ?? projectRes.error?.message ?? null);
      setPortalStatuses(portalStatusesRes.data ?? []);
      setPortalStatusCode(nextPortalStatusCode);
      setPortalError(portalStatusesRes.error?.message ?? appRes.error?.message ?? null);
      setDetail({
        address: card!.address,
        createdAt: project?.created_at ?? card!.createdAt,
        amiTier: project?.ami_tier ?? "unknown",
        fieldAppLabelCode: nextFieldAppLabelCode || null,
        fieldAppLabel: fwLabel?.label ?? null,
        portalStatusCode: nextPortalStatusCode || null,
        portalStatusLabel: portalStatus?.label ?? null,
        portalStatusStale: app?.portal_status_stale ?? false,
        portalPresenceStatus: app?.portal_presence_status ?? "unknown",
        docsUploaded,
        docsApplicable: applicableCodes.length,
        docsUnavailable,
        trackerId: app?.tracker_id ?? null,
      });
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [card]);

  const open = card !== null;
  const pct = detail && detail.docsApplicable > 0
    ? Math.round((100 * detail.docsUploaded) / detail.docsApplicable)
    : 0;

  async function saveFieldAppLabel() {
    if (!card || !detail) return;
    setSavingFieldAppLabel(true);
    setFieldAppError(null);
    const nextCode = fieldAppLabelCode || null;
    const { error: updateError } = await supabase
      .from("projects")
      .update({ field_app_label_code: nextCode, updated_at: new Date().toISOString() })
      .eq("id", card.projectId);

    if (updateError) {
      setFieldAppError(updateError.message);
    } else {
      setDetail({
        ...detail,
        fieldAppLabelCode: nextCode,
        fieldAppLabel: fieldAppLabels.find((label) => label.code === nextCode)?.label ?? null,
      });
    }
    setSavingFieldAppLabel(false);
  }

  async function savePortalStatus() {
    if (!card || !detail) return;
    setSavingPortalStatus(true);
    setPortalError(null);
    const nextCode = portalStatusCode || null;
    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("project_applications")
      .update({
        portal_status_code: nextCode,
        portal_status_updated_at: nextCode ? now : null,
        portal_status_stale: false,
        updated_at: now,
      })
      .eq("id", card.applicationId);

    if (updateError) {
      setPortalError(updateError.message);
    } else {
      setDetail({
        ...detail,
        portalStatusCode: nextCode,
        portalStatusLabel: portalStatuses.find((status) => status.code === nextCode)?.label ?? null,
        portalStatusStale: false,
        portalPresenceStatus: nextCode ? "yes" : detail.portalPresenceStatus,
      });
    }
    setSavingPortalStatus(false);
  }

  const selectedFieldAppLabel = fieldAppLabels.find((label) => label.code === fieldAppLabelCode);

  return (
    <>
      <div className={`drawer-overlay${open ? " open" : ""}`} onClick={onClose} />
      <div className={`drawer${open ? " open" : ""}`}>
        <div className="drawer-head">
          <div style={{ color: "var(--muted)", fontWeight: 600 }}>{card?.homeownerName ?? "—"}</div>
          <button className="alert-dismiss" onClick={onClose}>×</button>
        </div>
        {card && (loading || !detail) ? (
          <p className="muted" style={{ marginTop: 0 }}>Loading…</p>
        ) : card && detail ? (
          <>
            <div className="snap-row">
              <span className="k">Tracker ID</span>
              <span>{detail.trackerId || "Not assigned yet"}</span>
            </div>
            <div className="snap-row">
              <span className="k">Address</span>
              <span>{detail.address || "No address on file"}</span>
            </div>
            <div className="snap-row">
              <span className="k">Date added</span>
              <span>{formatDateAdded(detail.createdAt)}</span>
            </div>
            <div className="snap-row">
              <span className="k">Program</span>
              <span>{card.programTrack}</span>
            </div>
            <div className="snap-row">
              <span className="k">AMI tier</span>
              <span>{AMI_TIER_LABELS[detail.amiTier] ?? detail.amiTier}</span>
            </div>
            <div className="snap-row">
              <span className="k">Internal stage</span>
              <span>{card.stage.label}</span>
            </div>
            <div className="snap-row">
              <span className="k">Field app label</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <select
                  className={`pill pill-select status-mirror-select ${statusTone(selectedFieldAppLabel?.mapped_pipeline_stage_code)}`}
                  value={fieldAppLabelCode}
                  disabled={savingFieldAppLabel}
                  onChange={(event) => setFieldAppLabelCode(event.target.value)}
                  aria-label="Field-app construction label"
                  title="Manually mirror the combined field-app project's construction status"
                >
                  <option value="">Not set</option>
                  {fieldAppLabels.map((label) => (
                    <option key={label.code} value={label.code}>{label.label}</option>
                  ))}
                </select>
                <button
                  className="pill info"
                  disabled={savingFieldAppLabel || fieldAppLabelCode === (detail.fieldAppLabelCode ?? "")}
                  onClick={saveFieldAppLabel}
                >
                  {savingFieldAppLabel ? "Saving..." : "Save"}
                </button>
              </span>
            </div>
            {fieldAppError && <p style={{ color: "var(--red-text)", fontSize: 11 }}>{fieldAppError}</p>}
            <div className="snap-row">
              <span className="k">In Portal?</span>
              <span className={`pill ${detail.portalPresenceStatus === "yes" ? "ok" : detail.portalPresenceStatus === "no" ? "warning" : "info"}`}>
                {detail.portalPresenceStatus === "yes" ? "Yes" : detail.portalPresenceStatus === "no" ? "No" : "Not confirmed"}
              </span>
            </div>
            <div className="snap-row">
              <span className="k">Portal application status</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <select
                  className={`pill pill-select status-mirror-select ${statusTone(portalStatusCode)}`}
                  value={portalStatusCode}
                  disabled={savingPortalStatus}
                  onChange={(event) => setPortalStatusCode(event.target.value)}
                  aria-label="Portal application status mirror"
                  title="Mirror the latest status shown in the SERO portal; notification emails may update it automatically"
                >
                  <option value="">Not submitted yet</option>
                  {portalStatuses.map((status) => (
                    <option key={status.code} value={status.code}>{status.label}</option>
                  ))}
                </select>
                <button
                  className="pill info"
                  disabled={savingPortalStatus || portalStatusCode === (detail.portalStatusCode ?? "")}
                  onClick={savePortalStatus}
                >
                  {savingPortalStatus ? "Saving..." : "Save"}
                </button>
              </span>
            </div>
            {portalError && <p style={{ color: "var(--red-text)", fontSize: 11 }}>{portalError}</p>}
            {portalStatusCode.startsWith("assessment_") && (
              <p className="muted" style={{ margin: "4px 0 8px", fontSize: 10, lineHeight: 1.5 }}>
                SOP mapping: keep the internal stage at Pre-Qualification Pending. Do not schedule a Stonebridge site visit until the HOMES audit is on file.
              </p>
            )}
            <div className="snap-row">
              <span className="k">Portal check freshness</span>
              <span>
                {detail.portalPresenceStatus !== "yes"
                  ? "N/A — not in portal yet"
                  : detail.portalStatusStale
                    ? "⚠ Stale — no email update in 48h"
                    : "Up to date"}
              </span>
            </div>
            <div className="snap-row">
              <span className="k">Compliance</span>
              <span>
                {detail.docsUnavailable
                  ? "Could not load compliance status"
                  : detail.docsApplicable > 0
                    ? `${pct}% (${detail.docsUploaded}/${detail.docsApplicable} docs)`
                    : "No applicable doc types on file"}
              </span>
            </div>
          </>
        ) : null}
        {card && (
          <button
            className="primary"
            style={{ width: "100%", marginTop: 14 }}
            onClick={() => router.push(`/command-center?project=${card.projectId}`)}
          >
            View full Command Center →
          </button>
        )}
      </div>
    </>
  );
}
