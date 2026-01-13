import { ACTIONS } from "./actions.js";
import { startInvoiceFlow } from "./invoiceFlow.js";
import { startReceiptFlow } from "./receiptFlow.js";
import { continueTwilioFlow } from "./twilioStateBridge.js";
import { showUnpaidInvoices } from "./paymentAdapters.js";
import Invoice from "../models/invoice.js";
import { startQuoteFlow } from "./quoteFlow.js";
import { sendList } from "./metaSender.js";
import {
  canUseFeature,
  requiredPackageForFeature,
  promptUpgrade
} from "./accessGuards.js";

import { sendPackagesMenu } from "./metaMenus.js";
import { startClientFlow } from "./clientFlow.js";
import { sendButtons } from "./metaSender.js";
   import Business from "../models/business.js";
  // import { sendPackagesMenu } from "./metaMenus.js";
import { sendText } from "./metaSender.js";

import Branch from "../models/branch.js";
import UserRole from "../models/userRole.js";
import UserSession from "../models/userSession.js";
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


import axios from "axios";
async function forwardToTwilioWebhook({ from, text }) {
  const site = (process.env.SITE_URL || "").replace(/\/$/, "");

  await axios.post(
    site + "/twilio/webhook",
    new URLSearchParams({
      From: "whatsapp:" + from.replace(/\D+/g, ""),
      Body: text
    }).toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    }
  );
}




