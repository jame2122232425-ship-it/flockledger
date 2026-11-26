import type { jsPDF } from "jspdf";
import { dateTimeInNairobi, formatNumber, shortDate, todayInNairobi } from "@/lib/format";
import type { RevenueSale } from "@/lib/revenue/sales";

export type PaymentReceipt = {
  id: string;
  payment_date: string;
  amount_kes: number | string;
  reference: string | null;
  created_at: string;
};

export type ReceiptPrintTarget = {
  location: Pick<Location, "replace">;
};

type ReceiptContext = {
  farmName: string;
  batchCode: string;
  batchType?: string;
  sale: RevenueSale;
};

const colors = {
  green: [20, 91, 43] as const,
  darkGreen: [7, 75, 35] as const,
  paleGreen: [232, 243, 224] as const,
  ink: [32, 40, 35] as const,
  muted: [100, 110, 103] as const,
  border: [210, 221, 212] as const,
  white: [255, 255, 255] as const,
};

const receiptCurrency = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(value: number) {
  return receiptCurrency.format(value);
}

function textColor(doc: jsPDF, color: readonly [number, number, number]) {
  doc.setTextColor(color[0], color[1], color[2]);
}

function fillColor(doc: jsPDF, color: readonly [number, number, number]) {
  doc.setFillColor(color[0], color[1], color[2]);
}

