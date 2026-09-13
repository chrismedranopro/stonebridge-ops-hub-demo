// Reference page (sidebar -> Reference -> About this build). Plain-language
// orientation for Stonebridge staff: what the Hub is, what each area does, which
// system owns which record, how sign-in works, and what is deliberately not in
// Phase 1. Content is grounded in knowledge/phase1-scope.md, the ESRP Operations
// SOP + Ops Hub Staff Manual (v2.0), and lib/auth.tsx. No operational data here,
// so this stays a static server component.

const AREAS: [string, string][] = [
  ["Dashboard", "Daily totals, the AI briefing, and the items that need your attention first."],
  [
    "Action Center",
    "One queue for every open item: returned applications, missing compliance documents, new leads to contact, unmatched portal notifications, and classified inbox messages. Clearing an item here is a real action, not just a dismissal.",
  ],
  [
    "Project Portfolio",
    "One row per application, with HOMES and HEAR tracked separately, showing stage, portal status, compliance, and project value.",
  ],
  ["Lead Pipeline", "The visual stage board for leads, plus manual entry for a new project."],
  [
    "Command Center",
    "The full record for a single project: homeowner and property details, both program applications, documents, and the editing controls.",
  ],
  ["Compliance", "The required-document checklist for each project, with status and links into Box."],
  [
    "AI Estimator",
    "Separate HOMES and HEAR queues for document readiness, AI-assisted drafting, internal costing, compliance evidence, review, homeowner quotations, approvals, archives, and revisions.",
  ],
  ["Settings", "Your profile, password, and sign-out."],
];

const SYSTEMS: [string, string][] = [
  ["ESRP / SERO Contractor Portal", "Application, reservation, submission, and payment status"],
  ["Outlook — office@stonebridgehomeenergy.com", "Shared program correspondence, homeowner-review drafts, and portal notifications"],
  ["Box — office@ account", "Project source documents, submitted estimates, Box Sign preparation, and signed files"],
  ["Fieldwire", "Site visits, field forms, photos, and inspections"],
  ["Snugg Pro", "Modeled energy audit, recommended work, technical specifications, and savings evidence used during HOMES and HEAR review"],
  ["Cool Calc", "Manual J / S HVAC load and equipment selection"],
  ["Supabase", "The internal homeowner, project, and application working record"],
];

const NOT_IN_PHASE_1 = [
  "Customer / homeowner portal",
  "Voice AI front desk",
  "After-hours intake portal",
  "Reimbursement tracking",
  "Live material-cost feeds",
  "Predictive cost forecasting",
  "Subcontractor management and portal",
  "Advanced risk monitoring",
  "Executive analytics and reporting",
  "SOP management library",
];

