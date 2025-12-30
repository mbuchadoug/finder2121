import Invoice from ".../models/invoice.js";

export async function addInvoiceItem(invoiceId, item) {
  return Invoice.findByIdAndUpdate(
    invoiceId,
    { $push: { items: item } },
    { new: true }
  );
}
