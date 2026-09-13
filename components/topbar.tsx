"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { titleForPath } from "@/lib/nav";
import { countUnresolvedActionItems } from "@/lib/attention-items";
import { TopbarSearch } from "./topbar-search";

export function Topbar() {
  const pathname = usePathname();
  const [actionCount, setActionCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    countUnresolvedActionItems().then((n) => {
      if (!cancelled) setActionCount(n);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return (
    <div id="topbar">
      <h1>{titleForPath(pathname)}</h1>
      <div className="tb-right">
        <TopbarSearch />
        <Link href="/action-center" className="tb-pill">⚡ {actionCount} Actions</Link>
      </div>
    </div>
  );
}
