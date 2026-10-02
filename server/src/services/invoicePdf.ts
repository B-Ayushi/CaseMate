import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { formatHours, formatPaise } from '../lib/money.js';
import { formatInTimeZone } from 'date-fns-tz';

// Noto Sans (SIL Open Font License, see server/assets/fonts/OFL.txt) is embedded because
// PDFKit's built-in fonts have no ₹ sign. The path works from src/ (tsx) and dist/.
const font = (name: string) =>
  fileURLToPath(new URL(`../../assets/fonts/NotoSans-${name}.ttf`, import.meta.url));
const REGULAR = font('Regular');
const BOLD = font('Bold');

export interface InvoicePdfData {
  number: string;
  issueDate: Date; // DATE column: midnight UTC of the IST day
  dueDate: Date;
  notes: string | null;
  totalPaise: number;
  lawyer: { name: string; email: string; phone: string; barCouncilNumber: string };
  client: { name: string; address: string | null; phone: string; email: string | null };
  entries: {
    workDate: Date;
    caseTitle: string;
    caseNumber: string;
    description: string;
    minutes: number;
    amountPaise: number;
  }[];
}

// DATE columns hold the IST calendar day as midnight UTC, so they are formatted in UTC.
const day = (date: Date) => formatInTimeZone(date, 'UTC', 'd MMM yyyy');

const INK = '#0f172a';
const MUTED = '#475569';
const LINE = '#cbd5e1';

// A clean A4 invoice: who it is from and to, the number and dates, one row per time
// entry (date, case, work done, hours, amount) and the total.
export function buildInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    bufferPages: true,
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
    info: { Title: `Invoice ${data.number}`, Author: data.lawyer.name, Creator: 'CaseMate' },
  });
  doc.registerFont('Regular', REGULAR);
  doc.registerFont('Bold', BOLD);

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  // Header: the lawyer on the left, "INVOICE" and its details on the right.
  doc.font('Bold').fontSize(16).fillColor(INK).text(data.lawyer.name, left, 50, { width: 300 });
  doc
    .font('Regular')
    .fontSize(9.5)
    .fillColor(MUTED)
    .text(`Advocate · Bar Council No. ${data.lawyer.barCouncilNumber}`, { width: 300 })
    .text(`Phone ${data.lawyer.phone}`, { width: 300 })
    .text(data.lawyer.email, { width: 300 });
  const afterLawyer = doc.y;

  doc.font('Bold').fontSize(22).fillColor(INK).text('INVOICE', left, 48, { width, align: 'right' });
  let detailY = 82;
  for (const [label, value] of [
    ['Invoice no.', data.number],
    ['Issue date', day(data.issueDate)],
    ['Due date', day(data.dueDate)],
  ] as const) {
    doc
      .font('Regular')
      .fontSize(9.5)
      .fillColor(MUTED)
      .text(label, right - 200, detailY, { width: 90 });
    doc
      .font('Bold')
      .fillColor(INK)
      .text(value, right - 110, detailY, { width: 110, align: 'right' });
    detailY += 15;
  }

  // Bill to.
  let y = Math.max(afterLawyer, detailY) + 24;
  doc.font('Bold').fontSize(9).fillColor(MUTED).text('BILL TO', left, y);
  doc
    .font('Bold')
    .fontSize(11.5)
    .fillColor(INK)
    .text(data.client.name, left, doc.y + 2, { width: 300 });
  doc.font('Regular').fontSize(9.5).fillColor(MUTED);
  if (data.client.address) doc.text(data.client.address, { width: 300 });
  doc.text([data.client.phone, data.client.email].filter(Boolean).join(' · '), { width: 300 });

  // The table of entries.
  const columns = [
    { title: 'Date', x: left, w: 70, align: 'left' as const },
    { title: 'Case', x: left + 75, w: 130, align: 'left' as const },
    { title: 'Work done', x: left + 210, w: 160, align: 'left' as const },
    { title: 'Hours', x: left + 375, w: 45, align: 'right' as const },
    { title: 'Amount', x: left + 425, w: width - 425, align: 'right' as const },
  ];

  const drawHeaderRow = () => {
    doc.font('Bold').fontSize(9).fillColor(MUTED);
    for (const c of columns)
      doc.text(c.title.toUpperCase(), c.x, y, { width: c.w, align: c.align });
    y += 16;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.8).strokeColor(LINE).stroke();
    y += 6;
  };

  y = doc.y + 24;
  drawHeaderRow();

  doc.font('Regular').fontSize(9.5);
  for (const entry of data.entries) {
    const cells = [
      day(entry.workDate),
      `${entry.caseTitle}\n${entry.caseNumber}`,
      entry.description,
      formatHours(entry.minutes),
      formatPaise(entry.amountPaise),
    ];
    doc.font('Regular').fontSize(9.5);
    const height = Math.max(
      ...cells.map((text, i) => doc.heightOfString(text, { width: columns[i]!.w })),
    );
    if (y + height + 8 > bottom() - 60) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeaderRow();
    }
    doc.font('Regular').fontSize(9.5);
    doc.fillColor(INK);
    cells.forEach((text, i) => {
      const c = columns[i]!;
      doc.text(text, c.x, y, { width: c.w, align: c.align });
    });
    y += height + 6;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(LINE).stroke();
    y += 6;
  }

  // Total.
  if (y + 60 > bottom()) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  y += 6;
  doc.font('Bold').fontSize(12).fillColor(INK);
  doc.text('Total due', left + 260, y, { width: 110, align: 'left' });
  doc.text(formatPaise(data.totalPaise), left + 370, y, { width: width - 370, align: 'right' });
  y = doc.y + 4;
  doc
    .font('Regular')
    .fontSize(9)
    .fillColor(MUTED)
    .text(`Please pay by ${day(data.dueDate)}.`, left + 260, y, {
      width: width - 260,
      align: 'right',
    });

  if (data.notes) {
    y = doc.y + 24;
    if (y + 40 > bottom()) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.font('Bold').fontSize(9).fillColor(MUTED).text('NOTES', left, y);
    doc
      .font('Regular')
      .fontSize(9.5)
      .fillColor(INK)
      .text(data.notes, left, doc.y + 2, { width });
  }

  // "INV-007 · Page 1 of 2" at the foot of every page.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const footerY = doc.page.height - doc.page.margins.bottom + 16;
    // Writing inside the bottom margin would otherwise make PDFKit start a new page.
    const margin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('Regular')
      .fontSize(8)
      .fillColor(MUTED)
      .text(`${data.number} · Page ${i + 1} of ${range.count}`, left, footerY, {
        width,
        align: 'right',
        lineBreak: false,
      });
    doc.page.margins.bottom = margin;
  }

  doc.end();
  return done;
}
