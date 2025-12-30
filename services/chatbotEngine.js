import { ACTIONS } from "./actions.js";
import { startInvoiceFlow } from "./invoiceFlow.js";
import { startReceiptFlow } from "./receiptFlow.js";
import { startClientFlow } from "./clientFlow.js";

import {
  sendMainMenu,
  sendSalesMenu,
  sendClientsMenu,
  sendPaymentsMenu,
  sendBusinessMenu,
  sendSettingsMenu
} from "./metaMenus.js";

export async function handleIncomingMessage({ from, action }) {
  const a = (action || "").toLowerCase();

  // Entry
  if (!a || ["hi", "hello", "menu"].includes(a)) {
    return sendMainMenu(from);
  }

  // Meta-only action mapping to existing Twilio flow
if (a === "inv_use_client") {
  return handleChooseSavedClient(from);
}

if (a === "inv_new_client") {
  return handleNewClientFromInvoice(from);
}

if (a === "inv_cancel") {
  return sendMainMenu(from);
}


  switch (a) {

    /* MAIN */
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

    /* SALES FLOWS */
    case ACTIONS.NEW_INVOICE:
      return startInvoiceFlow(from);

    case ACTIONS.NEW_QUOTE:
      return startQuoteFlow(from);

    case ACTIONS.NEW_RECEIPT:
      return startReceiptFlow(from);

    /* CLIENT FLOWS */
    case ACTIONS.ADD_CLIENT:
      return startClientFlow(from);

    case ACTIONS.CLIENT_STATEMENT:
      return startClientStatementFlow(from);

    default:
      return sendMainMenu(from);
  }
}
