import Business from "../models/business.js";
import UserSession from "../models/userSession.js";
import Client from "../models/client.js";
import { sendList, sendText } from "./metaSender.js";

/**
 * Replaces: "1) Use saved client"
 */
export async function handleChooseSavedClient(to) {
  const phone = to.replace(/\D+/g, "");
  const session = await UserSession.findOne({ phone });
  const biz = await Business.findById(session?.activeBusinessId);

  const clients = await Client.find({ businessId: biz._id })
    .sort({ updatedAt: -1 })
    .limit(10)
    .lean();

  if (!clients.length) {
    biz.sessionState = "creating_invoice_new_client";
    await biz.save();
    return sendText(to, "No saved clients. Enter client name:");
  }

  biz.sessionState = "creating_invoice_choose_client_index";
  biz.sessionData.recentClients = clients;
  await biz.save();

  return sendList(
    to,
    "Select client",
    clients.map(c => ({
      id: `CLIENT_${c._id}`,
      title: c.name || c.phone
    }))
  );
}
