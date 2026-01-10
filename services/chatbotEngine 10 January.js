import { ACTIONS } from "./actions.js";
import { startInvoiceFlow } from "./invoiceFlow.js";
import { startReceiptFlow } from "./receiptFlow.js";
import { continueTwilioFlow } from "./twilioStateBridge.js";
import { showUnpaidInvoices } from "./paymentAdapters.js";
import Invoice from "../models/invoice.js";
import { startQuoteFlow } from "./quoteFlow.js";
import { sendList } from "./metaSender.js";

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
  sendSettingsMenu,
    sendReportsMenu,   // ✅ ADD THIS LINE
     sendUsersMenu,      // ✅ ADD
  sendBranchesMenu    // ✅ ADD
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


if (a.startsWith("payinv_")) {
  const invoiceId = a.replace("payinv_", "");

  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) {
    return sendText(from, "Invoice not found.");
  }

  biz.sessionState = "payment_amount";
  biz.sessionData = { invoiceId: invoice._id };
  await saveBizSafe(biz);

  return sendText(
    from,
`Invoice ${invoice.number}
Total: ${invoice.total} ${invoice.currency}
Paid: ${invoice.amountPaid} ${invoice.currency}
Balance: ${invoice.balance} ${invoice.currency}

Enter amount paid:`
  );
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


  // ===============================
// PAYMENTS (META → TWILIO)
// ===============================



if (a === ACTIONS.RECORD_EXPENSE) {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  biz.sessionState = ACTIONS.EXPENSE_CATEGORY;
  biz.sessionData = {};
  await saveBizSafe(biz);

  return sendList(
    from,
    "📂 Select Expense Category",
    [
      { id: "exp_cat_rent", title: "🏢 Rent" },
      { id: "exp_cat_utilities", title: "💡 Utilities" },
      { id: "exp_cat_transport", title: "🚗 Transport" },
      { id: "exp_cat_supplies", title: "📦 Supplies" },
      { id: "exp_cat_other", title: "📝 Other" }
    ]
  );
}


/* =========================
   REPORTS (META → TWILIO)
========================= */

// 📅 Daily Report
if (a === ACTIONS.DAILY_REPORT) {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "report_daily";
  biz.sessionData = {};
  await saveBizSafe(biz);

  return continueTwilioFlow({ from, text: "auto" });
}

// 📊 Weekly Report (Gold only)
if (a === ACTIONS.WEEKLY_REPORT) {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "report_weekly";
  biz.sessionData = {};
  await saveBizSafe(biz);

  return continueTwilioFlow({ from, text: "auto" });
}

// 📆 Monthly Report (Gold only)
if (a === ACTIONS.MONTHLY_REPORT) {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "report_monthly";
  biz.sessionData = {};
  await saveBizSafe(biz);

  return continueTwilioFlow({ from, text: "auto" });
}

// 🏢 Branch Summary Report (Gold only)
if (a === ACTIONS.BRANCH_REPORT) {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "report_choose_branch";
  biz.sessionData = {};
  await saveBizSafe(biz);

  return continueTwilioFlow({ from, text: "auto" });
}


  /* =========================
     TEXT → TWILIO FLOW
  ========================= */


const biz = await getBizForPhone(from);

const isMetaAction =
  al.startsWith("inv_") ||
  al.startsWith("client_") ||
  Object.values(ACTIONS).includes(a);

// Anything that is NOT a Meta action → Twilio state machine
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

    case ACTIONS.REPORTS_MENU: {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  // 🔑 SET TWILIO STATE
  biz.sessionState = "reports_menu";
  biz.sessionData = {};
  await saveBizSafe(biz);

  // 🔍 Check package
  const isGold =
    biz.package === "gold" || biz.package === "enterprise";

  return sendReportsMenu(from, isGold);
}

case ACTIONS.BUSINESS_PROFILE: {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  // 1️⃣ Send profile info
  await sendText(
    from,
`🏢 Business Profile

Name: ${biz.name}
Currency: ${biz.currency}
Package: ${biz.package}`
  );

  // 2️⃣ Automatically show main menu
  return sendMainMenu(from);
}



case ACTIONS.USERS_MENU:
  return sendUsersMenu(from);

case ACTIONS.INVITE_USER: {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "assign_user_choose_branch";
  await saveBizSafe(biz);

  // Let Twilio ask for numeric branch selection
  return sendText(
    from,
    "Select branch for new user:\n1) Main Branch\n(Reply with a number)"
  );
}





case ACTIONS.BRANCHES_MENU: {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "branches_menu";
  await saveBizSafe(biz);

  // ✅ SEND META MENU, NOT TWILIO
  return sendBranchesMenu(from);
}





case ACTIONS.VIEW_INVITES: {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  const pending = await (
    await import("../models/userRole.js")
  ).default.find({
    businessId: biz._id,
    pending: true
  }).populate("branchId");

  if (!pending.length) {
    return sendText(from, "✅ No pending invitations.");
  }

  let msg = "⏳ Pending Invites:\n";
  pending.forEach((u, i) => {
    msg += `${i + 1}) ${u.phone} | ${u.role} | ${u.branchId?.name || "N/A"}\n`;
  });

  return sendText(from, msg);
}

case ACTIONS.VIEW_USERS: {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  const users = await (
    await import("../models/userRole.js")
  ).default.find({
    businessId: biz._id,
    pending: false
  }).populate("branchId");

  if (!users.length) {
    return sendText(from, "No active users found.");
  }

  let msg = "👥 Active Users:\n";
  users.forEach((u, i) => {
    msg += `${i + 1}) ${u.phone} | ${u.role} | ${u.branchId?.name || "N/A"}\n`;
  });

  return sendText(from, msg);
}







case ACTIONS.PAYMENT_IN:
  await showUnpaidInvoices(from);
  return;




case ACTIONS.PAYMENT_OUT: {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  biz.sessionState = ACTIONS.EXPENSE_CATEGORY;
  biz.sessionData = {};
  await saveBizSafe(biz);

  return sendList(
    from,
    "📂 Select Expense Category",
    [
      { id: "exp_cat_rent", title: "🏢 Rent" },
      { id: "exp_cat_utilities", title: "💡 Utilities" },
      { id: "exp_cat_transport", title: "🚗 Transport" },
      { id: "exp_cat_supplies", title: "📦 Supplies" },
      { id: "exp_cat_other", title: "📝 Other" }
    ]
  );
}


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
