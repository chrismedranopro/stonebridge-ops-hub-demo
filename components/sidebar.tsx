"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { navGroups } from "@/lib/nav";
import { useAuth } from "@/lib/auth";
import { countUnresolvedActionItems, countComplianceGaps } from "@/lib/attention-items";

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [actionCount, setActionCount] = useState(0);
  const [complianceCount, setComplianceCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    countUnresolvedActionItems().then((n) => {
      if (!cancelled) setActionCount(n);
    });
    countComplianceGaps().then((n) => {
      if (!cancelled) setComplianceCount(n);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  function handleSignOut() {
    signOut();
    router.push("/login");
  }

  return (
    <div id="sidebar">
      <div className="brand">
        <div className="logo-box">MD</div>
        <div>
          <div className="logo-text">Stonebridge</div>
          <small>Operations Hub</small>
        </div>
      </div>

      {navGroups.map((group) => (
        <div key={group.label}>
          <div className="navgroup">{group.label}</div>
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`navitem${pathname === item.href ? " active" : ""}`}
            >
              <span>{item.icon} {item.label}</span>
              {item.badgeKey && (
                <span className="badge">
                  {item.badgeKey === "action" ? actionCount : item.badgeKey === "compliance" ? complianceCount : 0}
                </span>
              )}
            </Link>
          ))}
        </div>
      ))}

      {user && (
        <div className="userbox">
          <div className="av">{user.initials}</div>
          <div className="who">
            <div className="name">{user.full_name}</div>
            <div className="role">{user.role}</div>
          </div>
          <button className="signout" onClick={handleSignOut}>Sign out</button>
        </div>
      )}
    </div>
  );
}
