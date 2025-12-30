import Invoice from "../../models/invoice.js";


export async function createDraftInvoice({ businessId, createdBy }) {
  return Invoice.create({
    businessId,
    createdBy,
    status: "draft",
    items: []
  });
}