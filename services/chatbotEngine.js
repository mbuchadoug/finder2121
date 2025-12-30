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

// helpers you already use elsewhere
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
     META LIST / BUTTON ACTIONS
     (MUST HARD RETURN)
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

    const item = biz.sessionData.items[0];
    return sendText(
      from,
      `Enter price for:\n${item.item} x${item.qty}`
    );
  }

  if (al === "inv_cancel") {
    const biz = await getBizForPhone(from);
    biz.sessionState = null;
    biz.sessionData = {};
    biz.markModified("sessionData");
    await biz.save();
    return sendMainMenu(from);
  }

  /* =========================
     TEXT → TWILIO FLOW
  ========================= */

  const isMetaAction =
    al.startsWith("inv_") ||
    al.startsWith("client_") ||
    Object.values(ACTIONS).includes(a);

  if (!isMetaAction) {
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
