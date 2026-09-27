// The rebate program's contractor portal is fictional in this demo. The
// ".example" domain is reserved (RFC 2606), so these links can never resolve
// to a real third-party system.
export const PROGRAM_PORTAL_BASE_URL = "https://portal.esrp.example/applications";

export function programPortalUrl(portalApplicationId: string): string {
  return `${PROGRAM_PORTAL_BASE_URL}/${encodeURIComponent(portalApplicationId)}`;
}
