import { PipelineView } from "@/components/pipeline/pipeline-view";

export default function PipelinePage() {
  return (
    <div>
      <p className="muted">
        Cards are grouped by stage. Each card represents one HOMES or HEAR application. A
        homeowner who applied to both programs will have two cards so staff can track each
        application separately. Select a card to open its Command Center.
      </p>
      <PipelineView />
    </div>
  );
}
