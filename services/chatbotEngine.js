import {
  startClientFlow,
  handleClientName,
  handleClientPhone
} from "./clientFlow.js";



import {
  startInvoiceFlow,
  handleClientSelection,
  handleAddItem,
  handleQty,
  handlePrice,
  finalizeInvoice
} from "./invoiceFlow.js";

import { getSession } from "./sessionStore.js";

import {
  sendOwnerMainMenu,
  sendDocumentsMenu,
  sendPaymentsMenu,
  sendBusinessMenu
} from "./metaMenus.js";

export async function handleIncomingMessage({ from, action }) {
  const normalizedAction =
    typeof action === "string" ? action.trim().toLowerCase() : "";

  const session = getSession(from);

  /* ===== FORMS FIRST ===== */
  if (session?.step === "client_name") {
    return handleClientName(from, action);
  }

  if (session?.step === "client_phone") {
    return handleClientPhone(from, action);
  }

  if (session?.step === "enter_price" && /^\d+$/.test(normalizedAction)) {
    return handlePrice(from, Number(normalizedAction));
  }

  /* ===== ENTRY ===== */
  if (!normalizedAction || ["hi", "hello", "menu"].includes(normalizedAction)) {
    return sendOwnerMainMenu(from);
  }

  switch (normalizedAction) {
    case "documents":
      return sendDocumentsMenu(from);

    case "new_invoice":
      return startInvoiceFlow(from);

    case "client_new":
      return startClientFlow(from);

    case "client_1":
    case "client_2":
      return handleClientSelection(from, normalizedAction);

    case "item_service":
    case "item_product":
      return handleAddItem(from, normalizedAction.replace("item_", ""));

    case "qty_1":
    case "qty_2":
    case "qty_5":
      return handleQty(from, Number(normalizedAction.replace("qty_", "")));

    case "send_invoice":
      return finalizeInvoice(from);

    case "cancel":
      return sendOwnerMainMenu(from);

    default:
      console.warn("[CHATBOT] Unhandled:", normalizedAction);
      return sendOwnerMainMenu(from);
  }
}
