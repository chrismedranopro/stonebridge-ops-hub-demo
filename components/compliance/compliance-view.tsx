"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import type { ComplianceDocStatus, ComplianceDocType, ProjectComplianceDoc } from "@/lib/types";
import {
  LIFECYCLE_STAGE_ORDER,
  docStatusPillClass,
  formatDocStatus,
  formatLifecycleStage,
  progressClass,
} from "@/lib/compliance-labels";
import { applicableDocTypes, computeComplianceSummary } from "@/lib/compliance-summary";
import { formatClientDate } from "@/lib/timezone";

interface ProjectRow {
  id: string;
  homeownerName: string;
  address: string;
  programTracks: string[];
}

const STATUSES: ComplianceDocStatus[] = ["missing", "uploaded", "pending_review", "rejected"];
const DEFAULT_DOC_STATE: ProjectComplianceDoc = {
  status: "missing",
  fileUrl: null,
  uploadedAt: null,
  uploadedByStaffId: null,
  notes: null,
  autoDetected: false,
};

function pcdKey(projectId: string, docTypeCode: string): string {
  return `${projectId}::${docTypeCode}`;
}

function trackLabel(track: ComplianceDocType["appliesToTrack"]): string {
  if (track === "both") return "HOMES + HEAR";
  if (track === "conditional") return "Conditional";
  return track;
}

