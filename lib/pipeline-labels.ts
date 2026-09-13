import type { PipelineStage } from "./types";

// Display names diverge from the derived title only where the client's own SOP
// vocabulary differs from the DB's stage_group code (see
// knowledge/lead-pipeline-status.md). Every other group's derived title matches.
const GROUP_LABEL_OVERRIDES: Record<string, string> = {
  terminal: "Archive",
  pre_construction: "Pre-Construction",
  submission: "Application Submission",
};

export function formatGroupLabel(group: string): string {
  if (GROUP_LABEL_OVERRIDES[group]) return GROUP_LABEL_OVERRIDES[group];
  return group
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

// Group order comes from pipeline_stages.sort_order, not a hardcoded list, so a
// group added/reordered in the DB shows up correctly without a code change.
export function deriveGroupOrder(stages: PipelineStage[]): string[] {
  const order: string[] = [];
  for (const s of stages) {
    if (!order.includes(s.stage_group)) order.push(s.stage_group);
  }
  return order;
}

// "Group — Stage" for a dropdown/select option, without the awkward repeat when
// a stage's own label already equals its group's display label (e.g. the
// 'estimating' stage, label "Estimating", in the "Estimating" group).
export function formatStageOption(group: string, label: string): string {
  const groupLabel = formatGroupLabel(group);
  return groupLabel === label ? label : `${groupLabel} — ${label}`;
}

export function stagePillClass(stage: Pick<PipelineStage, "code" | "is_critical_alert">): "critical" | "warning" | "ok" {
  if (stage.is_critical_alert) return "critical";
  if (stage.code === "on_hold_pre_weatherization") return "warning";
  return "ok";
}
