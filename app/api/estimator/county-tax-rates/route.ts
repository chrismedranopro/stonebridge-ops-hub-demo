import { NextResponse } from "next/server";

const sourceUrl = "https://www.ncdor.gov/taxes-forms/sales-and-use-tax/sales-and-use-tax-rates/current-sales-and-use-tax-rates";

export async function GET() {
  try {
    const response = await fetch(sourceUrl, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("NCDOR did not return its current county rate table.");
    const html = await response.text();
    const rates = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap(row => {
      const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => cell[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim());
      if (cells.length !== 2 || !/^[A-Za-z ]+$/.test(cells[0]) || !/^\d+(\.\d+)?%\*?$/.test(cells[1])) return [];
      return [{ county: cells[0], rate: Number.parseFloat(cells[1]) }];
    });
    if (rates.length !== 100 || new Set(rates.map(rate => rate.county)).size !== 100) throw new Error("The county table format changed. Verify rates on NCDOR before saving.");
    return NextResponse.json({ rates, sourceUrl, checkedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Current county rates could not be verified. Open the NCDOR reference and retry.", sourceUrl }, { status: 502 });
  }
}
