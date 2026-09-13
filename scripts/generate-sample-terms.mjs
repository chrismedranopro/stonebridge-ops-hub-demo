import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const pdf = await PDFDocument.create();
const page = pdf.addPage([612, 792]);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
const regular = await pdf.embedFont(StandardFonts.Helvetica);

let y = 740;
const draw = (text, size, font = regular, color = rgb(0.1, 0.1, 0.12)) => {
  page.drawText(text, { x: 72, y, size, font, color });
  y -= size + 10;
};

draw("Sample Terms of Service", 20, bold);
draw("Cascadia Home Energy Solutions — Demo Document", 11, regular, rgb(0.4, 0.4, 0.45));
y -= 10;
draw("This is placeholder text for a portfolio demo.", 11);
draw("It does not constitute a real contract or legal agreement, and is included only", 11);
draw("to show the estimate package / e-sign flow end-to-end.", 11);
y -= 10;
draw("1. This demo uses synthetic homeowner, staff, and project data.", 10);
draw("2. No real services, rebates, or agreements are offered through this demo.", 10);
draw("3. Replace this document with your own terms before any production use.", 10);

await writeFile(
  path.join(process.cwd(), "public", "legal", "Sample-Terms-of-Service.pdf"),
  await pdf.save()
);
console.log("Generated public/legal/Sample-Terms-of-Service.pdf");
