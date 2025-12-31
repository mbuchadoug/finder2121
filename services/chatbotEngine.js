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

  /* =========================
     ENTRY
  ========================= */
  if (!al || ["hi", "hello", "menu"].includes(al)) {
    return sendMainMenu(from);
  }

  /* =========================
     ALWAYS LET ACTIVE FLOWS
     CONSUME TEXT FIRST 🔥
  ========================= */
  const biz = await getBizForPhone(from);
  if (biz?.sessionState) {
    const handled = await continueTwilioFlow({
      from,
      text: a
    });
    if (handled) return;
  }

  /* =========================
     META BUTTON ACTIONS
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
     INVOICE META SHORTCUTS
  ========================= */

  if (al === "inv_add_item") {
    return continueTwilioFlow({ from, text: "1" });
  }

  if (a === "inv_generate_pdf") {
    if (!biz) return sendMainMenu(from);

    const summary = (biz.sessionData.items || [])
      .map((i, idx) => `${idx + 1}) ${i.item} x${i.qty} @ ${i.unit}`)
      .join("\n");

    await sendText(from, `📄 Generating invoice PDF...\n\n${summary}`);
    await continueTwilioFlow({ from, text: "2" });
    return;
  }

  if (a === "inv_set_discount") {
    if (!biz) return sendMainMenu(from);
    biz.sessionState = "creating_invoice_set_discount";
    await saveBizSafe(biz);
    return sendText(from, "Enter discount percent (0–100):");
  }

  if (a === "inv_set_vat") {
    if (!biz) return sendMainMenu(from);
    biz.sessionState = "creating_invoice_set_vat";
    await saveBizSafe(biz);
    return sendText(from, "Enter VAT percent (0–100):");
  }

  if (al === "inv_cancel") {
    if (!biz) return sendMainMenu(from);
    biz.sessionState = null;
    biz.sessionData = {};
    await saveBizSafe(biz);
    return sendMainMenu(from);
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
