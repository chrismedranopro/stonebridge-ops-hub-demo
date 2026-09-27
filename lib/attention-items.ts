import { supabase } from "./supabase";
import { visibleEmailMessage } from "./email-message";
import { programPortalUrl } from "./program-portal";
import { DbError, PartialLoad, expectRowsChanged } from "./db";

export interface AttentionItem {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  source:
    | "compliance"
    | "portal_returned"
    | "portal_stale"
    | "service_area_review"
    | "new_lead_intake"
    | "mailbox_triage"
    | "portal_unmatched"
    | "box_sign_ready";
  mailboxTriageId?: string;
  /** project_applications.id for a "new_lead_intake" item — drives the Mark Intake Sent action. */
  intakeApplicationIds?: string[];
  /** portal_status_events.id rows a "portal_unmatched" card covers — drives Mark Reviewed. */
  portalEventIds?: string[];
  /** Direct link into the ESRP portal's own application record, when a portal_application_id is on file. */
  portalUrl?: string;
  /** Box Sign prepare_url for a "box_sign_ready" item — staff opens this and clicks Send to actually reach the homeowner. Clears itself once the Box Sign Completion Watcher marks the job signed/declined. */
  boxSignUrl?: string;
  /** Direct Outlook Web link for the source email, supplied by Microsoft Graph. */
  outlookWebUrl?: string;
  /** In-app destination for this item — Command Center for a specific project, Action Center for items whose action lives there. */
  href?: string;
  /** Extra context shown when a row is expanded — not every source populates these. */
  fromAddress?: string;
  bodySnippet?: string;
  receivedAt?: string;
  emailSubject?: string;
  applicationId?: string;
  programTrack?: string;
  staffAction?: string;
  clearanceRule?: string;
  /** Plain-language summary of what the notification means (portal cards) — shown instead of the raw body. */
  summary?: string;
}

export interface AttentionResult {
  items: AttentionItem[];
  /** Sections that failed to load. Non-empty means the list is INCOMPLETE -- never show it as "all clear". */
  failedSources: string[];
}

interface FetchOptions {
  /** Cap each category to this many rows (dashboard preview). Omit for the full list (Action Center). */
  limitPerCategory?: number;
  /** Also include unresolved mailbox_triage_events (non-portal mail routed off the email classifier). */
  includeMailboxTriage?: boolean;
}

type TriageRow = {
  id: string;
  from_name: string | null;
  from_address: string | null;
  subject: string | null;
  email_type: string;
  body_snippet: string | null;
  outlook_web_url?: string | null;
  received_at: string;
};

function cap<T>(rows: T[], limit?: number): T[] {
  return limit ? rows.slice(0, limit) : rows;
}

function commandCenterHref(projectId: string): string {
  return `/command-center?project=${projectId}`;
}

function labelForEmailType(type: string): string {
  switch (type) {
    case "subcontractor":
      return "Subcontractor email";
    case "homeowner_inquiry":
      return "Homeowner inquiry";
    default:
      // Not a classification failure — the AI did classify it as "other"
      // (not portal/subcontractor/homeowner). "Unclassified" read as if the
      // AI gave up, which made classification look broken.
      return "Other / internal email";
  }
}