// Real-data Compliance Tracking — Component 3's named Phase 1 deliverable
// (phase1-scope.md / ops-hub-demo-map.md #8). One row = one applicable
// compliance_doc_types entry for a project; "applicable" is derived from the
// project's actual program_track(s) on project_applications, never hardcoded
// per feedback_no_frontend_hardcoding. A doc type with no
// project_compliance_documents row yet reads as its column default
// ("missing") until someone actually sets a status here -- nothing is
// pre-seeded, since real per-project document status is operator-entered
// data this app has no source for yet (see knowledge base's own
// "surfaced for human review, not silently pick a side" pattern for
// 'conditional' doc types, whose condition_note is shown so staff can judge
// applicability rather than the UI guessing).
export function ComplianceView() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const projectParam = searchParams.get("project");

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [docTypes, setDocTypes] = useState<ComplianceDocType[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [pcdMap, setPcdMap] = useState<Map<string, ProjectComplianceDoc>>(new Map());
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [expandedDocCode, setExpandedDocCode] = useState<string | null>(null);
  const [fileUrlDraft, setFileUrlDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [docTypesRes, projectsRes, appsRes, pcdRes, staffRes] = await Promise.all([
        supabase
          .from("compliance_doc_types")
          .select("code, label, lifecycle_stage, applies_to_track, required, condition_note, source_citation"),
        supabase.from("projects").select("id, homeowner_name, address_line1, address_line2").order("homeowner_name"),
        supabase.from("project_applications").select("project_id, program_track"),
        supabase
          .from("project_compliance_documents")
          .select("project_id, doc_type_code, status, file_url, uploaded_at, uploaded_by_staff_id, notes, auto_detected"),
        supabase.from("staff").select("id, full_name"),
      ]);

      if (cancelled) return;

      if (docTypesRes.error || projectsRes.error || appsRes.error || pcdRes.error || staffRes.error) {
        console.error(
          "Compliance load failed",
          docTypesRes.error ?? projectsRes.error ?? appsRes.error ?? pcdRes.error ?? staffRes.error
        );
        setLoadError("Could not load compliance data.");
        setLoading(false);
        return;
      }

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

      const tracksByProject = new Map<string, Set<string>>();
      for (const row of appsRes.data ?? []) {
        if (!tracksByProject.has(row.project_id)) tracksByProject.set(row.project_id, new Set());
        tracksByProject.get(row.project_id)!.add(row.program_track);
      }

      const mappedProjects: ProjectRow[] = (projectsRes.data ?? []).map((p) => ({
        id: p.id,
        homeownerName: p.homeowner_name,
        address: [p.address_line1, p.address_line2].filter(Boolean).join(", "),
        programTracks: Array.from(tracksByProject.get(p.id) ?? []),
      }));
      setProjects(mappedProjects);

      const map = new Map<string, ProjectComplianceDoc>();
      for (const row of pcdRes.data ?? []) {
        map.set(pcdKey(row.project_id, row.doc_type_code), {
          status: row.status as ComplianceDocStatus,
          fileUrl: row.file_url,
          uploadedAt: row.uploaded_at,
          uploadedByStaffId: row.uploaded_by_staff_id,
          notes: row.notes,
          autoDetected: row.auto_detected ?? false,
        });
      }
      setPcdMap(map);

      setStaffNames(Object.fromEntries((staffRes.data ?? []).map((s) => [s.id, s.full_name])));

      const preselect = projectParam && mappedProjects.some((p) => p.id === projectParam) ? projectParam : "";
      setSelectedProjectId(preselect || mappedProjects[0]?.id || "");

      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [projectParam]);

  function docStateFor(projectId: string, docTypeCode: string): ProjectComplianceDoc {
    return pcdMap.get(pcdKey(projectId, docTypeCode)) ?? DEFAULT_DOC_STATE;
  }

  // Per-project compliance summary, computed live from docTypes + pcdMap --
  // shared with the Portfolio table's compliance column (lib/compliance-summary.ts)
  // so the same project never shows two different percentages.
  const projectStats = useMemo(() => {
    return projects.map((project) => {
      const applicable = applicableDocTypes(docTypes, project.programTracks);
      const required = applicable.filter((d) => d.required);
      const summary = computeComplianceSummary(docTypes, project.programTracks, (code) => docStateFor(project.id, code).status);
      return { project, applicable, required, ...summary };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, docTypes, pcdMap]);

  const sortedProjectStats = useMemo(
    () =>
      [...projectStats].sort((a, b) => {
        if (a.rejected !== b.rejected) return b.rejected - a.rejected;
        if (a.missing !== b.missing) return b.missing - a.missing;
        if (a.percent !== b.percent) return a.percent - b.percent;
        return a.project.homeownerName.localeCompare(b.project.homeownerName);
      }),
    [projectStats]
  );

  const overallStats = useMemo(() => {
    const needsAttention = projectStats.filter((p) => p.missing + p.rejected > 0).length;
    const fullyCompliant = projectStats.filter((p) => p.required.length > 0 && p.percent === 100).length;
    const totalMissing = projectStats.reduce((sum, p) => sum + p.missing, 0);
    const totalRejected = projectStats.reduce((sum, p) => sum + p.rejected, 0);
    return { needsAttention, fullyCompliant, totalMissing, totalRejected };
  }, [projectStats]);

  const selected = sortedProjectStats.find((p) => p.project.id === selectedProjectId) ?? null;

  function selectProject(id: string) {
    setSelectedProjectId(id);
    setExpandedDocCode(null);
    setRowError(null);
  }

  function toggleExpand(doc: ComplianceDocType, projectId: string) {
    if (expandedDocCode === doc.code) {
      setExpandedDocCode(null);
      return;
    }
    const state = docStateFor(projectId, doc.code);
    setFileUrlDraft(state.fileUrl ?? "");
    setNotesDraft(state.notes ?? "");
    setExpandedDocCode(doc.code);
    setRowError(null);
  }

  function applyLocalUpdate(projectId: string, docTypeCode: string, patch: Partial<ProjectComplianceDoc>) {
    setPcdMap((prev) => {
      const next = new Map(prev);
      const key = pcdKey(projectId, docTypeCode);
      next.set(key, { ...(next.get(key) ?? DEFAULT_DOC_STATE), ...patch });
      return next;
    });
  }

  async function updateStatus(projectId: string, docTypeCode: string, status: ComplianceDocStatus) {
    const key = pcdKey(projectId, docTypeCode);
    setSavingKey(key);
    setRowError(null);

    const payload: Record<string, unknown> = { project_id: projectId, doc_type_code: docTypeCode, status };
    const stampUpload = status === "uploaded";
    if (stampUpload) {
      payload.uploaded_at = new Date().toISOString();
      payload.uploaded_by_staff_id = user?.id ?? null;
    }

    const { error } = await supabase
      .from("project_compliance_documents")
      .upsert(payload, { onConflict: "project_id,doc_type_code" });

    setSavingKey(null);
    if (error) {
      setRowError(`Couldn't update status: ${error.message}`);
      return;
    }

    applyLocalUpdate(projectId, docTypeCode, {
      status,
      ...(stampUpload ? { uploadedAt: payload.uploaded_at as string, uploadedByStaffId: user?.id ?? null } : {}),
    });
  }

  async function saveField(projectId: string, docTypeCode: string, field: "file_url" | "notes", value: string) {
    const key = `${pcdKey(projectId, docTypeCode)}::${field}`;
    setSavingKey(key);
    setRowError(null);

    const trimmed = value.trim() || null;
    const { error } = await supabase
      .from("project_compliance_documents")
      .upsert({ project_id: projectId, doc_type_code: docTypeCode, [field]: trimmed }, { onConflict: "project_id,doc_type_code" });

    setSavingKey(null);
    if (error) {
      setRowError(`Couldn't save: ${error.message}`);
      return;
    }

    applyLocalUpdate(projectId, docTypeCode, field === "file_url" ? { fileUrl: trimmed } : { notes: trimmed });
  }

  if (loading) {
    return (
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>Loading compliance data…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="card">
        <p style={{ color: "var(--red-text)", marginTop: 0 }}>{loadError}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="grid stat-row">
        <div className={`card stat-card ${overallStats.needsAttention > 0 ? "red" : "green"}`}>
          <div className="label">Compliance Risk</div>
          <div className="value">{overallStats.needsAttention}</div>
          <div className="sub">Projects with a missing/rejected required doc</div>
        </div>
        <div className="card stat-card green">
          <div className="label">Fully Compliant</div>
          <div className="value">{overallStats.fullyCompliant}</div>
          <div className="sub">Of {projects.length} tracked project{projects.length === 1 ? "" : "s"}</div>
        </div>
        <div className="card stat-card">
          <div className="label">Docs Missing</div>
          <div className="value">{overallStats.totalMissing}</div>
          <div className="sub">Required documents not yet on file</div>
        </div>
        <div className="card stat-card red">
          <div className="label">Docs Rejected</div>
          <div className="value">{overallStats.totalRejected}</div>
          <div className="sub">Sent back — needs re-upload</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2 style={{ marginTop: 0 }}>Projects</h2>
        {projects.length === 0 ? (
          <p className="muted" style={{ marginTop: 0 }}>
            No projects yet — add one from Lead Pipeline first.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Program</th>
                <th>Compliance</th>
                <th>Missing</th>
                <th>Rejected</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedProjectStats.map(({ project, percent, missing, rejected }) => (
                <tr
                  key={project.id}
                  className="clickable"
                  onClick={() => selectProject(project.id)}
                  style={project.id === selectedProjectId ? { background: "var(--panel3)" } : undefined}
                >
                  <td>
                    <div style={{ fontWeight: 600 }}>{project.homeownerName}</div>
                    <div className="muted" style={{ fontSize: 11 }}>{project.address || "No address on file"}</div>
                  </td>
                  <td>
                    {project.programTracks.length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      project.programTracks.map((t) => (
                        <span key={t} className="pill info" style={{ marginRight: 4 }}>{t}</span>
                      ))
                    )}
                  </td>
                  <td style={{ minWidth: 140 }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700 }}>{percent}%</span>
                    <div className={`progress ${progressClass(percent)}`}>
                      <div style={{ width: `${percent}%` }} />
                    </div>
                  </td>
                  <td className={missing > 0 ? "doc-missing" : "muted"}>{missing || "—"}</td>
                  <td className={rejected > 0 ? "doc-missing" : "muted"}>{rejected || "—"}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Link href={`/command-center?project=${project.id}`} className="tb-pill">
                      Command Center →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
            <div>
              <h2 style={{ marginTop: 0, marginBottom: 2 }}>{selected.project.homeownerName}</h2>
              <div className="muted" style={{ fontSize: 11 }}>{selected.project.address || "No address on file"}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="muted" style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>
                Compliance
              </div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 22, fontWeight: 700, marginTop: 2 }}>{selected.percent}%</div>
            </div>
          </div>
          <div className={`progress ${progressClass(selected.percent)}`} style={{ marginBottom: 16 }}>
            <div style={{ width: `${selected.percent}%` }} />
          </div>

          {rowError && <p style={{ color: "var(--red-text)", fontSize: 12, marginBottom: 10 }}>{rowError}</p>}

          {selected.applicable.length === 0 ? (
            <p className="muted">
              No compliance document types apply yet — assign a HOMES or HEAR program track on Lead Pipeline first.
            </p>
          ) : (
            LIFECYCLE_STAGE_ORDER.filter((stage) => selected.applicable.some((d) => d.lifecycleStage === stage)).map(
              (stage) => (
                <div key={stage} style={{ marginBottom: 18 }}>
                  <h3 style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--muted2)", marginBottom: 8 }}>
                    {formatLifecycleStage(stage)}
                  </h3>
                  <table style={{ tableLayout: "fixed", width: "100%" }}>
                    <colgroup>
                      <col style={{ width: "48%" }} />
                      <col style={{ width: "16%" }} />
                      <col style={{ width: "16%" }} />
                      <col style={{ width: "20%" }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Document</th>
                        <th>Applies To</th>
                        <th>Status</th>
                        <th>Uploaded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.applicable
                        .filter((d) => d.lifecycleStage === stage)
                        .map((doc) => {
                          const state = docStateFor(selected.project.id, doc.code);
                          const key = pcdKey(selected.project.id, doc.code);
                          const isExpanded = expandedDocCode === doc.code;
                          return (
                            <Fragment key={doc.code}>
                              <tr
                                className="clickable"
                                onClick={() => toggleExpand(doc, selected.project.id)}
                              >
                                <td>
                                  <div style={{ fontWeight: 600 }}>
                                    {doc.label}
                                    {!doc.required && <span className="muted" style={{ fontWeight: 400 }}> (optional)</span>}
                                    {state.autoDetected && (
                                      <span
                                        className="pill info"
                                        style={{ marginLeft: 6, fontSize: 9, verticalAlign: "middle" }}
                                        title="Pulled automatically from the Box Fieldwire folder — open the file and confirm it's correct, then set Uploaded."
                                      >
                                        ⚡ From Box
                                      </span>
                                    )}
                                  </div>
                                  {doc.conditionNote && (
                                    <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{doc.conditionNote}</div>
                                  )}
                                </td>
                                <td>
                                  <span className={`pill ${doc.appliesToTrack === "conditional" ? "warning" : "info"}`}>
                                    {trackLabel(doc.appliesToTrack)}
                                  </span>
                                </td>
                                <td onClick={(e) => e.stopPropagation()}>
                                  <select
                                    className={`pill pill-select ${docStatusPillClass(state.status)}`}
                                    value={state.status}
                                    disabled={savingKey === key}
                                    onChange={(e) =>
                                      updateStatus(selected.project.id, doc.code, e.target.value as ComplianceDocStatus)
                                    }
                                  >
                                    {STATUSES.map((s) => (
                                      <option key={s} value={s}>{formatDocStatus(s)}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="muted" style={{ fontSize: 11 }}>
                                  {state.uploadedAt
                                    ? `${formatClientDate(state.uploadedAt, { month: "short", day: "numeric" })} · ${
                                        state.uploadedByStaffId ? staffNames[state.uploadedByStaffId] ?? "Unknown" : "Unknown"
                                      }`
                                    : "—"}
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr key={`${doc.code}-detail`}>
                                  <td colSpan={4} style={{ background: "var(--panel3)" }}>
                                    {state.autoDetected && state.status === "pending_review" && (
                                      <p style={{ margin: "0 0 12px", fontSize: 11 }}>
                                        ⚡ <b>Auto-detected from the Box Fieldwire folder.</b> Open the file below to
                                        check it&apos;s the right document, then set the status to <b>Uploaded</b> (or
                                        Rejected if it&apos;s wrong).
                                      </p>
                                    )}
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                                      <div>
                                        <label style={{ display: "block", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted2)", marginBottom: 6 }}>
                                          File Link (Box)
                                        </label>
                                        <div style={{ display: "flex", gap: 8 }}>
                                          <input
                                            type="text"
                                            value={fileUrlDraft}
                                            onChange={(e) => setFileUrlDraft(e.target.value)}
                                            placeholder="https://app.box.com/..."
                                            style={{ flex: 1, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", color: "var(--text)", fontSize: 12, fontFamily: "var(--mono)" }}
                                          />
                                          <button
                                            className="ghost"
                                            style={{ flexShrink: 0 }}
                                            disabled={savingKey === `${key}::file_url` || fileUrlDraft.trim() === (state.fileUrl ?? "")}
                                            onClick={() => saveField(selected.project.id, doc.code, "file_url", fileUrlDraft)}
                                          >
                                            {savingKey === `${key}::file_url` ? "Saving…" : "Save"}
                                          </button>
                                        </div>
                                        {state.fileUrl && (
                                          <a href={state.fileUrl} target="_blank" rel="noopener noreferrer" className="muted" style={{ fontSize: 11, display: "inline-block", marginTop: 6 }}>
                                            Open current file ↗
                                          </a>
                                        )}
                                      </div>
                                      <div>
                                        <label style={{ display: "block", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted2)", marginBottom: 6 }}>
                                          Notes
                                        </label>
                                        <div style={{ display: "flex", gap: 8 }}>
                                          <textarea
                                            value={notesDraft}
                                            onChange={(e) => setNotesDraft(e.target.value)}
                                            rows={2}
                                            style={{ flex: 1, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", color: "var(--text)", fontSize: 12, fontFamily: "var(--sans)", resize: "vertical" }}
                                          />
                                          <button
                                            className="ghost"
                                            style={{ flexShrink: 0, alignSelf: "flex-start" }}
                                            disabled={savingKey === `${key}::notes` || notesDraft.trim() === (state.notes ?? "")}
                                            onClick={() => saveField(selected.project.id, doc.code, "notes", notesDraft)}
                                          >
                                            {savingKey === `${key}::notes` ? "Saving…" : "Save"}
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                    {doc.sourceCitation && (
                                      <div className="muted" style={{ fontSize: 10, marginTop: 10 }}>Source: {doc.sourceCitation}</div>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )
            )
          )}
        </div>
      )}
    </div>
  );
}
