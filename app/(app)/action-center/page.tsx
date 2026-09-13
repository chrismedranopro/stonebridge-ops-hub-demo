"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  fetchAttentionItems,
  resolveMailboxTriageEvent,
  resolvePortalStatusEvents,
  markIntakeSent,
  type AttentionItem,
} from "@/lib/attention-items";
import { formatClientDateTime } from "@/lib/timezone";

export default function ActionCenterPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const data = await fetchAttentionItems({ includeMailboxTriage: true });
      if (cancelled) return;
      setItems(data);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  async function handleResolve(item: AttentionItem) {
    if (!item.mailboxTriageId || !user) return;
    setResolvingId(item.id);
    await resolveMailboxTriageEvent(item.mailboxTriageId, user.id);
    setResolvingId(null);
    setReloadToken((t) => t + 1);
  }

  async function handleMarkIntakeSent(item: AttentionItem) {
    if (!item.intakeApplicationIds?.length) return;
    setResolvingId(item.id);
    await markIntakeSent(item.intakeApplicationIds);
    setResolvingId(null);
    setReloadToken((t) => t + 1);
  }

  async function handleResolvePortal(item: AttentionItem) {
    if (!item.portalEventIds?.length || !user) return;
    setResolvingId(item.id);
    await resolvePortalStatusEvents(item.portalEventIds, user.id);
    setResolvingId(null);
    setReloadToken((t) => t + 1);
  }

  if (loading) {
    return (
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>Loading action center…</p>
      </div>
    );
  }

  const counts = {
    critical: items.filter((i) => i.severity === "critical").length,
    warning: items.filter((i) => i.severity === "warning").length,
    info: items.filter((i) => i.severity === "info").length,
  };

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        A prioritized work queue. Every item explains what staff should do and what removes it.
      </p>

      <div className="grid stat-row">
        <div className="card stat-card red">
          <div className="label">Critical</div>
          <div className="value">{counts.critical}</div>
          <div className="sub">Blocked work: returned applications and rejected documents</div>
        </div>
        <div className="card stat-card">
          <div className="label">Warning</div>
          <div className="value">{counts.warning}</div>
          <div className="sub">Human review: missing documents, stale status, service area</div>
        </div>
        <div className="card stat-card blue">
          <div className="label">Info</div>
          <div className="value">{counts.info}</div>
          <div className="sub">New leads, intake forms needed, unreviewed mail</div>
        </div>
      </div>

      <section>
        <h2>All Items</h2>
        {items.length === 0 ? (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>Nothing needs attention right now.</p>
          </div>
        ) : (
          items.map((item) => {
            const hasDetail = Boolean(
              item.bodySnippet ||
                item.fromAddress ||
                item.receivedAt ||
                item.emailSubject ||
                item.applicationId,
            );
            const isExpanded = expandedId === item.id;
            return (
              <div key={item.id} className={`alert-row ${item.severity}`}>
                <div
                  className="msg-row"
                  style={{ cursor: hasDetail ? "pointer" : "default" }}
                  onClick={() => hasDetail && setExpandedId(isExpanded ? null : item.id)}
                >
                  <span className={`pill ${item.severity}`}>{item.severity}</span>
                  <div className="msg">
                    <b>{item.title}</b>
                    <span>{item.detail}</span>
                    {item.staffAction && <span><strong>Next step:</strong> {item.staffAction}</span>}
                    {item.clearanceRule && <span className="muted"><strong>Clears when:</strong> {item.clearanceRule}</span>}
                    {isExpanded && (
                      <div className="detail-expanded">
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "auto 1fr",
                            gap: "3px 12px",
                            fontSize: 11,
                            marginBottom: item.bodySnippet ? 10 : 0,
                          }}
                        >
                          {item.emailSubject && (
                            <>
                              <span className="muted">Subject</span>
                              <span>{item.emailSubject}</span>
                            </>
                          )}
                          {item.fromAddress && (
                            <>
                              <span className="muted">From</span>
                              <span>{item.fromAddress}</span>
                            </>
                          )}
                          {item.receivedAt && (
                            <>
                              <span className="muted">Received</span>
                              <span>{formatClientDateTime(item.receivedAt)}</span>
                            </>
                          )}
                          {item.programTrack && (
                            <>
                              <span className="muted">Program</span>
                              <span>{item.programTrack}</span>
                            </>
                          )}
                          {item.applicationId && (
                            <>
                              <span className="muted">Application ID</span>
                              <span style={{ fontFamily: "var(--mono)", fontSize: 10 }}>{item.applicationId}</span>
                            </>
                          )}
                        </div>
                        {item.bodySnippet && (
                          <div>
                            <div
                              className="muted"
                              style={{
                                fontSize: 9,
                                fontWeight: 600,
                                textTransform: "uppercase",
                                letterSpacing: ".04em",
                                marginBottom: 4,
                              }}
                            >
                              Exact message
                            </div>
                            <blockquote
                              style={{
                                whiteSpace: "pre-wrap",
                                fontSize: 11,
                                lineHeight: 1.5,
                                maxHeight: 220,
                                overflowY: "auto",
                                background: "var(--panel)",
                                border: "1px solid var(--border)",
                                borderRadius: 6,
                                padding: "8px 10px",
                                margin: 0,
                              }}
                            >
                              {item.bodySnippet}
                            </blockquote>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {item.mailboxTriageId && (
                  <button
                    className="tb-pill"
                    disabled={resolvingId === item.id}
                    onClick={() => handleResolve(item)}
                  >
                    {resolvingId === item.id ? "Marking…" : "Mark Reviewed"}
                  </button>
                )}
                {item.source === "portal_unmatched" && (
                  <button
                    className="tb-pill"
                    disabled={resolvingId === item.id}
                    onClick={() => handleResolvePortal(item)}
                  >
                    {resolvingId === item.id ? "Marking…" : "Mark Reviewed"}
                  </button>
                )}
                {item.portalUrl && (
                  <a
                    href={item.portalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tb-pill"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Open in GHEP Portal →
                  </a>
                )}
                {item.boxSignUrl && (
                  <a
                    href={item.boxSignUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tb-pill"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Open in Box Sign →
                  </a>
                )}
                {item.outlookWebUrl && (
                  <a
                    href={item.outlookWebUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tb-pill"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Open email in Outlook →
                  </a>
                )}
                {item.source === "service_area_review" && item.href && (
                  <a
                    href={item.href}
                    className="tb-pill"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Review Project →
                  </a>
                )}
                {item.href && item.href !== "/action-center" && item.source !== "service_area_review" && (
                  <a href={item.href} className="tb-pill" onClick={(e) => e.stopPropagation()}>
                    Open Project →
                  </a>
                )}
                {item.intakeApplicationIds?.length && (
                  <button
                    className="tb-pill"
                    disabled={resolvingId === item.id}
                    onClick={() => handleMarkIntakeSent(item)}
                  >
                    {resolvingId === item.id ? "Marking…" : "Confirm Intake Form Sent"}
                  </button>
                )}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
