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

/**
 * Meta webhook dispatcher
 * IMPORTANT:
 * - Meta does NOT control invoice logic
 * - Meta only routes menus and forwards input to Twilio engine
 */
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
     META-ONLY ROUTING
     (NO INVOICE STATE MUTATION)
  ========================= */

  // Invoice: use saved client
  if (al === "inv_use_client") {
    await handleChooseSavedClient(from);
    return;
  }

  // Invoice: add new client
  if (al === "inv_new_client") {
    await handleNewClientFromInvoice(from);
    return;
  }

  // Invoice: client selected from list
  if (al.startsWith("client_")) {
    await handleClientPicked(from, al.replace("client_", ""));
    return;
  }

  /* =========================
     PASS EVERYTHING ELSE
     TO TWILIO STATE MACHINE
  ========================= */

  const isMetaMenuAction =
    Object.values(ACTIONS).includes(a) ||
    al.startsWith("client_");

  if (!isMetaMenuAction) {
    const handled = await continueTwilioFlow({
      from,
      text: action
    });
    if (handled) return;
  }

  /* =========================
     MAIN MENUS
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

    /* =========================
       START FLOWS
    ========================= */

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
