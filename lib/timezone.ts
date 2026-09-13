// Cascadia is based in Richmond, NC — all staff-facing dates/times should
// read in the client's local timezone, not whatever timezone the viewer's
// browser happens to be set to.
export const CLIENT_TIME_ZONE = "America/New_York";

export function formatClientDate(iso: string, options: Intl.DateTimeFormatOptions = {}): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: CLIENT_TIME_ZONE, ...options });
}

export function formatClientDateTime(iso: string, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CLIENT_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...options,
  }).format(new Date(iso));
}

export function clientDateInputValue(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CLIENT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

// Convert a YYYY-MM-DD chosen in Cascadia's calendar to midnight in its
// timezone, including the correct EST/EDT offset for that date.
export function clientDateInputToIso(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day, 12));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CLIENT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(probe);
  const local = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(local.year),
    Number(local.month) - 1,
    Number(local.day),
    Number(local.hour),
    Number(local.minute),
    Number(local.second),
  );
  const offsetMs = representedAsUtc - probe.getTime();
  return new Date(Date.UTC(year, month - 1, day) - offsetMs).toISOString();
}

export function clientHour(date: Date = new Date()): number {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: CLIENT_TIME_ZONE,
    hourCycle: "h23",
    hour: "numeric",
  }).format(date);
  return Number(formatted);
}
