import Invoice from "../../models/invoice.js";
//import { generateInvoicePdf } from "./generatePdf.js";

/*export async function finalizeInvoice(invoiceId) {
  const invoice = await Invoice.findByIdAndUpdate(
    invoiceId,
    { status: "sent" },
    { new: true }
  );

  const pdfUrl = await generateInvoicePdf(invoice);
  return { invoice, pdfUrl };
}*/
