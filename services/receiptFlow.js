import Business from "../models/business.js";
import UserSession from "../models/userSession.js";
import { sendText } from "./metaSender.js";

export async function startReceiptFlow(to) {
  const phone = to.replace(/\D+/g, "");
  const session = await UserSession.findOne({ phone });

  const biz = await Business.findById(session?.activeBusinessId);
  if (!biz) return sendText(to, "❌ No active business.");

  biz.sessionState = "creating_invoice_choose_client";
  biz.sessionData = { docType: "receipt", items: [] };
  await biz.save();

  return sendText(
    to,
    "🧾 New Receipt\n\n1️⃣ Use saved client\n2️⃣ New client\n3️⃣ Cancel"
  );
}
