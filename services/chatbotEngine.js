// services/chatbotEngine.js

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
import { sendOwnerMainMenu } from "./metaMenus.js";

export async function handleIncomingMessage({ from, action }) {
  const normalized =
    typeof action === "string" ? action.trim().toLowerCase() : "";

  const session = getSession(from);

  /* ===== FORMS FIRST (VERY IMPORTANT) ===== */
  if (session?.step === "client_name") {
    return handleClientName(from, action);
  }

  if (session?.step === "client_phone") {
    return handleClientPhone(from, action);
  }

  if (session?.step === "enter_price" && /^\d+$/.test(normalized)) {
    return handlePrice(from, Number(normalized));
  }

  /* ===== ENTRY ===== */
  if (!normalized || ["hi", "hello", "menu"].includes(normalized)) {
    return sendOwnerMainMenu(from);
  }

  switch (normalized) {
    case "new_invoice":
      return startInvoiceFlow(from);

    case "client_new":
      return startClientFlow(from);

    case "client_1":
    case "client_2":
      return handleClientSelection(from, normalized);

    case "service":
    case "product":
      return handleAddItem(from, normalized);

    case "qty_1":
    case "qty_2":
    case "qty_5":
      return handleQty(from, Number(normalized.replace("qty_", "")));

    case "send":
      return finalizeInvoice(from);

    case "cancel":
      return sendOwnerMainMenu(from);

    default:
      console.warn("[CHATBOT] Unhandled:", normalized);
      return sendOwnerMainMenu(from);
  }
}
