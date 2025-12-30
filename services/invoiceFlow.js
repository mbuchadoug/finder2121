import Business from "../models/business.js";
import UserSession from "../models/userSession.js";
import { sendText } from "./metaSender.js";

/**
 * Meta → Start invoice
 * Reuses Twilio logic by setting the SAME sessionState
 */
export async function startInvoiceFlow(to) {
  const phone = to.replace(/\D+/g, "");

  const session = await UserSession.findOne({ phone });
  if (!session?.activeBusinessId) {
    return sendText(to, "❌ No active business. Reply *menu*.");
  }

  const biz = await Business.findById(session.activeBusinessId);
  if (!biz) {
    return sendText(to, "❌ Business not found.");
  }

  biz.sessionState = "creating_invoice_choose_client";
  biz.sessionData = { docType: "invoice", items: [] };
  await biz.save();

  return sendText(
    to,
    "📄 New Invoice\n\n1️⃣ Use saved client\n2️⃣ New client\n3️⃣ Cancel"
  );
}
