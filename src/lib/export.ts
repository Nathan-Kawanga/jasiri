import "server-only";
import writeExcelFile from "write-excel-file/node";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type Table = {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number)[][];
  footer?: (string | number)[];
};
export type Format = "csv" | "xlsx" | "pdf";

function csvCell(v: string | number): string {
  const t = String(v ?? "");
  // Prevent spreadsheet formula injection from typed names.
  const safe = /^[=+\-@\t\r]/.test(t) && typeof v !== "number" ? `'${t}` : t;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(t: Table): string {
  const lines = [t.headers, ...t.rows, ...(t.footer ? [t.footer] : [])].map((r) => r.map(csvCell).join(","));
  return "﻿" + lines.join("\r\n");
}

export async function toXlsx(t: Table): Promise<Buffer> {
  const header = t.headers.map((h) => ({ value: h, fontWeight: "bold" as const }));
  const body = t.rows.map((r) => r.map((v) => ({ value: v })));
  const foot = t.footer ? [t.footer.map((v) => ({ value: v, fontWeight: "bold" as const }))] : [];
  const title = [[{ value: t.title, fontWeight: "bold" as const }], ...(t.subtitle ? [[{ value: t.subtitle }]] : []), []];
  return writeExcelFile([...title, header, ...body, ...foot] as never, {
    columns: t.headers.map((h) => ({ width: Math.max(10, Math.min(28, h.length + 6)) })),
  }).toBuffer();
}

// pdf-lib's standard fonts only cover Latin-1.
const latin = (v: string | number) => String(v ?? "").replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

export async function toPdf(t: Table): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 36, size = 9, rowH = 15;
  const colW = (W - 2 * M) / t.headers.length;
  let page = doc.addPage([W, H]);
  let y = H - M;

  const text = (s: string | number, x: number, f = font, sz = size) => {
    let str = latin(s);
    while (str.length > 1 && f.widthOfTextAtSize(str, sz) > colW - 4) str = str.slice(0, -2) + ".";
    page.drawText(str, { x, y, size: sz, font: f, color: rgb(0.07, 0.07, 0.07) });
  };
  const row = (r: (string | number)[], f = font) => {
    if (y < M + rowH) { page = doc.addPage([W, H]); y = H - M; }
    r.forEach((v, i) => text(v, M + i * colW, f));
    y -= rowH;
  };

  page.drawText(latin(t.title), { x: M, y, size: 14, font: bold });
  y -= 20;
  if (t.subtitle) { page.drawText(latin(t.subtitle), { x: M, y, size: 10, font }); y -= 18; }
  row(t.headers, bold);
  page.drawLine({ start: { x: M, y: y + rowH - 3 }, end: { x: W - M, y: y + rowH - 3 }, thickness: 0.5 });
  t.rows.forEach((r) => row(r));
  if (t.footer) row(t.footer, bold);
  return doc.save();
}

export async function respond(t: Table, format: Format, filename: string): Promise<Response> {
  if (format === "xlsx") {
    return new Response(new Uint8Array(await toXlsx(t)), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${filename}.xlsx"`,
      },
    });
  }
  if (format === "pdf") {
    return new Response(new Uint8Array(await toPdf(t)), {
      headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${filename}.pdf"` },
    });
  }
  return new Response(toCsv(t), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}.csv"` },
  });
}
