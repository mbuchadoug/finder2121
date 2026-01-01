import Business from "../models/business.js";
import UserSession from "../models/userSession.js";
import Invoice from "../models/invoice.js"; // adjust if your model name differs
import { sendList, sendText } from "./metaSender.js";

export async function showUnpaidInvoices(from) {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  const invoices = await Invoice.find({
    businessId: biz._id,
    balance: { $gt: 0 }
  }).limit(10);

  if (!invoices.length) {
    return sendText(from, "✅ No unpaid invoices.");
  }

  biz.sessionState = "payment_choose_invoice";
  biz.sessionData = {};
  await saveBizSafe(biz);

  return sendList(
    from,
    "Select invoice to record payment",
    invoices.map(inv => ({
      id: `payinv_${inv._id}`,   // 🔥 ObjectId
      title: `${inv.number}`,
      description: `Balance: ${inv.balance} ${inv.currency}`
    }))
  );
}
