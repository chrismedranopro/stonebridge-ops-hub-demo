import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { requireOpsHubUser } from "@/lib/supabase-server";

describe("requireOpsHubUser", () => {
  it("rejects a request without a bearer token before contacting Supabase", async () => {
    const result = await requireOpsHubUser(new NextRequest("http://localhost/api/estimator/energy-star-lookup?model=X"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("rejects a malformed Authorization header", async () => {
    const result = await requireOpsHubUser(new NextRequest("http://localhost/api/x", { headers: { Authorization: "Basic abc" } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });
});
