"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

interface SearchResult {
  projectId: string;
  homeownerName: string;
  address: string;
}

// Global project/homeowner search -- queries `projects` directly (not the
// pipeline board's in-memory list) so it finds leads regardless of which
// page is currently open. Selecting a result routes to Command Center the
// same way SnapshotDrawer's "View full Command Center" button does.
export function TopbarSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = query.trim();
    if (!term) return;

    let cancelled = false;

    const timer = setTimeout(async () => {
      setLoading(true);
      const like = `%${term.replace(/[%,]/g, "")}%`;
      const { data, error } = await supabase
        .from("projects")
        .select("id, homeowner_name, address_line1, address_line2")
        .or(`homeowner_name.ilike.${like},address_line1.ilike.${like},address_line2.ilike.${like}`)
        .order("created_at", { ascending: false })
        .limit(8);

      if (cancelled) return;
      setLoading(false);

      if (error) {
        console.error("Project search failed", error);
        setResults([]);
        return;
      }

      setResults(
        (data ?? []).map((p) => ({
          projectId: p.id,
          homeownerName: p.homeowner_name,
          address: [p.address_line1, p.address_line2].filter(Boolean).join(", "),
        }))
      );
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function goToProject(projectId: string) {
    setOpen(false);
    setQuery("");
    router.push(`/command-center?project=${projectId}`);
  }

  const showDropdown = open && query.trim().length > 0;

  return (
    <div className="tb-search-wrap" ref={wrapRef}>
      <input
        type="text"
        className="tb-search"
        placeholder="Search projects, homeowners…"
        value={query}
        onChange={(e) => {
          const value = e.target.value;
          setQuery(value);
          setOpen(true);
          if (!value.trim()) {
            setResults([]);
            setLoading(false);
          }
        }}
        onFocus={() => query.trim() && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && results[0]) goToProject(results[0].projectId);
        }}
      />
      {showDropdown && (
        <div className="tb-search-results">
          {loading ? (
            <div className="tb-search-empty">Searching…</div>
          ) : results.length === 0 ? (
            <div className="tb-search-empty">No matches</div>
          ) : (
            results.map((r) => (
              <button key={r.projectId} type="button" className="tb-search-item" onClick={() => goToProject(r.projectId)}>
                <div className="name">{r.homeownerName}</div>
                <div className="addr">{r.address || "No address on file"}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
