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
  console.log("[CHATBOT]", from, action);

  const normalizedAction =
    typeof action === "string" ? action.trim().toLowerCase() : "";

  // 🔑 HANDLE NUMERIC INPUT FOR FORMS (price entry)
  const session = getSession(from);
  if (session?.step === "enter_price" && /^\d+$/.test(normalizedAction)) {
    return handlePrice(from, Number(normalizedAction));
  }

  // Entry points
  if (
    !normalizedAction ||
    normalizedAction === "hi" ||
    normalizedAction === "hello" ||
    normalizedAction === "menu"
  ) {
    return sendOwnerMainMenu(from);
  }

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

    /* ===== INVOICE FLOW ===== */
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