// Shared by the Dashboard's "Requires Attention" preview and the full Action
// Center list, so a stage/status rename only needs to be understood in one
// place. Dashboard passes limitPerCategory; Action Center leaves it unbounded
// and adds mailbox triage items.
export async function fetchAttentionItems(options: FetchOptions = {}): Promise<AttentionResult> {
  const { limitPerCategory, includeMailboxTriage = false } = options;
  const load = new PartialLoad();

  const [complianceRes, returnedRes, staleRes, serviceAreaReviewRes, needsIntakeRes, boxSignRes] = await Promise.all([
    supabase
      .from("project_compliance_documents")
      .select("project_id, doc_type_code, status, projects(homeowner_name), compliance_doc_types!inner(label, required)")
      .in("status", ["missing", "rejected"])
      .eq("compliance_doc_types.required", true),
    supabase
      .from("project_applications")
      .select("id, project_id, program_track, projects(homeowner_name)")
      .eq("portal_status_code", "app_returned"),
    supabase
      .from("project_applications")
      .select("id, project_id, program_track, projects(homeowner_name)")
      .eq("portal_status_stale", true),
    // The qualification workflow sends the same condition to Slack when the
    // address cannot be geocoded or falls outside the automatic pass rules.
    // Keep the Ops Hub in sync by surfacing every application that is still
    // parked in the corresponding hold stage.
    supabase
      .from("project_applications")
      .select("id, project_id, program_track, projects(homeowner_name, address_line1, address_line2)")
      .eq("internal_status_code", "out_of_service_area_on_hold"),
    // The genuinely-new-lead signal is "Lead Intake Form needed" below
    // (internal_status_code = 'new_pre_qualified'). A separate
    // projects.qualification_result = 'pending' card is intentionally absent:
    // nothing writes that column, so it would flag every project forever
    // (including ones already in estimating).
    // Leads awaiting the Homeowner Intake Form -- portal-originated leads
    // never have an email/phone at capture time, so this is a manual checkpoint for
    // EVERY new direct lead and portal-originated Pre-Qualification Pending
    // lead regardless of source: staff confirms once they've actually sent
    // (or manually reached out with) the intake form.
    supabase
      .from("project_applications")
      .select("id, project_id, program_track, portal_application_id, created_at, projects(homeowner_name, address_line1, address_line2, email, phone, lead_source)")
      .in("internal_status_code", ["new_pre_qualified", "pre_qualification_pending"])
      .order("created_at", { ascending: false }),
    // A Box Sign request has been prepared (by the e-sign delivery
    // automation, which is not connected in this demo) but is NOT sent -- is_document_preparation_needed keeps Box
    // from notifying the homeowner. Staff still has to open prepare_url and
    // click Send themselves; this is that heads-up. Clears itself once the
    // Box Sign Completion Watcher moves the job out of 'processing'.
    supabase
      .from("box_sign_delivery_jobs")
      .select("id, prepare_url, estimates(estimate_number, program_track, project_id, projects(homeowner_name, address_line1, address_line2))")
      .eq("status", "processing")
      .order("created_at", { ascending: false }),
  ]);
  const complianceRows = load.rows(complianceRes, "Compliance documents");
  const returnedRows = load.rows(returnedRes, "Returned applications");
  const staleRows = load.rows(staleRes, "Stale portal statuses");
  const serviceAreaRows = load.rows(serviceAreaReviewRes, "Service-area reviews");
  const needsIntakeRows = load.rows(needsIntakeRes, "New leads awaiting intake");
  const boxSignRows = load.rows(boxSignRes, "E-signature requests");

  // Requires Attention priority order: compliance risk first, new-lead
  // intake last. Portal-returned items slot in right after compliance so
  // "Returned" notifications get priority treatment without overriding the
  // compliance-first rule.
  const complianceItems: AttentionItem[] = cap(complianceRows, limitPerCategory).map((r) => {
    const project = Array.isArray(r.projects) ? r.projects[0] : r.projects;
    const docType = Array.isArray(r.compliance_doc_types) ? r.compliance_doc_types[0] : r.compliance_doc_types;
    return {
      id: `compliance-${r.project_id}-${r.doc_type_code}`,
      severity: r.status === "rejected" ? "critical" : "warning",
      title: `${docType?.label ?? r.doc_type_code} — ${r.status}`,
      detail: project?.homeowner_name ?? "Unknown project",
      source: "compliance",
      href: commandCenterHref(r.project_id),
      staffAction: r.status === "rejected" ? "Correct or replace the rejected document." : "Obtain and upload the required document.",
      clearanceRule: "The document is no longer missing or rejected.",
    };
  });

  const returnedIds = returnedRows.map((r) => r.id);
  const returnedEventsRes = returnedIds.length
    ? await supabase
        .from("portal_status_events")
        .select("project_application_id, subject, body_snippet, received_at")
        .in("project_application_id", returnedIds)
        .eq("parsed_status_code", "app_returned")
        .order("received_at", { ascending: false })
    : { data: [] as { project_application_id: string; subject: string | null; body_snippet: string | null; received_at: string }[], error: null };
  const returnedEvents = load.rows(returnedEventsRes, "Returned-application reasons");

  // Most recent "Returned" event per application — a homeowner can go through
  // multiple independent revision rounds ,
  // so only the latest reason is relevant to what's still outstanding.
  const latestReturnedEvent = new Map<string, { subject: string | null; body_snippet: string | null }>();
  for (const e of returnedEvents) {
    if (!latestReturnedEvent.has(e.project_application_id)) {
      latestReturnedEvent.set(e.project_application_id, { subject: e.subject, body_snippet: e.body_snippet });
    }
  }

  const returnedItems: AttentionItem[] = cap(returnedRows, limitPerCategory).map((r) => {
    const project = Array.isArray(r.projects) ? r.projects[0] : r.projects;
    const event = latestReturnedEvent.get(r.id);
    return {
      id: `portal-returned-${r.id}`,
      severity: "critical",
      title: `Portal: Needs More Information (${r.program_track})`,
      detail: project?.homeowner_name ?? "Unknown project",
      source: "portal_returned",
      bodySnippet: event?.body_snippet ?? undefined,
      href: commandCenterHref(r.project_id),
      staffAction: "Open the project and portal, supply the requested information, then resubmit the application.",
      clearanceRule: "A later portal update changes the application from Returned.",
    };
  });

  const staleItems: AttentionItem[] = cap(staleRows, limitPerCategory).map((r) => {
    const project = Array.isArray(r.projects) ? r.projects[0] : r.projects;
    return {
      id: `stale-${r.id}`,
      severity: "warning",
      title: `Portal status stale (${r.program_track})`,
      detail: project?.homeowner_name ?? "Unknown project",
      source: "portal_stale",
      href: commandCenterHref(r.project_id),
      staffAction: "Open the portal and confirm the application's current status.",
      clearanceRule: "A fresh portal status is recorded.",
    };
  });

  const boxSignItems: AttentionItem[] = cap(boxSignRows, limitPerCategory).map((r) => {
    const estimate = Array.isArray(r.estimates) ? r.estimates[0] : r.estimates;
    const project = estimate ? (Array.isArray(estimate.projects) ? estimate.projects[0] : estimate.projects) : null;
    const address = [project?.address_line1, project?.address_line2].filter(Boolean).join(", ");
    return {
      id: `box-sign-${r.id}`,
      severity: "warning",
      title: `Box Sign ready to send — ${project?.homeowner_name ?? "Unknown project"} (${estimate?.program_track ?? "?"})`,
      detail: `${address || "No address on file"} — estimate ${estimate?.estimate_number ?? "?"}`,
      source: "box_sign_ready",
      boxSignUrl: r.prepare_url ?? undefined,
      programTrack: estimate?.program_track ?? undefined,
      href: "/action-center",
      staffAction: "Open the Box link, review the document, and click Send in Box — nothing reaches the homeowner until you do.",
      clearanceRule: "Clears automatically once the homeowner signs, or the request is declined or expires.",
    };
  });

  const serviceAreaProjectIds = serviceAreaRows.map((r) => r.project_id);
  const serviceAreaScreeningsRes = serviceAreaProjectIds.length
    ? await supabase
        .from("qualification_screenings")
        .select("project_id, notes, evaluated_at")
        .in("project_id", serviceAreaProjectIds)
        .eq("step", "2_service_radius")
        .eq("result", "needs_human_review")
        .order("evaluated_at", { ascending: false })
    : { data: [] as { project_id: string; notes: string | null; evaluated_at: string }[], error: null };
  const serviceAreaScreenings = load.rows(serviceAreaScreeningsRes, "Service-area review notes");

  const latestServiceAreaNote = new Map<string, string>();
  for (const screening of serviceAreaScreenings) {
    if (!latestServiceAreaNote.has(screening.project_id)) {
      latestServiceAreaNote.set(screening.project_id, screening.notes ?? "Manual service-area review required.");
    }
  }

  const serviceAreaItems: AttentionItem[] = cap(serviceAreaRows, limitPerCategory).map((r) => {
    const project = Array.isArray(r.projects) ? r.projects[0] : r.projects;
    const address = [project?.address_line1, project?.address_line2].filter(Boolean).join(", ");
    return {
      id: `service-area-${r.id}`,
      severity: "warning",
      title: `Service-area review needed — ${project?.homeowner_name ?? "Unknown project"}`,
      detail: `${address || "No address on file"} — ${latestServiceAreaNote.get(r.project_id) ?? "Manual distance check required."}`,
      source: "service_area_review",
      href: commandCenterHref(r.project_id),
      staffAction: "Verify county and driving distance, then record the service-area decision in Command Center.",
      clearanceRule: "The application leaves the Out of Service Area – On Hold stage.",
    };
  });


  const intakeGroups = new Map<string, typeof needsIntakeRows>();
  for (const row of needsIntakeRows) {
    const group = intakeGroups.get(row.project_id);
    if (group) group.push(row);
    else intakeGroups.set(row.project_id, [row]);
  }

  const needsIntakeItems: AttentionItem[] = cap([...intakeGroups.values()], limitPerCategory).map((rows) => {
    const r = { ...rows[0], program_track: rows.map((row) => row.program_track).sort().join(" + ") };
    const project = Array.isArray(r.projects) ? r.projects[0] : r.projects;
    const address = [project?.address_line1, project?.address_line2].filter(Boolean).join(", ");
    const hasEmail = Boolean(project?.email);
    // Portal leads never carry an email/phone in the notification itself, but
    // the application record on the (fictional) program portal does, and its
    // URL is keyed by the Application ID we already capture.
    const portalUrl = r.portal_application_id ? programPortalUrl(r.portal_application_id) : undefined;
    const detail = hasEmail
      ? `${address || "no address"} — draft ready in office@ Outlook, review & send`
      : portalUrl
        ? `${address || "no address"} — no email on file. Open the portal record below for contact info, then call or email directly.`
        : `${address || "no address"} — no email on file and no Application ID captured. Reach out directly (${project?.lead_source ?? "unknown source"}).`;
    return {
      id: `intake-${r.id}`,
      severity: "info",
      title: `Lead Intake Form needed — ${project?.homeowner_name ?? "Unknown project"} (${r.program_track})`,
      detail,
      source: "new_lead_intake",
      intakeApplicationIds: rows.map((row) => row.id),
      portalUrl,
      // Action Center, not Command Center -- that's where Mark Intake Sent
      // (and the portal deep-link) actually live.
      href: "/action-center",
      staffAction: hasEmail
        ? "Review the draft in office@ Outlook, send it, then confirm below."
        : "Open the portal record, contact the homeowner, send the intake form, then confirm below.",
      clearanceRule: "Staff confirms the intake form was actually sent.",
    };
  });

  // Unmatched portal notifications — the n8n ingestion logs EVERY portal email
  // and most refer to leads not yet in
  // the pipeline, so they land matched=false with nothing else surfacing them.
  // Show them here with full metadata so staff can act straight from the portal
  // record; "Mark Reviewed" sets resolved=true. Grouped by the portal's own
  // Application ID when present so repeated updates about one application
  // collapse to a single card (latest status wins).
  const portalRes = await supabase
    .from("portal_status_events")
    .select(
      "id, received_at, from_address, subject, body_snippet, parsed_status_code, program_track, status_meaning, portal_application_id, property_address, max_rebate_amount",
    )
    .eq("resolved", false)
    .eq("matched", false)
    .order("received_at", { ascending: false });

  const portalRows = load.rows(portalRes, "Unmatched portal notifications");

  const portalStatusLabels = new Map<string, string>();
  if (portalRows.length) {
    const statusDefs = load.rows(await supabase.from("portal_statuses").select("code, label"), "Portal status labels");
    for (const s of statusDefs) portalStatusLabels.set(s.code, s.label);
  }

  const portalGroups = new Map<string, typeof portalRows>();
  for (const r of portalRows) {
    const key = r.portal_application_id ?? `event:${r.id}`;
    const group = portalGroups.get(key);
    if (group) group.push(r);
    else portalGroups.set(key, [r]);
  }

  const portalItems: AttentionItem[] = cap([...portalGroups.values()], limitPerCategory).map((rows) => {
    const latest = rows[0]; // portalRows is sorted received_at desc
    const isReturned = rows.some((r) => r.parsed_status_code === "app_returned");
    const statusLabel =
      portalStatusLabels.get(latest.parsed_status_code ?? "") ??
      latest.parsed_status_code ??
      "Status update";
    const appId = latest.portal_application_id;
    const rebate = latest.max_rebate_amount
      ? ` · max rebate $${Number(latest.max_rebate_amount).toLocaleString()}`
      : "";
    const addr = latest.property_address ? ` · ${latest.property_address}` : "";
    const countNote = rows.length > 1 ? ` · ${rows.length} updates` : "";
    const meaning = latest.status_meaning ?? "Portal status notification";
    return {
      id: `portal-unmatched-${latest.portal_application_id ?? latest.id}`,
      severity: isReturned ? "critical" : "info",
      title: `Portal: ${statusLabel}${latest.program_track ? ` · ${latest.program_track}` : ""}`,
      detail: `Not matched to a project${addr}${rebate}${countNote}`,
      source: "portal_unmatched",
      portalEventIds: rows.map((r) => r.id),
      portalUrl: appId ? programPortalUrl(appId) : undefined,
      fromAddress: latest.from_address ?? undefined,
      receivedAt: latest.received_at,
      emailSubject: latest.subject ?? undefined,
      applicationId: latest.portal_application_id ?? undefined,
      programTrack: latest.program_track ?? undefined,
      summary: meaning,
      href: "/action-center",
      staffAction: isReturned
        ? "Open the portal, identify or link the project, and resolve the requested corrections."
        : "Review the portal update and link it to the correct project when possible.",
      clearanceRule: "Staff marks the unmatched notification reviewed.",
    };
  });

  const items: AttentionItem[] = [
    ...complianceItems,
    ...returnedItems,
    ...staleItems,
    ...boxSignItems,
    ...serviceAreaItems,
    ...portalItems,
    ...needsIntakeItems,
  ];

  if (includeMailboxTriage) {
    const triageWithOutlook = await supabase
      .from("mailbox_triage_events")
      .select("id, from_name, from_address, subject, email_type, body_snippet, outlook_web_url, received_at")
      .eq("resolved", false)
      .order("received_at", { ascending: false });
    // Older databases may lack outlook_web_url; retry without it before
    // reporting the section as failed.
    const triageRows: TriageRow[] = triageWithOutlook.error
      ? load.rows(await supabase
          .from("mailbox_triage_events")
          .select("id, from_name, from_address, subject, email_type, body_snippet, received_at")
          .eq("resolved", false)
          .order("received_at", { ascending: false }), "Shared-inbox messages")
      : triageWithOutlook.data ?? [];

    for (const r of triageRows) {
      // "Name <email> — Subject" as the headline (shows both name and address
      // when both are on file, not just whichever one wins first), classification label
      // demoted to the detail line, body stays in the click-to-expand panel.
      const sender =
        r.from_name && r.from_address
          ? `${r.from_name} <${r.from_address}>`
          : r.from_name || r.from_address || "Unknown sender";
      items.push({
        id: `triage-${r.id}`,
        severity: "info",
        title: `${sender} — ${r.subject || "(no subject)"}`,
        detail: labelForEmailType(r.email_type),
        source: "mailbox_triage",
        mailboxTriageId: r.id,
        fromAddress: r.from_address ?? undefined,
        bodySnippet: r.body_snippet ? visibleEmailMessage(r.body_snippet) : undefined,
        outlookWebUrl: "outlook_web_url" in r && typeof r.outlook_web_url === "string" ? r.outlook_web_url : undefined,
        receivedAt: r.received_at ?? undefined,
        emailSubject: r.subject ?? undefined,
        href: "/action-center",
        staffAction: "Open the exact email in Outlook, reply or follow up as needed, then mark it reviewed.",
        clearanceRule: "Staff marks the email reviewed.",
      });
    }
  }

  const priority = { critical: 0, warning: 1, info: 2 } as const;
  return { items: items.sort((a, b) => priority[a.severity] - priority[b.severity]), failedSources: load.failedSources };
}

