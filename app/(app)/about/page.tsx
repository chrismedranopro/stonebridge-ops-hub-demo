// Reference page (sidebar -> Reference -> About this build). Plain-language
// orientation for the fictional Stonebridge staff: what the Hub is, what each
// area does, which system owns which record, how sign-in works, and what this
// demo deliberately leaves out. No operational data here, so this stays a
// static server component.

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
  ["ESRP program portal (fictional)", "Application, reservation, submission, and payment status"],
  ["Shared inbox — office@stonebridge.example", "Shared program correspondence, homeowner-review drafts, and portal notifications"],
  ["Document store + e-signature", "Project source documents, submitted estimates, signature preparation, and signed files"],
  ["Field app", "Site visits, field forms, photos, and inspections"],
  ["Energy-modeling tool", "Modeled energy audit, recommended work, technical specifications, and savings evidence used during HOMES and HEAR review"],
  ["HVAC design tool", "Manual J / S HVAC load and equipment selection"],
  ["Supabase", "The internal homeowner, project, and application working record"],
];

const OUT_OF_SCOPE = [
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
          <div className="label">Build</div>
          <div className="value" style={{ fontSize: 18 }}>Portfolio demo</div>
          <div className="sub">Synthetic data only</div>
        </div>
        <div className="card stat-card">
          <div className="label">Integrations</div>
          <div className="value" style={{ fontSize: 18 }}>Simulated</div>
          <div className="sub">No live external services</div>
        </div>
        <div className="card stat-card blue">
          <div className="label">Sign-in</div>
          <div className="value" style={{ fontSize: 18 }}>Open sign-up</div>
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
              This is a public demo &mdash; anyone with the link can sign up with any email address.
            </li>
            <li>
              Your staff record is created automatically the moment you sign up, from the name and
              role you enter on that form.
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
            <li>The document store receives the audit report, submitted site visit, and Manual J / Manual S files when HVAC requires them.</li>
            <li>The AI Estimator prepares separate HOMES and HEAR draft records and identifies missing or conflicting information.</li>
            <li>Christina confirms each scope against the audit and completed site visit, then completes materials, models, specifications, ENERGY STAR / AHRI evidence, labor, permits, and pricing.</li>
            <li>Saving workbook assumptions adds Equipment / Minor Tools at the saved percentage of direct labor, then applies the county tax and saved soft-cost percentages (all demo values are fictional).</li>
            <li>HEAR scopes link to the applicable audit, site-visit, work-order/specification, or HVAC-design source and its page, measure, finding, or section.</li>
            <li>Christina completes costing review and Jordan gives final approval; Marcus is the final fallback when required.</li>
            <li>Approval prepares a quotation-only email draft in office@ for staff to send to the homeowner. If both programs apply, the HOMES and HEAR PDFs are attached to one review email.</li>
            <li>After the homeowner agrees to proceed, staff selects Ready for e-sign. The e-signature service (simulated in this demo) prepares the request, and staff reviews it before anything is sent.</li>
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
            <li>
              This is a portfolio demo: every homeowner, staff member, and program record shown here is
              synthetic sample data, not a real person or address.
            </li>
          </ul>
        </div>
      </section>

      <section>
        <h2>Not in this demo</h2>
        <div className="card">
          <p className="muted" style={{ marginTop: 0, fontSize: 12, lineHeight: 1.6 }}>
            The following are deliberately out of scope for this build, not oversights:
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {OUT_OF_SCOPE.map((item) => (
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
              The step-by-step process lives in Stonebridge&rsquo;s operations SOP (fictional, not
              included in this demo).
            </li>
            <li>Questions about a process go to your operations coordinator.</li>
            <li>
              If something in the Hub looks wrong, note the project and what you expected to see, then
              report it so it can be fixed.
            </li>
          </ul>
        </div>
      </section>

      <p className="muted" style={{ fontSize: 10, fontFamily: "var(--mono)", marginTop: 4 }}>
        Stonebridge Ops Hub &middot; portfolio demo
        {buildRef ? ` · build ${buildRef}${env && env !== "production" ? ` (${env})` : ""}` : ""}
      </p>
    </div>
  );
}
