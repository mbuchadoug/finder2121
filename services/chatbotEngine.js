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

  // 🔒 CRITICAL: Do NOT interrupt Twilio media flows (logo upload)
const biz = await getBizForPhone(from);
  if (!al && biz?.sessionState === "awaiting_logo_upload") {
    return; // let Twilio webhook handle the image
  }s

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
  
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "creating_invoice_set_discount";
  await saveBizSafe(biz);

  return sendText(from, "Enter discount percent (0–100):");
}

// ✅ Set VAT %
if (a === "inv_set_vat") {
  
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
  

  // 🔑 CRITICAL RESET (THIS WAS MISSING)
  biz.sessionState = "creating_invoice_add_items";
  biz.sessionData.expectingQty = false;
  biz.sessionData.lastItem = null;

  await saveBizSafe(biz);

  return sendText(from, "Send item description:");
}


  if (a === ACTIONS.INV_ENTER_PRICES) {
    
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
  
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "report_daily";
  biz.sessionData = {};
  await saveBizSafe(biz);

  return continueTwilioFlow({ from, text: "auto" });
}

// 📊 Weekly Report (Gold only)
if (a === ACTIONS.WEEKLY_REPORT) {
  
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "report_weekly";
  biz.sessionData = {};
  await saveBizSafe(biz);

  return continueTwilioFlow({ from, text: "auto" });
}

// 📆 Monthly Report (Gold only)
if (a === ACTIONS.MONTHLY_REPORT) {
  
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "report_monthly";
  biz.sessionData = {};
  await saveBizSafe(biz);

  return continueTwilioFlow({ from, text: "auto" });
}

// 🏢 Branch Summary Report (Gold only)
if (a === ACTIONS.BRANCH_REPORT) {
  
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "report_choose_branch";
  biz.sessionData = {};
  await saveBizSafe(biz);

  return continueTwilioFlow({ from, text: "auto" });
}


  /* =========================
     TEXT → TWILIO FLOW
  ========================= */



// 🔑 In Meta Cloud, typed text ALSO arrives as `action`
const text = typeof action === "string" ? action.trim() : "";

// ✅ Meta action = known button/list IDs only
const isMetaAction =
  typeof action === "string" &&
  action.length > 0 &&
  (
    Object.values(ACTIONS).includes(action) ||
    action.startsWith("assign_")
  );

// Anything that is NOT a Meta action → Twilio state machine
//

// 🔑 FORCE branch name input into Twilio flow


// default behaviour
// ⚠️ Do NOT send settings input to Twilio bridge
const settingsStates = [
  "settings_currency",
  "settings_terms",
  "settings_inv_prefix",
  "settings_qt_prefix",
  "settings_rcpt_prefix"
];

// ✅ Allow Twilio to handle active session states (including media uploads)
if (!isMetaAction && biz?.sessionState) {
  const handled = await continueTwilioFlow({
    from,
    text
  });
  if (handled) return;
}


if (a.startsWith("invite_branch_")) {
  const branchId = a.replace("invite_branch_", "");

  
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "invite_user_phone";
  biz.sessionData.branchId = branchId;
  await saveBizSafe(biz);

  return sendText(from, "Enter WhatsApp number of the user to invite:");
}


// ===============================
// ASSIGN USER → PICK USER (META)
// ===============================
if (a.startsWith("assign_user_")) {
  const userId = a.replace("assign_user_", "");

  
  if (!biz) return sendMainMenu(from);

  const Branch = (await import("../models/branch.js")).default;
  const branches = await Branch.find({ businessId: biz._id }).lean();

  if (!branches.length) {
    await sendText(from, "No branches found.");
    return sendMainMenu(from);
  }

  biz.sessionData.userId = userId;
  biz.sessionState = "assign_branch_pick_branch";
  await saveBizSafe(biz);

  return sendList(
    from,
    "Select branch",
    branches.map(b => ({
      id: `assign_branch_${b._id}`,
      title: b.name
    }))
  );
}


// ===============================
// FINAL STEP: SAVE USER → BRANCH
// ===============================

// ===============================
// FINAL STEP: SAVE USER → BRANCH
// ===============================
if (
  a.startsWith("assign_branch_") &&
  biz.sessionState === "assign_branch_pick_branch"
) {
  const branchId = a.replace("assign_branch_", "");

  
  if (!biz) return sendMainMenu(from);

  const userId = biz.sessionData.userId;
  if (!userId) {
    await sendText(from, "⚠️ No user selected.");
    return sendMainMenu(from);
  }

  const UserRole = (await import("../models/userRole.js")).default;
  await UserRole.findByIdAndUpdate(userId, { branchId });

  biz.sessionState = "ready";
  biz.sessionData = {};
  await saveBizSafe(biz);

  await sendText(from, "✅ User successfully assigned to branch.");
  return sendMainMenu(from);
}

/* =========================
   SETTINGS (META) — STEP 4
   MUST BE BEFORE SWITCH
========================= */

