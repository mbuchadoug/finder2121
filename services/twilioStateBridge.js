import Business from "../models/business.js";
import UserSession from "../models/userSession.js";
import Client from "../models/client.js";
import { sendText, sendButtons, sendDocument } from "./metaSender.js";
import { sendInvoiceConfirmMenu } from "./metaMenus.js";
import { generatePDF } from "../routes/twilio_biz.js";
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


  /* ======================================================
   META → TWILIO CONFIRM MENU BRIDGE (CRITICAL)
====================================================== */

if (biz.sessionState === "creating_invoice_confirm") {

  // ➕ Add item
  if (trimmed === "inv_add_item") {
    return continueTwilioFlow({ from, text: "1" });
  }

  // 📄 Generate PDF
  if (trimmed === "inv_generate_pdf") {
    return continueTwilioFlow({ from, text: "2" });
  }

  // ❌ Cancel
  if (trimmed === "inv_cancel") {
    return continueTwilioFlow({ from, text: "3" });
  }

  // 💸 Discount
  if (trimmed === "inv_set_discount") {
    return continueTwilioFlow({ from, text: "4" });
  }

  // 🧾 VAT
  if (trimmed === "inv_set_vat") {
    return continueTwilioFlow({ from, text: "5" });
  }
}

  /* ======================================================
     🔹 ADDED: META CONFIRM BUTTON → TWILIO BRIDGE
     This maps Meta button IDs to Twilio numeric flow
  ====================================================== */
  if (state === "creating_invoice_confirm" && trimmed === "inv_generate_pdf") {
    // behave exactly like user typed "2" in Twilio
    return continueTwilioFlow({ from, text: "2" });
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
     ITEM ADDING
  ============================ */
  if (state === "creating_invoice_add_items") {

    // EXPECT DESCRIPTION
    if (!biz.sessionData.expectingQty) {
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

    // EXPECT QUANTITY
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
  ============================ */
  if (state === "creating_invoice_enter_prices") {
    const price = Number(trimmed);

    if (isNaN(price) || price < 0) {
      await sendText(from, "Invalid price. Enter a number (e.g. 500):");
      return true;
    }

    biz.sessionData.priceIndex = biz.sessionData.priceIndex || 0;
    biz.sessionData.items[biz.sessionData.priceIndex].unit = price;
    biz.sessionData.priceIndex++;

    if (biz.sessionData.priceIndex < biz.sessionData.items.length) {
      await saveBizSafe(biz);
      return sendText(
        from,
        `Enter price for:\n${biz.sessionData.items[biz.sessionData.priceIndex].item}`
      );
    }

    biz.sessionState = "creating_invoice_confirm";
    biz.sessionData.priceIndex = 0;
    await saveBizSafe(biz);

    const summary = biz.sessionData.items
      .map((i, idx) => `${idx + 1}) ${i.item} x${i.qty} @ ${i.unit}`)
      .join("\n");

    return sendInvoiceConfirmMenu(
      from,
      `🧾 Invoice Summary\n\n${summary}`
    );
  }

  /* ===========================
     CONFIRMATION → PDF
  ============================ */



  /* ======================================================
   🔹 META → TWILIO BRIDGE (DISCOUNT & VAT)
====================================================== */

// Meta "Set Discount" button


// Meta "Set VAT" button


  return false;
}
