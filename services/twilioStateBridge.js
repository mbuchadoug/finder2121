import Business from "../models/business.js";
import UserSession from "../models/userSession.js";
import Client from "../models/client.js";

/**
 * Continue Twilio-style state machine for Meta text input
 */
export async function continueTwilioFlow({ from, text }) {
  const phone = from.replace(/\D+/g, "");
  const session = await UserSession.findOne({ phone });
  if (!session?.activeBusinessId) return false;

  const biz = await Business.findById(session.activeBusinessId);
  if (!biz || !biz.sessionState) return false;

  const trimmed = text.trim();
  const state = biz.sessionState;

  /* ===========================
     CLIENT CREATION (INVOICE)
  ============================ */
  if (state === "creating_invoice_new_client") {
    biz.sessionData.clientName = trimmed;
    biz.sessionState = "creating_invoice_new_client_phone";
    await biz.save();
    return true;
  }

  if (state === "creating_invoice_new_client_phone") {
    const phoneVal = trimmed.toLowerCase() === "same" ? phone : trimmed;

    const client = await Client.findOneAndUpdate(
      { businessId: biz._id, phone: phoneVal },
      { $set: { name: biz.sessionData.clientName, phone: phoneVal } },
      { upsert: true, new: true }
    );

    biz.sessionData.client = client;
    biz.sessionState = "creating_invoice_add_items";
    biz.sessionData.items = [];
    biz.sessionData.awaitingItemDesc = false;
    await biz.save();
    return true;
  }

  /* ===========================
     ITEM ADDING (THIS WAS MISSING)
  ============================ */
  if (state === "creating_invoice_add_items") {
    // expecting description
    if (!biz.sessionData.awaitingItemDesc) {
      biz.sessionData.lastItem = { description: trimmed };
      biz.sessionData.awaitingItemDesc = true;
      await biz.save();
      return true;
    }

    // expecting qty
    const qty = Number(trimmed);
    if (isNaN(qty) || qty <= 0) return true;

    biz.sessionData.items.push({
      item: biz.sessionData.lastItem.description,
      qty,
      unit: 0
    });

    biz.sessionData.lastItem = null;
    biz.sessionData.awaitingItemDesc = false;
    biz.sessionState = "creating_invoice_confirm";
    await biz.save();
    return true;
  }

  /* ===========================
     CONFIRMATION → PDF
  ============================ */
  if (state === "creating_invoice_confirm") {
    if (trimmed === "send") {
      // you already have this logic in twilio_biz
      // we just allow it to continue
      return true;
    }
  }

  return false;
}
