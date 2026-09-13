"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { supabase } from "@/lib/supabase";
import type { PipelineCard, PipelineStage } from "@/lib/types";
import { deriveGroupOrder, formatGroupLabel, stagePillClass } from "@/lib/pipeline-labels";
import { BlurFade } from "@/components/ui/blur-fade";
import { MagicCard } from "@/components/ui/magic-card";
import { SnapshotDrawer } from "./snapshot-drawer";

function daysAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// One card's clickable/draggable body. Opening the snapshot (click) and
// dragging share the same element -- PointerSensor's activation distance
// (see sensors below) is what tells a plain click apart from a drag, so both
// work on one card without a separate drag handle.
function KanbanCard({
  card,
  allStages,
  onStageChange,
  onOpen,
}: {
  card: PipelineCard;
  allStages: PipelineStage[];
  onStageChange: (applicationId: string, code: string) => void;
  onOpen: (card: PipelineCard) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.applicationId,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`kcard-content${isDragging ? " dragging" : ""}`}
      role="button"
      tabIndex={0}
      title={`${card.homeownerName} — ${card.address || "No address on file"}`}
      onClick={() => onOpen(card)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(card);
      }}
    >
      <div className="name">{card.homeownerName}</div>
      <div className="addr">{card.address || "No address on file"}</div>
      <div
        className="tags"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="pill info">{card.programTrack}</span>
        <select
          className={`pill pill-select ${stagePillClass(card.stage)}`}
          value={card.stage.code}
          onChange={(e) => onStageChange(card.applicationId, e.target.value)}
          title={`${card.stage.label} — click to move to a specific stage`}
        >
          {allStages.map((s) => (
            <option key={s.code} value={s.code}>
              {s.label}
            </option>
          ))}
        </select>
        {card.portalStatusStale && <span className="pill warning">Portal stale</span>}
      </div>
      <div className="added">Added {daysAgo(card.createdAt)}</div>
    </div>
  );
}

function KanbanColumn({
  group,
  label,
  cards,
  allStages,
  onStageChange,
  onOpen,
}: {
  group: string;
  label: string;
  cards: PipelineCard[];
  allStages: PipelineStage[];
  onStageChange: (applicationId: string, code: string) => void;
  onOpen: (card: PipelineCard) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: group });

  return (
    <div className="kcol">
      <h3>
        {label} <span>{cards.length}</span>
      </h3>
      <div ref={setNodeRef} className={`kcol-cards${isOver ? " kcol-over" : ""}`}>
        {cards.length === 0 ? (
          <p className="muted" style={{ fontSize: "11px" }}>
            {isOver ? "Drop to move here" : "—"}
          </p>
        ) : (
          cards.map((card, i) => (
            <BlurFade key={card.applicationId} delay={i * 0.03} offset={4} duration={0.3} inView>
              <MagicCard
                className="kcard-shell rounded-[6px] border-border"
                gradientFrom="var(--accent)"
                gradientTo="var(--accent2)"
                gradientColor="var(--panel3)"
                gradientOpacity={0.5}
              >
                <KanbanCard card={card} allStages={allStages} onStageChange={onStageChange} onOpen={onOpen} />
              </MagicCard>
            </BlurFade>
          ))
        )}
      </div>
    </div>
  );
}

