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

export async function continueTwilioFlow({ from, text }) {
  const phone = from.replace(/\D+/g, "");
  const session = await UserSession.findOne({ phone });
  if (!session?.activeBusinessId) return false;

  const biz = await Business.findById(session.activeBusinessId);
  if (!biz || !biz.sessionState) return false;

  const trimmed = text.trim();
  const state = biz.sessionState;

  /* =========================
     CLIENT CREATION
  ========================= */
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
    await biz.save();
    return true;
  }

  /* =========================
     ITEM ADDING
  ========================= */
  if (state === "creating_invoice_add_items") {
    if (!biz.sessionData.expectingQty) {
      if (!isNaN(Number(trimmed))) {
        await sendText(from, "Please send an item description.");
        return true;
      }

      biz.sessionData.lastItem = trimmed;
      biz.sessionData.expectingQty = true;
      await saveBizSafe(biz);
      await sendText(from, "Enter quantity:");
      return true;
    }

    const qty = Number(trimmed);
    if (isNaN(qty) || qty <= 0) {
      await sendText(from, "Invalid quantity.");
      return true;
    }

    biz.sessionData.items.push({
      item: biz.sessionData.lastItem,
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

  /* =========================
     PRICE ENTRY
  ========================= */
  if (state === "creating_invoice_enter_prices") {
    const price = Number(trimmed);
    if (isNaN(price) || price < 0) {
      await sendText(from, "Invalid price.");
      return true;
    }

    const i = biz.sessionData.priceIndex || 0;
    biz.sessionData.items[i].unit = price;
    biz.sessionData.priceIndex = i + 1;

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

  /* =========================
     CONFIRM ACTIONS
  ========================= */
  if (state === "creating_invoice_confirm") {

    if (trimmed === ACTIONS.INV_SET_DISCOUNT) {
      biz.sessionState = "creating_invoice_set_discount";
      await saveBizSafe(biz);
      await sendText(from, "Enter discount %:");
      return true;
    }

    if (trimmed === ACTIONS.INV_SET_VAT) {
      biz.sessionState = "creating_invoice_set_vat";
      await saveBizSafe(biz);
      await sendText(from, "Enter VAT %:");
      return true;
    }

    if (trimmed === ACTIONS.INV_GENERATE_PDF) {
      const { filename } = await generatePDF({
        type: "invoice",
        number: `INV-${Date.now()}`,
        date: new Date(),
        billingTo: biz.sessionData.client?.name || "Client",
        items: biz.sessionData.items,
        bizMeta: {
          name: biz.name,
          logoUrl: biz.logoUrl,
          address: biz.address || "",
          discountPercent: biz.sessionData.discountPercent || 0,
          vatPercent: biz.sessionData.vatPercent || 0,
          _id: biz._id.toString()
        }
      });

      const url = `${process.env.SITE_URL}/docs/generated/invoices/${filename}`;
      await sendDocument(from, { link: url, filename });

      biz.sessionState = "ready";
      biz.sessionData = {};
      await saveBizSafe(biz);
      return true;
    }
  }

  /* =========================
     DISCOUNT / VAT INPUT
  ========================= */
  if (state === "creating_invoice_set_discount") {
    biz.sessionData.discountPercent = Number(trimmed) || 0;
    biz.sessionState = "creating_invoice_confirm";
    await saveBizSafe(biz);
    return sendInvoiceConfirmMenu(from, "Discount applied.");
  }

  if (state === "creating_invoice_set_vat") {
    biz.sessionData.vatPercent = Number(trimmed) || 0;
    biz.sessionState = "creating_invoice_confirm";
    await saveBizSafe(biz);
    return sendInvoiceConfirmMenu(from, "VAT applied.");
  }

  return false;
}
