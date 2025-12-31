import { ACTIONS } from "./actions.js";
import { startInvoiceFlow } from "./invoiceFlow.js";
import { startReceiptFlow } from "./receiptFlow.js";
import { continueTwilioFlow } from "./twilioStateBridge.js";

import { startClientFlow } from "./clientFlow.js";
import {
  handleChooseSavedClient,
  handleNewClientFromInvoice,
  handleClientPicked
} from "./invoiceAdapters.js";

import {
  sendMainMenu,
  sendSalesMenu,
  sendClientsMenu,
  sendPaymentsMenu,
  sendBusinessMenu,
  sendSettingsMenu
} from "./metaMenus.js";

import { getBizForPhone, saveBizSafe } from "./bizHelpers.js";
import { sendText } from "./metaSender.js";

export async function handleIncomingMessage({ from, action }) {
  const a = action || "";
  const al = a.toLowerCase();

  const biz = await getBizForPhone(from);

  /* =====================================================
     1️⃣ GLOBAL ENTRY
  ===================================================== */
  if (!al || ["hi", "hello", "menu"].includes(al)) {
    return sendMainMenu(from);
  }

  /* =====================================================
     2️⃣ MENU BUTTONS — ALWAYS FIRST (🔥 FIX)
  ===================================================== */
  switch (a) {
    case ACTIONS.SALES_MENU:
      return sendSalesMenu(from);

    case ACTIONS.CLIENTS_MENU:
      return sendClientsMenu(from);

    case ACTIONS.PAYMENTS_MENU:
      return sendPaymentsMenu(from);

    case ACTIONS.BUSINESS_MENU:
      return sendBusinessMenu(from);

    case ACTIONS.SETTINGS_MENU:
      return sendSettingsMenu(from);

    case ACTIONS.BACK:
      return sendMainMenu(from);
  }

  /* =====================================================
     3️⃣ INVOICE META ACTIONS (BUTTONS)
  ===================================================== */
  if (al === "inv_use_client") {
    await handleChooseSavedClient(from);
    return;
  }

  if (al === "inv_new_client") {
    await handleNewClientFromInvoice(from);
    return;
  }

  if (al.startsWith("client_")) {
    await handleClientPicked(from, al.replace("client_", ""));
    return;
  }

  if (a === ACTIONS.INV_ADD_ANOTHER_ITEM) {
    biz.sessionState = "creating_invoice_add_items";
    await saveBizSafe(biz);
    return sendText(from, "Send item description:");
  }

  if (a === ACTIONS.INV_ENTER_PRICES) {
    biz.sessionState = "creating_invoice_enter_prices";
    biz.sessionData.priceIndex = 0;
    await saveBizSafe(biz);

    const item = biz.sessionData.items?.[0];
    return sendText(from, `Enter price for:\n${item.item} x${item.qty}`);
  }

  if (a === "inv_generate_pdf") {
    await sendText(from, "📄 Generating invoice PDF...");
    await continueTwilioFlow({ from, text: "2" });
    return;
  }

  if (a === "inv_set_discount") {
    biz.sessionState = "creating_invoice_set_discount";
    await saveBizSafe(biz);
    return sendText(from, "Enter discount percent (0–100):");
  }

  if (a === "inv_set_vat") {
    biz.sessionState = "creating_invoice_set_vat";
    await saveBizSafe(biz);
    return sendText(from, "Enter VAT percent (0–100):");
  }

  if (al === "inv_cancel") {
    biz.sessionState = "ready";
    biz.sessionData = {};
    await saveBizSafe(biz);
    return sendMainMenu(from);
  }

  /* =====================================================
     4️⃣ FREE TEXT → TWILIO STATE ENGINE ONLY
     (🔥 THIS IS THE KEY)
  ===================================================== */
  const isFreeText =
    !al.startsWith("inv_") &&
    !al.startsWith("client_") &&
    !Object.values(ACTIONS).includes(a);

  if (isFreeText) {
    const handled = await continueTwilioFlow({
      from,
      text: action
    });
    if (handled) return;
  }

  /* =====================================================
     5️⃣ FLOW STARTERS
  ===================================================== */
  switch (a) {
    case ACTIONS.NEW_INVOICE:
      return startInvoiceFlow(from);

    case ACTIONS.NEW_RECEIPT:
      return startReceiptFlow(from);

    case ACTIONS.ADD_CLIENT:
      return startClientFlow(from);

    default:
      return sendMainMenu(from);
  }
}
