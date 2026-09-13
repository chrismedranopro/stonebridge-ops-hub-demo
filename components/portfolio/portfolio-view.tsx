"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ComplianceDocStatus, ComplianceDocType, PipelineStage } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { stagePillClass } from "@/lib/pipeline-labels";
import { computeComplianceSummary } from "@/lib/compliance-summary";
import { progressClass } from "@/lib/compliance-labels";

interface Row {
  applicationId: string;
  projectId: string;
  homeownerName: string;
  address: string;
  programTrack: "HOMES" | "HEAR";
  stage: PipelineStage;
  portalStatusCode: string | null;
  portalStatusLabel: string | null;
  portalStatusStale: boolean;
  contractValue: number | null;
  ownerInitials: string | null;
  compliancePercent: number;
  complianceMissing: number;
  complianceRejected: number;
}

type Risk = "critical" | "at_risk" | "on_track";

function riskFor(row: Row): Risk {
  if (row.portalStatusCode === "app_returned" || row.complianceRejected > 0 || row.stage.is_critical_alert) return "critical";
  if (row.portalStatusStale || row.complianceMissing > 0) return "at_risk";
  return "on_track";
}

function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

// Real-data Project Portfolio -- Component 1's "project status visibility
// table" deliverable (phase1-scope.md; ops-hub-demo-map.md #4, Reimbursement
// column dropped per the Phase 1 scope table). One row = one project_applications
// row (one program track), matching the convention already used everywhere
// else in this app (Lead Pipeline board, Command Center) rather than
// collapsing HOMES+HEAR into a single project row.
export function PortfolioView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [stagesRes, appsRes, staffRes, estimatesRes, docTypesRes, pcdRes, allAppsRes] = await Promise.all([
        supabase
          .from("pipeline_stages")
          .select("code, label, stage_group, sort_order, is_critical_alert")
          .order("sort_order"),
        supabase
          .from("project_applications")
          .select(
            "id, project_id, program_track, internal_status_code, portal_status_code, portal_status_stale, portal_statuses(label), projects!inner(homeowner_name, address_line1, address_line2, assigned_owner_id, created_at)"
          )
          .order("created_at", { ascending: false }),
        supabase.from("staff").select("id, initials"),
        supabase
          .from("estimates")
          .select("project_id, program_track, total_project_cost")
          .eq("status", "signed")
          .order("created_at", { ascending: false }),
        supabase
          .from("compliance_doc_types")
          .select("code, label, lifecycle_stage, applies_to_track, required, condition_note, source_citation"),
        supabase
          .from("project_compliance_documents")
          .select("project_id, doc_type_code, status"),
        // Needed to know EVERY program track a project has (compliance % is
        // project-level, not per-application -- see lib/compliance-summary.ts),
        // not just the track on the row being rendered.
        supabase.from("project_applications").select("project_id, program_track"),
      ]);

      if (cancelled) return;

      if (stagesRes.error || appsRes.error || staffRes.error || estimatesRes.error || docTypesRes.error || pcdRes.error || allAppsRes.error) {
        console.error(
          "Portfolio load failed",
          stagesRes.error ?? appsRes.error ?? staffRes.error ?? estimatesRes.error ?? docTypesRes.error ?? pcdRes.error ?? allAppsRes.error
        );
        setError("Could not load portfolio data.");
        setLoading(false);
        return;
      }

      const stageByCode = new Map((stagesRes.data ?? []).map((s) => [s.code, s as PipelineStage]));
      const initialsByStaff = new Map((staffRes.data ?? []).map((s) => [s.id, s.initials]));

      const valueByKey = new Map<string, number>();
      for (const est of estimatesRes.data ?? []) {
        const key = `${est.project_id}_${est.program_track}`;
        if (!valueByKey.has(key) && est.total_project_cost != null) {
          valueByKey.set(key, Number(est.total_project_cost));
        }
      }

      const tracksByProject = new Map<string, string[]>();
      for (const a of allAppsRes.data ?? []) {
        if (!tracksByProject.has(a.project_id)) tracksByProject.set(a.project_id, []);
        tracksByProject.get(a.project_id)!.push(a.program_track);
      }

      const docTypes = (docTypesRes.data ?? []).map((d) => ({
        code: d.code,
        label: d.label,
        lifecycleStage: d.lifecycle_stage,
        appliesToTrack: d.applies_to_track as ComplianceDocType["appliesToTrack"],
        required: d.required,
        conditionNote: d.condition_note,
        sourceCitation: d.source_citation,
      }));

      const statusByProjectDoc = new Map<string, ComplianceDocStatus>();
      for (const r of pcdRes.data ?? []) {
        statusByProjectDoc.set(`${r.project_id}::${r.doc_type_code}`, r.status as ComplianceDocStatus);
      }

      const mapped: Row[] = (appsRes.data ?? []).flatMap((row) => {
        const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
        const stage = stageByCode.get(row.internal_status_code);
        if (!project || !stage) return [];

        const portalStatus = Array.isArray(row.portal_statuses) ? row.portal_statuses[0] : row.portal_statuses;
        const programTracks = tracksByProject.get(row.project_id) ?? [row.program_track];
        const compliance = computeComplianceSummary(
          docTypes,
          programTracks,
          (code) => statusByProjectDoc.get(`${row.project_id}::${code}`) ?? "missing"
        );

        return [
          {
            applicationId: row.id,
            projectId: row.project_id,
            homeownerName: project.homeowner_name,
            address: [project.address_line1, project.address_line2].filter(Boolean).join(", "),
            programTrack: row.program_track,
            stage,
            portalStatusCode: row.portal_status_code,
            portalStatusLabel: portalStatus?.label ?? null,
            portalStatusStale: row.portal_status_stale,
            contractValue: valueByKey.get(`${row.project_id}_${row.program_track}`) ?? null,
            ownerInitials: project.assigned_owner_id ? initialsByStaff.get(project.assigned_owner_id) ?? null : null,
            compliancePercent: compliance.percent,
            complianceMissing: compliance.missing,
            complianceRejected: compliance.rejected,
          },
        ];
      });

      setRows(mapped);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.homeownerName.toLowerCase().includes(q) || r.address.toLowerCase().includes(q));
  }, [rows, search]);

  const stats = useMemo(() => {
    let onTrack = 0;
    let atRisk = 0;
    let critical = 0;
    let totalValue = 0;
    for (const row of rows) {
      const risk = riskFor(row);
      if (risk === "critical") critical += 1;
      else if (risk === "at_risk") atRisk += 1;
      else onTrack += 1;
      totalValue += row.contractValue ?? 0;
    }
    return { onTrack, atRisk, critical, totalValue };
  }, [rows]);

  if (loading) {
    return (
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>Loading portfolio…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <p style={{ color: "var(--red-text)", marginTop: 0 }}>{error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="grid stat-row">
        <div className="card stat-card green">
          <div className="label">On Track</div>
          <div className="value">{stats.onTrack}</div>
          <div className="sub">No open compliance or portal flags</div>
        </div>
        <div className="card stat-card">
          <div className="label">At Risk</div>
          <div className="value">{stats.atRisk}</div>
          <div className="sub">Missing docs or stale portal status</div>
        </div>
        <div className="card stat-card red">
          <div className="label">Critical</div>
          <div className="value">{stats.critical}</div>
          <div className="sub">Rejected docs, portal returned, or on-hold stage</div>
        </div>
        <div className="card stat-card blue">
          <div className="label">Total Value</div>
          <div className="value" style={{ fontSize: 20 }}>{formatCurrency(stats.totalValue)}</div>
          <div className="sub">Signed estimates on file</div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Projects ({filtered.length})</h2>
          <input
            type="text"
            placeholder="Search homeowner or address…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, padding: "7px 10px", color: "var(--text)", fontSize: 12, width: 240 }}
          />
        </div>

        {filtered.length === 0 ? (
          <p className="muted" style={{ marginTop: 0 }}>
            {rows.length === 0 ? "No projects yet — add one from Lead Pipeline first." : "No projects match that search."}
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Program</th>
                <th>Stage</th>
                <th>Portal Status</th>
                <th>Compliance</th>
                <th>Value</th>
                <th>Owner</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const risk = riskFor(row);
                return (
                  <tr key={row.applicationId} style={risk === "critical" ? { borderLeft: "3px solid var(--red)" } : risk === "at_risk" ? { borderLeft: "3px solid var(--amber)" } : undefined}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{row.homeownerName}</div>
                      <div className="muted" style={{ fontSize: 11 }}>{row.address || "No address on file"}</div>
                    </td>
                    <td><span className="pill info">{row.programTrack}</span></td>
                    <td><span className={`pill ${stagePillClass(row.stage)}`}>{row.stage.label}</span></td>
                    <td>
                      {row.portalStatusLabel ? (
                        <span className={`pill ${row.portalStatusStale ? "warning" : "ok"}`}>
                          {row.portalStatusLabel}{row.portalStatusStale ? " (stale)" : ""}
                        </span>
                      ) : (
                        <span className="muted">Not submitted</span>
                      )}
                    </td>
                    <td style={{ minWidth: 130 }}>
                      <span style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700 }}>{row.compliancePercent}%</span>
                      <div className={`progress ${progressClass(row.compliancePercent)}`}>
                        <div style={{ width: `${row.compliancePercent}%` }} />
                      </div>
                    </td>
                    <td style={{ fontFamily: "var(--mono)" }}>{row.contractValue != null ? formatCurrency(row.contractValue) : "—"}</td>
                    <td>
                      {row.ownerInitials ? (
                        <span className="pill info">{row.ownerInitials}</span>
                      ) : (
                        <span className="muted">Unassigned</span>
                      )}
                    </td>
                    <td>
                      <Link href={`/command-center?project=${row.projectId}`} className="tb-pill">
                        Open →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
