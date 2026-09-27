"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { fetchAttentionItems, type AttentionItem } from "@/lib/attention-items";

interface Stats {
  activeJobs: number;
  complianceRisk: number;
  newLeads: number;
}

// Executive dashboard. Same view for every signed-in user; no role branching yet
// (see the staff.access_level column comment in the baseline migration).
export function ExecutiveDashboard() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats>({ activeJobs: 0, complianceRisk: 0, newLeads: 0 });
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [failedSources, setFailedSources] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [activeRes, complianceCountRes, newLeadsRes, attentionItems] = await Promise.all([
        supabase
          .from("project_applications")
          .select("project_id, pipeline_stages!inner(stage_group)")
          .eq("pipeline_stages.stage_group", "construction"),
        supabase
          .from("project_compliance_documents")
          .select("project_id, compliance_doc_types!inner(required)")
          .in("status", ["missing", "rejected"])
          .eq("compliance_doc_types.required", true),
        supabase
          .from("projects")
          .select("id", { count: "exact", head: true })
          .gte("created_at", sevenDaysAgo),
        fetchAttentionItems({ limitPerCategory: 5 }),
      ]);

      if (cancelled) return;

      const failed = [...attentionItems.failedSources];
      if (activeRes.error) failed.push("Active jobs");
      if (complianceCountRes.error) failed.push("Compliance risk");
      if (newLeadsRes.error) failed.push("New leads");

      const activeJobs = new Set((activeRes.data ?? []).map((r) => r.project_id)).size;
      const complianceRisk = new Set((complianceCountRes.data ?? []).map((r) => r.project_id)).size;

      setStats({
        activeJobs,
        complianceRisk,
        newLeads: newLeadsRes.count ?? 0,
      });

      setAttention(attentionItems.items);
      setFailedSources(failed);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>Loading dashboard…</p>
      </div>
    );
  }

  return (
    <div>
      {failedSources.length > 0 && (
        <div className="card" role="alert" style={{ borderColor: "var(--red)", marginBottom: 14 }}>
          <p style={{ margin: 0 }}>
            <b>Some items could not be loaded</b> ({failedSources.join(", ")}). Figures below may be incomplete; refresh to try again.
          </p>
        </div>
      )}
      <div className="grid stat-row">
        <div className="card stat-card blue">
          <div className="label">Active Jobs</div>
          <div className="value">{stats.activeJobs}</div>
          <div className="sub">Across HOMES + HEAR</div>
        </div>
        <div className={`card stat-card ${stats.complianceRisk > 0 ? "red" : "green"}`}>
          <div className="label">Compliance Risk</div>
          <div className="value">{stats.complianceRisk}</div>
          <div className="sub">Projects with a missing/rejected required doc</div>
        </div>
        <div className="card stat-card">
          <div className="label">New Leads</div>
          <div className="value">{stats.newLeads}</div>
          <div className="sub">Last 7 days</div>
        </div>
      </div>
      {/* Revenue / Gross Profit stat cards intentionally omitted — no backing table
          exists yet (financial operations are out of scope for this demo). */}

      <section>
        <h2>Requires Attention</h2>
        {attention.length === 0 ? (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              {failedSources.length ? "Could not confirm the attention queue. See the warning above." : "Nothing needs attention right now."}
            </p>
          </div>
        ) : (
          attention.map((item) => {
            const body = (
              <>
                <span className={`pill ${item.severity}`}>{item.severity}</span>
                <div className="msg">
                  <b>{item.title}</b>
                  <span>{item.detail}</span>
                </div>
              </>
            );
            return item.href ? (
              <Link key={item.id} href={item.href} className={`alert-row ${item.severity}`} style={{ textDecoration: "none", color: "inherit" }}>
                {body}
              </Link>
            ) : (
              <div key={item.id} className={`alert-row ${item.severity}`}>
                {body}
              </div>
            );
          })
        )}
      </section>

    </div>
  );
}
