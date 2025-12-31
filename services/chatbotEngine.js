import { ACTIONS } from "./actions.js";
import { startInvoiceFlow } from "./invoiceFlow.js";
import { startReceiptFlow } from "./receiptFlow.js";
import { continueTwilioFlow } from "./twilioStateBridge.js";

import { startQuoteFlow } from "./quoteFlow.js";


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

  // ===============================
// INVOICE CONFIRM ACTIONS (META)
// ===============================

// Generate PDF
// ===============================
// META → TWILIO CONFIRM DELEGATION
// ===============================

if (al === "inv_add_item") {
  const biz = await getBizForPhone(from);

  // 🔑 RESET ITEM STATE BEFORE RE-ENTERING
  biz.sessionState = "creating_invoice_add_items";
  biz.sessionData.expectingQty = false;
  biz.sessionData.lastItem = null;

  await saveBizSafe(biz);

  return sendText(from, "Send item description:");
}


// ===============================
// INVOICE CONFIRM ACTIONS (META)
// ===============================

// ✅ Generate PDF → simulate "2"
if (a === "inv_generate_pdf") {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  // build summary text
  const summary = biz.sessionData.items
    .map(
      (i, idx) => `${idx + 1}) ${i.item} x${i.qty} @ ${i.unit}`
    )
    .join("\n");

  // 🔥 SEND SOMETHING BACK TO META
  await sendText(
    from,
    `📄 Generating invoice PDF...\n\n${summary}`
  );

  // now let Twilio logic generate + send PDF
  await continueTwilioFlow({
    from,
    text: "2"
  });

  return;
}

// ✅ Set Discount → simulate "4"
// ✅ Set Discount %
if (a === "inv_set_discount") {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "creating_invoice_set_discount";
  await saveBizSafe(biz);

  return sendText(from, "Enter discount percent (0–100):");
}

// ✅ Set VAT %
if (a === "inv_set_vat") {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "creating_invoice_set_vat";
  await saveBizSafe(biz);

  return sendText(from, "Enter VAT percent (0–100):");
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

  // 🔑 CRITICAL RESET (THIS WAS MISSING)
  biz.sessionState = "creating_invoice_add_items";
  biz.sessionData.expectingQty = false;
  biz.sessionData.lastItem = null;

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

      case ACTIONS.NEW_QUOTE:
  return startQuoteFlow(from);

    case ACTIONS.NEW_RECEIPT:
      return startReceiptFlow(from);

    case ACTIONS.ADD_CLIENT:
      return startClientFlow(from);

    default:
      return sendMainMenu(from);
  }
}