export default function AboutPage() {
  const buildRef = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  const env = process.env.VERCEL_ENV;

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="card" style={{ marginBottom: 18 }}>
        <h2 style={{ marginTop: 0, marginBottom: 8 }}>What the Operations Hub is</h2>
        <p className="muted" style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>
          The Operations Hub is Stonebridge&rsquo;s internal workspace for the Energy Saver Rebate Program (ESRP) program. It brings lead intake, project and portal status, compliance
          documents, and estimate drafting into one place, so the same work isn&rsquo;t tracked
          across separate tools. It coordinates the systems the program already runs on &mdash; it
          does not replace them, and it does not set program policy.
        </p>
      </div>

      <div className="grid stat-row">
        <div className="card stat-card">
          <div className="label">Engagement</div>
          <div className="value" style={{ fontSize: 18 }}>Phase 1</div>
          <div className="sub">Operations Foundation</div>
        </div>
        <div className="card stat-card">
          <div className="label">Production site</div>
          <div className="value" style={{ fontSize: 18 }}>ops.stonebridgehomeenergy.com</div>
          <div className="sub">Deployed continuously</div>
        </div>
        <div className="card stat-card blue">
          <div className="label">Sign-in</div>
          <div className="value" style={{ fontSize: 18 }}>@stonebridgehomeenergy.com</div>
          <div className="sub">Email and password, via Supabase Auth</div>
        </div>
        <div className="card stat-card green">
          <div className="label">Internal records</div>
          <div className="value" style={{ fontSize: 18 }}>Supabase</div>
          <div className="sub">System of record for project work</div>
        </div>
      </div>

      <section>
        <h2>What each area is for</h2>
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 170 }}>Area</th>
                <th>What it&rsquo;s for</th>
              </tr>
            </thead>
            <tbody>
              {AREAS.map(([area, purpose]) => (
                <tr key={area}>
                  <td style={{ fontWeight: 700, color: "var(--text)" }}>{area}</td>
                  <td className="muted">{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Where your information lives</h2>
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 240 }}>System</th>
                <th>What it owns</th>
              </tr>
            </thead>
            <tbody>
              {SYSTEMS.map(([system, owns]) => (
                <tr key={system}>
                  <td style={{ fontWeight: 700, color: "var(--text)" }}>{system}</td>
                  <td className="muted">{owns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
          The Hub mirrors identifiers and status from these systems and links their documents. Each
          one stays the source of truth for its own records.
        </p>
      </section>

      <section>
        <h2>How sign-in works</h2>
        <div className="card">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.7, color: "var(--muted)" }}>
            <li>
              Only <strong style={{ color: "var(--text)" }}>@stonebridgehomeenergy.com</strong> addresses can
              register. That check runs in the database, not just on the login screen.
            </li>
            <li>
              You create your own account by signing up with your work email; an administrator
              confirms your staff record before you see live data.
            </li>
            <li>
              There are two access levels &mdash; <strong style={{ color: "var(--text)" }}>Staff</strong>{" "}
              and <strong style={{ color: "var(--text)" }}>Leadership</strong>. Stonebridge
              administrators manage your level; it is shown on your Settings page.
            </li>
            <li>Change your password any time from Settings. Sign out on shared or borrowed computers.</li>
          </ul>
        </div>
      </section>

      <section>
        <h2>How an estimate moves through the Hub</h2>
        <div className="card">
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.75, color: "var(--muted)" }}>
            <li>Box receives the audit report, submitted site visit, and Manual J / Manual S files when HVAC requires them.</li>
            <li>The AI Estimator prepares separate HOMES and HEAR draft records and identifies missing or conflicting information.</li>
            <li>Christina confirms each scope against the audit and completed site visit, then completes materials, models, specifications, ENERGY STAR / AHRI evidence, labor, permits, and pricing.</li>
            <li>Saving labor refreshes Equipment / Minor Tools at 10% of direct labor. Saving workbook assumptions applies the county tax and saved soft-cost percentages.</li>
            <li>HEAR scopes link to the applicable audit, site-visit, work-order/specification, or HVAC-design source and its page, measure, finding, or section.</li>
            <li>Christina completes costing review and Jordan gives final approval; Marcus is the final fallback when required.</li>
            <li>Approval prepares a quotation-only email draft in office@ for staff to send to the homeowner. If both programs apply, the HOMES and HEAR PDFs are attached to one review email.</li>
            <li>After the homeowner agrees to proceed, staff selects Ready for e-sign. Box prepares the signature request, and staff reviews it and clicks Send in Box.</li>
            <li>Approved, sent, and signed estimates move to Archive. A required revision reason creates a new editable version while preserving the prior version.</li>
          </ol>
        </div>
      </section>

      <section>
        <h2>Rules the Hub keeps</h2>
        <div className="card">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.7, color: "var(--muted)" }}>
            <li>
              No AI-drafted estimate reaches a homeowner without human review. Christina confirms the
              costing and quotation, and final approval requires Jordan&rsquo;s sign-off or the recorded
              Marcus fallback process.
            </li>
            <li>HOMES and HEAR remain separate estimates. They use the same homeowner quotation format but retain their own scopes, evidence, rebate calculations, statuses, and approvals.</li>
            <li>Supplier, ENERGY STAR, AHRI-certificate, and specification links remain internal. The homeowner PDF shows verified product information without internal URLs or cost-formula lines.</li>
            <li>
              The Hub shows the workflow; it does not create eligibility, rebate, construction, or
              compliance policy. Stonebridge&rsquo;s approved SOP is the authority &mdash; if the Hub and
              the SOP disagree, stop and follow the SOP.
            </li>
            <li>The government contracting pipeline is not part of this system.</li>
            <li>
              This is a portfolio demo: every homeowner, staff member, and program record shown here is
              synthetic sample data, not a real person or address.
            </li>
          </ul>
        </div>
      </section>

      <section>
        <h2>Not in this phase</h2>
        <div className="card">
          <p className="muted" style={{ marginTop: 0, fontSize: 12, lineHeight: 1.6 }}>
            The following are out of Phase 1 by agreement, not oversights. They are candidates for a
            later phase:
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {NOT_IN_PHASE_1.map((item) => (
              <span key={item} className="pill info" style={{ textTransform: "none", fontSize: 10 }}>
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h2>Getting help</h2>
        <div className="card">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.7, color: "var(--muted)" }}>
            <li>
              The full step-by-step guide is the <strong style={{ color: "var(--text)" }}>ESRP
              Operations SOP and Ops Hub Staff Manual</strong> (v2.0).
            </li>
            <li>Questions about a process go to your Operations / Project Coordinator.</li>
            <li>
              If something in the Hub looks wrong, note the project and what you expected to see, then
              report it so it can be fixed.
            </li>
          </ul>
        </div>
      </section>

      <p className="muted" style={{ fontSize: 10, fontFamily: "var(--mono)", marginTop: 4 }}>
        Stonebridge Ops Hub &middot; Phase 1 &mdash; Operations Foundation
        {buildRef ? ` · build ${buildRef}${env && env !== "production" ? ` (${env})` : ""}` : ""}
      </p>
    </div>
  );
}