function drawHeader(doc: jsPDF, farmName: string) {
  fillColor(doc, colors.white);
  doc.rect(0, 0, 210, 46, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  textColor(doc, colors.green);
  doc.text("FlockLedger", 18, 19);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.text("Track  Manage  Grow", 20, 27);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  textColor(doc, colors.darkGreen);
  const farmLines = doc.splitTextToSize(farmName, 78);
  doc.text(farmLines, 192, 16, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  textColor(doc, colors.muted);
  doc.text("FARM RECEIPT", 192, 16 + farmLines.length * 4.5, { align: "right" });
  doc.setDrawColor(colors.green[0], colors.green[1], colors.green[2]);
  doc.setLineWidth(0.7);
  doc.line(18, 40, 192, 40);
}

function drawReceiptTitle(doc: jsPDF, title: string) {
  fillColor(doc, colors.darkGreen);
  doc.roundedRect(48, 34, 114, 22, 4, 4, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  textColor(doc, colors.white);
  doc.text(title.toUpperCase(), 105, 48, { align: "center" });
}

function drawSectionTitle(doc: jsPDF, title: string, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  textColor(doc, colors.darkGreen);
  doc.text(title.toUpperCase(), 18, y);
  doc.setDrawColor(colors.border[0], colors.border[1], colors.border[2]);
  doc.setLineWidth(0.3);
  doc.line(18, y + 3, 192, y + 3);
}

function drawField(
  doc: jsPDF,
  label: string,
  value: string,
  x: number,
  y: number,
  width = 78,
) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  textColor(doc, colors.darkGreen);
  doc.text(`${label}:`, x, y);
  doc.setFont("helvetica", "normal");
  textColor(doc, colors.ink);
  const lines = doc.splitTextToSize(value || "—", width - 25);
  doc.text(lines, x + 25, y);
}

function drawLineItem(
  doc: jsPDF,
  columns: Array<{ label: string; value: string; x: number; width: number; align?: "left" | "right" }>,
  y: number,
) {
  fillColor(doc, colors.green);
  doc.roundedRect(18, y, 174, 11, 2, 2, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  textColor(doc, colors.white);
  for (const column of columns) {
    const textX = column.align === "right" ? column.x + column.width : column.x;
    doc.text(column.label, textX, y + 7, {
      align: column.align ?? "left",
      maxWidth: column.width,
    });
  }
  doc.setDrawColor(colors.border[0], colors.border[1], colors.border[2]);
  doc.roundedRect(18, y + 11, 174, 15, 2, 2, "S");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  textColor(doc, colors.ink);
  for (const column of columns) {
    const textX = column.align === "right" ? column.x + column.width : column.x;
    doc.text(column.value, textX, y + 20, {
      align: column.align ?? "left",
      maxWidth: column.width,
    });
  }
}

function drawStatusPanel(
  doc: jsPDF,
  status: string,
  paidLabel: string,
  paidAmount: string,
  balanceLabel: string,
  balanceAmount: string,
  y: number,
) {
  fillColor(doc, colors.paleGreen);
  doc.roundedRect(18, y, 112, 39, 4, 4, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  textColor(doc, colors.darkGreen);
  doc.text("Payment status", 24, y + 10);
  fillColor(doc, colors.green);
  doc.roundedRect(82, y + 4, 41, 12, 6, 6, "F");
  doc.setFontSize(8);
  textColor(doc, colors.white);
  doc.text(status.toUpperCase(), 102.5, y + 12, { align: "center", maxWidth: 37 });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  textColor(doc, colors.ink);
  doc.text(`${paidLabel}:`, 24, y + 23);
  doc.text(paidAmount, 75, y + 23);
  doc.text(`${balanceLabel}:`, 24, y + 33);
  doc.text(balanceAmount, 75, y + 33, { maxWidth: 49 });
}

function drawTotalCard(doc: jsPDF, label: string, amount: string, y: number) {
  fillColor(doc, colors.darkGreen);
  doc.roundedRect(137, y, 55, 39, 4, 4, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  textColor(doc, colors.white);
  doc.text(label, 164.5, y + 12, { align: "center" });
  doc.setFontSize(11);
  doc.text(amount, 164.5, y + 26, { align: "center", maxWidth: 51 });
}

function drawFooter(doc: jsPDF, receiptNumber: string) {
  doc.setDrawColor(colors.green[0], colors.green[1], colors.green[2]);
  doc.setLineWidth(0.6);
  doc.line(18, 245, 192, 245);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  textColor(doc, colors.darkGreen);
  doc.text("Thank you for your business!", 18, 254);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  textColor(doc, colors.muted);
  doc.text(`FlockLedger  |  Receipt ${receiptNumber}  |  Printed ${shortDate(todayInNairobi())}`, 18, 261, {
    maxWidth: 174,
  });
  doc.setFont("helvetica", "italic");
  textColor(doc, colors.green);
  doc.text("Healthy Birds. Greater Productivity.", 192, 274, { align: "right" });
}

function drawReceiptFrame(
  doc: jsPDF,
  title: string,
  farmName: string,
  receiptNumber: string,
) {
  drawHeader(doc, farmName);
  drawReceiptTitle(doc, title);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  textColor(doc, colors.muted);
  doc.text(`Receipt No: ${receiptNumber}`, 18, 67, { maxWidth: 174 });
}

function saleStatus(sale: RevenueSale) {
  return sale.payment_status === "paid"
    ? "Paid"
    : sale.payment_status === "partial"
      ? "Partial"
      : "Unpaid";
}

export function formatPaymentReference(payment: Pick<PaymentReceipt, "id" | "reference">) {
  const generatedReference = /^TMP-MPESA-([A-F0-9]{10})$/.exec(payment.reference ?? "");
  return generatedReference?.[1] ?? payment.reference ?? payment.id.slice(0, 10).toUpperCase();
}

function saleItemDescription(batchType: string | undefined, batchCode: string) {
  const type = batchType === "Broiler"
    ? "Broiler chickens"
    : batchType === "Kienyeji"
      ? "Kienyeji chickens"
      : "Poultry sale";
  return `${type} (Batch ${batchCode})`;
}

async function newReceiptDocument() {
  const { jsPDF: PdfDocument } = await import("jspdf");
  return new PdfDocument({ orientation: "portrait", unit: "mm", format: "a4" });
}

export async function createSaleReceiptPdf(
  sale: RevenueSale,
  farmName: string,
  batchCode: string,
  batchType?: string,
) {
  const receiptNumber = sale.receipt_number || sale.id.slice(0, 8).toUpperCase();
  const doc = await newReceiptDocument();
  drawReceiptFrame(doc, "Sales receipt", farmName, receiptNumber);
  drawSectionTitle(doc, "Sale details", 82);
  drawField(doc, "Sale date", shortDate(sale.sale_date), 94, 94);
  drawField(doc, "Buyer", sale.customer, 94, 105);
  drawField(doc, "Recorded at", dateTimeInNairobi(sale.created_at), 94, 116);
  drawField(doc, "Farm", farmName, 18, 94);
  drawField(doc, "Batch", batchCode, 18, 105);
  drawField(doc, "Poultry type", batchType ?? "—", 18, 116);

  drawSectionTitle(doc, "Items", 137);
  drawLineItem(doc, [
    { label: "Description", value: saleItemDescription(batchType, batchCode), x: 23, width: 76 },
    {
      label: "Quantity",
      value: `${formatNumber(sale.birds_sold)} birds`,
      x: 101,
      width: 32,
      align: "right",
    },
    {
      label: "Unit price (KES)",
      value: sale.price_kes === null ? "—" : money(sale.price_kes),
      x: 137,
      width: 29,
      align: "right",
    },
    { label: "Total (KES)", value: money(sale.amount_kes), x: 169, width: 19, align: "right" },
  ], 143);
  drawStatusPanel(
    doc,
    saleStatus(sale),
    "Amount paid",
    money(sale.paid_kes),
    "Outstanding balance",
    money(sale.outstanding_kes),
    177,
  );
  drawTotalCard(doc, "Total amount", money(sale.amount_kes), 177);
  if (sale.receipt_number) drawField(doc, "Sale reference", sale.receipt_number, 18, 228);
  drawFooter(doc, receiptNumber);
  return doc;
}

export async function createPaymentReceiptPdf(
  payment: PaymentReceipt,
  { farmName, batchCode, batchType, sale }: ReceiptContext,
) {
  const reference = formatPaymentReference(payment);
  const doc = await newReceiptDocument();
  drawHeader(doc, farmName);
  drawReceiptTitle(doc, "Payment receipt");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  textColor(doc, colors.muted);
  doc.text(`Reference: ${reference}`, 18, 67, { maxWidth: 174 });
  drawSectionTitle(doc, "Payment details", 82);
  drawField(doc, "Farm", farmName, 18, 94);
  drawField(doc, "Batch", batchCode, 18, 105);
  drawField(doc, "Poultry type", batchType ?? "—", 18, 116);
  drawField(doc, "Payment date", shortDate(payment.payment_date), 108, 94);
  drawField(doc, "Received from", sale.customer, 108, 105);
  drawField(doc, "Sale date", shortDate(sale.sale_date), 108, 116);
  drawField(doc, "Recorded at", dateTimeInNairobi(payment.created_at), 108, 127);

  drawSectionTitle(doc, "Payment", 145);
  drawLineItem(doc, [
    { label: "Description", value: `Payment for ${saleItemDescription(batchType, batchCode)}`, x: 23, width: 66 },
    { label: "Quantity", value: "1 payment", x: 91, width: 27, align: "right" },
    { label: "Reference", value: reference, x: 121, width: 40, align: "right" },
    {
      label: "Amount (KES)",
      value: money(Number(payment.amount_kes)),
      x: 168,
      width: 20,
      align: "right",
    },
  ], 151);
  drawStatusPanel(
    doc,
    "Received",
    "Sale total",
    money(sale.amount_kes),
    "Current balance",
    money(sale.outstanding_kes),
    185,
  );
  drawTotalCard(doc, "Payment received", money(Number(payment.amount_kes)), 185);
  drawFooter(doc, reference);
  return doc;
}

export async function downloadSaleReceiptPdf(
  sale: RevenueSale,
  farmName: string,
  batchCode: string,
  batchType?: string,
) {
  const doc = await createSaleReceiptPdf(sale, farmName, batchCode, batchType);
  doc.save(`sale-receipt-${sale.id}.pdf`);
}

export async function downloadPaymentReceiptPdf(
  payment: PaymentReceipt,
  context: ReceiptContext,
) {
  const doc = await createPaymentReceiptPdf(payment, context);
  doc.save(`payment-receipt-${payment.id}.pdf`);
}

export async function printSaleReceiptPdf(
  sale: RevenueSale,
  farmName: string,
  batchCode: string,
  batchType: string | undefined,
  printTarget: ReceiptPrintTarget,
) {
  const doc = await createSaleReceiptPdf(sale, farmName, batchCode, batchType);
  doc.autoPrint();
  printTarget.location.replace(String(doc.output("bloburl")));
}

export async function printPaymentReceiptPdf(
  payment: PaymentReceipt,
  context: ReceiptContext,
  printTarget: ReceiptPrintTarget,
) {
  const doc = await createPaymentReceiptPdf(payment, context);
  doc.autoPrint();
  printTarget.location.replace(String(doc.output("bloburl")));
}
