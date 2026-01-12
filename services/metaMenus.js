import { ACTIONS } from "./actions.js";
import { sendList, sendText, sendButtons } from "./metaSender.js";



/* =========================
   MAIN
========================= */
export async function sendMainMenu(to) {
  return sendList(to, "📊 Main Menu", [
    { id: ACTIONS.SALES_MENU, title: "🧾 Sales" },
    { id: ACTIONS.CLIENTS_MENU, title: "👥 Clients" },
    { id: ACTIONS.PAYMENTS_MENU, title: "💰 Payments" },
    { id: ACTIONS.REPORTS_MENU, title: "📈 Reports" },
    { id: ACTIONS.BUSINESS_MENU, title: "🏢 Business & Users" },
    { id: ACTIONS.SETTINGS_MENU, title: "⚙ Settings" },
       { id: ACTIONS.UPGRADE_PACKAGE, title: "⭐ Upgrade Package" }

  ]);
}

/* =========================
   SALES (FIXED ✅)
========================= */
export async function sendSalesMenu(to) {
  return sendList(to, "🧾 Sales", [
    { id: ACTIONS.NEW_INVOICE, title: "New Invoice" },
    { id: ACTIONS.NEW_QUOTE, title: "New Quotation" },
    { id: ACTIONS.NEW_RECEIPT, title: "New Receipt" },
    { id: ACTIONS.BACK, title: "⬅ Back" }
  ]);
}

/* =========================
   CLIENTS
========================= */
export async function sendClientsMenu(to) {
  return sendList(to, "👥 Clients", [
    { id: ACTIONS.ADD_CLIENT, title: "➕ Add Client" },
    { id: ACTIONS.CLIENT_STATEMENT, title: "📄 Client Statement" },
    { id: ACTIONS.BACK, title: "⬅ Back" }
  ]);
}

/* =========================
   PAYMENTS
========================= */
export async function sendPaymentsMenu(to) {
  return sendList(to, "💰 Payments", [
    { id: ACTIONS.PAYMENT_IN, title: "Record payment (IN)" },
    { id: ACTIONS.PAYMENT_OUT, title: "Record expense (OUT)" },
    { id: ACTIONS.BACK, title: "⬅ Back" }
  ]);
}




/* =========================
   BUSINESS
========================= 
export async function sendBusinessMenu(to) {
  return sendList(to, "🏢 Business & Users", [
    { id: ACTIONS.BUSINESS_PROFILE, title: "Business Profile" },
    { id: ACTIONS.USERS, title: "Users" },
    { id: ACTIONS.BACK, title: "⬅ Back" }
  ]);
}*/


export async function sendBusinessMenu(to) {
  return sendList(to, "🏢 Business & Users", [
    { id: ACTIONS.BUSINESS_PROFILE, title: "🏢 Business Profile" },
    { id: ACTIONS.USERS_MENU, title: "👥 Users" },
    { id: ACTIONS.BRANCHES_MENU, title: "🏬 Branches" },
    { id: ACTIONS.BACK, title: "⬅ Back" }
  ]);
}


/* =========================
   SETTINGS
========================= */
export function sendSettingsMenu(from) {
  return sendList(
    from,
    "⚙️ Settings",
    [
      { id: ACTIONS.SETTINGS_CURRENCY, title: "💱 Currency" },
      { id: ACTIONS.SETTINGS_TERMS, title: "📅 Payment terms" },
      { id: ACTIONS.SETTINGS_INV_PREFIX, title: "🧾 Invoice prefix" },
      { id: ACTIONS.SETTINGS_QT_PREFIX, title: "📄 Quote prefix" },
      { id: ACTIONS.SETTINGS_RCPT_PREFIX, title: "🧾 Receipt prefix" },
      { id: ACTIONS.SETTINGS_LOGO, title: "🖼️ Business logo" },
      { id: ACTIONS.SETTINGS_CLIENTS, title: "👥 View clients" },
      { id: ACTIONS.SETTINGS_BRANCHES, title: "🏬 Branches" }
    ]
  );
}


export async function sendInvoiceConfirmMenu(to, summaryText) {
  return sendList(to, summaryText, [
    { id: "inv_add_item", title: "➕ Add another item" },
    { id: "inv_generate_pdf", title: "📄 Generate PDF" },
    { id: "inv_set_discount", title: "💸 Set discount %" },
    { id: "inv_set_vat", title: "🧾 Set VAT %" },
    { id: "inv_cancel", title: "❌ Cancel" }
  ]);
}



export async function sendReportsMenu(to, isGold = false) {
  const items = [
    { id: ACTIONS.DAILY_REPORT, title: "📅 Daily Report" }
  ];

  if (isGold) {
    items.push(
      { id: ACTIONS.WEEKLY_REPORT, title: "📊 Weekly Report" },
      { id: ACTIONS.MONTHLY_REPORT, title: "📆 Monthly Report" },
      { id: ACTIONS.BRANCH_REPORT, title: "🏢 Branch Report" }
    );
  }

  items.push({ id: ACTIONS.BACK, title: "⬅ Back" });

  return sendList(to, "📈 Reports", items);
}


export async function sendUsersMenu(to) {
  return sendList(to, "👥 Users", [
    { id: ACTIONS.INVITE_USER, title: "➕ Invite User" },
    { id: ACTIONS.VIEW_INVITES, title: "📨 Pending Invites" },
    { id: ACTIONS.VIEW_USERS, title: "👤 Active Users" },
    { id: ACTIONS.BACK, title: "⬅ Back" }
  ]);
}


export async function sendBranchesMenu(to) {
  return sendList(to, "🏬 Branches", [
    { id: ACTIONS.ADD_BRANCH, title: "➕ Add Branch" },
    { id: ACTIONS.VIEW_BRANCHES, title: "📋 View Branches" },
    { id: ACTIONS.ASSIGN_BRANCH_USERS, title: "👥 Assign Users" },
    { id: ACTIONS.BACK, title: "⬅ Back" }
  ]);
}



export async function sendInviteUserMenu(to) {
  return sendList(to, "👤 Invite User", [
    { id: ACTIONS.BRANCH_VIEW, title: "📂 View branches" },
    { id: ACTIONS.BRANCH_ADD, title: "➕ Add branch" },
    { id: ACTIONS.BRANCH_ASSIGN_USER, title: "👥 Assign user to branch" },
    { id: ACTIONS.BACK, title: "⬅ Back" }
  ]);
}


export async function sendPackagesMenu(to, currentPackage) {
  return sendList(
    to,
    `📦 Your current package: *${currentPackage.toUpperCase()}*\n\nChoose a package:`,
    [
      
      { id: "pkg_bronze", title: "🥉 Bronze" },
      { id: "pkg_silver", title: "🥈 Silver" },
      { id: "pkg_gold", title: "🥇 Gold" },
      { id: ACTIONS.BACK, title: "⬅ Back" }
    ]
  );
}
