"use client";

import { useAuth } from "@/lib/auth";
import { ExecutiveDashboard } from "@/components/dashboard/executive-dashboard";
import { clientHour, formatClientDate } from "@/lib/timezone";

function greetWord(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <div>
      <div className="greeting">
        <h1>{greetWord(clientHour())}{user ? `, ${user.first_name}` : ""}.</h1>
        <div className="sub">
          {formatClientDate(new Date().toISOString(), { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </div>
      </div>
      <ExecutiveDashboard />
    </div>
  );
}
