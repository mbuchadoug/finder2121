import { ACTIONS } from "./actions.js";
import { startInvoiceFlow } from "./invoiceFlow.js";
import { startReceiptFlow } from "./invoiceFlow.js";
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

  /* =========================
     ENTRY
  ========================= */
  if (!al || ["hi", "hello", "menu"].includes(al)) {
    return sendMainMenu(from);
  }

  /* =========================
     CLIENT SELECTION (META)
  ========================= */
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

  /* =========================
     META → TWILIO CONFIRM BRIDGE
     (THIS FIXES PDF / VAT / DISCOUNT)
  ========================= */

  if (al === "inv_generate_pdf") {
    return continueTwilioFlow({ from, text: "2" });
  }

  if (al === "inv_set_discount") {
    return continueTwilioFlow({ from, text: "4" });
  }

  if (al === "inv_set_vat") {
    return continueTwilioFlow({ from, text: "5" });
  }

  if (al === "inv_cancel") {
    return continueTwilioFlow({ from, text: "3" });
  }

  /* =========================
     INVOICE ITEM SHORTCUTS
  ========================= */
  if (a === ACTIONS.INV_ADD_ANOTHER_ITEM) {
    const biz = await getBizForPhone(from);
    biz.sessionState = "creating_invoice_add_items";
    await saveBizSafe(biz);
    return sendText(from, "Send item description:");
  }

  if (a === ACTIONS.INV_ENTER_PRICES) {
    const biz = await getBizForPhone(from);
    biz.sessionState = "creating_invoice_enter_prices";
    biz.sessionData.priceIndex = 0;
    await saveBizSafe(biz);

    const item = biz.sessionData.items?.[0];
    return sendText(
      from,
      `Enter price for:\n${item.item} x${item.qty}`
    );
  }

  /* =========================
     TEXT → TWILIO ENGINE
     (DO NOT BLOCK NUMBERS)
  ========================= */

  const metaMenuOnlyActions = [
    ACTIONS.SALES_MENU,
    ACTIONS.CLIENTS_MENU,
    ACTIONS.PAYMENTS_MENU,
    ACTIONS.BUSINESS_MENU,
    ACTIONS.SETTINGS_MENU,
    ACTIONS.BACK,
    ACTIONS.NEW_INVOICE,
    ACTIONS.NEW_RECEIPT,
    ACTIONS.ADD_CLIENT
  ];

  const shouldSkipTwilio =
    al.startsWith("client_") ||
    metaMenuOnlyActions.includes(a);

  if (!shouldSkipTwilio) {
    const handled = await continueTwilioFlow({
      from,
      text: action
    });
    if (handled) return;
  }

  /* =========================
     MENUS
  ========================= */
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