export async function handleIncomingMessage({ from, action }) {
  console.log("META INCOMING:", { from, action });

  // 🔑 ALWAYS LOAD BUSINESS FIRST
  const biz = await getBizForPhone(from);

  // =========================
  // 🟢 ONBOARDING GATE (META)
  // =========================
  if (!biz) {
    const text = (action || "").trim();

    if (/^create$/i.test(text)) {
      // 1️⃣ ACK META (CRITICAL)
      await sendText(from, "⏳ Creating your business, please wait...");

      // 2️⃣ DELEGATE TO TWILIO STATE MACHINE


const phone = from.replace(/\D+/g, "");

const existing = await Business.findOne({ ownerPhone: phone });
if (existing) {
  await sendText(from, "You already have a business. Reply *menu*.");
  return;
}

const now = new Date();

const biz = await Business.create({
  name: null,
  currency: "USD",
  provider: "whatsapp",
  package: "trial",
  subscriptionStatus: "active",
  trialStartedAt: now,
  trialEndsAt: new Date(now.getTime() + 24 * 60 * 60 * 1000)
});

const branch = await Branch.create({
  businessId: biz._id,
  name: "Main Branch",
  isDefault: true
});

await UserRole.create({
  businessId: biz._id,
  branchId: branch._id,
  phone,
  role: "owner",
  pending: false
});

await UserSession.findOneAndUpdate(
  { phone },
  { activeBusinessId: biz._id },
  { upsert: true }
);

biz.sessionState = "awaiting_business_name";
await biz.save();

await sendText(from, "✅ Business created!\n\nWhat is your business name?");
return;



      return;
    }

    if (/^join$/i.test(text)) {
      await sendText(from, "⏳ Processing invitation...");
      await continueTwilioFlow({
        from,
        text: "JOIN"
      });
      return;
    }

    return sendText(
      from,
      "👋 Welcome!\n\nYou don’t have a business yet.\n\nReply *CREATE* to set up your business."
    );
  }



  const a = action || "";
  const al = a.toLowerCase();
const text = typeof action === "string" ? action.trim() : "";

  /* =========================
   NEW USER → BUSINESS ONBOARDING GATE
========================= */

/* =========================
   🚪 ONBOARDING (FIXED)
========================= */



// 📌 Main menu shortcut — ONLY when NOT onboardin



  /* =========================
     ENTRY
  ========================= */
  /*if (!al || ["hi", "hello", "menu"].includes(al)) {
    return sendMainMenu(from);
  }*/

    /* =========================
   JOIN INVITATION (META)
========================= */
if (al === "join") {
  const phone = from.replace(/\D+/g, "");

  const UserRole = (await import("../models/userRole.js")).default;
  const UserSession = (await import("../models/userSession.js")).default;

  const invite = await UserRole.findOne({
    phone,
    pending: true
  }).populate("businessId branchId");

  if (!invite) {
    return sendText(
      from,
      "❌ No pending invitation found for this number."
    );
  }

  // ✅ ACTIVATE USER
  invite.pending = false;
  await invite.save();

  // ✅ SET ACTIVE BUSINESS
  await UserSession.findOneAndUpdate(
    { phone },
    { activeBusinessId: invite.businessId._id },
    { upsert: true }
  );

  await sendText(
    from,
`✅ Invitation accepted!

🏢 Business: ${invite.businessId.name}
📍 Branch: ${invite.branchId?.name || "Main"}
🔑 Role: ${invite.role}

Reply *menu* to start.`
  );

  return sendMainMenu(from);
}

    // 🔒 Prevent Meta from interrupting Twilio media flows



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

  /* =========================
   ONBOARDING — BUSINESS NAME
========================= */

// =========================
// 🏢 ONBOARDING: BUSINESS NAME
// =========================
if (biz && biz.sessionState === "awaiting_business_name") {
  const name = text;

  if (!name || name.length < 2) {
    await sendText(from, "❌ Please enter a valid business name:");
    return;
  }

  biz.name = name;
  biz.sessionState = "awaiting_currency";
  await saveBizSafe(biz);

  // Ask for currency (buttons)
  await sendButtons(from, "💱 Select your business currency", [
    { id: "onb_currency_USD", title: "USD ($)" },
    { id: "onb_currency_ZWL", title: "ZWL (Z$)" },
    { id: "onb_currency_ZAR", title: "ZAR (R)" }
  ]);

  return;
}


//const biz = await getBizForPhone(from);

// 🔑 In Meta Cloud, typed text ALSO arrives as `action`

// ✅ Meta action = known button/list IDs only
const isMetaAction =
  typeof action === "string" &&
  Object.values(ACTIONS).includes(action);


// Anything that is NOT a Meta action → Twilio state machine
//const biz = await getBizForPhone(from);

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

// ✅ SAFELY load business AFTER onboarding
 //biz = await getBizForPhone(from);

// ✅ Only pass text to Twilio if a business exists AND has a session


// ✅ Only pass text to Twilio AFTER onboarding
if (!isMetaAction && biz && biz.sessionState) {
  const handled = await continueTwilioFlow({
    from,
    text
  });
  if (handled) return;
}




// =========================
// 💱 ONBOARDING: CURRENCY
// =========================
if (biz && biz.sessionState === "awaiting_currency" && a.startsWith("onb_currency_")) {
  const currency = a.replace("onb_currency_", "").toUpperCase();

  if (!["USD", "ZWL", "ZAR"].includes(currency)) {
    await sendText(from, "❌ Invalid currency selection.");
    return;
  }

  biz.currency = currency;
  biz.sessionState = "awaiting_logo";
  await saveBizSafe(biz);

  await sendButtons(
    from,
    "🖼 Would you like to add your business logo now?",
    [
      { id: "onb_logo_yes", title: "📷 Upload Logo" },
      { id: "onb_logo_skip", title: "Skip for now" }
    ]
  );

  return;
}



// =========================
// 🖼 ONBOARDING: LOGO CHOICE
// =========================
if (biz && biz.sessionState === "awaiting_logo") {
  // User wants to upload logo
  if (a === "onb_logo_yes") {
    biz.sessionState = "awaiting_logo_upload";
    await saveBizSafe(biz);

    await sendText(
      from,
      "📷 Please send your logo image (PNG or JPG).\nYou can also type *skip* to continue without a logo."
    );
    return;
  }

  // User skips logo
  if (a === "onb_logo_skip") {
    biz.sessionState = "ready";
    await saveBizSafe(biz);

    await sendText(
      from,
      "✅ Setup complete!\n\nYour business is ready to use 🚀"
    );

    return sendMainMenu(from);
  }
}

// =========================
// 🖼 ONBOARDING: LOGO UPLOAD (META IMAGE OR SKIP)
// =========================
if (biz && biz.sessionState === "awaiting_logo_upload") {
  // User types skip
  if (text && text.toLowerCase() === "skip") {
    biz.sessionState = "ready";
    await saveBizSafe(biz);

    await sendText(from, "✅ Setup complete! Logo skipped.");
    return sendMainMenu(from);
  }

  /**
   * IMPORTANT:
   * At this point, the actual image handling
   * happens in meta_webhook.js
   *
   * That file should already:
   *  - download the image
   *  - save biz.logoUrl
   */

  if (biz.logoUrl) {
    biz.sessionState = "ready";
    await saveBizSafe(biz);

    await sendText(from, "✅ Logo uploaded successfully!");
    return sendMainMenu(from);
  }

  // If neither skip nor image yet, wait silently
  return;
}



if (a.startsWith("invite_branch_")) {
  const branchId = a.replace("invite_branch_", "");

  const biz = await getBizForPhone(from);
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

  const biz = await getBizForPhone(from);
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
if (a.startsWith("assign_branch_")) {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  // ensure we are in the correct state
  if (biz.sessionState !== "assign_branch_pick_branch") return;

  const branchId = a.replace("assign_branch_", "");

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
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "settings_inv_prefix";
  await saveBizSafe(biz);

  return sendText(
    from,
    `Current invoice prefix: ${biz.invoicePrefix || "INV"}\n\nReply with new prefix:`
  );
}

if (a === ACTIONS.SETTINGS_QT_PREFIX) {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "settings_qt_prefix";
  await saveBizSafe(biz);

  return sendText(
    from,
    `Current quote prefix: ${biz.quotePrefix || "QT"}\n\nReply with new prefix:`
  );
}

if (a === ACTIONS.SETTINGS_RCPT_PREFIX) {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "settings_rcpt_prefix";
  await saveBizSafe(biz);

  return sendText(
    from,
    `Current receipt prefix: ${biz.receiptPrefix || "RCPT"}\n\nReply with new prefix:`
  );
}

if (a === ACTIONS.SETTINGS_CURRENCY) {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "settings_currency";
  await saveBizSafe(biz);

  return sendText(
    from,
    `Current currency: ${biz.currency}\n\nReply with new currency (USD, ZWL, ZAR):`
  );
}


if (a === ACTIONS.SETTINGS_TERMS) {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "settings_terms";
  await saveBizSafe(biz);

  return sendText(
    from,
    `Current payment terms: ${biz.paymentTermsDays || 0} days\n\nReply with number of days:`
  );
}


if (a === ACTIONS.SETTINGS_LOGO) {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  biz.sessionState = "awaiting_logo_upload";
  await saveBizSafe(biz);

  return sendText(
    from,
    "📷 Please send your business logo image (PNG or JPG).\nReply 0 to cancel."
  );
}


if (a === ACTIONS.SETTINGS_CLIENTS) {
  const biz = await getBizForPhone(from);
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
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  return sendBranchesMenu(from);
}

// ===============================
// PACKAGE SELECTION
// ===============================
if (biz?.sessionState === "choose_package" && a.startsWith("pkg_")) {
  const selected = a.replace("pkg_", "");

  const allowed = ["trial", "bronze", "silver", "gold"];
  if (!allowed.includes(selected)) {
    return sendText(from, "❌ Invalid package selected.");
  }

  // ✅ Update business package
  biz.package = selected;
  biz.subscriptionStatus = "active";

  // reset usage counters if upgrading
  biz.documentCountMonth = 0;
  biz.documentCountMonthKey = null;

  biz.sessionState = "ready";
  biz.sessionData = {};
  await saveBizSafe(biz);

  await sendText(
    from,
    `✅ Package updated successfully!\n\nYour new package: *${selected.toUpperCase()}*`
  );

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

case ACTIONS.REPORTS_MENU: {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  /*if (!canUseFeature(biz, "reports_daily")) {
    const needed = requiredPackageForFeature("reports_daily");
    return sendText(
      from,
      `🔒 Reports are not available on your current package.\n\nUpgrade to *${needed.toUpperCase()}* to unlock reports.`
    );
  }*/

    if (!canUseFeature(biz, "reports_daily")) {
  return promptUpgrade({
    biz,
    from,
    feature: "Reports"
  });
}


  biz.sessionState = "reports_menu";
  biz.sessionData = {};
  await saveBizSafe(biz);

  const isGold = biz.package === "gold";
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

  // ============================
  // 🔒 ROLE CHECK (MINIMAL)
  // ============================
  const UserRole = (await import("../models/userRole.js")).default;
  const caller = await UserRole.findOne({
    businessId: biz._id,
    phone: from.replace(/\D+/g, ""),
    pending: false
  });

  if (!caller || caller.role !== "owner") {
    return sendText(
      from,
      "🔒 Only the business owner can invite users."
    );
  }

  // ============================
  // 📦 PACKAGE FEATURE CHECK
  // ============================
  const { PACKAGES } = await import("./packages.js");

  const pkg = PACKAGES[biz.package] || PACKAGES.trial;

  /*if (!pkg.features.includes("users")) {
    return sendText(
      from,
      "🔒 User management is not available on your current package.\n\nUpgrade your package to invite users."
    );
  }*/

    if (!pkg.features.includes("users")) {
  return promptUpgrade({
    biz,
    from,
    feature: "User management"
  });
}


  // ============================
  // 👥 USER LIMIT CHECK
  // ============================
  const activeUsers = await UserRole.countDocuments({
    businessId: biz._id,
    pending: false
  });

  if (activeUsers >= pkg.users) {
    return sendText(
      from,
      `🚫 User limit reached (${pkg.users}).\n\nUpgrade your package to add more users.`
    );
  }

  // ============================
  // ✅ EXISTING LOGIC (UNCHANGED)
  // ============================

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
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  const UserRole = (await import("../models/userRole.js")).default;
  const { canAccessSection } = await import("./roleGuard.js");

  const caller = await UserRole.findOne({
    businessId: biz._id,
    phone: from.replace(/\D+/g, ""),
    pending: false
  });

  if (!caller || !canAccessSection(caller.role, "branches")) {
    return sendText(
      from,
      "🔒 You do not have permission to access branches."
    );
  }

  return sendBranchesMenu(from);
}


case ACTIONS.ADD_BRANCH: {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

 /* if (!canUseFeature(biz, "branches")) {
    return sendText(
      from,
      "🔒 Branches are not available on your current package.\nUpgrade to *GOLD* to unlock branches."
    );
  }*/
 if (!canUseFeature(biz, "branches")) {
  return promptUpgrade({
    biz,
    from,
    feature: "Branches"
  });
}


  const Branch = (await import("../models/branch.js")).default;
  const count = await Branch.countDocuments({ businessId: biz._id });

  const { branches } = (await import("./packages.js")).PACKAGES[biz.package];
  if (count >= branches) {
    return sendText(
      from,
      `🚫 Branch limit reached (${branches}).\nUpgrade your package to add more branches.`
    );
  }

  biz.sessionState = "branch_add_name";
  await saveBizSafe(biz);
  return sendText(from, "Enter new branch name:");
}


case ACTIONS.VIEW_BRANCHES: {
  const biz = await getBizForPhone(from);
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
  const biz = await getBizForPhone(from);
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


   case ACTIONS.BUSINESS_MENU: {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  const UserRole = (await import("../models/userRole.js")).default;
  const { canAccessSection } = await import("./roleGuard.js");

  const caller = await UserRole.findOne({
    businessId: biz._id,
    phone: from.replace(/\D+/g, ""),
    pending: false
  });

  if (!caller || !canAccessSection(caller.role, "users")) {
    return sendText(
      from,
      "🔒 You do not have permission to access Business & Users."
    );
  }

  return sendBusinessMenu(from);
}

case ACTIONS.SETTINGS_MENU: {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  const UserRole = (await import("../models/userRole.js")).default;
  const { canAccessSection } = await import("./roleGuard.js");

  const caller = await UserRole.findOne({
    businessId: biz._id,
    phone: from.replace(/\D+/g, ""),
    pending: false
  });

  if (!caller || !canAccessSection(caller.role, "settings")) {
    return sendText(
      from,
      "🔒 You do not have permission to access Settings."
    );
  }

  biz.sessionState = "settings_menu";
  biz.sessionData = {};
  await saveBizSafe(biz);

  return sendSettingsMenu(from);
}


case ACTIONS.UPGRADE_PACKAGE: {
  const biz = await getBizForPhone(from);
  if (!biz) return sendMainMenu(from);

  // 🔒 Only owner can upgrade
  const UserRole = (await import("../models/userRole.js")).default;
  const caller = await UserRole.findOne({
    businessId: biz._id,
    phone: from.replace(/\D+/g, ""),
    pending: false
  });

  if (!caller || caller.role !== "owner") {
    return sendText(from, "🔒 Only the business owner can change the package.");
  }

  biz.sessionState = "choose_package";
  await saveBizSafe(biz);

  return sendPackagesMenu(from, biz.package);
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
  const biz = await getBizForPhone(from);

  // 🚫 Do NOT interrupt Twilio flows (e.g. logo upload)
  if (biz?.sessionState === "awaiting_logo_upload") {
    return;
  }

  return sendMainMenu(from);
}

  }
}
