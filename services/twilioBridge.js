import Business from "../models/business.js";
import UserSession from "../models/userSession.js";
import { sendText } from "./metaSender.js";

async function bootDocumentFlow(phone, docType) {
  const session = await UserSession.findOne({ phone });
  const biz = await Business.findById(session?.activeBusinessId);
  if (!biz) throw new Error("Business not found");

  biz.sessionState = "creating_invoice_choose_client";
  biz.sessionData = { docType, items: [] };
  await biz.save();

  return sendText(
    phone,
    `${docType === "invoice" ? "Invoice" :
      docType === "receipt" ? "Receipt" : "Quotation"}:\n` +
    "1) Use saved client\n" +
    "2) New client\n" +
    "3) Cancel"
  );
}

export const startInvoiceFlow = (p) => bootDocumentFlow(p, "invoice");
export const startReceiptFlow = (p) => bootDocumentFlow(p, "receipt");
export const startQuoteFlow   = (p) => bootDocumentFlow(p, "quote");
