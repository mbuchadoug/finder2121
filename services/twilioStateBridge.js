import Business from "../models/business.js";
import UserSession from "../models/userSession.js";
import Client from "../models/client.js";
import { sendText } from "./metaSender.js";
import { sendInvoiceConfirmMenu } from "./metaMenus.js";

// ...


 import { sendButtons } from "./metaSender.js";
import { ACTIONS } from "./actions.js";

async function saveBizSafe(biz) {
  if (!biz) return;
  biz.markModified("sessionData");
  return biz.save();
}

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
   META BUTTON ACTION HANDLER
   (THIS WAS MISSING)
=========================== */
if (text && Object.values(ACTIONS).includes(text)) {

  switch (text) {

    case ACTIONS.INV_ADD_ANOTHER_ITEM:
      biz.sessionState = "creating_invoice_add_items";
      await saveBizSafe(biz);
      await sendText(from, "Send item description:");
      return true;

    case ACTIONS.INV_ENTER_PRICES:
      biz.sessionState = "creating_invoice_enter_prices";
      biz.sessionData.priceIndex = 0;
      await saveBizSafe(biz);
      await sendText(
        from,
        `Enter price for:\n${biz.sessionData.items?.[0]?.item}`
      );
      return true;

    case ACTIONS.INV_SET_DISCOUNT:
      biz.sessionState = "creating_invoice_set_discount";
      await saveBizSafe(biz);
      await sendText(from, "Enter discount % (e.g. 10):");
      return true;

    case ACTIONS.INV_SET_VAT:
      biz.sessionState = "creating_invoice_set_vat";
      await saveBizSafe(biz);
      await sendText(from, "Enter VAT % (e.g. 15):");
      return true;

    case ACTIONS.INV_GENERATE_PDF:
      biz.sessionState = "creating_invoice_confirm";
      await saveBizSafe(biz);
      return true;

    case ACTIONS.INV_CANCEL:
      biz.sessionState = "ready";
      biz.sessionData = {};
      await saveBizSafe(biz);
      await sendText(from, "❌ Cancelled. Reply *menu* to continue.");
      return true;
  }
}


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

  // ======================
  // EXPECT DESCRIPTION
  // ======================
  if (!biz.sessionData.expectingQty) {

    // reject numbers as descriptions
    if (!isNaN(Number(trimmed))) {
      await sendText(from, "Please send an item description (not a number).");
      return true;
    }

    biz.sessionData.lastItem = { description: trimmed };
    biz.sessionData.expectingQty = true;

    await saveBizSafe(biz);

    await sendText(from, "Enter quantity (e.g. 1):");
    return true;
  }

  // ======================
  // EXPECT QUANTITY
  // ======================
  const qty = Number(trimmed);

  if (isNaN(qty) || qty <= 0) {
    await sendText(from, "Invalid quantity. Enter a number like 1:");
    return true;
  }

  biz.sessionData.items = biz.sessionData.items || [];
  biz.sessionData.items.push({
    item: biz.sessionData.lastItem.description,
    qty,
    unit: 0
  });

  // ✅ CLEAR FLAGS
  biz.sessionData.lastItem = null;
  biz.sessionData.expectingQty = false;

  biz.sessionState = "creating_invoice_confirm";
  await saveBizSafe(biz);



await sendButtons(from, "Item added ✅", [
  { id: ACTIONS.INV_ADD_ANOTHER_ITEM, title: "➕ Add another item" },
  { id: ACTIONS.INV_ENTER_PRICES, title: "💰 Enter prices" },
  { id: ACTIONS.INV_CANCEL, title: "❌ Cancel" }
]);



  return true;
}


/* ===========================
   PRICE ENTRY
=========================== */
if (state === "creating_invoice_enter_prices") {

  const price = Number(trimmed);

  if (isNaN(price) || price < 0) {
    await sendText(from, "Invalid price. Enter a number (e.g. 500):");
    return true;
  }

  biz.sessionData.priceIndex = biz.sessionData.priceIndex || 0;

  biz.sessionData.items[biz.sessionData.priceIndex].unit = price;
  biz.sessionData.priceIndex++;

  // More items need prices
  if (biz.sessionData.priceIndex < biz.sessionData.items.length) {
    await saveBizSafe(biz);
    return sendText(
      from,
      `Enter price for:\n${biz.sessionData.items[biz.sessionData.priceIndex].item}`
    );
  }

  // ✅ All prices captured
  biz.sessionState = "creating_invoice_confirm";
  biz.sessionData.priceIndex = 0;
  await saveBizSafe(biz);

  // Build summary text
  const summary = biz.sessionData.items
    .map(
      (i, idx) =>
        `${idx + 1}) ${i.item} x${i.qty} @ ${i.unit}`
    )
    .join("\n");

  return sendInvoiceConfirmMenu(
    from,
    `🧾 Invoice Summary\n\n${summary}`
  );
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