if (a === ACTIONS.SETTINGS_INV_PREFIX) {
  
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "settings_inv_prefix";
  await saveBizSafe(biz);

  return sendText(
    from,
    `Current invoice prefix: ${biz.invoicePrefix || "INV"}\n\nReply with new prefix:`
  );
}

if (a === ACTIONS.SETTINGS_QT_PREFIX) {
  
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "settings_qt_prefix";
  await saveBizSafe(biz);

  return sendText(
    from,
    `Current quote prefix: ${biz.quotePrefix || "QT"}\n\nReply with new prefix:`
  );
}

if (a === ACTIONS.SETTINGS_RCPT_PREFIX) {
  
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "settings_rcpt_prefix";
  await saveBizSafe(biz);

  return sendText(
    from,
    `Current receipt prefix: ${biz.receiptPrefix || "RCPT"}\n\nReply with new prefix:`
  );
}

if (a === ACTIONS.SETTINGS_CURRENCY) {
  
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "settings_currency";
  await saveBizSafe(biz);

  return sendText(
    from,
    `Current currency: ${biz.currency}\n\nReply with new currency (USD, ZWL, ZAR):`
  );
}


if (a === ACTIONS.SETTINGS_TERMS) {
  
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "settings_terms";
  await saveBizSafe(biz);

  return sendText(
    from,
    `Current payment terms: ${biz.paymentTermsDays || 0} days\n\nReply with number of days:`
  );
}


if (a === ACTIONS.SETTINGS_LOGO) {
  
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "awaiting_logo_upload";
  await saveBizSafe(biz);

  return sendText(
    from,
    "📷 Please send your business logo image (PNG or JPG).\nReply 0 to cancel."
  );
}


if (a === ACTIONS.SETTINGS_CLIENTS) {
  
  if (!biz) return sendMainMenu(from);

  const Client = (await import("../models/client.js")).default;
  const clients = await Client.find({ businessId: biz._id }).lean();

  if (!clients.length) {
    return sendText(from, "No clients found.");
  }

  let msg = "👥 Clients:\n";
  clients.forEach((c, i) => {
    msg += `${i + 1}) ${c.name || c.phone}\n`;
  });

  await sendText(from, msg);
  return sendSettingsMenu(from);
}


if (a === ACTIONS.SETTINGS_BRANCHES) {
  
  if (!biz) return sendMainMenu(from);

  return sendBranchesMenu(from);
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
  
  if (!biz) return sendMainMenu(from);

  // move into invite flow
  biz.sessionState = "invite_user_choose_branch";
  biz.sessionData = {};
  await saveBizSafe(biz);

  const Branch = (await import("../models/branch.js")).default;
  const branches = await Branch.find({ businessId: biz._id }).lean();

  if (!branches.length) {
    await sendText(from, "No branches found. Please add a branch first.");
    return sendBranchesMenu(from);
  }

  return sendList(
    from,
    "Select branch for new user",
    branches.map(b => ({
      id: `invite_branch_${b._id}`,
      title: b.name
    }))
  );
}



case ACTIONS.BRANCHES_MENU: {
  return sendBranchesMenu(from);
}


case ACTIONS.ADD_BRANCH: {
  
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "branch_add_name";
  await saveBizSafe(biz);

  return sendText(from, "Enter new branch name:");
}

case ACTIONS.VIEW_BRANCHES: {
  
  if (!biz) return sendMainMenu(from);

  const Branch = (await import("../models/branch.js")).default;
  const branches = await Branch.find({ businessId: biz._id }).lean();

  if (!branches.length) {
    await sendText(from, "No branches found.");
    return sendMainMenu(from);
  }

  let msg = "🏬 Branches:\n";
  branches.forEach((b, i) => {
    msg += `${i + 1}) ${b.name}\n`;
  });

  await sendText(from, msg);
  return sendMainMenu(from);
}


case ACTIONS.ASSIGN_BRANCH_USERS: {
  
  if (!biz) return sendMainMenu(from);

  const UserRole = (await import("../models/userRole.js")).default;
  const users = await UserRole.find({
    businessId: biz._id,
    pending: false
  }).lean();

  if (!users.length) {
    await sendText(from, "No active users found.");
    return sendMainMenu(from);
  }

  biz.sessionState = "assign_branch_pick_user";
  biz.sessionData = {};
  await saveBizSafe(biz);

  return sendList(
    from,
    "Select user",
    users.map(u => ({
      id: `assign_user_${u._id}`,
      title: u.phone
    }))
  );
}



case ACTIONS.VIEW_INVITES: {
  
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

case ACTIONS.SETTINGS_MENU: {
  
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "settings_menu";
  biz.sessionData = {};
  await saveBizSafe(biz);

  return sendSettingsMenu(from);
}



    
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

   default: {
  

  // 🚫 Do NOT interrupt Twilio flows (e.g. logo upload)
  if (biz?.sessionState === "awaiting_logo_upload") {
    return;
  }

  return sendMainMenu(from);
}

  }
}
