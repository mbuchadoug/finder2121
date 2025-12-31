import Business from "../models/business.js";
import UserSession from "../models/userSession.js";
import Client from "../models/client.js";
import { sendList, sendText } from "./metaSender.js";

/**
 * Meta: Use saved client
 * Maps to Twilio state: creating_invoice_choose_client_index
 */
export async function handleChooseSavedClient(to) {
  const phone = to.replace(/\D+/g, "");
  const session = await UserSession.findOne({ phone });
  const biz = await Business.findById(session?.activeBusinessId);

  if (!biz) return sendText(to, "❌ No active business.");

  const clients = await Client.find({ businessId: biz._id })
    .sort({ updatedAt: -1 })
    .limit(10)
    .lean();

  if (!clients.length) {
    biz.sessionState = "creating_invoice_new_client";
    biz.sessionData = biz.sessionData || {};
    biz.markModified("sessionData");
    await biz.save();
    return sendText(to, "No saved clients. Enter client name:");
  }

  biz.sessionState = "creating_invoice_choose_client_index";
  biz.sessionData.recentClients = clients;
  biz.markModified("sessionData");
  await biz.save();

  return sendList(
    to,
    "Select client",
    clients.map(c => ({
      id: `client_${c._id}`,   // ✅ FIXED
      title: c.name || c.phone
    }))
  );
}


/**
 * Meta: New client from invoice
 * Maps to Twilio state: creating_invoice_new_client
 */
export async function handleNewClientFromInvoice(to) {
  const phone = to.replace(/\D+/g, "");
  const session = await UserSession.findOne({ phone });
  const biz = await Business.findById(session?.activeBusinessId);

  if (!biz) return sendText(to, "❌ No active business.");

  biz.sessionState = "creating_invoice_new_client";
  biz.sessionData = {};
  await biz.save();

  return sendText(to, "Enter client name:");
}

/**
 * Meta: client picked from list
 */
export async function handleClientPicked(to, clientId) {
  const phone = to.replace(/\D+/g, "");
  const session = await UserSession.findOne({ phone });
  const biz = await Business.findById(session?.activeBusinessId);

  const client = await Client.findById(clientId);
  if (!client) return sendText(to, "Client not found.");

  biz.sessionData.client = client;
  biz.sessionState = "creating_invoice_add_items";
  await biz.save();

  return sendText(
    to,
    `Client set to ${client.name}.\n\nSend item description (e.g. "Website design").`
  );
}
