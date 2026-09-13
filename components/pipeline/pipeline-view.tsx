"use client";

import { useState } from "react";
import { AddLeadForm } from "./add-lead-form";
import { LeadPipelineBoard } from "./lead-pipeline-board";

export function PipelineView() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div>
      <AddLeadForm onAdded={() => setRefreshKey((k) => k + 1)} />
      <LeadPipelineBoard key={refreshKey} />
    </div>
  );
}