/** Badge count, or null when any section failed (an unknown count is not zero). */
export async function countUnresolvedActionItems(): Promise<number | null> {
  const { items, failedSources } = await fetchAttentionItems({ includeMailboxTriage: true });
  return failedSources.length ? null : items.length;
}

// Sidebar "Compliance" badge -- same required-doc gap definition as the
// Compliance page's own stat cards (missing/rejected on a required doc type).
export async function countComplianceGaps(): Promise<number | null> {
  const { count, error } = await supabase
    .from("project_compliance_documents")
    .select("project_id, compliance_doc_types!inner(required)", { count: "exact", head: true })
    .in("status", ["missing", "rejected"])
    .eq("compliance_doc_types.required", true);
  if (error) {
    console.error(new DbError("Compliance gap count", error));
    return null;
  }
  return count ?? 0;
}

// The resolver's identity is stamped by the database from the session
// (stamp_resolver_identity trigger), so it is not sent from here.
export async function resolveMailboxTriageEvent(id: string): Promise<void> {
  const result = await supabase
    .from("mailbox_triage_events")
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  expectRowsChanged(result, 1, "Resolve inbox message");
}

// "Mark Reviewed" for an unmatched portal-notification card — resolves every
// portal_status_events row the card represents (one Application ID can have
// several logged updates).
export async function resolvePortalStatusEvents(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const result = await supabase
    .from("portal_status_events")
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .in("id", ids)
    .select("id");
  expectRowsChanged(result, ids.length, "Mark portal notification reviewed");
}

// Human checkpoint for the draft-only send model: automation never sends the
// Homeowner Intake Form itself, so this is what actually advances the lead once
// staff has done so (portal leads: a phone call or manual email since none is
// on file; direct-entry leads: the drafted email, reviewed and sent).
export async function markIntakeSent(applicationIds: string[]): Promise<void> {
  if (!applicationIds.length) return;
  const result = await supabase
    .from("project_applications")
    .update({ internal_status_code: "lead_intake_form_sent", updated_at: new Date().toISOString() })
    .in("id", applicationIds)
    .select("id");
  expectRowsChanged(result, applicationIds.length, "Mark intake form sent");
}
