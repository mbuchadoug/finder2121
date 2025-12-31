import Business from "../models/business.js";
import UserSession from "../models/userSession.js";
import Client from "../models/client.js";
import { sendText } from "./metaSender.js";
import { sendInvoiceConfirmMenu } from "./metaMenus.js";
import { generatePDF } from "../routes/twilio_biz.js";
import { sendDocument } from "./metaSender.js";



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



  /* ===========================
     CLIENT CREATION (INVOICE)
  ============================ */
  if (state === "creating_invoice_new_client") {
    biz.sessionData.clientName = trimmed;
    biz.sessionState = "creating_invoice_new_client_phone";
    await biz.save();

     await sendText(
   from,
   "Enter client phone number (or type *same* to use this WhatsApp number):"
 );
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

 await sendText(
   from,
   `Client saved: ${client.name || client.phone}\n\nSend item description (e.g. Website design)`
 );

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


/* ===========================
   CONFIRMATION → GENERATE PDF
=========================== */
if (state === "creating_invoice_confirm" && trimmed === "2") {

  // 🔒 SAFELY RESOLVE CLIENT (object OR ID)
  let client = biz.sessionData.client;

  if (!client && biz.sessionData.clientId) {
    client = await Client.findById(biz.sessionData.clientId);
  }

  if (!client) {
    await sendText(
      from,
      "❌ Client information is missing. Please restart the invoice."
    );
    return true;
  }

  const items = biz.sessionData.items || [];

  if (!items.length) {
    await sendText(from, "❌ No items found for this invoice.");
    return true;
  }

  const number = `INV-${Date.now()}`;

  const { filename } = await generatePDF({
    type: "invoice",
    number,
    date: new Date(),
    billingTo: client.name || client.phone || "Client",
    items,
    bizMeta: {
      name: biz.name,
      logoUrl: biz.logoUrl,
      address: biz.address || "",
      discountPercent: biz.sessionData.discountPercent || 0,
      vatPercent: biz.sessionData.vatPercent || 0,
      applyVat: biz.sessionData.applyVat !== false,
      _id: biz._id.toString()
    }
  });

  const site = (process.env.SITE_URL || "").replace(/\/$/, "");
  const url = `${site}/docs/generated/invoices/${filename}`;

  // 📎 SEND PDF (META)
  await sendDocument(from, {
    link: url,
    filename
  });

  // ♻️ CLEAN RESET
  biz.sessionState = "ready";
  biz.sessionData = {};
  await saveBizSafe(biz);

  return true;
}




/* ===========================
   SET DISCOUNT %
=========================== */
if (state === "creating_invoice_set_discount") {
  const pct = Number(trimmed);

  if (isNaN(pct) || pct < 0 || pct > 100) {
    await sendText(from, "❌ Invalid discount. Enter a percent (0–100):");
    return true;
  }

  biz.sessionData.discountPercent = pct;
  biz.sessionState = "creating_invoice_confirm";
  await saveBizSafe(biz);

  const summary = biz.sessionData.items
    .map((i, idx) => `${idx + 1}) ${i.item} x${i.qty} @ ${i.unit}`)
    .join("\n");

  return sendInvoiceConfirmMenu(
    from,
    `🧾 Invoice Summary\n\n${summary}\n\n💸 Discount: ${pct}%`
  );
}

/* ===========================
   SET VAT %
=========================== */
if (state === "creating_invoice_set_vat") {
  const pct = Number(trimmed);

  if (isNaN(pct) || pct < 0 || pct > 100) {
    await sendText(from, "❌ Invalid VAT. Enter a percent (0–100):");
    return true;
  }

  biz.sessionData.vatPercent = pct;
  biz.sessionData.applyVat = pct > 0;
  biz.sessionState = "creating_invoice_confirm";
  await saveBizSafe(biz);

  const summary = biz.sessionData.items
    .map((i, idx) => `${idx + 1}) ${i.item} x${i.qty} @ ${i.unit}`)
    .join("\n");

  return sendInvoiceConfirmMenu(
    from,
    `🧾 Invoice Summary\n\n${summary}\n\n🧾 VAT: ${pct}%`
  );
}


  return false;
}
