export interface NavItem {
  href: string;
  label: string;
  icon: string;
  badgeKey?: "action" | "compliance" | "estimator";
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

// Single source of truth for the sidebar and the topbar's route->title lookup.
// badgeKey "action" and "compliance" are wired to real counts (lib/attention-items.ts).
// "estimator" still renders static 0 until that badge is wired.
export const navGroups: NavGroup[] = [
  {
    label: "Command",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "⊞" },
      { href: "/action-center", label: "Action Center", icon: "⚡", badgeKey: "action" },
    ],
  },
  {
    label: "Projects",
    items: [
      { href: "/portfolio", label: "Project Portfolio", icon: "▦" },
      { href: "/pipeline", label: "Lead Pipeline", icon: "⇢" },
      { href: "/command-center", label: "Command Center", icon: "◎" },
      { href: "/compliance", label: "Compliance", icon: "☑", badgeKey: "compliance" },
    ],
  },
  {
    label: "AI Automation",
    items: [{ href: "/estimator", label: "AI Estimator", icon: "✦", badgeKey: "estimator" }],
  },
  {
    label: "Account",
    items: [{ href: "/settings", label: "Settings", icon: "⚙" }],
  },
  {
    label: "Reference",
    items: [{ href: "/about", label: "About this build", icon: "📄" }],
  },
];

const allItems = navGroups.flatMap((g) => g.items);

export function titleForPath(pathname: string): string {
  return allItems.find((i) => i.href === pathname)?.label ?? "Ops Hub";
}
