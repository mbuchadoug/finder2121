// services/chatbotEngine.js
import { getSession } from "./sessionStore.js";

/* MENUS */
import {
  sendOwnerMainMenu,
  sendDocumentsMenu,
  sendPaymentsMenu,
  sendBusinessMenu
} from "./metaMenus.js";

/* INVOICE FLOW */
import {
  startInvoiceFlow,
  handleClientSelection,
  handleAddItem,
  handleQty,
  handlePrice,
  finalizeInvoice
} from "./invoiceFlow.js";

/* CLIENT FLOW */
import {
  startClientFlow,
  handleClientName,
  handleClientPhone
} from "./clientFlow.js";

/**
 * MAIN CHATBOT ENTRY
 * This is the ONLY function your webhook should call
 */
export async function handleIncomingMessage({ from, action }) {
  console.log("[CHATBOT]", from, action);

  const normalizedAction =
    typeof action === "string" ? action.trim().toLowerCase() : "";

  const session = getSession(from);

  /* =====================================================
     🔑 FORM HANDLERS (THESE RUN FIRST)
     ===================================================== */

  // Client creation flow
  if (session?.step === "client_name") {
    return handleClientName(from, action);
  }

  if (session?.step === "client_phone") {
    return handleClientPhone(from, action);
  }

  // Invoice price entry (numeric typing allowed)
  if (session?.step === "enter_price" && /^\d+$/.test(normalizedAction)) {
    return handlePrice(from, Number(normalizedAction));
  }

  /* =====================================================
     🚪 ENTRY POINTS
     ===================================================== */

  if (
    !normalizedAction ||
    ["hi", "hello", "menu", "start"].includes(normalizedAction)
  ) {
    return sendOwnerMainMenu(from);
  }

  /* =====================================================
     🧭 ROUTING
     ===================================================== */

  switch (normalizedAction) {
    /* ===== MAIN MENUS ===== */
    case "documents":
      return sendDocumentsMenu(from);

    case "payments":
      return sendPaymentsMenu(from);

    case "business":
      return sendBusinessMenu(from);

    case "back":
      return sendOwnerMainMenu(from);

    /* ===== DOCUMENTS ===== */
    case "new_invoice":
      return startInvoiceFlow(from);

    /* ===== CLIENT FLOW ===== */
    case "client_new":
      return startClientFlow(from);

    case "client_1":
    case "client_2":
      return handleClientSelection(from, normalizedAction);

    /* ===== INVOICE ITEMS ===== */
    case "item_service":
    case "item_product":
      return handleAddItem(from, normalizedAction.replace("item_", ""));

    case "qty_1":
    case "qty_2":
    case "qty_5":
      return handleQty(from, Number(normalizedAction.replace("qty_", "")));

    case "add_more":
      return handleAddItem(from, "service");

    case "send_invoice":
      return finalizeInvoice(from);

    case "cancel":
      return sendOwnerMainMenu(from);

    /* ===== FALLBACK ===== */
    default:
      console.warn("[CHATBOT] Unhandled action:", normalizedAction);
      return sendOwnerMainMenu(from);
  }
}
