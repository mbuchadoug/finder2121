// services/chatbotEngine.js
import { ACTIONS } from "./actions.js";
import {
  sendMainMenu,
  sendSalesMenu,
  sendClientsMenu,
  sendPaymentsMenu,
  sendBusinessMenu,
  sendSettingsMenu
} from "./metaMenus.js";

import { startInvoiceFlow } from "./invoiceFlow.js";
import { startReceiptFlow } from "./receiptFlow.js";
import { startClientFlow } from "./clientFlow.js";

import { getBizForPhone, saveBizSafe } from "./bizHelpers.js";
import { sendText } from "./metaSender.js";

/**
 * IMPORTANT ARCHITECTURE RULE
 * ---------------------------
 * - This file NEVER continues Twilio state logic
 * - This file NEVER processes free text for invoices
 * - This file ONLY:
 *    • shows menus
 *    • starts flows
 *    • handles button actions
 */

export async function handleIncomingMessage({ from, action }) {
  const a = action || "";
  const al = a.toLowerCase();

  const biz = await getBizForPhone(from);

  /* =====================================================
     1️⃣ GLOBAL ENTRY (SAFE)
  ===================================================== */
  if (!al || ["hi", "hello", "menu"].includes(al)) {
    return sendMainMenu(from);
  }

  /* =====================================================
     2️⃣ MAIN MENU NAVIGATION (SAFE)
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
     3️⃣ SALES ACTIONS (STARTERS ONLY)
     ❗ NO STATE CONTINUATION HERE
  ===================================================== */
  switch (a) {
    case ACTIONS.NEW_INVOICE:
      // Starts invoice, then Meta STOPS
      return startInvoiceFlow(from);

    case ACTIONS.NEW_RECEIPT:
      return startReceiptFlow(from);

    case ACTIONS.NEW_QUOTE:
      // Quotes reuse invoice flow logic on Twilio side
      return startInvoiceFlow(from);

    case ACTIONS.ADD_CLIENT:
      return startClientFlow(from);
  }

  /* =====================================================
     4️⃣ INVOICE BUTTON ACTIONS (SAFE)
     These ONLY update state and prompt.
     Twilio handles actual logic after.
  ===================================================== */
  if (!biz) {
    return sendMainMenu(from);
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
    if (!item) {
      return sendText(from, "No items found. Send item description first.");
    }

    return sendText(
      from,
      `Enter price for:\n${item.item} x${item.qty}`
    );
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

  if (a === "inv_cancel") {
    biz.sessionState = "ready";
    biz.sessionData = {};
    await saveBizSafe(biz);
    return sendMainMenu(from);
  }

  /* =====================================================
     5️⃣ HARD STOP
     ❌ NO FREE TEXT HANDLING
     ❌ NO continueTwilioFlow
     ❌ NO FALLTHROUGH INTO TWILIO LOGIC
  ===================================================== */

  return sendMainMenu(from);
}