// Real-data Lead Pipeline board — Component 2's "Lead Pipeline" deliverable
// (phase1-scope.md). Columns are the pipeline_stages.stage_group values,
// pulled from Supabase rather than hardcoded, so a group added/renamed in the
// DB shows up here without a code change (see feedback_no_frontend_hardcoding).
//
// Two ways to move a lead: drag a card into a different column (lands on that
// group's earliest stage — most groups are one stage anyway; see
// db/seed_pipeline_stages.sql for which ones aren't), or use the stage pill's
// dropdown for an exact stage within or across groups.
export function LeadPipelineBoard() {
  const [loading, setLoading] = useState(true);
  const [groupOrder, setGroupOrder] = useState<string[]>([]);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [cards, setCards] = useState<PipelineCard[]>([]);
  const [activeCard, setActiveCard] = useState<PipelineCard | null>(null);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const snapshotCard = cards.find((c) => c.applicationId === snapshotId) ?? null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [stagesRes, appsRes] = await Promise.all([
        supabase
          .from("pipeline_stages")
          .select("code, label, stage_group, sort_order, is_critical_alert")
          .order("sort_order"),
        supabase
          .from("project_applications")
          .select(
            "id, project_id, program_track, internal_status_code, portal_status_stale, projects!inner(display_id, homeowner_name, address_line1, address_line2, created_at)"
          ),
      ]);

      if (cancelled) return;

      if (stagesRes.error || appsRes.error) {
        console.error("Lead Pipeline load failed", stagesRes.error ?? appsRes.error);
        setLoading(false);
        return;
      }

      const loadedStages = (stagesRes.data ?? []) as PipelineStage[];
      const stageByCode = new Map(loadedStages.map((s) => [s.code, s]));
      setStages(loadedStages);
      setGroupOrder(deriveGroupOrder(loadedStages));

      const mapped: PipelineCard[] = (appsRes.data ?? []).flatMap((row) => {
        const stage = stageByCode.get(row.internal_status_code);
        const project = Array.isArray(row.projects) ? row.projects[0] : row.projects;
        if (!stage || !project) return [];
        return [
          {
            applicationId: row.id,
            projectId: row.project_id,
            displayId: project.display_id,
            homeownerName: project.homeowner_name,
            address: [project.address_line1, project.address_line2].filter(Boolean).join(", "),
            programTrack: row.program_track,
            stage,
            portalStatusStale: row.portal_status_stale,
            createdAt: project.created_at,
          },
        ];
      });

      setCards(mapped);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const allStagesSorted = useMemo(
    () => [...stages].sort((a, b) => a.sort_order - b.sort_order),
    [stages]
  );

  const columns = useMemo(() => {
    const byGroup = new Map<string, PipelineCard[]>();
    for (const card of cards) {
      const g = card.stage.stage_group;
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(card);
    }
    return groupOrder.map((g) => ({
      group: g,
      label: formatGroupLabel(g),
      cards: (byGroup.get(g) ?? []).sort((a, b) => a.stage.sort_order - b.stage.sort_order),
    }));
  }, [groupOrder, cards]);

  async function updateStage(applicationId: string, code: string) {
    const newStage = stages.find((s) => s.code === code);
    const prevCards = cards;
    if (!newStage) return;

    setError(null);
    setCards((prev) =>
      prev.map((c) => (c.applicationId === applicationId ? { ...c, stage: newStage } : c))
    );

    const { error: updateError } = await supabase
      .from("project_applications")
      .update({ internal_status_code: code, updated_at: new Date().toISOString() })
      .eq("id", applicationId);

    if (updateError) {
      console.error("Stage update failed", updateError);
      setError(`Couldn't move that lead: ${updateError.message}`);
      setCards(prevCards);
    }
  }

  function handleDragStart(event: DragStartEvent) {
    const card = cards.find((c) => c.applicationId === String(event.active.id));
    setActiveCard(card ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    const { active, over } = event;
    if (!over) return;

    const targetGroup = String(over.id);
    const card = cards.find((c) => c.applicationId === String(active.id));
    if (!card || card.stage.stage_group === targetGroup) return;

    const groupStages = allStagesSorted.filter((s) => s.stage_group === targetGroup);
    const targetStage = groupStages[0];
    if (!targetStage) return;

    updateStage(card.applicationId, targetStage.code);
  }

  if (loading) {
    return (
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>Loading pipeline…</p>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {error && (
        <p style={{ color: "var(--red-text)", fontSize: 12, marginBottom: 8 }}>{error}</p>
      )}
      <div className="kanban">
        {columns.map(({ group, label, cards: colCards }) => (
          <KanbanColumn
            key={group}
            group={group}
            label={label}
            cards={colCards}
            allStages={allStagesSorted}
            onStageChange={updateStage}
            onOpen={(card) => setSnapshotId(card.applicationId)}
          />
        ))}
      </div>
      <DragOverlay>
        {activeCard ? (
          <div className="kcard-content kcard-overlay">
            <div className="name">{activeCard.homeownerName}</div>
            <div className="addr">{activeCard.address || "No address on file"}</div>
          </div>
        ) : null}
      </DragOverlay>
      <SnapshotDrawer card={snapshotCard} onClose={() => setSnapshotId(null)} />
    </DndContext>
  );
}
