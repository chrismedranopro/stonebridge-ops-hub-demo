// Extract the sender's current message from a flattened email reply chain.
// The ingestion workflow does this before storing new rows; this fallback also
// cleans rows the workflow's own stripper misses (it was built for Outlook's
// "From:/Sent:" quote header — homeowners reply from Gmail / Yahoo / iPhone Mail,
// which use "On <date> <name> wrote:" instead).
//
// NOTE: bodies coming from the current n8n `Prep Email` node have every capital
// "O" replaced with a space ("On " -> " n ", "HOMES" -> "H MES"). That is an
// upstream bug to fix in the workflow; here we just tolerate it so the quoted
// history still gets cut (the marker matches with or without the leading "O").
export function visibleEmailMessage(body: string): string {
  const normalized = body
    .replace(/\r\n?/g, "\n")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .trim();

  const dayOrMonth =
    "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*";

  const replyMarkers = [
    // Gmail / Yahoo / Apple Mail: "On Wed, Sep 9, 2026 at 5:35 PM Name <addr> wrote:"
    // Also matches the mobile variants with no weekday ("On Aug 14, 2026 3:18 PM, ...")
    // and the corrupted "n ..." where the leading capital O was eaten upstream.
    new RegExp(
      `(?:\\n|\\s{2,})\\s*O?n\\s+${dayOrMonth}[\\s\\S]{0,240}?(?:19|20)\\d\\d[\\s\\S]{0,120}?\\bwrote:`,
      "i",
    ),
    // Outlook: "From: ... Sent: ..." header, whether or not newlines survived.
    /(?:\n|\s{2,})\s*From:\s[\s\S]{0,120}?\bSent:\s/i,
    /(?:\n|\s{2,})\s*-{2,}\s*O?riginal Message\s*-{2,}/i,
    // "Sent from Yahoo Mail for iPhone" / "Get Outlook for Android" trailers that
    // sit between the message and the quote — cut from there if we found nothing else.
    /(?:\n|\s{2,})\s*Sent from \w+/i,
  ];

  let end = normalized.length;
  for (const marker of replyMarkers) {
    const match = marker.exec(normalized);
    if (match && match.index < end) end = match.index;
  }

  const cleaned = normalized
    .slice(0, end)
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // If the whole body was quoted history (nothing before the first marker),
  // fall back to the full normalized text so the card is never blank.
  return cleaned || normalized;
}
